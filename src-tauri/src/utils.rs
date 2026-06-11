use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::{Command, Output};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use wait_timeout::ChildExt;

use crate::types::ScannedFolder;

// Git command timeout (30 seconds)
pub(crate) const GIT_COMMAND_TIMEOUT_SECS: u64 = 30;

// Custom git path set by user (empty = auto-detect)
static CUSTOM_GIT_PATH: Mutex<String> = Mutex::new(String::new());

/// Set a custom git executable path. Empty string reverts to auto-detect.
pub(crate) fn set_custom_git_path(path: &str) {
    if let Ok(mut p) = CUSTOM_GIT_PATH.lock() {
        *p = path.to_string();
        log::info!("[git] Custom git path set to: '{}'", path);
    }
}

/// Get the resolved git executable path.
fn resolve_git_path() -> String {
    // Check custom path first
    if let Ok(custom) = CUSTOM_GIT_PATH.lock() {
        if !custom.is_empty() {
            return custom.clone();
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::sync::OnceLock;
        static DETECTED_GIT: OnceLock<String> = OnceLock::new();
        DETECTED_GIT
            .get_or_init(|| {
                // Try "git" from PATH first
                #[allow(unused_mut)]
                let mut check = std::process::Command::new("git");
                check
                    .arg("--version")
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null());
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    check.creation_flags(CREATE_NO_WINDOW);
                }
                if check.status().is_ok() {
                    return "git".to_string();
                }
                let candidates = [
                    r"C:\Program Files\Git\cmd\git.exe",
                    r"C:\Program Files (x86)\Git\cmd\git.exe",
                ];
                for path in &candidates {
                    if std::path::Path::new(path).exists() {
                        log::info!("[git] Found git at: {}", path);
                        return path.to_string();
                    }
                }
                if let Ok(local) = std::env::var("LOCALAPPDATA") {
                    let p = format!(r"{}\Programs\Git\cmd\git.exe", local);
                    if std::path::Path::new(&p).exists() {
                        log::info!("[git] Found git at: {}", p);
                        return p;
                    }
                }
                log::warn!("[git] git not found in PATH or common locations, using 'git'");
                "git".to_string()
            })
            .clone()
    }

    #[cfg(not(target_os = "windows"))]
    {
        "git".to_string()
    }
}

/// Get the user's login shell path.
#[allow(dead_code)]
fn get_login_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if Path::new("/bin/zsh").exists() {
            "/bin/zsh".to_string()
        } else if Path::new("/bin/bash").exists() {
            "/bin/bash".to_string()
        } else {
            "/bin/sh".to_string()
        }
    })
}

/// Cache of environment variables loaded from the user's login shell.
/// Only populated on Unix systems where the app may not inherit the user's shell env.
#[allow(dead_code)]
static USER_ENV_CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();

/// Load environment variables by running the user's login shell with `-l -c env`.
/// This captures PATH and other variables set in ~/.zshrc, ~/.bash_profile, etc.
#[allow(dead_code)]
fn load_user_env_from_shell() -> HashMap<String, String> {
    let shell = get_login_shell();
    let output = Command::new(&shell)
        .args(["-l", "-c", "env -0"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    let mut env = HashMap::new();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for entry in stdout.split('\0') {
                if let Some((key, value)) = entry.split_once('=') {
                    env.insert(key.to_string(), value.to_string());
                }
            }
            log::info!(
                "[git] Loaded {} env vars from login shell {}",
                env.len(),
                shell
            );
        }
        Ok(out) => {
            log::warn!(
                "[git] Login shell env dump failed (status: {:?})",
                out.status.code()
            );
        }
        Err(e) => {
            log::warn!("[git] Failed to spawn login shell for env: {}", e);
        }
    }

    env
}

/// Get the full user environment from the login shell (cached).
#[allow(dead_code)]
pub(crate) fn get_user_env() -> &'static HashMap<String, String> {
    USER_ENV_CACHE.get_or_init(load_user_env_from_shell)
}

/// Create a `Command` for git that:
/// - Uses custom path if set, otherwise auto-detects
/// - On Unix: merges user's login shell PATH so hooks can find tools like cargo
/// - Hides the console window on Windows (CREATE_NO_WINDOW)
pub(crate) fn git_command() -> Command {
    let git = resolve_git_path();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new(&git);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new(&git);
        // Merge user's shell PATH so git hooks can find tools (cargo, node, etc.)
        let user_env = get_user_env();
        if let Some(shell_path) = user_env.get("PATH") {
            let current_path = std::env::var("PATH").unwrap_or_default();
            if !shell_path.is_empty() && shell_path != &current_path {
                cmd.env("PATH", format!("{}:{}", shell_path, current_path));
            }
        }
        cmd
    }
}

pub(crate) fn truncate_log_text(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

pub(crate) fn validate_git_ref_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name.starts_with('-')
        || name.contains("..")
        || name.ends_with(".lock")
        || name.chars().any(|ch| ch.is_control() || ch.is_whitespace())
        || name
            .chars()
            .any(|ch| matches!(ch, '~' | '^' | ':' | '?' | '*' | '[' | '\\'))
    {
        return Err("无效的分支名".to_string());
    }

    Ok(())
}

pub(crate) fn mask_url_credentials(text: &str) -> String {
    let mut masked = String::with_capacity(text.len());
    let mut cursor = 0;

    while let Some(relative_scheme_end) = text[cursor..].find("://") {
        let scheme_end = cursor + relative_scheme_end;
        let authority_start = scheme_end + 3;
        masked.push_str(&text[cursor..authority_start]);

        let authority_and_rest = &text[authority_start..];
        let authority_len = authority_and_rest
            .char_indices()
            .find(|(_, ch)| *ch == '/' || ch.is_whitespace())
            .map(|(idx, _)| idx)
            .unwrap_or(authority_and_rest.len());
        let authority = &authority_and_rest[..authority_len];

        if let Some(at_idx) = authority.rfind('@') {
            masked.push_str("***@");
            masked.push_str(&authority[at_idx + 1..]);
        } else {
            masked.push_str(authority);
        }

        cursor = authority_start + authority_len;
    }

    masked.push_str(&text[cursor..]);
    masked
}

fn stderr_for_log(stderr: &[u8]) -> String {
    truncate_log_text(
        &mask_url_credentials(&String::from_utf8_lossy(stderr)),
        2000,
    )
}

fn command_cwd_for_log(cmd: &Command) -> String {
    cmd.get_current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|_| "<unknown>".to_string())
        })
}

fn command_for_log(cmd: &Command) -> String {
    let mut parts = Vec::new();
    parts.push(cmd.get_program().to_string_lossy().to_string());
    parts.extend(cmd.get_args().map(|arg| arg.to_string_lossy().to_string()));
    mask_url_credentials(&parts.join(" "))
}

fn git_args_for_log(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| mask_url_credentials(arg)).collect()
}

fn exit_code_for_log(status: &std::process::ExitStatus) -> String {
    status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "<terminated-by-signal>".to_string())
}

pub(crate) fn run_git_logged(cmd: &mut Command, label: &str) -> std::io::Result<Output> {
    let command = command_for_log(cmd);
    let cwd = command_cwd_for_log(cmd);
    let start = Instant::now();

    log::info!(
        "[git:{}] starting: command='{}', cwd='{}'",
        label,
        command,
        cwd
    );

    match cmd.output() {
        Ok(output) => {
            let elapsed_ms = start.elapsed().as_millis();
            let exit_code = exit_code_for_log(&output.status);
            log::info!(
                "[git:{}] finished: elapsed_ms={}, exit_code={}",
                label,
                elapsed_ms,
                exit_code
            );

            if !output.status.success() {
                log::error!(
                    "[git:{}] failed: command='{}', cwd='{}', elapsed_ms={}, exit_code={}, stderr='{}'",
                    label,
                    command,
                    cwd,
                    elapsed_ms,
                    exit_code,
                    stderr_for_log(&output.stderr)
                );
            }

            Ok(output)
        }
        Err(e) => {
            log::error!(
                "[git:{}] spawn failed: command='{}', cwd='{}', elapsed_ms={}, stderr='<not available: {}>'",
                label,
                command,
                cwd,
                start.elapsed().as_millis(),
                e
            );
            Err(e)
        }
    }
}

pub(crate) fn run_git_command_with_timeout(
    args: &[&str],
    cwd: &str,
) -> Result<std::process::Output, String> {
    let start = Instant::now();
    let args_for_log = git_args_for_log(args);
    log::info!(
        "[git:timeout] starting: args={:?}, cwd='{}'",
        args_for_log,
        cwd
    );

    let mut child = git_command()
        .args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            log::error!(
                "[git:timeout] spawn failed: args={:?}, cwd='{}', elapsed_ms={}, stderr='<not available: {}>'",
                args_for_log,
                cwd,
                start.elapsed().as_millis(),
                e
            );
            format!("Failed to spawn git command: {}", e)
        })?;

    let timeout = Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS);
    match child.wait_timeout(timeout) {
        Ok(Some(status)) => {
            let exit_code = exit_code_for_log(&status);
            let stdout = child
                .stdout
                .take()
                .map(|mut s| {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut s, &mut buf).ok();
                    buf
                })
                .unwrap_or_default();
            let stderr = child
                .stderr
                .take()
                .map(|mut s| {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut s, &mut buf).ok();
                    buf
                })
                .unwrap_or_default();
            let output = std::process::Output {
                status,
                stdout,
                stderr,
            };
            let elapsed_ms = start.elapsed().as_millis();
            log::info!(
                "[git:timeout] finished: args={:?}, cwd='{}', elapsed_ms={}, exit_code={}",
                args_for_log,
                cwd,
                elapsed_ms,
                exit_code
            );
            if !output.status.success() {
                log::error!(
                    "[git:timeout] failed: args={:?}, cwd='{}', elapsed_ms={}, exit_code={}, stderr='{}'",
                    args_for_log,
                    cwd,
                    elapsed_ms,
                    exit_code,
                    stderr_for_log(&output.stderr)
                );
            }
            Ok(output)
        }
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            let stderr = child
                .stderr
                .take()
                .map(|mut s| {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut s, &mut buf).ok();
                    buf
                })
                .unwrap_or_default();
            log::error!(
                "[git:timeout] timed out: args={:?}, cwd='{}', elapsed_ms={}, stderr='{}'",
                args_for_log,
                cwd,
                start.elapsed().as_millis(),
                stderr_for_log(&stderr)
            );
            Err(format!(
                "Git command timed out after {} seconds",
                GIT_COMMAND_TIMEOUT_SECS
            ))
        }
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            let stderr = child
                .stderr
                .take()
                .map(|mut s| {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut s, &mut buf).ok();
                    buf
                })
                .unwrap_or_default();
            log::error!(
                "[git:timeout] wait failed: args={:?}, cwd='{}', elapsed_ms={}, stderr='{}', error={}",
                args_for_log,
                cwd,
                start.elapsed().as_millis(),
                stderr_for_log(&stderr),
                e
            );
            Err(format!("Failed to wait for git command: {}", e))
        }
    }
}

/// Normalize path separators for the current platform.
/// On Windows, replaces forward slashes with backslashes and collapses
/// consecutive backslashes (e.g. `D:\\\\Folder` → `D:\Folder`),
/// while preserving UNC prefixes (`\\server\share`).
pub fn normalize_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        let p = path.replace('/', "\\");
        let is_unc = p.starts_with("\\\\");
        // Collapse all consecutive backslashes into single ones
        let collapsed = collapse_backslashes(&p);
        if is_unc && !collapsed.starts_with("\\\\") {
            // UNC/extended-length path: restore the \\ prefix
            // After collapse, collapsed starts with single '\', add one more
            format!("\\{}", collapsed)
        } else {
            collapsed
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string()
    }
}

/// Replace runs of consecutive backslashes with a single backslash.
#[cfg(target_os = "windows")]
fn collapse_backslashes(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut prev_backslash = false;
    for ch in s.chars() {
        if ch == '\\' {
            if !prev_backslash {
                result.push(ch);
            }
            prev_backslash = true;
        } else {
            result.push(ch);
            prev_backslash = false;
        }
    }
    result
}

pub(crate) fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

pub(crate) fn calculate_dir_size(path: &Path) -> u64 {
    let mut total: u64 = 0;

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();

        // Skip symlinks
        if entry_path.is_symlink() {
            continue;
        }

        if entry_path.is_file() {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        } else if entry_path.is_dir() {
            total += calculate_dir_size(&entry_path);
        }
    }

    total
}

pub(crate) const KNOWN_LINKABLE_FOLDERS: &[&str] = &[
    // JS/Node
    "node_modules",
    ".next",
    ".nuxt",
    ".yarn",
    ".pnpm-store",
    // Python
    "venv",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    // Rust
    "target",
    // Go
    "vendor",
    // Java/Kotlin
    ".gradle",
    ".m2",
    "build",
    // General
    "dist",
    ".cache",
    ".parcel-cache",
    ".turbo",
];

pub(crate) const RECOMMENDED_LINKABLE_FOLDERS: &[&str] = &[
    "node_modules",
    ".next",
    ".nuxt",
    ".pnpm-store",
    "venv",
    ".venv",
    "target",
    ".gradle",
];

pub(crate) const SKIP_DIRS: &[&str] = &[".git", ".svn", ".hg"];

pub(crate) fn scan_dir_for_linkable_folders(
    base: &Path,
    current: &Path,
    results: &mut Vec<ScannedFolder>,
) {
    let entries = match fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();

        // Skip symlinks
        if entry_path.is_symlink() {
            continue;
        }

        // Skip non-directories
        if !entry_path.is_dir() {
            continue;
        }

        let dir_name = match entry_path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        // Check if it's a known linkable folder
        if KNOWN_LINKABLE_FOLDERS.contains(&dir_name.as_str()) {
            let size_bytes = calculate_dir_size(&entry_path);
            let relative_path = entry_path
                .strip_prefix(base)
                .unwrap_or(&entry_path)
                .to_string_lossy()
                .to_string();

            results.push(ScannedFolder {
                relative_path,
                display_name: dir_name.clone(),
                size_bytes,
                size_display: format_size(size_bytes),
                is_recommended: RECOMMENDED_LINKABLE_FOLDERS.contains(&dir_name.as_str()),
            });
            continue; // Don't recurse into matched folders
        }

        // Skip configured skip dirs
        if SKIP_DIRS.contains(&dir_name.as_str()) {
            continue;
        }

        // Skip other hidden directories (those starting with '.' but not in KNOWN list)
        if dir_name.starts_with('.') {
            continue;
        }

        // Only scan depth=1: do not recurse into subdirectories like src/, vendor/, etc.
    }
}

// Parse different repo URL formats
pub(crate) fn parse_repo_url(url: &str) -> Result<String, String> {
    let url = url.trim();

    // GitHub shorthand: gh:owner/repo or owner/repo
    if url.starts_with("gh:") || (!url.contains("://") && !url.starts_with("git@")) {
        let repo = url.strip_prefix("gh:").unwrap_or(url);
        return Ok(format!("https://github.com/{}.git", repo));
    }

    // SSH format: git@github.com:owner/repo.git or ssh://git@host:port/path
    if url.starts_with("git@") || url.starts_with("ssh://") {
        return Ok(url.to_string());
    }

    // HTTPS format: https://github.com/owner/repo.git
    if url.starts_with("https://") || url.starts_with("http://") {
        return Ok(url.to_string());
    }

    Err(format!("Invalid repository URL format: {}", url))
}

/// Translate a raw `std::io::Error` into a user-friendly message.
///
/// The returned string describes the symptom and suggests a fix when possible.
/// The original OS error detail is appended in parentheses for support/debugging.
pub(crate) fn friendly_io_error(e: &std::io::Error) -> String {
    use std::io::ErrorKind;

    // First try Rust's cross-platform ErrorKind
    match e.kind() {
        ErrorKind::NotFound => {
            return "文件或目录不存在，请检查路径是否正确".to_string();
        }
        ErrorKind::PermissionDenied => {
            return "权限不足，请检查文件/目录的访问权限".to_string();
        }
        ErrorKind::AlreadyExists => {
            return "文件或目录已存在".to_string();
        }
        ErrorKind::DirectoryNotEmpty => {
            return "目录不为空，请先清空目录内容".to_string();
        }
        ErrorKind::StorageFull => {
            return "磁盘空间不足，请清理后重试".to_string();
        }
        ErrorKind::InvalidInput => {
            return "路径包含无效字符".to_string();
        }
        _ => {}
    }

    // Then check platform-specific raw OS error codes
    if let Some(code) = e.raw_os_error() {
        #[cfg(unix)]
        {
            return match code {
                // EACCES (macOS/Linux)
                13 => "权限不足，请检查文件/目录的访问权限".to_string(),
                // EBUSY
                16 => "文件正在被其他程序占用，请关闭相关程序后重试".to_string(),
                // EXDEV — cross-device move
                18 => "无法跨磁盘移动文件，请改用复制操作".to_string(),
                // EISDIR
                21 => "目标是一个目录，而非文件".to_string(),
                // ENOSPC
                28 => "磁盘空间不足，请清理后重试".to_string(),
                // EROFS
                30 => "文件系统为只读，无法写入".to_string(),
                // ENAMETOOLONG (macOS=63, Linux=36)
                36 | 63 => "路径或文件名过长，请将项目移到更短的路径下再试".to_string(),
                // ENOTEMPTY (macOS=66, Linux=39)
                39 | 66 => "目录不为空，请先清空目录内容".to_string(),
                _ => format!("操作失败（错误码 {}），请联系技术支持", code),
            };
        }
        #[cfg(windows)]
        {
            return match code {
                // ERROR_FILE_NOT_FOUND
                2 => "文件不存在，请检查路径是否正确".to_string(),
                // ERROR_PATH_NOT_FOUND
                3 => "路径不存在，请检查目录是否正确".to_string(),
                // ERROR_ACCESS_DENIED
                5 => "权限不足，请尝试以管理员身份运行或检查文件是否为只读".to_string(),
                // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION
                32 | 33 => "文件正在被其他程序占用，请关闭相关程序后重试".to_string(),
                // ERROR_FILE_EXISTS
                80 => "文件已存在".to_string(),
                // ERROR_DISK_FULL
                112 => "磁盘空间不足，请清理后重试".to_string(),
                // ERROR_INVALID_NAME
                123 => "文件名包含无效字符，请使用合法的文件名".to_string(),
                // ERROR_DIR_NOT_EMPTY
                145 => "目录不为空，请先清空目录内容".to_string(),
                // ERROR_FILENAME_EXCED_RANGE / ERROR_BUFFER_OVERFLOW
                111 | 206 => "路径或文件名过长，请将项目移到更短的路径下再试".to_string(),
                _ => format!("操作失败（错误码 {}），请联系技术支持", code),
            };
        }
    }

    // Fallback: include the original error for debugging
    format!("操作失败（{}），请联系技术支持", e)
}

/// Format a user-facing IO error with context prefix.
///
/// Example: `friendly_fs_error("复制项目失败", &err)` →
/// `"复制项目失败：路径或文件名过长，请将项目移到更短的路径下再试"`
pub(crate) fn friendly_fs_error(context: &str, e: &std::io::Error) -> String {
    format!("{}：{}", context, friendly_io_error(e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::io::{Error, ErrorKind};

    #[serial]
    #[test]
    fn truncate_log_text_limits_by_chars() {
        let text = "好".repeat(2001);

        let truncated = truncate_log_text(&text, 2000);

        assert_eq!(truncated.chars().count(), 2000);
        assert!(truncated.chars().all(|c| c == '好'));
    }

    #[serial]
    #[test]
    fn truncate_log_text_leaves_short_text_unchanged() {
        assert_eq!(truncate_log_text("short stderr", 2000), "short stderr");
    }

    #[serial]
    #[test]
    fn truncate_log_text_handles_zero_limit() {
        assert_eq!(truncate_log_text("anything", 0), "");
    }

    #[serial]
    #[test]
    fn validate_git_ref_name_accepts_common_branch_names() {
        assert!(validate_git_ref_name("feature/foo").is_ok());
        assert!(validate_git_ref_name("release/v1.2").is_ok());
        assert!(validate_git_ref_name("bugfix.JIRA-123").is_ok());
        assert!(validate_git_ref_name("unicode/功能").is_ok());
    }

    #[serial]
    #[test]
    fn validate_git_ref_name_rejects_option_like_and_invalid_names() {
        for name in [
            "",
            "   ",
            "-upload-pack=sh",
            "feature/../main",
            "feature branch",
            "feature\nbranch",
            "release.lock",
            "bad~name",
            "bad^name",
            "bad:name",
            "bad?name",
            "bad*name",
            "bad[name",
            r"bad\name",
        ] {
            assert!(validate_git_ref_name(name).is_err(), "{name:?} should fail");
        }
    }

    #[serial]
    #[test]
    fn mask_url_credentials_masks_https_userinfo() {
        assert_eq!(
            mask_url_credentials(
                "fatal: Authentication failed for 'https://user:token@example.com/repo.git'"
            ),
            "fatal: Authentication failed for 'https://***@example.com/repo.git'"
        );
    }

    #[serial]
    #[test]
    fn mask_url_credentials_leaves_urls_without_userinfo_unchanged() {
        let text = "https://github.com/org/repo.git http://example.com/path";
        assert_eq!(mask_url_credentials(text), text);
    }

    #[serial]
    #[test]
    fn mask_url_credentials_masks_multiple_urls_and_skips_ssh_scp() {
        assert_eq!(
            mask_url_credentials(
                "https://u:p@one.example/repo git@git.example:org/repo.git ssh://git@example.com/org/repo"
            ),
            "https://***@one.example/repo git@git.example:org/repo.git ssh://***@example.com/org/repo"
        );
    }

    #[serial]
    #[test]
    fn mask_url_credentials_masks_userinfo_with_ports_and_query_strings() {
        assert_eq!(
            mask_url_credentials("fetch https://user:token@example.com:8443/org/repo.git?x=1"),
            "fetch https://***@example.com:8443/org/repo.git?x=1"
        );
    }

    #[serial]
    #[test]
    fn normalize_path_handles_empty_string() {
        assert_eq!(normalize_path(""), "");
    }

    #[serial]
    #[test]
    fn normalize_path_handles_trailing_separators_for_platform() {
        #[cfg(target_os = "windows")]
        assert_eq!(normalize_path(r"C:/tmp/project/"), r"C:\tmp\project\");

        #[cfg(not(target_os = "windows"))]
        assert_eq!(normalize_path("/tmp/project/"), "/tmp/project/");
    }

    #[serial]
    #[test]
    fn normalize_path_preserves_or_folds_windows_style_paths_for_platform() {
        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                normalize_path(r"\\server\\share\\repo\\"),
                r"\\server\share\repo\"
            );
            assert_eq!(normalize_path(r"C:\\tmp\\\\project"), r"C:\tmp\project");
        }

        #[cfg(not(target_os = "windows"))]
        {
            let unc = r"\\server\\share\\repo\\";
            assert_eq!(normalize_path(unc), unc);
        }
    }

    #[serial]
    #[test]
    fn parse_repo_url_expands_github_shorthand() {
        assert_eq!(
            parse_repo_url("gh:owner/repo").unwrap(),
            "https://github.com/owner/repo.git"
        );
        assert_eq!(
            parse_repo_url(" owner/repo ").unwrap(),
            "https://github.com/owner/repo.git"
        );
    }

    #[serial]
    #[test]
    fn parse_repo_url_preserves_ssh_and_http_urls() {
        for url in [
            "git@github.com:user/repo.git",
            "ssh://git@github.com:2222/user/repo.git",
            "https://github.com/user/repo.git",
            "http://example.com/user/repo.git",
        ] {
            assert_eq!(parse_repo_url(url).unwrap(), url);
        }
    }

    #[serial]
    #[test]
    fn parse_repo_url_rejects_unknown_url_schemes() {
        let error = parse_repo_url("ftp://example.com/user/repo.git").unwrap_err();

        assert_eq!(
            error,
            "Invalid repository URL format: ftp://example.com/user/repo.git"
        );
    }

    #[serial]
    #[test]
    fn format_size_covers_boundaries_and_fractional_values() {
        assert_eq!(format_size(0), "0 B");
        assert_eq!(format_size(1023), "1023 B");
        assert_eq!(format_size(1024), "1.0 KB");
        assert_eq!(format_size(1536), "1.5 KB");
        assert_eq!(format_size(1024 * 1024), "1.0 MB");
        assert_eq!(format_size(5 * 1024 * 1024 / 2), "2.5 MB");
        assert_eq!(format_size(1024 * 1024 * 1024), "1.0 GB");
        assert_eq!(format_size(3 * 1024 * 1024 * 1024 / 2), "1.5 GB");
    }

    #[serial]
    #[test]
    fn friendly_io_error_maps_standard_error_kinds() {
        let cases = [
            (ErrorKind::NotFound, "文件或目录不存在，请检查路径是否正确"),
            (
                ErrorKind::PermissionDenied,
                "权限不足，请检查文件/目录的访问权限",
            ),
            (ErrorKind::AlreadyExists, "文件或目录已存在"),
            (ErrorKind::DirectoryNotEmpty, "目录不为空，请先清空目录内容"),
            (ErrorKind::StorageFull, "磁盘空间不足，请清理后重试"),
            (ErrorKind::InvalidInput, "路径包含无效字符"),
        ];

        for (kind, expected) in cases {
            assert_eq!(friendly_io_error(&Error::new(kind, "raw detail")), expected);
        }
    }

    #[serial]
    #[test]
    fn friendly_io_error_maps_unix_os_error_codes() {
        #[cfg(unix)]
        {
            let cases = [
                (16, "文件正在被其他程序占用，请关闭相关程序后重试"),
                (18, "无法跨磁盘移动文件，请改用复制操作"),
                (21, "目标是一个目录，而非文件"),
                (30, "文件系统为只读，无法写入"),
                (36, "路径或文件名过长，请将项目移到更短的路径下再试"),
                (39, "目录不为空，请先清空目录内容"),
                (63, "路径或文件名过长，请将项目移到更短的路径下再试"),
                (66, "目录不为空，请先清空目录内容"),
            ];

            for (code, expected) in cases {
                assert_eq!(
                    friendly_io_error(&Error::from_raw_os_error(code)),
                    expected,
                    "unexpected mapping for errno {code}"
                );
            }
        }
    }

    #[serial]
    #[test]
    fn friendly_io_error_maps_windows_os_error_codes() {
        #[cfg(windows)]
        {
            let cases = [
                (2, "文件不存在，请检查路径是否正确"),
                (3, "路径不存在，请检查目录是否正确"),
                (5, "权限不足，请尝试以管理员身份运行或检查文件是否为只读"),
                (32, "文件正在被其他程序占用，请关闭相关程序后重试"),
                (33, "文件正在被其他程序占用，请关闭相关程序后重试"),
                (80, "文件已存在"),
                (112, "磁盘空间不足，请清理后重试"),
                (123, "文件名包含无效字符，请使用合法的文件名"),
                (145, "目录不为空，请先清空目录内容"),
                (206, "路径或文件名过长，请将项目移到更短的路径下再试"),
            ];

            for (code, expected) in cases {
                assert_eq!(
                    friendly_io_error(&Error::from_raw_os_error(code)),
                    expected,
                    "unexpected mapping for Windows error {code}"
                );
            }
        }
    }

    #[serial]
    #[test]
    fn friendly_io_error_falls_back_for_unknown_errors() {
        assert_eq!(
            friendly_io_error(&Error::new(ErrorKind::Other, "disk went away")),
            "操作失败（disk went away），请联系技术支持"
        );
        assert_eq!(
            friendly_io_error(&Error::from_raw_os_error(987_654)),
            "操作失败（错误码 987654），请联系技术支持"
        );
    }

    #[serial]
    #[test]
    fn friendly_fs_error_prefixes_context() {
        let error = Error::new(ErrorKind::NotFound, "missing");

        assert_eq!(
            friendly_fs_error("复制项目失败", &error),
            "复制项目失败：文件或目录不存在，请检查路径是否正确"
        );
    }

    #[serial]
    #[test]
    fn calculate_dir_size_sums_nested_files_and_skips_symlinks() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let nested = temp.path().join("nested");
        std::fs::create_dir(&nested).expect("create nested dir");

        let root_file = temp.path().join("root.bin");
        std::fs::write(&root_file, [0_u8; 3]).expect("write root file");
        std::fs::write(nested.join("child.bin"), [0_u8; 5]).expect("write child file");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&root_file, temp.path().join("root-link.bin"))
            .expect("create file symlink");

        assert_eq!(calculate_dir_size(temp.path()), 8);
    }

    #[serial]
    #[test]
    fn scan_dir_for_linkable_folders_filters_known_skip_hidden_and_symlink_dirs() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();

        std::fs::create_dir(base.join("node_modules")).expect("create node_modules");
        std::fs::write(base.join("node_modules").join("dep.bin"), [0_u8; 1024]).expect("write dep");

        std::fs::create_dir(base.join(".venv")).expect("create .venv");
        std::fs::write(base.join(".venv").join("pyvenv.cfg"), [0_u8; 7]).expect("write venv file");

        std::fs::create_dir(base.join(".git")).expect("create .git");
        std::fs::create_dir(base.join(".git").join("target")).expect("create skipped target");
        std::fs::write(
            base.join(".git").join("target").join("ignored.bin"),
            [0_u8; 11],
        )
        .expect("write ignored target file");

        std::fs::create_dir(base.join(".hidden")).expect("create hidden dir");
        std::fs::create_dir(base.join(".hidden").join("node_modules"))
            .expect("create hidden node_modules");

        #[cfg(unix)]
        std::os::unix::fs::symlink(base.join("node_modules"), base.join("linked_node_modules"))
            .expect("create directory symlink");

        let mut results = Vec::new();
        scan_dir_for_linkable_folders(base, base, &mut results);
        results.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].relative_path, ".venv");
        assert_eq!(results[0].display_name, ".venv");
        assert_eq!(results[0].size_bytes, 7);
        assert_eq!(results[0].size_display, "7 B");
        assert!(results[0].is_recommended);

        assert_eq!(results[1].relative_path, "node_modules");
        assert_eq!(results[1].display_name, "node_modules");
        assert_eq!(results[1].size_bytes, 1024);
        assert_eq!(results[1].size_display, "1.0 KB");
        assert!(results[1].is_recommended);
    }
}
