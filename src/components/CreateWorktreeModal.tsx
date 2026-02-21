import { useMemo, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WorkspaceConfig } from '../types';

// Git branch name rules: no spaces, ~, ^, :, \, .., *, ?, [, leading/trailing dots, @{
const WORKTREE_NAME_INVALID_CHARS = /[\s~^:*?\[\\]/;
const WORKTREE_NAME_INVALID_PATTERNS = /(?:\.\.)|(?:^\.)|(?:\.$)|(?:@\{)|(?:\.lock$)/;

interface CreateWorktreeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: WorkspaceConfig | null;
  worktreeName: string;
  onWorktreeNameChange: (name: string) => void;
  selectedProjects: Map<string, string>;
  onToggleProject: (name: string, baseBranch: string) => void;
  onUpdateBaseBranch: (name: string, baseBranch: string) => void;
  onSubmit: () => void;
  creating: boolean;
}

export const CreateWorktreeModal: FC<CreateWorktreeModalProps> = ({
  open,
  onOpenChange,
  config,
  worktreeName,
  onWorktreeNameChange,
  selectedProjects,
  onToggleProject,
  onUpdateBaseBranch,
  onSubmit,
  creating,
}) => {
  const { t } = useTranslation();
  const nameValidation = useMemo(() => {
    const trimmed = worktreeName.trim();
    if (!trimmed) {
      return { valid: false, error: '' };
    }
    if (WORKTREE_NAME_INVALID_CHARS.test(trimmed)) {
      return { valid: false, error: t('createWorktree.invalidChars') };
    }
    if (WORKTREE_NAME_INVALID_PATTERNS.test(trimmed)) {
      return { valid: false, error: t('createWorktree.invalidPatterns') };
    }
    return { valid: true, error: '' };
  }, [worktreeName]);

  const canSubmit = nameValidation.valid && selectedProjects.size > 0 && !creating;

  if (!config) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] max-h-[80vh] overflow-hidden p-0">
        <DialogHeader className="p-5 border-b border-slate-700">
          <DialogTitle>{t('createWorktree.title')}</DialogTitle>
        </DialogHeader>
        <div className="p-5 overflow-y-auto max-h-[60vh]">
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('createWorktree.nameLabel')}</label>
            <Input
              type="text"
              value={worktreeName}
              onChange={(e) => onWorktreeNameChange(e.target.value)}
              placeholder="feature-login-page"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) onSubmit(); }}
              className={nameValidation.error ? 'border-red-500 focus:border-red-500' : ''}
            />
            {nameValidation.error && (
              <p className="text-red-400 text-xs mt-1">{nameValidation.error}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('createWorktree.selectProjects')}</label>
            <div className="space-y-2">
              {config.projects.map(proj => (
                <div
                  key={proj.name}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedProjects.has(proj.name)
                      ? "bg-blue-900/20 border-blue-500/50"
                      : "bg-slate-900/50 border-slate-700 hover:border-slate-600"
                  }`}
                  onClick={() => onToggleProject(proj.name, proj.base_branch)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={selectedProjects.has(proj.name)}
                        onChange={() => {}}
                      />
                      <span className="font-medium text-slate-200">{proj.name}</span>
                    </div>
                    {selectedProjects.has(proj.name) && (
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <span className="text-xs text-slate-400">Base:</span>
                        <Select
                          value={selectedProjects.get(proj.name) || proj.base_branch}
                          onValueChange={(value) => onUpdateBaseBranch(proj.name, value)}
                        >
                          <SelectTrigger className="h-7 w-24 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={proj.base_branch}>{proj.base_branch}</SelectItem>
                            {proj.base_branch !== "uat" && <SelectItem value="uat">uat</SelectItem>}
                            {proj.base_branch !== "master" && <SelectItem value="master">master</SelectItem>}
                            {proj.base_branch !== "test" && <SelectItem value="test">test</SelectItem>}
                            {proj.base_branch !== "staging" && <SelectItem value="staging">staging</SelectItem>}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="text-slate-500 text-xs mt-1.5 pl-7">{t('addProjectToWorktree.defaultBranch')}: {proj.base_branch} · {t('addProjectToWorktree.testBranch')}: {proj.test_branch}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="p-5 border-t border-slate-700">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={creating}>{t('common.cancel')}</Button>
          <Button
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {creating ? t('common.creating') : t('createWorktree.createCount', { count: selectedProjects.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
