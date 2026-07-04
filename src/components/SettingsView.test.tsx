import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceVaultSection } from './SettingsView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../lib/backend', async () => {
  const actual = await vi.importActual<typeof import('../lib/backend')>('../lib/backend');
  return {
    ...actual,
    getVaultStatus: vi.fn().mockResolvedValue({
      connected: false,
      vault_path: null,
      synced_items: [],
    }),
    vaultLink: vi.fn(),
    listVaultItemChildren: vi.fn(),
  };
});

describe('WorkspaceVaultSection', () => {
  it('keeps the disconnected status dot and label aligned as one fixed group', async () => {
    render(<WorkspaceVaultSection />);

    const status = await screen.findByTestId('vault-disconnected-status');
    expect(status).toHaveClass('flex', 'items-center', 'gap-2', 'w-28', 'shrink-0');
    expect(status).toHaveTextContent('settings.vaultNotConnected');

    const dot = screen.getByTestId('vault-status-dot');
    expect(status).toContainElement(dot);
    expect(dot).toHaveClass('w-2', 'h-2', 'rounded-full', 'shrink-0');
  });
});
