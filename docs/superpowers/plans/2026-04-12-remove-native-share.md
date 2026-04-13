# Remove Native Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the WMS/native share account and tunnel flow end-to-end while keeping LAN sharing, ngrok sharing, and browser password authentication working unchanged.

**Architecture:** Treat WMS/native share as a deleted subsystem, not a hidden feature. First lock in the intended frontend behavior with regression tests, then remove the frontend state/props/UI and the Rust backend commands/routes/state/module that power WMS, and finally clean the remaining locale, docs, and contract references. The browser password login path stays intact and remains the only remote-access authentication flow.

**Tech Stack:** React 19, TypeScript, Vitest, Rust, Tauri 2, Axum, ngrok

---

## File Structure

- `src/components/worktree-sidebar/ShareBar.tsx`
  Only render `ngrok` and `LAN` share rows plus password/client controls.
- `src/components/GlobalDialogs.tsx`
  Keep updater, shortcut, and ngrok dialogs only; remove WMS config/login dialogs.
- `src/hooks/useShareFeature.ts`
  Keep LAN/ngrok/password/client state only; remove all WMS state and handlers.
- `src/lib/backend.ts`
  Keep `start_sharing`, `stop_sharing`, `ngrok`, browser password auth, and connected-client APIs only.
- `src/hooks/useAppShellState.ts`
  Stop plumbing WMS user/account state into the app shell.
- `src/components/WorktreeSidebar.tsx`
  Stop forwarding WMS props.
- `src/components/worktree-sidebar/ExpandedSidebar.tsx`
  Remove WMS account strip and WMS props passed into `ShareBar`.
- `src/components/worktree-sidebar/types.ts`
  Shrink sidebar prop types to LAN/ngrok only.
- `src/components/SettingsView.tsx`
  Remove WMS account/logout UI and backend import.
- `src/App.tsx`
  Stop passing WMS state into sidebar/settings.
- `src/locales/en-US.json`
  Delete WMS/native-share strings.
- `src/locales/zh-CN.json`
  Delete WMS/native-share strings.
- `src/components/worktree-sidebar/ShareBar.test.tsx`
  New regression test: active share UI must not show remote/native share rows.
- `src/components/GlobalDialogs.test.tsx`
  New regression test: global dialog registry must not render WMS config/login dialogs.
- `src-tauri/src/types.rs`
  Remove WMS fields from `ShareState`, `ShareStateInfo`, and `GlobalConfig`.
- `src-tauri/src/config.rs`
  Update config round-trip test to assert no WMS fields serialize.
- `src-tauri/src/state.rs`
  Remove WMS browser-login globals and remote-proxy token state.
- `src-tauri/src/commands/sharing.rs`
  Keep LAN/ngrok/password/client commands; remove WMS config/login/tunnel logic.
- `src-tauri/src/http_server/routing.rs`
  Remove all `/api/*wms*`, `/api/auto_register_tunnel`, and `/auth/wms-callback` routes.
- `src-tauri/src/http_server/middleware.rs`
  Remove WMS-only localhost path exceptions and trusted remote proxy checks.
- `src-tauri/src/http_server.rs`
  Remove WMS handlers and callback implementation.
- `src-tauri/src/lib.rs`
  Remove `mod wms_tunnel`, WMS command exports, and shutdown cleanup for WMS tunnel.
- `src-tauri/src/wms_tunnel.rs`
  Delete file entirely.
- `README.md`
  Remove native share/account-login product copy.
- `CLAUDE.md`
  Remove WMS/native-share architecture references.
- `docs/API.md`
  Remove WMS commands from API docs.
- `docs/ARCHITECTURE.md`
  Remove WMS/native-share architecture sections.
- `docs/PROJECT_OVERVIEW.md`
  Remove WMS/native-share overview text.
- `docs/NEW_FEATURES.md`
  Remove WMS/native-share feature notes.
- `docs/generated/command-contracts.md`
  Regenerate after command removal.

---

### Task 1: Remove WMS UI and frontend state plumbing

**Files:**
- Create: `src/components/worktree-sidebar/ShareBar.test.tsx`
- Create: `src/components/GlobalDialogs.test.tsx`
- Modify: `src/components/worktree-sidebar/ShareBar.tsx`
- Modify: `src/components/GlobalDialogs.tsx`
- Modify: `src/hooks/useShareFeature.ts`
- Modify: `src/lib/backend.ts`
- Modify: `src/hooks/useAppShellState.ts`
- Modify: `src/components/WorktreeSidebar.tsx`
- Modify: `src/components/worktree-sidebar/ExpandedSidebar.tsx`
- Modify: `src/components/worktree-sidebar/types.ts`
- Modify: `src/components/SettingsView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/locales/en-US.json`
- Modify: `src/locales/zh-CN.json`
- Test: `src/components/worktree-sidebar/ShareBar.test.tsx`
- Test: `src/components/GlobalDialogs.test.tsx`

- [ ] **Step 1: Write the failing frontend regression tests**

Create `src/components/worktree-sidebar/ShareBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShareBar } from './ShareBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ShareBar', () => {
  it('renders ngrok and LAN rows only for active sharing', () => {
    render(
      <ShareBar
        active
        urls={['https://192.168.1.8:3456']}
        ngrokUrl="https://demo.ngrok-free.app"
        password="secret12"
        ngrokLoading={false}
        connectedClients={[]}
        onToggleNgrok={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onUpdatePassword={vi.fn()}
        hasNgrokToken
      />
    );

    expect(screen.getByText('share.ngrokLabel')).toBeInTheDocument();
    expect(screen.getByText('share.lan')).toBeInTheDocument();
    expect(screen.queryByText('share.remoteLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('share.wmsDisconnected')).not.toBeInTheDocument();
  });
});
```

Create `src/components/GlobalDialogs.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GlobalDialogs } from './GlobalDialogs';
import type { UseShareFeatureReturn } from '../hooks/useShareFeature';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const updater = {
  showCheckerDialog: false,
  closeCheckerDialog: vi.fn(),
  officialStatus: 'idle',
  mirrorStatus: 'idle',
  updateInfo: null,
  mirrorVersion: null,
  officialError: null,
  mirrorError: null,
  startDownload: vi.fn(),
  downloadViaMirror: vi.fn(),
  state: 'idle',
  dismiss: vi.fn(),
  downloadProgress: 0,
  errorMessage: null,
  retry: vi.fn(),
  showUpToDateToast: false,
  restartApp: vi.fn(),
} as any;

const share = {
  showNgrokTokenDialog: true,
  setShowNgrokTokenDialog: vi.fn(),
  ngrokTokenInput: '',
  setNgrokTokenInput: vi.fn(),
  savingNgrokToken: false,
  handleSaveNgrokToken: vi.fn(),
  showShareDisclaimer: false,
  setShowShareDisclaimer: vi.fn(),
  acceptShareDisclaimer: vi.fn(),
  showWmsConfigDialog: true,
  setShowWmsConfigDialog: vi.fn(),
  wmsConfigInput: { token: 'x', subdomain: 'demo' },
  setWmsConfigInput: vi.fn(),
  savingWmsConfig: false,
  handleSaveWmsConfig: vi.fn(),
  showWmsLoginDialog: true,
  handleCancelWmsBrowserLogin: vi.fn(),
  wmsUsername: 'alice',
  setWmsUsername: vi.fn(),
  wmsPassword: 'secret',
  setWmsPassword: vi.fn(),
  wmsFormLoginLoading: false,
  wmsLoginLoading: false,
  handleWmsFormLogin: vi.fn(),
  handleWmsBrowserLogin: vi.fn(),
} as unknown as UseShareFeatureReturn;

describe('GlobalDialogs', () => {
  it('keeps ngrok dialog but removes WMS dialogs', () => {
    render(
      <GlobalDialogs
        updater={updater}
        share={share}
        showShortcutHelp={false}
        onSetShowShortcutHelp={vi.fn()}
        onOpenSettings={vi.fn()}
        deleteConfirmWorktree={null}
        onSetDeleteConfirmWorktree={vi.fn()}
        onDeleteArchivedWorktree={vi.fn()}
        deletingArchived={false}
      />
    );

    expect(screen.getByText('app.ngrokTokenTitle')).toBeInTheDocument();
    expect(screen.queryByText('app.wmsConfigTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('app.wmsLoginTitle')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the frontend tests to verify they fail**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
npx vitest run src/components/worktree-sidebar/ShareBar.test.tsx src/components/GlobalDialogs.test.tsx
```

Expected:
- `ShareBar.test.tsx` fails because `share.remoteLabel` is still rendered.
- `GlobalDialogs.test.tsx` fails because the WMS config/login dialogs are still rendered.

- [ ] **Step 3: Implement the minimal frontend removal**

Apply these concrete changes:

1. Shrink `UseShareFeatureReturn` in `src/hooks/useShareFeature.ts` to LAN/ngrok only.

```ts
export interface UseShareFeatureReturn {
  shareActive: boolean;
  shareUrls: string[];
  shareNgrokUrl: string | null;
  sharePassword: string;
  ngrokLoading: boolean;
  showNgrokTokenDialog: boolean;
  setShowNgrokTokenDialog: (show: boolean) => void;
  ngrokTokenInput: string;
  setNgrokTokenInput: (value: string) => void;
  savingNgrokToken: boolean;
  connectedClients: ConnectedClient[];
  hasLastConfig: boolean;
  handleStartShare: (port: number) => Promise<void>;
  handleStopShare: () => Promise<void>;
  handleToggleNgrok: () => Promise<void>;
  handleUpdateSharePassword: (newPassword: string) => Promise<void>;
  handleSaveNgrokToken: () => Promise<void>;
  handleKickClient: (sessionId: string) => Promise<void>;
  handleQuickShare: () => Promise<void>;
  generatePassword: () => string;
  hasNgrokToken: boolean;
  showShareDisclaimer: boolean;
  setShowShareDisclaimer: (show: boolean) => void;
  acceptShareDisclaimer: () => void;
}
```

2. Remove all WMS imports and stop logic in `src/hooks/useShareFeature.ts`; keep `handleStopShare` limited to ngrok + share cleanup.

```ts
const handleStopShare = useCallback(async () => {
  try {
    if (shareNgrokUrl) {
      await stopNgrokTunnel();
    }

    await stopSharing();
    setShareActive(false);
    setShareUrls([]);
    setShareNgrokUrl(null);
    setConnectedClients([]);
  } catch (e) {
    setError(String(e));
  }
}, [setError, shareNgrokUrl]);
```

3. Delete the WMS API surface from `src/lib/backend.ts`. Keep browser password auth intact and remove only these exports:

```ts
// Remove these completely:
// export interface WmsConfig { ... }
// export interface WmsUser { ... }
// getWmsConfig, setWmsConfig, autoRegisterTunnel,
// startWmsTunnel, stopWmsTunnel, wmsManualReconnect,
// wmsLogin, wmsLogout, wmsBrowserLogin,
// cancelWmsBrowserLogin, getWmsUser
```

4. Remove WMS props from sidebar types and components. The final `WorktreeSidebarProps` share surface should look like:

```ts
export interface WorktreeSidebarProps {
  // existing workspace/worktree props...
  shareActive?: boolean;
  shareUrls?: string[];
  shareNgrokUrl?: string | null;
  sharePassword?: string;
  onStartShare?: (port: number) => void;
  onStopShare?: () => void;
  onUpdateSharePassword?: (password: string) => void;
  ngrokLoading?: boolean;
  onToggleNgrok?: () => void;
  connectedClients?: ConnectedClient[];
  onKickClient?: (sessionId: string) => void;
  hasLastConfig?: boolean;
  onQuickShare?: () => void;
  hasNgrokToken?: boolean;
  occupation?: MainWorkspaceOccupation | null;
}
```

5. Remove the remote/native-share row from `src/components/worktree-sidebar/ShareBar.tsx`. The active-share header should render ngrok first, then LAN rows only:

```tsx
<div className="space-y-0.5">
  {hasNgrokToken && (
    <ExternalShareRow
      badge={t('share.wan')}
      label={t('share.ngrokLabel')}
      url={ngrokUrl}
      password={editingPassword}
      loading={ngrokLoading}
      activeColorClass="bg-blue-500"
      inactiveText={t('share.ngrokNotStarted')}
      onToggle={onToggleNgrok}
      onCopyLabel={t('share.copyExternalLink')}
    />
  )}
</div>

{urls.length > 0 ? (
  <LanUrls
    urls={urls}
    password={editingPassword}
    expanded={lanExpanded}
    onToggleExpanded={() => setLanExpanded((prev) => !prev)}
  />
) : (
  <div className="flex items-center gap-2 min-h-[24px]">
    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-slate-600/30 text-slate-500 w-[52px] text-center">
      {t('share.lan')}
    </span>
    <span className="flex-1 text-xs text-slate-500">...</span>
  </div>
)}
```

6. Remove the WMS account strip in `src/components/worktree-sidebar/ExpandedSidebar.tsx`, the WMS dialogs in `src/components/GlobalDialogs.tsx`, the WMS account section in `src/components/SettingsView.tsx`, and the WMS prop plumbing in `src/App.tsx` and `src/hooks/useAppShellState.ts`.

7. Delete unused locale keys from `src/locales/en-US.json` and `src/locales/zh-CN.json`:

```json
"app.wmsConfigTitle": "...",
"app.wmsConfigDesc": "...",
"app.wmsTokenPlaceholder": "...",
"app.wmsLoginTitle": "...",
"app.wmsLoginDesc": "...",
"app.wmsLoginHint": "...",
"app.wmsPasswordLabel": "...",
"app.wmsPasswordPlaceholder": "...",
"app.wmsUsername": "...",
"app.wmsUsernamePlaceholder": "...",
"app.wmsLoginButton": "...",
"app.wmsLoginSubmit": "...",
"app.wmsLoginWaiting": "...",
"app.wmsLoggingIn": "...",
"app.wmsNotLoggedIn": "...",
"app.wmsLoggedIn": "...",
"settings.wmsShareSubtitle": "...",
"settings.wmsTokenPlaceholder": "...",
"settings.wmsShareHint": "...",
"settings.wmsPortalLink": "...",
"settings.wmsAccount": "...",
"settings.wmsLogout": "...",
"settings.wmsAccountHint": "...",
"share.wmsReconnecting": "...",
"share.wmsRetryIn": "...",
"share.wmsDisconnected": "...",
"share.wmsManualReconnect": "..."
```

- [ ] **Step 4: Run frontend verification to make sure the change passes**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
npx vitest run src/components/worktree-sidebar/ShareBar.test.tsx src/components/GlobalDialogs.test.tsx
npx tsc --noEmit
npm run check-i18n
```

Expected:
- Vitest: `2 passed`
- TypeScript: no errors
- `check-i18n`: exits `0`

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/worktree-sidebar/ShareBar.tsx \
  src/components/worktree-sidebar/ShareBar.test.tsx \
  src/components/GlobalDialogs.tsx \
  src/components/GlobalDialogs.test.tsx \
  src/hooks/useShareFeature.ts \
  src/lib/backend.ts \
  src/hooks/useAppShellState.ts \
  src/components/WorktreeSidebar.tsx \
  src/components/worktree-sidebar/ExpandedSidebar.tsx \
  src/components/worktree-sidebar/types.ts \
  src/components/SettingsView.tsx \
  src/App.tsx \
  src/locales/en-US.json \
  src/locales/zh-CN.json
git commit -m "refactor: remove WMS frontend sharing flow"
```

---

### Task 2: Remove the Rust WMS/native-share subsystem

**Files:**
- Modify: `src-tauri/src/types.rs`
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/commands/sharing.rs`
- Modify: `src-tauri/src/http_server/routing.rs`
- Modify: `src-tauri/src/http_server/middleware.rs`
- Modify: `src-tauri/src/http_server.rs`
- Modify: `src-tauri/src/lib.rs`
- Delete: `src-tauri/src/wms_tunnel.rs`
- Test: `src-tauri/src/config.rs`

- [ ] **Step 1: Write the failing Rust regression test**

Replace the existing `global_config_round_trip` test in `src-tauri/src/config.rs` with this version:

```rust
#[test]
fn global_config_round_trip() {
    let config = GlobalConfig {
        current_workspace: Some("/tmp/workspace".to_string()),
        ngrok_token: Some(" my-ngrok ".to_string()),
        dashscope_api_key: Some("my-dashscope".to_string()),
        ..GlobalConfig::default()
    };

    let serialized = serde_json::to_string_pretty(&config).expect("serialize config");
    let value: serde_json::Value = serde_json::from_str(&serialized).expect("parse serialized config");
    let object = value.as_object().expect("config json object");

    assert_eq!(
        object.get("current_workspace"),
        Some(&serde_json::Value::String("/tmp/workspace".to_string()))
    );
    assert_eq!(
        object.get("ngrok_token"),
        Some(&serde_json::Value::String(" my-ngrok ".to_string()))
    );
    assert_eq!(
        object.get("dashscope_api_key"),
        Some(&serde_json::Value::String("my-dashscope".to_string()))
    );
    assert!(!object.contains_key("wms_server_url"));
    assert!(!object.contains_key("wms_token"));
    assert!(!object.contains_key("wms_subdomain"));
    assert!(!object.contains_key("wms_jwt"));
    assert!(!object.contains_key("device_id"));
}
```

- [ ] **Step 2: Run the Rust test to verify it fails**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
cargo test --manifest-path src-tauri/Cargo.toml global_config_round_trip -- --exact --nocapture
```

Expected:
- Test fails because the current `GlobalConfig` still serializes WMS fields.

- [ ] **Step 3: Implement the minimal backend deletion**

Apply these concrete changes:

1. Shrink `ShareState`, `ShareStateInfo`, and `GlobalConfig` in `src-tauri/src/types.rs`:

```rust
pub struct ShareState {
    pub active: bool,
    pub workspace_path: Option<String>,
    pub port: u16,
    pub auth_key: Option<Vec<u8>>,
    pub auth_salt: Option<Vec<u8>>,
    pub shutdown_tx: Option<tokio::sync::watch::Sender<bool>>,
    pub ngrok_url: Option<String>,
    pub ngrok_task: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ShareStateInfo {
    pub active: bool,
    pub urls: Vec<String>,
    pub ngrok_url: Option<String>,
    pub workspace_path: Option<String>,
    pub current_workspace_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlobalConfig {
    pub workspaces: Vec<WorkspaceRef>,
    pub current_workspace: Option<String>,
    #[serde(default)]
    pub ngrok_token: Option<String>,
    #[serde(default)]
    pub last_share_port: Option<u16>,
    #[serde(default)]
    pub dashscope_api_key: Option<String>,
    #[serde(default)]
    pub dashscope_base_url: Option<String>,
    #[serde(default = "default_true")]
    pub voice_refine_enabled: bool,
}
```

2. Remove WMS globals from `src-tauri/src/state.rs`:

```rust
// Delete:
// REMOTE_PROXY_AUTH_TOKEN
// PendingWmsBrowserLogin
// PENDING_WMS_BROWSER_LOGIN
// WMS_BROWSER_LOGIN_CANCEL
```

3. Remove WMS commands from `src-tauri/src/commands/sharing.rs`; keep only LAN/ngrok/password/client commands and helpers. The final public command surface in this file should include:

```rust
#[tauri::command] pub(crate) async fn get_ngrok_token() -> Result<Option<String>, String> { ... }
#[tauri::command] pub(crate) async fn set_ngrok_token(token: String) -> Result<(), String> { ... }
#[tauri::command] pub(crate) async fn get_last_share_port() -> Result<Option<u16>, String> { ... }
#[tauri::command] pub(crate) async fn get_last_share_password() -> Result<Option<String>, String> { ... }
pub async fn start_sharing_internal(workspace_path: String, port: u16, password: String) -> Result<String, String> { ... }
#[tauri::command] pub(crate) async fn start_sharing(window: tauri::Window, port: u16, password: String) -> Result<String, String> { ... }
pub async fn start_ngrok_tunnel_internal() -> Result<String, String> { ... }
#[tauri::command] pub(crate) async fn start_ngrok_tunnel() -> Result<String, String> { ... }
#[tauri::command] pub(crate) async fn stop_ngrok_tunnel() -> Result<(), String> { ... }
```

4. Remove WMS routes from `src-tauri/src/http_server/routing.rs`. The route block must no longer contain:

```rust
.route("/api/get_wms_config", post(h_get_wms_config))
.route("/api/set_wms_config", post(h_set_wms_config))
.route("/api/auto_register_tunnel", post(h_auto_register_tunnel))
.route("/api/wms_login", post(h_wms_login))
.route("/api/wms_browser_login", post(h_wms_browser_login))
.route("/api/cancel_wms_browser_login", post(h_cancel_wms_browser_login))
.route("/api/get_wms_user", post(h_get_wms_user))
.route("/api/wms_logout", post(h_wms_logout))
.route("/api/start_wms_tunnel", post(h_start_wms_tunnel))
.route("/api/stop_wms_tunnel", post(h_stop_wms_tunnel))
.route("/api/wms_manual_reconnect", post(h_wms_manual_reconnect))
.route("/auth/wms-callback", get(h_wms_auth_callback))
```

5. Remove the trusted-remote-proxy helpers and WMS localhost-only paths from `src-tauri/src/http_server/middleware.rs`. The remaining localhost-only list should keep ngrok token management and local machine actions only.

6. Remove WMS handlers from `src-tauri/src/http_server.rs`. Delete the `// -- WMS config & tunnel --` section and the `// -- WMS Browser Auth Callback --` section entirely.

7. Remove WMS module wiring from `src-tauri/src/lib.rs`:

```rust
// Delete:
pub(crate) mod wms_tunnel;

// Delete all WMS imports from commands::sharing use lists.
// Delete stop_wms_tunnel cleanup in the RunEvent::ExitRequested branch.
// Delete these commands from generate_handler!:
// get_wms_config, set_wms_config, auto_register_tunnel,
// wms_login, wms_browser_login, cancel_wms_browser_login,
// get_wms_user, wms_logout, start_wms_tunnel,
// stop_wms_tunnel, wms_manual_reconnect
```

8. Delete `src-tauri/src/wms_tunnel.rs`:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
git rm src-tauri/src/wms_tunnel.rs
```

- [ ] **Step 4: Run backend verification to make sure the change passes**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
cargo test --manifest-path src-tauri/Cargo.toml global_config_round_trip -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml allows_exact_loopback_and_private_lan_origins_only -- --exact
cargo test --manifest-path src-tauri/Cargo.toml only_allows_exact_active_ngrok_origin -- --exact
cargo check --manifest-path src-tauri/Cargo.toml
rg -n "wms_|wms_tunnel|auth/wms-callback|REMOTE_PROXY_AUTH_TOKEN|PENDING_WMS_BROWSER_LOGIN" src-tauri/src
```

Expected:
- All three Rust tests pass.
- `cargo check` exits `0`.
- The final `rg` command prints no matches.

- [ ] **Step 5: Commit**

```bash
git add \
  src-tauri/src/types.rs \
  src-tauri/src/config.rs \
  src-tauri/src/state.rs \
  src-tauri/src/commands/sharing.rs \
  src-tauri/src/http_server/routing.rs \
  src-tauri/src/http_server/middleware.rs \
  src-tauri/src/http_server.rs \
  src-tauri/src/lib.rs
git commit -m "refactor: remove WMS native share backend"
```

---

### Task 3: Clean docs and run full regression verification

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/API.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PROJECT_OVERVIEW.md`
- Modify: `docs/NEW_FEATURES.md`
- Modify: `docs/generated/command-contracts.md`

- [ ] **Step 1: Capture the failing documentation/contract baseline**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
rg -n "wms_|WMS|native share|remote share" README.md CLAUDE.md docs src/locales src --glob '!docs/superpowers/**'
```

Expected:
- Multiple matches from product copy, API docs, architecture docs, locale keys, and possibly leftover frontend wording.

- [ ] **Step 2: Update the docs and contract output**

Make these concrete edits:

1. In `README.md`, replace the “公网/内置分享” wording with LAN + ngrok only. The retained share description should read like:

```md
开启分享后，可通过局域网地址访问当前工作区；如已配置 ngrok，也可获得公网地址。
浏览器访问分享页时仍需输入分享密码。
```

2. In `CLAUDE.md`, update the share command section so it lists only:

```md
- **分享 (6)**: start/stop_sharing, get_state, update_password, get/kick_clients
- **ngrok (4)**: get/set_token, start/stop_tunnel
```

3. In `docs/API.md` and `docs/ARCHITECTURE.md`, remove every `get_wms_config`, `wms_login`, `start_wms_tunnel`, callback, and reconnect section. Keep the browser password auth endpoints:

```md
/api/auth/challenge
/api/auth/verify
/api/get_share_info
/api/start_sharing
/api/stop_sharing
/api/get_share_state
/api/update_share_password
/api/start_ngrok_tunnel
/api/stop_ngrok_tunnel
```

4. Regenerate command contracts after the code changes:

```bash
npm run verify:contracts
npm run docs:contracts
```

- [ ] **Step 3: Run the final verification suite**

Run:

```bash
cd /Users/guo/Work/some-projects/worktree-manager-space/worktrees/remove-nativ-share/projects/worktree-manager
npx vitest run src/components/worktree-sidebar/ShareBar.test.tsx src/components/GlobalDialogs.test.tsx
npm run check-i18n
npm run verify:contracts
npm run docs:contracts
cargo check --manifest-path src-tauri/Cargo.toml
rg -n "wms_|WMS|native share|remote share" README.md CLAUDE.md docs src/locales src src-tauri/src --glob '!docs/superpowers/**'
```

Expected:
- Vitest passes.
- `check-i18n`, `verify:contracts`, and `docs:contracts` exit `0`.
- `cargo check` exits `0`.
- Final `rg` has no matches outside `docs/superpowers/`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/API.md docs/ARCHITECTURE.md docs/PROJECT_OVERVIEW.md docs/NEW_FEATURES.md docs/generated/command-contracts.md
git commit -m "docs: remove native share references"
```

---

## Self-Review

### Spec coverage

- Product behavior reduced to `LAN + ngrok + password auth`: covered by Task 1 and Task 2.
- Frontend removal of WMS UI, props, dialogs, and account display: covered by Task 1.
- Backend removal of WMS commands, routes, state, config, callback, and module file: covered by Task 2.
- Locale/doc/contract cleanup: covered by Task 1 and Task 3.
- Verification that browser password auth still exists: covered by retained `useBrowserAuth` in Task 1 and final verification in Task 3.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to Task N” placeholders remain.
- Every task includes exact file paths, commands, and concrete code snippets.

### Type consistency

- Frontend final state uses `shareNgrokUrl` but no `shareWmsUrl`.
- Sidebar props retain `shareActive/shareUrls/shareNgrokUrl/sharePassword` and remove all `wms*` props.
- Rust config/state remove all `wms_*` fields and associated routing/command names.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-12-remove-native-share.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
