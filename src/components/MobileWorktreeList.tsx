import { useState, useRef, useCallback, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Lock } from 'lucide-react';
import type { WorktreeListItem, WorkspaceRef, MainWorkspaceStatus } from '../types';

interface MobileWorktreeListProps {
    workspaces: WorkspaceRef[];
    currentWorkspace: WorkspaceRef | null;
    worktrees: WorktreeListItem[];
    mainWorkspace: MainWorkspaceStatus | null;
    selectedWorktree: WorktreeListItem | null;
    onSelectWorktree: (wt: WorktreeListItem) => void;
    onRefresh: () => void;
    showArchived: boolean;
    onToggleArchived: () => void;
    lockedWorktrees?: Record<string, string>;
    shareActive?: boolean;
    onOpenCreateModal?: () => void;
}

export const MobileWorktreeList: FC<MobileWorktreeListProps> = ({
    currentWorkspace,
    worktrees,
    mainWorkspace,
    selectedWorktree,
    onSelectWorktree,
    onRefresh,
    showArchived,
    onToggleArchived,
    lockedWorktrees = {},
    shareActive = false,
    onOpenCreateModal,
}) => {
    const { t } = useTranslation();
    const [refreshing, setRefreshing] = useState(false);

    // Pull-to-refresh
    const pullStartY = useRef(0);
    const [pullDistance, setPullDistance] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (containerRef.current && containerRef.current.scrollTop === 0) {
            pullStartY.current = e.touches[0].clientY;
        }
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (pullStartY.current === 0) return;
        const dy = e.touches[0].clientY - pullStartY.current;
        if (dy > 0 && containerRef.current && containerRef.current.scrollTop === 0) {
            setPullDistance(Math.min(dy * 0.4, 80));
        }
    }, []);

    const handleTouchEnd = useCallback(() => {
        if (pullDistance > 50) {
            setRefreshing(true);
            onRefresh();
            setTimeout(() => setRefreshing(false), 1000);
        }
        setPullDistance(0);
        pullStartY.current = 0;
    }, [pullDistance, onRefresh]);

    const activeWorktrees = worktrees.filter(w => !w.is_archived);
    const archivedWorktrees = worktrees.filter(w => w.is_archived);

    const getWorktreeStatus = (wt: WorktreeListItem) => {
        if (wt.is_archived) return 'archived';
        const total = wt.projects.reduce((acc, p) => acc + p.uncommitted_count, 0);
        if (total > 0) return 'modified';
        return 'clean';
    };

    const statusColors: Record<string, string> = {
        clean: 'bg-emerald-500',
        modified: 'bg-amber-500',
        archived: 'bg-slate-600',
    };

    return (
        <div
            ref={containerRef}
            className="h-full overflow-y-auto mobile-content"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Pull-to-refresh indicator */}
            {(pullDistance > 0 || refreshing) && (
                <div
                    className="flex items-center justify-center text-slate-500 transition-all"
                    style={{ height: refreshing ? 40 : pullDistance }}
                >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'ptr-spinner' : ''}`} />
                </div>
            )}

            {/* Header */}
            <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-semibold text-slate-100">
                            {currentWorkspace?.name || 'Worktree Manager'}
                        </h1>
                        {shareActive && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-green-400 mt-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                {t('mobile.sharing', '分享中')}
                            </span>
                        )}
                    </div>
                    {onOpenCreateModal && (
                        <button
                            onClick={onOpenCreateModal}
                            className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-lg font-light active:bg-blue-500/30 transition-colors"
                        >
                            +
                        </button>
                    )}
                </div>
                {mainWorkspace && mainWorkspace.projects.length > 0 && (
                    <div className="mt-2 px-3 py-2 bg-slate-800/60 border border-slate-700/50 rounded-lg">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{t('mobile.mainWorkspace', '主工作区')}</div>
                        <div className="text-xs text-slate-300">{mainWorkspace.projects.map(p => p.name).join(', ')}</div>
                    </div>
                )}
            </div>

            {/* Active Worktrees */}
            <div className="px-3 space-y-1.5">
                {activeWorktrees.map(wt => {
                    const status = getWorktreeStatus(wt);
                    const isSelected = selectedWorktree?.name === wt.name;
                    const isLocked = !!lockedWorktrees[wt.name];
                    const totalUncommitted = wt.projects.reduce((acc, p) => acc + p.uncommitted_count, 0);

                    return (
                        <button
                            key={wt.name}
                            onClick={() => onSelectWorktree(wt)}
                            className={`w-full text-left px-4 py-3 rounded-xl transition-all active:scale-[0.98] ${isSelected
                                ? 'bg-blue-500/15 border border-blue-500/30'
                                : 'bg-slate-800/50 border border-slate-700/30 active:bg-slate-700/50'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[status]}`} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-200 truncate">{wt.name}</span>
                                        {isLocked && <Lock className="w-3 h-3 text-amber-400/70" />}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {wt.projects.map(p => (
                                            <span key={p.name} className="text-[10px] text-slate-500 truncate">
                                                {p.name}:{p.current_branch}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                {totalUncommitted > 0 && (
                                    <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                                        {totalUncommitted}
                                    </span>
                                )}
                                <span className="text-slate-600 text-sm">›</span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Archived toggle */}
            {archivedWorktrees.length > 0 && (
                <div className="px-3 mt-4">
                    <button
                        onClick={onToggleArchived}
                        className="w-full text-left px-4 py-2.5 rounded-lg bg-slate-800/30 border border-slate-700/20 text-sm text-slate-500 active:bg-slate-700/30 transition-colors"
                    >
                        {showArchived ? '▼' : '▶'} {t('sidebar.archivedCount', { count: archivedWorktrees.length })}
                    </button>
                    {showArchived && (
                        <div className="mt-1.5 space-y-1">
                            {archivedWorktrees.map(wt => (
                                <button
                                    key={wt.name}
                                    onClick={() => onSelectWorktree(wt)}
                                    className="w-full text-left px-4 py-2.5 rounded-lg bg-slate-800/30 border border-slate-700/20 active:bg-slate-700/30 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" />
                                        <span className="text-sm text-slate-500 truncate">{wt.name}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Empty state */}
            {activeWorktrees.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                    <p className="text-slate-500 text-sm">{t('sidebar.noWorktrees')}</p>
                    {onOpenCreateModal && (
                        <button onClick={onOpenCreateModal} className="mt-3 px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium active:bg-blue-500/30 transition-colors">
                            {t('sidebar.createWorktree')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
