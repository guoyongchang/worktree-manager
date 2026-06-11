import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { BackIcon } from './Icons';
import { GitOperations } from './GitOperations';
import { Terminal as TerminalIcon, Plus, FolderGit2 } from 'lucide-react';
import { TerminalPanel } from './TerminalPanel';
import type {
    WorktreeListItem,
    MainWorkspaceStatus,
    MainWorkspaceOccupation,
    ProjectStatus,
    EditorType,
    TerminalTab,
} from '../types';
import type { VoiceStatus, StagingState } from '../hooks/useVoiceInput';

type DetailTab = 'projects' | 'terminals';

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
    // Terminal props
    terminalTabs?: TerminalTab[];
    activatedTerminals?: Set<string>;
    mountedTerminals?: Set<string>;
    activeTerminalTab?: string | null;
    onTerminalTabClick?: (path: string) => void;
    onTerminalTabContextMenu?: (e: React.MouseEvent, path: string, name: string) => void;
    onCloseTerminalTab?: (path: string) => void;
    onCloseAllTerminalTabs?: () => void;
    clientId?: string;
    voiceStatus?: VoiceStatus;
    voiceError?: string | null;
    voiceWarning?: string | null;
    isKeyHeld?: boolean;
    analyserNode?: AnalyserNode | null;
    onToggleVoice?: () => void;
    onStopRecording?: () => void;
    staging?: StagingState | null;
}

function getProjectStatusColor(project: ProjectStatus): string {
    if (project.uncommitted_count > 0) return 'border-l-amber-500';
    if (project.unpushed_commits > 0) return 'border-l-[var(--color-warning)]';
    if (!project.is_merged_to_test || !project.is_merged_to_base) return 'border-l-[var(--color-accent)]';
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
    onOpenInEditor: _onOpenInEditor,
    onRevealInFinder: _onRevealInFinder,
    onOpenTerminalPanel,
    onAddProjectToWorktree,
    onRefresh,
    selectedEditor: _selectedEditor = 'cursor',
    error,
    onClearError,
    restoring = false,
    occupation,
    deploying: _deploying = false,
    exiting = false,
    onDeployToMain: _onDeployToMain,
    onExitOccupation,
    onRefreshAfterDeploy: _onRefreshAfterDeploy,
    // Terminal props
    terminalTabs = [],
    activatedTerminals = new Set<string>(),
    mountedTerminals = new Set<string>(),
    activeTerminalTab = null,
    onTerminalTabClick,
    onTerminalTabContextMenu,
    onCloseTerminalTab,
    onCloseAllTerminalTabs,
    clientId,
    voiceStatus,
    voiceError,
    voiceWarning,
    isKeyHeld,
    analyserNode,
    onToggleVoice,
    onStopRecording,
    staging,
}) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<DetailTab>('projects');
    const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
    const [expandedProject, setExpandedProject] = useState<string | null>(null);
    const [terminalFullscreen, setTerminalFullscreen] = useState(false);

    // When switching to terminals tab, auto-enter fullscreen
    const switchToTerminals = useCallback(() => {
        setActiveTab('terminals');
        setTerminalFullscreen(true);
        setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    }, []);

    // Trigger terminal resize after fullscreen toggle
    const toggleTerminalFullscreen = useCallback(() => {
        setTerminalFullscreen(f => {
            // Exiting fullscreen → go back to projects
            if (f) {
                setTimeout(() => setActiveTab('projects'), 0);
            }
            return !f;
        });
        // Delay to let CSS layout settle, then trigger resize
        setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    }, []);

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
        try { await navigator.clipboard.writeText(path); } catch { /* clipboard API may not be available */ }
    }, []);

    // Lock body scroll when terminal tab is active (prevent page bounce on mobile)
    useEffect(() => {
        if (activeTab === 'terminals') {
            document.body.style.overflow = 'hidden';
            document.body.style.touchAction = 'none';
            return () => {
                document.body.style.overflow = '';
                document.body.style.touchAction = '';
            };
        }
    }, [activeTab]);

    // Swipe-right to go back (disabled when on terminals tab to avoid interfering with xterm)
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (activeTab === 'terminals') return;
        const touch = e.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }, [activeTab]);
    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = Math.abs(touch.clientY - touchStartRef.current.y);
        touchStartRef.current = null;
        if (dx > 80 && dx > dy * 1.5) {
            onBack();
        }
    }, [onBack]);

    if (!selectedWorktree) {
        return (
            <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                {t('detail.selectWorktree')}
            </div>
        );
    }

    const isArchived = selectedWorktree.is_archived;
    const isMainWorkspace = !selectedWorktree.projects?.length && mainWorkspace;

    return (
        <div className="h-full flex flex-col overflow-hidden"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Header */}
            <div className="shrink-0 bg-[var(--color-bg-base)]/95 backdrop-blur-sm border-b border-[var(--color-border)]/50 px-3 py-2.5 flex items-center gap-2">
                {/* Hide back button when inside iframe (iOS app already has one) */}
                {window.parent === window && (
                    <button onClick={onBack} className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-[var(--color-bg-elevated)]/50 transition-colors">
                        <BackIcon className="w-5 h-5" />
                    </button>
                )}
                <div className="flex-1 min-w-0">
                    <h2 className="text-base font-semibold truncate">{selectedWorktree.display_name || selectedWorktree.name}</h2>
                    <button onClick={() => handleCopyPath(selectedWorktree.path)} className="text-[10px] text-[var(--color-text-muted)] truncate block max-w-full text-left">
                        {selectedWorktree.path}
                    </button>
                </div>
            </div>



            {/* Tab Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {/* Projects Tab */}
                {activeTab === 'projects' && (
                    <div className="h-full overflow-y-auto mobile-content animate-slide-in">
                        {/* Error */}
                        {error && (
                            <div className="mx-3 mt-2 p-3 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-lg">
                                <div className="text-[var(--color-error)] text-xs">{error}</div>
                                {onClearError && (
                                    <button onClick={onClearError} className="text-[var(--color-error)] text-[10px] mt-1 underline">{t('common.close')}</button>
                                )}
                            </div>
                        )}

                        {/* Occupation banner */}
                        {occupation && occupation.worktree_name === selectedWorktree.name && (
                            <div className="mx-3 mt-3 p-3 bg-amber-900/20 border border-amber-700/30 rounded-lg">
                                <div className="text-xs text-[var(--color-warning)]">{t('deploy.occupiedBanner', { name: occupation.worktree_name })}</div>
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
                        <div className="px-3 pt-3 space-y-2">
                            {selectedWorktree.projects.map((project, index) => (
                                <div
                                    key={project.name}
                                    className={`bg-[var(--color-bg-surface)] border border-[var(--color-border)]/30 rounded-xl overflow-hidden border-l-2 ${getProjectStatusColor(project)}`}
                                >
                                    {/* Project header */}
                                    <button
                                        onClick={() => setExpandedProject(expandedProject === project.name ? null : project.name)}
                                        className="w-full text-left px-4 py-3 active:bg-[var(--color-bg-elevated)]/30 transition-colors"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{project.name}</div>
                                                <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 flex items-center gap-1.5 flex-wrap">
                                                    <span className="font-mono">{project.current_branch}</span>
                                                    {project.uncommitted_count > 0 && (
                                                        <span className="text-[var(--color-warning)]">{t('detail.uncommitted', { count: project.uncommitted_count })}</span>
                                                    )}
                                                    {project.unpushed_commits > 0 && (
                                                        <span className="text-[var(--color-warning)]">{t('detail.unpushedCommits', { count: project.unpushed_commits })}</span>
                                                    )}
                                                    {project.ahead_of_base > 0 && (
                                                        <span className="text-[var(--color-accent)]">{t('detail.notMergedToBase', { branch: project.base_branch, count: project.ahead_of_base })}</span>
                                                    )}
                                                    {project.ahead_of_test > 0 && (
                                                        <span className="text-[var(--color-accent)]">{t('detail.notMergedToTest', { branch: project.test_branch, count: project.ahead_of_test })}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="text-[var(--color-text-muted)] text-sm">{expandedProject === project.name ? '▼' : '▶'}</span>
                                        </div>
                                    </button>

                                    {/* Expanded: branch switch + git ops */}
                                    {expandedProject === project.name && (
                                        <div className="px-4 pb-3 space-y-3 border-t border-[var(--color-border)]/30 pt-3">
                                            {/* Branch switch buttons */}
                                            <div>
                                                <label className="block text-[10px] text-[var(--color-text-muted)] mb-1">{t('detail.switchBranch')}</label>
                                                <div className="flex gap-1 flex-wrap">
                                                    <button
                                                        onClick={() => handleSwitchBranch(project.base_branch)}
                                                        disabled={!!switchingBranch || project.current_branch === project.base_branch}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${project.current_branch === project.base_branch
                                                            ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                                                            : 'bg-[var(--color-bg-elevated)]/40 text-[var(--color-text-secondary)] active:bg-[var(--color-bg-elevated)]/40'
                                                            }`}
                                                    >
                                                        BASE
                                                    </button>
                                                    <button
                                                        onClick={() => handleSwitchBranch(project.test_branch)}
                                                        disabled={!!switchingBranch || project.current_branch === project.test_branch}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${project.current_branch === project.test_branch
                                                            ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                                                            : 'bg-[var(--color-bg-elevated)]/40 text-[var(--color-text-secondary)] active:bg-[var(--color-bg-elevated)]/40'
                                                            }`}
                                                    >
                                                        TEST
                                                    </button>
                                                    <button
                                                        onClick={() => handleSwitchBranch('HEAD')}
                                                        disabled={!!switchingBranch}
                                                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-bg-elevated)]/40 text-[var(--color-text-secondary)] active:bg-[var(--color-bg-elevated)]/40 transition-colors"
                                                    >
                                                        HEAD
                                                    </button>
                                                </div>
                                                {switchingBranch && (
                                                    <span className="text-[10px] text-[var(--color-text-muted)] mt-1 block">{t('detail.switching')}</span>
                                                )}
                                            </div>

                                            {/* Git operations */}
                                            <GitOperations
                                                projectPath={project.path}
                                                projectName={project.name}
                                                baseBranch={project.base_branch}
                                                testBranch={project.test_branch || ''}
                                                currentBranch={project.current_branch}
                                                worktreeDisplayName={selectedWorktree.display_name || selectedWorktree.name}
                                                onRefresh={onRefresh}
                                                autoRefreshSlot={selectedWorktree.is_archived ? undefined : index}
                                            />

                                            {/* Open terminal for this project */}
                                            {onOpenTerminalPanel && (
                                                <button
                                                    onClick={() => {
                                                        onOpenTerminalPanel(project.path);
                                                        switchToTerminals();
                                                    }}
                                                    className="w-full py-2 rounded-lg bg-[var(--color-bg-elevated)]/30 text-[var(--color-text-secondary)] text-xs font-medium active:bg-[var(--color-bg-elevated)]/30 transition-colors"
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
                                <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
                                    {t('detail.noProjectsConfigured')}
                                </div>
                            )}

                            {/* Add project */}
                            {!isArchived && onAddProjectToWorktree && (
                                <button
                                    onClick={onAddProjectToWorktree}
                                    className="w-full py-3 rounded-xl border border-dashed border-[var(--color-border)]/50 text-[var(--color-text-muted)] text-xs font-medium active:bg-[var(--color-bg-surface)] transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5 inline mr-1" />{t('detail.addProject')}
                                </button>
                            )}
                        </div>



                        {/* Archive */}
                        {!isArchived && onArchive && (
                            <div className="px-3 pt-3 pb-6">
                                <button
                                    onClick={onArchive}
                                    className="w-full py-2.5 rounded-lg text-[var(--color-error)]/70 text-xs font-medium active:bg-[var(--color-error)]/10 transition-colors border border-[var(--color-error)]/20"
                                >
                                    {t('detail.archive')}
                                </button>
                            </div>
                        )}

                        {/* Archived actions */}
                        {isArchived && (
                            <div className="px-3 pt-3 flex gap-2">
                                {onRestore && (
                                    <Button variant="secondary" size="sm" onClick={() => onRestore(selectedWorktree.name)} disabled={restoring} className="flex-1 h-10">
                                        {restoring ? t('detail.restoring') : t('detail.restore')}
                                    </Button>
                                )}
                                {onDelete && (
                                    <Button variant="warning" size="sm" onClick={onDelete} className="h-10">
                                        {t('detail.delete')}
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Terminals Tab */}
                {activeTab === 'terminals' && (
                    <div className="h-full flex flex-col">
                        {/* Quick open terminal buttons */}
                        {selectedWorktree.projects.length > 0 && activatedTerminals.size === 0 && (
                            <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)]/30 bg-[var(--color-bg-base)]/60">
                                <div className="text-[10px] text-[var(--color-text-muted)] mb-1.5">Open terminal for:</div>
                                <div className="flex gap-1.5 flex-wrap">
                                    {selectedWorktree.projects.map(p => (
                                        <button
                                            key={p.path}
                                            onClick={() => onOpenTerminalPanel?.(p.path)}
                                            className="px-3 py-1.5 rounded-lg bg-[var(--color-bg-elevated)]/40 text-[var(--color-text-secondary)] text-xs font-medium active:bg-[var(--color-bg-elevated)]/40 transition-colors"
                                        >
                                            <TerminalIcon className="w-3 h-3 inline mr-1" />{p.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Terminal panel */}
                        <div className="flex-1 min-h-0 flex flex-col"
                            style={{ touchAction: 'none' }}
                        >
                            {activatedTerminals.size > 0 ? (
                                <TerminalPanel
                                    visible={true}
                                    height={0}
                                    fillContainer={true}
                                    isFullscreen={terminalFullscreen}
                                    onToggleFullscreen={toggleTerminalFullscreen}
                                    onStartResize={() => { }}
                                    terminalTabs={terminalTabs}
                                    activatedTerminals={activatedTerminals}
                                    mountedTerminals={mountedTerminals}
                                    activeTerminalTab={activeTerminalTab}
                                    onTabClick={(path) => onTerminalTabClick?.(path)}
                                    onTabContextMenu={(e, path, name) => onTerminalTabContextMenu?.(e, path, name)}
                                    onCloseTab={(path) => onCloseTerminalTab?.(path)}
                                    onCloseAllTabs={() => onCloseAllTerminalTabs?.()}
                                    onToggle={() => { }}
                                    onCollapse={toggleTerminalFullscreen}
                                    voiceStatus={voiceStatus}
                                    voiceError={voiceError}
                                    voiceWarning={voiceWarning}
                                    isKeyHeld={isKeyHeld}
                                    analyserNode={analyserNode}
                                    onToggleVoice={onToggleVoice}
                                    onStopRecording={onStopRecording}
                                    staging={staging}
                                    clientId={clientId}
                                />
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-muted)] text-sm">
                                    <TerminalIcon className="w-8 h-8 mb-2 text-[var(--color-text-muted)]" />
                                    <p>No terminals open</p>
                                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Tap a project above to start</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom tab bar: Projects | Terminals */}
            {!isArchived && (
                <div
                    className="shrink-0 bg-[var(--color-bg-base)]/95 backdrop-blur-md border-t border-[var(--color-border)]/50"
                    style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
                >
                    <div className="flex items-stretch h-12">
                        <button
                            onClick={() => setActiveTab('projects')}
                            className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-all active:scale-95 ${activeTab === 'projects'
                                ? 'text-[var(--color-accent)]'
                                : 'text-[var(--color-text-muted)] active:text-[var(--color-text-secondary)]'
                                }`}
                        >
                            <FolderGit2 className="w-5 h-5" />
                            <span className="text-[10px] font-medium leading-none">Projects</span>
                            {activeTab === 'projects' && (
                                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[var(--color-accent)]" />
                            )}
                        </button>
                        <button
                            onClick={switchToTerminals}
                            className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-all active:scale-95 ${activeTab === 'terminals'
                                ? 'text-[var(--color-accent)]'
                                : 'text-[var(--color-text-muted)] active:text-[var(--color-text-secondary)]'
                                }`}
                        >
                            <div className="relative">
                                <TerminalIcon className="w-5 h-5" />
                                {activatedTerminals.size > 0 && (
                                    <span className="absolute -top-1 -right-2.5 inline-flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-[var(--color-accent)] text-[8px] text-white font-bold px-0.5 leading-none">
                                        {activatedTerminals.size}
                                    </span>
                                )}
                            </div>
                            <span className="text-[10px] font-medium leading-none">Terminals</span>
                            {activeTab === 'terminals' && (
                                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[var(--color-accent)]" />
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
