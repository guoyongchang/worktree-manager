/* CreateWorktreeModal — port of src/components/CreateWorktreeModal.tsx (per docs/screenshots/new-worktree.png) */
const { Dialog, DialogHeader, DialogTitle, DialogFooter, Button, Input, Checkbox, Select, StatusDot, Icon } = window.WorktreeManagerDesignSystem_e60f48;

function CreateWorktreeModal({ open, onOpenChange, data, onCreate }) {
  const [name, setName] = React.useState('');
  const [tab, setTab] = React.useState('all');
  const [selected, setSelected] = React.useState(() => data.defaultProjects.map(p => p.name));
  const [sync, setSync] = React.useState(true);

  const toggle = (n) => setSelected(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n]);
  const reset = () => { setName(''); setSelected(data.defaultProjects.map(p => p.name)); };

  const projectRow = (p) => (
    <div key={p.name} className="wmk-cm-project">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Checkbox checked={selected.includes(p.name)} onChange={() => toggle(p.name)} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{p.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>default: main · test: test</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Base:</span>
        <Select options={['main', 'develop']} defaultValue={p.base} style={{ width: 110 }} />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }} maxWidth="560px">
      <DialogHeader>
        <DialogTitle>New Worktree</DialogTitle>
      </DialogHeader>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 14, color: 'var(--text-primary)' }}>Worktree name</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="feature-login" autoFocus />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>Select projects</span>
        <div className="wmk-cm-tabs">
          <button className={`wmk-cm-tab ${tab === 'all' ? 'wmk-cm-tab--active' : ''}`} onClick={() => setTab('all')}>All</button>
          <button className={`wmk-cm-tab ${tab === 'tag' ? 'wmk-cm-tab--active' : ''}`} onClick={() => setTab('tag')}>By tag</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
          {tab === 'tag' && (
            <div className="wmk-cm-group">
              <Icon name="chevron-down" size={14} style={{ color: 'var(--text-muted)' }} />
              <Checkbox checked={selected.length === 3} onChange={() => setSelected(selected.length === 3 ? [] : data.defaultProjects.map(p => p.name))} />
              <StatusDot status="success" style={{ width: 8, height: 8 }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Worktree</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({selected.length}/3)</span>
            </div>
          )}
          {data.defaultProjects.map(projectRow)}
        </div>
      </div>

      <DialogFooter style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Checkbox label="Sync Base before create" checked={sync} onChange={e => setSync(e.target.checked)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
          <Button
            disabled={!name.trim() || selected.length === 0}
            onClick={() => { onCreate(name.trim(), selected); reset(); }}
          >
            Create ({selected.length})
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}

Object.assign(window, { CreateWorktreeModal });
