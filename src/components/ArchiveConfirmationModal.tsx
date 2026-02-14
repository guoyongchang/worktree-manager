import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { StatusDot, GitBranchIcon, RefreshIcon, CheckIcon, CheckCircleIcon } from './Icons';
import type { ArchiveModalState } from '../types';

interface ArchiveConfirmationModalProps {
  archiveModal: ArchiveModalState;
  onClose: () => void;
  onConfirmIssue: (issueKey: string) => void;
  onArchive: () => void;
  areAllIssuesConfirmed: boolean;
  archiving?: boolean;
}

export const ArchiveConfirmationModal: FC<ArchiveConfirmationModalProps> = ({
  archiveModal,
  onClose,
  onConfirmIssue,
  onArchive,
  areAllIssuesConfirmed,
  archiving = false,
}) => {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-[520px] max-h-[80vh] overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-100">归档 Worktree</h3>
          <p className="text-sm text-slate-400 mt-1 select-text">
            {archiveModal.worktree.name} → {archiveModal.worktree.name}.archive
          </p>
        </div>

        <div className="p-5 overflow-y-auto max-h-[50vh]">
          {archiveModal.loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshIcon className="w-5 h-5 animate-spin text-slate-400" />
              <span className="ml-2 text-slate-400">检查分支状态...</span>
            </div>
          ) : archiveModal.status ? (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-slate-300 mb-2">项目状态</h4>
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
                      <div key={proj.project_name} className="bg-slate-900/50 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <StatusDot status={hasUncommitted ? 'warning' : hasUnpushed ? 'info' : 'success'} />
                            <span className="font-medium text-slate-200">{proj.project_name}</span>
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-1">
                            <GitBranchIcon className="w-3 h-3" />
                            <span className="select-text">{proj.branch_name}</span>
                          </div>
                        </div>

                        {hasIssues ? (
                          <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1.5">
                            {hasUncommitted && (
                              <div className="flex items-center justify-between">
                                <span className={`text-xs ${uncommittedConfirmed ? 'text-amber-400/60 line-through' : 'text-amber-400'}`}>
                                  有 {proj.uncommitted_count} 个未提交更改
                                </span>
                                {uncommittedConfirmed ? (
                                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                                    <CheckIcon className="w-3 h-3" />
                                    已确认
                                  </span>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onConfirmIssue(uncommittedKey)}
                                    className="h-6 px-2 text-xs bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border-amber-600/50"
                                  >
                                    确认无问题
                                  </Button>
                                )}
                              </div>
                            )}
                            {hasUnpushed && (
                              <div className="flex items-center justify-between">
                                <span className={`text-xs ${unpushedConfirmed ? 'text-amber-400/60 line-through' : 'text-amber-400'}`}>
                                  有 {proj.unpushed_commits} 个未推送提交
                                </span>
                                {unpushedConfirmed ? (
                                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                                    <CheckIcon className="w-3 h-3" />
                                    已确认
                                  </span>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onConfirmIssue(unpushedKey)}
                                    className="h-6 px-2 text-xs bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border-amber-600/50"
                                  >
                                    确认无问题
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-emerald-400 flex items-center gap-1">
                            <CheckIcon className="w-3 h-3" />
                            <span>无问题</span>
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
                    所有问题已确认，可以归档
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="p-5 border-t border-slate-700 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="warning"
            onClick={onArchive}
            disabled={archiveModal.loading || !areAllIssuesConfirmed || archiving}
          >
            {archiving ? "归档中..." : "确认归档"}
          </Button>
        </div>
      </div>
    </div>
  );
};
