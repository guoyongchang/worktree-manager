#[tauri::command]
pub(crate) async fn start_mcp_server(port: Option<u16>) -> Result<(), String> {
    let port = port.unwrap_or(42819);
    crate::http_server::start_mcp_server(port).await
}
