import { type FC, useCallback, useState } from 'react';
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
import { basename } from '@/lib/utils';

interface AddWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  path: string;
  onPathChange: (path: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  // Create workspace props
  createName: string;
  onCreateNameChange: (name: string) => void;
  createPath: string;
  onCreatePathChange: (path: string) => void;
  onCreateSubmit: () => void;
  createLoading?: boolean;
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
  createName,
  onCreateNameChange,
  createPath,
  onCreatePathChange,
  onCreateSubmit,
  createLoading = false,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'import' | 'create'>('import');

  const handleSelectFolder = useCallback(async () => {
    const selected = await openDirectoryDialog(t('addWorkspace.selectDir'));
    if (selected) {
      onPathChange(selected);
      // Auto-fill name from folder name if empty
      if (!name) {
        const folderName = basename(selected);
        if (folderName) {
          onNameChange(folderName);
        }
      }
    }
  }, [name, onNameChange, onPathChange, t]);

  const handleSelectParentFolder = useCallback(async () => {
    const selected = await openDirectoryDialog(t('addWorkspace.selectParentDir'));
    if (selected) {
      onCreatePathChange(selected);
    }
  }, [onCreatePathChange, t]);

  const fullPath = createPath && createName ? `${createPath}/${createName}` : '';

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setMode('import');
    onOpenChange(open);
  }, [onOpenChange]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[480px] p-0">
        <DialogHeader className="p-5 border-b border-[var(--color-border)]">
          <DialogTitle>
            {mode === 'import' ? t('addWorkspace.importTitle') : t('addWorkspace.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'import' ? t('addWorkspace.importDesc') : t('addWorkspace.createDesc')}
          </DialogDescription>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex border-b border-[var(--color-border)]">
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'import' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
            onClick={() => setMode('import')}
          >
            {t('addWorkspace.importTab')}
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'create' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
            onClick={() => setMode('create')}
          >
            {t('addWorkspace.createTab')}
          </button>
        </div>

        {mode === 'import' ? (
          <>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('addWorkspace.dirPath')}</label>
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
                <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('addWorkspace.dirPathHint')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('common.name')}</label>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder="My Workspace"
                  onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && path.trim() && !loading) onSubmit(); }}
                />
              </div>
            </div>
            <DialogFooter className="p-5 border-t border-[var(--color-border)]">
              <Button variant="secondary" onClick={() => handleOpenChange(false)}>{t('common.cancel')}</Button>
              <Button
                onClick={onSubmit}
                disabled={!name.trim() || !path.trim() || loading}
              >
                {loading ? t('common.importing') : t('common.import')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('addWorkspace.workspaceName')}</label>
                <Input
                  type="text"
                  value={createName}
                  onChange={(e) => onCreateNameChange(e.target.value)}
                  placeholder="my-workspace"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && createName.trim() && createPath.trim() && !createLoading) onCreateSubmit(); }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('addWorkspace.parentDir')}</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={createPath}
                    onChange={(e) => onCreatePathChange(e.target.value)}
                    placeholder="/Users/xxx/Work"
                    className="flex-1"
                    onKeyDown={(e) => { if (e.key === 'Enter' && createName.trim() && createPath.trim() && !createLoading) onCreateSubmit(); }}
                  />
                  <Button variant="secondary" onClick={handleSelectParentFolder}>
                    <FolderIcon className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {fullPath && (
                <div className="p-3 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50">
                  <p className="text-xs text-[var(--color-text-secondary)] mb-1">{t('addWorkspace.willCreate')}</p>
                  <p className="text-sm font-mono text-[var(--color-text-secondary)] select-text">{fullPath}</p>
                </div>
              )}
            </div>
            <DialogFooter className="p-5 border-t border-[var(--color-border)]">
              <Button variant="secondary" onClick={() => handleOpenChange(false)}>{t('common.cancel')}</Button>
              <Button
                onClick={onCreateSubmit}
                disabled={!createName.trim() || !createPath.trim() || createLoading}
              >
                {createLoading ? t('common.creating') : t('common.create')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
