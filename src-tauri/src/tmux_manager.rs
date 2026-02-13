use std::collections::HashMap;
use std::process::{Command, Stdio};
use log;

/// Sanitize workspace/worktree name for tmux session name
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

pub struct TmuxManager {
    // Track active sessions: (workspace_path, worktree_name) -> tmux_session_name
    sessions: HashMap<(String, String), String>,
}

impl TmuxManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Check if tmux is available on the system
    pub fn is_available() -> bool {
        Command::new("tmux")
            .arg("-V")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    /// Get or create a tmux session for a worktree
    /// Returns the tmux session name
    pub fn get_or_create_session(
        &mut self,
        workspace_path: &str,
        worktree_name: &str,
        cwd: &str,
    ) -> Result<String, String> {
        let key = (workspace_path.to_string(), worktree_name.to_string());

        // Check if we already have a session for this worktree
        if let Some(session_name) = self.sessions.get(&key) {
            if self.session_exists(session_name) {
                log::info!("Reusing existing tmux session: {}", session_name);
                return Ok(session_name.clone());
            } else {
                // Session was killed externally, remove from cache
                self.sessions.remove(&key);
            }
        }

        // Build session name
        let session_name = format!(
            "wt-{}-{}",
            sanitize_name(workspace_path),
            sanitize_name(worktree_name)
        );

        // If the session already exists in tmux (e.g. leftover from a previous run),
        // just adopt it into our cache instead of trying to create a duplicate.
        if self.session_exists(&session_name) {
            log::info!("Adopting existing tmux session: {}", session_name);
            self.sessions.insert(key, session_name.clone());
            return Ok(session_name);
        }

        self.create_session(&session_name, cwd)?;
        self.sessions.insert(key, session_name.clone());

        log::info!("Created new tmux session: {} at {}", session_name, cwd);
        Ok(session_name)
    }

    /// Check if a tmux session exists
    pub fn session_exists(&self, name: &str) -> bool {
        Command::new("tmux")
            .args(&["has-session", "-t", name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    /// Create a tmux session with a specific working directory
    pub fn create_session_with_cwd(&self, session_name: &str, cwd: Option<&str>) -> Result<(), String> {
        self.create_simple_session(session_name, cwd)
    }

    /// Create a simple tmux session without specific cwd
    fn create_simple_session(&self, session_name: &str, cwd: Option<&str>) -> Result<(), String> {
        let mut cmd = Command::new("tmux");
        cmd.args(&[
            "new-session",
            "-d",              // detached
            "-s", session_name, // session name
        ]);

        // Set working directory if provided
        if let Some(dir) = cwd {
            cmd.args(&["-c", dir]);
        }

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to create tmux session: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "tmux new-session failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        log::info!("Created simple tmux session: {} in {:?}", session_name, cwd);
        Ok(())
    }

    /// Create a new tmux session
    fn create_session(&self, name: &str, cwd: &str) -> Result<(), String> {
        let output = Command::new("tmux")
            .args(&[
                "new-session",
                "-d",           // detached
                "-s", name,     // session name
                "-c", cwd,      // working directory
                "-x", "80",     // width
                "-y", "24",     // height
            ])
            .output()
            .map_err(|e| format!("Failed to create tmux session: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "tmux new-session failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(())
    }

    /// Resize a tmux session
    pub fn resize_session(&self, session_name: &str, cols: u16, rows: u16) -> Result<(), String> {
        let output = Command::new("tmux")
            .args(&[
                "resize-window",
                "-t", session_name,
                "-x", &cols.to_string(),
                "-y", &rows.to_string(),
            ])
            .output()
            .map_err(|e| format!("Failed to resize tmux session: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "tmux resize-window failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(())
    }

    /// Send keys to a tmux session
    pub fn send_keys(&self, session_name: &str, keys: &str) -> Result<(), String> {
        let output = Command::new("tmux")
            .args(&["send-keys", "-t", session_name, keys])
            .output()
            .map_err(|e| format!("Failed to send keys to tmux: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "tmux send-keys failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(())
    }

    /// Capture pane content (for sync/snapshot)
    /// Auto-creates the session if it doesn't exist
    pub fn capture_pane(&self, session_name: &str) -> Result<String, String> {
        // Check if session exists, create if not
        if !self.session_exists(session_name) {
            log::info!("Creating tmux session on-demand: {}", session_name);
            // Create with default shell in home directory
            self.create_simple_session(session_name, None)?;
        }

        let output = Command::new("tmux")
            .args(&[
                "capture-pane",
                "-t", session_name,
                "-p",           // print to stdout
                "-e",           // include escape sequences
                "-J",           // join wrapped lines
                "-S", "-",      // start from beginning of scrollback history
            ])
            .output()
            .map_err(|e| format!("Failed to capture tmux pane: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "tmux capture-pane failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Kill a tmux session
    pub fn kill_session(&mut self, session_name: &str) -> Result<(), String> {
        let output = Command::new("tmux")
            .args(&["kill-session", "-t", session_name])
            .output()
            .map_err(|e| format!("Failed to kill tmux session: {}", e))?;

        if !output.status.success() {
            // Don't fail if session doesn't exist
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("can't find session") {
                return Err(format!("tmux kill-session failed: {}", stderr));
            }
        }

        // Remove from cache
        self.sessions.retain(|_, v| v != session_name);

        log::info!("Killed tmux session: {}", session_name);
        Ok(())
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_name() {
        assert_eq!(sanitize_name("/Users/foo/bar"), "Users-foo-bar");
        assert_eq!(sanitize_name("my-workspace"), "my-workspace");
        assert_eq!(sanitize_name("test@123!"), "test-123");
    }

    #[test]
    fn test_tmux_available() {
        // This test will pass only if tmux is installed
        if TmuxManager::is_available() {
            println!("tmux is available");
        } else {
            println!("tmux is not available, some features will be disabled");
        }
    }
}
