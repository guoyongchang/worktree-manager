Dropdown select matching Input's 36px trigger; selected item shows a check on the right.

```jsx
const { Select } = window.WorktreeManager;
<Select options={['main', 'develop', 'release']} defaultValue="main" onChange={setBranch} />
<Select options={[{ value: 'vscode', label: 'VS Code' }, { value: 'cursor', label: 'Cursor' }]} placeholder="Open in…" />
```

Used for base-branch pickers and editor choice. Menu items are 14px, hover = elevated bg, 2px radius.
