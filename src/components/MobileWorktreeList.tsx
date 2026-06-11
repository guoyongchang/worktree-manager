import { useState, useRef, useCallback, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Lock, Palette } from 'lucide-react';
import type { WorktreeListItem, WorkspaceRef, MainWorkspaceStatus } from '../types';
import { useTheme } from '../hooks/useTheme';

interface MobileWorktreeListProps {
    workspaces: WorkspaceRef[];
    currentWorkspace: WorkspaceRef | null;
    worktrees: WorktreeListItem[];
    mainWorkspace: MainWorkspaceStatus | null;
    selectedWorktree: WorktreeListItem | null;
    onSelectWorktree: (wt: WorktreeListItem) => void;
    onRefresh: () => void;
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
    lockedWorktrees = {},
    shareActive = false,
    onOpenCreateModal,
}) => {
    const { t } = useTranslation();
    const [refreshing, setRefreshing] = useState(false);
    const [showThemePicker, setShowThemePicker] = useState(false);
    const { themeId, setTheme, themes } = useTheme();

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

    const getWorktreeStatus = (wt: WorktreeListItem) => {
        if (wt.is_archived) return 'archived';
        const total = wt.projects.reduce((acc, p) => acc + p.uncommitted_count, 0);
        if (total > 0) return 'modified';
        return 'clean';
    };

    const statusColors: Record<string, string> = {
        clean: 'bg-emerald-500',
        modified: 'bg-amber-500',
        archived: 'bg-[var(--color-bg-elevated)]',
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
                    className="flex items-center justify-center text-[var(--color-text-muted)] transition-all"
                    style={{ height: refreshing ? 40 : pullDistance }}
                >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'ptr-spinner' : ''}`} />
                </div>
            )}

            {/* Header */}
            <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowThemePicker(v => !v)}
                            className="w-8 h-8 rounded-full bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 flex items-center justify-center active:bg-[var(--color-bg-elevated)] transition-colors"
                        >
                            <Palette className="w-4 h-4 text-[var(--color-text-muted)]" />
                        </button>
                        <div>
                            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
                                {currentWorkspace?.name || 'Worktree Manager'}
                            </h1>
                            {shareActive && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-success)] mt-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                    {t('mobile.sharing', '分享中')}
                                </span>
                            )}
                        </div>
                    </div>
                    {onOpenCreateModal && (
                        <button
                            onClick={onOpenCreateModal}
                            className="w-8 h-8 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-sm font-light active:bg-[var(--color-accent)]/30 transition-colors"
                        >
                            +
                        </button>
                    )}
                </div>
                {mainWorkspace && mainWorkspace.projects.length > 0 && (
                    <div className="mt-2 px-3 py-2 bg-[var(--color-bg-surface)]/60 border border-[var(--color-border)]/50 rounded-lg">
                        <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">{t('mobile.mainWorkspace', '主工作区')}</div>
                        <div className="text-xs text-[var(--color-text-secondary)]">{mainWorkspace.projects.map(p => p.name).join(', ')}</div>
                    </div>
                )}
            </div>

            {/* Theme Picker */}
            {showThemePicker && (
                <div className="px-3 pb-2">
                    <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-xl p-3 space-y-1.5">
                        <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">{t('settings.activeTheme', '主题')}</div>
                        {themes.map(theme => {
                            const isActive = themeId === theme.id;
                            const c = theme.colors;
                            return (
                                <button
                                    key={theme.id}
                                    onClick={() => { setTheme(theme.id); setShowThemePicker(false); }}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all active:scale-[0.98] ${
                                        isActive
                                            ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30'
                                            : 'border border-transparent active:bg-[var(--color-bg-elevated)]/50'
                                    }`}
                                >
                                    <div className="flex gap-1 shrink-0">
                                        <span className="w-4 h-4 rounded-full border border-white/10" style={{ background: c.bgBase }} />
                                        <span className="w-4 h-4 rounded-full border border-white/10" style={{ background: c.accent }} />
                                        <span className="w-4 h-4 rounded-full border border-white/10" style={{ background: c.success }} />
                                    </div>
                                    <span className={`text-xs font-medium flex-1 text-left ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>
                                        {t(theme.nameKey || theme.id)}
                                    </span>
                                    {isActive && (
                                        <span className="text-[var(--color-accent)] text-xs">✓</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Active Worktrees */}
            <div className="px-3 space-y-1.5">
                {activeWorktrees.map(wt => {
                    const status = getWorktreeStatus(wt);
                    const isSelected = selectedWorktree?.name === wt.name;
                    const isLocked = !!lockedWorktrees[wt.name];
                    const totalUncommitted = wt.projects.reduce((acc, p) => acc + p.uncommitted_count, 0);
                    // Only allow selecting locked worktrees (ones open in PC editor)
                    const hasAnyLocked = Object.keys(lockedWorktrees).length > 0;
                    const isDisabled = hasAnyLocked && !isLocked;

                    return (
                        <button
                            key={wt.name}
                            onClick={() => !isDisabled && onSelectWorktree(wt)}
                            disabled={isDisabled}
                            className={`w-full text-left px-4 py-3 rounded-xl transition-all ${isDisabled
                                ? 'opacity-40 cursor-not-allowed'
                                : 'active:scale-[0.98]'
                                } ${isSelected
                                    ? 'bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30'
                                    : 'bg-[var(--color-bg-surface)] border border-[var(--color-border)]/30 active:bg-[var(--color-bg-elevated)]/50'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[status]}`} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{wt.display_name || wt.name}</span>
                                        {isLocked && <Lock className="w-3 h-3 text-[var(--color-warning)]/70" />}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {wt.projects.map(p => (
                                            <span key={p.name} className="text-[10px] text-[var(--color-text-muted)] truncate">
                                                {p.name}:{p.current_branch}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                {totalUncommitted > 0 && (
                                    <span className="text-[10px] text-[var(--color-warning)] bg-amber-500/10 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                                        {totalUncommitted}
                                    </span>
                                )}
                                {!isDisabled && <span className="text-[var(--color-text-muted)] text-sm">›</span>}
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Empty state */}
            {activeWorktrees.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                    <p className="text-[var(--color-text-muted)] text-sm">{t('sidebar.noWorktrees')}</p>
                    {onOpenCreateModal && (
                        <button onClick={onOpenCreateModal} className="mt-3 px-4 py-2 bg-[var(--color-accent)]/20 text-[var(--color-accent)] rounded-lg text-sm font-medium active:bg-[var(--color-accent)]/30 transition-colors">
                            {t('sidebar.createWorktree')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
