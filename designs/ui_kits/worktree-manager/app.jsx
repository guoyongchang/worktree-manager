/* App shell — wires Sidebar + DetailView + modals + toasts (WorkspaceCell.tsx equivalent) */
const { Toast, ToastStack, Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button } = window.WorktreeManagerDesignSystem_e60f48;

const DATA = window.WM_DATA;

function App() {
  const [worktrees, setWorktrees] = React.useState(DATA.worktrees);
  const [archived, setArchived] = React.useState([]);
  const [selected, setSelected] = React.useState(null); // null = main workspace
  const [showArchived, setShowArchived] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [archiveConfirm, setArchiveConfirm] = React.useState(null);
  const [termExpanded, setTermExpanded] = React.useState(false);
  const [toasts, setToasts] = React.useState([]);
  const idRef = React.useRef(0);

  const toast = (type, message) => {
    const id = ++idRef.current;
    setToasts(t => [...t, { id, type, message }]);
  };
  const dismiss = (id) => setToasts(t => t.filter(x => x.id !== id));

  const actions = {
    toast,
    select: setSelected,
    openCreate: () => setCreateOpen(true),
    toggleArchived: () => setShowArchived(s => !s),
    askArchive: (name) => setArchiveConfirm(name),
    isArchived: (name) => archived.includes(name),
    restore: (name) => {
      setArchived(a => a.filter(n => n !== name));
      toast('success', `Restored ${name}`);
    },
  };

  const state = { worktrees, archived, selected, showArchived };

  const handleCreate = (name, projectNames) => {
    setWorktrees(w => [...w, {
      name,
      projects: projectNames.map(p => ({
        name: p, branch: name,
        badges: [{ variant: 'success', label: 'Clean' }],
        stats: { ahead: 0, behind: 0, changed: 0 }, push: 'Push',
      })),
    }]);
    setCreateOpen(false);
    setSelected(name);
    toast('success', `Worktree "${name}" created — dependencies symlinked`);
  };

  const handleArchive = () => {
    setArchived(a => [...a, archiveConfirm]);
    if (selected === archiveConfirm) setSelected(null);
    toast('success', `Archived ${archiveConfirm}`);
    setArchiveConfirm(null);
  };

  const selectedWt = worktrees.find(w => w.name === selected);
  const termTabs = ['Workspace', ...(selectedWt ? (selectedWt.projects || DATA.defaultProjects).map(p => p.name).slice(0, 3) : DATA.groups[1].projects.map(p => p.name))];

  return (
    <div className="wmk-app">
      <div className="wmk-body">
        <Sidebar data={DATA} state={state} actions={actions} />
        <div className="wmk-main">
          <div className="wmk-scroll">
            {selectedWt
              ? <WorktreeDetailView wt={selectedWt} data={DATA} actions={actions} />
              : <WorkspaceOverview data={DATA} actions={actions} />}
          </div>
          <TerminalPanel
            tabs={termTabs}
            expanded={termExpanded}
            onToggle={() => setTermExpanded(e => !e)}
            onToast={toast}
          />
        </div>
      </div>

      <CreateWorktreeModal open={createOpen} onOpenChange={setCreateOpen} data={DATA} onCreate={handleCreate} />

      <Dialog open={!!archiveConfirm} onOpenChange={() => setArchiveConfirm(null)} maxWidth="420px">
        <DialogHeader>
          <DialogTitle>Archive worktree</DialogTitle>
          <DialogDescription>
            Archive "{archiveConfirm}"? Branches are kept; the working directory is moved to the archive. You can restore it anytime.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setArchiveConfirm(null)}>Cancel</Button>
          <Button variant="warning" onClick={handleArchive}>Archive</Button>
        </DialogFooter>
      </Dialog>

      <ToastStack>
        {toasts.map(t => <Toast key={t.id} type={t.type} message={t.message} onClose={() => dismiss(t.id)} />)}
      </ToastStack>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
