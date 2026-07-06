Native 16px checkbox with accent-colored check; used for project selection lists and settings toggles (the app has no Switch — checkboxes everywhere).

```jsx
const { Checkbox } = window.WorktreeManager;
<Checkbox label="Sync with remote before creating" defaultChecked />
<Checkbox checked={selected} onChange={e => toggle(e.target.checked)} />
```
