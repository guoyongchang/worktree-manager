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
  is_merged_to_base: boolean;
  ahead_of_base: number;
  behind_base: number;
  ahead_of_test: number;
  unpushed_commits: number;
  remote_url: string;
}

export interface MainProjectStatus {
  name: string;
  path: string;
  current_branch: string;
  has_uncommitted: boolean;
  uncommitted_count: number;
  is_merged_to_test: boolean;
  is_merged_to_base: boolean;
  ahead_of_base: number;
  behind_base: number;
  ahead_of_test: number;
  unpushed_commits: number;
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
  /** Display name from mapping (for aliased non-ASCII worktrees) */
  display_name?: string;
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

// Editor types — dynamic, any string editor ID from system detection
export type EditorType = string;

export interface EditorConfig {
  id: string;
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

// Deploy to main workspace
export interface MainWorkspaceOccupation {
  worktree_name: string;
  original_branches: Record<string, string>;
  deployed_at: string;
}

export interface DeployToMainResult {
  success: boolean;
  switched_projects: string[];
  failed_projects: { project_name: string; error: string }[];
}

export interface ChangedFile {
  path: string;
  status: string;  // "M" | "A" | "D" | "R" | "?" | "C"
  staged: boolean;
}

export interface FileDiff {
  file_path: string;
  old_content: string;
  new_content: string;
  is_new: boolean;
  is_deleted: boolean;
  is_binary: boolean;
}

// ── Vault ────────────────────────────────────

export interface SyncedItem {
  name: string;
  item_type: "file" | "directory";
}

export interface VaultStatus {
  connected: boolean;
  vault_path: string | null;
  synced_items: SyncedItem[];
}

export interface VaultLinkResponse {
  connected: boolean;
  synced_items: SyncedItem[];
  error: string | null;
  warning: string | null;
}

export interface VaultItemChild {
  name: string;
  item_type: 'file' | 'directory';
}
