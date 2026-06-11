use crate::config::{load_global_config, save_global_config_internal};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitPrefixConfig {
    pub templates: Vec<String>,
    pub enabled: bool,
    pub default_index: usize,
}

#[tauri::command]
pub(crate) fn get_commit_prefix_config() -> Result<CommitPrefixConfig, String> {
    let config = load_global_config();
    log::info!(
        "[config] get_commit_prefix_config: default_index={}, templates={:?}",
        config.default_prefix_index,
        config.commit_prefix_templates
    );
    Ok(CommitPrefixConfig {
        templates: config.commit_prefix_templates,
        enabled: config.commit_prefix_enabled,
        default_index: config.default_prefix_index,
    })
}

#[tauri::command]
pub(crate) fn set_commit_prefix_config(
    templates: Vec<String>,
    enabled: bool,
    default_index: usize,
) -> Result<(), String> {
    let mut config = load_global_config();
    log::info!(
        "[config] set_commit_prefix_config: old default={}, new default={}",
        config.default_prefix_index,
        default_index
    );
    config.commit_prefix_templates = templates.into_iter().take(3).collect();
    config.commit_prefix_enabled = enabled;
    config.default_prefix_index = default_index;
    save_global_config_internal(&config)?;
    log::info!("[config] set_commit_prefix_config: saved ok");
    Ok(())
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

#[tauri::command]
pub(crate) fn get_skip_git_hooks() -> Result<bool, String> {
    let config = load_global_config();
    Ok(config.skip_git_hooks)
}

#[tauri::command]
pub(crate) fn set_skip_git_hooks(skip: bool) -> Result<(), String> {
    let mut config = load_global_config();
    config.skip_git_hooks = skip;
    save_global_config_internal(&config)
}

#[tauri::command]
pub(crate) fn get_shell_integration_enabled() -> Result<bool, String> {
    let config = load_global_config();
    Ok(config.shell_integration_enabled)
}

#[tauri::command]
pub(crate) fn set_shell_integration_enabled(enabled: bool) -> Result<(), String> {
    let mut config = load_global_config();
    config.shell_integration_enabled = enabled;
    save_global_config_internal(&config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::GLOBAL_CONFIG_CACHE;
    use crate::types::GlobalConfig;
    use serial_test::serial;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    struct NamedTestLock {
        path: PathBuf,
    }

    impl NamedTestLock {
        fn acquire() -> Self {
            let path = std::env::temp_dir().join("worktree-manager-command-test-global-lock");
            loop {
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(e) => panic!("failed to acquire test lock at {:?}: {}", path, e),
                }
            }
        }
    }

    impl Drop for NamedTestLock {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.path);
        }
    }

    struct ConfigCommandStateGuard {
        _lock: NamedTestLock,
        previous_global: Option<GlobalConfig>,
        previous_home: Option<String>,
        #[cfg(target_os = "windows")]
        previous_appdata: Option<String>,
        #[cfg(target_os = "windows")]
        previous_userprofile: Option<String>,
        _temp_dir: tempfile::TempDir,
    }

    impl ConfigCommandStateGuard {
        fn with_temp_config(config: GlobalConfig) -> Self {
            let lock = NamedTestLock::acquire();
            let temp_dir = tempfile::tempdir().expect("create temp config home");
            let previous_home = std::env::var("HOME").ok();
            #[cfg(target_os = "windows")]
            let previous_appdata = std::env::var("APPDATA").ok();
            #[cfg(target_os = "windows")]
            let previous_userprofile = std::env::var("USERPROFILE").ok();

            set_config_root(temp_dir.path());
            let previous_global = replace_global_cache(Some(config));

            Self {
                _lock: lock,
                previous_global,
                previous_home,
                #[cfg(target_os = "windows")]
                previous_appdata,
                #[cfg(target_os = "windows")]
                previous_userprofile,
                _temp_dir: temp_dir,
            }
        }

        fn with_unwritable_config_root(config: GlobalConfig) -> Self {
            let lock = NamedTestLock::acquire();
            let temp_dir = tempfile::tempdir().expect("create temp config parent");
            let file_root = temp_dir.path().join("not-a-directory");
            std::fs::write(&file_root, "file blocks config dir").expect("write file root");

            let previous_home = std::env::var("HOME").ok();
            #[cfg(target_os = "windows")]
            let previous_appdata = std::env::var("APPDATA").ok();
            #[cfg(target_os = "windows")]
            let previous_userprofile = std::env::var("USERPROFILE").ok();

            set_config_root(&file_root);
            let previous_global = replace_global_cache(Some(config));

            Self {
                _lock: lock,
                previous_global,
                previous_home,
                #[cfg(target_os = "windows")]
                previous_appdata,
                #[cfg(target_os = "windows")]
                previous_userprofile,
                _temp_dir: temp_dir,
            }
        }
    }

    impl Drop for ConfigCommandStateGuard {
        fn drop(&mut self) {
            restore_env_var("HOME", &self.previous_home);
            #[cfg(target_os = "windows")]
            {
                restore_env_var("APPDATA", &self.previous_appdata);
                restore_env_var("USERPROFILE", &self.previous_userprofile);
            }
            let _ = replace_global_cache(self.previous_global.take());
        }
    }

    fn replace_global_cache(config: Option<GlobalConfig>) -> Option<GlobalConfig> {
        let mut cache = GLOBAL_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::replace(&mut *cache, config)
    }

    fn set_config_root(path: &Path) {
        #[cfg(target_os = "windows")]
        {
            std::env::set_var("APPDATA", path);
            std::env::remove_var("USERPROFILE");
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::env::set_var("HOME", path);
        }
    }

    fn restore_env_var(key: &str, value: &Option<String>) {
        match value {
            Some(previous) => std::env::set_var(key, previous),
            None => std::env::remove_var(key),
        }
    }

    #[serial]
    #[test]
    fn get_commit_prefix_config_reads_cached_global_values() {
        let config = GlobalConfig {
            commit_prefix_templates: vec!["feat:".to_string(), "fix:".to_string()],
            commit_prefix_enabled: false,
            default_prefix_index: 1,
            ..GlobalConfig::default()
        };
        let _guard = ConfigCommandStateGuard::with_temp_config(config);

        let prefix = get_commit_prefix_config().expect("read prefix config");

        assert_eq!(prefix.templates, vec!["feat:", "fix:"]);
        assert!(!prefix.enabled);
        assert_eq!(prefix.default_index, 1);
    }

    #[serial]
    #[test]
    fn set_commit_prefix_config_truncates_to_three_templates_and_persists() {
        let _guard = ConfigCommandStateGuard::with_temp_config(GlobalConfig::default());
        let config_path = crate::config::get_global_config_path();

        set_commit_prefix_config(
            vec![
                "one".to_string(),
                "two".to_string(),
                "three".to_string(),
                "four".to_string(),
            ],
            false,
            2,
        )
        .expect("save prefix config");
        let saved: GlobalConfig = serde_json::from_str(
            &std::fs::read_to_string(config_path).expect("read saved global config"),
        )
        .expect("parse saved global config");

        assert_eq!(saved.commit_prefix_templates, vec!["one", "two", "three"]);
        assert!(!saved.commit_prefix_enabled);
        assert_eq!(saved.default_prefix_index, 2);
    }

    #[serial]
    #[test]
    fn git_user_config_round_trips_through_global_config_file() {
        let _guard = ConfigCommandStateGuard::with_temp_config(GlobalConfig::default());
        let config_path = crate::config::get_global_config_path();

        set_git_user_global_config(
            Some("Test User".to_string()),
            Some("test@example.com".to_string()),
        )
        .expect("save git user");
        let saved: GlobalConfig = serde_json::from_str(
            &std::fs::read_to_string(config_path).expect("read saved global config"),
        )
        .expect("parse saved global config");

        assert_eq!(saved.git_user_name.as_deref(), Some("Test User"));
        assert_eq!(saved.git_user_email.as_deref(), Some("test@example.com"));
    }

    #[serial]
    #[test]
    fn boolean_config_commands_toggle_and_persist_values() {
        let _guard = ConfigCommandStateGuard::with_temp_config(GlobalConfig::default());
        let config_path = crate::config::get_global_config_path();

        set_skip_git_hooks(true).expect("enable skip hooks");
        set_shell_integration_enabled(false).expect("disable shell integration");
        let saved: GlobalConfig = serde_json::from_str(
            &std::fs::read_to_string(config_path).expect("read saved global config"),
        )
        .expect("parse saved global config");

        assert!(saved.skip_git_hooks);
        assert!(!saved.shell_integration_enabled);
    }

    #[serial]
    #[test]
    fn write_commands_return_error_when_config_directory_cannot_be_created() {
        let _guard = ConfigCommandStateGuard::with_unwritable_config_root(GlobalConfig::default());

        let err = set_skip_git_hooks(true).expect_err("save should fail");

        assert!(
            err.contains("Failed to create config directory"),
            "unexpected error: {err}"
        );
    }
}
