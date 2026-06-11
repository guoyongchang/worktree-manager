import { useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ArchiveIcon, RefreshIcon, TrashIcon } from './Icons';
import type { WorktreeListItem } from '../types';

interface BatchArchiveModalProps {
  open: boolean;
  archivedWorktrees: WorktreeListItem[];
  onClose: () => void;
  onRestore: (names: string[]) => Promise<void>;
  onDelete: (names: string[]) => Promise<void>;
}

export const BatchArchiveModal: FC<BatchArchiveModalProps> = ({
  open,
  archivedWorktrees,
  onClose,
  onRestore,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!open) return null;

  const toggleAll = () => {
    if (selected.size === archivedWorktrees.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(archivedWorktrees.map((w) => w.name)));
    }
  };

  const toggleOne = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setSelected(next);
  };

  const handleRestore = async () => {
    if (selected.size === 0) return;
    setRestoring(true);
    try {
      await onRestore(Array.from(selected));
      setSelected(new Set());
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    const ok = window.confirm(
      t('batchArchive.confirmDelete', { count: selected.size }),
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await onDelete(Array.from(selected));
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const allSelected = selected.size === archivedWorktrees.length && archivedWorktrees.length > 0;
  const someSelected = selected.size > 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl w-[480px] max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('batchArchive.title')}</h3>
          <button
            onClick={onClose}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-xl leading-none"
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <div className="p-4 border-b border-[var(--color-border)]/50 flex items-center gap-2">
          <Checkbox
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={archivedWorktrees.length === 0}
          />
          <span className="text-sm text-[var(--color-text-secondary)]">
            {t('batchArchive.selectAll', { count: archivedWorktrees.length })}
          </span>
          {someSelected && (
            <span className="text-xs text-[var(--color-accent)] ml-auto">
              {t('batchArchive.selected', { count: selected.size })}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {archivedWorktrees.length === 0 ? (
            <div className="py-8 text-center text-[var(--color-text-muted)] text-sm">
              {t('batchArchive.empty')}
            </div>
          ) : (
            <div className="space-y-1">
              {archivedWorktrees.map((worktree) => (
                <label
                  key={worktree.name}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--color-bg-elevated)]/30 cursor-pointer transition-colors"
                >
                  <Checkbox
                    type="checkbox"
                    checked={selected.has(worktree.name)}
                    onChange={() => toggleOne(worktree.name)}
                  />
                  <ArchiveIcon className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--color-text-primary)] truncate">
                      {worktree.display_name || worktree.name}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] truncate">
                      {worktree.name}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-[var(--color-border)] flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            className="bg-emerald-600 hover:bg-emerald-500"
            onClick={handleRestore}
            disabled={!someSelected || restoring || deleting}
          >
            {restoring ? (
              <>
                <RefreshIcon className="w-4 h-4 animate-spin mr-1.5" />
                {t('batchArchive.restoring')}
              </>
            ) : (
              <>
                <RefreshIcon className="w-4 h-4 mr-1.5" />
                {t('batchArchive.restoreSelected')}
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!someSelected || restoring || deleting}
          >
            {deleting ? (
              <>
                <RefreshIcon className="w-4 h-4 animate-spin mr-1.5" />
                {t('batchArchive.deleting')}
              </>
            ) : (
              <>
                <TrashIcon className="w-4 h-4 mr-1.5" />
                {t('batchArchive.deleteSelected')}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
