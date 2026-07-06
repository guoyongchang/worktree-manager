Menu for workspace switching, context actions (worktree right-click), and editor pickers.

```jsx
const { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } = window.WorktreeManager;
<DropdownMenu trigger={<Button variant="secondary">workspace <ChevronDown /></Button>} width="240px">
  <DropdownMenuItem>my-workspace</DropdownMenuItem>
  <DropdownMenuSeparator />
  <DropdownMenuItem><Plus /> Add workspace</DropdownMenuItem>
</DropdownMenu>
```

Items: 14px, 2px radius, hover = elevated bg; `destructive` prop for red actions.
