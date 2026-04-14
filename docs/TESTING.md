# Testing Strategy & API Matrix

This repo has two backend transports:

- **Desktop mode**: Tauri IPC commands (`invoke`)
- **Browser mode**: HTTP `/api/*` + WebSocket `/ws`

To keep changes safe and reviewable, tests are organized by *behavior layer* rather than by technical layer.

## Source Of Truth

- API inventory and transport mirroring are tracked by the generated contract doc:
  - `docs/generated/command-contracts.md`
- CI enforces:
  - `npm run verify:contracts`
  - `npm test`
  - `cargo test`

This means: adding/removing a command must update both the backend registration and frontend usage. Contracts are the gate.

## Recommended Test Layers

### Layer A: Rust pure-logic unit tests (fast, most coverage)

Test functions that do not need a router/server:

- serialization / backwards-compat config parsing
- origin/CORS allow list logic
- git output parsing (diff stats, status parsing)
- path normalization rules
- terminal output transformations (UTF-8 repair, chunking)

Rule: prefer this layer whenever logic can be expressed without IO.

### Layer B: Rust handler / command tests (business behavior)

Test internal `_impl` functions and command functions with:

- temp dirs
- small initialized git repos (when needed)
- in-memory state where possible

Rule: test success + a small number of high-signal error cases.

### Layer C: Rust router smoke (API surface stability)

Goal: ensure the HTTP API surface exists and does not crash.

We run a router-level smoke test that:

1. extracts all `/api/*` routes from `src-tauri/src/http_server/routing.rs`
2. sends one request per route through `create_router()`
3. asserts each route is **not** `404` and **not** `500`

This intentionally does not try to validate every endpoint's semantics; it guarantees:

- route registration stays in sync with routing source
- middleware extractors are wired correctly (e.g. `ConnectInfo`)
- no route panics on trivial inputs

### Layer D: Frontend integration tests (UI state + interactions)

Use `vitest + @testing-library/react` to test:

- view switching / panel toggles
- timers (auto refresh, polling) with fake timers
- error/success flows
- cross-component interactions (e.g. clicking a badge triggers a view)

Rule: mock `@/lib/backend` and websocket manager; focus on observable UI behavior.

### Layer E: E2E smoke (optional, few paths only)

If/when added (Playwright recommended), keep it minimal:

- browser sharing: open link -> auth -> worktree list visible
- terminal basic loop: open -> type -> output visible

Rule: E2E is expensive. Use it for end-to-end connectivity only.

## API Matrix Policy (How To Keep "All APIs" Covered)

1. **Contracts are mandatory**: any change to commands/routes must keep `verify:contracts` green.
2. **Router smoke is mandatory**: new HTTP routes are automatically included in the smoke set via routing source extraction.
3. **Semantics are targeted**:
   - Only critical/high-risk commands need dedicated Layer B tests.
   - Most endpoints rely on Layer C (existence + non-500) plus Layer A unit tests for the underlying logic.

## When Adding A New API

Checklist:

1. Add IPC command + HTTP route (if mirrored).
2. Update / run `npm run verify:contracts`.
3. Ensure router smoke stays green (`cargo test`).
4. Add Layer A/B tests if the change adds meaningful logic or a risky flow.

## Security Surfaces

| Surface | Primary test layer | File |
|--------|---------------------|------|
| Auth middleware (`401`) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Localhost-only protection (`403`) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Auth challenge (`salt`, `429`) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Auth verify (`proof`, session management, stale session cleanup) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Auth rate limiter | Layer A unit tests | `src-tauri/src/types.rs` |
| Nonce one-time use | Layer A unit tests + Layer B verify reuse test | `src-tauri/src/types.rs`, `src-tauri/src/http_server.rs` |
|--------|---------------------|------|
| Auth middleware (`401`) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Localhost-only protection (`403`) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Auth challenge (`salt`, `429`) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Auth verify (`proof`, session management, stale session cleanup) | Layer B router tests | `src-tauri/src/http_server.rs` |
| Auth rate limiter | Layer A unit tests | `src-tauri/src/types.rs` |
| Nonce one-time use | Layer A unit tests + Layer B verify reuse test | `src-tauri/src/types.rs`, `src-tauri/src/http_server.rs` |
