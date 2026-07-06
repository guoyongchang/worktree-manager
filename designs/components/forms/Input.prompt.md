Standard text input; pairs with a 14px medium label above it.

```jsx
const { Input } = window.WorktreeManager;
<Input placeholder="feature-branch-name" />
<Input placeholder="Search worktrees" style={{ height: 28, width: 160, fontSize: 12 }} />
```

The app also uses a compact 28px/12px variant for the sidebar search (override via style). No error-state styling exists — errors render as separate red text lines below.
