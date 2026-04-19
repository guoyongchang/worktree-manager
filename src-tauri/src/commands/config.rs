use crate::config::{load_global_config, save_global_config_internal};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitPrefixConfig {
    pub templates: Vec<String>,
    pub enabled: bool,
}

#[tauri::command]
pub(crate) fn get_commit_prefix_config() -> Result<CommitPrefixConfig, String> {
    let config = load_global_config();
    Ok(CommitPrefixConfig {
        templates: config.commit_prefix_templates,
        enabled: config.commit_prefix_enabled,
    })
}

#[tauri::command]
pub(crate) fn set_commit_prefix_config(
    templates: Vec<String>,
    enabled: bool,
) -> Result<(), String> {
    let mut config = load_global_config();
    config.commit_prefix_templates = templates.into_iter().take(3).collect();
    config.commit_prefix_enabled = enabled;
    save_global_config_internal(&config)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitUserGlobalConfig {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[tauri::command]
pub(crate) fn get_git_user_global_config() -> Result<GitUserGlobalConfig, String> {
    let config = load_global_config();
    Ok(GitUserGlobalConfig {
        name: config.git_user_name,
        email: config.git_user_email,
    })
}

#[tauri::command]
pub(crate) fn set_git_user_global_config(
    name: Option<String>,
    email: Option<String>,
) -> Result<(), String> {
    let mut config = load_global_config();
    config.git_user_name = name;
    config.git_user_email = email;
    save_global_config_internal(&config)
}
