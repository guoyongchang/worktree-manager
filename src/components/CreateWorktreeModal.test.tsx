import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateWorktreeModal, FOLDER_ALIAS_VALID } from './CreateWorktreeModal';
import type { WorkspaceConfig } from '../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const config: WorkspaceConfig = {
  name: 'clp',
  worktrees_dir: 'worktrees',
  projects: [
    { name: 'erp.finance.java.api', base_branch: 'uat', test_branch: 'test', merge_strategy: 'merge', linked_folders: [] },
  ],
  linked_workspace_items: [],
  archived_worktrees: [],
};

describe('CreateWorktreeModal folder alias uppercase support', () => {
  it('accepts uppercase and mixed-case English folder aliases', () => {
    expect(FOLDER_ALIAS_VALID.test('ERP-31212-Fin-hawk-floor-rescue')).toBe(true);
    expect(FOLDER_ALIAS_VALID.test('ERP-31212-Finance')).toBe(true);
    expect(FOLDER_ALIAS_VALID.test('UPPERCASE123')).toBe(true);
    expect(FOLDER_ALIAS_VALID.test('apple-brave-crane')).toBe(true);
  });

  it('rejects invalid folder aliases with spaces, leading/trailing/double hyphens, or non-ASCII', () => {
    expect(FOLDER_ALIAS_VALID.test('-ERP-123')).toBe(false);
    expect(FOLDER_ALIAS_VALID.test('ERP-123-')).toBe(false);
    expect(FOLDER_ALIAS_VALID.test('ERP--123')).toBe(false);
    expect(FOLDER_ALIAS_VALID.test('ERP 123')).toBe(false);
    expect(FOLDER_ALIAS_VALID.test('ERP/123')).toBe(false);
    expect(FOLDER_ALIAS_VALID.test('ERP-应收管理')).toBe(false);
  });

  it('enables submit in the modal when folderAlias contains uppercase ASCII letters', () => {
    render(
      <CreateWorktreeModal
        open={true}
        onOpenChange={vi.fn()}
        config={config}
        worktreeName="ERP-31212-Finance_应收管理-网上支付查询升级"
        onWorktreeNameChange={vi.fn()}
        folderAlias="ERP-31212-Fin-hawk-floor-rescue"
        onFolderAliasChange={vi.fn()}
        useFolderAlias={true}
        onUseFolderAliasChange={vi.fn()}
        selectedProjects={new Map([['erp.finance.java.api', 'uat']])}
        onToggleProject={vi.fn()}
        onUpdateBaseBranch={vi.fn()}
        onSubmit={vi.fn()}
        creating={false}
        syncBeforeCreate={true}
        onSyncBeforeCreateChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('createWorktree.aliasInvalid')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'createWorktree.createCount' })).not.toBeDisabled();
  });

  it('shows validation error and disables submit when folderAlias has invalid characters', () => {
    render(
      <CreateWorktreeModal
        open={true}
        onOpenChange={vi.fn()}
        config={config}
        worktreeName="ERP-31212-Finance_应收管理"
        onWorktreeNameChange={vi.fn()}
        folderAlias="ERP-应收"
        onFolderAliasChange={vi.fn()}
        useFolderAlias={true}
        onUseFolderAliasChange={vi.fn()}
        selectedProjects={new Map([['erp.finance.java.api', 'uat']])}
        onToggleProject={vi.fn()}
        onUpdateBaseBranch={vi.fn()}
        onSubmit={vi.fn()}
        creating={false}
        syncBeforeCreate={true}
        onSyncBeforeCreateChange={vi.fn()}
      />,
    );

    expect(screen.getByText('createWorktree.aliasInvalid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'createWorktree.createCount' })).toBeDisabled();
  });
});
