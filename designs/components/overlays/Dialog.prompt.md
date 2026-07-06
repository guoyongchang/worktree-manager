Centered modal over a heavily blurred black/60 overlay; footer buttons right-aligned, Cancel (secondary) before the primary.

```jsx
const { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = window.WorktreeManager;
<Dialog open={open} onOpenChange={setOpen} maxWidth="420px">
  <DialogHeader>
    <DialogTitle>Merge to main</DialogTitle>
    <DialogDescription>Merge 3 commits from hotfix-payment into main?</DialogDescription>
  </DialogHeader>
  <DialogFooter>
    <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
    <Button>Confirm merge</Button>
  </DialogFooter>
</Dialog>
```

Widths in the app: 400–420px confirms, 512px default, 640px commit dialog. Esc and overlay click close.
