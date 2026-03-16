use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use wait_timeout::ChildExt;

use crate::types::ScannedFolder;

// Git command timeout (30 seconds)
pub(crate) const GIT_COMMAND_TIMEOUT_SECS: u64 = 30;

use std::sync::Mutex;

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
        return DETECTED_GIT.get_or_init(|| {
            // Try "git" from PATH first
            #[allow(unused_mut)]
            let mut check = std::process::Command::new("git");
            check.arg("--version")
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
        }).clone();
    }

    #[cfg(not(target_os = "windows"))]
    {
        "git".to_string()
    }
}

/// Create a `Command` for git that:
/// - Uses custom path if set, otherwise auto-detects
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
        Command::new(&git)
    }
}

pub(crate) fn run_git_command_with_timeout(
    args: &[&str],
    cwd: &str,
) -> Result<std::process::Output, String> {
    let mut child = git_command()
        .args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git command: {}", e))?;

    let timeout = Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS);
    match child.wait_timeout(timeout) {
        Ok(Some(status)) => {
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
            Ok(std::process::Output {
                status,
                stdout,
                stderr,
            })
        }
        Ok(None) => {
            let _ = child.kill();
            Err(format!(
                "Git command timed out after {} seconds",
                GIT_COMMAND_TIMEOUT_SECS
            ))
        }
        Err(e) => Err(format!("Failed to wait for git command: {}", e)),
    }
}

/// Normalize path separators for the current platform.
/// On Windows, replaces forward slashes with backslashes.
pub fn normalize_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        path.replace('/', "\\")
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string()
    }
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

        // Recurse into other directories
        scan_dir_for_linkable_folders(base, &entry_path, results);
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
