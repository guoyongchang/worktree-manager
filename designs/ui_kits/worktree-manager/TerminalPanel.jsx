/* TerminalPanel — port of src/components/TerminalPanel.tsx (collapsed strip + expanded panel) */
const { Tooltip, Icon } = window.WorktreeManagerDesignSystem_e60f48;

const FAKE_LINES = [
  { c: 'var(--text-muted)', t: '# worktree: windows-bug-fix · shell integration active' },
  { c: 'var(--success-light)', t: '➜ worktree-manager git:(windows-bug-fix) ✗ ' },
  { c: 'var(--text-primary)', t: 'npm run tauri dev' },
  { c: 'var(--text-secondary)', t: '  VITE v7.3.1  ready in 428 ms' },
  { c: 'var(--text-secondary)', t: '  ➜  Local:   http://localhost:1420/' },
  { c: 'var(--accent-hover)', t: '  [tauri] watching for file changes…' },
];

function TerminalTab({ name, active, onClick, onClose }) {
  return (
    <div className={`wmk-term-tab ${active ? 'wmk-term-tab--active' : ''}`} onClick={onClick}>
      <span>{name}</span>
      {active && onClose && (
        <button className="wmk-term-tab-x" onClick={(e) => { e.stopPropagation(); onClose(); }}>
          <Icon name="x" size={10} />
        </button>
      )}
    </div>
  );
}

function TerminalPanel({ tabs, expanded, onToggle, onToast }) {
  const [activeTab, setActiveTab] = React.useState(tabs[0]);
  const shownTab = tabs.includes(activeTab) ? activeTab : tabs[0];

  return (
    <div className="wmk-terminal" style={{ height: expanded ? 240 : 32 }}>
      {expanded && <div className="wmk-term-resize"></div>}
      <div className="wmk-term-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingLeft: 8 }}>
          <button className="wmk-mini-icon" onClick={onToggle}>
            <Icon name="terminal" size={14} />
          </button>
          <button className="wmk-mini-icon" onClick={onToggle}>
            <Icon name={expanded ? 'chevron-down' : 'chevron-up'} size={13} />
          </button>
        </div>
        <div className="wmk-term-tabs">
          {tabs.map(t => (
            <TerminalTab
              key={t} name={t} active={t === shownTab}
              onClick={() => { setActiveTab(t); if (!expanded) onToggle(); }}
              onClose={() => onToast('info', `Closed terminal: ${t}`)}
            />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingRight: 8, marginLeft: 'auto' }}>
          {expanded && (
            <React.Fragment>
              <Tooltip content="Search" side="top"><button className="wmk-mini-icon" onClick={() => onToast('info', 'Terminal search — not in this mock')}><Icon name="search" size={13} /></button></Tooltip>
              <Tooltip content="Voice input (hold Alt+V)" side="top"><button className="wmk-mini-icon" onClick={() => onToast('info', 'Voice input — powered by Dashscope ASR')}><Icon name="mic" size={13} /></button></Tooltip>
              <Tooltip content="Expand" side="top"><button className="wmk-mini-icon" onClick={() => onToast('info', 'Fullscreen terminal — not in this mock')}><Icon name="chevrons-up-down" size={13} /></button></Tooltip>
              <Tooltip content="Maximize" side="top"><button className="wmk-mini-icon" onClick={() => onToast('info', 'Maximize — not in this mock')}><Icon name="maximize-2" size={13} /></button></Tooltip>
            </React.Fragment>
          )}
          <button className="wmk-term-plus" onClick={() => onToast('info', 'New terminal session')}>
            <Icon name="plus" size={12} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="wmk-term-body">
          {FAKE_LINES.map((l, i) => (
            <div key={i} style={{ color: l.c }}>{l.t}{i === 2 ? <span className="wmk-caret"></span> : null}</div>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { TerminalPanel });
