import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import type { WorktreeListItem, WorkspaceRef } from '../../types';
import {
  FolderIcon,
  SettingsIcon,
  SidebarExpandIcon,
  WorkspaceIcon,
} from '../Icons';

interface CollapsedSidebarProps {
  activeWorktrees: WorktreeListItem[];
  currentWorkspace: WorkspaceRef | null;
  currentWindowLabel: string;
  isTauri: boolean;
  lockedWorktrees: Record<string, string>;
  mainWorkspaceExists: boolean;
  onOpenSettings: () => void;
  onSelectWorktree: (worktree: WorktreeListItem | null) => void;
  onShowWorkspaceMenu: (show: boolean) => void;
  onToggleCollapsed?: () => void;
  selectedWorktree: WorktreeListItem | null;
  showWorkspaceMenu: boolean;
}

export const CollapsedSidebar: FC<CollapsedSidebarProps> = ({
  activeWorktrees,
  currentWorkspace,
  currentWindowLabel,
  isTauri,
  lockedWorktrees,
  mainWorkspaceExists,
  onOpenSettings,
  onSelectWorktree,
  onShowWorkspaceMenu,
  onToggleCollapsed,
  selectedWorktree,
  showWorkspaceMenu,
}) => {
  const { t } = useTranslation();

  return (
    <div className="w-12 bg-slate-800/50 border-r border-slate-700/50 flex flex-col items-center py-2 shrink-0">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleCollapsed}
              className="h-8 w-8 mb-2"
            >
              <SidebarExpandIcon className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('share.expandSidebar')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onShowWorkspaceMenu(!showWorkspaceMenu)}
              className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-700/50 transition-colors mb-1"
            >
              <WorkspaceIcon className="w-4 h-4 text-blue-400" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{currentWorkspace?.name || 'Workspace'}</TooltipContent>
        </Tooltip>

        <div className="w-6 h-px bg-slate-700/50 my-1.5" />

        {mainWorkspaceExists && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onSelectWorktree(null)}
                className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors mb-0.5 ${!selectedWorktree ? 'bg-slate-700/50' : 'hover:bg-slate-700/30'}`}
              >
                <FolderIcon className="w-4 h-4 text-slate-400" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('sidebar.main')}</TooltipContent>
          </Tooltip>
        )}

        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-0.5 w-full px-1">
          {activeWorktrees.map((worktree) => {
            const lockedBy = lockedWorktrees[worktree.name];
            const isLockedByOther = lockedBy && lockedBy !== currentWindowLabel;
            const canSelect = !isLockedByOther || !isTauri;
            return (
              <Tooltip key={worktree.name}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => canSelect && onSelectWorktree(worktree)}
                    className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors shrink-0 ${isLockedByOther && isTauri
                      ? 'opacity-30 cursor-not-allowed'
                      : selectedWorktree?.name === worktree.name
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'hover:bg-slate-700/30 text-blue-400'
                      }`}
                  >
                    <FolderIcon className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {worktree.display_name || worktree.name}{isLockedByOther ? ` (${t('sidebar.occupied')})` : ''}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-0.5 mt-1">
          {isTauri && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onOpenSettings} className="h-7 w-7">
                  <SettingsIcon className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t('sidebar.settings')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
};
