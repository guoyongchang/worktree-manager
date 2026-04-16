use crate::memory::{parser, prompt, queue, types::*};
use std::process::Stdio;
use tokio::process::Command;

fn load_memory_settings() -> MemorySettings {
    let config_path = crate::config::get_global_config_path();
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(memory) = config.get("memory") {
                if let Ok(settings) = serde_json::from_value::<MemorySettings>(memory.clone()) {
                    return settings;
                }
            }
        }
    }
    MemorySettings::default()
}

pub async fn run_archive(id: &str) -> Result<(), String> {
    let item = queue::get_item(id)?
        .ok_or_else(|| format!("Queue item {} not found", id))?;

    if item.status != QueueStatus::Pending {
        return Err(format!("Item {} is not pending (status: {:?})", id, item.status));
    }

    let vault_path = item.worktree.vault_path.clone().unwrap_or_default();

    queue::update_status(id, QueueStatus::Processing, None, &vault_path)?;

    let settings = load_memory_settings();
    let full_prompt = prompt::build_prompt(&item, &settings);

    let prompt_path = std::env::temp_dir().join(format!("memory-archive-prompt-{}.md", id));
    std::fs::write(&prompt_path, &full_prompt)
        .map_err(|e| format!("Failed to write prompt file: {}", e))?;

    let result = match settings.agent.cli {
        AgentCli::Claude => run_claude(&settings.agent, &prompt_path).await,
        AgentCli::Codex => run_codex(&settings.agent, &prompt_path).await,
    };

    let _ = std::fs::remove_file(&prompt_path);

    match result {
        Ok(stdout) => {
            let archive_result = parser::parse_archive_output(&stdout);
            let status = if archive_result.error.is_some() {
                QueueStatus::Failed
            } else {
                QueueStatus::Completed
            };
            queue::update_status(id, status, Some(archive_result), &vault_path)?;
        }
        Err(e) => {
            let archive_result = ArchiveResult {
                files_created: vec![],
                files_updated: vec![],
                summary: String::new(),
                error: Some(e.clone()),
                raw_output: None,
            };
            queue::update_status(id, QueueStatus::Failed, Some(archive_result), &vault_path)?;
        }
    }

    Ok(())
}

async fn run_claude(config: &AgentConfig, prompt_path: &std::path::Path) -> Result<String, String> {
    let mut cmd = Command::new("claude");
    cmd.arg("--print");
    cmd.arg("--dangerously-skip-permissions");

    if let Some(ref model) = config.model {
        cmd.arg("--model").arg(model);
    }

    cmd.arg("--prompt-file").arg(prompt_path);

    if let Some(ref key) = config.api_key {
        cmd.env("ANTHROPIC_API_KEY", key);
    }
    if let Some(ref endpoint) = config.api_endpoint {
        cmd.env("ANTHROPIC_BASE_URL", endpoint);
    }

    for arg in &config.extra_args {
        cmd.arg(arg);
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("claude exited with {}: {}", output.status, stderr))
    }
}

async fn run_codex(config: &AgentConfig, prompt_path: &std::path::Path) -> Result<String, String> {
    let prompt_content = std::fs::read_to_string(prompt_path)
        .map_err(|e| format!("Failed to read prompt file: {}", e))?;

    let mut cmd = Command::new("codex");
    cmd.arg("--quiet");
    cmd.arg("--prompt").arg(&prompt_content);

    if let Some(ref model) = config.model {
        cmd.arg("--model").arg(model);
    }

    if let Some(ref key) = config.api_key {
        cmd.env("OPENAI_API_KEY", key);
    }
    if let Some(ref endpoint) = config.api_endpoint {
        cmd.env("OPENAI_BASE_URL", endpoint);
    }

    for arg in &config.extra_args {
        cmd.arg(arg);
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn codex: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("codex exited with {}: {}", output.status, stderr))
    }
}
