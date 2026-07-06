Lucide stroke icon (the app's only icon set). Icons inherit text color; sizes used in the app: 12, 14, 16, 20.

```jsx
const { Icon } = window.WorktreeManager;
<Icon name="git-branch" size={16} style={{ color: 'var(--accent)' }} />
<Icon name="folder" /> <Icon name="settings" /> <Icon name="refresh-cw" />
```

Icons the app actually uses: git-branch, git-merge, git-pull-request, folder, folder-open, archive, plus, rotate-cw, refresh-cw, settings, chevron-right/down, chevrons-left/right/up-down, alert-triangle, trash-2, arrow-left, terminal, briefcase, x, copy, check, check-circle, file-text, file, external-link, maximize-2, minimize-2, share-2, square, users, eye, github, mic, link, qr-code, code, download, upload, globe, pencil, help-circle.

Loads `lucide` UMD from unpkg automatically; add `<script src="https://unpkg.com/lucide@0.462.0/dist/umd/lucide.min.js"></script>` up front to avoid a flash of empty icons.
