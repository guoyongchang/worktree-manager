use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty, Child};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::sync::mpsc::{channel, Receiver};
use log;

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

struct PtyReader {
    receiver: Receiver<Vec<u8>>,
}

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    reader: PtyReader,
    child: Box<dyn Child + Send + Sync>,
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

    pub fn create_session(&mut self, id: &str, cwd: &str, cols: u16, rows: u16) -> Result<(), String> {
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
        cmd.env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()));

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
            if let Ok(userprofile) = std::env::var("USERPROFILE") {
                cmd.env("USERPROFILE", userprofile);
            }
            if let Ok(homedrive) = std::env::var("HOMEDRIVE") {
                cmd.env("HOMEDRIVE", homedrive);
            }
            if let Ok(homepath) = std::env::var("HOMEPATH") {
                cmd.env("HOMEPATH", homepath);
            }
        }

        let child = pair.slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Drop slave to avoid blocking
        drop(pair.slave);

        let writer = pair.master.take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        let mut reader = pair.master.try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        // Create channel for async reading
        let (tx, rx) = channel::<Vec<u8>>();

        // Spawn a thread to read from PTY
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
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
            reader: PtyReader { receiver: rx },
            child,
        };

        self.sessions.insert(id.to_string(), Arc::new(Mutex::new(session)));
        Ok(())
    }

    pub fn write_to_session(&self, id: &str, data: &str) -> Result<(), String> {
        let session = self.sessions.get(id)
            .ok_or_else(|| "Session not found".to_string())?;

        let mut session = session.lock().map_err(|e| format!("Lock error: {}", e))?;
        session.writer.write_all(data.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        session.writer.flush()
            .map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    pub fn read_from_session(&self, id: &str) -> Result<String, String> {
        let session = self.sessions.get(id)
            .ok_or_else(|| "Session not found".to_string())?;

        let session = session.lock().map_err(|e| format!("Lock error: {}", e))?;

        // Non-blocking: collect all available data
        let mut result = Vec::new();
        while let Ok(data) = session.reader.receiver.try_recv() {
            result.extend(data);
        }

        Ok(String::from_utf8_lossy(&result).to_string())
    }

    pub fn resize_session(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self.sessions.get(id)
            .ok_or_else(|| "Session not found".to_string())?;

        let session = session.lock().map_err(|e| format!("Lock error: {}", e))?;
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Resize error: {}", e))?;
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

    pub fn close_sessions_by_path_prefix(&mut self, path_prefix: &str) -> Vec<String> {
        let normalized_prefix = path_prefix.replace(['/', '#'], "-");
        let sessions_to_close: Vec<String> = self.sessions
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
