import { useEffect, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';

import { getLastSharePort, isTauri } from '@/lib/backend';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import type { ConnectedClient } from '../../lib/backend';
import {
  CheckCircleIcon,
  CopyIcon,
  LinkIcon,
  QrCodeIcon,
  RefreshIcon,
  SettingsIcon,
  ShareIcon,
} from '../Icons';

// Windows 桌面端因 manifest 强制 requireAdministrator，必然以管理员权限运行。
// 此时开启分享 = 把管理员级终端暴露给远程访问者，需在分享 UI 醒目警告。
const RUNS_AS_ADMIN = isTauri() && /Windows/i.test(navigator.userAgent);

// 分享口令最小长度，与后端校验保持一致。
const MIN_SHARE_PASSWORD_LENGTH = 8;

const AdminShareWarning: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-[var(--color-error)]/10 border border-[var(--color-error)]/30">
      <span className="text-[var(--color-error)] text-xs leading-none mt-px shrink-0">⚠️</span>
      <span className="text-[11px] leading-snug text-[var(--color-error)]">{t('share.adminWarning')}</span>
    </div>
  );
};

interface ShareBarProps {
  active: boolean;
  urls: string[];
  ngrokUrl: string | null;
  password: string;
  ngrokLoading: boolean;
  connectedClients?: ConnectedClient[];
  onToggleNgrok?: () => void;
  onStart?: (port: number) => void | Promise<void>;
  onStop?: () => void;
  onUpdatePassword?: (password: string) => void;
  onKickClient?: (sessionId: string) => void;
  hasLastConfig?: boolean;
  onQuickShare?: () => void;
  hasNgrokToken?: boolean;
}

export const ShareBar: FC<ShareBarProps> = ({
  active,
  urls,
  ngrokUrl,
  password,
  ngrokLoading,
  connectedClients = [],
  onToggleNgrok,
  onStart,
  onStop,
  onUpdatePassword,
  onKickClient,
  hasLastConfig = false,
  onQuickShare,
  hasNgrokToken = false,
}) => {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [editingPassword, setEditingPassword] = useState('');
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [passwordConfirmed, setPasswordConfirmed] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [sharePort, setSharePort] = useState<number>(0);
  const [portError, setPortError] = useState<string | null>(null);
  const [kickingSessionId, setKickingSessionId] = useState<string | null>(null);
  const [lanExpanded, setLanExpanded] = useState(false);

  useEffect(() => {
    setEditingPassword(password);
    setPasswordDirty(false);
    setPasswordConfirmed(false);
  }, [password]);

  const handlePasswordChange = (value: string) => {
    setEditingPassword(value);
    setPasswordDirty(value !== password);
    setPasswordConfirmed(false);
  };

  const handleConfirmPassword = () => {
    if (!editingPassword.trim() || !passwordDirty) return;
    if (editingPassword.trim().length < MIN_SHARE_PASSWORD_LENGTH) return;
    onUpdatePassword?.(editingPassword.trim());
    setPasswordDirty(false);
    setPasswordConfirmed(true);
    setTimeout(() => setPasswordConfirmed(false), 2000);
  };

  const generateRandomPort = () => 49152 + Math.floor(Math.random() * (65535 - 49152));

  const handleOpenShareDialog = async () => {
    let port = 0;
    if (urls.length > 0) {
      try {
        const urlObj = new URL(urls[0]);
        port = parseInt(urlObj.port, 10) || 0;
      } catch {
        // ignore malformed url
      }
    }
    if (!port) {
      const lastPort = await getLastSharePort();
      port = lastPort || generateRandomPort();
    }
    setSharePort(port);
    setPortError(null);
    setShowShareDialog(true);
  };

  const handleSmartStart = async () => {
    const lastPort = await getLastSharePort();
    if (lastPort) {
      try {
        await onStart?.(lastPort);
        return;
      } catch {
        // Fall back to dialog when the saved port is unavailable.
      }
    }
    await handleOpenShareDialog();
  };

  const handleStartShare = async () => {
    if (sharePort < 1024 || sharePort > 65535) {
      setPortError(t('share.portError'));
      return;
    }
    setShowShareDialog(false);
    if (active && onStop) {
      await onStop();
    }
    onStart?.(sharePort);
  };

  const handleKickClient = async (sessionId: string) => {
    setKickingSessionId(null);
    onKickClient?.(sessionId);
  };

  if (!active) {
    return (
      <>
        <div className="px-3 py-2 border-t border-[var(--color-border)]">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSmartStart}
              className="flex-1 justify-center gap-2 h-8 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              <ShareIcon className="w-3.5 h-3.5" />
              <span className="text-xs">{t('share.title')}</span>
            </Button>
            {hasLastConfig && onQuickShare && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onQuickShare}
                      className="h-8 px-2 text-[var(--color-text-secondary)] hover:text-emerald-400"
                    >
                      <RefreshIcon className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('share.quickShare')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
        <ShareConfigDialog
          active={active}
          open={showShareDialog}
          port={sharePort}
          portError={portError}
          onOpenChange={setShowShareDialog}
          onPortChange={(value) => {
            setSharePort(value);
            setPortError(null);
          }}
          onRandomPort={() => setSharePort(generateRandomPort())}
          onConfirm={handleStartShare}
        />
      </>
    );
  }

  return (
    <div className="px-3 py-2.5 border-t border-[var(--color-border)] space-y-1.5">
      {RUNS_AS_ADMIN && <AdminShareWarning />}
      <div className="space-y-0.5">
        {hasNgrokToken && (
          <ExternalShareRow
            badge={t('share.wan')}
            label={t('share.ngrokLabel')}
            url={ngrokUrl}
            password={editingPassword}
            loading={ngrokLoading}
            activeColorClass="bg-[var(--color-accent)]"
            inactiveText={t('share.ngrokNotStarted')}
            onToggle={onToggleNgrok}
            onCopyLabel={t('share.copyExternalLink')}
          />
        )}
      </div>

      {urls.length > 0 ? (
        <LanUrls
          urls={urls}
          password={editingPassword}
          expanded={lanExpanded}
          onToggleExpanded={() => setLanExpanded(prev => !prev)}
        />
      ) : (
        <div className="flex items-center gap-2 min-h-[24px]">
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] w-[52px] text-center">
            {t('share.lan')}
          </span>
          <span className="flex-1 text-xs text-[var(--color-text-muted)]">...</span>
        </div>
      )}

      <PasswordRow
        password={editingPassword}
        showPassword={showPassword}
        passwordDirty={passwordDirty}
        passwordConfirmed={passwordConfirmed}
        onPasswordChange={handlePasswordChange}
        onToggleShowPassword={setShowPassword}
        onConfirmPassword={handleConfirmPassword}
      />

      {connectedClients.length > 0 && (
        <ConnectedClients
          clients={connectedClients}
          onKick={(sessionId) => setKickingSessionId(sessionId)}
        />
      )}

      <div className="flex items-center justify-between pt-1">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleOpenShareDialog}
                className="h-6 w-6 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                <SettingsIcon className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('share.changePort')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <button
          type="button"
          onClick={async () => {
            if (onStop) {
              await onStop();
            }
          }}
          className="text-[11px] text-[var(--color-error)] hover:text-[var(--color-error)] transition-colors px-1"
        >
          {t('share.stopSharing')}
        </button>
      </div>

      <Dialog open={kickingSessionId !== null} onOpenChange={(open) => !open && setKickingSessionId(null)}>
        <DialogContent className="max-w-[360px]">
          <DialogHeader>
            <DialogTitle>{t('share.confirmKickTitle')}</DialogTitle>
            <DialogDescription>{t('share.confirmKickDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setKickingSessionId(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => kickingSessionId && handleKickClient(kickingSessionId)}>
              {t('share.kick')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShareConfigDialog
        active={active}
        open={showShareDialog}
        port={sharePort}
        portError={portError}
        onOpenChange={setShowShareDialog}
        onPortChange={(value) => {
          setSharePort(value);
          setPortError(null);
        }}
        onRandomPort={() => setSharePort(generateRandomPort())}
        onConfirm={handleStartShare}
      />
    </div>
  );
};

const ShareConfigDialog: FC<{
  active: boolean;
  open: boolean;
  port: number;
  portError: string | null;
  onOpenChange: (open: boolean) => void;
  onPortChange: (value: number) => void;
  onRandomPort: () => void;
  onConfirm: () => void;
}> = ({ active, open, port, portError, onOpenChange, onPortChange, onRandomPort, onConfirm }) => {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{active ? t('share.changePort') : t('share.shareSettings')}</DialogTitle>
          <DialogDescription>
            {active ? t('share.changePortDesc') : t('share.shareSettingsDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {RUNS_AS_ADMIN && <AdminShareWarning />}
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">{t('share.port')}</label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={port}
                onChange={(e) => onPortChange(parseInt(e.target.value, 10) || 0)}
                min={1024}
                max={65535}
                className="flex-1"
              />
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={onRandomPort}
                    >
                      🎲
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('share.randomPort')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {portError && (
              <p className="text-sm text-[var(--color-error)] mt-1">{portError}</p>
            )}
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('share.portHint')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onConfirm}>
            {active ? t('share.confirmChange') : t('share.startSharing')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ExternalShareRow: FC<{
  badge: string | null;
  label: string;
  url: string | null;
  password: string;
  loading: boolean;
  activeColorClass: string;
  inactiveText: string;
  onToggle?: () => void;
  onCopyLabel: string;
}> = ({
  badge,
  label,
  url,
  password,
  loading,
  activeColorClass,
  inactiveText,
  onToggle,
  onCopyLabel,
}) => {
  if (!url) {
    return (
      <div className="flex items-center gap-2 min-h-[24px]">
        {badge ? (
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] w-[52px] text-center">
            {badge}
          </span>
        ) : (
          <span className="shrink-0 w-[52px]" />
        )}
        <span className="text-[11px] font-medium text-[var(--color-text-muted)] shrink-0">{label}</span>
        <span className="flex-1 text-xs text-[var(--color-text-muted)]">{inactiveText}</span>
        <button
          type="button"
          onClick={onToggle}
          disabled={loading}
          className={`relative inline-flex h-4 w-7 items-center rounded-full shrink-0 transition-colors ${loading ? 'opacity-50 cursor-wait' : 'cursor-pointer'} bg-[var(--color-bg-elevated)]`}
        >
          <span className="inline-block h-3 w-3 rounded-full bg-white transition-transform translate-x-0.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-h-[24px]">
      {badge ? (
        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] w-[52px] text-center">
          {badge}
        </span>
      ) : (
        <span className="shrink-0 w-[52px]" />
      )}
      <span className="text-[11px] font-medium text-[var(--color-text-muted)] shrink-0">{label}</span>
      <span className="flex-1 text-xs text-[var(--color-accent)] truncate min-w-0 select-all" title={url}>
        {url.replace(/^https?:\/\//, '')}
      </span>
      <QrActions url={url} password={password} copyLabel={onCopyLabel} />
      <button
        type="button"
        onClick={onToggle}
        disabled={loading}
        className={`relative inline-flex h-4 w-7 items-center rounded-full shrink-0 transition-colors ${loading ? 'opacity-50 cursor-wait' : 'cursor-pointer'} ${url ? activeColorClass : 'bg-[var(--color-bg-elevated)]'}`}
      >
        <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${url ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
};

const QrActions: FC<{
  url: string;
  password: string;
  copyLabel: string;
}> = ({ url, password, copyLabel }) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5">
              <QrCodeIcon className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="bg-white p-3 rounded-lg shadow-xl">
            <QRCodeSVG value={`${url}#pwd=${encodeURIComponent(password)}`} size={160} />
            <p className="text-center text-xs text-gray-600 mt-2 font-mono">{t('share.password')} {password}</p>
            <p className="text-center text-[10px] text-gray-400 mt-1">{t('share.scanToOpen')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigator.clipboard.writeText(url)}
              className="h-5 w-5"
            >
              <CopyIcon className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{copyLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

const LanUrls: FC<{
  urls: string[];
  password: string;
  expanded: boolean;
  onToggleExpanded: () => void;
}> = ({ urls, password, expanded, onToggleExpanded }) => {
  const { t } = useTranslation();
  const localUrl = `http://localhost:${new URL(urls[0]).port}`;
  const allLanUrls = [...urls, localUrl];
  const visibleUrls = expanded ? allLanUrls : urls.slice(0, 1);
  const hiddenCount = allLanUrls.length - 1;

  return (
    <div className="space-y-0.5">
      {visibleUrls.map((lanUrl, index) => (
        <div key={lanUrl} className="flex items-center gap-2 min-h-[24px]">
          {index === 0 ? (
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] w-[52px] text-center">
              {t('share.lan')}
            </span>
          ) : (
            <span className="shrink-0 w-[52px]" />
          )}
          <span className="flex-1 text-xs text-emerald-400 truncate min-w-0 select-all" title={lanUrl}>
            {lanUrl}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigator.clipboard.writeText(lanUrl)}
                    className="h-5 w-5"
                  >
                    <CopyIcon className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('share.copyLink')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigator.clipboard.writeText(`${lanUrl}#pwd=${encodeURIComponent(password)}`)}
                    className="h-5 w-5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    <LinkIcon className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('share.copyLinkWithPassword')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {index === 0 && hiddenCount > 0 && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onToggleExpanded}
                      className="h-5 w-5 text-[var(--color-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20"
                    >
                      <span className="text-[10px] font-semibold">{expanded ? '−' : `+${hiddenCount}`}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{expanded ? '收起' : t('share.showMoreIps', { count: hiddenCount })}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const PasswordRow: FC<{
  password: string;
  showPassword: boolean;
  passwordDirty: boolean;
  passwordConfirmed: boolean;
  onPasswordChange: (value: string) => void;
  onToggleShowPassword: (show: boolean) => void;
  onConfirmPassword: () => void;
}> = ({
  password,
  showPassword,
  passwordDirty,
  passwordConfirmed,
  onPasswordChange,
  onToggleShowPassword,
  onConfirmPassword,
}) => {
  const { t } = useTranslation();
  const tooShort = password.trim().length > 0 && password.trim().length < MIN_SHARE_PASSWORD_LENGTH;

  return (
    <div>
    <div className="flex items-center gap-2 min-h-[24px]">
      <span className="text-[11px] font-medium text-[var(--color-text-muted)] shrink-0 w-[52px]">{t('share.password')}</span>
      <div className="flex-1 min-w-0 relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirmPassword(); }}
          onClick={() => onToggleShowPassword(true)}
          onBlur={() => onToggleShowPassword(false)}
          className="w-full bg-transparent text-xs text-[var(--color-text-secondary)] outline-none font-mono tracking-wider py-0.5 px-1 rounded hover:bg-[var(--color-bg-elevated)] focus:bg-[var(--color-bg-elevated)] transition-colors"
          spellCheck={false}
        />
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {passwordDirty ? (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onConfirmPassword}
                  disabled={tooShort}
                  className="h-5 w-5 text-emerald-400 hover:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CheckCircleIcon className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{tooShort ? t('share.passwordTooShort') : t('share.confirmPasswordUpdate')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : passwordConfirmed ? (
          <span className="h-5 w-5 flex items-center justify-center text-emerald-400">
            <CheckCircleIcon className="w-3 h-3" />
          </span>
        ) : (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigator.clipboard.writeText(password)}
                  className="h-5 w-5"
                >
                  <CopyIcon className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('share.copyPassword')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
    {passwordDirty && tooShort && (
      <p className="text-[10px] text-[var(--color-error)] mt-0.5 pl-[60px]">{t('share.passwordTooShort')}</p>
    )}
    </div>
  );
};

const ConnectedClients: FC<{
  clients: ConnectedClient[];
  onKick: (sessionId: string) => void;
}> = ({ clients, onKick }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
        {t('share.clients', { count: clients.length })}
      </span>
      <div className="max-h-[60px] overflow-y-auto space-y-0">
        {clients.map((client) => (
          <div
            key={client.session_id}
            className="flex items-center gap-1.5 py-px px-1 rounded hover:bg-[var(--color-bg-elevated)] group"
            title={`${client.ip}\n${client.user_agent}\n${client.authenticated_at}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${client.ws_connected ? 'bg-emerald-400' : 'bg-[var(--color-text-muted)]'}`} />
            <span className="text-[11px] text-[var(--color-text-secondary)] truncate flex-1 font-mono">{client.ip}</span>
            {client.ws_connected && (
              <span className="text-[9px] text-[var(--color-accent)]/70 shrink-0">WS</span>
            )}
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onKick(client.session_id)}
                    className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 hover:bg-[var(--color-error)]/20 hover:text-[var(--color-error)]"
                  >
                    <span className="text-[10px]">x</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('share.kickClient')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ))}
      </div>
    </div>
  );
};
