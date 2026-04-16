use crate::memory::types::{MemoryQueueItem, MemorySettings};
use std::fs;
use std::path::Path;

const DEFAULT_TEMPLATE: &str = include_str!("prompt_template.md");

pub fn build_prompt(item: &MemoryQueueItem, settings: &MemorySettings) -> String {
    let template = resolve_template(item, settings);

    let workspace_root = find_workspace_root(&item.worktree.cwd);
    let vault_path = item
        .worktree
        .vault_path
        .clone()
        .unwrap_or_else(|| format!("{}/.vault", workspace_root));

    template
        .replace("{workspace_root}", &workspace_root)
        .replace("{vault_path}", &vault_path)
        .replace(
            "{branch}",
            item.worktree.branch.as_deref().unwrap_or("unknown"),
        )
        .replace(
            "{project}",
            item.worktree.project.as_deref().unwrap_or("unknown"),
        )
        .replace(
            "{requirement_id}",
            item.worktree.requirement_id.as_deref().unwrap_or("none"),
        )
        .replace("{conversation}", &item.conversation)
}

fn resolve_template(item: &MemoryQueueItem, settings: &MemorySettings) -> String {
    if let Some(ref custom) = settings.custom_prompt {
        if !custom.trim().is_empty() {
            return custom.clone();
        }
    }

    if let Some(ref vault_path) = item.worktree.vault_path {
        let ws_prompt = Path::new(vault_path).join("memory-archive-prompt.md");
        if ws_prompt.exists() {
            if let Ok(content) = fs::read_to_string(&ws_prompt) {
                if !content.trim().is_empty() {
                    return content;
                }
            }
        }
    }

    DEFAULT_TEMPLATE.to_string()
}

fn find_workspace_root(cwd: &str) -> String {
    let mut current = Path::new(cwd);
    while let Some(parent) = current.parent() {
        if parent.join(".worktree-manager").exists()
            || parent.join(".worktree-manager.json").exists()
        {
            return parent.to_string_lossy().to_string();
        }
        current = parent;
    }
    cwd.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_template_contains_required_variables() {
        let template = DEFAULT_TEMPLATE;
        assert!(template.contains("{workspace_root}"));
        assert!(template.contains("{vault_path}"));
        assert!(template.contains("{branch}"));
        assert!(template.contains("{project}"));
        assert!(template.contains("{requirement_id}"));
        assert!(template.contains("{conversation}"));
        assert!(template.contains("<memory-archive-result>"));
    }
}
