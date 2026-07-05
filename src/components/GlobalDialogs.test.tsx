import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GlobalDialogs } from './GlobalDialogs';
import type { UseShareFeatureReturn } from '../hooks/useShareFeature';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const updater = {
  showCheckerDialog: false,
  closeCheckerDialog: vi.fn(),
  officialStatus: 'idle',
  mirrorStatus: 'idle',
  updateInfo: null,
  mirrorVersion: null,
  officialError: null,
  mirrorError: null,
  startDownload: vi.fn(),
  downloadViaMirror: vi.fn(),
  state: 'idle',
  dismiss: vi.fn(),
  downloadProgress: 0,
  errorMessage: null,
  retry: vi.fn(),
  showUpToDateToast: false,
  restartApp: vi.fn(),
} as any;

function makeShare(overrides: Partial<UseShareFeatureReturn> = {}): UseShareFeatureReturn {
  return {
    showNgrokTokenDialog: false,
    setShowNgrokTokenDialog: vi.fn(),
    ngrokTokenInput: '',
    setNgrokTokenInput: vi.fn(),
    savingNgrokToken: false,
    handleSaveNgrokToken: vi.fn(),
    showShareDisclaimer: false,
    setShowShareDisclaimer: vi.fn(),
    acceptShareDisclaimer: vi.fn(),
    showWmsLoginDialog: false,
    setShowWmsLoginDialog: vi.fn(),
    ...overrides,
  } as unknown as UseShareFeatureReturn;
}

describe('GlobalDialogs', () => {
  it('shows the ngrok dialog when requested', () => {
    render(
      <GlobalDialogs
        updater={updater}
        share={makeShare({ showNgrokTokenDialog: true })}
        showShortcutHelp={false}
        onSetShowShortcutHelp={vi.fn()}
        onOpenSettings={vi.fn()}
        deleteConfirmWorktree={null}
        onSetDeleteConfirmWorktree={vi.fn()}
        onDeleteArchivedWorktree={vi.fn()}
        deletingArchived={false}
      />
    );

    expect(screen.getByText('app.ngrokTokenTitle')).toBeInTheDocument();
  });

  it('shows the WMS login-required dialog and navigates to the cloud tab on confirm', () => {
    const onOpenSettings = vi.fn();
    const setShowWmsLoginDialog = vi.fn();
    render(
      <GlobalDialogs
        updater={updater}
        share={makeShare({ showWmsLoginDialog: true, setShowWmsLoginDialog })}
        showShortcutHelp={false}
        onSetShowShortcutHelp={vi.fn()}
        onOpenSettings={onOpenSettings}
        deleteConfirmWorktree={null}
        onSetDeleteConfirmWorktree={vi.fn()}
        onDeleteArchivedWorktree={vi.fn()}
        deletingArchived={false}
      />
    );

    // The login-required dialog should be present.
    expect(screen.getByText('app.wmsLoginTitle')).toBeInTheDocument();

    // Clicking "Go to Login" should close the dialog and open the cloud tab.
    fireEvent.click(screen.getByText('app.wmsLoginButton'));
    expect(setShowWmsLoginDialog).toHaveBeenCalledWith(false);
    expect(onOpenSettings).toHaveBeenCalledWith('cloud');
  });

  it('hides the WMS login dialog when not requested', () => {
    render(
      <GlobalDialogs
        updater={updater}
        share={makeShare({ showWmsLoginDialog: false })}
        showShortcutHelp={false}
        onSetShowShortcutHelp={vi.fn()}
        onOpenSettings={vi.fn()}
        deleteConfirmWorktree={null}
        onSetDeleteConfirmWorktree={vi.fn()}
        onDeleteArchivedWorktree={vi.fn()}
        deletingArchived={false}
      />
    );

    expect(screen.queryByText('app.wmsLoginTitle')).not.toBeInTheDocument();
  });
});
