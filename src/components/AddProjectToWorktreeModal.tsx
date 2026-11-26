import { useState, useMemo, useEffect, type FC } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusIcon } from './Icons';
import type {
  WorkspaceConfig,
  WorktreeListItem,
  TagDefinition,
  AddProjectSelection,
  AddProjectsResult,
  AddingProjectProgress,
} from '../types';

export type { AddProjectSelection, AddProjectsResult, AddingProjectProgress };

interface AddProjectToWorktreeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: WorkspaceConfig | null;
  worktree: WorktreeListItem | null;
  onSubmit: (projects: AddProjectSelection[]) => Promise<AddProjectsResult | void>;
  adding: boolean;
  addingProgress?: AddingProjectProgress | null;
}

export const AddProjectToWorktreeModal: FC<AddProjectToWorktreeModalProps> = ({
  open,
  onOpenChange,
  config,
  worktree,
  onSubmit,
  adding,
  addingProgress,
}) => {
  const { t } = useTranslation();
  const [selectedProjects, setSelectedProjects] = useState<Map<string, string>>(new Map());
  const [viewMode, setViewMode] = useState<'all' | 'byTag'>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Filter out projects already in the worktree
  const availableProjects = useMemo(() => {
    if (!config || !worktree) return [];
    const existingProjectNames = new Set(worktree.projects.map(p => p.name));
    return config.projects.filter(p => !existingProjectNames.has(p.name));
  }, [config, worktree]);

  // Reset selection when switching target worktree
  const worktreeName = worktree?.name ?? null;
  useEffect(() => {
    setSelectedProjects(new Map());
    setSubmitError(null);
  }, [worktreeName]);

  // Prune selections for projects that are no longer available
  useEffect(() => {
    const availableSet = new Set(availableProjects.map(p => p.name));
    setSelectedProjects(prev => {
      let changed = false;
      const next = new Map<string, string>();
      for (const [name, branch] of prev.entries()) {
        if (availableSet.has(name)) {
          next.set(name, branch);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [availableProjects]);

  // Tag grouping logic
  const tagGroups = useMemo(() => {
    if (!config) return null;
    const tags = config.tags ?? [];
    if (tags.length === 0) return null;

    const groups: Array<{ tag: TagDefinition | null; projects: typeof availableProjects }> = [];

    for (const tag of tags) {
      const tagProjects = availableProjects.filter(p => {
        const pc = config.projects.find(pc => pc.name === p.name);
        return (pc?.tags ?? []).includes(tag.id);
      });
      if (tagProjects.length > 0) {
        groups.push({ tag, projects: tagProjects });
      }
    }

    // Untagged
    const taggedNames = new Set(
      tags.flatMap(tag =>
        config.projects.filter(pc => (pc.tags ?? []).includes(tag.id)).map(pc => pc.name)
      )
    );
    const untagged = availableProjects.filter(p => !taggedNames.has(p.name));
    if (untagged.length > 0) {
      groups.push({ tag: null, projects: untagged });
    }

    return groups;
  }, [config, availableProjects]);

  if (!config || !worktree) return null;

  const toggleProject = (name: string, defaultBaseBranch: string) => {
    if (adding) return;
    setSubmitError(null);
    setSelectedProjects(prev => {
      const next = new Map(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.set(name, defaultBaseBranch);
      }
      return next;
    });
  };

  const updateBaseBranch = (name: string, branch: string) => {
    setSelectedProjects(prev => {
      if (!prev.has(name)) return prev;
      const next = new Map(prev);
      next.set(name, branch);
      return next;
    });
  };

  const allSelected = availableProjects.length > 0 && selectedProjects.size === availableProjects.length;

  const handleToggleAll = () => {
    if (adding) return;
    setSubmitError(null);
    if (allSelected) {
      setSelectedProjects(new Map());
    } else {
      const next = new Map<string, string>();
      for (const proj of availableProjects) {
        next.set(proj.name, selectedProjects.get(proj.name) ?? proj.base_branch);
      }
      setSelectedProjects(next);
    }
  };

  const handleSubmit = async () => {
    if (selectedProjects.size === 0 || adding) return;
    setSubmitError(null);
    const items: AddProjectSelection[] = Array.from(selectedProjects.entries()).map(
      ([projectName, baseBranch]) => ({ projectName, baseBranch })
    );
    const result = await onSubmit(items);
    if (result && result.failed.length > 0) {
      const succeededSet = new Set(result.succeeded);
      setSelectedProjects(prev => {
        const next = new Map(prev);
        for (const name of succeededSet) {
          next.delete(name);
        }
        return next;
      });
      const details = result.failed.map(f => `${f.projectName}: ${f.error}`).join('\n');
      setSubmitError(t('addProjectToWorktree.partialError', { details }));
      return;
    }
    setSelectedProjects(new Map());
    setSubmitError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && adding) return;
    if (!nextOpen) {
      setSelectedProjects(new Map());
      setViewMode('all');
      setCollapsedGroups(new Set());
      setSubmitError(null);
    }
    onOpenChange(nextOpen);
  };

  const toggleGroupCollapse = (tagId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const getProjectTags = (projectName: string): TagDefinition[] => {
    const pc = config?.projects.find(p => p.name === projectName);
    return (pc?.tags ?? [])
      .map(tid => (config?.tags ?? []).find(t => t.id === tid))
      .filter((t): t is TagDefinition => !!t);
  };

  const renderBaseBranchSelect = (proj: typeof availableProjects[0]) => (
    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
      <span className="text-xs text-[var(--color-text-secondary)]">Base:</span>
      <Select
        value={selectedProjects.get(proj.name) || proj.base_branch}
        onValueChange={(value) => updateBaseBranch(proj.name, value)}
        disabled={adding}
      >
        <SelectTrigger className="h-7 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={proj.base_branch}>
            {proj.base_branch}
          </SelectItem>
          {proj.base_branch !== "uat" && <SelectItem value="uat">uat</SelectItem>}
          {proj.base_branch !== "master" && <SelectItem value="master">master</SelectItem>}
          {proj.base_branch !== "main" && <SelectItem value="main">main</SelectItem>}
          {proj.base_branch !== "test" && <SelectItem value="test">test</SelectItem>}
          {proj.base_branch !== "staging" && <SelectItem value="staging">staging</SelectItem>}
        </SelectContent>
      </Select>
    </div>
  );

  const renderProjectRow = (proj: typeof availableProjects[0], showTags: boolean) => {
    const isSelected = selectedProjects.has(proj.name);
    const projectTags = showTags ? getProjectTags(proj.name) : [];
    return (
      <div
        key={proj.name}
        className={`p-3 rounded-lg border transition-all ${
          adding ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
        } ${
          isSelected
            ? "bg-[var(--color-accent)]/10 border-[var(--color-accent)]/50"
            : "bg-[var(--color-bg-base)]/50 border-[var(--color-border)] hover:border-[var(--color-text-muted)]/40"
        }`}
        onClick={() => toggleProject(proj.name, proj.base_branch)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Checkbox
              checked={isSelected}
              onChange={() => {}}
              disabled={adding}
              aria-label={proj.name}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--color-text-primary)] truncate">{proj.name}</div>
              {projectTags.length > 0 && (
                <div className="flex gap-1 mt-0.5 flex-wrap">
                  {projectTags.map(tag => (
                    <span
                      key={tag.id}
                      className="px-1.5 py-0.5 rounded-full text-[10px]"
                      style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          {isSelected && renderBaseBranchSelect(proj)}
        </div>
        <div className="text-[var(--color-text-muted)] text-xs mt-1.5 pl-7">
          {t('addProjectToWorktree.defaultBranch')}: {proj.base_branch} · {t('addProjectToWorktree.testBranch')}: {proj.test_branch}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('addProjectToWorktree.title')}</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            <Trans
              i18nKey="addProjectToWorktree.desc"
              values={{ name: worktree.display_name || worktree.name }}
              components={[<strong className="text-[var(--color-text-primary)] font-medium" />]}
            />
          </p>

          {availableProjects.length === 0 ? (
            <div className="text-center py-8 text-[var(--color-text-muted)]">
              <PlusIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>{t('addProjectToWorktree.noProjects')}</p>
              <p className="text-xs mt-1">{t('addProjectToWorktree.allProjectsAdded')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                    {t('addProjectToWorktree.selectProject')}
                  </label>
                  <div className="flex items-center gap-3">
                    {selectedProjects.size > 0 && (
                      <span className="text-xs text-[var(--color-accent)]">
                        {t('addProjectToWorktree.selectedCount', { count: selectedProjects.size })}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleToggleAll}
                      disabled={adding}
                      className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50"
                    >
                      {allSelected
                        ? t('addProjectToWorktree.deselectAll')
                        : t('addProjectToWorktree.selectAll')}
                    </button>
                  </div>
                </div>

                {/* Tab switcher — only shown when tags exist */}
                {tagGroups && (
                  <div className="flex gap-0 border-b border-[var(--color-border)] mb-3">
                    <button
                      type="button"
                      className={`px-4 py-2 text-sm transition-colors ${viewMode === 'all' ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                      onClick={() => setViewMode('all')}
                    >
                      {t('addProject.viewAll')}
                    </button>
                    <button
                      type="button"
                      className={`px-4 py-2 text-sm transition-colors ${viewMode === 'byTag' ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                      onClick={() => setViewMode('byTag')}
                    >
                      {t('addProject.viewByTag')}
                    </button>
                  </div>
                )}

                {viewMode === 'byTag' && tagGroups ? (
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                    {tagGroups.map(({ tag, projects: groupProjects }) => {
                      const tagId = tag?.id ?? '__untagged__';
                      const isCollapsed = collapsedGroups.has(tagId);
                      const selectedCount = groupProjects.filter(p => selectedProjects.has(p.name)).length;
                      const groupAllSelected = selectedCount === groupProjects.length;

                      const handleToggleGroup = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        if (adding) return;
                        setSubmitError(null);
                        setSelectedProjects(prev => {
                          const next = new Map(prev);
                          for (const proj of groupProjects) {
                            if (groupAllSelected) {
                              next.delete(proj.name);
                            } else if (!next.has(proj.name)) {
                              next.set(proj.name, proj.base_branch);
                            }
                          }
                          return next;
                        });
                      };

                      return (
                        <div key={tagId} className="bg-[var(--color-bg-elevated)]/50 rounded-lg overflow-hidden">
                          {/* Group header */}
                          <div
                            className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none hover:bg-[var(--color-bg-elevated)] transition-colors"
                            onClick={() => toggleGroupCollapse(tagId)}
                          >
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {isCollapsed ? '▶' : '▼'}
                            </span>
                            <Checkbox
                              checked={groupAllSelected}
                              onChange={() => {}}
                              onClick={handleToggleGroup}
                              disabled={adding}
                              className={selectedCount > 0 && !groupAllSelected ? 'opacity-60' : ''}
                            />
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: tag?.color ?? 'var(--color-text-muted)' }}
                            />
                            <span className="font-medium text-sm text-[var(--color-text-primary)]">{tag?.name ?? t('tags.untagged')}</span>
                            <span className="text-xs text-[var(--color-text-muted)]">
                              ({selectedCount}/{groupProjects.length})
                            </span>
                          </div>

                          {/* Projects in this group */}
                          {!isCollapsed && (
                            <div className="px-2 pb-2 space-y-1">
                              {groupProjects.map(proj => renderProjectRow(proj, false))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // Flat list view
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                    {availableProjects.map(proj => renderProjectRow(proj, true))}
                  </div>
                )}
              </div>

              {submitError && (
                <div className="p-2.5 rounded-md bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 text-xs text-[var(--color-error)] whitespace-pre-wrap select-text">
                  {submitError}
                </div>
              )}

              {adding && (
                <div className="space-y-1.5">
                  <div className="h-1 bg-[var(--color-bg-elevated)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full animate-progress-indeterminate" />
                  </div>
                  {addingProgress && (
                    <div className="text-xs text-[var(--color-accent)]/80 truncate tabular-nums">
                      {t('addProjectToWorktree.addingProgress', {
                        current: addingProgress.current,
                        total: addingProgress.total,
                        name: addingProgress.currentProject,
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={adding}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selectedProjects.size === 0 || adding || availableProjects.length === 0}
          >
            {adding
              ? t('addProjectToWorktree.adding')
              : selectedProjects.size > 0
                ? t('addProjectToWorktree.addProjectsCount', { count: selectedProjects.size })
                : t('addProjectToWorktree.addProject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
