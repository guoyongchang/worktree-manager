use crate::state::PTY_MANAGER;

#[tauri::command]
pub(crate) fn pty_create(
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<(), String> {
    // Make create idempotent: if session already exists, skip
    {
        let manager = PTY_MANAGER
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if manager.has_session(&session_id) {
            log::info!(
                "[pty] Session already exists, skipping create: id={}, requested cols={}, rows={}",
                session_id,
                cols,
                rows
            );
            return Ok(());
        }
    }

    log::info!(
        "[pty] Creating session: id={}, cwd={}, cols={}, rows={}, shell={:?}",
        session_id,
        cwd,
        cols,
        rows,
        shell
    );
    let mut manager = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
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
    client_id: Option<String>,
) -> Result<(), String> {
    // "Last active client wins resize" — per-session gating.
    // Per-window PTY sessions (session_id includes windowLabel) make cross-window
    // resize gating unnecessary. Only gate within the same session.
    let active_client_id = crate::TERMINAL_STATES
        .lock()
        .ok()
        .and_then(|states| {
            states.values()
                .find(|ts| ts.session_id.as_deref() == Some(&session_id))
                .and_then(|ts| ts.client_id.clone())
        });

    let is_active = if let Some(ref req_cid) = client_id {
        active_client_id.as_deref() == Some(req_cid)
    } else {
        // No clientId provided (legacy) — always allow
        true
    };

    if !is_active {
        log::info!(
            "[pty] REJECTED RESIZE: client={:?} session={} size={}x{} (active_client={:?})",
            client_id,
            session_id,
            cols,
            rows,
            active_client_id
        );
        return Ok(());
    }

    log::info!(
        "[pty] ACCEPTED RESIZE: client={:?} session={} size={}x{}",
        client_id,
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
    let result = manager.close_session(&session_id);
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
    log::info!("[pty] Closing sessions by path prefix: {}", path_prefix);
    let mut manager = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let closed = manager.close_sessions_by_path_prefix(&path_prefix);
    log::info!(
        "[pty] Closed {} sessions matching path prefix: {}",
        closed.len(),
        path_prefix
    );
    Ok(closed)
}
