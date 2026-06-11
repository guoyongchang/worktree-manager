use crate::pty_manager::requested_shell_path;
use crate::state::PTY_MANAGER;
use crate::utils::normalize_path;

#[tauri::command]
pub(crate) fn pty_create(
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<(), String> {
    let cwd = normalize_path(&cwd);
    // Hold the lock for the entire check-close-create sequence to avoid
    // TOCTOU races with concurrent IPC or HTTP requests on the same session.
    let requested_shell = requested_shell_path(shell.as_deref());
    let mut manager = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if let Some(existing_shell) = manager.session_shell_path(&session_id) {
        if existing_shell == requested_shell {
            log::info!(
                "[pty] Session already exists, skipping create: id={}, requested cols={}, rows={}, shell={}",
                session_id,
                cols,
                rows,
                requested_shell
            );
            return Ok(());
        }

        log::info!(
            "[pty] Session exists with different shell, recreating: id={}, existing_shell={}, requested_shell={}",
            session_id,
            existing_shell,
            requested_shell
        );
        manager.close_session(&session_id, "pty_create: shell changed")?;
    }

    log::info!(
        "[pty] Creating session: id={}, cwd={}, cols={}, rows={}, shell={:?}",
        session_id,
        cwd,
        cols,
        rows,
        shell
    );
    let result = manager.create_session(&session_id, &cwd, cols, rows, shell.as_deref());
    match &result {
        Ok(()) => log::info!("[pty] Session created: {}", session_id),
        Err(e) => log::error!("[pty] Failed to create session {}: {}", session_id, e),
    }
    result
}

#[tauri::command]
pub(crate) fn pty_write(session_id: String, data: String) -> Result<(), String> {
    let manager = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    manager.write_to_session(&session_id, &data)
}

#[tauri::command]
pub(crate) fn pty_read(session_id: String, client_id: Option<String>) -> Result<String, String> {
    let manager = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    manager.read_from_session(&session_id, client_id.as_deref())
}

#[tauri::command]
pub(crate) fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    _client_id: Option<String>,
) -> Result<(), String> {
    log::info!(
        "[pty] RESIZE: session={} size={}x{}",
        session_id,
        cols,
        rows
    );
    let manager = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    manager.resize_session(&session_id, cols, rows)
}

#[tauri::command]
pub(crate) fn pty_close(session_id: String) -> Result<(), String> {
    log::info!("[pty] Closing session: {}", session_id);
    let mut manager = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let result = manager.close_session(&session_id, "pty_close: frontend request");
    match &result {
        Ok(()) => log::info!("[pty] Closed session: {}", session_id),
        Err(e) => log::error!("[pty] Failed to close session {}: {}", session_id, e),
    }
    result
}

#[tauri::command]
pub(crate) fn pty_exists(session_id: String) -> Result<bool, String> {
    let manager = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(manager.has_session(&session_id))
}

/// Close all PTY sessions whose working directory starts with the given path prefix.
/// Used internally when archiving/deleting worktrees (see archive_worktree, delete_archived_worktree)
/// and exposed via the HTTP server for remote access mode.
#[tauri::command]
pub(crate) fn pty_close_by_path(path_prefix: String) -> Result<Vec<String>, String> {
    let path_prefix = normalize_path(&path_prefix);
    log::info!("[pty] Closing sessions by path prefix: {}", path_prefix);
    let mut manager = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let closed =
        manager.close_sessions_by_path_prefix(&path_prefix, "pty_close_by_path: frontend request");
    log::info!(
        "[pty] Closed {} sessions matching path prefix: {}",
        closed.len(),
        path_prefix
    );
    Ok(closed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use serial_test::serial;
    use std::sync::{Mutex, MutexGuard};
    #[cfg(not(target_os = "windows"))]
    use std::time::Duration;
    #[cfg(not(target_os = "windows"))]
    use std::time::Instant;

    static PTY_COMMAND_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn lock_pty_command_tests() -> MutexGuard<'static, ()> {
        PTY_COMMAND_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn unique_session_id(name: &str) -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("pty-command-test-{}-{}-{nanos}", std::process::id(), name)
    }

    #[cfg(not(target_os = "windows"))]
    fn wait_for_pty_output(session_id: &str, reader_id: &str, needle: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut collected = String::new();
        while Instant::now() < deadline {
            let chunk = pty_read(session_id.to_string(), Some(reader_id.to_string()))
                .expect("read pty output");
            collected.push_str(&chunk);
            if collected.contains(needle) {
                return collected;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("timed out waiting for {needle:?}; collected {collected:?}");
    }

    #[serial]
    #[test]
    fn pty_exists_returns_false_for_missing_session() {
        let _serial = lock_pty_command_tests();
        let session_id = unique_session_id("exists");

        let exists = pty_exists(session_id).expect("query missing session");

        assert!(!exists);
    }

    #[serial]
    #[test]
    fn missing_session_read_write_and_resize_return_session_not_found() {
        let _serial = lock_pty_command_tests();
        let session_id = unique_session_id("missing-ops");

        let write_err = pty_write(session_id.clone(), "input".to_string())
            .expect_err("write to missing session");
        let read_err =
            pty_read(session_id.clone(), Some("reader".to_string())).expect_err("read missing");
        let resize_err = pty_resize(session_id, 120, 40, Some("reader".to_string()))
            .expect_err("resize missing");

        assert_eq!(write_err, "Session not found");
        assert_eq!(read_err, "Session not found");
        assert_eq!(resize_err, "Session not found");
    }

    #[serial]
    #[test]
    fn pty_close_is_idempotent_for_missing_session() {
        let _serial = lock_pty_command_tests();
        let session_id = unique_session_id("close");

        let first = pty_close(session_id.clone());
        let second = pty_close(session_id.clone());
        let exists = pty_exists(session_id).expect("query closed session");

        assert!(first.is_ok());
        assert!(second.is_ok());
        assert!(!exists);
    }

    #[serial]
    #[test]
    fn pty_close_by_path_returns_empty_for_unmatched_prefix_without_spawning() {
        let _serial = lock_pty_command_tests();
        let prefix = tempfile::tempdir()
            .expect("create prefix")
            .path()
            .join("worktree");

        let closed = pty_close_by_path(prefix.to_string_lossy().to_string())
            .expect("close unmatched prefix");

        assert!(closed.is_empty());
    }

    #[cfg(not(target_os = "windows"))]
    #[serial]
    #[test]
    fn pty_commands_create_write_read_resize_and_close_short_session() {
        let _serial = lock_pty_command_tests();
        if !std::path::Path::new("/bin/sh").exists() {
            // Unix CI images should have /bin/sh; skip only on unusual local systems.
            return;
        }
        let cwd = tempfile::tempdir().expect("pty cwd");
        let session_id = unique_session_id("lifecycle");

        pty_create(
            session_id.clone(),
            cwd.path().to_string_lossy().to_string(),
            80,
            24,
            Some("/bin/sh".to_string()),
        )
        .expect("create pty");
        assert!(pty_exists(session_id.clone()).unwrap());
        pty_resize(session_id.clone(), 100, 30, Some("reader".to_string())).unwrap();
        pty_write(
            session_id.clone(),
            "printf PTY_COMMAND_OK; exit\n".to_string(),
        )
        .unwrap();

        let output = wait_for_pty_output(&session_id, "reader", "PTY_COMMAND_OK");
        assert!(output.contains("PTY_COMMAND_OK"));

        pty_close(session_id.clone()).unwrap();
        assert!(!pty_exists(session_id).unwrap());
    }

    #[cfg(not(target_os = "windows"))]
    #[serial]
    #[test]
    fn pty_create_is_idempotent_when_existing_shell_matches() {
        let _serial = lock_pty_command_tests();
        if !std::path::Path::new("/bin/sh").exists() {
            // Unix CI images should have /bin/sh; skip only on unusual local systems.
            return;
        }
        let cwd = tempfile::tempdir().expect("pty cwd");
        let session_id = unique_session_id("idempotent");

        pty_create(
            session_id.clone(),
            cwd.path().to_string_lossy().to_string(),
            80,
            24,
            Some("/bin/sh".to_string()),
        )
        .expect("create pty");
        pty_create(
            session_id.clone(),
            cwd.path().to_string_lossy().to_string(),
            120,
            40,
            Some("/bin/sh".to_string()),
        )
        .expect("idempotent create");

        assert!(pty_exists(session_id.clone()).unwrap());
        pty_close(session_id).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[serial]
    #[test]
    fn pty_create_recreates_existing_session_when_shell_changes() {
        let _serial = lock_pty_command_tests();
        if !std::path::Path::new("/bin/sh").exists() || !std::path::Path::new("/bin/bash").exists()
        {
            // This branch needs two distinct local shells; skip on minimal Unix images.
            return;
        }
        let cwd = tempfile::tempdir().expect("pty cwd");
        let session_id = unique_session_id("recreate");

        pty_create(
            session_id.clone(),
            cwd.path().to_string_lossy().to_string(),
            80,
            24,
            Some("/bin/sh".to_string()),
        )
        .expect("create sh session");
        pty_create(
            session_id.clone(),
            cwd.path().to_string_lossy().to_string(),
            80,
            24,
            Some("/bin/bash".to_string()),
        )
        .expect("recreate bash session");

        assert!(pty_exists(session_id.clone()).unwrap());
        pty_close(session_id).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[serial]
    #[test]
    fn pty_close_by_path_closes_matching_normalized_session_ids() {
        let _serial = lock_pty_command_tests();
        if !std::path::Path::new("/bin/sh").exists() {
            // Unix CI images should have /bin/sh; skip only on unusual local systems.
            return;
        }
        let cwd = tempfile::tempdir().expect("pty cwd");
        let normalized_prefix = cwd.path().to_string_lossy().replace(['/', '\\', '#'], "-");
        let exact_id = format!("pty-{}", normalized_prefix);
        let child_id = format!("pty-{}-tab-2", normalized_prefix);

        pty_create(
            exact_id.clone(),
            cwd.path().to_string_lossy().to_string(),
            80,
            24,
            Some("/bin/sh".to_string()),
        )
        .expect("create exact session");
        pty_create(
            child_id.clone(),
            cwd.path().to_string_lossy().to_string(),
            80,
            24,
            Some("/bin/sh".to_string()),
        )
        .expect("create child session");

        let mut closed =
            pty_close_by_path(cwd.path().to_string_lossy().to_string()).expect("close by path");
        closed.sort();

        assert_eq!(closed, vec![exact_id.clone(), child_id.clone()]);
        assert!(!pty_exists(exact_id).unwrap());
        assert!(!pty_exists(child_id).unwrap());
    }
}
