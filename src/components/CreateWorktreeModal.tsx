import { useMemo, useState, useEffect, useRef, type FC } from 'react';
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
import { containsNonAscii, generateFolderAlias } from '../lib/bip39-words';

// Git branch name rules: no spaces, ~, ^, :, \, .., *, ?, [, leading/trailing dots, @{
const WORKTREE_NAME_INVALID_CHARS = /[\s~^:*?\[\\]/;
const WORKTREE_NAME_INVALID_PATTERNS = /(?:\.\.)|(?:^\.)|(?:\.$)|(?:@\{)|(?:\.lock$)/;
// Folder alias validation: only allow lowercase letters, digits, and hyphens
const FOLDER_ALIAS_VALID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface CreateWorktreeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: WorkspaceConfig | null;
  worktreeName: string;
  onWorktreeNameChange: (name: string) => void;
  folderAlias: string;
  onFolderAliasChange: (alias: string) => void;
  useFolderAlias: boolean;
  onUseFolderAliasChange: (use: boolean) => void;
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
  folderAlias,
  onFolderAliasChange,
  useFolderAlias,
  onUseFolderAliasChange,
  selectedProjects,
  onToggleProject,
  onUpdateBaseBranch,
  onSubmit,
  creating,
}) => {
  const { t } = useTranslation();

  // Elapsed time tracking for creation
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (creating) {
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
      }
    };
  }, [creating]);

  const formatElapsed = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return min > 0 ? `${min}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
  };

  const hasNonAscii = useMemo(() => containsNonAscii(worktreeName.trim()), [worktreeName]);

  // Auto-generate folder alias when non-ASCII is first detected
  const prevHasNonAscii = useRef(false);
  useEffect(() => {
    if (hasNonAscii && !prevHasNonAscii.current) {
      if (!folderAlias) {
        onFolderAliasChange(generateFolderAlias());
      }
      onUseFolderAliasChange(true);
    }
    if (!hasNonAscii) {
      onUseFolderAliasChange(false);
    }
    prevHasNonAscii.current = hasNonAscii;
    // folderAlias intentionally excluded - only checked on hasNonAscii transition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNonAscii, onFolderAliasChange, onUseFolderAliasChange]);

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

  const aliasValidation = useMemo(() => {
    if (!useFolderAlias) return { valid: true, error: '' };
    const trimmed = folderAlias.trim();
    if (!trimmed) return { valid: false, error: t('createWorktree.aliasRequired') };
    if (!FOLDER_ALIAS_VALID.test(trimmed)) return { valid: false, error: t('createWorktree.aliasInvalid') };
    return { valid: true, error: '' };
  }, [useFolderAlias, folderAlias]);

  const canSubmit = nameValidation.valid && aliasValidation.valid && selectedProjects.size > 0 && !creating;

  const handleRegenerate = () => {
    onFolderAliasChange(generateFolderAlias());
  };

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

          {/* Folder alias section — shown when non-ASCII characters detected */}
          {hasNonAscii && nameValidation.valid && (
            <div className="mb-5 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-start gap-2 mb-2">
                <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-xs text-amber-300/90">{t('createWorktree.nonAsciiWarning')}</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <Checkbox
                  checked={useFolderAlias}
                  onChange={() => onUseFolderAliasChange(!useFolderAlias)}
                />
                <span className="text-sm text-slate-300">{t('createWorktree.useFolderAlias')}</span>
              </label>
              {useFolderAlias && (
                <div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={folderAlias}
                      onChange={(e) => onFolderAliasChange(e.target.value)}
                      placeholder="apple-brave-crane"
                      className={`flex-1 text-sm h-8 ${aliasValidation.error ? 'border-red-500 focus:border-red-500' : ''}`}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleRegenerate}
                      className="h-8 px-2 shrink-0"
                      type="button"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </Button>
                  </div>
                  {aliasValidation.error && (
                    <p className="text-red-400 text-xs mt-1">{aliasValidation.error}</p>
                  )}
                  <p className="text-xs text-slate-500 mt-1.5">
                    {t('createWorktree.aliasMappingHint', { alias: folderAlias.trim() || '...', name: worktreeName.trim() })}
                  </p>
                </div>
              )}
            </div>
          )}

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
        {creating && (
          <div className="px-5 pb-1">
            <div className="flex items-center gap-2 text-xs text-blue-400/80">
              <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full rounded-full animate-progress-indeterminate animate-gradient" />
              </div>
              <span className="whitespace-nowrap tabular-nums">{t('common.creating')} {formatElapsed(elapsedSeconds)}</span>
            </div>
          </div>
        )}
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
