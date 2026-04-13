use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::pty_manager::PtyManager;
use crate::types::{
    AuthRateLimiter, ConnectedClient, GlobalConfig, NonceCache, ShareState, TerminalState,
    WorkspaceConfig,
};

// PTY Manager 全局实例
pub(crate) static PTY_MANAGER: Lazy<Mutex<PtyManager>> =
    Lazy::new(|| Mutex::new(PtyManager::new()));

// 多窗口 workspace 绑定：window_label -> workspace_path
pub(crate) static WINDOW_WORKSPACES: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// 多窗口 worktree 锁定：(workspace_path, worktree_name) -> window_label
// 同一 worktree 只能被一个窗口独占选中
pub(crate) static WORKTREE_LOCKS: Lazy<Mutex<HashMap<(String, String), String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ==================== 分享状态 ====================

pub(crate) static SHARE_STATE: Lazy<Mutex<ShareState>> =
    Lazy::new(|| Mutex::new(ShareState::default()));

// 已认证的 session 集合
pub(crate) static AUTHENTICATED_SESSIONS: Lazy<Mutex<std::collections::HashSet<String>>> =
    Lazy::new(|| Mutex::new(std::collections::HashSet::new()));

// 已连接的客户端追踪
pub(crate) static CONNECTED_CLIENTS: Lazy<Mutex<HashMap<String, ConnectedClient>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(crate) static TOKIO_RT: Lazy<tokio::runtime::Runtime> = Lazy::new(|| {
    tokio::runtime::Runtime::new().expect("Failed to create tokio runtime for sharing")
});

// Broadcast channel for lock state changes (WebSocket push)
// Increased capacity from 64 to 256 to reduce message lag and drops
pub(crate) static LOCK_BROADCAST: Lazy<tokio::sync::broadcast::Sender<String>> = Lazy::new(|| {
    let (tx, _) = tokio::sync::broadcast::channel(256);
    tx
});

// Broadcast channel for terminal state changes (WebSocket push)
// Increased capacity from 64 to 256 to reduce message lag and drops
pub(crate) static TERMINAL_STATE_BROADCAST: Lazy<tokio::sync::broadcast::Sender<String>> =
    Lazy::new(|| {
        let (tx, _) = tokio::sync::broadcast::channel(256);
        tx
    });

// Terminal state cache: (workspace_path, worktree_name) -> TerminalState
pub(crate) static TERMINAL_STATES: Lazy<Mutex<HashMap<(String, String), TerminalState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Global AppHandle for emitting events from anywhere
pub(crate) static APP_HANDLE: Lazy<Mutex<Option<tauri::AppHandle>>> =
    Lazy::new(|| Mutex::new(None));

// Auth rate limiter
pub(crate) static AUTH_RATE_LIMITER: Lazy<Mutex<AuthRateLimiter>> =
    Lazy::new(|| Mutex::new(AuthRateLimiter::new()));

// Nonce cache for challenge-response authentication
pub(crate) static NONCE_CACHE: Lazy<Mutex<NonceCache>> =
    Lazy::new(|| Mutex::new(NonceCache::new()));

// Broadcast channel for voice events (WebSocket push to browser clients)
pub(crate) static VOICE_BROADCAST: Lazy<tokio::sync::broadcast::Sender<String>> = Lazy::new(|| {
    let (tx, _) = tokio::sync::broadcast::channel(64);
    tx
});

// Broadcast channel for per-client notifications (kick events, etc.)
// Messages are JSON strings with a "session_id" field for filtering.
pub(crate) static CLIENT_NOTIFICATION_BROADCAST: Lazy<tokio::sync::broadcast::Sender<String>> =
    Lazy::new(|| {
        let (tx, _) = tokio::sync::broadcast::channel(64);
        tx
    });

// ==================== 全局配置缓存 ====================

pub(crate) static GLOBAL_CONFIG_CACHE: Lazy<Mutex<Option<GlobalConfig>>> =
    Lazy::new(|| Mutex::new(None));
pub(crate) static WORKSPACE_CONFIG_CACHE: Lazy<Mutex<Option<(String, WorkspaceConfig)>>> =
    Lazy::new(|| Mutex::new(None));
