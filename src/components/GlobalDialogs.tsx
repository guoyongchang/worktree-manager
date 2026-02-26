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
      {/* Updater Dialogs */}
      {updater.updateInfo && (
        <UpdateNotificationDialog
          open={updater.state === 'notification'}
          onOpenChange={(open) => !open && updater.dismiss()}
          updateInfo={updater.updateInfo}
          onUpdate={updater.startDownload}
          onLater={updater.dismiss}
        />
      )}

      <DownloadProgressDialog
        open={updater.state === 'downloading'}
        onOpenChange={() => {}}
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
                <span className="text-sm text-slate-300">{desc}</span>
                <div className="flex gap-1">
                  {keys.split(' ').map((k) => (
                    <kbd key={k} className="px-2 py-0.5 bg-slate-700 border border-slate-600 rounded text-xs font-mono text-slate-300">{k}</kbd>
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
              <a href="https://dashboard.ngrok.com/get-started/your-authtoken" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{t('settings.ngrokGetToken')}</a>
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
              className="text-xs text-blue-400 hover:text-blue-300 underline transition-colors"
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

      {/* WMS Config Dialog */}
      <Dialog open={share.showWmsConfigDialog} onOpenChange={share.setShowWmsConfigDialog}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('app.wmsConfigTitle', '配置 WMS 隧道')}</DialogTitle>
            <DialogDescription>
              {t('app.wmsConfigDesc', '请配置 WMS 隧道服务器信息。Token 从管理后台注册账号后获取。')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Token</label>
              <Input
                type="password"
                placeholder={t('app.wmsTokenPlaceholder', '从 WMS 管理后台获取')}
                value={share.wmsConfigInput.token}
                onChange={(e) => share.setWmsConfigInput({ ...share.wmsConfigInput, token: e.target.value })}
                className="text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Subdomain</label>
              <Input
                type="text"
                placeholder="my-workspace"
                value={share.wmsConfigInput.subdomain}
                onChange={(e) => share.setWmsConfigInput({ ...share.wmsConfigInput, subdomain: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') share.handleSaveWmsConfig(); }}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <button
              type="button"
              className="text-xs text-blue-400 hover:text-blue-300 underline transition-colors"
              onClick={() => {
                share.setShowWmsConfigDialog(false);
                onOpenSettings();
              }}
            >
              {t('settings.goToSettings')}
            </button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => share.setShowWmsConfigDialog(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={share.handleSaveWmsConfig} disabled={share.savingWmsConfig || !share.wmsConfigInput.token.trim() || !share.wmsConfigInput.subdomain.trim()}>
                {share.savingWmsConfig ? t('app.savingToken', '保存中...') : t('app.saveAndStart', '保存并启动')}
              </Button>
            </div>
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
