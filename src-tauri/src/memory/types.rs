use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreePayload {
    pub cwd: String,
    pub project: Option<String>,
    pub branch: Option<String>,
    #[serde(rename = "requirementId")]
    pub requirement_id: Option<String>,
    #[serde(rename = "vaultPath")]
    pub vault_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TriggerType {
    PreCompact,
    SessionEnd,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum QueueStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveResult {
    pub files_created: Vec<String>,
    pub files_updated: Vec<String>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryQueueItem {
    pub id: String,
    pub session_id: String,
    pub worktree: WorktreePayload,
    pub conversation: String,
    pub timestamp: String,
    pub trigger: TriggerType,
    pub status: QueueStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ArchiveResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queued_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct QueueSubmitPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub worktree: WorktreePayload,
    pub conversation: String,
    pub timestamp: String,
    pub trigger: TriggerType,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueueItemSummary {
    pub id: String,
    pub session_id: String,
    pub branch: Option<String>,
    pub project: Option<String>,
    pub requirement_id: Option<String>,
    pub trigger: TriggerType,
    pub status: QueueStatus,
    pub timestamp: String,
    pub conversation_preview: String,
    pub result: Option<ArchiveResult>,
}

impl MemoryQueueItem {
    pub fn to_summary(&self) -> QueueItemSummary {
        let preview: String = self.conversation.chars().take(200).collect();
        QueueItemSummary {
            id: self.id.clone(),
            session_id: self.session_id.clone(),
            branch: self.worktree.branch.clone(),
            project: self.worktree.project.clone(),
            requirement_id: self.worktree.requirement_id.clone(),
            trigger: self.trigger.clone(),
            status: self.status.clone(),
            timestamp: self.timestamp.clone(),
            conversation_preview: preview,
            result: self.result.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub cli: AgentCli,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_endpoint: Option<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentCli {
    Claude,
    Codex,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            cli: AgentCli::Claude,
            model: None,
            api_key: None,
            api_endpoint: None,
            extra_args: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySettings {
    #[serde(default)]
    pub agent: AgentConfig,
    #[serde(default = "default_true")]
    pub auto_archive: bool,
    #[serde(default = "default_true")]
    pub create_new_pages: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_prompt: Option<String>,
}

fn default_true() -> bool {
    true
}

impl Default for MemorySettings {
    fn default() -> Self {
        Self {
            agent: AgentConfig::default(),
            auto_archive: true,
            create_new_pages: true,
            custom_prompt: None,
        }
    }
}
