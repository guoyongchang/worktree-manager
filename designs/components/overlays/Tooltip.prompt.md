Hover tooltip (elevated bg, hairline border, 12px). The app puts one on nearly every icon button — follow that convention.

```jsx
const { Tooltip } = window.WorktreeManager;
<Tooltip content="Refresh" side="bottom">
  <Button variant="ghost" size="icon"><RotateCw /></Button>
</Tooltip>
```
