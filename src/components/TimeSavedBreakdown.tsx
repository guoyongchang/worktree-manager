import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  repeatedOperationCount,
  savedGitCommands,
  savedOperationRows,
  type TimeSavedStats,
} from '@/lib/timeSaved';

function savedOpText(
  t: (key: string, options?: Record<string, unknown>) => string,
  row: { id: string; count: number; minutes: number },
): string {
  switch (row.id) {
    case 'sync': return t('sidebar.op.sync', row);
    case 'pull': return t('sidebar.op.pull', row);
    case 'push': return t('sidebar.op.push', row);
    case 'mergeTest': return t('sidebar.op.mergeTest', row);
    case 'mergeBase': return t('sidebar.op.mergeBase', row);
    case 'pr': return t('sidebar.op.pr', row);
    case 'switchBranch': return t('sidebar.op.switchBranch', row);
    case 'switchWorkspace': return t('sidebar.op.switchWorkspace', row);
    case 'refresh': return t('sidebar.op.refresh', row);
    default: return '';
  }
}

/** 分钟数是从哪些操作攒出来的。侧边栏弹窗和设置页共用这一份。 */
export const TimeSavedBreakdown: FC<{ stats: TimeSavedStats }> = ({ stats }) => {
  const { t } = useTranslation();
  const rows = savedOperationRows(stats);
  const git = savedGitCommands(stats);
  return (
    <div className="space-y-1">
      <div className="text-xs text-[var(--color-text-secondary)]">
        {t('sidebar.timeSavedOps', { count: repeatedOperationCount(stats) })}
      </div>
      <div className="pt-2 text-xs text-[var(--color-text-secondary)]">{t('sidebar.timeSavedDetailTitle')}</div>
      {rows.map((row) => (
        <div key={row.id} className="text-xs text-[var(--color-text-primary)]">{savedOpText(t, row)}</div>
      ))}
      <div className="pt-2 text-xs text-[var(--color-text-secondary)]">{t('sidebar.timeSavedGitTitle')}</div>
      <div className="text-xs text-[var(--color-text-primary)]">checkout ×{git.checkout} · fetch ×{git.fetch}</div>
      <div className="text-xs text-[var(--color-text-primary)]">pull ×{git.pull} · merge ×{git.merge}</div>
      <div className="text-xs text-[var(--color-text-primary)]">push ×{git.push}</div>
    </div>
  );
};
