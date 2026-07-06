/* DetailView — workspace overview + worktree detail; port of WorktreeDetail.tsx layouts */
const { Button, Badge, StatusDot, Tooltip, DropdownMenu, DropdownMenuItem, Icon } = window.WorktreeManagerDesignSystem_e60f48;

function ToolbarIconGroup({ onToast }) {
  return (
    <div className="wmk-icon-group">
      <Tooltip content="Sync all with main" side="bottom"><button className="wmk-group-btn" onClick={() => onToast('success', 'All projects synced with main')}><Icon name="refresh-cw" size={14} /></button></Tooltip>
      <Tooltip content="Pull all" side="bottom"><button className="wmk-group-btn" onClick={() => onToast('success', 'Pulled all projects')}><Icon name="download" size={14} /></button></Tooltip>
      <Tooltip content="Refresh" side="bottom"><button className="wmk-group-btn" onClick={() => onToast('info', 'Remote state synced')}><Icon name="rotate-cw" size={14} /></button></Tooltip>
    </div>
  );
}

function SplitPicker({ icon, accent, options, onToast, label }) {
  return (
    <div className={`wmk-split ${accent ? 'wmk-split--accent' : ''}`}>
      <Tooltip content={label} side="bottom">
        <button className="wmk-split-main" onClick={() => onToast('success', `Opened in ${options[0]}`)}><Icon name={icon} size={14} /></button>
      </Tooltip>
      <DropdownMenu
        align="end"
        trigger={<button className="wmk-split-arrow"><Icon name="chevron-down" size={13} /></button>}
      >
        {options.map(o => <DropdownMenuItem key={o} onClick={() => onToast('success', `Opened in ${o}`)}>{o}</DropdownMenuItem>)}
      </DropdownMenu>
    </div>
  );
}

function VaultPanel({ vault }) {
  return (
    <div className="wmk-vault">
      <div className="wmk-vault-head">
        <StatusDot status="success" />
        <span>{vault.label}</span>
        <span className="wmk-vault-count">({vault.count})</span>
      </div>
      <div className="wmk-chips">
        {vault.items.map(it => (
          <span key={it.name} className="wmk-chip">
            <Icon name={it.type === 'folder' ? 'folder' : 'file'} size={12} style={{ color: it.type === 'folder' ? 'var(--success-light)' : 'var(--text-muted)' }} />
            {it.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function GroupSection({ group, onToast, children }) {
  const [open, setOpen] = React.useState(group.expanded);
  return (
    <div>
      <button className="wmk-group-head" onClick={() => setOpen(o => !o)}>
        <Icon name="chevron-right" size={14} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }} />
        <StatusDot status={group.dot} style={{ width: 8, height: 8 }} />
        <span>{group.name}</span>
        <span className="wmk-vault-count">({group.count})</span>
      </button>
      {open && children}
    </div>
  );
}

function WorkspaceOverview({ data, actions }) {
  return (
    <div className="wmk-detail">
      <div className="wmk-detail-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="wmk-title">{data.workspaceTitle}</h2>
          <p className="wmk-path">{data.workspacePath}</p>
        </div>
        <div className="wmk-toolbar">
          <ToolbarIconGroup onToast={actions.toast} />
          <Segmented options={['BASE (5)', 'TEST', 'HEAD']} value="BASE (5)" />
          <Button onClick={() => actions.toast('info', 'Add project — not in this mock')}>
            <Icon name="plus" size={14} /> Add Project
          </Button>
          <SplitPicker icon="code" accent options={data.editors} onToast={actions.toast} label="Open workspace in editor" />
          <SplitPicker icon="terminal" options={data.terminals} onToast={actions.toast} label="Open in terminal app" />
        </div>
      </div>

      <VaultPanel vault={data.vault} />

      {data.groups.map(group => (
        <GroupSection key={group.name} group={group} onToast={actions.toast}>
          <div className="wmk-cards">
            {group.projects.map(p => <ProjectCard key={p.name} project={p} showSegmented onToast={actions.toast} />)}
          </div>
        </GroupSection>
      ))}
    </div>
  );
}

function WorktreeDetailView({ wt, data, actions }) {
  const projects = wt.projects || data.defaultProjects.map(p => ({
    name: p.name, branch: wt.name,
    badges: [{ variant: 'success', label: 'Clean' }],
    stats: { ahead: 0, behind: 0, changed: 0 }, push: 'Push',
  }));
  const archived = actions.isArchived(wt.name);

  return (
    <div className="wmk-detail">
      <div className="wmk-detail-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="wmk-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name={archived ? 'archive' : 'folder-open'} size={20} style={{ color: 'var(--accent)' }} />
            {wt.name}
          </h2>
          <p className="wmk-path">{data.workspacePath}/worktrees/{wt.name}</p>
        </div>
        <div className="wmk-toolbar">
          {!archived && (
            <React.Fragment>
              <ToolbarIconGroup onToast={actions.toast} />
              <SplitPicker icon="code" accent options={data.editors} onToast={actions.toast} label="Open in editor" />
              <SplitPicker icon="terminal" options={data.terminals} onToast={actions.toast} label="Open in terminal app" />
              <Button variant="secondary" onClick={() => actions.toast('info', 'Deploy to main workspace — not in this mock')}>
                Deploy to main
              </Button>
              <Button variant="warning" onClick={() => actions.askArchive(wt.name)}>Archive</Button>
            </React.Fragment>
          )}
          {archived && (
            <React.Fragment>
              <Button onClick={() => actions.restore(wt.name)}>Restore</Button>
              <Button variant="destructive" onClick={() => actions.toast('error', 'Delete requires confirmation — not in this mock')}>Delete</Button>
            </React.Fragment>
          )}
        </div>
      </div>

      {archived ? (
        <div className="wmk-archived-note">
          <Icon name="archive" size={16} />
          <span>This worktree is archived. Restore it to work on its branches again.</span>
        </div>
      ) : (
        <React.Fragment>
          <div className="wmk-cards">
            {projects.map(p => <ProjectCard key={p.name} project={p} onToast={actions.toast} />)}
          </div>
          <div className="wmk-add-project" onClick={() => actions.toast('info', 'Add project to worktree — not in this mock')}>
            <Icon name="plus" size={14} />
            <span>Add project</span>
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

Object.assign(window, { WorkspaceOverview, WorktreeDetailView });
