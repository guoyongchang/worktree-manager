use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use wait_timeout::ChildExt;

use crate::types::ScannedFolder;

// Git command timeout (30 seconds)
pub(crate) const GIT_COMMAND_TIMEOUT_SECS: u64 = 30;

pub(crate) fn run_git_command_with_timeout(args: &[&str], cwd: &str) -> Result<std::process::Output, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git command: {}", e))?;

    let timeout = Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS);
    match child.wait_timeout(timeout) {
        Ok(Some(status)) => {
            let stdout = child.stdout.take()
                .map(|mut s| {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut s, &mut buf).ok();
                    buf
                })
                .unwrap_or_default();
            let stderr = child.stderr.take()
                .map(|mut s| {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut s, &mut buf).ok();
                    buf
                })
                .unwrap_or_default();
            Ok(std::process::Output { status, stdout, stderr })
        }
        Ok(None) => {
            let _ = child.kill();
            Err(format!("Git command timed out after {} seconds", GIT_COMMAND_TIMEOUT_SECS))
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
    "node_modules", ".next", ".nuxt", ".yarn", ".pnpm-store",
    // Python
    "venv", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache",
    // Rust
    "target",
    // Go
    "vendor",
    // Java/Kotlin
    ".gradle", ".m2", "build",
    // General
    "dist", ".cache", ".parcel-cache", ".turbo",
];

pub(crate) const RECOMMENDED_LINKABLE_FOLDERS: &[&str] = &[
    "node_modules", ".next", ".nuxt", ".pnpm-store",
    "venv", ".venv", "target", ".gradle",
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

    // SSH format: git@github.com:owner/repo.git
    if url.starts_with("git@") {
        return Ok(url.to_string());
    }

    // HTTPS format: https://github.com/owner/repo.git
    if url.starts_with("https://") || url.starts_with("http://") {
        return Ok(url.to_string());
    }

    Err(format!("Invalid repository URL format: {}", url))
}
