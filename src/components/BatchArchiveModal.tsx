import { useState, useMemo, useEffect, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ArchiveIcon, RefreshIcon, TrashIcon } from './Icons';
import type { WorktreeListItem, BackgroundDeleteState, BackgroundDeleteItem } from '../types';

interface BatchArchiveModalProps {
  open: boolean;
  archivedWorktrees: WorktreeListItem[];
  onClose: () => void;
  onRestore: (names: string[]) => Promise<void>;
  onDelete: (names: string[]) => Promise<void>;
  onBackgroundDelete?: (names: string[]) => void;
  backgroundDeleteState?: BackgroundDeleteState;
}

export const BatchArchiveModal: FC<BatchArchiveModalProps> = ({
  open,
  archivedWorktrees,
  onClose,
  onRestore,
  onDelete,
  onBackgroundDelete,
  backgroundDeleteState,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const statusByName = useMemo(() => {
    const map = new Map<string, BackgroundDeleteItem>();
    for (const item of backgroundDeleteState?.items ?? []) {
      map.set(item.name, item);
    }
    return map;
  }, [backgroundDeleteState?.items]);

  const busyNames = useMemo(() => {
    const set = new Set<string>();
    for (const [name, item] of statusByName.entries()) {
      if (item.status === 'pending' || item.status === 'deleting') {
        set.add(name);
      }
    }
    return set;
  }, [statusByName]);

  const selectableWorktrees = useMemo(
    () => archivedWorktrees.filter((w) => !busyNames.has(w.name)),
    [archivedWorktrees, busyNames],
  );

  // Drop selections that are no longer in the archived list or are actively deleting
  useEffect(() => {
    const selectableSet = new Set(selectableWorktrees.map((w) => w.name));
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const name of prev) {
        if (selectableSet.has(name)) {
          next.add(name);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectableWorktrees]);

  if (!open) return null;

  const isBackgroundDeleting = !!backgroundDeleteState?.active;
  const bgItems = backgroundDeleteState?.items ?? [];
  const bgDoneCount = bgItems.filter((it) => it.status === 'done' || it.status === 'failed').length;
  const bgTotalCount = bgItems.length;
  const bgCurrentItem = bgItems.find((it) => it.status === 'deleting');

  const toggleAll = () => {
    if (selected.size === selectableWorktrees.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableWorktrees.map((w) => w.name)));
    }
  };

  const toggleOne = (name: string) => {
    if (busyNames.has(name)) return;
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
    const names = Array.from(selected);
    setSelected(new Set());
    setDeleting(true);
    try {
      await onDelete(names);
    } finally {
      setDeleting(false);
    }
  };

  const handleBackgroundDelete = () => {
    if (selected.size === 0 || !onBackgroundDelete) return;
    const ok = window.confirm(
      t('batchArchive.confirmDelete', { count: selected.size }),
    );
    if (!ok) return;
    const names = Array.from(selected);
    setSelected(new Set());
    onBackgroundDelete(names);
  };

  const allSelected =
    selectableWorktrees.length > 0 && selected.size === selectableWorktrees.length;
  const someSelected = selected.size > 0;
  const anyDeleting = deleting || isBackgroundDeleting;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl w-[660px] max-w-[92vw] max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
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

        {isBackgroundDeleting && bgTotalCount > 0 && (
          <div className="px-4 py-2.5 bg-[var(--color-accent)]/10 border-b border-[var(--color-accent)]/20 flex items-center gap-2 text-xs text-[var(--color-accent)]">
            <RefreshIcon className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span className="truncate">
              {t('batchArchive.bgDeletingBanner', { done: bgDoneCount, total: bgTotalCount })}
              {bgCurrentItem ? ` · ${bgCurrentItem.displayName}` : ''}
            </span>
          </div>
        )}

        <div className="p-4 border-b border-[var(--color-border)]/50 flex items-center gap-2">
          <Checkbox
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={selectableWorktrees.length === 0}
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
              {archivedWorktrees.map((worktree) => {
                const bgItem = statusByName.get(worktree.name);
                const isBusy = bgItem?.status === 'pending' || bgItem?.status === 'deleting';
                const isFailed = bgItem?.status === 'failed';
                return (
                  <label
                    key={worktree.name}
                    className={`flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isBusy
                        ? 'opacity-65 cursor-not-allowed bg-[var(--color-bg-elevated)]/20'
                        : 'hover:bg-[var(--color-bg-elevated)]/30 cursor-pointer'
                    }`}
                  >
                    <Checkbox
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.has(worktree.name)}
                      onChange={() => toggleOne(worktree.name)}
                      disabled={isBusy}
                    />
                    <ArchiveIcon className="w-4 h-4 mt-0.5 text-[var(--color-text-muted)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-[var(--color-text-primary)] truncate flex-1">
                          {worktree.display_name || worktree.name}
                        </div>
                        {bgItem?.status === 'deleting' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-error)]/15 text-[var(--color-error)] shrink-0">
                            <RefreshIcon className="w-2.5 h-2.5 animate-spin" />
                            {t('batchArchive.statusDeleting')}
                          </span>
                        )}
                        {bgItem?.status === 'pending' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] shrink-0">
                            {t('batchArchive.statusPending')}
                          </span>
                        )}
                        {isFailed && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-error)]/15 text-[var(--color-error)] shrink-0">
                            {t('batchArchive.statusFailed')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] truncate">
                        {worktree.name}
                      </div>
                      {isFailed && bgItem?.error && (
                        <div className="text-[11px] text-[var(--color-error)] mt-1 break-words select-text">
                          {bgItem.error}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[var(--color-border)] flex items-center justify-between gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {anyDeleting ? t('batchArchive.runInBackground') : t('common.cancel')}
          </Button>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button
              variant="default"
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-500"
              onClick={handleRestore}
              disabled={!someSelected || restoring || deleting}
            >
              {restoring ? (
                <>
                  <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                  {t('batchArchive.restoring')}
                </>
              ) : (
                <>
                  <RefreshIcon className="w-3.5 h-3.5" />
                  {t('batchArchive.restoreSelected')}
                </>
              )}
            </Button>
            {onBackgroundDelete && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-[var(--color-error)]/40 text-[var(--color-error)] hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]"
                onClick={handleBackgroundDelete}
                disabled={!someSelected || restoring}
              >
                <TrashIcon className="w-3.5 h-3.5" />
                {t('batchArchive.deleteInBackground')}
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={handleDelete}
              disabled={!someSelected || restoring || deleting}
            >
              {deleting ? (
                <>
                  <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                  {t('batchArchive.deleting')}
                </>
              ) : (
                <>
                  <TrashIcon className="w-3.5 h-3.5" />
                  {t('batchArchive.deleteSelected')}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
