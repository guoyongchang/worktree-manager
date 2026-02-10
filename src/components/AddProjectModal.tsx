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

const RECOMMENDED_LINKED_FOLDERS = [
  { name: 'node_modules', label: 'node_modules', desc: 'npm/yarn/pnpm 依赖' },
  { name: '.next', label: '.next', desc: 'Next.js 构建缓存' },
  { name: '.nuxt', label: '.nuxt', desc: 'Nuxt 构建缓存' },
  { name: '.yarn/cache', label: '.yarn/cache', desc: 'Yarn 缓存' },
  { name: '.pnpm-store', label: '.pnpm-store', desc: 'pnpm 存储' },
  { name: 'vendor', label: 'vendor', desc: 'PHP/Go 依赖' },
  { name: '.gradle', label: '.gradle', desc: 'Gradle 缓存' },
];

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
  }) => void;
  loading?: boolean;
}

export const AddProjectModal: FC<AddProjectModalProps> = ({
  open,
  onOpenChange,
  onSubmit,
  loading = false,
}) => {
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [testBranch, setTestBranch] = useState('test');
  const [mergeStrategy, setMergeStrategy] = useState('merge');
  const [linkedFolders, setLinkedFolders] = useState<Set<string>>(new Set());
  const [customFolder, setCustomFolder] = useState('');
  const [urlFormat, setUrlFormat] = useState<'gh' | 'ssh' | 'https'>('gh');

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

  const handleSubmit = () => {
    if (!name.trim() || !repoUrl.trim()) return;

    onSubmit({
      name: name.trim(),
      repo_url: repoUrl.trim(),
      base_branch: baseBranch.trim(),
      test_branch: testBranch.trim(),
      merge_strategy: mergeStrategy,
      linked_folders: Array.from(linkedFolders),
    });

    // Reset form
    setName('');
    setNameManuallyEdited(false);
    setRepoUrl('');
    setBaseBranch('main');
    setTestBranch('test');
    setMergeStrategy('merge');
    setLinkedFolders(new Set());
    setCustomFolder('');
    setUrlFormat('gh');
  };

  const toggleLinkedFolder = (folder: string) => {
    setLinkedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  const addCustomFolder = () => {
    const folder = customFolder.trim();
    if (!folder) return;

    setLinkedFolders(prev => {
      const next = new Set(prev);
      next.add(folder);
      return next;
    });
    setCustomFolder('');
  };

  const removeCustomFolder = (folder: string) => {
    setLinkedFolders(prev => {
      const next = new Set(prev);
      next.delete(folder);
      return next;
    });
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

  // 分离推荐文件夹和自定义文件夹
  const recommendedFolderNames = RECOMMENDED_LINKED_FOLDERS.map(f => f.name);
  const customFolders = Array.from(linkedFolders).filter(f => !recommendedFolderNames.includes(f));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] p-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="p-5 border-b border-slate-700">
          <DialogTitle>添加项目</DialogTitle>
          <DialogDescription>
            克隆一个 Git 仓库到主工作区
          </DialogDescription>
        </DialogHeader>

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
              <Input
                type="text"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder="main"
              />
            </div>

            {/* Test Branch */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                测试分支
              </label>
              <Input
                type="text"
                value={testBranch}
                onChange={(e) => setTestBranch(e.target.value)}
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

          {/* Linked Folders */}
          <div className="border-t border-slate-700 pt-4">
            <label className="block text-sm font-medium text-slate-300 mb-3">
              链接文件夹（推荐）
            </label>
            <div className="space-y-2">
              {RECOMMENDED_LINKED_FOLDERS.map(folder => (
                <div key={folder.name} className="flex items-start gap-2">
                  <Checkbox
                    id={`folder-${folder.name}`}
                    checked={linkedFolders.has(folder.name)}
                    onChange={() => toggleLinkedFolder(folder.name)}
                  />
                  <label htmlFor={`folder-${folder.name}`} className="flex-1 cursor-pointer">
                    <div className="text-sm text-slate-300">{folder.label}</div>
                    <div className="text-xs text-slate-500">{folder.desc}</div>
                  </label>
                </div>
              ))}
            </div>

            {/* Custom Folders */}
            {customFolders.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-xs font-medium text-slate-400">自定义文件夹</div>
                {customFolders.map(folder => (
                  <div key={folder} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded px-3 py-2">
                    <span className="flex-1 text-sm text-slate-300">{folder}</span>
                    <button
                      type="button"
                      onClick={() => removeCustomFolder(folder)}
                      className="text-slate-500 hover:text-red-400 text-xs"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Custom Folder */}
            <div className="mt-3">
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

            <p className="text-xs text-slate-500 mt-3">
              链接的文件夹在各个 worktree 间共享，节省磁盘空间。支持嵌套路径。
            </p>
          </div>
        </div>

        <DialogFooter className="p-5 border-t border-slate-700">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !repoUrl.trim() || loading}
          >
            {loading ? '克隆中...' : '克隆项目'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
