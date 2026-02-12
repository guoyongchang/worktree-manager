import { useState, useEffect, type FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Search } from 'lucide-react';
import { BackIcon, PlusIcon, TrashIcon } from './Icons';
import type { WorkspaceRef, WorkspaceConfig, ProjectConfig, ScannedFolder } from '../types';
import { getAppVersion, getNgrokToken, setNgrokToken as saveNgrokToken, isTauri } from '../lib/backend';

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
  onScanProject?: (projectName: string) => void;
  scanningProject?: string | null;
  scanResults?: ScannedFolder[];
  workspaces?: WorkspaceRef[];
  currentWorkspace?: WorkspaceRef | null;
  onRemoveWorkspace?: (path: string) => void;
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
  onScanProject,
  scanningProject = null,
  scanResults = [],
  workspaces = [],
  currentWorkspace = null,
  onRemoveWorkspace,
}) => {
  const [newLinkedItem, setNewLinkedItem] = useState('');
  const [newProjectLinkedFolder, setNewProjectLinkedFolder] = useState<Record<number, string>>({});
  const [appVersion, setAppVersion] = useState('');
  const [removeConfirmWorkspace, setRemoveConfirmWorkspace] = useState<WorkspaceRef | null>(null);

  // ngrok token state
  const [ngrokToken, setNgrokToken] = useState('');
  const [ngrokTokenLoaded, setNgrokTokenLoaded] = useState(false);
  const [ngrokSaving, setNgrokSaving] = useState(false);
  const [ngrokSaved, setNgrokSaved] = useState(false);

  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
    if (isTauri()) {
      getNgrokToken().then(t => {
        setNgrokToken(t || '');
        setNgrokTokenLoaded(true);
      }).catch(() => setNgrokTokenLoaded(true));
    }
  }, []);
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
          <div className="text-red-300 text-sm select-text">{error}</div>
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
                  <span className="flex-1 text-sm text-slate-300 select-text">{item}</span>
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

      {/* Workspace Management */}
      {workspaces.length > 0 && onRemoveWorkspace && (
        <div className="mb-8">
          <h2 className="text-lg font-medium mb-4">Workspace 管理</h2>
          <div className="space-y-2">
            {workspaces.map(ws => (
              <div
                key={ws.path}
                className={`flex items-center justify-between p-3 bg-slate-800/50 border rounded-lg ${
                  currentWorkspace?.path === ws.path
                    ? 'border-blue-500/50'
                    : 'border-slate-700/50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{ws.name}</span>
                    {currentWorkspace?.path === ws.path && (
                      <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">当前</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5 select-text">{ws.path}</div>
                </div>
                {workspaces.length > 1 && currentWorkspace?.path !== ws.path && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRemoveConfirmWorkspace(ws)}
                    className="h-8 w-8 text-slate-500 hover:text-red-400 hover:bg-red-900/20 shrink-0 ml-2"
                    title="移除工作区"
                    aria-label={`移除工作区 ${ws.name}`}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            移除工作区仅从列表中删除，不会删除实际文件。当前使用中的工作区无法移除。
          </p>
        </div>
      )}

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
              <div className="flex items-start gap-3 mb-3">
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
                        <SelectItem value="rebase">rebase</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveProject(index)}
                  className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-900/30 shrink-0"
                  title="删除项目"
                  aria-label={`删除项目 ${proj.name || '未命名'}`}
                >
                  <TrashIcon className="w-4 h-4" />
                </Button>
              </div>
              {/* Linked Folders */}
              <div className="border-t border-slate-700/50 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs text-slate-500">链接文件夹</label>
                  {onScanProject && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1 text-slate-400 hover:text-slate-200"
                      onClick={() => onScanProject(proj.name)}
                      disabled={scanningProject === proj.name || !proj.name}
                    >
                      {scanningProject === proj.name ? (
                        <>
                          <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                          扫描中...
                        </>
                      ) : (
                        <>
                          <Search className="w-3 h-3" />
                          扫描
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {/* Scan Results Panel */}
                {scanResults.length > 0 && scanningProject === null && proj.name && (() => {
                  const existingFolders = new Set(proj.linked_folders || []);
                  const filteredResults = scanResults.filter(r => !existingFolders.has(r.relative_path));
                  if (filteredResults.length === 0) return null;
                  return (
                    <div className="mb-2 p-2 bg-blue-900/20 border border-blue-800/30 rounded-lg">
                      <div className="text-[10px] font-medium text-blue-400 mb-1.5">扫描结果 (点击添加)</div>
                      <div className="space-y-1">
                        {filteredResults.map(result => (
                          <button
                            key={result.relative_path}
                            type="button"
                            className="w-full flex items-center justify-between px-2 py-1 text-left rounded hover:bg-blue-900/30 transition-colors"
                            onClick={() => {
                              const newFolders = [...(proj.linked_folders || []), result.relative_path];
                              onUpdateProject(index, 'linked_folders', newFolders);
                            }}
                          >
                            <span className="text-xs text-slate-300 font-mono">{result.relative_path}</span>
                            <span className="text-[10px] text-slate-500 ml-2">{result.size_display}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {(proj.linked_folders || []).length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {(proj.linked_folders || []).map((folder, folderIdx) => (
                      <div
                        key={folderIdx}
                        className="flex items-center justify-between px-3 py-1.5 bg-slate-700/50 border border-slate-600/50 rounded text-sm text-slate-300"
                      >
                        <span className="select-text">{folder}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const newFolders = [...(proj.linked_folders || [])];
                            newFolders.splice(folderIdx, 1);
                            onUpdateProject(index, 'linked_folders', newFolders);
                          }}
                          className="text-slate-500 hover:text-red-400 text-xs ml-2"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newProjectLinkedFolder[index] || ''}
                    onChange={(e) => setNewProjectLinkedFolder(prev => ({ ...prev, [index]: e.target.value }))}
                    placeholder="例如: node_modules"
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
            </div>
          ))}
        </div>
      </div>

      {/* ngrok Config Section (Tauri only) */}
      {isTauri() && ngrokTokenLoaded && (
        <div className="mt-8 pt-8 border-t border-slate-700/50">
          <h2 className="text-lg font-medium mb-4">外网分享 (ngrok)</h2>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">ngrok Authtoken</label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={ngrokToken}
                  onChange={(e) => { setNgrokToken(e.target.value); setNgrokSaved(false); }}
                  placeholder="粘贴你的 ngrok authtoken"
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={ngrokSaving}
                  onClick={async () => {
                    setNgrokSaving(true);
                    try {
                      await saveNgrokToken(ngrokToken.trim());
                      setNgrokSaved(true);
                      setTimeout(() => setNgrokSaved(false), 2000);
                    } catch {
                      // ignore
                    } finally {
                      setNgrokSaving(false);
                    }
                  }}
                >
                  {ngrokSaving ? '保存中...' : ngrokSaved ? '已保存' : '保存'}
                </Button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              配置 ngrok token 后，分享时可选择"外网"模式，通过公网 URL 访问。
              <button
                type="button"
                className="text-blue-400 hover:text-blue-300 ml-1 underline cursor-pointer"
                onClick={async () => {
                  const url = 'https://dashboard.ngrok.com/get-started/your-authtoken';
                  if (isTauri()) {
                    const { openUrl } = await import('@tauri-apps/plugin-opener');
                    await openUrl(url);
                  } else {
                    window.open(url, '_blank');
                  }
                }}
              >
                获取 token
              </button>
            </p>
          </div>
        </div>
      )}

      {/* About Section */}
      <div className="mt-8 pt-8 border-t border-slate-700/50">
        <h2 className="text-lg font-medium mb-4">关于</h2>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
          <div className="flex items-center gap-4 mb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-100">Worktree Manager</h3>
              <p className="text-xs text-slate-400 mt-0.5 select-text">版本: v{appVersion}</p>
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

      {/* Remove Workspace Confirmation Dialog */}
      <Dialog open={!!removeConfirmWorkspace} onOpenChange={(open) => !open && setRemoveConfirmWorkspace(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>移除工作区</DialogTitle>
            <DialogDescription>
              确定要移除工作区 "{removeConfirmWorkspace?.name}" 吗？此操作仅从列表中移除，不会删除实际文件。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoveConfirmWorkspace(null)}>
              取消
            </Button>
            <Button variant="warning" onClick={() => {
              if (removeConfirmWorkspace && onRemoveWorkspace) {
                onRemoveWorkspace(removeConfirmWorkspace.path);
                setRemoveConfirmWorkspace(null);
              }
            }}>
              确认移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
