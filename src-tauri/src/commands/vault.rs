use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config::get_window_workspace_path;
use crate::config::{load_workspace_config, save_workspace_config_internal};

// ==================== Data Structures ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncedItem {
    pub name: String,
    pub item_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultStatus {
    pub connected: bool,
    pub vault_path: Option<String>,
    pub synced_items: Vec<SyncedItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultLinkResponse {
    pub connected: bool,
    pub synced_items: Vec<SyncedItem>,
    pub error: Option<String>,
    pub warning: Option<String>,
}

// ==================== Core Helper Functions ====================

/// Splits a full vault workspace path into (vault_root, workspace_path).
///
/// Given "/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager",
/// returns ("/Users/guo/Work/GuoVault/Guo", "workspaces/worktree-manager").
///
/// Looks for "/workspaces/" as the split marker. Falls back to using the
/// parent directory as root and filename as workspace_path.
pub fn split_vault_path(full_path: &str) -> Option<(String, String)> {
    if full_path.is_empty() {
        return None;
    }

    // Primary: look for "/workspaces/" marker
    if let Some(idx) = full_path.find("/workspaces/") {
        let vault_root = &full_path[..idx];
        let workspace_path = &full_path[idx + 1..]; // skip the leading '/'
        if !vault_root.is_empty() && !workspace_path.is_empty() {
            return Some((vault_root.to_string(), workspace_path.to_string()));
        }
    }

    // Fallback: parent dir as root, filename as workspace_path
    let path = Path::new(full_path);
    let parent = path.parent()?.to_str()?;
    let file_name = path.file_name()?.to_str()?;
    if parent.is_empty() || file_name.is_empty() {
        return None;
    }
    Some((parent.to_string(), file_name.to_string()))
}

/// Reads the vault path from `.ai/local-overrides.json` in the workspace root.
///
/// Extracts `vaultRoot` and `vaultWorkspacePath`, combines them into
/// `{vaultRoot}/{vaultWorkspacePath}`. Returns None if the file or fields
/// are missing.
pub fn read_vault_path_from_overrides(workspace_root: &Path) -> Option<String> {
    let overrides_path = workspace_root.join(".ai").join("local-overrides.json");
    let content = fs::read_to_string(&overrides_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;

    let vault_root = json.get("vaultRoot")?.as_str()?;
    let vault_workspace_path = json.get("vaultWorkspacePath")?.as_str()?;

    if vault_root.is_empty() || vault_workspace_path.is_empty() {
        return None;
    }

    Some(format!("{}/{}", vault_root, vault_workspace_path))
}

/// Lists vault-synced symlinks in the workspace root directory.
///
/// A synced item is a symlink in workspace_root whose target lives inside
/// the vault workspace directory (read from overrides).
/// Returns a sorted vec. Returns empty vec if no vault is connected.
pub fn list_synced_items(
    workspace_root: &Path,
    vault_workspace_dir: Option<&Path>,
) -> Vec<SyncedItem> {
    let vault_dir = match vault_workspace_dir {
        Some(d) if d.exists() => d,
        _ => return vec![],
    };

    let mut items = vec![];
    if let Ok(entries) = fs::read_dir(workspace_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            // Check if this is a symlink pointing into the vault
            if let Ok(target) = fs::read_link(&path) {
                let target_abs = if target.is_absolute() {
                    target
                } else {
                    workspace_root.join(&target)
                };
                if target_abs.starts_with(vault_dir) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let item_type = if path.is_dir() { "directory" } else { "file" };
                    items.push(SyncedItem {
                        name,
                        item_type: item_type.to_string(),
                    });
                }
            }
        }
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    items
}

/// Built-in files/dirs that must never be overwritten by vault symlinks.
const BUILT_IN_BLACKLIST: &[&str] = &[
    ".DS_Store",
    "Thumbs.db",
    ".git",
    "node_modules",
    ".worktree-manager.json",
    "projects",
    "worktrees",
];

/// Creates symlinks directly in workspace root pointing to vault workspace entries.
///
/// For each entry in `vault_workspace_dir`:
/// - Skips OS metadata files and Worktree built-in files/dirs
/// - If workspace root already has a non-symlink file/dir with the same name,
///   back it up to `{name}.local` before creating the symlink.
/// - If a symlink already exists (from a previous vault link), remove and recreate it.
///
/// `extra_ignored` allows passing additional names to skip (e.g. custom `worktrees_dir`).
///
/// Also removes stale symlinks from any previous vault connection.
pub fn create_vault_symlinks(
    workspace_root: &Path,
    vault_workspace_dir: &Path,
    extra_ignored: &[&str],
) -> Result<Vec<SyncedItem>, String> {
    use std::collections::HashSet;

    // First: remove old vault symlinks (symlinks in workspace root pointing to any vault)
    remove_vault_symlinks(workspace_root)?;

    // Read entries from vault workspace dir
    let entries = fs::read_dir(vault_workspace_dir)
        .map_err(|e| format!("Failed to read vault workspace directory: {}", e))?;

    let ignored: HashSet<&str> = BUILT_IN_BLACKLIST
        .iter()
        .chain(extra_ignored.iter())
        .copied()
        .collect();
    let mut items: Vec<SyncedItem> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let source = entry.path();
        let file_name = entry
            .file_name()
            .to_str()
            .ok_or_else(|| "Invalid file name".to_string())?
            .to_string();

        // Skip blacklisted files
        if ignored.contains(file_name.as_str()) {
            continue;
        }

        let link_path = workspace_root.join(&file_name);

        // Handle existing file/dir/symlink at the link path
        if link_path.symlink_metadata().is_ok() {
            let is_symlink = link_path
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false);

            if is_symlink {
                // Check if it points into the current vault (safe to replace)
                // Otherwise backup the symlink target info before removing
                let is_vault_link = if let Ok(target) = fs::read_link(&link_path) {
                    target.starts_with(&source.parent().unwrap_or(Path::new("")))
                } else {
                    false
                };

                if !is_vault_link {
                    // Non-vault symlink — backup by saving target as {name}.local.link
                    if let Ok(target) = fs::read_link(&link_path) {
                        let backup_path = workspace_root.join(format!("{}.local.link", file_name));
                        fs::write(&backup_path, target.to_string_lossy().as_bytes()).map_err(
                            |e| {
                                format!(
                                    "Failed to backup symlink target for '{}': {}",
                                    file_name, e
                                )
                            },
                        )?;
                        log::info!(
                            "[vault] Backed up symlink {} → {}.local.link",
                            file_name,
                            file_name
                        );
                    }
                }

                fs::remove_file(&link_path).map_err(|e| {
                    format!("Failed to remove existing symlink '{}': {}", file_name, e)
                })?;
            } else {
                // Existing real file/dir — backup to {name}.local
                let backup_path = workspace_root.join(format!("{}.local", file_name));
                fs::rename(&link_path, &backup_path).map_err(|e| {
                    format!(
                        "Failed to backup '{}' to '{}.local': {}",
                        file_name, file_name, e
                    )
                })?;
                log::info!("[vault] Backed up {} → {}.local", file_name, file_name);
            }
        }

        // Create symlink
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&source, &link_path)
                .map_err(|e| format!("Failed to create symlink for '{}': {}", file_name, e))?;
        }
        #[cfg(windows)]
        {
            if source.is_dir() {
                std::os::windows::fs::symlink_dir(&source, &link_path)
                    .map_err(|e| format!("Failed to create symlink for '{}': {}", file_name, e))?;
            } else {
                std::os::windows::fs::symlink_file(&source, &link_path)
                    .map_err(|e| format!("Failed to create symlink for '{}': {}", file_name, e))?;
            }
        }

        let item_type = if source.is_dir() { "directory" } else { "file" };
        items.push(SyncedItem {
            name: file_name,
            item_type: item_type.to_string(),
        });
    }

    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

/// Workspace-critical names that must not appear in a Vault directory.
const CONFLICT_NAMES: &[&str] = &[".worktree-manager.json", "projects", ".git", "node_modules"];

/// Check if vault directory contains files/folders that conflict with workspace structure.
/// Returns a list of conflicting names. Empty means safe to proceed.
fn check_vault_conflicts(
    vault_workspace_dir: &Path,
    extra_ignored: &[&str],
) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(vault_workspace_dir)
        .map_err(|e| format!("Failed to read vault directory: {}", e))?;

    let mut conflicts: Vec<String> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        if name == ".DS_Store" || name == "Thumbs.db" {
            continue;
        }
        if CONFLICT_NAMES.contains(&name.as_str()) {
            conflicts.push(name);
            continue;
        }
        if extra_ignored.contains(&name.as_str()) {
            conflicts.push(name);
        }
    }
    Ok(conflicts)
}

/// Sync vault-linked items from workspace root into every existing worktree.
fn sync_vault_to_all_worktrees(
    workspace_root: &Path,
    worktrees_dir: &str,
    item_names: &[String],
) -> Result<(usize, Vec<String>), String> {
    let worktrees_path = workspace_root.join(worktrees_dir);
    if !worktrees_path.exists() {
        return Ok((0, vec![]));
    }

    let mut synced_count = 0;
    let mut errors: Vec<String> = Vec::new();

    let entries = fs::read_dir(&worktrees_path)
        .map_err(|e| format!("Failed to read worktrees directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') || name.ends_with(".archive") {
            continue;
        }

        for item in item_names {
            let src = workspace_root.join(item);
            let dst = path.join(item);
            if src.exists() && !dst.exists() {
                if let Err(e) = crate::commands::worktree::create_symlink(&src, &dst) {
                    errors.push(format!("{} in {}: {}", item, name, e));
                } else {
                    synced_count += 1;
                }
            }
        }
    }

    Ok((synced_count, errors))
}

/// Removes vault symlinks from workspace root.
///
/// Scans workspace root for symlinks, removes those whose target matches
/// the previously configured vault path (from overrides), or any broken symlinks.
/// Restores `.local` backups if they exist.
fn remove_vault_symlinks_matching(
    workspace_root: &Path,
    vault_path: Option<&Path>,
) -> Result<(), String> {
    if let Ok(entries) = fs::read_dir(workspace_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let meta = match path.symlink_metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            if !meta.file_type().is_symlink() {
                continue;
            }

            let should_remove = if let Ok(target) = fs::read_link(&path) {
                let target_abs = if target.is_absolute() {
                    target.clone()
                } else {
                    workspace_root.join(&target)
                };
                // Remove if pointing into old vault, or if broken
                vault_path.is_some_and(|vp| target_abs.starts_with(vp)) || !target_abs.exists()
            } else {
                false
            };

            if should_remove {
                let name = entry.file_name().to_string_lossy().to_string();
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to remove symlink '{}': {}", name, e))?;

                // Restore .local backup (regular file/dir) if exists
                let backup_path = workspace_root.join(format!("{}.local", name));
                if backup_path.exists() {
                    fs::rename(&backup_path, &path)
                        .map_err(|e| format!("Failed to restore '{}.local': {}", name, e))?;
                    log::info!("[vault] Restored {}.local → {}", name, name);
                }

                // Restore .local.link backup (symlink) if exists
                if restore_local_link_backup(workspace_root, &name)? {
                    log::info!("[vault] Restored symlink {}.local.link → {}", name, name);
                }
            }
        }
    }
    Ok(())
}

fn restore_local_link_backup(workspace_root: &Path, name: &str) -> Result<bool, String> {
    let link_backup = workspace_root.join(format!("{}.local.link", name));
    if !link_backup.exists() {
        return Ok(false);
    }

    let target = fs::read_to_string(&link_backup)
        .map_err(|e| format!("Failed to read symlink backup '{}.local.link': {}", name, e))?;
    let target = target.trim();
    if target.is_empty() {
        return Ok(false);
    }

    let path = workspace_root.join(name);
    let target_path = Path::new(target);

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target_path, &path)
            .map_err(|e| format!("Failed to restore symlink '{}': {}", name, e))?;
    }

    #[cfg(windows)]
    {
        let resolved_target = if target_path.is_absolute() {
            target_path.to_path_buf()
        } else {
            workspace_root.join(target_path)
        };
        let use_dir_symlink = fs::metadata(&resolved_target)
            .map(|m| m.is_dir())
            .unwrap_or(false);

        if use_dir_symlink {
            std::os::windows::fs::symlink_dir(target_path, &path)
                .map_err(|e| format!("Failed to restore symlink '{}': {}", name, e))?;
        } else {
            std::os::windows::fs::symlink_file(target_path, &path)
                .map_err(|e| format!("Failed to restore symlink '{}': {}", name, e))?;
        }
    }

    fs::remove_file(&link_backup).map_err(|e| {
        format!(
            "Failed to remove symlink backup '{}.local.link': {}",
            name, e
        )
    })?;
    Ok(true)
}

fn remove_vault_symlinks(workspace_root: &Path) -> Result<(), String> {
    let vault_path = read_vault_path_from_overrides(workspace_root);
    remove_vault_symlinks_matching(workspace_root, vault_path.as_deref().map(Path::new))
}

/// Saves vault configuration to `.ai/local-overrides.json`.
///
/// Reads existing file (or starts from empty `{}`), sets `vaultRoot` and
/// `vaultWorkspacePath`, and writes back.
pub fn save_vault_to_overrides(
    workspace_root: &Path,
    vault_root: &str,
    vault_workspace_path: &str,
) -> Result<(), String> {
    let ai_dir = workspace_root.join(".ai");
    fs::create_dir_all(&ai_dir).map_err(|e| format!("Failed to create .ai/ directory: {}", e))?;

    let overrides_path = ai_dir.join("local-overrides.json");

    let mut json: serde_json::Value = if overrides_path.exists() {
        let content = fs::read_to_string(&overrides_path)
            .map_err(|e| format!("Failed to read local-overrides.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse local-overrides.json: {}", e))?
    } else {
        serde_json::json!({})
    };

    let obj = json
        .as_object_mut()
        .ok_or_else(|| "local-overrides.json is not a JSON object".to_string())?;
    obj.insert(
        "vaultRoot".to_string(),
        serde_json::Value::String(vault_root.to_string()),
    );
    obj.insert(
        "vaultWorkspacePath".to_string(),
        serde_json::Value::String(vault_workspace_path.to_string()),
    );

    let content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize local-overrides.json: {}", e))?;
    fs::write(&overrides_path, content)
        .map_err(|e| format!("Failed to write local-overrides.json: {}", e))?;

    Ok(())
}

/// Removes vault configuration from `.ai/local-overrides.json`.
///
/// Removes only the `vaultRoot` and `vaultWorkspacePath` fields, preserving
/// other settings.
pub fn clear_vault_from_overrides(workspace_root: &Path) -> Result<(), String> {
    let overrides_path = workspace_root.join(".ai").join("local-overrides.json");

    if !overrides_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&overrides_path)
        .map_err(|e| format!("Failed to read local-overrides.json: {}", e))?;
    let mut json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse local-overrides.json: {}", e))?;

    if let Some(obj) = json.as_object_mut() {
        obj.remove("vaultRoot");
        obj.remove("vaultWorkspacePath");
    }

    let content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize local-overrides.json: {}", e))?;
    fs::write(&overrides_path, content)
        .map_err(|e| format!("Failed to write local-overrides.json: {}", e))?;

    Ok(())
}

/// Update `vault_linked_workspace_items` in `.worktree-manager.json`.
///
/// Sets the field to the given list of item names.
/// Pass an empty vec to clear the field.
pub fn update_vault_linked_items(workspace_root: &Path, items: &[String]) -> Result<(), String> {
    let config_path = workspace_root.join(".worktree-manager.json");
    if !config_path.exists() {
        return Ok(()); // No workspace config — nothing to update
    }

    let workspace_path = workspace_root.to_string_lossy().to_string();
    let mut config = load_workspace_config(&workspace_path);
    config.vault_linked_workspace_items = items.to_vec();
    save_workspace_config_internal(&workspace_path, &config)
}

fn get_vault_linked_items(workspace_root: &Path) -> Vec<String> {
    let config_path = workspace_root.join(".worktree-manager.json");
    if !config_path.exists() {
        return vec![];
    }

    let workspace_path = workspace_root.to_string_lossy().to_string();
    load_workspace_config(&workspace_path).vault_linked_workspace_items
}

fn restore_previous_vault_state(
    workspace_root: &Path,
    attempted_vault_dir: Option<&Path>,
    previous_vault_path: Option<&str>,
    previous_linked_items: &[String],
    extra_ignored: &[&str],
) -> Result<(), String> {
    if let Some(dir) = attempted_vault_dir {
        remove_vault_symlinks_matching(workspace_root, Some(dir))?;
    }

    match previous_vault_path {
        Some(previous_path) => {
            let previous_dir = Path::new(previous_path);
            if !previous_dir.is_dir() {
                return Err(format!(
                    "Cannot restore previous vault directory: {}",
                    previous_path
                ));
            }

            let (vault_root, vault_workspace_path) = split_vault_path(previous_path)
                .ok_or_else(|| format!("Cannot parse previous vault path: {}", previous_path))?;
            save_vault_to_overrides(workspace_root, &vault_root, &vault_workspace_path)?;
            create_vault_symlinks(workspace_root, previous_dir, extra_ignored)?;
        }
        None => {
            clear_vault_from_overrides(workspace_root)?;
        }
    }

    update_vault_linked_items(workspace_root, previous_linked_items)?;
    Ok(())
}

// ==================== Impl Functions ====================

/// Returns the current vault status for the workspace bound to the given window.
pub fn vault_status_impl(window_label: &str) -> Result<VaultStatus, String> {
    let workspace_path =
        get_window_workspace_path(window_label).ok_or("No workspace bound to window")?;
    let workspace_root = Path::new(&workspace_path);

    let vault_full_path = read_vault_path_from_overrides(workspace_root);
    let vault_dir = vault_full_path.as_ref().map(|p| Path::new(p.as_str()));
    let synced_items = list_synced_items(workspace_root, vault_dir);
    let connected = vault_full_path.is_some();

    Ok(VaultStatus {
        connected,
        vault_path: vault_full_path,
        synced_items,
    })
}

/// Links or unlinks a vault for the workspace bound to the given window.
///
/// - `path = Some(...)`: validate, create symlinks, save overrides
/// - `path = None`: remove .vault/, clear overrides
pub fn vault_link_impl(
    window_label: &str,
    path: Option<String>,
) -> Result<VaultLinkResponse, String> {
    let workspace_path =
        get_window_workspace_path(window_label).ok_or("No workspace bound to window")?;
    let workspace_root = Path::new(&workspace_path);

    match path {
        Some(vault_path) => {
            let vault_dir = Path::new(&vault_path);
            let previous_vault_path = read_vault_path_from_overrides(workspace_root);
            let previous_linked_items = get_vault_linked_items(workspace_root);

            // Build extra blacklist from workspace config (e.g. custom worktrees_dir)
            let ws_config = load_workspace_config(&workspace_path);
            let mut extra_ignored: Vec<&str> = Vec::new();
            let worktrees_dir = ws_config.worktrees_dir.as_str();
            if worktrees_dir != "worktrees" {
                extra_ignored.push(worktrees_dir);
            }

            // Validate directory exists
            if !vault_dir.is_dir() {
                return Ok(VaultLinkResponse {
                    connected: false,
                    synced_items: Vec::new(),
                    error: Some(format!("Directory does not exist: {}", vault_path)),
                    warning: None,
                });
            }

            // Check for structural conflicts before proceeding
            let conflicts = check_vault_conflicts(vault_dir, &extra_ignored)?;
            if !conflicts.is_empty() {
                let msg = format!(
                    "以下文件/文件夹与 WorktreeManager 的结构冲突，无法挂载。请移除或更改名字后重试: {}",
                    conflicts.join(", ")
                );
                return Ok(VaultLinkResponse {
                    connected: false,
                    synced_items: Vec::new(),
                    error: Some(msg),
                    warning: None,
                });
            }

            // Prevent self-link
            let canonical_workspace = workspace_root
                .canonicalize()
                .map_err(|e| format!("Failed to resolve workspace path: {}", e))?;
            let canonical_vault = vault_dir
                .canonicalize()
                .map_err(|e| format!("Failed to resolve vault path: {}", e))?;
            if canonical_workspace == canonical_vault {
                return Ok(VaultLinkResponse {
                    connected: false,
                    synced_items: Vec::new(),
                    error: Some("Cannot link a workspace to itself".to_string()),
                    warning: None,
                });
            }

            // Create symlinks
            let synced_items = create_vault_symlinks(workspace_root, vault_dir, &extra_ignored)?;

            // Save overrides
            let (vault_root, vault_workspace_path) = split_vault_path(&vault_path)
                .ok_or_else(|| format!("Cannot parse vault path: {}", vault_path))?;
            let item_names: Vec<String> = synced_items.iter().map(|i| i.name.clone()).collect();
            let persist_result = (|| -> Result<(), String> {
                save_vault_to_overrides(workspace_root, &vault_root, &vault_workspace_path)?;
                update_vault_linked_items(workspace_root, &item_names)?;
                Ok(())
            })();

            if let Err(persist_err) = persist_result {
                restore_previous_vault_state(
                    workspace_root,
                    Some(vault_dir),
                    previous_vault_path.as_deref(),
                    &previous_linked_items,
                    &extra_ignored,
                )
                .map_err(|rollback_err| {
                    format!("{} (rollback failed: {})", persist_err, rollback_err)
                })?;
                return Err(persist_err);
            }

            // Sync vault items to all existing worktrees
            let (synced_count, sync_errors) =
                sync_vault_to_all_worktrees(workspace_root, worktrees_dir, &item_names)?;
            if synced_count > 0 {
                log::info!("[vault] Synced {} items to worktrees", synced_count);
            }
            if !sync_errors.is_empty() {
                log::warn!("[vault] Sync errors: {:?}", sync_errors);
            }

            let warning = if !vault_dir.join("memory").exists() {
                Some("Vault directory does not contain a 'memory/' subdirectory. Memory Wiki features may not work.".to_string())
            } else {
                None
            };

            Ok(VaultLinkResponse {
                connected: true,
                synced_items,
                error: None,
                warning,
            })
        }
        None => {
            let previous_vault_path = read_vault_path_from_overrides(workspace_root);
            let previous_linked_items = get_vault_linked_items(workspace_root);

            // Disconnect: remove vault symlinks, clear overrides, clear linked items
            remove_vault_symlinks(workspace_root)?;
            let persist_result = (|| -> Result<(), String> {
                clear_vault_from_overrides(workspace_root)?;
                update_vault_linked_items(workspace_root, &[])?;
                Ok(())
            })();

            if let Err(persist_err) = persist_result {
                restore_previous_vault_state(
                    workspace_root,
                    None,
                    previous_vault_path.as_deref(),
                    &previous_linked_items,
                    &[],
                )
                .map_err(|rollback_err| {
                    format!("{} (rollback failed: {})", persist_err, rollback_err)
                })?;
                return Err(persist_err);
            }

            Ok(VaultLinkResponse {
                connected: false,
                synced_items: Vec::new(),
                error: None,
                warning: None,
            })
        }
    }
}

// ==================== Tauri IPC Wrappers ====================

#[tauri::command]
pub(crate) fn vault_status(window: tauri::Window) -> Result<VaultStatus, String> {
    vault_status_impl(window.label())
}

#[tauri::command]
pub(crate) fn vault_link(
    window: tauri::Window,
    path: Option<String>,
) -> Result<VaultLinkResponse, String> {
    vault_link_impl(window.label(), path)
}

/// List children of a vault item (file or directory).
/// Returns at most 100 items. Returns an error if the directory contains >99 entries.
#[tauri::command]
pub(crate) fn list_vault_item_children(
    vault_path: String,
    relative_path: String,
) -> Result<Vec<crate::types::VaultItemChild>, String> {
    use std::fs;

    let dir = std::path::Path::new(&vault_path).join(&relative_path);
    if !dir.is_dir() {
        return Err(format!("'{}' is not a directory", relative_path));
    }

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut children: Vec<crate::types::VaultItemChild> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden/system files
        if name.starts_with('.') {
            continue;
        }
        let item_type = if entry.path().is_dir() {
            "directory"
        } else {
            "file"
        };
        children.push(crate::types::VaultItemChild {
            name,
            item_type: item_type.to_string(),
        });
        if children.len() >= 100 {
            return Err(format!(
                "Directory '{}' contains too many items (>99)",
                relative_path
            ));
        }
    }

    children.sort_by(|a, b| match (a.item_type.as_str(), b.item_type.as_str()) {
        ("directory", "file") => std::cmp::Ordering::Less,
        ("file", "directory") => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(children)
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{load_workspace_config, save_workspace_config_internal};
    use crate::state::{WINDOW_WORKSPACES, WORKSPACE_CONFIG_CACHE};
    use crate::types::WorkspaceConfig;
    use std::fs;
    use tempfile::TempDir;

    // ---- split_vault_path ----

    #[test]
    fn test_split_vault_path_with_workspaces() {
        let result = split_vault_path("/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager");
        assert!(result.is_some());
        let (root, ws_path) = result.unwrap();
        assert_eq!(root, "/Users/guo/Work/GuoVault/Guo");
        assert_eq!(ws_path, "workspaces/worktree-manager");
    }

    #[test]
    fn test_split_vault_path_with_nested_workspaces() {
        let result = split_vault_path("/vault/root/workspaces/deep/nested/project");
        assert!(result.is_some());
        let (root, ws_path) = result.unwrap();
        assert_eq!(root, "/vault/root");
        assert_eq!(ws_path, "workspaces/deep/nested/project");
    }

    #[test]
    fn test_split_vault_path_fallback() {
        let result = split_vault_path("/some/random/path");
        assert!(result.is_some());
        let (root, ws_path) = result.unwrap();
        assert_eq!(root, "/some/random");
        assert_eq!(ws_path, "path");
    }

    #[test]
    fn test_split_vault_path_empty() {
        assert!(split_vault_path("").is_none());
    }

    // ---- read_vault_path_from_overrides ----

    #[test]
    fn test_read_overrides_valid() {
        let tmp = TempDir::new().unwrap();
        let ai_dir = tmp.path().join(".ai");
        fs::create_dir_all(&ai_dir).unwrap();
        fs::write(
            ai_dir.join("local-overrides.json"),
            r#"{"vaultRoot": "/Users/guo/Work/GuoVault/Guo", "vaultWorkspacePath": "workspaces/worktree-manager"}"#,
        )
        .unwrap();

        let result = read_vault_path_from_overrides(tmp.path());
        assert_eq!(
            result,
            Some("/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager".to_string())
        );
    }

    #[test]
    fn test_read_overrides_missing_file() {
        let tmp = TempDir::new().unwrap();
        let result = read_vault_path_from_overrides(tmp.path());
        assert!(result.is_none());
    }

    #[test]
    fn test_read_overrides_missing_fields() {
        let tmp = TempDir::new().unwrap();
        let ai_dir = tmp.path().join(".ai");
        fs::create_dir_all(&ai_dir).unwrap();

        // Missing vaultWorkspacePath
        fs::write(
            ai_dir.join("local-overrides.json"),
            r#"{"vaultRoot": "/some/root"}"#,
        )
        .unwrap();
        assert!(read_vault_path_from_overrides(tmp.path()).is_none());

        // Missing vaultRoot
        fs::write(
            ai_dir.join("local-overrides.json"),
            r#"{"vaultWorkspacePath": "workspaces/foo"}"#,
        )
        .unwrap();
        assert!(read_vault_path_from_overrides(tmp.path()).is_none());
    }

    #[test]
    fn test_read_overrides_empty_values() {
        let tmp = TempDir::new().unwrap();
        let ai_dir = tmp.path().join(".ai");
        fs::create_dir_all(&ai_dir).unwrap();
        fs::write(
            ai_dir.join("local-overrides.json"),
            r#"{"vaultRoot": "", "vaultWorkspacePath": "workspaces/foo"}"#,
        )
        .unwrap();
        assert!(read_vault_path_from_overrides(tmp.path()).is_none());
    }

    // ---- list_synced_items ----

    #[test]
    fn test_list_synced_items() {
        let workspace = TempDir::new().unwrap();
        let vault_source = TempDir::new().unwrap();

        // Create vault source entries
        fs::write(vault_source.path().join("CLAUDE.md"), "# test").unwrap();
        fs::create_dir_all(vault_source.path().join("architecture")).unwrap();
        fs::write(vault_source.path().join("repos.md"), "repos").unwrap();

        // Create symlinks in workspace root pointing to vault
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                vault_source.path().join("CLAUDE.md"),
                workspace.path().join("CLAUDE.md"),
            )
            .unwrap();
            std::os::unix::fs::symlink(
                vault_source.path().join("architecture"),
                workspace.path().join("architecture"),
            )
            .unwrap();
            std::os::unix::fs::symlink(
                vault_source.path().join("repos.md"),
                workspace.path().join("repos.md"),
            )
            .unwrap();
        }

        // Also create a non-vault file (should not be listed)
        fs::write(workspace.path().join("local-file.txt"), "local").unwrap();

        let items = list_synced_items(workspace.path(), Some(vault_source.path()));
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].name, "CLAUDE.md");
        assert_eq!(items[0].item_type, "file");
        assert_eq!(items[1].name, "architecture");
        assert_eq!(items[1].item_type, "directory");
        assert_eq!(items[2].name, "repos.md");
        assert_eq!(items[2].item_type, "file");
    }

    #[test]
    fn test_list_synced_items_no_vault() {
        let workspace = TempDir::new().unwrap();
        fs::write(workspace.path().join("local.md"), "local").unwrap();

        let items = list_synced_items(workspace.path(), None);
        assert!(items.is_empty());
    }

    #[test]
    fn test_list_synced_items_no_symlinks() {
        let workspace = TempDir::new().unwrap();
        let vault_source = TempDir::new().unwrap();
        fs::write(workspace.path().join("local.md"), "local").unwrap();

        let items = list_synced_items(workspace.path(), Some(vault_source.path()));
        assert!(items.is_empty());
    }

    // ---- create_vault_symlinks ----

    #[test]
    fn test_create_symlinks_at_workspace_root() {
        let workspace = TempDir::new().unwrap();
        let vault_source = TempDir::new().unwrap();

        fs::write(vault_source.path().join("CLAUDE.md"), "# claude").unwrap();
        fs::create_dir_all(vault_source.path().join("memory")).unwrap();
        fs::write(vault_source.path().join("repos.md"), "repos").unwrap();

        let items = create_vault_symlinks(workspace.path(), vault_source.path(), &[]).unwrap();
        assert_eq!(items.len(), 3);

        // Symlinks created directly in workspace root (not in .vault/)
        assert!(workspace.path().join("CLAUDE.md").exists());
        assert!(workspace.path().join("memory").is_dir());
        assert!(workspace.path().join("repos.md").exists());

        // Verify symlink targets
        let link_target = fs::read_link(workspace.path().join("CLAUDE.md")).unwrap();
        assert_eq!(link_target, vault_source.path().join("CLAUDE.md"));
    }

    #[test]
    fn test_create_symlinks_backs_up_existing_files() {
        let workspace = TempDir::new().unwrap();
        let vault_source = TempDir::new().unwrap();

        // Create existing local file
        fs::write(workspace.path().join("CLAUDE.md"), "local content").unwrap();

        // Vault has same-named file
        fs::write(vault_source.path().join("CLAUDE.md"), "vault content").unwrap();

        let items = create_vault_symlinks(workspace.path(), vault_source.path(), &[]).unwrap();
        assert_eq!(items.len(), 1);

        // Original backed up to .local
        let backup = workspace.path().join("CLAUDE.md.local");
        assert!(backup.exists());
        assert_eq!(fs::read_to_string(&backup).unwrap(), "local content");

        // Symlink created
        let link_target = fs::read_link(workspace.path().join("CLAUDE.md")).unwrap();
        assert_eq!(link_target, vault_source.path().join("CLAUDE.md"));
    }

    #[test]
    fn test_create_symlinks_replaces_old_vault_symlinks() {
        let workspace = TempDir::new().unwrap();
        let vault_source_1 = TempDir::new().unwrap();
        let vault_source_2 = TempDir::new().unwrap();

        // First vault: create symlink manually + set overrides
        fs::write(vault_source_1.path().join("old.md"), "old").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            vault_source_1.path().join("old.md"),
            workspace.path().join("old.md"),
        )
        .unwrap();

        // Point overrides to vault_source_1 so remove_vault_symlinks can identify the old links
        let v1 = vault_source_1.path().to_str().unwrap();
        let parent = Path::new(v1).parent().unwrap().to_str().unwrap();
        let name = Path::new(v1).file_name().unwrap().to_str().unwrap();
        save_vault_to_overrides(workspace.path(), parent, name).unwrap();

        assert!(workspace.path().join("old.md").exists());

        // Second vault: create_vault_symlinks should remove old + create new
        fs::write(vault_source_2.path().join("new.md"), "new").unwrap();
        let items = create_vault_symlinks(workspace.path(), vault_source_2.path(), &[]).unwrap();

        // Old symlink removed, new one created
        assert!(!workspace.path().join("old.md").exists());
        assert!(workspace.path().join("new.md").exists());
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "new.md");
    }

    #[test]
    fn test_disconnect_restores_backups() {
        let workspace = TempDir::new().unwrap();
        let vault_source = TempDir::new().unwrap();

        // Create local file that will be backed up
        fs::write(workspace.path().join("CLAUDE.md"), "local").unwrap();

        // Vault has same-named file
        fs::write(vault_source.path().join("CLAUDE.md"), "vault").unwrap();

        // Connect vault (backs up CLAUDE.md → CLAUDE.md.local)
        create_vault_symlinks(workspace.path(), vault_source.path(), &[]).unwrap();
        assert!(workspace.path().join("CLAUDE.md.local").exists());

        // Set overrides so remove_vault_symlinks can identify the links
        let v = vault_source.path().to_str().unwrap();
        let parent = Path::new(v).parent().unwrap().to_str().unwrap();
        let name = Path::new(v).file_name().unwrap().to_str().unwrap();
        save_vault_to_overrides(workspace.path(), parent, name).unwrap();

        // Disconnect (should restore backup)
        remove_vault_symlinks(workspace.path()).unwrap();
        assert!(!workspace.path().join("CLAUDE.md.local").exists());
        assert!(workspace.path().join("CLAUDE.md").exists());
        assert_eq!(
            fs::read_to_string(workspace.path().join("CLAUDE.md")).unwrap(),
            "local"
        );
    }

    #[test]
    fn test_vault_status_reports_connected_even_with_no_synced_items() {
        let workspace = TempDir::new().unwrap();
        let vault_source = TempDir::new().unwrap();
        let workspace_path = workspace.path().to_string_lossy().to_string();
        let window_label = "vault-status-empty-test";

        {
            let mut windows = WINDOW_WORKSPACES.lock().unwrap();
            windows.insert(window_label.to_string(), workspace_path.clone());
        }
        {
            let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
            *cache = None;
        }

        save_workspace_config_internal(
            &workspace_path,
            &WorkspaceConfig {
                name: "demo".to_string(),
                ..WorkspaceConfig::default()
            },
        )
        .unwrap();

        let v = vault_source.path().to_str().unwrap();
        let parent = Path::new(v).parent().unwrap().to_str().unwrap();
        let name = Path::new(v).file_name().unwrap().to_str().unwrap();
        save_vault_to_overrides(workspace.path(), parent, name).unwrap();

        let status = vault_status_impl(window_label).unwrap();
        assert!(status.connected);
        assert_eq!(
            status.vault_path,
            Some(vault_source.path().to_string_lossy().to_string())
        );
        assert!(status.synced_items.is_empty());

        {
            let mut windows = WINDOW_WORKSPACES.lock().unwrap();
            windows.remove(window_label);
        }
        {
            let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
            *cache = None;
        }
    }

    #[test]
    fn test_create_symlinks_backs_up_non_vault_symlink_and_disconnect_restores_it() {
        let workspace = TempDir::new().unwrap();
        let local_target_dir = TempDir::new().unwrap();
        let vault_source = TempDir::new().unwrap();

        let local_target = local_target_dir.path().join("local-claude.md");
        fs::write(&local_target, "local symlink target").unwrap();
        fs::write(vault_source.path().join("CLAUDE.md"), "vault").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&local_target, workspace.path().join("CLAUDE.md")).unwrap();

        create_vault_symlinks(workspace.path(), vault_source.path(), &[]).unwrap();

        let link_backup = workspace.path().join("CLAUDE.md.local.link");
        assert!(link_backup.exists());
        assert_eq!(
            fs::read_to_string(&link_backup).unwrap(),
            local_target.to_string_lossy()
        );

        let link_target = fs::read_link(workspace.path().join("CLAUDE.md")).unwrap();
        assert_eq!(link_target, vault_source.path().join("CLAUDE.md"));

        let v = vault_source.path().to_str().unwrap();
        let parent = Path::new(v).parent().unwrap().to_str().unwrap();
        let name = Path::new(v).file_name().unwrap().to_str().unwrap();
        save_vault_to_overrides(workspace.path(), parent, name).unwrap();

        remove_vault_symlinks(workspace.path()).unwrap();

        assert!(!link_backup.exists());
        let restored_target = fs::read_link(workspace.path().join("CLAUDE.md")).unwrap();
        assert_eq!(restored_target, local_target);
    }

    #[test]
    fn test_restore_local_link_backup_helper_recreates_symlink() {
        let workspace = TempDir::new().unwrap();
        let local_target_dir = TempDir::new().unwrap();

        let local_target = local_target_dir.path().join("local-claude.md");
        fs::write(&local_target, "local symlink target").unwrap();

        let link_backup = workspace.path().join("CLAUDE.md.local.link");
        fs::write(&link_backup, local_target.to_string_lossy().as_bytes()).unwrap();

        let restored = restore_local_link_backup(workspace.path(), "CLAUDE.md").unwrap();
        assert!(restored);
        assert!(!link_backup.exists());

        let restored_target = fs::read_link(workspace.path().join("CLAUDE.md")).unwrap();
        assert_eq!(restored_target, local_target);
    }

    #[cfg(windows)]
    #[test]
    fn test_restore_local_link_backup_helper_recreates_directory_symlink_on_windows() {
        let workspace = TempDir::new().unwrap();
        let local_target_dir = TempDir::new().unwrap();

        let local_target = local_target_dir.path().join("local-directory");
        fs::create_dir_all(&local_target).unwrap();

        let link_backup = workspace.path().join("memory.local.link");
        fs::write(&link_backup, local_target.to_string_lossy().as_bytes()).unwrap();

        let restored = restore_local_link_backup(workspace.path(), "memory").unwrap();
        assert!(restored);
        assert!(!link_backup.exists());

        let restored_target = fs::read_link(workspace.path().join("memory")).unwrap();
        assert_eq!(restored_target, local_target);
    }

    #[test]
    fn test_update_vault_linked_items_refreshes_workspace_config_cache() {
        let workspace = TempDir::new().unwrap();
        let workspace_path = workspace.path().to_string_lossy().to_string();

        {
            let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
            *cache = None;
        }

        save_workspace_config_internal(
            &workspace_path,
            &WorkspaceConfig {
                name: "demo".to_string(),
                ..WorkspaceConfig::default()
            },
        )
        .unwrap();

        let initial = load_workspace_config(&workspace_path);
        assert!(initial.vault_linked_workspace_items.is_empty());

        update_vault_linked_items(workspace.path(), &[String::from("memory")]).unwrap();

        let updated = load_workspace_config(&workspace_path);
        assert_eq!(updated.vault_linked_workspace_items, vec!["memory"]);

        {
            let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
            *cache = None;
        }
    }

    #[test]
    fn test_vault_link_rolls_back_workspace_changes_when_overrides_save_fails() {
        let workspace = TempDir::new().unwrap();
        let vault_source = TempDir::new().unwrap();
        let workspace_path = workspace.path().to_string_lossy().to_string();
        let window_label = "vault-rollback-test";

        {
            let mut windows = WINDOW_WORKSPACES.lock().unwrap();
            windows.insert(window_label.to_string(), workspace_path.clone());
        }
        {
            let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
            *cache = None;
        }

        save_workspace_config_internal(
            &workspace_path,
            &WorkspaceConfig {
                name: "demo".to_string(),
                ..WorkspaceConfig::default()
            },
        )
        .unwrap();

        fs::write(workspace.path().join("CLAUDE.md"), "local content").unwrap();
        fs::write(vault_source.path().join("CLAUDE.md"), "vault content").unwrap();

        let ai_dir = workspace.path().join(".ai");
        fs::create_dir_all(&ai_dir).unwrap();
        fs::create_dir(ai_dir.join("local-overrides.json")).unwrap();

        let err = vault_link_impl(
            window_label,
            Some(vault_source.path().to_string_lossy().to_string()),
        )
        .unwrap_err();

        assert!(err.contains("local-overrides.json"));
        assert_eq!(
            fs::read_to_string(workspace.path().join("CLAUDE.md")).unwrap(),
            "local content"
        );
        assert!(!workspace
            .path()
            .join("CLAUDE.md")
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!workspace.path().join("CLAUDE.md.local").exists());
        assert!(load_workspace_config(&workspace_path)
            .vault_linked_workspace_items
            .is_empty());

        {
            let mut windows = WINDOW_WORKSPACES.lock().unwrap();
            windows.remove(window_label);
        }
        {
            let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
            *cache = None;
        }
    }

    // ---- save/clear overrides ----

    #[test]
    fn test_save_and_clear_overrides() {
        let tmp = TempDir::new().unwrap();

        // Save vault info
        save_vault_to_overrides(
            tmp.path(),
            "/Users/guo/Work/GuoVault/Guo",
            "workspaces/worktree-manager",
        )
        .unwrap();

        // Verify it was saved
        let overrides_path = tmp.path().join(".ai").join("local-overrides.json");
        assert!(overrides_path.exists());

        let content = fs::read_to_string(&overrides_path).unwrap();
        let json: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(
            json["vaultRoot"].as_str().unwrap(),
            "/Users/guo/Work/GuoVault/Guo"
        );
        assert_eq!(
            json["vaultWorkspacePath"].as_str().unwrap(),
            "workspaces/worktree-manager"
        );

        // Read it back
        let read_result = read_vault_path_from_overrides(tmp.path());
        assert_eq!(
            read_result,
            Some("/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager".to_string())
        );

        // Clear vault info
        clear_vault_from_overrides(tmp.path()).unwrap();

        // Verify fields are gone
        let content = fs::read_to_string(&overrides_path).unwrap();
        let json: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(json.get("vaultRoot").is_none());
        assert!(json.get("vaultWorkspacePath").is_none());

        // Read should return None
        assert!(read_vault_path_from_overrides(tmp.path()).is_none());
    }

    #[test]
    fn test_save_overrides_preserves_other_fields() {
        let tmp = TempDir::new().unwrap();
        let ai_dir = tmp.path().join(".ai");
        fs::create_dir_all(&ai_dir).unwrap();

        // Write existing overrides with other fields
        fs::write(
            ai_dir.join("local-overrides.json"),
            r#"{"someOtherSetting": true, "anotherField": "hello"}"#,
        )
        .unwrap();

        // Save vault info
        save_vault_to_overrides(tmp.path(), "/vault/root", "workspaces/test").unwrap();

        // Verify other fields are preserved
        let content = fs::read_to_string(ai_dir.join("local-overrides.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(json["someOtherSetting"].as_bool().unwrap(), true);
        assert_eq!(json["anotherField"].as_str().unwrap(), "hello");
        assert_eq!(json["vaultRoot"].as_str().unwrap(), "/vault/root");
        assert_eq!(
            json["vaultWorkspacePath"].as_str().unwrap(),
            "workspaces/test"
        );

        // Clear vault info - other fields should remain
        clear_vault_from_overrides(tmp.path()).unwrap();
        let content = fs::read_to_string(ai_dir.join("local-overrides.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(json["someOtherSetting"].as_bool().unwrap(), true);
        assert_eq!(json["anotherField"].as_str().unwrap(), "hello");
        assert!(json.get("vaultRoot").is_none());
        assert!(json.get("vaultWorkspacePath").is_none());
    }

    #[test]
    fn test_clear_overrides_missing_file() {
        let tmp = TempDir::new().unwrap();
        // Should not error if file doesn't exist
        let result = clear_vault_from_overrides(tmp.path());
        assert!(result.is_ok());
    }
}
