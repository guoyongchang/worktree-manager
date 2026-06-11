import { useState, useMemo, type FC } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusIcon } from './Icons';
import type { WorkspaceConfig, WorktreeListItem, TagDefinition } from '../types';

interface AddProjectToWorktreeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: WorkspaceConfig | null;
  worktree: WorktreeListItem | null;
  onSubmit: (projectName: string, baseBranch: string) => Promise<void>;
  adding: boolean;
}

export const AddProjectToWorktreeModal: FC<AddProjectToWorktreeModalProps> = ({
  open,
  onOpenChange,
  config,
  worktree,
  onSubmit,
  adding,
}) => {
  const { t } = useTranslation();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState<string>('');
  const [viewMode, setViewMode] = useState<'all' | 'byTag'>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Filter out projects already in the worktree
  const availableProjects = useMemo(() => {
    if (!config || !worktree) return [];
    const existingProjectNames = new Set(worktree.projects.map(p => p.name));
    return config.projects.filter(p => !existingProjectNames.has(p.name));
  }, [config, worktree]);

  const selectedProjectConfig = availableProjects.find(p => p.name === selectedProject);

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

  const handleProjectSelect = (name: string) => {
    setSelectedProject(name);
    const proj = availableProjects.find(p => p.name === name);
    if (proj) {
      setBaseBranch(proj.base_branch);
    }
  };

  const handleSubmit = async () => {
    if (!selectedProject || !baseBranch) return;
    await onSubmit(selectedProject, baseBranch);
    setSelectedProject(null);
    setBaseBranch('');
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedProject(null);
      setBaseBranch('');
      setViewMode('all');
      setCollapsedGroups(new Set());
    }
    onOpenChange(open);
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[480px]">
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
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('addProjectToWorktree.selectProject')}</label>

                {/* Tab switcher — only shown when tags exist */}
                {tagGroups && (
                  <div className="flex gap-0 border-b border-[var(--color-border)] mb-4">
                    <button
                      className={`px-4 py-2 text-sm transition-colors ${viewMode === 'all' ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                      onClick={() => setViewMode('all')}
                    >
                      {t('addProject.viewAll')}
                    </button>
                    <button
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
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: tag?.color ?? 'var(--color-text-muted)' }}
                            />
                            <span className="font-medium text-sm text-[var(--color-text-primary)]">{tag?.name ?? t('tags.untagged')}</span>
                            <span className="text-xs text-[var(--color-text-muted)]">({groupProjects.length})</span>
                          </div>

                          {/* Projects in this group */}
                          {!isCollapsed && (
                            <div className="px-2 pb-2 space-y-1">
                              {groupProjects.map(proj => (
                                <div
                                  key={proj.name}
                                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                                    selectedProject === proj.name
                                      ? "bg-[var(--color-accent)]/10 border-[var(--color-accent)]/50"
                                      : "bg-[var(--color-bg-base)]/50 border-[var(--color-border)] hover:border-[var(--color-border)]"
                                  }`}
                                  onClick={() => handleProjectSelect(proj.name)}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                        selectedProject === proj.name
                                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                                          : "border-[var(--color-text-muted)]"
                                      }`}>
                                        {selectedProject === proj.name && (
                                          <div className="w-2 h-2 rounded-full bg-white" />
                                        )}
                                      </div>
                                      <span className="font-medium text-[var(--color-text-primary)]">{proj.name}</span>
                                    </div>
                                    {/* Tag chips */}
                                    <div className="flex gap-1">
                                      {getProjectTags(proj.name).map(tag => (
                                        <span
                                          key={tag.id}
                                          className="px-1.5 py-0.5 rounded-full text-[10px]"
                                          style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                                        >
                                          {tag.name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="text-[var(--color-text-muted)] text-xs mt-1.5 pl-7">
                                    {t('addProjectToWorktree.defaultBranch')}: {proj.base_branch} · {t('addProjectToWorktree.testBranch')}: {proj.test_branch}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // Flat list view
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                    {availableProjects.map(proj => (
                      <div
                        key={proj.name}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedProject === proj.name
                            ? "bg-[var(--color-accent)]/10 border-[var(--color-accent)]/50"
                            : "bg-[var(--color-bg-base)]/50 border-[var(--color-border)] hover:border-[var(--color-border)]"
                        }`}
                        onClick={() => handleProjectSelect(proj.name)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              selectedProject === proj.name
                                ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                                : "border-[var(--color-text-muted)]"
                            }`}>
                              {selectedProject === proj.name && (
                                <div className="w-2 h-2 rounded-full bg-white" />
                              )}
                            </div>
                            <span className="font-medium text-[var(--color-text-primary)]">{proj.name}</span>
                          </div>
                        </div>
                        <div className="text-[var(--color-text-muted)] text-xs mt-1.5 pl-7">
                          {t('addProjectToWorktree.defaultBranch')}: {proj.base_branch} · {t('addProjectToWorktree.testBranch')}: {proj.test_branch}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedProjectConfig && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('addProjectToWorktree.baseBranch')}</label>
                  <Select value={baseBranch} onValueChange={setBaseBranch}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={selectedProjectConfig.base_branch}>
                        {selectedProjectConfig.base_branch} ({t('common.default')})
                      </SelectItem>
                      {selectedProjectConfig.base_branch !== "uat" && <SelectItem value="uat">uat</SelectItem>}
                      {selectedProjectConfig.base_branch !== "master" && <SelectItem value="master">master</SelectItem>}
                      {selectedProjectConfig.base_branch !== "main" && <SelectItem value="main">main</SelectItem>}
                      {selectedProjectConfig.base_branch !== "test" && <SelectItem value="test">test</SelectItem>}
                      {selectedProjectConfig.base_branch !== "staging" && <SelectItem value="staging">staging</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={adding}>{t('common.cancel')}</Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedProject || !baseBranch || adding || availableProjects.length === 0}
          >
            {adding ? t('addProjectToWorktree.adding') : t('addProjectToWorktree.addProject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
