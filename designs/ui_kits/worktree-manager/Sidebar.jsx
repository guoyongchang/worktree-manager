/* Sidebar — port of src/components/worktree-sidebar/ExpandedSidebar.tsx */
const { Button, Input, Tooltip, DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, Icon, Badge } = window.WorktreeManagerDesignSystem_e60f48;

function WorkspaceSwitcher({ workspaces, current, onToast }) {
  return (
    <DropdownMenu
      width="230px"
      trigger={
        <Button variant="secondary" style={{ flex: 1, justifyContent: 'space-between', minWidth: 0, width: '100%' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Icon name="briefcase" size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current}</span>
          </span>
          <Icon name="chevron-down" size={16} style={{ color: 'var(--text-secondary)' }} />
        </Button>
      }
    >
      {workspaces.map(ws => (
        <DropdownMenuItem key={ws.name} onClick={() => onToast('info', ws.current ? 'Already in this workspace' : `Switching requires a restart of open terminals`)}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ws.name}</span>
          {ws.current && <span className="wm-badge wm-badge--default" style={{ padding: '1px 4px', borderRadius: 4 }}>current</span>}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem style={{ color: 'var(--text-secondary)' }} onClick={() => onToast('info', 'Add workspace — not in this mock')}>
        <Icon name="plus" /> Add workspace
      </DropdownMenuItem>
    </DropdownMenu>
  );
}

function WorktreeRow({ wt, selected, onSelect, onArchive }) {
  const [menu, setMenu] = React.useState(null);
  return (
    <div
      className={`wmk-wt-row ${selected ? 'wmk-wt-row--selected' : ''}`}
      onClick={onSelect}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <span className="wmk-grip"><Icon name="grip-vertical" size={13} /></span>
      <Icon name="git-branch" size={16} style={{ color: wt.color ? `var(--wt-${wt.color})` : 'var(--accent)' }} />
      <span className="wmk-wt-name">{wt.name}</span>
      {wt.warning && (
        <Tooltip content={wt.warning} side="right">
          <Icon name="triangle-alert" size={14} style={{ color: 'var(--warning)' }} />
        </Tooltip>
      )}
      {menu && (
        <div className="wmk-ctx" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          <button className="wm-menu-item" onClick={(e) => { e.stopPropagation(); setMenu(null); onArchive(wt.name); }}>
            <Icon name="archive" /> Archive
          </button>
        </div>
      )}
    </div>
  );
}

function Sidebar({ data, state, actions }) {
  const [query, setQuery] = React.useState('');
  const active = state.worktrees.filter(w => !state.archived.includes(w.name));
  const archived = state.worktrees.filter(w => state.archived.includes(w.name));
  const shown = active.filter(w => !query || w.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="wmk-sidebar">
      <div className="wmk-sidebar-top">
        <WorkspaceSwitcher workspaces={data.workspaces} current={data.workspaces[0].name} onToast={actions.toast} />
        <Tooltip content="Settings" side="bottom">
          <Button variant="ghost" size="icon" onClick={() => actions.toast('info', 'Settings view — not included in this mock')}>
            <Icon name="settings" />
          </Button>
        </Tooltip>
      </div>

      <div className="wmk-sidebar-heading">
        <h1>Worktrees</h1>
        <div style={{ display: 'flex', gap: 4 }}>
          <Tooltip content="Refresh" side="bottom">
            <Button variant="ghost" size="icon" style={{ height: 32, width: 32 }} onClick={() => actions.toast('info', 'Remote state synced')}>
              <Icon name="rotate-cw" />
            </Button>
          </Tooltip>
          <Tooltip content="Collapse sidebar" side="bottom">
            <Button variant="ghost" size="icon" style={{ height: 32, width: 32 }} onClick={() => actions.toast('info', 'Collapsed sidebar — not in this mock')}>
              <Icon name="chevrons-left" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div
        className={`wmk-main-card ${state.selected === null ? 'wmk-main-card--selected' : ''}`}
        onClick={() => actions.select(null)}
      >
        <Icon name="folder" size={16} style={{ color: 'var(--text-secondary)' }} />
        <span>Main workspace</span>
      </div>

      <div className="wmk-list">
        <div className="wmk-section-row">
          <span className="wmk-section-label">Active ({active.length})</span>
          <Input placeholder="Search worktrees" value={query} onChange={e => setQuery(e.target.value)} style={{ height: 28, width: 150, fontSize: 12 }} />
        </div>

        {shown.map(wt => (
          <WorktreeRow
            key={wt.name}
            wt={wt}
            selected={state.selected === wt.name}
            onSelect={() => actions.select(wt.name)}
            onArchive={actions.askArchive}
          />
        ))}

        <div className="wmk-new-wt" onClick={actions.openCreate}>
          <Icon name="plus" size={14} />
          <span>New Worktree</span>
        </div>

        <div className="wmk-section-row wmk-archive-toggle" onClick={actions.toggleArchived}>
          <span className="wmk-section-label">Archive ({archived.length})</span>
          <Icon name="chevron-right" size={14} style={{ color: 'var(--text-muted)', transform: state.showArchived ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }} />
        </div>
        {state.showArchived && archived.map(wt => (
          <div key={wt.name} className="wmk-wt-row" style={{ opacity: 0.6 }} onClick={() => actions.select(wt.name)}>
            <span style={{ width: 14 }}></span>
            <Icon name="archive" size={16} style={{ color: 'var(--text-muted)' }} />
            <span className="wmk-wt-name">{wt.name}</span>
          </div>
        ))}
        {state.showArchived && archived.length === 0 && (
          <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)' }}>No archived worktrees</div>
        )}
      </div>

      <div className="wmk-sharebar" onClick={() => actions.toast('info', 'Share over network — not in this mock')}>
        <Icon name="share-2" size={14} />
        <span>Share</span>
      </div>

      <div className="wmk-bottombar">
        <span className="wmk-dev">DEV</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button variant="ghost" size="icon" style={{ height: 28, width: 28 }} onClick={() => actions.toast('info', 'Log folder opened')}>
            <Icon name="file-text" size={14} />
          </Button>
          <Button variant="ghost" size="icon" style={{ height: 28, width: 28 }} onClick={() => actions.toast('info', 'github.com/guoyongchang/worktree-manager')}>
            <Icon name="github" size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar });
