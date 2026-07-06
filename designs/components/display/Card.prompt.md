Surface container (8px radius, `--bg-surface`, hairline border) — the shell for project cards and settings sections.

```jsx
const { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } = window.WorktreeManager;
<Card>
  <CardHeader>
    <CardTitle>worktree-manager</CardTitle>
    <CardDescription>main · 0 ahead, 0 behind</CardDescription>
  </CardHeader>
  <CardContent>…git actions…</CardContent>
</Card>
```

Project cards in the app add `padding: 16px` sections instead of the 24px default — override with className/style when matching dense app layouts.
