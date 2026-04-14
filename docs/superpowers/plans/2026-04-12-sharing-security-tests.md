# Sharing Security Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable, high-signal security tests for the sharing/browser-access boundary so authentication, localhost-only protections, nonce usage, and rate limiting are enforced by CI.

**Architecture:** Extend the existing Rust test surface instead of introducing a new test harness. Router-level tests in `src-tauri/src/http_server.rs` will verify real middleware and handler behavior through `create_router()`, while pure logic tests in `src-tauri/src/types.rs` will cover `AuthRateLimiter` and `NonceCache` directly. Tests that mutate global sharing state must use a test-only mutex plus a guard that snapshots and restores the relevant global state.

**Tech Stack:** Rust, Axum, Tokio, tower `oneshot`, serde_json, ring HMAC, cargo test

---

## File Structure

- `src-tauri/src/http_server.rs`
  Extend `#[cfg(test)] mod tests` with a global test mutex, stronger state guard, request/response helpers, and router-level security tests.
- `src-tauri/src/types.rs`
  Add focused unit tests for `AuthRateLimiter` and `NonceCache`.
- `docs/TESTING.md`
  Add a short “Security Surfaces” matrix so future contributors know which layer owns each security behavior.

---

### Task 1: Add test isolation helpers and middleware security tests

**Files:**
- Modify: `src-tauri/src/http_server.rs`
- Test: `src-tauri/src/http_server.rs`

- [ ] **Step 1: Write the failing router tests for auth and localhost-only behavior**

Add these tests inside `src-tauri/src/http_server.rs` under `#[cfg(test)] mod tests`:

```rust
#[tokio::test]
async fn auth_middleware_rejects_unauthenticated_protected_route() {
    let _serial = TEST_MUTEX.lock().unwrap();
    let _guard = ShareStateTestGuard::with_auth_enabled();

    let response = request_with_addr(
        SocketAddr::from(([127, 0, 0, 1], 31001)),
        Request::builder()
            .method(Method::POST)
            .uri("/api/get_share_state")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-session-id", "unauth-session")
            .body(Body::from("{}"))
            .unwrap(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_middleware_allows_authenticated_protected_route() {
    let _serial = TEST_MUTEX.lock().unwrap();
    let _guard = ShareStateTestGuard::with_auth_enabled();
    AUTHENTICATED_SESSIONS
        .lock()
        .unwrap()
        .insert("auth-session".to_string());

    let response = request_with_addr(
        SocketAddr::from(([127, 0, 0, 1], 31002)),
        Request::builder()
            .method(Method::POST)
            .uri("/api/get_share_state")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-session-id", "auth-session")
            .body(Body::from("{}"))
            .unwrap(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn localhost_only_middleware_blocks_remote_clients() {
    let _serial = TEST_MUTEX.lock().unwrap();
    let _guard = ShareStateTestGuard::without_password();

    let response = request_with_addr(
        SocketAddr::from(([203, 0, 113, 9], 32001)),
        Request::builder()
            .method(Method::POST)
            .uri("/api/get_ngrok_token")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{}"))
            .unwrap(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn localhost_only_middleware_allows_loopback_clients() {
    let _serial = TEST_MUTEX.lock().unwrap();
    let _guard = ShareStateTestGuard::without_password();

    let response = request_with_addr(
        SocketAddr::from(([127, 0, 0, 1], 32002)),
        Request::builder()
            .method(Method::POST)
            .uri("/api/get_ngrok_token")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{}"))
            .unwrap(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
}
```

- [ ] **Step 2: Run the targeted Rust tests to verify they fail**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
cargo test --manifest-path src-tauri/Cargo.toml auth_middleware_rejects_unauthenticated_protected_route -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml localhost_only_middleware_blocks_remote_clients -- --test-threads=1
```

Expected:
- At least one test fails because the helper infrastructure (`TEST_MUTEX`, `ShareStateTestGuard`, `request_with_addr`) does not exist yet.

- [ ] **Step 3: Implement the minimal test helper infrastructure**

Add these helpers to the same test module in `src-tauri/src/http_server.rs`:

```rust
static TEST_MUTEX: once_cell::sync::Lazy<std::sync::Mutex<()>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(()));

struct ShareStateTestGuard {
    prev_share_state: crate::ShareState,
    prev_sessions: std::collections::HashSet<String>,
    prev_clients: std::collections::HashMap<String, crate::ConnectedClient>,
    prev_rate_limiter: crate::AuthRateLimiter,
    prev_nonce_cache: crate::NonceCache,
}

impl ShareStateTestGuard {
    fn with_auth_enabled() -> Self {
        let mut guard = Self::capture();
        {
            let mut state = SHARE_STATE.lock().unwrap();
            state.active = true;
            state.auth_key = Some(b"test-auth-key".to_vec());
            state.auth_salt = Some(b"test-auth-salt".to_vec());
            state.workspace_path = Some("/tmp/test-workspace".to_string());
        }
        guard
    }

    fn without_password() -> Self {
        let mut guard = Self::capture();
        {
            let mut state = SHARE_STATE.lock().unwrap();
            state.active = false;
            state.auth_key = None;
            state.auth_salt = None;
            state.workspace_path = None;
        }
        guard
    }

    fn capture() -> Self {
        let prev_share_state = {
            let mut state = SHARE_STATE.lock().unwrap();
            std::mem::take(&mut *state)
        };
        let prev_sessions = {
            let mut sessions = AUTHENTICATED_SESSIONS.lock().unwrap();
            std::mem::take(&mut *sessions)
        };
        let prev_clients = {
            let mut clients = CONNECTED_CLIENTS.lock().unwrap();
            std::mem::take(&mut *clients)
        };
        let prev_rate_limiter = {
            let mut limiter = AUTH_RATE_LIMITER.lock().unwrap();
            std::mem::replace(&mut *limiter, crate::AuthRateLimiter::new())
        };
        let prev_nonce_cache = {
            let mut cache = NONCE_CACHE.lock().unwrap();
            std::mem::replace(&mut *cache, crate::NonceCache::new())
        };

        Self {
            prev_share_state,
            prev_sessions,
            prev_clients,
            prev_rate_limiter,
            prev_nonce_cache,
        }
    }
}

impl Drop for ShareStateTestGuard {
    fn drop(&mut self) {
        *SHARE_STATE.lock().unwrap() = std::mem::take(&mut self.prev_share_state);
        *AUTHENTICATED_SESSIONS.lock().unwrap() = std::mem::take(&mut self.prev_sessions);
        *CONNECTED_CLIENTS.lock().unwrap() = std::mem::take(&mut self.prev_clients);
        *AUTH_RATE_LIMITER.lock().unwrap() =
            std::mem::replace(&mut self.prev_rate_limiter, crate::AuthRateLimiter::new());
        *NONCE_CACHE.lock().unwrap() =
            std::mem::replace(&mut self.prev_nonce_cache, crate::NonceCache::new());
    }
}

async fn request_with_addr(addr: SocketAddr, request: Request<Body>) -> Response {
    let make_svc = create_router(Some("dummy-cert-pem".to_string()))
        .into_make_service_with_connect_info::<SocketAddr>();
    let svc = make_svc.oneshot(addr).await.unwrap();
    svc.oneshot(request).await.unwrap()
}
```

Also add these imports to the test module:

```rust
use crate::{AUTH_RATE_LIMITER, CONNECTED_CLIENTS, NONCE_CACHE};
use tower::ServiceExt;
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
cargo test --manifest-path src-tauri/Cargo.toml auth_middleware_rejects_unauthenticated_protected_route -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml auth_middleware_allows_authenticated_protected_route -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml localhost_only_middleware_blocks_remote_clients -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml localhost_only_middleware_allows_loopback_clients -- --test-threads=1
```

Expected:
- All four targeted tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
git add src-tauri/src/http_server.rs
git commit -m "test: cover auth and localhost share boundaries"
```

---

### Task 2: Add challenge/verify/router security semantics tests

**Files:**
- Modify: `src-tauri/src/http_server.rs`
- Test: `src-tauri/src/http_server.rs`

- [ ] **Step 1: Write the failing tests for challenge, verify, nonce reuse, and stale-session cleanup**

Add these tests to `src-tauri/src/http_server.rs`:

```rust
#[tokio::test]
async fn auth_challenge_requires_configured_salt() {
    let _serial = TEST_MUTEX.lock().unwrap();
    let _guard = ShareStateTestGuard::without_password();

    {
        let mut state = SHARE_STATE.lock().unwrap();
        state.active = true;
        state.auth_key = Some(b"test-auth-key".to_vec());
        state.auth_salt = None;
    }

    let response = request_with_addr(
        SocketAddr::from(([127, 0, 0, 1], 33001)),
        Request::builder()
            .method(Method::POST)
            .uri("/api/auth/challenge")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{}"))
            .unwrap(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn auth_challenge_rate_limits_after_five_attempts() {
    let _serial = TEST_MUTEX.lock().unwrap();
    let _guard = ShareStateTestGuard::with_auth_enabled();

    for attempt in 1..=6 {
        let response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 33002)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/challenge")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;

        let expected = if attempt < 6 {
            StatusCode::OK
        } else {
            StatusCode::TOO_MANY_REQUESTS
        };
        assert_eq!(response.status(), expected);
    }
}

#[tokio::test]
async fn auth_verify_accepts_valid_proof_and_rejects_nonce_reuse() {
    let _serial = TEST_MUTEX.lock().unwrap();
    let _guard = ShareStateTestGuard::with_auth_enabled();

    let challenge = request_json(
        SocketAddr::from(([127, 0, 0, 1], 33003)),
        "/api/auth/challenge",
        json!({}),
        None,
    )
    .await;

    let nonce = challenge["nonce"].as_str().unwrap().to_string();
    let proof = build_proof_hex(b"test-auth-key", &nonce);

    let verify_response = request_json(
        SocketAddr::from(([127, 0, 0, 1], 33003)),
        "/api/auth/verify",
        json!({ "nonce": nonce, "proof": proof }),
        Some("test-agent/1.0"),
    )
    .await;

    assert_eq!(verify_response.0, StatusCode::OK);

    let second_response = request_json(
        SocketAddr::from(([127, 0, 0, 1], 33003)),
        "/api/auth/verify",
        json!({ "nonce": verify_response.1["nonce"], "proof": "deadbeef" }),
        Some("test-agent/1.0"),
    )
    .await;

    assert_eq!(second_response.0, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_verify_replaces_stale_sessions_from_same_ip() {
    let _serial = TEST_MUTEX.lock().unwrap();
    let _guard = ShareStateTestGuard::with_auth_enabled();

    CONNECTED_CLIENTS.lock().unwrap().insert(
        "stale-session".to_string(),
        crate::ConnectedClient {
            session_id: "stale-session".to_string(),
            ip: "127.0.0.1".to_string(),
            user_agent: "old".to_string(),
            authenticated_at: "2026-04-12T00:00:00Z".to_string(),
            last_active: "2026-04-12T00:00:00Z".to_string(),
            ws_connected: false,
        },
    );
    AUTHENTICATED_SESSIONS
        .lock()
        .unwrap()
        .insert("stale-session".to_string());

    let challenge = request_json(
        SocketAddr::from(([127, 0, 0, 1], 33004)),
        "/api/auth/challenge",
        json!({}),
        None,
    )
    .await;
    let nonce = challenge["nonce"].as_str().unwrap().to_string();
    let proof = build_proof_hex(b"test-auth-key", &nonce);

    let (status, body) = request_json(
        SocketAddr::from(([127, 0, 0, 1], 33004)),
        "/api/auth/verify",
        json!({ "nonce": nonce, "proof": proof }),
        Some("test-agent/1.0"),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let new_session = body["sessionId"].as_str().unwrap();
    assert!(!AUTHENTICATED_SESSIONS.lock().unwrap().contains("stale-session"));
    assert!(AUTHENTICATED_SESSIONS.lock().unwrap().contains(new_session));
}
```

- [ ] **Step 2: Run the challenge/verify tests to verify they fail**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
cargo test --manifest-path src-tauri/Cargo.toml auth_challenge_requires_configured_salt -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml auth_verify_accepts_valid_proof_and_rejects_nonce_reuse -- --test-threads=1
```

Expected:
- The tests fail because `request_json` and `build_proof_hex` do not exist yet, and at least one assertion around response parsing is not wired up.

- [ ] **Step 3: Implement the minimal request/response helpers and adjust assertions**

Add these helpers to the test module:

```rust
async fn response_json(response: Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn request_json(
    addr: SocketAddr,
    path: &str,
    payload: serde_json::Value,
    user_agent: Option<&str>,
) -> (StatusCode, serde_json::Value) {
    let mut builder = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json");

    if let Some(user_agent) = user_agent {
        builder = builder.header(header::USER_AGENT, user_agent);
    }

    let response = request_with_addr(
        addr,
        builder.body(Body::from(payload.to_string())).unwrap(),
    )
    .await;
    let status = response.status();
    let body = response_json(response).await;
    (status, body)
}

fn build_proof_hex(auth_key: &[u8], nonce_hex: &str) -> String {
    let nonce_bytes = hex::decode(nonce_hex).unwrap();
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, auth_key);
    hex::encode(ring::hmac::sign(&key, &nonce_bytes).as_ref())
}
```

Fix the nonce-reuse test so the second verify request reuses the original `nonce` string:

```rust
let second_response = request_json(
    SocketAddr::from(([127, 0, 0, 1], 33003)),
    "/api/auth/verify",
    json!({ "nonce": nonce, "proof": proof }),
    Some("test-agent/1.0"),
)
.await;
assert_eq!(second_response.0, StatusCode::UNAUTHORIZED);
```

Also add one explicit bad-proof test:

```rust
#[tokio::test]
async fn auth_verify_rejects_bad_proof() {
    let _serial = TEST_MUTEX.lock().unwrap();
    let _guard = ShareStateTestGuard::with_auth_enabled();

    let (_, challenge) = request_json(
        SocketAddr::from(([127, 0, 0, 1], 33005)),
        "/api/auth/challenge",
        json!({}),
        None,
    )
    .await;
    let nonce = challenge["nonce"].as_str().unwrap().to_string();

    let response = request_json(
        SocketAddr::from(([127, 0, 0, 1], 33005)),
        "/api/auth/verify",
        json!({ "nonce": nonce, "proof": "00" }),
        Some("test-agent/1.0"),
    )
    .await;

    assert_eq!(response.0, StatusCode::UNAUTHORIZED);
}
```

- [ ] **Step 4: Run the targeted challenge/verify tests to verify they pass**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
cargo test --manifest-path src-tauri/Cargo.toml auth_challenge_requires_configured_salt -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml auth_challenge_rate_limits_after_five_attempts -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml auth_verify_accepts_valid_proof_and_rejects_nonce_reuse -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml auth_verify_rejects_bad_proof -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml auth_verify_replaces_stale_sessions_from_same_ip -- --test-threads=1
```

Expected:
- All targeted challenge/verify tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
git add src-tauri/src/http_server.rs
git commit -m "test: cover share auth challenge and verify flows"
```

---

### Task 3: Add pure logic tests for rate limiting and nonce cache

**Files:**
- Modify: `src-tauri/src/types.rs`
- Test: `src-tauri/src/types.rs`

- [ ] **Step 1: Write the failing unit tests for `AuthRateLimiter` and `NonceCache`**

Add these tests near the bottom of `src-tauri/src/types.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::{AuthRateLimiter, NonceCache};

    #[test]
    fn auth_rate_limiter_allows_first_five_attempts_and_blocks_sixth() {
        let mut limiter = AuthRateLimiter::new();

        for attempt in 1..=6 {
            let allowed = limiter.check_and_record("127.0.0.1");
            assert_eq!(allowed, attempt < 6, "unexpected result at attempt {attempt}");
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
```

- [ ] **Step 2: Run the targeted unit tests to verify they fail only if the module/test scaffold is missing**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
cargo test --manifest-path src-tauri/Cargo.toml auth_rate_limiter_allows_first_five_attempts_and_blocks_sixth -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml nonce_cache_consumes_nonce_only_once -- --test-threads=1
```

Expected:
- If no `#[cfg(test)] mod tests` exists yet in `types.rs`, compilation fails until the scaffold is added.
- After the scaffold exists, both tests should pass immediately without production changes.

- [ ] **Step 3: Keep the implementation unchanged unless a test reveals a real defect**

No production code change is expected here. The point of this task is to lock in the existing behavior with direct tests.

```rust
// No production change expected in this task.
// If a defect appears, fix only the smallest logic necessary.
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
cargo test --manifest-path src-tauri/Cargo.toml auth_rate_limiter_allows_first_five_attempts_and_blocks_sixth -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml nonce_cache_consumes_nonce_only_once -- --test-threads=1
```

Expected:
- Both tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
git add src-tauri/src/types.rs
git commit -m "test: add unit coverage for auth limiter and nonce cache"
```

---

### Task 4: Update testing docs and run full verification

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `src-tauri/src/http_server.rs`
- Modify: `src-tauri/src/types.rs`
- Test: `docs/TESTING.md`

- [ ] **Step 1: Update `docs/TESTING.md` with a security ownership matrix**

Append a new section to `docs/TESTING.md`:

```md
## Security Surfaces

| Surface | Primary test layer | File |
|--------|---------------------|------|
| Auth middleware (`401`) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Localhost-only protection (`403`) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Auth challenge (`salt`, `429`) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Auth verify (`proof`, session, stale session cleanup) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Auth rate limiter | Layer A unit tests | `src-tauri/src/types.rs` |
| Nonce one-time use | Layer A unit tests + Layer B verify reuse test | `src-tauri/src/types.rs`, `src-tauri/src/http_server.rs` |
```

- [ ] **Step 2: Run the focused Rust suite and router smoke to verify no regressions**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
cargo test --manifest-path src-tauri/Cargo.toml auth_ -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml nonce_cache_consumes_nonce_only_once -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml api_router_smoke_all_routes_exist_and_do_not_500 -- --test-threads=1
```

Expected:
- The new security tests and existing router smoke all pass together.

- [ ] **Step 3: Run the full repository verification commands**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
npx tsc --noEmit
npm run check-i18n
npm run verify:contracts
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:
- All commands exit `0`.
- `cargo test` includes the new security coverage.

- [ ] **Step 4: Commit**

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
git add docs/TESTING.md src-tauri/src/http_server.rs src-tauri/src/types.rs
git commit -m "docs: document share security test coverage"
```

---

## Self-Review

- Spec coverage check:
  - `401` auth boundary: Task 1
  - `403` localhost-only boundary: Task 1
  - `challenge` salt and rate limiting: Task 2
  - `verify`, nonce reuse, session creation, stale session cleanup: Task 2
  - `AuthRateLimiter` and `NonceCache` direct unit coverage: Task 3
  - Security test ownership documentation and full verification: Task 4
- Placeholder scan:
  - No placeholder markers or cross-task shorthand references remain.
- Type consistency:
  - Test helper names are consistent across tasks: `TEST_MUTEX`, `ShareStateTestGuard`, `request_with_addr`, `request_json`, `build_proof_hex`.
