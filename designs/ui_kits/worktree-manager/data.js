/* Fake data for the Worktree Manager UI kit — mirrors docs/screenshots content */
window.WM_DATA = {
  workspaces: [
    { name: 'worktree-manager-space', path: '/Users/guo/Work/some-projects/worktree-manager-space', current: true },
    { name: 'client-work', path: '/Users/guo/Work/client-work' },
  ],
  workspaceTitle: 'Main workspace — some-projects',
  workspacePath: '/Users/guo/Work/some-projects/worktree-manager-space',
  vault: {
    label: 'Vault mounted',
    count: 17,
    items: [
      { name: '.memory-organizer.config.json', type: 'file' },
      { name: 'AGENTS.md', type: 'file' },
      { name: 'CLAUDE.md', type: 'file' },
      { name: 'WORKSPACE.md', type: 'file' },
      { name: 'api', type: 'folder' },
      { name: 'architecture', type: 'folder' },
      { name: 'bootstrap-prompt.md', type: 'file' },
      { name: 'claude-reference', type: 'folder' },
      { name: 'development', type: 'folder' },
      { name: 'features', type: 'folder' },
      { name: 'index.md', type: 'file' },
      { name: 'ingest.md', type: 'file' },
      { name: 'log.md', type: 'file' },
      { name: 'mcp.servers.json', type: 'file' },
      { name: 'memory', type: 'folder' },
      { name: 'reference', type: 'folder' },
      { name: 'repos.md', type: 'file' },
    ],
  },
  groups: [
    { name: 'Repos', dot: 'sync', count: 3, expanded: false, projects: [] },
    {
      name: 'Worktree', dot: 'success', count: 3, expanded: true,
      projects: [
        {
          name: 'worktree-manager', branch: 'main', tag: 'Worktree',
          badges: [{ variant: 'warning', label: '391 commits not merged to test' }],
          stats: { ahead: 0, behind: 0, changed: 0 },
          push: 'Push',
        },
        {
          name: 'worktree-manager-server', branch: 'main', tag: 'Worktree', tag2: 'Repo',
          badges: [{ variant: 'warning', label: '1 changed file' }],
          stats: { ahead: 0, behind: 0, changed: 1 }, uncommitted: true,
          push: 'Commit & Push',
        },
        {
          name: 'worktree-manager-obsidian-bridge', branch: 'main', tag: 'Worktree',
          badges: [{ variant: 'success', label: 'Clean' }],
          stats: { ahead: 0, behind: 0, changed: 0 },
          push: 'Push',
          warning: "Branch 'test' does not exist on remote — push it first.",
        },
      ],
    },
  ],
  worktrees: [
    { name: 'feature-ui-optimize' },
    { name: 'Ui-bug-fix' },
    { name: 'ui-optimize-3', warning: '2 uncommitted changes in worktree-manager' },
    { name: 'windows-archive-usage-check' },
    {
      name: 'windows-bug-fix', warning: '1 uncommitted change in worktree-manager',
      projects: [
        {
          name: 'worktree-manager', branch: 'windows-bug-fix',
          badges: [
            { variant: 'warning', label: '1 changed file' },
            { variant: 'warning', label: '269 commits not merged to test' },
            { variant: 'secondary', label: '136 behind' },
          ],
          stats: { ahead: 0, behind: 136, changed: 1 }, uncommitted: true,
          push: 'Commit & Push',
        },
        {
          name: 'worktree-manager-server', branch: 'windows-bug-fix',
          badges: [{ variant: 'success', label: 'Clean' }],
          stats: { ahead: 0, behind: 0, changed: 0 },
          push: 'Push',
        },
      ],
    },
  ],
  defaultProjects: [
    { name: 'worktree-manager', base: 'main' },
    { name: 'worktree-manager-server', base: 'main' },
    { name: 'worktree-manager-obsidian-bridge', base: 'main' },
  ],
  editors: ['VS Code', 'Cursor', 'IntelliJ IDEA'],
  terminals: ['Built-in', 'Terminal.app', 'iTerm2'],
};
