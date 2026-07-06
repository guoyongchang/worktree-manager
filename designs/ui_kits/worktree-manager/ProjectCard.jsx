/* ProjectCard — port of the project card in WorktreeDetail.tsx + GitOperations.tsx */
const { Button, Badge, Tooltip, Icon } = window.WorktreeManagerDesignSystem_e60f48;

function Segmented({ options, value }) {
  return (
    <div className="wmk-segmented">
      {options.map(o => (
        <button key={o} className={`wmk-segment ${o === value ? 'wmk-segment--active' : ''}`}>{o}</button>
      ))}
    </div>
  );
}

function CardIconRow({ onToast, small }) {
  const s = small ? 13 : 14;
  return (
    <div className="wmk-card-icons">
      <Tooltip content="Project settings"><button className="wmk-mini-icon" onClick={() => onToast('info', 'Project settings — not in this mock')}><Icon name="settings" size={s} /></button></Tooltip>
      <Tooltip content="Reveal in Finder"><button className="wmk-mini-icon" onClick={() => onToast('info', 'Revealed in Finder')}><Icon name="folder" size={s} /></button></Tooltip>
      <Tooltip content="Open in VS Code"><button className="wmk-mini-icon wmk-mini-icon--accent" onClick={() => onToast('success', 'Opened in VS Code')}><Icon name="code" size={s} /></button></Tooltip>
      <Tooltip content="Open in terminal"><button className="wmk-mini-icon" onClick={() => onToast('info', 'Terminal opened')}><Icon name="terminal" size={s} /></button></Tooltip>
    </div>
  );
}

function ProjectCard({ project, showSegmented, onToast }) {
  return (
    <div className={`wmk-card ${project.uncommitted ? 'wmk-card--dirty' : ''}`}>
      <div className="wmk-card-head">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="wmk-card-title">{project.name}</span>
            {project.tag && <Badge variant="success">{project.tag}</Badge>}
            {project.tag2 && <Badge style={{ background: 'color-mix(in srgb, var(--wt-purple) 15%, transparent)', color: 'var(--wt-purple)' }}>{project.tag2}</Badge>}
          </div>
          <div className="wmk-card-branch">
            <Icon name="git-branch" size={14} />
            <span>{project.branch}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <CardIconRow onToast={onToast} small />
          {showSegmented && <Segmented options={['BASE', 'TEST', 'HEAD']} value="BASE" />}
        </div>
      </div>

      {project.badges && project.badges.length > 0 && (
        <div className="wmk-card-badges">
          {project.badges.map((b, i) => <Badge key={i} variant={b.variant}>{b.label}</Badge>)}
        </div>
      )}

      <div className="wmk-card-divider"></div>

      <div className="wmk-card-stats">
        <div style={{ display: 'flex', gap: 12 }}>
          <span>{project.stats.ahead} ahead</span>
          <span>{project.stats.behind} behind</span>
          <span>{project.stats.changed} changed file{project.stats.changed === 1 ? '' : 's'}</span>
        </div>
        <Tooltip content="Refresh remote state">
          <button className="wmk-mini-icon" onClick={() => onToast('info', `Remote state synced for ${project.name}`)}><Icon name="rotate-cw" size={13} /></button>
        </Tooltip>
      </div>

      <div className="wmk-card-actions">
        <Button variant="secondary" size="sm" style={{ fontSize: 12, minWidth: 0 }} onClick={() => onToast('success', `Synced ${project.name} with main`)}>
          <Icon name="refresh-cw" size={12} /> Sync main
        </Button>
        <Button variant="secondary" size="sm" style={{ fontSize: 12, minWidth: 0 }} onClick={() => onToast('success', `Pulled ${project.branch}`)}>
          <Icon name="download" size={12} /> Pull
        </Button>
        <Button variant="secondary" size="sm" style={{ fontSize: 12, minWidth: 0 }} onClick={() => onToast('success', project.push === 'Commit & Push' ? 'Committed and pushed' : 'Pushed to remote')}>
          <Icon name="upload" size={12} /> {project.push}
        </Button>
      </div>
      <div className="wmk-card-actions wmk-card-actions--2">
        <Button variant="secondary" size="sm" style={{ fontSize: 12, minWidth: 0 }} onClick={() => onToast('success', `Merged ${project.branch} to test`)}>
          <Icon name="git-merge" size={12} /> Merge to test
        </Button>
        <Button
          variant="secondary" size="sm"
          style={{ fontSize: 12, minWidth: 0, borderColor: 'var(--merge-main-border)', color: 'var(--merge-main-text)' }}
          onClick={() => onToast('warning', `Merge ${project.branch} to main requires confirmation`)}
        >
          <Icon name="git-merge" size={12} color="var(--merge-main-icon)" /> Merge to main
        </Button>
      </div>

      {project.warning && (
        <div className="wmk-card-warning">
          <Icon name="triangle-alert" size={13} style={{ color: 'var(--warning)' }} />
          <span>{project.warning}</span>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ProjectCard, Segmented });
