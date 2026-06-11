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
        let cache = GLOBAL_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let mut cache = GLOBAL_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let mut cache = GLOBAL_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *cache = Some(config.clone());
    }

    Ok(())
}

// ==================== Workspace 配置加载/保存 ====================

pub fn load_workspace_config(workspace_path: &str) -> WorkspaceConfig {
    {
        let cache = WORKSPACE_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let mut cache = WORKSPACE_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let mut cache = WORKSPACE_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let map = WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
    use serial_test::serial;

    struct ConfigStateGuard {
        previous_workspace: Option<(String, WorkspaceConfig)>,
    }

    impl ConfigStateGuard {
        fn isolated() -> Self {
            let previous_workspace = {
                let mut cache = crate::state::WORKSPACE_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *cache)
            };

            Self { previous_workspace }
        }
    }

    impl Drop for ConfigStateGuard {
        fn drop(&mut self) {
            let mut workspace = crate::state::WORKSPACE_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *workspace = self.previous_workspace.take();
        }
    }

    fn clear_workspace_config_cache() {
        let mut cache = crate::state::WORKSPACE_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *cache = None;
    }

    #[serial]
    #[test]
    fn global_config_round_trip() {
        let config = GlobalConfig {
            current_workspace: Some("/tmp/workspace".to_string()),
            ngrok_token: Some(" my-ngrok ".to_string()),
            share_password: Some("persisted-secret".to_string()),
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
            object.get("share_password"),
            Some(&Value::String("persisted-secret".to_string()))
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

    #[serial]
    #[test]
    fn global_config_missing_share_password_defaults_to_none() {
        let config: GlobalConfig = serde_json::from_value(serde_json::json!({
            "workspaces": [],
            "current_workspace": null
        }))
        .expect("deserialize legacy config");

        assert_eq!(config.share_password, None);
    }

    #[serial]
    #[test]
    fn load_workspace_config_reads_valid_json_file() {
        let _state = ConfigStateGuard::isolated();
        let workspace = tempfile::tempdir().expect("create workspace dir");
        std::fs::write(
            get_workspace_config_path(workspace.path().to_str().unwrap()),
            serde_json::json!({
                "name": "Demo Workspace",
                "worktrees_dir": "trees",
                "projects": [{
                    "name": "app",
                    "base_branch": "main",
                    "test_branch": "uat",
                    "merge_strategy": "merge"
                }],
                "linked_workspace_items": ["CLAUDE.md"],
                "vault_linked_workspace_items": ["Vault"],
                "uat_branch": "staging",
                "archived_worktrees": ["old-worktree"],
                "worktree_colors": {"feature-a": "red"},
                "tags": [{"id": "frontend", "name": "Frontend", "color": "#336699"}]
            })
            .to_string(),
        )
        .expect("write workspace config");

        let config = load_workspace_config(workspace.path().to_str().unwrap());

        assert_eq!(config.name, "Demo Workspace");
        assert_eq!(config.worktrees_dir, "trees");
        assert_eq!(config.projects.len(), 1);
        assert_eq!(config.projects[0].name, "app");
        assert_eq!(config.linked_workspace_items, vec!["CLAUDE.md"]);
        assert_eq!(config.vault_linked_workspace_items, vec!["Vault"]);
        assert_eq!(config.uat_branch, "staging");
        assert_eq!(config.archived_worktrees, vec!["old-worktree"]);
        assert_eq!(
            config.worktree_colors.get("feature-a"),
            Some(&crate::types::WorktreeColor::Red)
        );
        assert_eq!(config.tags[0].id, "frontend");
    }

    #[serial]
    #[test]
    fn load_workspace_config_defaults_missing_optional_fields() {
        let _state = ConfigStateGuard::isolated();
        let workspace = tempfile::tempdir().expect("create workspace dir");
        std::fs::write(
            get_workspace_config_path(workspace.path().to_str().unwrap()),
            r#"{
                "name": "Legacy Workspace",
                "worktrees_dir": "worktrees",
                "projects": []
            }"#,
        )
        .expect("write legacy workspace config");

        let config = load_workspace_config(workspace.path().to_str().unwrap());

        assert_eq!(config.name, "Legacy Workspace");
        assert!(config.linked_workspace_items.is_empty());
        assert!(config.vault_linked_workspace_items.is_empty());
        assert_eq!(config.uat_branch, "uat");
        assert!(config.archived_worktrees.is_empty());
        assert!(config.worktree_colors.is_empty());
        assert!(config.tags.is_empty());
    }

    #[serial]
    #[test]
    fn load_workspace_config_returns_default_for_corrupted_json() {
        let _state = ConfigStateGuard::isolated();
        let workspace = tempfile::tempdir().expect("create workspace dir");
        std::fs::write(
            get_workspace_config_path(workspace.path().to_str().unwrap()),
            "{not valid json",
        )
        .expect("write corrupted workspace config");

        let config = load_workspace_config(workspace.path().to_str().unwrap());

        assert_eq!(config.name, WorkspaceConfig::default().name);
        assert_eq!(
            config.worktrees_dir,
            WorkspaceConfig::default().worktrees_dir
        );
        assert!(config.projects.is_empty());
    }

    #[serial]
    #[test]
    fn save_workspace_config_writes_file_and_round_trips_after_cache_clear() {
        let _state = ConfigStateGuard::isolated();
        let workspace = tempfile::tempdir().expect("create workspace dir");
        let config = WorkspaceConfig {
            name: "Round Trip".to_string(),
            worktrees_dir: "custom-worktrees".to_string(),
            projects: vec![crate::types::ProjectConfig {
                name: "api".to_string(),
                base_branch: "main".to_string(),
                test_branch: "test".to_string(),
                merge_strategy: "squash".to_string(),
                linked_folders: vec!["target".to_string()],
                commit_prefix_index: Some(0),
                git_user_name: Some("Test User".to_string()),
                git_user_email: Some("test@example.com".to_string()),
                tags: vec!["backend".to_string()],
            }],
            linked_workspace_items: vec!["README.md".to_string()],
            vault_linked_workspace_items: vec!["Vault".to_string()],
            uat_branch: "qa".to_string(),
            archived_worktrees: vec!["archived".to_string()],
            worktree_colors: std::collections::HashMap::from([(
                "round-trip".to_string(),
                crate::types::WorktreeColor::Blue,
            )]),
            tags: vec![crate::types::TagDefinition {
                id: "backend".to_string(),
                name: "Backend".to_string(),
                color: "#123456".to_string(),
            }],
        };

        save_workspace_config_internal(workspace.path().to_str().unwrap(), &config)
            .expect("save workspace config");
        clear_workspace_config_cache();

        let reloaded = load_workspace_config(workspace.path().to_str().unwrap());

        assert_eq!(reloaded.name, config.name);
        assert_eq!(reloaded.worktrees_dir, config.worktrees_dir);
        assert_eq!(reloaded.projects[0].linked_folders, vec!["target"]);
        assert_eq!(reloaded.linked_workspace_items, vec!["README.md"]);
        assert_eq!(reloaded.vault_linked_workspace_items, vec!["Vault"]);
        assert_eq!(reloaded.uat_branch, "qa");
        assert_eq!(reloaded.archived_worktrees, vec!["archived"]);
        assert_eq!(
            reloaded.worktree_colors.get("round-trip"),
            Some(&crate::types::WorktreeColor::Blue)
        );
        assert_eq!(reloaded.tags[0].name, "Backend");
    }

    #[serial]
    #[test]
    fn save_workspace_config_updates_existing_file_fields() {
        let _state = ConfigStateGuard::isolated();
        let workspace = tempfile::tempdir().expect("create workspace dir");
        let initial = WorkspaceConfig {
            name: "Initial".to_string(),
            linked_workspace_items: vec!["old.md".to_string()],
            ..WorkspaceConfig::default()
        };
        let updated = WorkspaceConfig {
            name: "Updated".to_string(),
            worktrees_dir: "updated-worktrees".to_string(),
            linked_workspace_items: vec!["new.md".to_string()],
            archived_worktrees: vec!["archived-a".to_string()],
            ..WorkspaceConfig::default()
        };

        save_workspace_config_internal(workspace.path().to_str().unwrap(), &initial)
            .expect("save initial config");
        save_workspace_config_internal(workspace.path().to_str().unwrap(), &updated)
            .expect("save updated config");
        clear_workspace_config_cache();

        let reloaded = load_workspace_config(workspace.path().to_str().unwrap());

        assert_eq!(reloaded.name, "Updated");
        assert_eq!(reloaded.worktrees_dir, "updated-worktrees");
        assert_eq!(reloaded.linked_workspace_items, vec!["new.md"]);
        assert_eq!(reloaded.archived_worktrees, vec!["archived-a"]);
    }

    #[serial]
    #[test]
    fn occupation_state_saves_loads_and_clears_file() {
        let workspace = tempfile::tempdir().expect("create workspace dir");
        let state = MainWorkspaceOccupation {
            worktree_name: "feature-a".to_string(),
            original_branches: std::collections::HashMap::from([(
                "api".to_string(),
                "main".to_string(),
            )]),
            worktree_branches: std::collections::HashMap::from([(
                "api".to_string(),
                "feature/a".to_string(),
            )]),
            deployed_at: "2026-06-11T00:00:00Z".to_string(),
        };

        save_occupation_state(workspace.path().to_str().unwrap(), &state)
            .expect("save occupation state");
        let loaded = load_occupation_state(workspace.path().to_str().unwrap())
            .expect("load occupation state");

        assert_eq!(loaded.worktree_name, "feature-a");
        assert_eq!(
            loaded.original_branches.get("api"),
            Some(&"main".to_string())
        );
        assert_eq!(
            loaded.worktree_branches.get("api"),
            Some(&"feature/a".to_string())
        );

        clear_occupation_state(workspace.path().to_str().unwrap()).expect("clear occupation state");
        assert!(load_occupation_state(workspace.path().to_str().unwrap()).is_none());
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
