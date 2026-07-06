Click-toggled floating panel with 16px padding (richer content than a menu: share settings, QR codes).

```jsx
const { Popover } = window.WorktreeManager;
<Popover trigger={<Button variant="ghost" size="icon"><Share2 /></Button>} align="end">
  <p style={{ fontSize: 14 }}>Share this workspace over the network.</p>
</Popover>
```
