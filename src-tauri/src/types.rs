use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

// ==================== 分享状态 ====================

#[derive(Default)]
pub struct ShareState {
    pub active: bool,
    pub workspace_path: Option<String>,
    pub port: u16,
    pub auth_key: Option<Vec<u8>>,  // PBKDF2 derived key (32 bytes)
    pub auth_salt: Option<Vec<u8>>, // PBKDF2 salt (16 bytes)
    pub shutdown_tx: Option<tokio::sync::watch::Sender<bool>>,
    pub ngrok_url: Option<String>,
    pub ngrok_task: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ConnectedClient {
    pub session_id: String,
    pub ip: String,
    pub user_agent: String,
    pub authenticated_at: String,
    pub last_active: String,
    pub ws_connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalState {
    pub activated_terminals: Vec<String>,
    pub active_terminal_tab: Option<String>,
    pub terminal_visible: bool,
    pub client_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ShareStateInfo {
    pub active: bool,
    pub urls: Vec<String>,
    pub ngrok_url: Option<String>,
    pub workspace_path: Option<String>,
    pub current_workspace_name: Option<String>,
}

// Auth rate limiter: per-IP sliding window (max 5 attempts per 60 seconds)
pub struct AuthRateLimiter {
    attempts: HashMap<String, Vec<Instant>>,
}

impl Default for AuthRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthRateLimiter {
    pub fn new() -> Self {
        Self {
            attempts: HashMap::new(),
        }
    }

    /// Returns true if the request is allowed, false if rate-limited.
    pub fn check_and_record(&mut self, ip: &str) -> bool {
        let window = Duration::from_secs(60);
        let max_attempts = 5;
        let now = Instant::now();

        let attempts = self.attempts.entry(ip.to_string()).or_default();
        // Remove expired entries
        attempts.retain(|t| now.duration_since(*t) < window);

        if attempts.len() >= max_attempts {
            return false;
        }
        attempts.push(now);
        true
    }

    /// Clean up stale entries (call periodically)
    pub fn cleanup(&mut self) {
        let window = Duration::from_secs(60);
        let now = Instant::now();
        self.attempts.retain(|_, attempts| {
            attempts.retain(|t| now.duration_since(*t) < window);
            !attempts.is_empty()
        });
    }
}

// Nonce cache for challenge-response authentication (one-time use, 60s TTL)
pub struct NonceCache {
    entries: HashMap<String, (Instant, Vec<u8>)>, // nonce_hex -> (created_at, nonce_bytes)
}

impl Default for NonceCache {
    fn default() -> Self {
        Self::new()
    }
}

impl NonceCache {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    /// Generate new nonce, store and return hex encoding
    pub fn generate(&mut self) -> Result<String, String> {
        use ring::rand::{SecureRandom, SystemRandom};
        let rng = SystemRandom::new();
        let mut nonce = vec![0u8; 32];
        rng.fill(&mut nonce)
            .map_err(|_| "Failed to generate nonce")?;
        let nonce_hex = hex::encode(&nonce);
        self.entries
            .insert(nonce_hex.clone(), (Instant::now(), nonce));
        Ok(nonce_hex)
    }

    /// Consume nonce (one-time use), return bytes
    pub fn consume(&mut self, nonce_hex: &str) -> Option<Vec<u8>> {
        self.cleanup();
        self.entries.remove(nonce_hex).map(|(_, bytes)| bytes)
    }

    /// Clean up expired nonces (TTL: 60 seconds)
    pub fn cleanup(&mut self) {
        let now = Instant::now();
        self.entries
            .retain(|_, (created, _)| now.duration_since(*created) < Duration::from_secs(60));
    }
}

// ==================== 配置结构 ====================

// 全局配置：存储在 ~/.config/worktree-manager/global.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlobalConfig {
    pub workspaces: Vec<WorkspaceRef>,
    pub current_workspace: Option<String>, // 当前选中的 workspace 路径
    #[serde(default)]
    pub ngrok_token: Option<String>,
    #[serde(default)]
    pub last_share_port: Option<u16>, // 上次使用的分享端口
    #[serde(default)]
    pub dashscope_api_key: Option<String>,
    #[serde(default)]
    pub dashscope_base_url: Option<String>,
    #[serde(default = "default_true")]
    pub voice_refine_enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceRef {
    pub name: String,
    pub path: String,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            workspaces: vec![],
            current_workspace: None,
            ngrok_token: None,
            last_share_port: None,
            dashscope_api_key: None,
            dashscope_base_url: None,
            voice_refine_enabled: true,
        }
    }
}

// Workspace 配置：存储在 {workspace_root}/.worktree-manager.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceConfig {
    pub name: String,
    pub worktrees_dir: String, // 相对路径，如 "worktrees"
    pub projects: Vec<ProjectConfig>,
    #[serde(default = "default_linked_workspace_items")]
    pub linked_workspace_items: Vec<String>, // 要链接到每个 worktree 的全局文件/文件夹
}

pub fn default_linked_workspace_items() -> Vec<String> {
    vec![
        ".claude".to_string(),
        "CLAUDE.md".to_string(),
        "AGENTS.md".to_string(),
        "requirement-docs".to_string(),
    ]
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectConfig {
    pub name: String,
    pub base_branch: String,
    pub test_branch: String,
    pub merge_strategy: String,
    #[serde(default)]
    pub linked_folders: Vec<String>, // 要链接的文件夹列表
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            name: "New Workspace".to_string(),
            worktrees_dir: "worktrees".to_string(),
            projects: vec![],
            linked_workspace_items: default_linked_workspace_items(),
        }
    }
}

// ==================== 数据结构 ====================

#[derive(Debug, Serialize)]
pub struct WorktreeListItem {
    pub name: String,
    /// Display name from mapping.json (for non-ASCII aliased worktrees)
    pub display_name: Option<String>,
    pub path: String,
    pub is_archived: bool,
    pub projects: Vec<ProjectStatus>,
}

#[derive(Debug, Serialize)]
pub struct ProjectStatus {
    pub name: String,
    pub path: String,
    pub current_branch: String,
    pub base_branch: String,
    pub test_branch: String,
    pub has_uncommitted: bool,
    pub uncommitted_count: usize,
    pub is_merged_to_test: bool,
    pub is_merged_to_base: bool,
    pub ahead_of_base: usize,
    pub behind_base: usize,
    pub ahead_of_test: usize,
    pub unpushed_commits: usize,
    pub remote_url: String,
}

#[derive(Debug, Serialize)]
pub struct MainWorkspaceStatus {
    pub path: String,
    pub name: String,
    pub projects: Vec<MainProjectStatus>,
}

#[derive(Debug, Serialize)]
pub struct MainProjectStatus {
    pub name: String,
    pub path: String,
    pub current_branch: String,
    pub has_uncommitted: bool,
    pub uncommitted_count: usize,
    pub is_merged_to_test: bool,
    pub is_merged_to_base: bool,
    pub ahead_of_base: usize,
    pub behind_base: usize,
    pub ahead_of_test: usize,
    pub unpushed_commits: usize,
    pub base_branch: String,
    pub test_branch: String,
    pub linked_folders: Vec<String>,
}

// ==================== 智能软链接扫描 ====================

#[derive(Debug, Serialize, Clone)]
pub struct ScannedFolder {
    pub relative_path: String, // e.g. "packages/web/node_modules"
    pub display_name: String,  // e.g. "node_modules"
    pub size_bytes: u64,
    pub size_display: String, // e.g. "256.3 MB"
    pub is_recommended: bool, // 推荐预选
}

// ==================== Worktree 操作数据结构 ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWorktreeRequest {
    pub name: String,
    /// Optional English folder alias (for non-ASCII names that may break IDEs)
    #[serde(default, alias = "folderName")]
    pub folder_name: Option<String>,
    pub projects: Vec<CreateProjectRequest>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub base_branch: String,
}

#[derive(Debug, Serialize)]
pub struct WorktreeArchiveStatus {
    pub name: String,
    pub can_archive: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub projects: Vec<crate::git_ops::BranchStatus>,
}

// ==================== 向已有 Worktree 添加项目 ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct AddProjectToWorktreeRequest {
    pub worktree_name: String,
    pub project_name: String,
    pub base_branch: String,
}

// ==================== Git 操作 ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct SwitchBranchRequest {
    pub project_path: String,
    pub branch: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CloneProjectRequest {
    pub name: String,
    pub repo_url: String,
    pub base_branch: String,
    pub test_branch: String,
    pub merge_strategy: String,
    pub linked_folders: Vec<String>,
}

// ==================== 扫描已有项目 ====================

#[derive(Debug, Serialize)]
pub struct ExistingProjectInfo {
    pub name: String,
    pub current_branch: String,
    pub is_registered: bool,
}

// ==================== 编辑器 ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenEditorRequest {
    pub path: String,
    pub editor: String,
}

// ==================== 部署到主工作区 ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MainWorkspaceOccupation {
    pub worktree_name: String,
    pub original_branches: HashMap<String, String>, // project_name → original_branch
    pub deployed_at: String,                        // ISO8601
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeployToMainResult {
    pub success: bool,
    pub switched_projects: Vec<String>,
    pub failed_projects: Vec<DeployProjectError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeployProjectError {
    pub project_name: String,
    pub error: String,
}

#[cfg(test)]
mod tests {
    use super::{AuthRateLimiter, NonceCache};

    #[test]
    fn auth_rate_limiter_allows_first_five_attempts_and_blocks_sixth() {
        let mut limiter = AuthRateLimiter::new();

        for attempt in 1..=6 {
            let allowed = limiter.check_and_record("127.0.0.1");
            assert_eq!(
                allowed,
                attempt < 6,
                "unexpected result at attempt {attempt}"
            );
        }
    }

    #[test]
    fn nonce_cache_consumes_nonce_only_once() {
        let mut cache = NonceCache::new();
        let nonce = cache.generate().unwrap();

        let first = cache.consume(&nonce);
        let second = cache.consume(&nonce);

        assert!(first.is_some());
        assert!(second.is_none());
    }
}
