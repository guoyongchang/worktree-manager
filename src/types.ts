// Workspace types
export interface WorkspaceRef {
  name: string;
  path: string;
}

export interface ProjectConfig {
  name: string;
  base_branch: string;
  test_branch: string;
  merge_strategy: string;
  linked_folders: string[];
}

export interface WorkspaceConfig {
  name: string;
  worktrees_dir: string;
  projects: ProjectConfig[];
  linked_workspace_items: string[];
}

// Project status types
export interface ProjectStatus {
  name: string;
  path: string;
  current_branch: string;
  base_branch: string;
  test_branch: string;
  has_uncommitted: boolean;
  uncommitted_count: number;
  is_merged_to_test: boolean;
  ahead_of_base: number;
  behind_base: number;
}

export interface MainProjectStatus {
  name: string;
  current_branch: string;
  has_uncommitted: boolean;
  base_branch: string;
  test_branch: string;
  linked_folders: string[];
}

export interface MainWorkspaceStatus {
  path: string;
  name: string;
  projects: MainProjectStatus[];
}

// Worktree types
export interface WorktreeListItem {
  name: string;
  path: string;
  is_archived: boolean;
  projects: ProjectStatus[];
}

export interface CreateProjectRequest {
  name: string;
  base_branch: string;
}

export interface AddProjectToWorktreeRequest {
  worktree_name: string;
  project_name: string;
  base_branch: string;
}

// Branch and archive types
export interface BranchStatus {
  project_name: string;
  branch_name: string;
  has_uncommitted: boolean;
  uncommitted_count: number;
  is_pushed: boolean;
  unpushed_commits: number;
  has_merge_request: boolean;
  remote_url: string;
}

export interface WorktreeArchiveStatus {
  name: string;
  can_archive: boolean;
  warnings: string[];
  errors: string[];
  projects: BranchStatus[];
}

// Editor types
export type EditorType = 'vscode' | 'cursor' | 'idea';

export interface EditorConfig {
  id: EditorType;
  name: string;
  icon: string;
}

// View types
export type ViewMode = 'main' | 'settings';

// Terminal tab type
export interface TerminalTab {
  name: string;
  path: string;
  isRoot: boolean;
  isDuplicate: boolean;
}

// Context menu types
export interface ContextMenuState {
  x: number;
  y: number;
  worktree: WorktreeListItem;
}

export interface TerminalTabMenuState {
  x: number;
  y: number;
  path: string;
  name: string;
}

// Archive modal state
export interface ArchiveModalState {
  worktree: WorktreeListItem;
  status: WorktreeArchiveStatus | null;
  loading: boolean;
  confirmedIssues: Set<string>;
}

// Scanned folder type (from smart scan)
export interface ScannedFolder {
  relative_path: string;
  display_name: string;
  size_bytes: number;
  size_display: string;
  is_recommended: boolean;
}
