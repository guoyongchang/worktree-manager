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

// Branch diff stats
export interface BranchDiffStats {
  ahead: number;
  behind: number;
  changed_files: number;
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
