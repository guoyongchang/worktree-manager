// Workspace reference
export interface WorkspaceRef {
  name: string;
  path: string;
}

// Worktree list item
export interface WorktreeListItem {
  name: string;
  path: string;
  is_archived: boolean;
  display_name?: string;
  projects: ProjectStatus[];
}

// Project status
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
}

// Branch diff stats（对齐后端 git_ops.rs BranchDiffStats）
export interface BranchDiffStats {
  ahead: number;            // 领先 base 的提交数
  behind: number;           // 落后 base 的提交数
  changed_files: number;    // 工作区变更文件数
  unpushed_commits: number; // 未推送提交数
  ahead_of_test: number;    // 领先 test 的提交数
}

// get_active_workspace 返回
export interface ActiveWorkspaceResult {
  workspace: WorkspaceRef | null;
  worktree_name: string | null;
  project_name: string | null;
  matched_by: 'prefix';
}

// 合并阈值门控参数
export interface MergeGateOpts {
  max_ahead: number;
  require_clean_worktree: boolean;
  force: boolean;
}

// Changed file
export interface ChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
}

// MCP error response
export interface McpError {
  code: number;
  message: string;
  data?: unknown;
}

// Transport mode
export type TransportMode = 'http' | 'config';

// Capability levels
export type CapabilityLevel = 'core' | 'details' | 'advanced';

// MCP config
export interface McpConfig {
  version: string;
  http_port: number;
  installed_at: string;
  capability_level: CapabilityLevel;
}
