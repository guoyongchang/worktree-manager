import type { FC } from 'react';
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
import { Input } from '@/components/ui/input';
import {
  UpdateNotificationDialog,
  DownloadProgressDialog,
  UpdateSuccessDialog,
  UpdateErrorDialog,
  UpToDateToast,
} from './UpdaterDialogs';
import { UpdateCheckerDialog } from './UpdateCheckerDialog';
import type { UseUpdaterReturn } from '../hooks/useUpdater';
import type { UseShareFeatureReturn } from '../hooks/useShareFeature';
import type { WorktreeListItem } from '../types';
import { isTauri } from '../lib/backend';

interface GlobalDialogsProps {
  updater: UseUpdaterReturn;
  share: UseShareFeatureReturn;
  showShortcutHelp: boolean;
  onSetShowShortcutHelp: (v: boolean) => void;
  onOpenSettings: () => void;
  deleteConfirmWorktree: WorktreeListItem | null;
  onSetDeleteConfirmWorktree: (v: WorktreeListItem | null) => void;
  onDeleteArchivedWorktree: () => Promise<void>;
  deletingArchived: boolean;
}

export const GlobalDialogs: FC<GlobalDialogsProps> = ({
  updater,
  share,
  showShortcutHelp,
  onSetShowShortcutHelp,
  onOpenSettings,
  deleteConfirmWorktree,
  onSetDeleteConfirmWorktree,
  onDeleteArchivedWorktree,
  deletingArchived,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Update Checker Dialog (dual-channel) */}
      <UpdateCheckerDialog
        open={updater.showCheckerDialog}
        onOpenChange={(open) => !open && updater.closeCheckerDialog()}
        officialStatus={updater.officialStatus}
        mirrorStatus={updater.mirrorStatus}
        updateInfo={updater.updateInfo}
        mirrorVersion={updater.mirrorVersion}
        officialError={updater.officialError}
        mirrorError={updater.mirrorError}
        onOfficialDownload={updater.startDownload}
        onMirrorDownload={updater.downloadViaMirror}
        mirrorTestResults={updater.mirrorTestResults}
        selectedMirror={updater.selectedMirror}
        speedTesting={updater.speedTesting}
        onTestSpeed={updater.testMirrorSpeed}
        onAddCustomMirror={updater.addCustomMirror}
        onRemoveCustomMirror={updater.removeCustomMirror}
        onSelectMirror={updater.selectMirror}
        onSpeedTestSingle={updater.speedTestSingle}
      />

      {/* Updater Dialogs */}
      {updater.updateInfo && (
        <UpdateNotificationDialog
          open={updater.state === 'notification'}
          onOpenChange={(open) => !open && updater.dismiss()}
          updateInfo={updater.updateInfo}
          onUpdate={updater.startDownload}
          onMirrorDownload={updater.downloadViaMirror}
          onLater={updater.dismiss}
        />
      )}

      <DownloadProgressDialog
        open={updater.state === 'downloading'}
        onOpenChange={() => { }}
        progress={updater.downloadProgress}
        onCancel={updater.dismiss}
      />

      {updater.updateInfo && (
        <UpdateSuccessDialog
          open={updater.state === 'success'}
          onOpenChange={(open) => !open && updater.dismiss()}
          version={updater.updateInfo.version}
          onRestart={updater.restartApp}
          onLater={updater.dismiss}
        />
      )}

      <UpdateErrorDialog
        open={updater.state === 'error'}
        onOpenChange={(open) => !open && updater.dismiss()}
        error={updater.errorMessage}
        onRetry={updater.retry}
        onClose={updater.dismiss}
      />

      <UpToDateToast show={updater.showUpToDateToast} />

      {/* Shortcut Help Dialog */}
      <Dialog open={showShortcutHelp} onOpenChange={onSetShowShortcutHelp}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('app.shortcutsTitle')}</DialogTitle>
            <DialogDescription>{t('app.shortcutsDesc')}</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            {[
              { keys: isTauri() ? '⌘ N' : 'Ctrl N', desc: t('app.shortcutNewWorktree') },
              { keys: isTauri() ? '⌘ ,' : 'Ctrl ,', desc: t('app.shortcutOpenSettings') },
              { keys: isTauri() ? '⌘ B' : 'Ctrl B', desc: t('app.shortcutToggleSidebar') },
              { keys: isTauri() ? '⌘ [' : 'Ctrl [', desc: t('app.shortcutBack') },
              { keys: isTauri() ? '⌘ /' : 'Ctrl /', desc: t('app.shortcutHelp') },
              { keys: 'Alt V', desc: t('app.shortcutVoice') },
              { keys: 'Escape', desc: t('app.shortcutEscape') },
            ].map(({ keys, desc }) => (
              <div key={keys} className="flex items-center justify-between py-1.5 px-1">
                <span className="text-sm text-[var(--color-text-secondary)]">{desc}</span>
                <div className="flex gap-1">
                  {keys.split(' ').map((k) => (
                    <kbd key={k} className="px-2 py-0.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded text-xs font-mono text-[var(--color-text-secondary)]">{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Ngrok Token Dialog */}
      <Dialog open={share.showNgrokTokenDialog} onOpenChange={share.setShowNgrokTokenDialog}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('app.ngrokTokenTitle')}</DialogTitle>
            <DialogDescription>
              {t('app.ngrokTokenDescPlain')}{' '}
              <a href="https://dashboard.ngrok.com/get-started/your-authtoken" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] hover:underline">{t('settings.ngrokGetToken')}</a>
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              type="password"
              placeholder="ngrok authtoken"
              value={share.ngrokTokenInput}
              onChange={(e) => share.setNgrokTokenInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') share.handleSaveNgrokToken(); }}
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <button
              type="button"
              className="text-xs text-[var(--color-accent)] hover:text-blue-300 underline transition-colors"
              onClick={() => {
                share.setShowNgrokTokenDialog(false);
                onOpenSettings();
              }}
            >
              {t('settings.goToSettings')}
            </button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => share.setShowNgrokTokenDialog(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={share.handleSaveNgrokToken} disabled={share.savingNgrokToken || !share.ngrokTokenInput.trim()}>
                {share.savingNgrokToken ? t('app.savingToken') : t('app.saveAndStart')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Disclaimer */}
      <Dialog open={share.showShareDisclaimer} onOpenChange={(open) => {
        if (!open) {
          share.setShowShareDisclaimer(false);
        }
      }}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t('share.disclaimerTitle', '分享须知')}</DialogTitle>
            <DialogDescription className="space-y-3 pt-2 text-left">
              <p>{t('share.disclaimerPolicy', '开启分享功能后，您的 Workspace 将可通过网络被其他设备访问。请确保您已了解并遵守所在公司/组织的安全政策和数据共享规定。')}</p>
              <p className="font-medium text-[var(--color-text-secondary)]">🔒 {t('share.disclaimerEncryption', '所有分享连接均通过加密通道传输（HTTPS/WSS），隧道服务不会存储或截取任何数据，您的代码和工作内容始终受到端到端加密保护。')}</p>
              <p className="text-[var(--color-text-muted)] text-xs">{t('share.disclaimerResponsibility', '使用分享功能即代表您已知悉上述信息并自行承担相关合规责任。')}</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="secondary" onClick={() => share.setShowShareDisclaimer(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={share.acceptShareDisclaimer}>
              {t('share.disclaimerAccept', '我已了解，开始分享')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Archived Worktree Confirmation */}
      <Dialog open={!!deleteConfirmWorktree} onOpenChange={(open) => !open && onSetDeleteConfirmWorktree(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('app.deleteArchivedTitle')}</DialogTitle>
            <DialogDescription>
              {t('app.deleteArchivedDesc', { name: deleteConfirmWorktree?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onSetDeleteConfirmWorktree(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={onDeleteArchivedWorktree} disabled={deletingArchived}>
              {deletingArchived ? t('app.deleting') : t('app.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
