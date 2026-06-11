import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Rocket,
  Download,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  RotateCw,
  Globe,
} from 'lucide-react';
import type { UpdateInfo, DownloadProgress } from '@/hooks/useUpdater';

// --- Utility Functions ---

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Simple Markdown Renderer ---

const SimpleMarkdown: FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} className="space-y-1 mb-3">
          {listItems.map((item, i) => (
            <li key={i} className="text-sm text-[var(--color-text-secondary)] flex items-start gap-2">
              <span className="text-[var(--color-accent)] mt-0.5 shrink-0">•</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  const renderInline = (text: string): React.ReactNode => {
    // Handle **bold** and `code`
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let partKey = 0;
    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      const codeMatch = remaining.match(/`(.+?)`/);

      // Find the earliest match
      const boldIdx = boldMatch?.index ?? Infinity;
      const codeIdx = codeMatch?.index ?? Infinity;

      if (boldIdx === Infinity && codeIdx === Infinity) {
        parts.push(remaining);
        break;
      }

      if (boldIdx <= codeIdx && boldMatch) {
        parts.push(remaining.slice(0, boldIdx));
        parts.push(<strong key={partKey++} className="text-[var(--color-text-primary)] font-medium">{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldIdx + boldMatch[0].length);
      } else if (codeMatch) {
        parts.push(remaining.slice(0, codeIdx));
        parts.push(<code key={partKey++} className="px-1 py-0.5 bg-[var(--color-bg-elevated)] rounded text-xs text-[var(--color-accent)]">{codeMatch[1]}</code>);
        remaining = remaining.slice(codeIdx + codeMatch[0].length);
      }
    }
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    // Heading: ### or ##
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level <= 2) {
        elements.push(
          <h3 key={key++} className="text-sm font-semibold text-[var(--color-text-primary)] mb-2 mt-3 first:mt-0">
            {renderInline(text)}
          </h3>
        );
      } else {
        elements.push(
          <h4 key={key++} className="text-sm font-medium text-[var(--color-text-secondary)] mb-1.5 mt-2.5 first:mt-0">
            {renderInline(text)}
          </h4>
        );
      }
      continue;
    }

    // List item: - or *
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      listItems.push(listMatch[1]);
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={key++} className="text-sm text-[var(--color-text-secondary)] mb-2">
        {renderInline(trimmed)}
      </p>
    );
  }
  flushList();

  return <div className="select-text">{elements}</div>;
};

// --- Update Notification Dialog ---

interface UpdateNotificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfo;
  onUpdate: () => void;
  onMirrorDownload: () => void;
  onLater: () => void;
}

export const UpdateNotificationDialog: FC<UpdateNotificationDialogProps> = ({
  open,
  onOpenChange,
  updateInfo,
  onUpdate,
  onMirrorDownload,
  onLater,
}) => {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] p-0">
        <DialogHeader className="p-5 pb-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center">
              <Rocket className="w-5 h-5 text-[var(--color-accent)]" />
            </div>
            <DialogTitle className="text-xl">
              {t('updater.newVersionAvailable')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-5 py-4">
          <DialogDescription asChild>
            <div>
              <p className="text-lg font-medium text-[var(--color-text-primary)] mb-3">
                {t('updater.versionReleased', { version: updateInfo.version })}
              </p>

              {updateInfo.notes.length > 0 && (
                <div className="mb-4 max-h-[300px] overflow-y-auto pr-1">
                  <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('updater.releaseNotes')}</p>
                  <div className="pl-1">
                    <SimpleMarkdown content={updateInfo.notes.join('\n')} />
                  </div>
                </div>
              )}

              <div className="flex gap-4 text-xs text-[var(--color-text-muted)]">
                <span>{t('updater.currentVersion', { version: updateInfo.currentVersion })}</span>
                <span>-</span>
                <span>{t('updater.releaseDate', { date: updateInfo.date })}</span>
              </div>
            </div>
          </DialogDescription>
        </div>

        <DialogFooter className="p-5 pt-0 flex-col gap-2 sm:flex-col">
          <div className="flex gap-3 w-full">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onLater}
            >
              {t('updater.remindLater')}
            </Button>
            <Button
              className="flex-1 group"
              onClick={onUpdate}
            >
              {t('updater.updateNow')}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </div>
          <Button
            variant="outline"
            className="w-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            onClick={onMirrorDownload}
          >
            <Globe className="w-4 h-4" />
            {t('updater.chinaMirrorDownload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// --- Download Progress Dialog ---

interface DownloadProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: DownloadProgress;
  onCancel: () => void;
}

export const DownloadProgressDialog: FC<DownloadProgressDialogProps> = ({
  open,
  onOpenChange,
  progress,
  onCancel,
}) => {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[450px] p-0" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader className="p-5 pb-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center">
              <Download className="w-5 h-5 text-[var(--color-accent)] animate-pulse" />
            </div>
            <DialogTitle className="text-xl">
              {t('updater.downloading')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-5 py-4">
          <DialogDescription asChild>
            <div>
              <p className="text-[var(--color-text-secondary)] mb-4">
                {t('updater.downloadingVersion', { version: progress.version })}
              </p>

              {/* Progress Bar */}
              <div className="mb-4">
                <div className="relative h-3 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent)] transition-all duration-300 ease-in-out rounded-full"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
                <div className="flex justify-end mt-2">
                  <span className="text-lg font-semibold text-[var(--color-accent)]">
                    {progress.percentage}%
                  </span>
                </div>
              </div>

              {/* Stats */}
              {progress.totalBytes > 0 && (
                <div className="text-sm text-[var(--color-text-secondary)]">
                  <span>{formatBytes(progress.downloadedBytes)}</span>
                  <span> / </span>
                  <span>{formatBytes(progress.totalBytes)}</span>
                </div>
              )}
            </div>
          </DialogDescription>
        </div>

        <DialogFooter className="p-5 pt-0">
          <Button
            variant="secondary"
            className="w-full"
            onClick={onCancel}
          >
            {t('updater.cancelDownload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// --- Update Success Dialog ---

interface UpdateSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: string;
  onRestart: () => void;
  onLater: () => void;
}

export const UpdateSuccessDialog: FC<UpdateSuccessDialogProps> = ({
  open,
  onOpenChange,
  version,
  onRestart,
  onLater,
}) => {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[450px] p-0">
        <DialogHeader className="p-5 pb-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-[var(--color-success)]" />
            </div>
            <DialogTitle className="text-xl">
              {t('updater.updateSuccess')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-5 py-4">
          <DialogDescription asChild>
            <div className="text-center">
              <p className="text-lg text-[var(--color-text-primary)] mb-2">
                {t('updater.updatedToVersion', { version })}
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t('updater.restartToApply')}
              </p>
            </div>
          </DialogDescription>
        </div>

        <DialogFooter className="p-5 pt-0 flex-row gap-3 sm:flex-row">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onLater}
          >
            {t('updater.restartLater')}
          </Button>
          <Button
            className="flex-1 bg-[var(--color-success)] hover:bg-[var(--color-success)]/80 group"
            onClick={onRestart}
          >
            {t('updater.restartNow')}
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// --- Update Error Dialog ---

interface UpdateErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: string;
  onRetry: () => void;
  onClose: () => void;
}

export const UpdateErrorDialog: FC<UpdateErrorDialogProps> = ({
  open,
  onOpenChange,
  error,
  onRetry,
  onClose,
}) => {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] p-0">
        <DialogHeader className="p-5 pb-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
            </div>
            <DialogTitle className="text-xl">
              {t('updater.updateFailed')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-5 py-4">
          <DialogDescription asChild>
            <div>
              <p className="text-[var(--color-text-secondary)] mb-3">{t('updater.errorOccurred')}</p>

              <div className="p-3 bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded-lg mb-4">
                <p className="text-sm text-orange-300 font-mono break-words">
                  {error}
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">{t('updater.youCan')}</p>
                <ul className="space-y-1 text-sm text-[var(--color-text-secondary)]">
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--color-accent)] mt-0.5">-</span>
                    <span>{t('updater.checkNetwork')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--color-accent)] mt-0.5">-</span>
                    <span>{t('updater.autoCheckLater')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--color-accent)] mt-0.5">-</span>
                    <span>{t('updater.manualDownload')}</span>
                  </li>
                </ul>
              </div>
            </div>
          </DialogDescription>
        </div>

        <DialogFooter className="p-5 pt-0 flex-row gap-3 sm:flex-row">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
          >
            {t('common.close')}
          </Button>
          <Button
            className="flex-1"
            onClick={onRetry}
          >
            <RotateCw className="w-4 h-4" />
            {t('updater.retryUpdate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// --- Up To Date Toast ---

interface UpToDateToastProps {
  show: boolean;
}

export const UpToDateToast: FC<UpToDateToastProps> = ({ show }) => {
  const { t } = useTranslation();
  if (!show) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-center gap-3 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-4 shadow-lg">
        <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
          <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('updater.upToDate')}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            {t('updater.usingLatest')}
          </p>
        </div>
      </div>
    </div>
  );
};
