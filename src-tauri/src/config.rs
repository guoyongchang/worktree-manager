use std::fs;
use std::path::PathBuf;

use crate::state::{GLOBAL_CONFIG_CACHE, WINDOW_WORKSPACES, WORKSPACE_CONFIG_CACHE};
use crate::types::{GlobalConfig, MainWorkspaceOccupation, WorkspaceConfig};

// ==================== 配置路径 ====================

pub(crate) fn get_global_config_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata)
                .join("worktree-manager")
                .join("global.json");
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            return PathBuf::from(userprofile)
                .join(".config")
                .join("worktree-manager")
                .join("global.json");
        }
        PathBuf::from(".")
            .join("worktree-manager")
            .join("global.json")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join(".config")
            .join("worktree-manager")
            .join("global.json")
    }
}

pub(crate) fn get_workspace_config_path(workspace_path: &str) -> PathBuf {
    PathBuf::from(workspace_path).join(".worktree-manager.json")
}

// ==================== 全局配置加载/保存 ====================

pub fn load_global_config() -> GlobalConfig {
    {
        let cache = GLOBAL_CONFIG_CACHE.lock().unwrap();
        if let Some(ref config) = *cache {
            return config.clone();
        }
    }

    let config_path = get_global_config_path();
    let mut config = if config_path.exists() {
        match fs::read_to_string(&config_path) {
            Ok(content) => match serde_json::from_str::<GlobalConfig>(&content) {
                Ok(cfg) => cfg,
                Err(e) => {
                    log::warn!("Failed to parse global config at {:?}: {}", config_path, e);
                    GlobalConfig::default()
                }
            },
            Err(e) => {
                log::warn!("Failed to read global config at {:?}: {}", config_path, e);
                GlobalConfig::default()
            }
        }
    } else {
        let default_config = GlobalConfig::default();
        let _ = save_global_config_internal(&default_config);
        default_config
    };

    if config.commit_prefix_templates.is_empty() {
        config.commit_prefix_templates = crate::types::default_prefix_templates();
        let _ = save_global_config_internal(&config);
    }

    {
        let mut cache = GLOBAL_CONFIG_CACHE.lock().unwrap();
        *cache = Some(config.clone());
    }

    config
}

pub fn save_global_config_internal(config: &GlobalConfig) -> Result<(), String> {
    let config_path = get_global_config_path();

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, content).map_err(|e| format!("Failed to write config file: {}", e))?;

    {
        let mut cache = GLOBAL_CONFIG_CACHE.lock().unwrap();
        *cache = Some(config.clone());
    }

    Ok(())
}

// ==================== Workspace 配置加载/保存 ====================

pub fn load_workspace_config(workspace_path: &str) -> WorkspaceConfig {
    {
        let cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
        if let Some((ref cached_path, ref config)) = *cache {
            if cached_path == workspace_path {
                return config.clone();
            }
        }
    }

    let config_path = get_workspace_config_path(workspace_path);
    let config = if config_path.exists() {
        fs::read_to_string(&config_path)
            .map_err(|e| {
                log::warn!(
                    "Failed to read workspace config at {:?}: {}",
                    config_path,
                    e
                )
            })
            .ok()
            .and_then(|content| {
                serde_json::from_str::<WorkspaceConfig>(&content)
                    .map_err(|e| {
                        log::warn!(
                            "Failed to parse workspace config at {:?}: {}",
                            config_path,
                            e
                        )
                    })
                    .ok()
            })
            .unwrap_or_default()
    } else {
        let default_config = WorkspaceConfig::default();
        let _ = save_workspace_config_internal(workspace_path, &default_config);
        default_config
    };

    {
        let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
        *cache = Some((workspace_path.to_string(), config.clone()));
    }

    config
}

pub fn save_workspace_config_internal(
    workspace_path: &str,
    config: &WorkspaceConfig,
) -> Result<(), String> {
    let config_path = get_workspace_config_path(workspace_path);

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, content).map_err(|e| format!("Failed to write config file: {}", e))?;

    {
        let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
        *cache = Some((workspace_path.to_string(), config.clone()));
    }

    Ok(())
}

// ==================== 获取当前 Workspace ====================

/// 获取窗口绑定的 workspace 路径，优先从 WINDOW_WORKSPACES 获取，
/// 回退到 global config 的 current_workspace
pub(crate) fn get_window_workspace_path(window_label: &str) -> Option<String> {
    // 先查窗口绑定
    {
        let map = WINDOW_WORKSPACES.lock().unwrap();
        if let Some(path) = map.get(window_label) {
            return Some(path.clone());
        }
    }
    // 回退到全局
    let global = load_global_config();
    global.current_workspace
}

pub(crate) fn get_window_workspace_config(window_label: &str) -> Option<(String, WorkspaceConfig)> {
    let workspace_path = get_window_workspace_path(window_label)?;
    let config = load_workspace_config(&workspace_path);
    Some((workspace_path, config))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn global_config_round_trip() {
        let config = GlobalConfig {
            current_workspace: Some("/tmp/workspace".to_string()),
            ngrok_token: Some(" my-ngrok ".to_string()),
            dashscope_api_key: Some("my-dashscope".to_string()),
            ..GlobalConfig::default()
        };

        let serialized = serde_json::to_string_pretty(&config).expect("serialize config");
        let value: Value = serde_json::from_str(&serialized).expect("parse serialized config");
        let object = value.as_object().expect("config json object");

        assert_eq!(
            object.get("current_workspace"),
            Some(&Value::String("/tmp/workspace".to_string()))
        );
        assert_eq!(
            object.get("ngrok_token"),
            Some(&Value::String(" my-ngrok ".to_string()))
        );
        assert_eq!(
            object.get("dashscope_api_key"),
            Some(&Value::String("my-dashscope".to_string()))
        );
        assert!(!object.contains_key("wms_server_url"));
        assert!(!object.contains_key("wms_token"));
        assert!(!object.contains_key("wms_subdomain"));
        assert!(!object.contains_key("wms_jwt"));
        assert!(!object.contains_key("device_id"));
        assert!(
            object.get("commit_prefix_enabled").is_some(),
            "commit_prefix_enabled should be serialized"
        );
        assert!(
            object.get("commit_prefix_templates").is_some(),
            "commit_prefix_templates should be serialized"
        );
    }
}

// ==================== 主工作区占用状态 ====================

pub fn load_occupation_state(workspace_path: &str) -> Option<MainWorkspaceOccupation> {
    let path = std::path::PathBuf::from(workspace_path).join(".worktree-manager-occupation.json");
    if !path.exists() {
        return None;
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}

pub fn save_occupation_state(
    workspace_path: &str,
    state: &MainWorkspaceOccupation,
) -> Result<(), String> {
    let path = std::path::PathBuf::from(workspace_path).join(".worktree-manager-occupation.json");
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize occupation state: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write occupation state: {}", e))
}

pub fn clear_occupation_state(workspace_path: &str) -> Result<(), String> {
    let path = std::path::PathBuf::from(workspace_path).join(".worktree-manager-occupation.json");
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to clear occupation state: {}", e))?;
    }
    Ok(())
}
