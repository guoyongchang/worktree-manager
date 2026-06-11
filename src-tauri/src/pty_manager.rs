use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::sync::broadcast;

/// Max replay buffer size per session (64 KB)
const REPLAY_BUFFER_CAP: usize = 64 * 1024;
/// Keep up to 8 MB of desktop PTY output so remounted terminals can replay recent data
/// without letting abandoned sessions grow without bound.
const DESKTOP_PENDING_BUFFER_CAP: usize = 8 * 1024 * 1024;
/// Drop desktop reader cursors that have stopped polling so they no longer pin backlog in memory.
const DESKTOP_READER_TTL: Duration = Duration::from_secs(10);

/// Shell integration script directory (set once during app setup)
static SHELL_INTEGRATION_DIR: OnceLock<PathBuf> = OnceLock::new();

#[cfg(target_os = "windows")]
fn resolve_git_bash_path() -> Option<String> {
    let candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let path = format!(r"{}\Programs\Git\bin\bash.exe", local);
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    None
}

fn resolve_shell_from_path_lookup(id: &str) -> Option<String> {
    // First check if it's an absolute path
    if std::path::Path::new(id).is_absolute() && std::path::Path::new(id).exists() {
        return Some(id.to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("which")
            .arg(id)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();
        if let Ok(out) = output {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut command = std::process::Command::new("where");
        command
            .arg(id)
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let output = command.output();
        if let Ok(out) = output {
            if out.status.success() {
                if let Some(path) = String::from_utf8_lossy(&out.stdout).lines().next() {
                    let path = path.trim().to_string();
                    if !path.is_empty() {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}

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

/// Resolve a terminal preference ID to a shell executable path.
/// IDs like "cmd", "powershell", "gitbash", "windowsterminal" come from the frontend settings.
/// If the ID is "auto" or empty, falls back to get_default_shell().
fn resolve_shell_from_id(id: &str) -> String {
    match id {
        "auto" | "" => get_default_shell(),
        #[cfg(target_os = "windows")]
        "cmd" => "cmd.exe".to_string(),
        #[cfg(target_os = "windows")]
        "powershell" => {
            let ps_paths = [
                "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            ];
            for ps in &ps_paths {
                if std::path::Path::new(ps).exists() {
                    return ps.to_string();
                }
            }
            "powershell.exe".to_string()
        }
        #[cfg(target_os = "windows")]
        "gitbash" => resolve_git_bash_path().unwrap_or_else(|| "bash.exe".to_string()),
        #[cfg(target_os = "windows")]
        "bash" => {
            if let Some(path) = resolve_git_bash_path() {
                return path;
            }
            if let Some(path) = resolve_shell_from_path_lookup("bash") {
                return path;
            }
            log::warn!("[pty] Shell 'bash' not found, using default shell");
            get_default_shell()
        }
        #[cfg(not(target_os = "windows"))]
        "pwsh" | "powershell" => {
            log::warn!(
                "[pty] PowerShell shells are only supported on Windows, using default shell"
            );
            get_default_shell()
        }
        // Shell IDs: zsh, bash, fish, nu, pwsh (on Windows) — resolve via PATH lookup.
        // Note: "pwsh" intentionally uses PATH lookup rather than a hardcoded path because
        // PowerShell 7 has many install locations (system-wide, per-user, scoop, winget).
        // "powershell" uses hardcoded paths because Windows PowerShell 5.x is always in
        // System32 and resolving it via `where` is slower and less reliable.
        other => {
            if let Some(path) = resolve_shell_from_path_lookup(other) {
                return path;
            }
            log::warn!("[pty] Shell '{}' not found, using default shell", other);
            get_default_shell()
        }
    }
}

pub(crate) fn requested_shell_path(shell: Option<&str>) -> String {
    match shell {
        Some(s) if !s.is_empty() => resolve_shell_from_id(s),
        _ => get_default_shell(),
    }
}

fn shell_program_name(shell_path: &str) -> String {
    std::path::Path::new(shell_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(shell_path)
        .trim_end_matches(".exe")
        .to_ascii_lowercase()
}

fn shell_startup_args(shell_path: &str) -> &'static [&'static str] {
    match shell_program_name(shell_path).as_str() {
        "zsh" | "bash" | "sh" => &["-i"],
        _ => &[],
    }
}

fn shell_escape_single_quote(s: &str) -> String {
    s.replace('\'', "'\\''")
}

fn append_bash_integration_args(args: &mut Vec<String>, init_file: String) {
    args.retain(|arg| arg != "-i");
    args.push("--init-file".to_string());
    args.push(init_file);
    args.push("-i".to_string());
}

/// Convert a Windows path string to a Git Bash-compatible Unix-style path.
/// Strips the `\\?\` long-path prefix then converts `C:\...` to `/c/...`.
fn windows_path_to_git_bash(path_str: &str) -> String {
    // Remove Windows long path prefix \\?\ which Git Bash cannot handle.
    let path_str = path_str.strip_prefix(r"\\?\").unwrap_or(path_str);

    // Convert Windows drive path to Unix-style path for Git Bash.
    // C:\path\to\file -> /c/path/to/file
    let mut chars = path_str.char_indices();
    if let (Some((_, drive)), Some((colon_idx, ':'))) = (chars.next(), chars.next()) {
        if drive.is_ascii_alphabetic() {
            let rest_start = colon_idx + ':'.len_utf8();
            let rest = path_str[rest_start..].replace('\\', "/");
            return format!("/{}{}", drive.to_ascii_lowercase(), rest);
        }
    }

    path_str.replace('\\', "/")
}

fn bash_integration_init_path(integration_dir: &Path) -> Option<String> {
    let init_file = integration_dir.join("bash-init.sh");
    log::info!(
        "[shell-integration] bash init_file exists: {}, path: {:?}",
        init_file.exists(),
        init_file
    );
    if !init_file.exists() {
        return None;
    }

    let path_str = init_file.to_str()?;
    Some(windows_path_to_git_bash(path_str))
}

fn get_zsh_integration_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("worktree-manager")
        .join("shell-integration")
        .join("zsh")
}

#[cfg(target_os = "windows")]
fn powershell_integration_args(script: &Path) -> Option<Vec<String>> {
    let path_str = script.to_str()?;
    // Remove Windows long path prefix \\?\ — neither PowerShell 5.x nor 7+
    // reliably supports it inside dot-source (. operator) invocations.
    let path_str = path_str.strip_prefix(r"\\?\").unwrap_or(path_str);
    let escaped = path_str.replace('\'', "''");
    Some(vec![
        "-noexit".to_string(),
        "-nologo".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-command".to_string(),
        format!(". '{}'", escaped),
    ])
}

/// Initialize shell integration: store resource path and generate zsh ZDOTDIR wrappers.
/// Called once during app setup.
pub fn init_shell_integration(resource_dir: PathBuf) {
    let integration_dir = resource_dir.join("shell-integration");
    if !integration_dir.exists() {
        log::warn!(
            "[shell-integration] Resource directory not found: {:?}",
            integration_dir
        );
        return;
    }

    SHELL_INTEGRATION_DIR.set(integration_dir.clone()).ok();

    // Generate zsh ZDOTDIR wrapper files
    let zsh_dir = get_zsh_integration_dir();
    if let Err(e) = std::fs::create_dir_all(&zsh_dir) {
        log::warn!(
            "[shell-integration] Failed to create zsh wrapper dir: {}",
            e
        );
        return;
    }

    let escaped_path = shell_escape_single_quote(integration_dir.to_str().unwrap_or_default());

    // Generate .zshenv — sources user's original .zshenv
    let zshenv_content = "# worktree-manager zsh env wrapper\n\
        # Source user's .zshenv from original ZDOTDIR\n\
        [ -f \"${_WM_ORIG_ZDOTDIR}/.zshenv\" ] && source \"${_WM_ORIG_ZDOTDIR}/.zshenv\"\n";
    if let Err(e) = std::fs::write(zsh_dir.join(".zshenv"), zshenv_content) {
        log::warn!("[shell-integration] Failed to write .zshenv wrapper: {}", e);
        return;
    }

    // Generate .zshrc — sources user's .zshrc then shell integration
    let zshrc_content = format!(
        "# worktree-manager zsh init wrapper\n\
        # Restore original ZDOTDIR and source user's config\n\n\
        _WM_ZDOTDIR=\"${{ZDOTDIR}}\"\n\
        ZDOTDIR=\"${{_WM_ORIG_ZDOTDIR}}\"\n\n\
        # Source user's .zshrc from original ZDOTDIR\n\
        [ -f \"$ZDOTDIR/.zshrc\" ] && source \"$ZDOTDIR/.zshrc\"\n\n\
        # Source shell integration from Tauri resource directory\n\
        source '{}/zsh-integration.sh' 2>/dev/null\n",
        escaped_path
    );
    if let Err(e) = std::fs::write(zsh_dir.join(".zshrc"), zshrc_content) {
        log::warn!("[shell-integration] Failed to write .zshrc wrapper: {}", e);
    }

    log::info!(
        "[shell-integration] Initialized, scripts at {:?}",
        integration_dir
    );
}

/// Configure a PTY command for shell integration based on shell type.
fn setup_shell_integration(cmd: &mut CommandBuilder, shell_path: &str, args: &mut Vec<String>) {
    let integration_dir = match SHELL_INTEGRATION_DIR.get() {
        Some(dir) if dir.exists() => dir,
        _ => return,
    };

    let config = crate::config::load_global_config();
    if !config.shell_integration_enabled {
        return;
    }

    cmd.env("TERM_PROGRAM", "worktree-manager");
    cmd.env("WORKTREE_MANAGER_SHELL_INTEGRATION", "1");

    match shell_program_name(shell_path).as_str() {
        "bash" => {
            if let Some(unix_path) = bash_integration_init_path(integration_dir) {
                log::info!(
                    "[shell-integration] Adding bash args: --init-file {} -i",
                    unix_path
                );
                append_bash_integration_args(args, unix_path);
            } else {
                log::warn!("[shell-integration] Failed to resolve bash init file path");
            }
        }
        "zsh" => {
            let zdotdir = get_zsh_integration_dir();
            if zdotdir.exists() {
                let orig_zdotdir = std::env::var("ZDOTDIR")
                    .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_default());
                cmd.env("_WM_ORIG_ZDOTDIR", &orig_zdotdir);
                if let Some(dir_str) = zdotdir.to_str() {
                    cmd.env("ZDOTDIR", dir_str);
                }
            }
        }
        #[cfg(target_os = "windows")]
        "pwsh" | "powershell" => {
            let script = integration_dir.join("pwsh-integration.ps1");
            if script.exists() {
                if let Some(script_args) = powershell_integration_args(&script) {
                    args.extend(script_args);
                }
            }
        }
        _ => {}
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

struct DesktopReaderState {
    offset: u64,
    utf8_pending: Vec<u8>,
    last_read_at: Instant,
}

impl DesktopReaderState {
    fn new(offset: u64, now: Instant) -> Self {
        Self {
            offset,
            utf8_pending: Vec::new(),
            last_read_at: now,
        }
    }
}

struct DesktopPendingBuffer {
    bytes: VecDeque<u8>,
    start_offset: u64,
    end_offset: u64,
    readers: HashMap<String, DesktopReaderState>,
}

impl DesktopPendingBuffer {
    fn new() -> Self {
        Self {
            bytes: VecDeque::new(),
            start_offset: 0,
            end_offset: 0,
            readers: HashMap::new(),
        }
    }

    fn append(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        self.cleanup_stale_readers();
        self.bytes.extend(data.iter().copied());
        self.end_offset += data.len() as u64;
        self.compact();
    }

    fn read_for_reader(&mut self, reader_id: &str) -> Vec<u8> {
        self.cleanup_stale_readers();
        let now = Instant::now();
        let start_offset = self.start_offset;
        let end_offset = self.end_offset;
        let reader = self
            .readers
            .entry(reader_id.to_string())
            .or_insert_with(|| DesktopReaderState::new(start_offset, now));

        if reader.offset < start_offset {
            reader.offset = start_offset;
            reader.utf8_pending.clear();
        }

        let skip = (reader.offset.saturating_sub(start_offset)) as usize;
        let mut result = std::mem::take(&mut reader.utf8_pending);
        result.extend(self.bytes.iter().skip(skip).copied());
        reader.offset = end_offset;
        reader.last_read_at = now;

        self.compact();
        result
    }

    fn store_utf8_pending(&mut self, reader_id: &str, pending: Vec<u8>) {
        if let Some(reader) = self.readers.get_mut(reader_id) {
            reader.utf8_pending = pending;
            reader.last_read_at = Instant::now();
        }
    }

    fn cleanup_stale_readers(&mut self) {
        self.readers
            .retain(|_, reader| reader.last_read_at.elapsed() < DESKTOP_READER_TTL);
    }

    fn compact(&mut self) {
        let retain_from = self
            .readers
            .values()
            .map(|reader| reader.offset)
            .min()
            .unwrap_or_else(|| {
                self.end_offset
                    .saturating_sub(DESKTOP_PENDING_BUFFER_CAP as u64)
            });

        if retain_from > self.start_offset {
            let drop_len = (retain_from - self.start_offset) as usize;
            self.bytes.drain(..drop_len);
            self.start_offset = retain_from;
        }

        if self.bytes.len() > DESKTOP_PENDING_BUFFER_CAP {
            let drop_len = self.bytes.len() - DESKTOP_PENDING_BUFFER_CAP;
            self.bytes.drain(..drop_len);
            self.start_offset += drop_len as u64;
        }

        for reader in self.readers.values_mut() {
            if reader.offset < self.start_offset {
                reader.offset = self.start_offset;
                reader.utf8_pending.clear();
            }
        }
    }
}

struct PtyReader {
    desktop_buffer: Arc<Mutex<DesktopPendingBuffer>>,
}

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    reader: PtyReader,
    child: Box<dyn Child + Send + Sync>,
    shell_path: String,
    broadcast_tx: broadcast::Sender<Vec<u8>>,
    /// Ring buffer of recent PTY output for replaying to new subscribers.
    replay_buffer: Arc<Mutex<VecDeque<u8>>>,
}

impl PtySession {
    /// Kill the child process and wait for it to exit with a timeout.
    /// Uses try_wait to avoid blocking the calling thread indefinitely.
    fn kill_and_wait(&mut self) {
        let _ = self.child.kill();
        let start = Instant::now();
        let timeout = Duration::from_secs(2);
        while start.elapsed() < timeout {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(_) => return,
            }
        }
        log::warn!("[pty] kill_and_wait timed out after 2s");
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        // Do NOT block on wait() here — Drop may run on the main thread.
        // Just send the kill signal; the process will exit on its own.
        let _ = self.child.kill();
    }
}

pub struct PtyManager {
    sessions: RwLock<HashMap<String, Arc<Mutex<PtySession>>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub fn create_session(
        &mut self,
        id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        shell: Option<&str>,
    ) -> Result<(), String> {
        // Properly close existing session if any
        if self.has_session(id) {
            log::warn!(
                "[pty] create_session: session '{}' already exists, closing before re-create",
                id
            );
            self.close_session(id, "create_session: replacing existing")?;
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

        // Use user-specified shell or fall back to default
        let shell_path = requested_shell_path(shell);
        log::info!("PTY session '{}' using shell: {}", id, shell_path);

        let mut cmd = CommandBuilder::new(&shell_path);

        // Collect all args first, then add them together
        let mut args = Vec::new();
        for arg in shell_startup_args(&shell_path) {
            args.push(arg.to_string());
        }

        cmd.cwd(cwd);
        setup_shell_integration(&mut cmd, &shell_path, &mut args);

        // Add all args at once
        for arg in &args {
            cmd.arg(arg);
        }

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

        let desktop_pending_buffer = Arc::new(Mutex::new(DesktopPendingBuffer::new()));
        let desktop_pending_clone = desktop_pending_buffer.clone();

        // Create broadcast channel for WebSocket subscribers
        let (broadcast_tx, _) = broadcast::channel::<Vec<u8>>(256);
        let broadcast_tx_clone = broadcast_tx.clone();

        // Replay buffer shared with reader thread
        let replay_buffer: Arc<Mutex<VecDeque<u8>>> =
            Arc::new(Mutex::new(VecDeque::with_capacity(REPLAY_BUFFER_CAP)));
        let replay_buf_clone = replay_buffer.clone();
        let session_id = id.to_string();

        // Spawn a thread to read from PTY
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut event_utf8_pending: Vec<u8> = Vec::new();
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
                        // Desktop readers consume per-client cursors from a shared backlog
                        // so multiple windows do not steal output from each other.
                        if let Ok(mut pending) = desktop_pending_clone.lock() {
                            pending.append(&data);
                        }

                        // Desktop event push path: emit UTF-8 text chunks to all windows.
                        let combined = if event_utf8_pending.is_empty() {
                            data
                        } else {
                            let mut combined = std::mem::take(&mut event_utf8_pending);
                            combined.extend(data);
                            combined
                        };
                        let (text, pending) = bytes_to_utf8_with_pending(&combined);
                        event_utf8_pending = pending;
                        if !text.is_empty() {
                            if let Some(handle) =
                                crate::state::APP_HANDLE.lock().ok().and_then(|h| h.clone())
                            {
                                let _ = handle.emit(
                                    "pty-output",
                                    serde_json::json!({
                                        "sessionId": session_id,
                                        "data": text,
                                    }),
                                );
                            }
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
                desktop_buffer: desktop_pending_buffer,
            },
            child,
            shell_path,
            broadcast_tx,
            replay_buffer,
        };

        self.sessions
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id.to_string(), Arc::new(Mutex::new(session)));
        log::info!(
            "[pty] Session '{}' created successfully. Total active sessions: {}",
            id,
            self.sessions
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .len()
        );
        Ok(())
    }

    pub fn write_to_session(&self, id: &str, data: &str) -> Result<(), String> {
        let sessions = self
            .sessions
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let session = sessions.get(id).ok_or_else(|| {
            let active: Vec<&String> = sessions.keys().collect();
            log::warn!(
                "[pty] write_to_session: session '{}' not found. Active sessions ({}) = {:?}",
                id,
                active.len(),
                active
            );
            "Session not found".to_string()
        })?;

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

    pub fn read_from_session(&self, id: &str, reader_id: Option<&str>) -> Result<String, String> {
        let sessions = self
            .sessions
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let session_arc = sessions.get(id).ok_or_else(|| {
            let active: Vec<&String> = sessions.keys().collect();
            log::warn!(
                "[pty] read_from_session: session '{}' not found. Active sessions ({}) = {:?}",
                id,
                active.len(),
                active
            );
            "Session not found".to_string()
        })?;

        let session = session_arc
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let reader_key = reader_id.unwrap_or(id);

        // Non-blocking: replay only this reader's unread bytes.
        let mut pending = session
            .reader
            .desktop_buffer
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let result = pending.read_for_reader(reader_key);
        drop(pending);

        let (text, pending) = bytes_to_utf8_with_pending(&result);
        session
            .reader
            .desktop_buffer
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?
            .store_utf8_pending(reader_key, pending);
        Ok(text)
    }

    pub fn resize_session(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self
            .sessions
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let session_arc = sessions.get(id).ok_or_else(|| {
            log::warn!("[pty] resize_session: session '{}' not found", id);
            "Session not found".to_string()
        })?;

        let session = session_arc
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
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

    pub fn close_session(&mut self, id: &str, reason: &str) -> Result<(), String> {
        let removed = self
            .sessions
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(id);
        if let Some(session) = removed {
            let remaining = self
                .sessions
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .len();
            log::info!(
                "[pty] Closing session '{}', reason: '{}'. Remaining sessions: {}",
                id,
                reason,
                remaining
            );
            // Spawn a background thread so the main thread never blocks on child.wait().
            std::thread::spawn(move || {
                if let Ok(mut session) = session.lock() {
                    session.kill_and_wait();
                }
                // session Arc is dropped here → Drop::drop runs, but only does kill()
            });
        } else {
            log::warn!(
                "[pty] close_session called for '{}' but not found, reason: '{}'",
                id,
                reason
            );
        }
        Ok(())
    }

    pub fn has_session(&self, id: &str) -> bool {
        self.sessions
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains_key(id)
    }

    pub fn session_shell_path(&self, id: &str) -> Option<String> {
        let sessions = self
            .sessions
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        sessions
            .get(id)
            .and_then(|session| session.lock().ok())
            .map(|session| session.shell_path.clone())
    }

    pub fn session_count(&self) -> usize {
        self.sessions
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }

    /// Get a broadcast receiver and replay buffer snapshot for a PTY session (used by WebSocket subscribers).
    /// Returns (replay_data, broadcast_receiver).
    pub fn subscribe_session(&self, id: &str) -> Option<(Vec<u8>, broadcast::Receiver<Vec<u8>>)> {
        let sessions = self
            .sessions
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let session_arc = sessions.get(id)?;
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

    pub fn close_sessions_by_path_prefix(
        &mut self,
        path_prefix: &str,
        reason: &str,
    ) -> Vec<String> {
        let normalized_prefix = path_prefix.replace(['/', '\\', '#'], "-");
        // NOTE: session IDs are created by frontend as `pty-{normalized-path}` (no trailing -#)
        let session_prefix = format!("pty-{}", normalized_prefix);

        // Collect IDs under read lock, then drop guard before write lock
        let sessions_to_close: Vec<String> = {
            let sessions = self
                .sessions
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            sessions
                .keys()
                .filter(|id| {
                    // Exact match or followed by '-' to avoid matching /path/project-extra
                    // when closing /path/project
                    **id == session_prefix || id.starts_with(&format!("{}-", session_prefix))
                })
                .cloned()
                .collect()
        }; // read guard dropped here

        if !sessions_to_close.is_empty() {
            log::info!(
                "[pty] Closing {} sessions by path prefix '{}' (normalized: '{}'), reason: '{}', sessions: {:?}",
                sessions_to_close.len(),
                path_prefix,
                normalized_prefix,
                reason,
                sessions_to_close
            );
        }

        // Now acquire write lock separately and move cleanup to background threads
        for id in &sessions_to_close {
            if let Some(session) = self
                .sessions
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(id)
            {
                std::thread::spawn(move || {
                    if let Ok(mut session) = session.lock() {
                        session.kill_and_wait();
                    }
                });
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
    #[cfg(target_os = "windows")]
    use super::powershell_integration_args;
    use super::{
        append_bash_integration_args, bash_integration_init_path, bytes_to_utf8_with_pending,
        get_default_shell, requested_shell_path, resolve_shell_from_id,
        resolve_shell_from_path_lookup, shell_escape_single_quote, shell_program_name,
        shell_startup_args, windows_path_to_git_bash, DesktopPendingBuffer, PtyManager,
        DESKTOP_PENDING_BUFFER_CAP, DESKTOP_READER_TTL,
    };
    use serial_test::serial;
    #[cfg(target_os = "windows")]
    use std::path::Path;
    use std::time::{Duration, Instant};

    #[serial]
    #[test]
    fn empty_input() {
        let (text, pending) = bytes_to_utf8_with_pending(&[]);
        assert_eq!(text, "");
        assert!(pending.is_empty());
    }

    #[serial]
    #[test]
    fn valid_ascii() {
        let (text, pending) = bytes_to_utf8_with_pending(b"hello world");
        assert_eq!(text, "hello world");
        assert!(pending.is_empty());
    }

    #[serial]
    #[test]
    fn valid_multibyte() {
        let input = "你好世界🚀".as_bytes();
        let (text, pending) = bytes_to_utf8_with_pending(input);
        assert_eq!(text, "你好世界🚀");
        assert!(pending.is_empty());
    }

    #[serial]
    #[test]
    fn incomplete_2byte_at_end() {
        // 'é' = 0xC3 0xA9 — send only the leading byte
        let (text, pending) = bytes_to_utf8_with_pending(&[b'a', 0xC3]);
        assert_eq!(text, "a");
        assert_eq!(pending, vec![0xC3]);
    }

    #[serial]
    #[test]
    fn incomplete_3byte_at_end() {
        // '你' = 0xE4 0xBD 0xA0 — send first 2 bytes
        let (text, pending) = bytes_to_utf8_with_pending(&[b'a', 0xE4, 0xBD]);
        assert_eq!(text, "a");
        assert_eq!(pending, vec![0xE4, 0xBD]);
    }

    #[serial]
    #[test]
    fn incomplete_4byte_at_end() {
        // '🚀' = 0xF0 0x9F 0x9A 0x80 — send first 3 bytes
        let (text, pending) = bytes_to_utf8_with_pending(&[b'x', 0xF0, 0x9F, 0x9A]);
        assert_eq!(text, "x");
        assert_eq!(pending, vec![0xF0, 0x9F, 0x9A]);
    }

    #[serial]
    #[test]
    fn invalid_byte_in_middle() {
        // 0xFF is never valid UTF-8
        let (text, pending) = bytes_to_utf8_with_pending(&[b'a', 0xFF, b'b']);
        assert_eq!(text, "a\u{FFFD}b");
        assert!(pending.is_empty());
    }

    #[serial]
    #[test]
    fn invalid_middle_and_incomplete_end() {
        // Invalid byte in middle + incomplete 3-byte at end
        let (text, pending) = bytes_to_utf8_with_pending(&[b'a', 0xFF, b'b', 0xE4, 0xBD]);
        assert_eq!(text, "a\u{FFFD}b");
        assert_eq!(pending, vec![0xE4, 0xBD]);
    }

    #[serial]
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

    #[serial]
    #[test]
    fn multiple_invalid_bytes_consecutive() {
        let (text, pending) = bytes_to_utf8_with_pending(&[0xFF, 0xFE, b'a']);
        assert_eq!(text, "\u{FFFD}\u{FFFD}a");
        assert!(pending.is_empty());
    }

    #[serial]
    #[test]
    fn only_incomplete_bytes() {
        // Just one leading byte, nothing else
        let (text, pending) = bytes_to_utf8_with_pending(&[0xE4]);
        assert_eq!(text, "");
        assert_eq!(pending, vec![0xE4]);
    }

    #[serial]
    #[test]
    fn zsh_uses_interactive_startup() {
        assert_eq!(shell_startup_args("/bin/zsh"), &["-i"]);
    }

    #[serial]
    #[test]
    fn bash_uses_interactive_startup() {
        assert_eq!(shell_startup_args("/bin/bash"), &["-i"]);
    }

    #[serial]
    #[test]
    fn pwsh_uses_default_startup_args() {
        assert_eq!(shell_startup_args("pwsh"), &[] as &[&str]);
    }

    #[cfg(target_os = "windows")]
    #[serial]
    #[test]
    fn powershell_integration_args_bypass_process_execution_policy() {
        let script = Path::new(r"\\?\C:\Users\O'Brien\pwsh-integration.ps1");
        let args = powershell_integration_args(script).unwrap();
        // \\?\ prefix must be stripped: neither PS 5.x nor 7+ handles it
        // reliably inside dot-source invocations.
        assert_eq!(
            args,
            vec![
                "-noexit",
                "-nologo",
                "-ExecutionPolicy",
                "Bypass",
                "-command",
                r". 'C:\Users\O''Brien\pwsh-integration.ps1'",
            ]
        );
    }

    #[serial]
    #[test]
    fn requested_shell_keeps_explicit_existing_absolute_path() {
        let exe = std::env::current_exe().unwrap();
        let exe_str = exe.to_string_lossy().to_string();
        assert_eq!(requested_shell_path(Some(&exe_str)), exe_str);
    }

    #[serial]
    #[test]
    fn shell_resolution_handles_auto_missing_and_path_lookup_cases() {
        let default_shell = get_default_shell();

        assert_eq!(requested_shell_path(None), default_shell);
        assert_eq!(resolve_shell_from_id(""), get_default_shell());
        assert_eq!(resolve_shell_from_id("auto"), get_default_shell());
        assert_eq!(
            resolve_shell_from_id("__worktree_manager_missing_shell__"),
            get_default_shell()
        );
        assert!(resolve_shell_from_path_lookup("__worktree_manager_missing_shell__").is_none());

        #[cfg(not(target_os = "windows"))]
        assert_eq!(
            resolve_shell_from_path_lookup("/bin/sh"),
            Some("/bin/sh".to_string())
        );
    }

    #[cfg(target_os = "windows")]
    #[serial]
    #[test]
    fn requested_shell_uses_git_bash_path_for_bash_id_when_available() {
        if let Some(git_bash) = super::resolve_git_bash_path() {
            assert_eq!(requested_shell_path(Some("bash")), git_bash);
        }
    }

    #[serial]
    #[test]
    fn bash_integration_args_put_init_file_before_interactive_flag() {
        let mut args = vec!["-i".to_string()];
        append_bash_integration_args(&mut args, "/tmp/bash-init.sh".to_string());
        assert_eq!(args, vec!["--init-file", "/tmp/bash-init.sh", "-i"]);
    }

    #[serial]
    #[test]
    fn bash_integration_init_path_requires_existing_file_and_returns_shell_path() {
        let temp = tempfile::tempdir().expect("temp integration dir");

        assert_eq!(bash_integration_init_path(temp.path()), None);

        let init_file = temp.path().join("bash-init.sh");
        std::fs::write(&init_file, "echo init").expect("write bash init");
        let path = bash_integration_init_path(temp.path()).expect("bash init path");

        assert!(path.ends_with("/bash-init.sh") || path.ends_with("\\bash-init.sh"));
        assert!(!path.contains(r"\\?\"));
    }

    #[serial]
    #[test]
    fn windows_path_strips_long_path_prefix_and_converts_drive() {
        assert_eq!(
            windows_path_to_git_bash(r"\\?\C:\Users\test\bash-init.sh"),
            "/c/Users/test/bash-init.sh"
        );
    }

    #[serial]
    #[test]
    fn windows_path_converts_drive_without_long_prefix() {
        assert_eq!(
            windows_path_to_git_bash(r"C:\Users\test\bash-init.sh"),
            "/c/Users/test/bash-init.sh"
        );
    }

    #[serial]
    #[test]
    fn windows_path_preserves_unix_style_path_unchanged() {
        assert_eq!(
            windows_path_to_git_bash("/tmp/bash-init.sh"),
            "/tmp/bash-init.sh"
        );
    }

    #[serial]
    #[test]
    fn windows_path_converts_uppercase_drive_letter_to_lowercase() {
        assert_eq!(
            windows_path_to_git_bash(r"D:\Work\project\bash-init.sh"),
            "/d/Work/project/bash-init.sh"
        );
    }

    #[serial]
    #[test]
    fn windows_path_with_multibyte_first_character_does_not_panic() {
        let converted = std::panic::catch_unwind(|| windows_path_to_git_bash(r"好:\Users\test"));

        assert_eq!(converted.unwrap(), "好:/Users/test");
    }

    #[serial]
    #[test]
    fn new_manager_reports_empty_session_state_without_spawning() {
        let manager = PtyManager::new();

        assert_eq!(manager.session_count(), 0);
        assert!(!manager.has_session("missing"));
        assert_eq!(manager.session_shell_path("missing"), None);
        assert!(manager.subscribe_session("missing").is_none());
    }

    #[serial]
    #[test]
    fn missing_session_operations_return_errors_and_keep_count_zero() {
        let mut manager = PtyManager::new();

        let write_err = manager
            .write_to_session("missing", "input")
            .expect_err("write should fail");
        let read_err = manager
            .read_from_session("missing", Some("reader"))
            .expect_err("read should fail");
        let resize_err = manager
            .resize_session("missing", 80, 24)
            .expect_err("resize should fail");
        manager
            .close_session("missing", "unit test")
            .expect("closing missing session is allowed");

        assert_eq!(write_err, "Session not found");
        assert_eq!(read_err, "Session not found");
        assert_eq!(resize_err, "Session not found");
        assert_eq!(manager.session_count(), 0);
    }

    #[serial]
    #[test]
    fn close_sessions_by_path_prefix_empty_manager_returns_no_sessions() {
        let mut manager = PtyManager::new();

        let closed = manager.close_sessions_by_path_prefix("/tmp/worktree", "unit test");

        assert!(closed.is_empty());
        assert_eq!(manager.session_count(), 0);
    }

    #[serial]
    #[test]
    fn desktop_pending_buffer_compacts_to_capacity_without_readers() {
        let mut buffer = DesktopPendingBuffer::new();
        let data = vec![b'x'; DESKTOP_PENDING_BUFFER_CAP + 17];

        buffer.append(&data);

        assert_eq!(buffer.bytes.len(), DESKTOP_PENDING_BUFFER_CAP);
        assert_eq!(buffer.start_offset, 17);
        assert_eq!(buffer.end_offset, (DESKTOP_PENDING_BUFFER_CAP + 17) as u64);
        assert!(buffer.readers.is_empty());
    }

    #[serial]
    #[test]
    fn desktop_pending_buffer_resets_reader_that_fell_behind_start_offset() {
        let mut buffer = DesktopPendingBuffer::new();
        assert!(buffer.read_for_reader("reader").is_empty());
        buffer.append(b"abcdef");
        buffer.store_utf8_pending("reader", vec![0xE4, 0xBD]);

        buffer.bytes.drain(..3);
        buffer.start_offset = 3;
        buffer.readers.get_mut("reader").unwrap().offset = 1;
        let replay = buffer.read_for_reader("reader");

        assert_eq!(replay, b"def");
        assert!(buffer
            .readers
            .get("reader")
            .unwrap()
            .utf8_pending
            .is_empty());
    }

    #[serial]
    #[test]
    fn desktop_pending_buffer_discards_stale_reader_before_append_and_compact() {
        let mut buffer = DesktopPendingBuffer::new();
        assert!(buffer.read_for_reader("stale").is_empty());
        buffer.append(b"old");
        buffer.readers.get_mut("stale").unwrap().last_read_at =
            Instant::now() - DESKTOP_READER_TTL - Duration::from_secs(1);

        buffer.append(b"new");

        assert!(!buffer.readers.contains_key("stale"));
        assert_eq!(buffer.start_offset, 0);
        assert_eq!(buffer.end_offset, 6);
        assert_eq!(buffer.bytes.iter().copied().collect::<Vec<_>>(), b"oldnew");
    }

    #[serial]
    #[test]
    fn desktop_pending_buffer_tracks_independent_reader_offsets() {
        let mut buffer = DesktopPendingBuffer::new();

        assert!(buffer.read_for_reader("reader-a").is_empty());
        assert!(buffer.read_for_reader("reader-b").is_empty());
        buffer.append(b"abc");
        let first_a = buffer.read_for_reader("reader-a");
        let first_b = buffer.read_for_reader("reader-b");
        let second_a = buffer.read_for_reader("reader-a");
        buffer.append(b"de");
        let third_a = buffer.read_for_reader("reader-a");
        let second_b = buffer.read_for_reader("reader-b");

        assert_eq!(first_a, b"abc");
        assert_eq!(first_b, b"abc");
        assert!(second_a.is_empty());
        assert_eq!(third_a, b"de");
        assert_eq!(second_b, b"de");
    }

    #[serial]
    #[test]
    fn desktop_pending_buffer_prepends_pending_utf8_bytes_for_reader() {
        let mut buffer = DesktopPendingBuffer::new();

        buffer.append(&[0xE4, 0xBD]);
        let first = buffer.read_for_reader("reader");
        buffer.store_utf8_pending("reader", first);
        buffer.append(&[0xA0, b'!']);
        let second = buffer.read_for_reader("reader");

        assert_eq!(second, vec![0xE4, 0xBD, 0xA0, b'!']);
    }

    #[serial]
    #[test]
    fn shell_name_and_quote_helpers_handle_paths_and_single_quotes() {
        assert_eq!(shell_program_name("/bin/zsh"), "zsh");
        assert_eq!(shell_program_name("/opt/pwsh.exe"), "pwsh");
        assert_eq!(
            shell_escape_single_quote("/tmp/O'Brien/init.sh"),
            "/tmp/O'\\''Brien/init.sh"
        );
    }

    #[cfg(not(target_os = "windows"))]
    fn unique_session_id(name: &str) -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("pty-manager-test-{}-{}-{nanos}", std::process::id(), name)
    }

    #[cfg(not(target_os = "windows"))]
    fn wait_for_output(manager: &PtyManager, id: &str, reader: &str, needle: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut collected = String::new();
        while Instant::now() < deadline {
            let chunk = manager
                .read_from_session(id, Some(reader))
                .expect("read pty session");
            collected.push_str(&chunk);
            if collected.contains(needle) {
                return collected;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("timed out waiting for {needle:?}; collected {collected:?}");
    }

    #[cfg(not(target_os = "windows"))]
    #[serial]
    #[test]
    fn pty_manager_creates_reads_subscribes_resizes_and_closes_short_shell() {
        if !std::path::Path::new("/bin/sh").exists() {
            // Unix CI images should have /bin/sh; skip only on unusual local systems.
            return;
        }
        let mut manager = PtyManager::new();
        let cwd = tempfile::tempdir().expect("pty cwd");
        let id = unique_session_id("lifecycle");

        manager
            .create_session(&id, cwd.path().to_str().unwrap(), 80, 24, Some("/bin/sh"))
            .expect("create pty session");
        assert_eq!(manager.session_count(), 1);
        assert!(manager.has_session(&id));
        assert_eq!(manager.session_shell_path(&id), Some("/bin/sh".to_string()));
        assert!(manager.subscribe_session(&id).is_some());

        manager
            .write_to_session(&id, "printf WM_PTY_OK; exit\n")
            .expect("write shell command");
        let output = wait_for_output(&manager, &id, "reader-a", "WM_PTY_OK");
        assert!(output.contains("WM_PTY_OK"));
        manager
            .resize_session(&id, 100, 30)
            .expect("resize session");

        let (replay, _) = manager.subscribe_session(&id).expect("subscribe session");
        assert!(
            String::from_utf8_lossy(&replay).contains("WM_PTY_OK"),
            "replay was {:?}",
            String::from_utf8_lossy(&replay)
        );
        manager
            .close_session(&id, "unit test complete")
            .expect("close session");
        assert_eq!(manager.session_count(), 0);
        assert!(!manager.has_session(&id));
    }

    #[cfg(not(target_os = "windows"))]
    #[serial]
    #[test]
    fn pty_manager_replaces_existing_session_with_same_id() {
        if !std::path::Path::new("/bin/sh").exists() {
            // Unix CI images should have /bin/sh; skip only on unusual local systems.
            return;
        }
        let mut manager = PtyManager::new();
        let cwd = tempfile::tempdir().expect("pty cwd");
        let id = unique_session_id("replace");

        manager
            .create_session(&id, cwd.path().to_str().unwrap(), 80, 24, Some("/bin/sh"))
            .expect("create first session");
        manager
            .create_session(&id, cwd.path().to_str().unwrap(), 90, 25, Some("/bin/sh"))
            .expect("replace session");

        assert_eq!(manager.session_count(), 1);
        assert!(manager.has_session(&id));
        manager.close_session(&id, "unit test cleanup").unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[serial]
    #[test]
    fn close_sessions_by_path_prefix_closes_exact_and_child_session_ids() {
        if !std::path::Path::new("/bin/sh").exists() {
            // Unix CI images should have /bin/sh; skip only on unusual local systems.
            return;
        }
        let mut manager = PtyManager::new();
        let cwd = tempfile::tempdir().expect("pty cwd");
        let prefix = cwd.path().to_string_lossy().replace(['/', '\\', '#'], "-");
        let exact_id = format!("pty-{}", prefix);
        let child_id = format!("pty-{}-extra", prefix);
        let unrelated_id = unique_session_id("unrelated");

        manager
            .create_session(
                &exact_id,
                cwd.path().to_str().unwrap(),
                80,
                24,
                Some("/bin/sh"),
            )
            .expect("create exact session");
        manager
            .create_session(
                &child_id,
                cwd.path().to_str().unwrap(),
                80,
                24,
                Some("/bin/sh"),
            )
            .expect("create child session");
        manager
            .create_session(
                &unrelated_id,
                cwd.path().to_str().unwrap(),
                80,
                24,
                Some("/bin/sh"),
            )
            .expect("create unrelated session");

        let mut closed =
            manager.close_sessions_by_path_prefix(cwd.path().to_str().unwrap(), "unit test");
        closed.sort();

        assert_eq!(closed, vec![exact_id.clone(), child_id.clone()]);
        assert!(!manager.has_session(&exact_id));
        assert!(!manager.has_session(&child_id));
        assert!(manager.has_session(&unrelated_id));
        manager
            .close_session(&unrelated_id, "unit test cleanup")
            .unwrap();
    }
}
