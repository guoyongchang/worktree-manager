import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { openDirectoryDialog } from '../lib/backend';
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
import { FolderIcon } from './Icons';

interface AddWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  path: string;
  onPathChange: (path: string) => void;
  onSubmit: () => void;
  loading?: boolean;
}

export const AddWorkspaceModal: FC<AddWorkspaceModalProps> = ({
  open: isOpen,
  onOpenChange,
  name,
  onNameChange,
  path,
  onPathChange,
  onSubmit,
  loading = false,
}) => {
  const { t } = useTranslation();
  const handleSelectFolder = useCallback(async () => {
    const selected = await openDirectoryDialog(t('addWorkspace.selectDir'));
    if (selected) {
      onPathChange(selected);
      // Auto-fill name from folder name if empty
      if (!name) {
        const folderName = selected.split('/').pop() || selected.split('\\').pop();
        if (folderName) {
          onNameChange(folderName);
        }
      }
    }
  }, [name, onNameChange, onPathChange]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-0">
        <DialogHeader className="p-5 border-b border-slate-700">
          <DialogTitle>{t('addWorkspace.importTitle')}</DialogTitle>
          <DialogDescription>
            {t('addWorkspace.importDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('addWorkspace.dirPath')}</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={path}
                onChange={(e) => onPathChange(e.target.value)}
                placeholder="/Users/xxx/Work/my-workspace"
                className="flex-1"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && path.trim() && !loading) onSubmit(); }}
              />
              <Button variant="secondary" onClick={handleSelectFolder}>
                <FolderIcon className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-1">{t('addWorkspace.dirPathHint')}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('common.name')}</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="My Workspace"
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && path.trim() && !loading) onSubmit(); }}
            />
          </div>
        </div>
        <DialogFooter className="p-5 border-t border-slate-700">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={onSubmit}
            disabled={!name.trim() || !path.trim() || loading}
          >
            {loading ? t('common.importing') : t('common.import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface CreateWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  path: string;
  onPathChange: (path: string) => void;
  onSubmit: () => void;
  loading?: boolean;
}

export const CreateWorkspaceModal: FC<CreateWorkspaceModalProps> = ({
  open: isOpen,
  onOpenChange,
  name,
  onNameChange,
  path,
  onPathChange,
  onSubmit,
  loading = false,
}) => {
  const { t } = useTranslation();
  const handleSelectFolder = useCallback(async () => {
    const selected = await openDirectoryDialog(t('addWorkspace.selectParentDir'));
    if (selected) {
      onPathChange(selected);
    }
  }, [onPathChange]);

  const fullPath = path && name ? `${path}/${name}` : '';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-0">
        <DialogHeader className="p-5 border-b border-slate-700">
          <DialogTitle>{t('addWorkspace.createTitle')}</DialogTitle>
          <DialogDescription>
            {t('addWorkspace.createDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('addWorkspace.workspaceName')}</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="my-workspace"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && path.trim() && !loading) onSubmit(); }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('addWorkspace.parentDir')}</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={path}
                onChange={(e) => onPathChange(e.target.value)}
                placeholder="/Users/xxx/Work"
                className="flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && path.trim() && !loading) onSubmit(); }}
              />
              <Button variant="secondary" onClick={handleSelectFolder}>
                <FolderIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {fullPath && (
            <div className="p-3 rounded bg-slate-800/50 border border-slate-700/50">
              <p className="text-xs text-slate-400 mb-1">{t('addWorkspace.willCreate')}</p>
              <p className="text-sm font-mono text-slate-300 select-text">{fullPath}</p>
            </div>
          )}
        </div>
        <DialogFooter className="p-5 border-t border-slate-700">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={onSubmit}
            disabled={!name.trim() || !path.trim() || loading}
          >
            {loading ? t('common.creating') : t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
