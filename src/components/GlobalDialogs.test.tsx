import { render, screen } from '@testing-library/react';
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

const share = {
  showNgrokTokenDialog: true,
  setShowNgrokTokenDialog: vi.fn(),
  ngrokTokenInput: '',
  setNgrokTokenInput: vi.fn(),
  savingNgrokToken: false,
  handleSaveNgrokToken: vi.fn(),
  showShareDisclaimer: false,
  setShowShareDisclaimer: vi.fn(),
  acceptShareDisclaimer: vi.fn(),
  showWmsConfigDialog: true,
  setShowWmsConfigDialog: vi.fn(),
  wmsConfigInput: { token: 'x', subdomain: 'demo' },
  setWmsConfigInput: vi.fn(),
  savingWmsConfig: false,
  handleSaveWmsConfig: vi.fn(),
  showWmsLoginDialog: true,
  handleCancelWmsBrowserLogin: vi.fn(),
  wmsUsername: 'alice',
  setWmsUsername: vi.fn(),
  wmsPassword: 'secret',
  setWmsPassword: vi.fn(),
  wmsFormLoginLoading: false,
  wmsLoginLoading: false,
  handleWmsFormLogin: vi.fn(),
  handleWmsBrowserLogin: vi.fn(),
} as unknown as UseShareFeatureReturn;

describe('GlobalDialogs', () => {
  it('keeps the ngrok dialog and omits removed share dialogs', () => {
    render(
      <GlobalDialogs
        updater={updater}
        share={share}
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
    expect(screen.queryByText('app.wmsConfigTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('app.wmsLoginTitle')).not.toBeInTheDocument();
  });
});
