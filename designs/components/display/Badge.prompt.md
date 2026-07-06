Tiny 10px status pill (fully rounded, tinted at 15% alpha) for git state: "Worktree", "Clean", "1 changed file", ahead/behind counts.

```jsx
const { Badge } = window.WorktreeManager;
<Badge variant="success">Clean</Badge>
<Badge variant="warning">391 commits not merged to test</Badge>
<Badge variant="secondary">Worktree</Badge>
```

Variants: default (accent), secondary (elevated gray), success, warning, destructive, outline.
