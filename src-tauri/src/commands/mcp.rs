use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;
use tokio::sync::oneshot;

use crate::http_server::{load_mcp_config, save_mcp_config, McpConfig};

static MCP_CONFIRMS: LazyLock<Mutex<HashMap<String, oneshot::Sender<bool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn confirms() -> &'static Mutex<HashMap<String, oneshot::Sender<bool>>> {
    &MCP_CONFIRMS
}

pub async fn request_mcp_confirm(action: String, summary: String) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    confirms()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), tx);
    let emitted = crate::state::with_app_handle(|app| {
        app.emit(
            "mcp-confirm-required",
            serde_json::json!({ "id": id, "action": action, "summary": summary }),
        )
    });
    if emitted.is_none() {
        confirms().lock().ok().and_then(|mut map| map.remove(&id));
        return Err("桌面端未打开，无法向用户确认".to_string());
    }
    match tokio::time::timeout(Duration::from_secs(120), rx).await {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) | Ok(Err(_)) => Err("用户取消了这次操作".to_string()),
        Err(_) => {
            confirms().lock().ok().and_then(|mut map| map.remove(&id));
            Err("等待用户确认超时".to_string())
        }
    }
}

#[tauri::command]
pub fn resolve_mcp_confirm(id: String, approved: bool) -> Result<(), String> {
    let tx = confirms()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
        .ok_or_else(|| "确认请求已失效".to_string())?;
    tx.send(approved).map_err(|_| "确认请求已失效".to_string())
}
const SERVER_NAME: &str = "worktree-manager";

#[derive(Serialize)]
pub struct McpSettings {
    pub capability_level: String,
    pub http_port: u16,
    pub claude_installed: bool,
    pub claude_desktop_installed: bool,
    pub cursor_installed: bool,
    pub codex_installed: bool,
    pub claude_code_path: String,
    pub claude_desktop_path: String,
    pub cursor_path: String,
    pub codex_path: String,
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "home directory not found".to_string())
}

pub fn normalize_capability(level: &str) -> Option<&'static str> {
    match level {
        "read" | "core" | "details" => Some("read"),
        "operate" | "advanced" => Some("operate"),
        _ => None,
    }
}

fn server_entry() -> serde_json::Value {
    serde_json::json!({
        "command": "npx",
        "args": ["-y", "@worktree-manager/mcp", "start"]
    })
}

fn read_json(path: &Path) -> serde_json::Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .filter(|value: &serde_json::Value| value.is_object())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn has_json_server(path: &Path) -> bool {
    read_json(path)
        .get("mcpServers")
        .and_then(|servers| servers.get(SERVER_NAME))
        .is_some()
}

fn write_json_server(path: &Path) -> Result<(), String> {
    let mut root = read_json(path);
    let servers = root
        .as_object_mut()
        .ok_or_else(|| "MCP config is not an object".to_string())?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    servers
        .as_object_mut()
        .ok_or_else(|| "mcpServers is not an object".to_string())?
        .insert(SERVER_NAME.to_string(), server_entry());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    std::fs::write(path, text).map_err(|error| error.to_string())
}

fn codex_block() -> String {
    "[mcp_servers.worktree-manager]\ncommand = \"npx\"\nargs = [\"-y\", \"@worktree-manager/mcp\", \"start\"]\n".to_string()
}

fn replace_codex_block(text: &str, block: &str) -> String {
    let header = "[mcp_servers.worktree-manager]";
    let Some(start) = text.find(header) else {
        return if text.trim().is_empty() {
            block.to_string()
        } else {
            format!("{}\n\n{}", text.trim_end(), block)
        };
    };
    let rest = &text[start + header.len()..];
    let end = rest
        .find("\n[")
        .map(|index| start + header.len() + index)
        .unwrap_or(text.len());
    format!(
        "{}{}\n{}",
        &text[..start],
        block.trim_end(),
        text[end..].trim_start_matches('\n')
    )
}

fn write_codex(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    std::fs::write(path, replace_codex_block(&existing, &codex_block()))
        .map_err(|error| error.to_string())
}

pub fn sync_installed_client_configs() -> Result<(), String> {
    let home = home_dir()?;
    for path in [
        home.join(".claude.json"),
        claude_desktop_config_path(&home),
        home.join(".cursor").join("mcp.json"),
    ] {
        if has_json_server(&path) {
            write_json_server(&path)?;
        }
    }
    let codex = home.join(".codex").join("config.toml");
    if std::fs::read_to_string(&codex)
        .unwrap_or_default()
        .contains("[mcp_servers.worktree-manager]")
    {
        write_codex(&codex)?;
    }
    Ok(())
}

fn claude_desktop_config_path(home: &Path) -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| home.join(".config"))
        .join("Claude")
        .join("claude_desktop_config.json")
}

#[tauri::command]
pub fn get_mcp_settings() -> Result<McpSettings, String> {
    let home = home_dir()?;
    let claude_code_path = home.join(".claude.json");
    let claude_desktop_path = claude_desktop_config_path(&home);
    let cursor_path = home.join(".cursor").join("mcp.json");
    let codex_path = home.join(".codex").join("config.toml");
    let level = load_mcp_config()
        .and_then(|config| normalize_capability(&config.capability_level))
        .unwrap_or("read")
        .to_string();
    Ok(McpSettings {
        capability_level: level,
        http_port: crate::http_server::configured_mcp_port(),
        claude_installed: has_json_server(&claude_code_path),
        claude_desktop_installed: has_json_server(&claude_desktop_path),
        cursor_installed: has_json_server(&cursor_path),
        codex_installed: std::fs::read_to_string(&codex_path)
            .unwrap_or_default()
            .contains("[mcp_servers.worktree-manager]"),
        claude_code_path: claude_code_path.display().to_string(),
        claude_desktop_path: claude_desktop_path.display().to_string(),
        cursor_path: cursor_path.display().to_string(),
        codex_path: codex_path.display().to_string(),
    })
}

#[tauri::command]
pub fn set_mcp_capability(capability_level: String) -> Result<(), String> {
    let level = normalize_capability(&capability_level)
        .ok_or_else(|| "Invalid capability level".to_string())?;
    let mut config = load_mcp_config().unwrap_or(McpConfig {
        version: env!("CARGO_PKG_VERSION").to_string(),
        http_port: crate::http_server::configured_mcp_port(),
        installed_at: chrono::Utc::now().to_rfc3339(),
        capability_level: "read".to_string(),
    });
    config.capability_level = level.to_string();
    save_mcp_config(&config)
}

#[tauri::command]
pub async fn set_mcp_port(port: u16) -> Result<(), String> {
    crate::http_server::set_mcp_listening_port(port).await?;
    sync_installed_client_configs()
}

#[tauri::command]
pub fn install_mcp_client(client: String) -> Result<String, String> {
    let home = home_dir()?;
    match client.as_str() {
        "claude" | "claude-code" => {
            let path = home.join(".claude.json");
            write_json_server(&path)?;
            Ok(path.display().to_string())
        }
        "claude-desktop" => {
            let path = claude_desktop_config_path(&home);
            write_json_server(&path)?;
            Ok(path.display().to_string())
        }
        "cursor" => {
            let path = home.join(".cursor").join("mcp.json");
            write_json_server(&path)?;
            Ok(path.display().to_string())
        }
        "codex" => {
            let path = home.join(".codex").join("config.toml");
            write_codex(&path)?;
            Ok(path.display().to_string())
        }
        _ => Err("Unknown MCP client".to_string()),
    }
}
