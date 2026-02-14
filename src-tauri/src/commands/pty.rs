use crate::state::PTY_MANAGER;

#[tauri::command]
pub(crate) fn pty_create(session_id: String, cwd: String, cols: u16, rows: u16) -> Result<(), String> {
    let mut manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.create_session(&session_id, &cwd, cols, rows)
}

#[tauri::command]
pub(crate) fn pty_write(session_id: String, data: String) -> Result<(), String> {
    let manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.write_to_session(&session_id, &data)
}

#[tauri::command]
pub(crate) fn pty_read(session_id: String) -> Result<String, String> {
    let manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.read_from_session(&session_id)
}

#[tauri::command]
pub(crate) fn pty_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.resize_session(&session_id, cols, rows)
}

#[tauri::command]
pub(crate) fn pty_close(session_id: String) -> Result<(), String> {
    let mut manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.close_session(&session_id)
}

#[tauri::command]
pub(crate) fn pty_exists(session_id: String) -> Result<bool, String> {
    let manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(manager.has_session(&session_id))
}

/// Close all PTY sessions whose working directory starts with the given path prefix.
/// Used internally when archiving/deleting worktrees (see archive_worktree, delete_archived_worktree)
/// and exposed via the HTTP server for remote access mode.
#[tauri::command]
pub(crate) fn pty_close_by_path(path_prefix: String) -> Result<Vec<String>, String> {
    let mut manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(manager.close_sessions_by_path_prefix(&path_prefix))
}
