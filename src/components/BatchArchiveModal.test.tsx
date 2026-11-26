import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BatchArchiveModal } from './BatchArchiveModal';
import type { WorktreeListItem, BackgroundDeleteState } from '../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.done !== undefined && opts?.total !== undefined
        ? `${key}:${opts.done}/${opts.total}`
        : key,
  }),
}));

const archived: WorktreeListItem[] = [
  {
    name: 'erp-31212-fin-hawk',
    display_name: 'ERP-31212-Finance_应收管理',
    path: '/ws/worktrees/erp-31212-fin-hawk',
    is_archived: true,
    projects: [],
  },
  {
    name: 'erp-31494-fin-fork',
    display_name: 'ERP-31494-Finance_React重构',
    path: '/ws/worktrees/erp-31494-fin-fork',
    is_archived: true,
    projects: [],
  },
];

describe('BatchArchiveModal background delete', () => {
  it('triggers onBackgroundDelete with selected items after confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onBackgroundDelete = vi.fn();

    render(
      <BatchArchiveModal
        open={true}
        archivedWorktrees={archived}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onBackgroundDelete={onBackgroundDelete}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    // checkboxes[0] is Select All
    fireEvent.click(checkboxes[0]);

    const bgBtn = screen.getByRole('button', { name: 'batchArchive.deleteInBackground' });
    expect(bgBtn).not.toBeDisabled();
    fireEvent.click(bgBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onBackgroundDelete).toHaveBeenCalledWith(['erp-31212-fin-hawk', 'erp-31494-fin-fork']);
    confirmSpy.mockRestore();
  });

  it('shows live progress, disables busy rows, renders errors, and switches cancel to runInBackground', () => {
    const onClose = vi.fn();
    const backgroundDeleteState: BackgroundDeleteState = {
      active: true,
      items: [
        {
          name: 'erp-31212-fin-hawk',
          displayName: 'ERP-31212-Finance_应收管理',
          workspacePath: '/ws',
          status: 'deleting',
        },
        {
          name: 'erp-31494-fin-fork',
          displayName: 'ERP-31494-Finance_React重构',
          workspacePath: '/ws',
          status: 'failed',
          error: 'file locked by java.exe (PID 1234)',
        },
      ],
    };

    render(
      <BatchArchiveModal
        open={true}
        archivedWorktrees={archived}
        onClose={onClose}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onBackgroundDelete={vi.fn()}
        backgroundDeleteState={backgroundDeleteState}
      />,
    );

    expect(screen.getByText(/batchArchive\.bgDeletingBanner:1\/2/)).toBeInTheDocument();
    expect(screen.getByText('batchArchive.statusDeleting')).toBeInTheDocument();
    expect(screen.getByText('batchArchive.statusFailed')).toBeInTheDocument();
    expect(screen.getByText('file locked by java.exe (PID 1234)')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[1]).toBeDisabled();
    expect(checkboxes[2]).not.toBeDisabled();

    const runInBgBtn = screen.getByRole('button', { name: 'batchArchive.runInBackground' });
    fireEvent.click(runInBgBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
