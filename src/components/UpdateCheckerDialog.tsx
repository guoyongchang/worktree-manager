import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Rocket,
  CheckCircle,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Globe,
  Github,
} from 'lucide-react';
import type { UpdateInfo, ChannelStatus } from '@/hooks/useUpdater';

// --- Simple Markdown Renderer (reused from UpdaterDialogs) ---

const SimpleMarkdown: FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} className="space-y-1 mb-2">
          {listItems.map((item, i) => (
            <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
              <span className="text-blue-400 mt-0.5 shrink-0">•</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  const renderInline = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let partKey = 0;
    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      const codeMatch = remaining.match(/`(.+?)`/);
      const boldIdx = boldMatch?.index ?? Infinity;
      const codeIdx = codeMatch?.index ?? Infinity;
      if (boldIdx === Infinity && codeIdx === Infinity) { parts.push(remaining); break; }
      if (boldIdx <= codeIdx && boldMatch) {
        parts.push(remaining.slice(0, boldIdx));
        parts.push(<strong key={partKey++} className="text-slate-200 font-medium">{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldIdx + boldMatch[0].length);
      } else if (codeMatch) {
        parts.push(remaining.slice(0, codeIdx));
        parts.push(<code key={partKey++} className="px-1 py-0.5 bg-slate-700 rounded text-[10px] text-blue-300">{codeMatch[1]}</code>);
        remaining = remaining.slice(codeIdx + codeMatch[0].length);
      }
    }
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushList(); continue; }
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      elements.push(
        <h4 key={key++} className="text-xs font-semibold text-slate-200 mb-1 mt-2 first:mt-0">
          {renderInline(headingMatch[2])}
        </h4>
      );
      continue;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) { listItems.push(listMatch[1]); continue; }
    flushList();
    elements.push(
      <p key={key++} className="text-xs text-slate-400 mb-1">
        {renderInline(trimmed)}
      </p>
    );
  }
  flushList();
  return <div className="select-text">{elements}</div>;
};

// --- Channel Card ---

interface ChannelCardProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  status: ChannelStatus;
  version?: string | null;
  error?: string;
  buttonLabel: string;
  onAction: () => void;
  accentColor: string; // e.g. 'blue' or 'emerald'
}

const ChannelCard: FC<ChannelCardProps> = ({
  title,
  subtitle,
  icon,
  status,
  version,
  error,
  buttonLabel,
  onAction,
  accentColor,
}) => {
  const { t } = useTranslation();

  const accentClasses: Record<string, { bg: string; border: string; btn: string; text: string }> = {
    blue: {
      bg: 'bg-blue-500/5',
      border: 'border-blue-500/20',
      btn: 'bg-blue-600 hover:bg-blue-500 text-white',
      text: 'text-blue-400',
    },
    emerald: {
      bg: 'bg-emerald-500/5',
      border: 'border-emerald-500/20',
      btn: 'bg-emerald-600 hover:bg-emerald-500 text-white',
      text: 'text-emerald-400',
    },
  };
  const accent = accentClasses[accentColor] ?? accentClasses.blue;

  return (
    <div className={`flex-1 rounded-lg border ${accent.border} ${accent.bg} p-4 flex flex-col min-w-0`}>
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-1">
        <div className={`w-8 h-8 rounded-md ${accent.bg} border ${accent.border} flex items-center justify-center`}>
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">{title}</h3>
          <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center py-5">
        {status === 'idle' || status === 'checking' ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className={`w-7 h-7 ${accent.text} animate-spin`} />
            <span className="text-xs text-slate-400">{t('updater.checking')}</span>
          </div>
        ) : status === 'available' ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Rocket className={`w-5 h-5 ${accent.text}`} />
            </div>
            <span className="text-sm font-medium text-slate-100">
              v{version}
            </span>
            <span className="text-[11px] text-slate-500">{t('updater.newVersionAvailable')}</span>
          </div>
        ) : status === 'up-to-date' ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-400" />
            </div>
            <span className="text-xs text-slate-400">{t('updater.upToDate')}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
            </div>
            <span className="text-xs text-orange-400 text-center max-w-full break-words line-clamp-2">
              {error || t('updater.checkFailed')}
            </span>
          </div>
        )}
      </div>

      {/* Action button */}
      {status === 'available' && (
        <Button
          className={`w-full ${accent.btn} group`}
          onClick={onAction}
          size="sm"
        >
          {buttonLabel}
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Button>
      )}
    </div>
  );
};

// --- Update Checker Dialog ---

interface UpdateCheckerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  officialStatus: ChannelStatus;
  mirrorStatus: ChannelStatus;
  updateInfo: UpdateInfo | null;
  mirrorVersion: string | null;
  officialError: string;
  mirrorError: string;
  onOfficialDownload: () => void;
  onMirrorDownload: () => void;
}

export const UpdateCheckerDialog: FC<UpdateCheckerDialogProps> = ({
  open,
  onOpenChange,
  officialStatus,
  mirrorStatus,
  updateInfo,
  mirrorVersion,
  officialError,
  mirrorError,
  onOfficialDownload,
  onMirrorDownload,
}) => {
  const { t } = useTranslation();

  const showNotes = updateInfo && updateInfo.notes.length > 0 &&
    (officialStatus === 'available' || mirrorStatus === 'available');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[580px] p-0">
        <DialogHeader className="p-5 pb-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Rocket className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <DialogTitle className="text-lg">{t('updater.checkForUpdates')}</DialogTitle>
              <DialogDescription className="text-xs text-slate-500 mt-0.5">
                {updateInfo?.currentVersion
                  ? t('updater.currentVersion', { version: updateInfo.currentVersion })
                  : ''}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Two-column channels */}
        <div className="px-5 py-4">
          <div className="flex gap-3">
            <ChannelCard
              title={t('updater.officialChannel')}
              subtitle="GitHub Releases"
              icon={<Github className="w-4 h-4 text-blue-400" />}
              status={officialStatus}
              version={updateInfo?.version}
              error={officialError}
              buttonLabel={t('updater.updateNow')}
              onAction={onOfficialDownload}
              accentColor="blue"
            />
            <ChannelCard
              title={t('updater.mirrorChannel')}
              subtitle="gh-proxy.org"
              icon={<Globe className="w-4 h-4 text-emerald-400" />}
              status={mirrorStatus}
              version={mirrorVersion ?? updateInfo?.version}
              error={mirrorError}
              buttonLabel={t('updater.mirrorDownload')}
              onAction={onMirrorDownload}
              accentColor="emerald"
            />
          </div>
        </div>

        {/* Release Notes (shown if any channel found update) */}
        {showNotes && (
          <div className="px-5 pb-4">
            <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3 max-h-[200px] overflow-y-auto">
              <p className="text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider">{t('updater.releaseNotes')}</p>
              <SimpleMarkdown content={updateInfo!.notes.join('\n')} />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 pb-5 flex items-center justify-between">
          <div className="text-[11px] text-slate-600">
            {updateInfo?.date && t('updater.releaseDate', { date: updateInfo.date })}
          </div>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
