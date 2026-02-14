import { type FC, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
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
import { BranchCombobox } from './BranchCombobox';
import type { ScannedFolder } from '../types';

interface AddProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (project: {
    name: string;
    repo_url: string;
    base_branch: string;
    test_branch: string;
    merge_strategy: string;
    linked_folders: string[];
  }) => Promise<void>;
  loading?: boolean;
  scanLinkedFolders?: (projectPath: string) => Promise<ScannedFolder[]>;
  workspacePath?: string;
  onUpdateLinkedFolders?: (projectName: string, folders: string[]) => Promise<void>;
}

export const AddProjectModal: FC<AddProjectModalProps> = ({
  open,
  onOpenChange,
  onSubmit,
  loading = false,
  scanLinkedFolders,
  workspacePath,
  onUpdateLinkedFolders,
}) => {
  // Form state
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [testBranch, setTestBranch] = useState('test');
  const [mergeStrategy, setMergeStrategy] = useState('merge');
  const [urlFormat, setUrlFormat] = useState<'gh' | 'ssh' | 'https'>('gh');

  // Two-phase flow state
  const [phase, setPhase] = useState<'form' | 'scanning' | 'results'>('form');
  const [scanResults, setScanResults] = useState<ScannedFolder[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [customFolder, setCustomFolder] = useState('');
  const [savingFolders, setSavingFolders] = useState(false);

  const extractProjectName = (url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return '';
    // gh:owner/repo or owner/repo
    if (!trimmed.includes('://') && !trimmed.startsWith('git@')) {
      const repo = trimmed.replace(/^gh:/, '');
      const parts = repo.split('/');
      return (parts[parts.length - 1] || '').replace(/\.git$/, '');
    }
    // git@github.com:owner/repo.git
    if (trimmed.startsWith('git@')) {
      const match = trimmed.match(/:(.+?)(?:\.git)?$/);
      if (match) {
        const parts = match[1].split('/');
        return parts[parts.length - 1] || '';
      }
    }
    // https://github.com/owner/repo.git
    try {
      const pathname = new URL(trimmed).pathname;
      const parts = pathname.split('/').filter(Boolean);
      return (parts[parts.length - 1] || '').replace(/\.git$/, '');
    } catch {
      return '';
    }
  };

  const handleRepoUrlChange = (url: string) => {
    setRepoUrl(url);
    if (!nameManuallyEdited) {
      const derived = extractProjectName(url);
      if (derived) setName(derived);
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    setNameManuallyEdited(true);
  };

  const resetForm = () => {
    setName('');
    setNameManuallyEdited(false);
    setRepoUrl('');
    setBaseBranch('main');
    setTestBranch('test');
    setMergeStrategy('merge');
    setUrlFormat('gh');
    setPhase('form');
    setScanResults([]);
    setScanError(null);
    setSelectedFolders(new Set());
    setCustomFolder('');
    setSavingFolders(false);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !repoUrl.trim()) return;

    try {
      // Clone with empty linked_folders first
      await onSubmit({
        name: name.trim(),
        repo_url: repoUrl.trim(),
        base_branch: baseBranch.trim(),
        test_branch: testBranch.trim(),
        merge_strategy: mergeStrategy,
        linked_folders: [],
      });

      // After successful clone, start scanning if available
      if (scanLinkedFolders && workspacePath) {
        setPhase('scanning');
        setScanError(null);
        try {
          const projectPath = `${workspacePath}/projects/${name.trim()}`;
          const results = await scanLinkedFolders(projectPath);
          setScanResults(results);

          // Pre-select recommended folders
          const recommended = new Set<string>();
          results.forEach(r => {
            if (r.is_recommended) {
              recommended.add(r.relative_path);
            }
          });
          setSelectedFolders(recommended);

          setPhase('results');
        } catch (e) {
          setScanError(String(e));
          setPhase('results');
        }
      } else {
        // No scanning available, close modal
        onOpenChange(false);
        resetForm();
      }
    } catch {
      // Clone failed, stay on form (error handled by parent)
    }
  };

  const toggleFolder = (relativePath: string) => {
    setSelectedFolders(prev => {
      const next = new Set(prev);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  };

  const addCustomFolder = () => {
    const folder = customFolder.trim();
    if (!folder) return;
    setSelectedFolders(prev => {
      const next = new Set(prev);
      next.add(folder);
      return next;
    });
    setCustomFolder('');
  };

  const handleSaveFolders = async () => {
    if (!onUpdateLinkedFolders) return;
    setSavingFolders(true);
    try {
      await onUpdateLinkedFolders(name.trim(), Array.from(selectedFolders));
      onOpenChange(false);
      resetForm();
    } catch {
      // Error handled by parent
    } finally {
      setSavingFolders(false);
    }
  };

  const handleSkip = () => {
    onOpenChange(false);
    resetForm();
  };

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  const getPlaceholder = () => {
    switch (urlFormat) {
      case 'gh':
        return 'owner/repo 或 gh:owner/repo';
      case 'ssh':
        return 'git@github.com:owner/repo.git';
      case 'https':
        return 'https://github.com/owner/repo.git';
    }
  };

  // Custom folders that aren't from scan results
  const scanResultPaths = new Set(scanResults.map(r => r.relative_path));
  const customSelectedFolders = Array.from(selectedFolders).filter(f => !scanResultPaths.has(f));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[560px] p-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="p-5 border-b border-slate-700">
          <DialogTitle>
            {phase === 'form' ? '添加项目' : '选择链接文件夹'}
          </DialogTitle>
          <DialogDescription>
            {phase === 'form'
              ? '克隆一个 Git 仓库到主工作区'
              : '扫描发现以下可链接的文件夹，选择后将在 worktree 间共享'}
          </DialogDescription>
        </DialogHeader>

        {/* Phase 1: Form */}
        {phase === 'form' && (
          <>
            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Project Name */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  项目名称
                </label>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="my-project"
                />
              </div>

              {/* URL Format Selector */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  克隆方式
                </label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={urlFormat === 'gh' ? 'default' : 'secondary'}
                    className="flex-1"
                    onClick={() => setUrlFormat('gh')}
                  >
                    GitHub
                  </Button>
                  <Button
                    type="button"
                    variant={urlFormat === 'ssh' ? 'default' : 'secondary'}
                    className="flex-1"
                    onClick={() => setUrlFormat('ssh')}
                  >
                    SSH
                  </Button>
                  <Button
                    type="button"
                    variant={urlFormat === 'https' ? 'default' : 'secondary'}
                    className="flex-1"
                    onClick={() => setUrlFormat('https')}
                  >
                    HTTPS
                  </Button>
                </div>
              </div>

              {/* Repository URL */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  仓库地址
                </label>
                <Input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => handleRepoUrlChange(e.target.value)}
                  placeholder={getPlaceholder()}
                />
                <p className="text-xs text-slate-500 mt-1">
                  {urlFormat === 'gh' && 'GitHub 简写格式'}
                  {urlFormat === 'ssh' && 'SSH 格式'}
                  {urlFormat === 'https' && 'HTTPS 格式'}
                </p>
              </div>

              {/* Base Branch */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    基准分支
                  </label>
                  <BranchCombobox
                    value={baseBranch}
                    onChange={setBaseBranch}
                    placeholder="main"
                  />
                </div>

                {/* Test Branch */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    测试分支
                  </label>
                  <BranchCombobox
                    value={testBranch}
                    onChange={setTestBranch}
                    placeholder="test"
                  />
                </div>
              </div>

              {/* Merge Strategy */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  合并策略
                </label>
                <Select value={mergeStrategy} onValueChange={setMergeStrategy}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">Merge</SelectItem>
                    <SelectItem value="cherry-pick">Cherry-pick</SelectItem>
                    <SelectItem value="rebase">Rebase</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="p-5 border-t border-slate-700">
              <Button variant="secondary" onClick={() => handleClose(false)} disabled={loading}>
                取消
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!name.trim() || !repoUrl.trim() || loading}
              >
                {loading ? '克隆中...' : '克隆项目'}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Phase 2: Scanning */}
        {phase === 'scanning' && (
          <div className="p-8 flex flex-col items-center justify-center gap-3">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400">正在扫描项目文件夹...</p>
          </div>
        )}

        {/* Phase 3: Results */}
        {phase === 'results' && (
          <>
            <div className="p-5 space-y-4 overflow-y-auto">
              {scanError && (
                <div className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg">
                  <p className="text-sm text-red-300">扫描出错: {scanError}</p>
                </div>
              )}

              {scanResults.length === 0 && !scanError && (
                <div className="p-4 bg-slate-800/50 rounded-lg text-center">
                  <p className="text-sm text-slate-400">未发现可链接的文件夹</p>
                </div>
              )}

              {scanResults.length > 0 && (
                <div className="space-y-2">
                  {scanResults.map(result => (
                    <div
                      key={result.relative_path}
                      className="flex items-center gap-3 p-2.5 bg-slate-800/50 border border-slate-700/50 rounded-lg hover:border-slate-600/50 transition-colors"
                    >
                      <Checkbox
                        id={`scan-${result.relative_path}`}
                        checked={selectedFolders.has(result.relative_path)}
                        onChange={() => toggleFolder(result.relative_path)}
                      />
                      <label
                        htmlFor={`scan-${result.relative_path}`}
                        className="flex-1 cursor-pointer min-w-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-300 font-mono truncate">
                            {result.relative_path}
                          </span>
                          {result.is_recommended && (
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                              推荐
                            </span>
                          )}
                        </div>
                      </label>
                      <span className="text-xs text-slate-500 shrink-0">
                        {result.size_display}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Custom selected folders */}
              {customSelectedFolders.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-400">自定义文件夹</div>
                  {customSelectedFolders.map(folder => (
                    <div key={folder} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded px-3 py-2">
                      <span className="flex-1 text-sm text-slate-300 font-mono">{folder}</span>
                      <button
                        type="button"
                        onClick={() => toggleFolder(folder)}
                        className="text-slate-500 hover:text-red-400 text-xs"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Custom Folder */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  添加自定义文件夹
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={customFolder}
                    onChange={(e) => setCustomFolder(e.target.value)}
                    placeholder="例如: dist 或 .yarn/cache"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomFolder();
                      }
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={addCustomFolder}
                    disabled={!customFolder.trim()}
                  >
                    添加
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="p-5 border-t border-slate-700">
              <Button variant="secondary" onClick={handleSkip} disabled={savingFolders}>
                跳过
              </Button>
              <Button
                onClick={handleSaveFolders}
                disabled={selectedFolders.size === 0 || savingFolders}
              >
                {savingFolders ? '保存中...' : `保存链接文件夹 (${selectedFolders.size})`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
