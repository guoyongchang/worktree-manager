import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import type { CrashReport } from '../types';

interface CrashReportModalProps {
  report: CrashReport;
  onClose: () => void;
}

export const CrashReportModal: FC<CrashReportModalProps> = ({ report, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl w-full max-w-[560px] max-h-[80vh] overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-[var(--color-border)]">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">检测到上次异常退出</h3>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            上次程序未正常关闭，可能是崩溃、强制退出或系统关机导致。
          </p>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[55vh]">
          {report.previousSessionInfo && (
            <div>
              <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">上次会话</h4>
              <pre className="bg-[var(--color-bg-base)] border border-[var(--color-border)]/50 rounded-lg p-3 text-xs text-[var(--color-text-secondary)] font-mono whitespace-pre-wrap break-words select-text">
                {report.previousSessionInfo}
              </pre>
            </div>
          )}

          {report.crashDetail && (
            <div>
              <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">崩溃详情</h4>
              <pre className="bg-[var(--color-bg-base)] border border-[var(--color-border)]/50 rounded-lg p-3 text-xs text-[var(--color-text-secondary)] font-mono whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto select-text">
                {report.crashDetail}
              </pre>
            </div>
          )}

          <div className="bg-[var(--color-bg-base)]/50 border border-[var(--color-border)]/50 rounded-lg p-3 text-xs text-[var(--color-text-muted)] space-y-1">
            <div>日志路径：</div>
            <div className="font-mono break-all select-text">macOS: ~/Library/Logs/com.guo.worktree-manager/</div>
            <div className="font-mono break-all select-text">Windows: %LOCALAPPDATA%\com.guo.worktree-manager\logs\</div>
          </div>
        </div>

        <div className="p-5 border-t border-[var(--color-border)] flex justify-end">
          <Button onClick={onClose}>知道了</Button>
        </div>
      </div>
    </div>
  );
};
