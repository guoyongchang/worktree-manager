import type { MouseEvent } from 'react';

import type { UpdaterState } from '../../hooks/useUpdater';
import type {
  MainWorkspaceOccupation,
  MainWorkspaceStatus,
  WorktreeListItem,
  WorkspaceRef,
} from '../../types';

export interface WorktreeSidebarProps {
  workspaces: WorkspaceRef[];
  currentWorkspace: WorkspaceRef | null;
  showWorkspaceMenu: boolean;
  onShowWorkspaceMenu: (show: boolean) => void;
  onSwitchWorkspace: (path: string) => void;
  onAddWorkspace: () => void;
  mainWorkspace: MainWorkspaceStatus | null;
  worktrees: WorktreeListItem[];
  selectedWorktree: WorktreeListItem | null;
  onSelectWorktree: (worktree: WorktreeListItem | null) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  onContextMenu: (e: MouseEvent, worktree: WorktreeListItem) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  onOpenSettings: () => void;
  onOpenCreateModal: () => void;
  updaterState: UpdaterState;
  onCheckUpdate: () => void;
  onOpenInNewWindow?: (workspacePath: string) => void;
  lockedWorktrees?: Record<string, string>;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  switchingWorkspace?: boolean;
  shareActive?: boolean;
  shareUrls?: string[];
  shareNgrokUrl?: string | null;
  sharePassword?: string;
  onStartShare?: (port: number) => void;
  onStopShare?: () => void;
  onUpdateSharePassword?: (password: string) => void;
  ngrokLoading?: boolean;
  onToggleNgrok?: () => void;
  connectedClients?: import('../../lib/backend').ConnectedClient[];
  onKickClient?: (sessionId: string) => void;
  hasLastConfig?: boolean;
  onQuickShare?: () => void;
  occupation?: MainWorkspaceOccupation | null;
  hasNgrokToken?: boolean;
}
