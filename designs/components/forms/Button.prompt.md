Primary action control with 7 variants and 4 sizes; use `secondary` for most in-app actions, `default` (indigo) only for the primary CTA of a view.

```jsx
const { Button } = window.WorktreeManager;
<Button>Create Worktree</Button>
<Button variant="secondary" size="sm"><SyncIcon /> Sync main</Button>
<Button variant="ghost" size="icon"><SettingsIcon /></Button>
```

Variants: `default` (accent fill), `secondary` (surface + border — the workhorse), `outline`, `ghost` (toolbars/icon buttons), `destructive`, `warning`, `link`. Sizes: `default` 36px, `sm` 32px (dense git-action rows), `lg` 40px, `icon` 36×36. Press = global 0.98 scale; disabled = 50% opacity. Icons inside auto-size to 16px.
