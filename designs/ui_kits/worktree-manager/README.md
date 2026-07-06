# Worktree Manager — Desktop App UI Kit

Interactive recreation of the Tauri desktop app (`src/App.tsx` → `WorkspaceCell` → sidebar/detail/terminal), built on the design-system primitives (`window.WorktreeManagerDesignSystem_e60f48`).

## Screens

| File | What it shows |
|---|---|
| `index.html` | Full app shell: sidebar (workspace switcher, worktree list, share bar), workspace overview (vault panel, grouped project cards with git actions), worktree detail (deploy/archive toolbar), create-worktree modal, archive confirm, terminal panel, toasts |
| `welcome.html` | First-run welcome (`WelcomeView.tsx`) |
| `login.html` | Browser-mode password gate (from `App.tsx`) |

## Interactions in index.html

- Click sidebar rows to switch between Main workspace and worktrees; search filters the list
- "+ New Worktree" opens the create modal → creates and selects a worktree (toast)
- Right-click a worktree row → Archive; Archive/Restore flows work end-to-end
- Git action buttons (Sync/Pull/Push/Merge) fire toasts; "Merge to main" is the orange danger affordance
- Terminal strip at the bottom expands/collapses; tabs switch
- Workspace dropdown, editor/terminal split-pickers, share popover, tooltips everywhere

## Fidelity notes

Copy is the app's own English locale voice. Settings view (146 KB source), voice-input overlay, mobile layouts, and the multi-cell workspace grid are intentionally **not** recreated — buttons that lead there show a "not in this mock" toast rather than an invented design. Layout values (288px sidebar, 2px selected-edge, 16px card padding, 32px terminal bar) come from the component source, not eyeballed.
