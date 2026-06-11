import { useState, useEffect, type FC } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BranchCombobox } from './BranchCombobox';
import { PlusIcon } from './Icons';
import { getRemoteBranches, callBackend } from '@/lib/backend';
import type { ProjectConfig, WorkspaceConfig, TagDefinition, ScannedFolder } from '../types';
import { TAG_PRESET_COLORS } from '../constants';

interface ProjectEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectConfig;
  workspacePath: string;
  workspaceConfig: WorkspaceConfig;
  onSave: (updatedProject: ProjectConfig, updatedWorkspaceConfig: WorkspaceConfig) => void;
}

export const ProjectEditModal: FC<ProjectEditModalProps> = ({
  open,
  onOpenChange,
  project,
  workspacePath,
  workspaceConfig,
  onSave,
}) => {
  const { t } = useTranslation();

  // Form state
  const [baseBranch, setBaseBranch] = useState(project.base_branch);
  const [testBranch, setTestBranch] = useState(project.test_branch);
  const [mergeStrategy, setMergeStrategy] = useState(project.merge_strategy || 'merge');
  const [linkedFolders, setLinkedFolders] = useState<string[]>(project.linked_folders || []);
  const [commitPrefixIndex, setCommitPrefixIndex] = useState(project.commit_prefix_index ?? 0);
  const [gitUserName, setGitUserName] = useState(project.git_user_name || '');
  const [gitUserEmail, setGitUserEmail] = useState(project.git_user_email || '');
  const [selectedTags, setSelectedTags] = useState<string[]>(project.tags || []);

  // Workspace tags (may get new tags added during this session)
  const [workspaceTags, setWorkspaceTags] = useState<TagDefinition[]>(workspaceConfig.tags || []);

  // New tag creation
  const [showNewTag, setShowNewTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_PRESET_COLORS[0]);

  // Linked folder scanning
  const [scanResults, setScanResults] = useState<ScannedFolder[]>([]);
  const [scanning, setScanning] = useState(false);
  const [newFolder, setNewFolder] = useState('');

  // Reset form when project changes or modal opens
  useEffect(() => {
    if (open) {
      setBaseBranch(project.base_branch);
      setTestBranch(project.test_branch);
      setMergeStrategy(project.merge_strategy || 'merge');
      setLinkedFolders(project.linked_folders || []);
      setCommitPrefixIndex(project.commit_prefix_index ?? 0);
      setGitUserName(project.git_user_name || '');
      setGitUserEmail(project.git_user_email || '');
      setSelectedTags(project.tags || []);
      setWorkspaceTags(workspaceConfig.tags || []);
      setShowNewTag(false);
      setNewTagName('');
      setNewTagColor(TAG_PRESET_COLORS[0]);
      setScanResults([]);
      setNewFolder('');
    }
  }, [open, project, workspaceConfig]);

  const projectPath = `${workspacePath}/projects/${project.name}`;

  const handleScan = async () => {
    setScanning(true);
    try {
      const results = await callBackend<ScannedFolder[]>('scan_linked_folders', { projectPath });
      // Filter out already linked folders
      setScanResults(results.filter(r => !linkedFolders.includes(r.relative_path)));
    } catch {
      // silently fail
    } finally {
      setScanning(false);
    }
  };

  const handleAddFolder = () => {
    const trimmed = newFolder.trim();
    if (trimmed && !linkedFolders.includes(trimmed)) {
      setLinkedFolders(prev => [...prev, trimmed]);
      setNewFolder('');
    }
  };

  const handleRemoveFolder = (folder: string) => {
    setLinkedFolders(prev => prev.filter(f => f !== folder));
  };

  const handleAddScanResult = (path: string) => {
    if (!linkedFolders.includes(path)) {
      setLinkedFolders(prev => [...prev, path]);
      setScanResults(prev => prev.filter(r => r.relative_path !== path));
    }
  };

  const handleToggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  const handleCreateTag = () => {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    // Check duplicate
    if (workspaceTags.some(t => t.name === trimmed)) return;
    const newTag: TagDefinition = {
      id: crypto.randomUUID(),
      name: trimmed,
      color: newTagColor,
    };
    setWorkspaceTags(prev => [...prev, newTag]);
    setSelectedTags(prev => [...prev, newTag.id]);
    setNewTagName('');
    setNewTagColor(TAG_PRESET_COLORS[(workspaceTags.length + 1) % TAG_PRESET_COLORS.length]);
    setShowNewTag(false);
  };

  const handleSave = () => {
    const updatedProject: ProjectConfig = {
      ...project,
      base_branch: baseBranch,
      test_branch: testBranch,
      merge_strategy: mergeStrategy,
      linked_folders: linkedFolders,
      commit_prefix_index: commitPrefixIndex,
      git_user_name: gitUserName || undefined,
      git_user_email: gitUserEmail || undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
    };
    const updatedConfig: WorkspaceConfig = {
      ...workspaceConfig,
      tags: workspaceTags.length > 0 ? workspaceTags : undefined,
    };
    onSave(updatedProject, updatedConfig);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('projectEdit.title', { name: project.name })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Branch config */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                {t('projectEdit.baseBranch')}
              </label>
              <BranchCombobox
                value={baseBranch}
                onChange={setBaseBranch}
                onLoadBranches={() => getRemoteBranches(projectPath)}
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                {t('projectEdit.testBranch')}
              </label>
              <BranchCombobox
                value={testBranch}
                onChange={setTestBranch}
                onLoadBranches={() => getRemoteBranches(projectPath)}
              />
            </div>
          </div>

          {/* Merge Strategy */}
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
              {t('projectEdit.mergeStrategy')}
            </label>
            <Select value={mergeStrategy} onValueChange={setMergeStrategy}>
              <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">merge</SelectItem>
                <SelectItem value="cherry-pick">cherry-pick</SelectItem>
                <SelectItem value="rebase">rebase</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Commit Prefix */}
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
              {t('projectEdit.commitPrefix')}
            </label>
            <Select value={String(commitPrefixIndex)} onValueChange={(v) => setCommitPrefixIndex(parseInt(v, 10))}>
              <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">模板 1</SelectItem>
                <SelectItem value="1">模板 2</SelectItem>
                <SelectItem value="2">模板 3</SelectItem>
                <SelectItem value="3">{t('settings.noPrefix', 'None')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Git User */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                {t('projectEdit.gitUserName')}
              </label>
              <Input
                type="text"
                value={gitUserName}
                onChange={(e) => setGitUserName(e.target.value)}
                placeholder={t('settings.inheritGlobal')}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                {t('projectEdit.gitUserEmail')}
              </label>
              <Input
                type="text"
                value={gitUserEmail}
                onChange={(e) => setGitUserEmail(e.target.value)}
                placeholder={t('settings.inheritGlobal')}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
              {t('projectEdit.tags')}
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {workspaceTags.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleToggleTag(tag.id)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors"
                  style={{
                    borderColor: tag.color,
                    backgroundColor: selectedTags.includes(tag.id) ? tag.color + '30' : 'transparent',
                    color: selectedTags.includes(tag.id) ? tag.color : 'var(--color-text-secondary)',
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                  {selectedTags.includes(tag.id) && <span className="ml-0.5">✓</span>}
                </button>
              ))}
              {workspaceTags.length === 0 && !showNewTag && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  {t('projectEdit.tagsPlaceholder')}
                </span>
              )}
            </div>

            {showNewTag ? (
              <div className="flex items-center gap-2 p-2 border border-[var(--color-border)] rounded-md bg-[var(--color-bg-surface)]">
                <Input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder={t('settings.tagName')}
                  className="h-7 text-xs flex-1"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTag(); }}
                  autoFocus
                />
                <div className="flex gap-0.5">
                  {TAG_PRESET_COLORS.slice(0, 6).map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewTagColor(color)}
                      className="w-4 h-4 rounded-full border border-transparent transition-transform"
                      style={{
                        backgroundColor: color,
                        transform: newTagColor === color ? 'scale(1.3)' : 'scale(1)',
                        borderColor: newTagColor === color ? 'var(--color-text-primary)' : 'transparent',
                      }}
                    />
                  ))}
                </div>
                <Button size="sm" className="h-7 text-xs" onClick={handleCreateTag} disabled={!newTagName.trim()}>
                  {t('common.add')}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowNewTag(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewTag(true)}
                className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
              >
                <PlusIcon className="w-3 h-3" />
                {t('projectEdit.createTag')}
              </button>
            )}

            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              {t('projectEdit.tagManageHint')}
            </p>
          </div>

          {/* Linked Folders */}
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
              {t('projectEdit.linkedFolders')}
            </label>
            {linkedFolders.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {linkedFolders.map(folder => (
                  <span
                    key={folder}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-bg-elevated)] text-xs text-[var(--color-text-secondary)]"
                  >
                    {folder}
                    <button
                      type="button"
                      onClick={() => handleRemoveFolder(folder)}
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-error)] ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder={t('settings.linkedFolderPlaceholder')}
                className="h-7 text-xs flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddFolder(); }}
              />
              <Button size="sm" className="h-7 text-xs" onClick={handleAddFolder} disabled={!newFolder.trim()}>
                {t('settings.addFolder')}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleScan} disabled={scanning}>
                {scanning ? t('settings.scanning') : t('projectEdit.scanFolders')}
              </Button>
            </div>
            {scanResults.length > 0 && (
              <div className="mt-2 space-y-1">
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {t('settings.scanResult')}
                </span>
                <div className="flex flex-wrap gap-1">
                  {scanResults.map(result => (
                    <button
                      key={result.relative_path}
                      type="button"
                      onClick={() => handleAddScanResult(result.relative_path)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:border-[var(--color-text-muted)] transition-colors"
                    >
                      <PlusIcon className="w-3 h-3" />
                      {result.display_name}
                      <span className="text-[var(--color-text-muted)]">({result.size_display})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('projectEdit.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('projectEdit.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
