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
import { GitBranch } from 'lucide-react';

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
    <div className="w-12 bg-[var(--color-bg-surface)] border-r border-[var(--color-border)] flex flex-col items-center py-2 shrink-0">
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
              className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-[var(--color-bg-elevated)] transition-colors mb-1"
            >
              <WorkspaceIcon className="w-4 h-4 text-[var(--color-accent)]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{currentWorkspace?.name || 'Workspace'}</TooltipContent>
        </Tooltip>

        <div className="w-6 h-px bg-[var(--color-bg-elevated)] my-1.5" />

        {mainWorkspaceExists && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onSelectWorktree(null)}
                className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors mb-0.5 ${!selectedWorktree ? 'bg-[var(--color-bg-elevated)]' : 'hover:bg-[var(--color-bg-elevated)]'}`}
              >
                <FolderIcon className="w-4 h-4 text-[var(--color-text-secondary)]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('sidebar.main')}</TooltipContent>
          </Tooltip>
        )}

        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-0.5 w-full px-1 pt-px">
          {activeWorktrees.map((worktree) => {
            const lockedBy = lockedWorktrees[worktree.name];
            const isLockedByOther = lockedBy && lockedBy !== currentWindowLabel;
            const canSelect = !isLockedByOther || !isTauri;
            const isSelected = selectedWorktree?.name === worktree.name;
            const c = worktree.color;
            const btnClass = isLockedByOther && isTauri
              ? 'opacity-30 cursor-not-allowed'
              : isSelected
                ? c === 'red'    ? 'bg-red-500/20 text-red-400 ring-1 ring-red-400'
                : c === 'orange' ? 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-400'
                : c === 'yellow' ? 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-400'
                : c === 'green'  ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-400'
                : c === 'purple' ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-400'
                : 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                : c === 'red'    ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                : c === 'orange' ? 'bg-orange-500/10 text-orange-400 hover:bg-orange-500/20'
                : c === 'yellow' ? 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
                : c === 'green'  ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : c === 'purple' ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10';
            return (
              <Tooltip key={worktree.name}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => canSelect && onSelectWorktree(worktree)}
                    className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors shrink-0 ${btnClass}`}
                  >
                    <GitBranch className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div>{worktree.display_name ? `${worktree.display_name} (${worktree.name})` : worktree.name}</div>
                  <div className="text-[var(--color-text-muted)] text-xs mt-0.5">{t('sidebar.projects', { count: worktree.projects.length })}</div>
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
