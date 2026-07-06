import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsToggle, WorkspaceVaultSection } from './SettingsView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../lib/backend', async () => {
  const actual = await vi.importActual<typeof import('../lib/backend')>('../lib/backend');
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    cloudGetStatus: vi.fn().mockResolvedValue({ connected: false }),
    getVaultStatus: vi.fn().mockResolvedValue({
      connected: false,
      vault_path: null,
      synced_items: [],
    }),
    vaultLink: vi.fn(),
    listVaultItemChildren: vi.fn(),
  };
});

import { cloudGetStatus } from '../lib/backend';
import { SettingsView } from './SettingsView';

const baseWorkspaceConfig = {
  name: 'Test Workspace',
  worktrees_dir: 'worktrees',
  projects: [],
  linked_workspace_items: [],
};

const defaultSettingsProps = {
  workspaceConfig: baseWorkspaceConfig,
  configPath: '/tmp/.worktree-manager.json',
  error: null,
  onBack: vi.fn(),
  onSaveConfig: vi.fn().mockResolvedValue(undefined),
  onClearError: vi.fn(),
};

describe('SettingsView browser mode', () => {
  it('does not load cloud status from a browser sharing session', () => {
    render(<SettingsView {...defaultSettingsProps} />);

    expect(cloudGetStatus).not.toHaveBeenCalled();
  });
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

describe('SettingsToggle', () => {
  it('uses the compact dimensions shared by settings switches', () => {
    const onChange = vi.fn();

    render(<SettingsToggle checked={true} onChange={onChange} ariaLabel="AI 精炼" />);

    const toggle = screen.getByRole('switch', { name: 'AI 精炼' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveClass('h-5', 'w-8', 'shrink-0');
    expect(toggle.firstElementChild).toHaveClass('h-3', 'w-3', 'translate-x-3.5');
  });
});
