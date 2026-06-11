import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { StatusDot, GitBranchIcon, RefreshIcon, CheckIcon, CheckCircleIcon, WarningIcon } from './Icons';
import type { ArchiveModalState } from '../types';

interface ArchiveConfirmationModalProps {
  archiveModal: ArchiveModalState;
  onClose: () => void;
  onConfirmIssue: (issueKey: string) => void;
  onTerminateProcess: (pid: number) => void;
  onArchive: () => void;
  areAllIssuesConfirmed: boolean;
  archiving?: boolean;
  terminatingProcessPid?: number | null;
}

export const ArchiveConfirmationModal: FC<ArchiveConfirmationModalProps> = ({
  archiveModal,
  onClose,
  onConfirmIssue,
  onTerminateProcess,
  onArchive,
  areAllIssuesConfirmed,
  archiving = false,
  terminatingProcessPid = null,
}) => {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl w-[520px] max-h-[80vh] overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-[var(--color-border)]">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('archive.title')}</h3>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1 select-text">
            {archiveModal.worktree.display_name || archiveModal.worktree.name} → {archiveModal.worktree.name}.archive
          </p>
        </div>

        <div className="p-5 overflow-y-auto max-h-[50vh]">
          {archiveModal.loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshIcon className="w-5 h-5 animate-spin text-[var(--color-text-secondary)]" />
              <span className="ml-2 text-[var(--color-text-secondary)]">{t('archive.checkingStatus')}</span>
            </div>
          ) : archiveModal.status ? (
            <div className="space-y-4">
              {archiveModal.status.locked_processes.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('archive.fileUsage')}</h4>
                  <div className="space-y-2">
                    {archiveModal.status.locked_processes.map((process) => (
                      <div key={process.pid} className="bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[var(--color-error)]">
                              <WarningIcon className="w-4 h-4 text-[var(--color-error)] shrink-0" />
                              <span className="font-medium truncate">{process.name}</span>
                              <span className="text-xs text-[var(--color-error)]/70 shrink-0">PID {process.pid}</span>
                            </div>
                            <div className="mt-1 text-xs text-[var(--color-error)]/70">
                              {t('archive.lockedProcessDesc')}
                            </div>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => onTerminateProcess(process.pid)}
                            disabled={terminatingProcessPid !== null}
                            className="shrink-0"
                          >
                            {terminatingProcessPid === process.pid ? t('archive.terminating') : t('archive.terminateProcess')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {archiveModal.status.lock_check_error && archiveModal.status.locked_processes.length === 0 && (
                <div className="bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-lg p-3 text-sm text-[var(--color-error)]">
                  <div className="flex items-start gap-2">
                    <WarningIcon className="w-4 h-4 text-[var(--color-error)] shrink-0 mt-0.5" />
                    <span>{archiveModal.status.lock_check_error}</span>
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('archive.projectStatus')}</h4>
                <div className="space-y-2">
                  {archiveModal.status.projects.map((proj) => {
                    const hasUncommitted = proj.has_uncommitted && proj.uncommitted_count > 0;
                    const hasUnpushed = proj.unpushed_commits > 0;
                    const uncommittedKey = `proj-uncommitted-${proj.project_name}`;
                    const unpushedKey = `proj-unpushed-${proj.project_name}`;
                    const uncommittedConfirmed = archiveModal.confirmedIssues.has(uncommittedKey);
                    const unpushedConfirmed = archiveModal.confirmedIssues.has(unpushedKey);
                    const hasIssues = hasUncommitted || hasUnpushed;

                    return (
                      <div key={proj.project_name} className="bg-[var(--color-bg-base)]/50 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <StatusDot status={hasUncommitted ? 'warning' : hasUnpushed ? 'info' : 'success'} />
                            <span className="font-medium text-[var(--color-text-primary)]">{proj.project_name}</span>
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                            <GitBranchIcon className="w-3 h-3" />
                            <span className="select-text">{proj.branch_name}</span>
                          </div>
                        </div>

                        {hasIssues ? (
                          <div className="mt-2 pt-2 border-t border-[var(--color-border)]/50 space-y-1.5">
                            {hasUncommitted && (
                              <div className="flex items-center justify-between">
                                <span className={`text-xs ${uncommittedConfirmed ? 'text-[var(--color-warning)]/60 line-through' : 'text-[var(--color-warning)]'}`}>
                                  {t('archive.uncommittedChanges', { count: proj.uncommitted_count })}
                                </span>
                                {uncommittedConfirmed ? (
                                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                                    <CheckIcon className="w-3 h-3" />
                                    {t('archive.confirmed')}
                                  </span>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onConfirmIssue(uncommittedKey)}
                                    className="h-6 px-2 text-xs bg-[var(--color-warning)]/30 hover:bg-[var(--color-warning)]/50 text-[var(--color-warning)] border-[var(--color-warning)]/50"
                                  >
                                    {t('archive.confirmNoIssue')}
                                  </Button>
                                )}
                              </div>
                            )}
                            {hasUnpushed && (
                              <div className="flex items-center justify-between">
                                <span className={`text-xs ${unpushedConfirmed ? 'text-[var(--color-warning)]/60 line-through' : 'text-[var(--color-warning)]'}`}>
                                  {t('archive.unpushedCommits', { count: proj.unpushed_commits })}
                                </span>
                                {unpushedConfirmed ? (
                                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                                    <CheckIcon className="w-3 h-3" />
                                    {t('archive.confirmed')}
                                  </span>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onConfirmIssue(unpushedKey)}
                                    className="h-6 px-2 text-xs bg-[var(--color-warning)]/30 hover:bg-[var(--color-warning)]/50 text-[var(--color-warning)] border-[var(--color-warning)]/50"
                                  >
                                    {t('archive.confirmNoIssue')}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-emerald-400 flex items-center gap-1">
                            <CheckIcon className="w-3 h-3" />
                            <span>{t('archive.noIssues')}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {areAllIssuesConfirmed && (
                <div className="bg-emerald-900/20 border border-emerald-800/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-medium">
                    <CheckCircleIcon className="w-4 h-4" />
                    {t('archive.allConfirmedReady')}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {archiveModal.archiveError && (
          <div className="px-5 pb-4">
            <div className="bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-lg p-3 text-sm text-[var(--color-error)]">
              <div className="flex items-start gap-2">
                <WarningIcon className="w-4 h-4 text-[var(--color-error)] shrink-0 mt-0.5" />
                <span>{archiveModal.archiveError}</span>
              </div>
            </div>
          </div>
        )}

        <div className="p-5 border-t border-[var(--color-border)] flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="warning"
            onClick={onArchive}
            disabled={archiveModal.loading || !areAllIssuesConfirmed || archiving}
          >
            {archiving ? t('archive.archiving') : t('archive.confirmArchive')}
          </Button>
        </div>
      </div>
    </div>
  );
};
