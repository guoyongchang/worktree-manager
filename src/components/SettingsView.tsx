import { useState, type FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCw } from 'lucide-react';
import { BackIcon, PlusIcon, TrashIcon } from './Icons';
import type { WorkspaceConfig, ProjectConfig } from '../types';

interface SettingsViewProps {
  config: WorkspaceConfig;
  configPath: string;
  error: string | null;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
  onUpdateField: (field: 'name' | 'worktrees_dir', value: string) => void;
  onUpdateProject: (index: number, field: keyof ProjectConfig, value: string | boolean | string[]) => void;
  onAddProject: () => void;
  onRemoveProject: (index: number) => void;
  onAddLinkedItem: (item: string) => void;
  onRemoveLinkedItem: (index: number) => void;
  onClearError: () => void;
  onCheckUpdate?: () => void;
  checkingUpdate?: boolean;
}

export const SettingsView: FC<SettingsViewProps> = ({
  config,
  configPath,
  error,
  saving,
  onBack,
  onSave,
  onUpdateField,
  onUpdateProject,
  onAddProject,
  onRemoveProject,
  onAddLinkedItem,
  onRemoveLinkedItem,
  onClearError,
  onCheckUpdate,
  checkingUpdate = false,
}) => {
  const [newLinkedItem, setNewLinkedItem] = useState('');
  const [newProjectLinkedFolder, setNewProjectLinkedFolder] = useState<Record<number, string>>({});
  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="返回主界面"
          >
            <BackIcon className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-semibold">Workspace 设置</h1>
        </div>
        <Button
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "保存中..." : "保存配置"}
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-800/50 rounded-lg">
          <div className="text-red-300 text-sm">{error}</div>
          <Button variant="link" size="sm" onClick={onClearError} className="text-red-400 hover:text-red-200 mt-1 p-0 h-auto">关闭</Button>
        </div>
      )}

      {/* Config Path Info */}
      <div className="mb-6 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <div className="text-xs text-slate-500">配置文件路径</div>
        <div className="text-sm text-slate-300 mt-1 font-mono select-text">{configPath}</div>
      </div>

      {/* Workspace Settings */}
      <div className="mb-8">
        <h2 className="text-lg font-medium mb-4">Workspace 配置</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Workspace 名称</label>
            <Input
              type="text"
              value={config.name}
              onChange={(e) => onUpdateField('name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Worktrees 目录（相对路径）</label>
            <Input
              type="text"
              value={config.worktrees_dir}
              onChange={(e) => onUpdateField('worktrees_dir', e.target.value)}
            />
          </div>

          {/* Linked Workspace Items */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">链接到 Worktree 的文件/文件夹</label>
            <div className="space-y-2">
              {config.linked_workspace_items.map((item, index) => (
                <div key={index} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded px-3 py-2">
                  <span className="flex-1 text-sm text-slate-300">{item}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveLinkedItem(index)}
                    className="text-slate-500 hover:text-red-400 text-xs"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                type="text"
                value={newLinkedItem}
                onChange={(e) => setNewLinkedItem(e.target.value)}
                placeholder="例如: .claude 或 CLAUDE.md"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newLinkedItem.trim()) {
                    e.preventDefault();
                    onAddLinkedItem(newLinkedItem.trim());
                    setNewLinkedItem('');
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (newLinkedItem.trim()) {
                    onAddLinkedItem(newLinkedItem.trim());
                    setNewLinkedItem('');
                  }
                }}
                disabled={!newLinkedItem.trim()}
              >
                添加
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              这些文件/文件夹将在创建新 worktree 时自动链接到主工作区
            </p>
          </div>
        </div>
      </div>

      {/* Projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">项目配置</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={onAddProject}
          >
            <PlusIcon className="w-4 h-4" />
            添加项目
          </Button>
        </div>

        <div className="space-y-3">
          {config.projects.map((proj, index) => (
            <div key={index} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">项目名称</label>
                    <Input
                      type="text"
                      value={proj.name}
                      onChange={(e) => onUpdateProject(index, 'name', e.target.value)}
                      placeholder="project-name"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">基准分支</label>
                    <Input
                      type="text"
                      value={proj.base_branch}
                      onChange={(e) => onUpdateProject(index, 'base_branch', e.target.value)}
                      placeholder="uat"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">测试分支</label>
                    <Input
                      type="text"
                      value={proj.test_branch}
                      onChange={(e) => onUpdateProject(index, 'test_branch', e.target.value)}
                      placeholder="test"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">合并策略</label>
                    <Select
                      value={proj.merge_strategy}
                      onValueChange={(value) => onUpdateProject(index, 'merge_strategy', value)}
                    >
                      <SelectTrigger className="w-full h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="merge">merge</SelectItem>
                        <SelectItem value="cherry-pick">cherry-pick</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Linked Folders */}
                <div className="mt-3 col-span-2">
                  <label className="block text-xs text-slate-500 mb-1">链接文件夹</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(proj.linked_folders || []).map((folder, folderIdx) => (
                      <span
                        key={folderIdx}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-700 border border-slate-600 rounded text-xs text-slate-300"
                      >
                        <span className="select-text">{folder}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const newFolders = [...(proj.linked_folders || [])];
                            newFolders.splice(folderIdx, 1);
                            onUpdateProject(index, 'linked_folders', newFolders);
                          }}
                          className="text-slate-500 hover:text-red-400 ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={newProjectLinkedFolder[index] || ''}
                      onChange={(e) => setNewProjectLinkedFolder(prev => ({ ...prev, [index]: e.target.value }))}
                      placeholder="文件夹名称"
                      className="h-7 text-xs"
                      onKeyDown={(e) => {
                        const val = (newProjectLinkedFolder[index] || '').trim();
                        if (e.key === 'Enter' && val) {
                          e.preventDefault();
                          const newFolders = [...(proj.linked_folders || []), val];
                          onUpdateProject(index, 'linked_folders', newFolders);
                          setNewProjectLinkedFolder(prev => ({ ...prev, [index]: '' }));
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        const val = (newProjectLinkedFolder[index] || '').trim();
                        if (val) {
                          const newFolders = [...(proj.linked_folders || []), val];
                          onUpdateProject(index, 'linked_folders', newFolders);
                          setNewProjectLinkedFolder(prev => ({ ...prev, [index]: '' }));
                        }
                      }}
                      disabled={!(newProjectLinkedFolder[index] || '').trim()}
                    >
                      添加
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemoveProject(index)}
                    className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-900/30"
                    title="删除项目"
                    aria-label={`删除项目 ${proj.name || '未命名'}`}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* About Section */}
      <div className="mt-8 pt-8 border-t border-slate-700/50">
        <h2 className="text-lg font-medium mb-4">关于</h2>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
          <div className="flex items-center gap-4 mb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-100">Worktree Manager</h3>
              <p className="text-xs text-slate-400 mt-0.5">版本: v{config.name ? '0.1.0' : '0.1.0'}</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">Git Worktree 可视化管理工具</p>
          {onCheckUpdate && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onCheckUpdate}
              disabled={checkingUpdate}
            >
              <RefreshCw className={`w-4 h-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
              {checkingUpdate ? '正在检查更新...' : '检查更新'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
