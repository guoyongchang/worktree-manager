import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    listVaultItemChildren: vi.fn().mockResolvedValue([]),
  };
});

import { cloudGetStatus, getVaultStatus, isTauri } from '../lib/backend';
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

afterEach(() => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(getVaultStatus).mockResolvedValue({
    connected: false,
    vault_path: null,
    synced_items: [],
  });
});

describe('SettingsView browser mode', () => {
  it('does not load cloud status from a browser sharing session', () => {
    render(<SettingsView {...defaultSettingsProps} />);

    expect(cloudGetStatus).not.toHaveBeenCalled();
  });

  it('opens on the workspace section and labels models as AI', () => {
    render(<SettingsView {...defaultSettingsProps} />);
    expect(screen.getByText('settings.saveConfig')).toBeInTheDocument();
    expect(screen.getByText('settings.modelsNav')).toBeInTheDocument();
  });

  it('returns to workspaces when reopened after another section', () => {
    const { rerender } = render(
      <SettingsView {...defaultSettingsProps} initialSection="models" settingsNavNonce={1} />,
    );
    expect(screen.queryByText('settings.saveConfig')).not.toBeInTheDocument();

    rerender(
      <SettingsView {...defaultSettingsProps} initialSection="workspaces" settingsNavNonce={2} />,
    );
    expect(screen.getByText('settings.saveConfig')).toBeInTheDocument();
  });

  it('selects the current workspace tab and loads that workspace vault', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getVaultStatus).mockClear();
    render(
      <SettingsView
        {...defaultSettingsProps}
        workspaces={[
          { name: 'Alpha', path: '/ws/alpha' },
          { name: 'Beta', path: '/ws/beta' },
        ]}
        currentWorkspace={{ name: 'Alpha', path: '/ws/alpha' }}
      />,
    );

    expect(screen.getByRole('button', { name: /Alpha/ }).className).toContain('border-[var(--color-accent)]/30');
    await waitFor(() => {
      expect(getVaultStatus).toHaveBeenCalledTimes(1);
      expect(getVaultStatus).toHaveBeenCalledWith('/ws/alpha');
    });

    fireEvent.click(screen.getByRole('button', { name: /Beta/ }));
    await waitFor(() => {
      expect(getVaultStatus).toHaveBeenCalledTimes(2);
      expect(getVaultStatus).toHaveBeenCalledWith('/ws/beta');
    });
  });

  it('selects the first workspace once the list loads', () => {
    const { rerender } = render(
      <SettingsView {...defaultSettingsProps} workspaces={[]} currentWorkspace={null} />,
    );
    rerender(
      <SettingsView
        {...defaultSettingsProps}
        workspaces={[{ name: 'Alpha', path: '/ws/alpha' }]}
        currentWorkspace={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'Alpha' }).className).toContain('border-[var(--color-accent)]/30');
  });

  it('follows the current workspace when it changes', () => {
    const workspaces = [
      { name: 'Alpha', path: '/ws/alpha' },
      { name: 'Beta', path: '/ws/beta' },
    ];
    const { rerender } = render(
      <SettingsView {...defaultSettingsProps} workspaces={workspaces} currentWorkspace={workspaces[0]} />,
    );
    expect(screen.getByRole('button', { name: /Alpha/ }).className).toContain('border-[var(--color-accent)]/30');

    rerender(
      <SettingsView {...defaultSettingsProps} workspaces={workspaces} currentWorkspace={workspaces[1]} />,
    );
    expect(screen.getByRole('button', { name: /Beta/ }).className).toContain('border-[var(--color-accent)]/30');
  });

  it('resets the workspace tab to current when settings reopens', () => {
    const workspaces = [
      { name: 'Alpha', path: '/ws/alpha' },
      { name: 'Beta', path: '/ws/beta' },
    ];
    const { rerender } = render(
      <SettingsView
        {...defaultSettingsProps}
        workspaces={workspaces}
        currentWorkspace={workspaces[0]}
        settingsNavNonce={1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(screen.getByRole('button', { name: 'Beta' }).className).toContain('border-[var(--color-accent)]/30');

    rerender(
      <SettingsView
        {...defaultSettingsProps}
        workspaces={workspaces}
        currentWorkspace={workspaces[0]}
        settingsNavNonce={2}
      />,
    );
    expect(screen.getByRole('button', { name: /Alpha/ }).className).toContain('border-[var(--color-accent)]/30');
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

  it('lets a connected vault path fill the row and reveal in finder', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getVaultStatus).mockResolvedValue({
      connected: true,
      vault_path: '/Users/guo/Documents/very/long/knowledge-base',
      synced_items: [{ name: 'notes', item_type: 'directory' }],
    });

    render(<WorkspaceVaultSection />);

    const path = await screen.findByTestId('vault-mounted-path');
    expect(path).toHaveClass('flex-1', 'min-w-0');
    expect(path.className).not.toContain('max-w-[200px]');
    expect(screen.getByTestId('vault-open-path')).toBeInTheDocument();
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
