Bottom-right toast: surface card, 2px colored left bar, type icon, countdown line. Errors persist until closed; success/info auto-dismiss at 3s, warning 5s.

```jsx
const { Toast, ToastStack } = window.WorktreeManager;
<ToastStack>
  <Toast type="success" message="Worktree created" onClose={dismiss} />
  <Toast type="error" message="Merge conflict in 3 files: a.ts, b.ts, c.ts." onClose={dismiss} />
</ToastStack>
```
