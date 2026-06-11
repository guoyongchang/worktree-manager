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

// Worktree 生命周期串行锁：每个 workspace 一把锁，串行化该 workspace 的
// create / archive / delete / restore / add_project / deploy 操作，防止并发竞态
// 破坏 workspace 配置文件、mapping.json 和 git worktree 注册状态。
pub(crate) static WORKTREE_LIFECYCLE_LOCKS: Lazy<
    Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>>,
> = Lazy::new(|| Mutex::new(HashMap::new()));

/// 获取指定 workspace 的生命周期锁句柄。调用方需对返回的 Arc 调用 `.lock()` 并持有 guard
/// 到整个生命周期操作结束，从而串行化同一 workspace 的 worktree 增删改。
pub(crate) fn workspace_lifecycle_lock(workspace_path: &str) -> std::sync::Arc<Mutex<()>> {
    WORKTREE_LIFECYCLE_LOCKS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .entry(workspace_path.to_string())
        .or_insert_with(|| std::sync::Arc::new(Mutex::new(())))
        .clone()
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ConnectedClient, TerminalState, WorkspaceConfig};
    use serial_test::serial;
    use std::path::PathBuf;
    use std::time::Duration;

    struct NamedTestLock {
        path: PathBuf,
    }

    impl NamedTestLock {
        fn acquire(name: &str) -> Self {
            let path = std::env::temp_dir().join(name);
            loop {
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(err) => panic!("failed to acquire state test lock {:?}: {}", path, err),
                }
            }
        }
    }

    impl Drop for NamedTestLock {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.path);
        }
    }

    struct StateGuard {
        _command_lock: NamedTestLock,
        _config_lock: NamedTestLock,
        previous_windows: HashMap<String, String>,
        previous_worktree_locks: HashMap<(String, String), String>,
        previous_terminal_states: HashMap<(String, String), TerminalState>,
        previous_app_handle: Option<tauri::AppHandle>,
        previous_global_config: Option<GlobalConfig>,
        previous_workspace_config: Option<(String, WorkspaceConfig)>,
    }

    impl StateGuard {
        fn isolated() -> Self {
            let command_lock = NamedTestLock::acquire("worktree-manager-command-test-global-lock");
            let config_lock = NamedTestLock::acquire("worktree-manager-global-config-cache.lock");

            let previous_windows = std::mem::take(
                &mut *WINDOW_WORKSPACES
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()),
            );
            let previous_worktree_locks = std::mem::take(
                &mut *WORKTREE_LOCKS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()),
            );
            let previous_terminal_states = std::mem::take(
                &mut *TERMINAL_STATES
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()),
            );
            let previous_app_handle = APP_HANDLE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
            let previous_global_config = std::mem::take(
                &mut *GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()),
            );
            let previous_workspace_config = std::mem::take(
                &mut *WORKSPACE_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()),
            );

            Self {
                _command_lock: command_lock,
                _config_lock: config_lock,
                previous_windows,
                previous_worktree_locks,
                previous_terminal_states,
                previous_app_handle,
                previous_global_config,
                previous_workspace_config,
            }
        }
    }

    impl Drop for StateGuard {
        fn drop(&mut self) {
            *WORKSPACE_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                self.previous_workspace_config.take();
            *GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                self.previous_global_config.take();
            *APP_HANDLE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = self.previous_app_handle.take();
            *TERMINAL_STATES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.previous_terminal_states);
            *WORKTREE_LOCKS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.previous_worktree_locks);
            *WINDOW_WORKSPACES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.previous_windows);
        }
    }

    #[serial]
    #[test]
    fn global_maps_and_config_caches_store_and_return_exact_values() {
        let _guard = StateGuard::isolated();

        WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert("window-a".to_string(), "/workspace/a".to_string());
        WORKTREE_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                ("/workspace/a".to_string(), "feature-a".to_string()),
                "window-a".to_string(),
            );
        TERMINAL_STATES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                ("/workspace/a".to_string(), "feature-a".to_string()),
                TerminalState {
                    activated_terminals: vec!["shell".to_string()],
                    active_terminal_tab: Some("shell".to_string()),
                    terminal_visible: true,
                    client_id: Some("client-a".to_string()),
                    session_id: Some("pty-a".to_string()),
                },
            );
        let mut global = GlobalConfig::default();
        global.current_workspace = Some("/workspace/a".to_string());
        *GLOBAL_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(global);
        *WORKSPACE_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((
            "/workspace/a".to_string(),
            WorkspaceConfig {
                name: "Workspace A".to_string(),
                ..WorkspaceConfig::default()
            },
        ));

        assert_eq!(
            WINDOW_WORKSPACES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .get("window-a"),
            Some(&"/workspace/a".to_string())
        );
        assert_eq!(
            WORKTREE_LOCKS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .get(&("/workspace/a".to_string(), "feature-a".to_string())),
            Some(&"window-a".to_string())
        );
        assert_eq!(
            TERMINAL_STATES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .get(&("/workspace/a".to_string(), "feature-a".to_string()))
                .expect("terminal state")
                .session_id
                .as_deref(),
            Some("pty-a")
        );
        {
            let mut sessions = AUTHENTICATED_SESSIONS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let had_session = sessions.insert("state-test-session-a".to_string());
            assert!(sessions.contains("state-test-session-a"));
            if !had_session {
                sessions.remove("state-test-session-a");
            }
        }
        {
            let mut clients = CONNECTED_CLIENTS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let previous = clients.insert(
                "state-test-session-a".to_string(),
                ConnectedClient {
                    session_id: "state-test-session-a".to_string(),
                    ip: "127.0.0.1".to_string(),
                    user_agent: "unit-test".to_string(),
                    authenticated_at: "2026-06-11T00:00:00Z".to_string(),
                    last_active: "2026-06-11T00:01:00Z".to_string(),
                    ws_connected: true,
                },
            );
            assert!(
                clients
                    .get("state-test-session-a")
                    .expect("connected client")
                    .ws_connected
            );
            match previous {
                Some(client) => {
                    clients.insert("state-test-session-a".to_string(), client);
                }
                None => {
                    clients.remove("state-test-session-a");
                }
            }
        }
        assert_eq!(
            GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_ref()
                .and_then(|config| config.current_workspace.as_deref()),
            Some("/workspace/a")
        );
        assert_eq!(
            WORKSPACE_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_ref()
                .map(|(_, config)| config.name.as_str()),
            Some("Workspace A")
        );
    }

    #[serial]
    #[test]
    fn share_auth_nonce_runtime_and_broadcast_state_are_accessible() {
        let _guard = StateGuard::isolated();
        let (shutdown_tx, _) = tokio::sync::watch::channel(false);
        {
            let mut share = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut previous = std::mem::take(&mut *share);
            share.active = true;
            share.workspace_path = Some("/workspace/a".to_string());
            share.port = 42819;
            share.auth_key = Some(vec![1; 32]);
            share.auth_salt = Some(vec![2; 16]);
            share.shutdown_tx = Some(shutdown_tx);
            share.ngrok_url = Some("https://example.ngrok-free.app".to_string());
            assert!(share.active);
            assert_eq!(share.workspace_path.as_deref(), Some("/workspace/a"));
            assert_eq!(share.port, 42819);
            assert_eq!(share.auth_key.as_ref().map(Vec::len), Some(32));
            assert_eq!(share.auth_salt.as_ref().map(Vec::len), Some(16));
            assert!(share.shutdown_tx.is_some());
            assert_eq!(
                share.ngrok_url.as_deref(),
                Some("https://example.ngrok-free.app")
            );
            *share = std::mem::take(&mut previous);
        }

        {
            let mut limiter = AUTH_RATE_LIMITER
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut previous = std::mem::replace(&mut *limiter, AuthRateLimiter::new());
            for attempt in 1..=6 {
                assert_eq!(limiter.check_and_record("127.0.0.1"), attempt <= 5);
            }
            *limiter = std::mem::replace(&mut previous, AuthRateLimiter::new());
        }

        {
            let mut cache = NONCE_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut previous = std::mem::replace(&mut *cache, NonceCache::new());
            let nonce = cache.generate().expect("generate nonce");
            let consumed = cache.consume(&nonce);
            assert_eq!(consumed.as_ref().map(Vec::len), Some(32));
            *cache = std::mem::replace(&mut previous, NonceCache::new());
        }

        let runtime_value = TOKIO_RT.block_on(async { 42_u8 });
        assert_eq!(runtime_value, 42);
        assert_eq!(
            PTY_MANAGER
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .session_count(),
            0
        );

        let mut lock_rx = LOCK_BROADCAST.subscribe();
        let mut terminal_rx = TERMINAL_STATE_BROADCAST.subscribe();
        let mut voice_rx = VOICE_BROADCAST.subscribe();
        let mut client_rx = CLIENT_NOTIFICATION_BROADCAST.subscribe();

        assert_eq!(LOCK_BROADCAST.send("lock".to_string()).unwrap(), 1);
        assert_eq!(
            TERMINAL_STATE_BROADCAST
                .send("terminal".to_string())
                .unwrap(),
            1
        );
        assert_eq!(VOICE_BROADCAST.send("voice".to_string()).unwrap(), 1);
        assert_eq!(
            CLIENT_NOTIFICATION_BROADCAST
                .send("{\"session_id\":\"session-a\"}".to_string())
                .unwrap(),
            1
        );

        assert_eq!(lock_rx.try_recv().unwrap(), "lock");
        assert_eq!(terminal_rx.try_recv().unwrap(), "terminal");
        assert_eq!(voice_rx.try_recv().unwrap(), "voice");
        assert_eq!(
            client_rx.try_recv().unwrap(),
            "{\"session_id\":\"session-a\"}"
        );
    }

    #[serial]
    #[test]
    fn lifecycle_lock_is_per_workspace_same_handle_and_distinct_across_workspaces() {
        // 同一 workspace 必须返回指向同一把锁的句柄（两个调用者会互斥），
        // 不同 workspace 必须是不同的锁（彼此不阻塞）。
        let a1 = workspace_lifecycle_lock("/workspace/a");
        let a2 = workspace_lifecycle_lock("/workspace/a");
        let b = workspace_lifecycle_lock("/workspace/b");

        assert!(
            std::sync::Arc::ptr_eq(&a1, &a2),
            "same workspace must share one lock"
        );
        assert!(
            !std::sync::Arc::ptr_eq(&a1, &b),
            "different workspaces must have distinct locks"
        );

        // 不同 workspace 的锁不互斥：持有 a 的锁时仍能拿到 b 的锁。
        let _a_guard = a1.lock().unwrap_or_else(|p| p.into_inner());
        assert!(
            b.try_lock().is_ok(),
            "holding workspace A lock must not block workspace B"
        );
    }

    #[serial]
    #[test]
    fn lifecycle_lock_serializes_concurrent_critical_sections() {
        // 证明：多个线程在同一 workspace 锁下对共享计数器做 read-modify-write，
        // 串行化后不丢更新（这正是修复要解决的配置文件 lost-update 竞态的缩影）。
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let workspace = "/workspace/race-test";
        let counter = Arc::new(AtomicUsize::new(0));
        let max_seen = Arc::new(AtomicUsize::new(0));
        let in_section = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::new();
        for _ in 0..8 {
            let counter = counter.clone();
            let max_seen = max_seen.clone();
            let in_section = in_section.clone();
            handles.push(std::thread::spawn(move || {
                for _ in 0..50 {
                    let lock = workspace_lifecycle_lock(workspace);
                    let _guard = lock.lock().unwrap_or_else(|p| p.into_inner());
                    // 进入临界区的并发数必须始终为 1（证明真正串行）。
                    let now = in_section.fetch_add(1, Ordering::SeqCst) + 1;
                    max_seen.fetch_max(now, Ordering::SeqCst);
                    // 非原子的 read-modify-write，无锁会丢更新。
                    let v = counter.load(Ordering::Relaxed);
                    std::thread::yield_now();
                    counter.store(v + 1, Ordering::Relaxed);
                    in_section.fetch_sub(1, Ordering::SeqCst);
                }
            }));
        }
        for h in handles {
            h.join().expect("thread panicked");
        }

        assert_eq!(
            counter.load(Ordering::Relaxed),
            8 * 50,
            "lost update: lock did not serialize critical sections"
        );
        assert_eq!(
            max_seen.load(Ordering::SeqCst),
            1,
            "more than one thread was in the critical section at once"
        );
    }
}
