use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

/// Max replay buffer size per session (64 KB)
const REPLAY_BUFFER_CAP: usize = 64 * 1024;

/// Get the default shell for the current platform.
/// Windows: COMSPEC -> PowerShell -> cmd.exe
/// Unix: SHELL -> /bin/zsh -> /bin/bash
fn get_default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(comspec) = std::env::var("COMSPEC") {
            return comspec;
        }
        // Try PowerShell
        let ps_paths = [
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        ];
        for ps in &ps_paths {
            if std::path::Path::new(ps).exists() {
                return ps.to_string();
            }
        }
        "cmd.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if std::path::Path::new("/bin/zsh").exists() {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        })
    }
}

/// Split raw bytes into valid UTF-8 text + incomplete trailing bytes.
///
/// Invalid bytes in the middle are replaced with U+FFFD (same as `from_utf8_lossy`).
/// Incomplete multi-byte sequences at the very end are returned as pending bytes
/// to be prepended to the next chunk.
pub(crate) fn bytes_to_utf8_with_pending(data: &[u8]) -> (String, Vec<u8>) {
    if data.is_empty() {
        return (String::new(), vec![]);
    }

    // Fast path: all valid UTF-8
    if let Ok(s) = std::str::from_utf8(data) {
        return (s.to_string(), vec![]);
    }

    let mut result = String::with_capacity(data.len());
    let mut remaining = data;

    loop {
        match std::str::from_utf8(remaining) {
            Ok(s) => {
                result.push_str(s);
                return (result, vec![]);
            }
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                // from_utf8 already validated this range, unwrap cannot panic
                result.push_str(std::str::from_utf8(&remaining[..valid_up_to]).unwrap());

                match e.error_len() {
                    Some(invalid_len) => {
                        // Genuinely invalid byte(s) — replace with U+FFFD and continue
                        result.push('\u{FFFD}');
                        remaining = &remaining[valid_up_to + invalid_len..];
                    }
                    None => {
                        // Incomplete multi-byte sequence at end — carry over
                        return (result, remaining[valid_up_to..].to_vec());
                    }
                }
            }
        }
    }
}

struct PtyReader {
    receiver: Receiver<Vec<u8>>,
    /// Leftover bytes from the previous `read_from_session` call that formed
    /// an incomplete UTF-8 multi-byte sequence at a chunk boundary.
    utf8_pending: Vec<u8>,
}

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    reader: PtyReader,
    child: Box<dyn Child + Send + Sync>,
    broadcast_tx: broadcast::Sender<Vec<u8>>,
    /// Ring buffer of recent PTY output for replaying to new subscribers.
    replay_buffer: Arc<Mutex<VecDeque<u8>>>,
}

impl PtySession {
    fn kill_child(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill_child();
    }
}

pub struct PtyManager {
    sessions: HashMap<String, Arc<Mutex<PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn create_session(
        &mut self,
        id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        // Properly close existing session if any
        if self.has_session(id) {
            self.close_session(id)?;
        }

        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Get the user's shell
        let shell = get_default_shell();
        log::info!("PTY session '{}' using shell: {}", id, shell);

        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(cwd);

        // Set environment variables for better terminal support
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env(
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()),
        );

        // Preserve important env vars
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        }
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home);
        }
        if let Ok(user) = std::env::var("USER") {
            cmd.env("USER", user);
        }

        // Windows-specific environment variables
        #[cfg(target_os = "windows")]
        {
            for var in &[
                "USERPROFILE",
                "HOMEDRIVE",
                "HOMEPATH",
                "APPDATA",
                "LOCALAPPDATA",
                "TEMP",
                "TMP",
                "SystemRoot",
                "COMPUTERNAME",
                "PSModulePath",
                "PATHEXT",
                "OS",
            ] {
                if let Ok(val) = std::env::var(var) {
                    cmd.env(var, val);
                }
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Drop slave to avoid blocking
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        // Create channel for async reading (desktop polling via invoke)
        let (tx, rx) = channel::<Vec<u8>>();

        // Create broadcast channel for WebSocket subscribers
        let (broadcast_tx, _) = broadcast::channel::<Vec<u8>>(256);
        let broadcast_tx_clone = broadcast_tx.clone();

        // Replay buffer shared with reader thread
        let replay_buffer: Arc<Mutex<VecDeque<u8>>> =
            Arc::new(Mutex::new(VecDeque::with_capacity(REPLAY_BUFFER_CAP)));
        let replay_buf_clone = replay_buffer.clone();

        // Spawn a thread to read from PTY
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        // Send to broadcast (for WS subscribers); ignore errors (no receivers)
                        let _ = broadcast_tx_clone.send(data.clone());
                        // Append to replay buffer
                        if let Ok(mut rb) = replay_buf_clone.lock() {
                            rb.extend(&data);
                            // Trim from front if over capacity
                            if rb.len() > REPLAY_BUFFER_CAP {
                                let excess = rb.len() - REPLAY_BUFFER_CAP;
                                rb.drain(..excess);
                            }
                        }
                        // Send to mpsc (for desktop pty_read polling)
                        if tx.send(data).is_err() {
                            break; // Receiver dropped
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let session = PtySession {
            master: pair.master,
            writer,
            reader: PtyReader {
                receiver: rx,
                utf8_pending: Vec::new(),
            },
            child,
            broadcast_tx,
            replay_buffer,
        };

        self.sessions
            .insert(id.to_string(), Arc::new(Mutex::new(session)));
        Ok(())
    }

    pub fn write_to_session(&self, id: &str, data: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| "Session not found".to_string())?;

        let mut session = session.lock().map_err(|e| format!("Lock error: {}", e))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    pub fn read_from_session(&self, id: &str) -> Result<String, String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| "Session not found".to_string())?;

        let mut session = session.lock().map_err(|e| format!("Lock error: {}", e))?;

        // Non-blocking: collect all available data
        let mut result = std::mem::take(&mut session.reader.utf8_pending);
        while let Ok(data) = session.reader.receiver.try_recv() {
            result.extend(data);
        }

        let (text, pending) = bytes_to_utf8_with_pending(&result);
        session.reader.utf8_pending = pending;
        Ok(text)
    }

    pub fn resize_session(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| "Session not found".to_string())?;

        let session = session.lock().map_err(|e| format!("Lock error: {}", e))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize error: {}", e))?;
        Ok(())
    }

    pub fn close_session(&mut self, id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.remove(id) {
            if let Ok(mut session) = session.lock() {
                session.kill_child();
            }
        }
        Ok(())
    }

    pub fn has_session(&self, id: &str) -> bool {
        self.sessions.contains_key(id)
    }

    /// Get a broadcast receiver and replay buffer snapshot for a PTY session (used by WebSocket subscribers).
    /// Returns (replay_data, broadcast_receiver).
    pub fn subscribe_session(&self, id: &str) -> Option<(Vec<u8>, broadcast::Receiver<Vec<u8>>)> {
        let session_arc = self.sessions.get(id)?;
        let session = session_arc.lock().ok()?;
        let replay = session
            .replay_buffer
            .lock()
            .ok()
            .map(|rb| rb.iter().copied().collect::<Vec<u8>>())
            .unwrap_or_default();
        let rx = session.broadcast_tx.subscribe();
        Some((replay, rx))
    }

    pub fn close_sessions_by_path_prefix(&mut self, path_prefix: &str) -> Vec<String> {
        let normalized_prefix = path_prefix.replace(['/', '#'], "-");
        let sessions_to_close: Vec<String> = self
            .sessions
            .keys()
            .filter(|id| id.contains(&normalized_prefix))
            .cloned()
            .collect();

        for id in &sessions_to_close {
            if let Some(session) = self.sessions.remove(id) {
                if let Ok(mut session) = session.lock() {
                    session.kill_child();
                }
            }
        }

        sessions_to_close
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::bytes_to_utf8_with_pending;

    #[test]
    fn empty_input() {
        let (text, pending) = bytes_to_utf8_with_pending(&[]);
        assert_eq!(text, "");
        assert!(pending.is_empty());
    }

    #[test]
    fn valid_ascii() {
        let (text, pending) = bytes_to_utf8_with_pending(b"hello world");
        assert_eq!(text, "hello world");
        assert!(pending.is_empty());
    }

    #[test]
    fn valid_multibyte() {
        let input = "你好世界🚀".as_bytes();
        let (text, pending) = bytes_to_utf8_with_pending(input);
        assert_eq!(text, "你好世界🚀");
        assert!(pending.is_empty());
    }

    #[test]
    fn incomplete_2byte_at_end() {
        // 'é' = 0xC3 0xA9 — send only the leading byte
        let (text, pending) = bytes_to_utf8_with_pending(&[b'a', 0xC3]);
        assert_eq!(text, "a");
        assert_eq!(pending, vec![0xC3]);
    }

    #[test]
    fn incomplete_3byte_at_end() {
        // '你' = 0xE4 0xBD 0xA0 — send first 2 bytes
        let (text, pending) = bytes_to_utf8_with_pending(&[b'a', 0xE4, 0xBD]);
        assert_eq!(text, "a");
        assert_eq!(pending, vec![0xE4, 0xBD]);
    }

    #[test]
    fn incomplete_4byte_at_end() {
        // '🚀' = 0xF0 0x9F 0x9A 0x80 — send first 3 bytes
        let (text, pending) = bytes_to_utf8_with_pending(&[b'x', 0xF0, 0x9F, 0x9A]);
        assert_eq!(text, "x");
        assert_eq!(pending, vec![0xF0, 0x9F, 0x9A]);
    }

    #[test]
    fn invalid_byte_in_middle() {
        // 0xFF is never valid UTF-8
        let (text, pending) = bytes_to_utf8_with_pending(&[b'a', 0xFF, b'b']);
        assert_eq!(text, "a\u{FFFD}b");
        assert!(pending.is_empty());
    }

    #[test]
    fn invalid_middle_and_incomplete_end() {
        // Invalid byte in middle + incomplete 3-byte at end
        let (text, pending) = bytes_to_utf8_with_pending(&[b'a', 0xFF, b'b', 0xE4, 0xBD]);
        assert_eq!(text, "a\u{FFFD}b");
        assert_eq!(pending, vec![0xE4, 0xBD]);
    }

    #[test]
    fn sequential_chunks_reassemble() {
        // Simulate '你' (0xE4 0xBD 0xA0) split across two chunks
        let (text1, pending1) = bytes_to_utf8_with_pending(&[0xE4, 0xBD]);
        assert_eq!(text1, "");
        assert_eq!(pending1, vec![0xE4, 0xBD]);

        // Second chunk: prepend pending + remaining byte
        let mut chunk2 = pending1;
        chunk2.push(0xA0);
        let (text2, pending2) = bytes_to_utf8_with_pending(&chunk2);
        assert_eq!(text2, "你");
        assert!(pending2.is_empty());
    }

    #[test]
    fn multiple_invalid_bytes_consecutive() {
        let (text, pending) = bytes_to_utf8_with_pending(&[0xFF, 0xFE, b'a']);
        assert_eq!(text, "\u{FFFD}\u{FFFD}a");
        assert!(pending.is_empty());
    }

    #[test]
    fn only_incomplete_bytes() {
        // Just one leading byte, nothing else
        let (text, pending) = bytes_to_utf8_with_pending(&[0xE4]);
        assert_eq!(text, "");
        assert_eq!(pending, vec![0xE4]);
    }
}
