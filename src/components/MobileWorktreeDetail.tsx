import { useState, useCallback, useRef, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { BackIcon } from './Icons';
import { GitOperations } from './GitOperations';
import { isTauri } from '../lib/backend';
import { Terminal as TerminalIcon, FolderOpen, Plus } from 'lucide-react';
import type {
    WorktreeListItem,
    MainWorkspaceStatus,
    MainWorkspaceOccupation,
    ProjectStatus,
    EditorType,
} from '../types';
import { EDITORS } from '../constants';

interface MobileWorktreeDetailProps {
    selectedWorktree: WorktreeListItem | null;
    mainWorkspace: MainWorkspaceStatus | null;
    onBack: () => void;
    onSwitchBranch?: (path: string, branch: string) => Promise<void>;
    onArchive?: () => void;
    onRestore?: (name: string) => void;
    onDelete?: () => void;
    onOpenInEditor?: (path: string) => void;
    onOpenInTerminal?: (path: string) => void;
    onRevealInFinder?: (path: string) => void;
    onOpenTerminalPanel?: (path: string) => void;
    onAddProjectToWorktree?: () => void;
    onRefresh?: () => void;
    selectedEditor?: EditorType;
    onSelectEditor?: (e: EditorType) => void;
    error?: string | null;
    onClearError?: () => void;
    restoring?: boolean;
    switching?: boolean;
    occupation?: MainWorkspaceOccupation | null;
    deploying?: boolean;
    exiting?: boolean;
    onDeployToMain?: (name: string) => Promise<any>;
    onExitOccupation?: (force?: boolean) => Promise<any>;
    onRefreshAfterDeploy?: () => void;
}

function getProjectStatusColor(project: ProjectStatus): string {
    if (project.uncommitted_count > 0) return 'border-l-amber-500';
    if (project.unpushed_commits > 0) return 'border-l-amber-400';
    if (!project.is_merged_to_test || !project.is_merged_to_base) return 'border-l-blue-400';
    return 'border-l-emerald-500';
}

export const MobileWorktreeDetail: FC<MobileWorktreeDetailProps> = ({
    selectedWorktree,
    mainWorkspace,
    onBack,
    onSwitchBranch,
    onArchive,
    onRestore,
    onDelete,
    onOpenInEditor,
    onRevealInFinder,
    onOpenTerminalPanel,
    onAddProjectToWorktree,
    onRefresh,
    selectedEditor = 'cursor',
    error,
    onClearError,
    restoring = false,
    occupation,
    deploying = false,
    exiting = false,
    onDeployToMain,
    onExitOccupation,
    onRefreshAfterDeploy,
}) => {
    const { t } = useTranslation();
    const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
    const [expandedProject, setExpandedProject] = useState<string | null>(null);

    const handleSwitchBranch = useCallback(async (branch: string) => {
        if (!selectedWorktree || !onSwitchBranch) return;
        setSwitchingBranch(branch);
        try {
            await onSwitchBranch(selectedWorktree.path, branch);
        } finally {
            setSwitchingBranch(null);
        }
    }, [selectedWorktree, onSwitchBranch]);

    const handleCopyPath = useCallback(async (path: string) => {
        try { await navigator.clipboard.writeText(path); } catch { }
    }, []);

    // Swipe-right to go back
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }, []);
    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = Math.abs(touch.clientY - touchStartRef.current.y);
        touchStartRef.current = null;
        // Swipe right: 80px minimum, horizontal dominant
        if (dx > 80 && dx > dy * 1.5) {
            onBack();
        }
    }, [onBack]);

    if (!selectedWorktree) {
        return (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                {t('detail.selectWorktree')}
            </div>
        );
    }

    const isArchived = selectedWorktree.is_archived;
    const isMainWorkspace = !selectedWorktree.projects?.length && mainWorkspace;

    return (
        <div className="h-full overflow-y-auto mobile-content animate-slide-in"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/50 px-3 py-2.5 flex items-center gap-2">
                <button onClick={onBack} className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-slate-700/50 transition-colors">
                    <BackIcon className="w-5 h-5" />
                </button>
                <div className="flex-1 min-w-0">
                    <h2 className="text-base font-semibold truncate">{selectedWorktree.name}</h2>
                    <button onClick={() => handleCopyPath(selectedWorktree.path)} className="text-[10px] text-slate-500 truncate block max-w-full text-left">
                        {selectedWorktree.path}
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mx-3 mt-2 p-3 bg-red-900/30 border border-red-800/50 rounded-lg">
                    <div className="text-red-300 text-xs">{error}</div>
                    {onClearError && (
                        <button onClick={onClearError} className="text-red-400 text-[10px] mt-1 underline">{t('common.close')}</button>
                    )}
                </div>
            )}

            {/* Quick actions */}
            <div className="px-3 pt-3 flex gap-2">
                {!isArchived && (
                    <>
                        {isTauri() && onOpenInEditor && (
                            <button
                                onClick={() => onOpenInEditor(selectedWorktree.path)}
                                className="flex-1 py-2.5 rounded-lg bg-blue-500/15 text-blue-400 text-xs font-medium active:bg-blue-500/25 transition-colors"
                            >
                                {EDITORS.find(e => e.id === selectedEditor)?.name || 'Editor'}
                            </button>
                        )}
                        {onOpenTerminalPanel && (
                            <button
                                onClick={() => onOpenTerminalPanel(selectedWorktree.path)}
                                className="flex-1 py-2.5 rounded-lg bg-slate-700/50 text-slate-300 text-xs font-medium active:bg-slate-600/50 transition-colors"
                            >
                                <TerminalIcon className="w-3.5 h-3.5 inline mr-1" />{t('terminal.toggleTerminal')}
                            </button>
                        )}
                        {isTauri() && onRevealInFinder && (
                            <button
                                onClick={() => onRevealInFinder(selectedWorktree.path)}
                                className="py-2.5 px-3 rounded-lg bg-slate-700/50 text-slate-300 text-xs font-medium active:bg-slate-600/50 transition-colors"
                            >
                                <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </>
                )}
                {isArchived && onRestore && (
                    <Button variant="secondary" size="sm" onClick={() => onRestore(selectedWorktree.name)} disabled={restoring} className="flex-1 h-10">
                        {restoring ? t('detail.restoring') : t('detail.restore')}
                    </Button>
                )}
                {isArchived && onDelete && (
                    <Button variant="warning" size="sm" onClick={onDelete} className="h-10">
                        {t('detail.delete')}
                    </Button>
                )}
            </div>

            {/* Occupation banner */}
            {occupation && occupation.worktree_name === selectedWorktree.name && (
                <div className="mx-3 mt-3 p-3 bg-amber-900/20 border border-amber-700/30 rounded-lg">
                    <div className="text-xs text-amber-300">{t('deploy.occupiedBanner', { name: occupation.worktree_name })}</div>
                    <div className="flex gap-2 mt-2">
                        {onExitOccupation && (
                            <Button variant="secondary" size="sm" onClick={() => onExitOccupation()} disabled={exiting} className="h-9 text-xs">
                                {exiting ? t('deploy.exiting') : t('deploy.exitOccupation')}
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* Projects */}
            <div className="px-3 pt-4 space-y-2">
                {selectedWorktree.projects.map(project => (
                    <div
                        key={project.name}
                        className={`bg-slate-800/50 border border-slate-700/30 rounded-xl overflow-hidden border-l-2 ${getProjectStatusColor(project)}`}
                    >
                        {/* Project header - always visible */}
                        <button
                            onClick={() => setExpandedProject(expandedProject === project.name ? null : project.name)}
                            className="w-full text-left px-4 py-3 active:bg-slate-700/30 transition-colors"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-200 truncate">{project.name}</div>
                                    <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                        <span className="font-mono">{project.current_branch}</span>
                                        {project.uncommitted_count > 0 && (
                                            <span className="text-amber-400">{t('detail.uncommitted', { count: project.uncommitted_count })}</span>
                                        )}
                                        {project.unpushed_commits > 0 && (
                                            <span className="text-amber-300">{t('detail.unpushedCommits', { count: project.unpushed_commits })}</span>
                                        )}
                                        {project.ahead_of_base > 0 && (
                                            <span className="text-blue-400">{t('detail.notMergedToBase', { branch: project.base_branch, count: project.ahead_of_base })}</span>
                                        )}
                                        {project.ahead_of_test > 0 && (
                                            <span className="text-blue-400">{t('detail.notMergedToTest', { branch: project.test_branch, count: project.ahead_of_test })}</span>
                                        )}
                                    </div>
                                </div>
                                <span className="text-slate-600 text-sm">{expandedProject === project.name ? '▼' : '▶'}</span>
                            </div>
                        </button>

                        {/* Expanded: branch switch + git ops */}
                        {expandedProject === project.name && (
                            <div className="px-4 pb-3 space-y-3 border-t border-slate-700/30 pt-3">
                                {/* Branch switch buttons */}
                                <div>
                                    <label className="block text-[10px] text-slate-600 mb-1">{t('detail.switchBranch')}</label>
                                    <div className="flex gap-1 flex-wrap">
                                        <button
                                            onClick={() => handleSwitchBranch(project.base_branch)}
                                            disabled={!!switchingBranch || project.current_branch === project.base_branch}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${project.current_branch === project.base_branch
                                                ? 'bg-blue-500/20 text-blue-400'
                                                : 'bg-slate-700/40 text-slate-400 active:bg-slate-600/40'
                                                }`}
                                        >
                                            BASE
                                        </button>
                                        <button
                                            onClick={() => handleSwitchBranch(project.test_branch)}
                                            disabled={!!switchingBranch || project.current_branch === project.test_branch}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${project.current_branch === project.test_branch
                                                ? 'bg-blue-500/20 text-blue-400'
                                                : 'bg-slate-700/40 text-slate-400 active:bg-slate-600/40'
                                                }`}
                                        >
                                            TEST
                                        </button>
                                        <button
                                            onClick={() => handleSwitchBranch('HEAD')}
                                            disabled={!!switchingBranch}
                                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700/40 text-slate-400 active:bg-slate-600/40 transition-colors"
                                        >
                                            HEAD
                                        </button>
                                    </div>
                                    {switchingBranch && (
                                        <span className="text-[10px] text-slate-500 mt-1 block">{t('detail.switching')}</span>
                                    )}
                                </div>

                                {/* Git operations */}
                                <GitOperations
                                    projectPath={project.path}
                                    baseBranch={project.base_branch}
                                    testBranch={project.test_branch || ''}
                                    currentBranch={project.current_branch}
                                    onRefresh={onRefresh}
                                />

                                {/* Terminal for this project */}
                                {onOpenTerminalPanel && (
                                    <button
                                        onClick={() => onOpenTerminalPanel(project.path)}
                                        className="w-full py-2 rounded-lg bg-slate-700/30 text-slate-400 text-xs font-medium active:bg-slate-600/30 transition-colors"
                                    >
                                        <TerminalIcon className="w-3.5 h-3.5 inline mr-1" />{t('detail.openInTerminal')}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ))}

                {/* Empty state */}
                {selectedWorktree.projects.length === 0 && !isMainWorkspace && (
                    <div className="text-center py-8 text-slate-600 text-sm">
                        {t('detail.noProjectsConfigured')}
                    </div>
                )}

                {/* Add project */}
                {!isArchived && onAddProjectToWorktree && (
                    <button
                        onClick={onAddProjectToWorktree}
                        className="w-full py-3 rounded-xl border border-dashed border-slate-700/50 text-slate-500 text-xs font-medium active:bg-slate-800/50 transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5 inline mr-1" />{t('detail.addProject')}
                    </button>
                )}
            </div>

            {/* Deploy to main */}
            {!isArchived && !isMainWorkspace && onDeployToMain && (
                <div className="px-3 pt-4">
                    <Button
                        variant="secondary"
                        size="sm"
                        className="w-full h-10"
                        onClick={async () => {
                            await onDeployToMain(selectedWorktree.name);
                            onRefreshAfterDeploy?.();
                        }}
                        disabled={deploying}
                    >
                        {deploying ? t('deploy.deploying') : t('deploy.deployToMain')}
                    </Button>
                </div>
            )}

            {/* Archive */}
            {!isArchived && onArchive && (
                <div className="px-3 pt-3 pb-6">
                    <button
                        onClick={onArchive}
                        className="w-full py-2.5 rounded-lg text-red-400/70 text-xs font-medium active:bg-red-900/20 transition-colors border border-red-800/20"
                    >
                        {t('detail.archive')}
                    </button>
                </div>
            )}
        </div>
    );
};
