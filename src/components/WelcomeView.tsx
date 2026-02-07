import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { FolderIcon, PlusIcon, WorkspaceIcon } from './Icons';

interface WelcomeViewProps {
  onAddWorkspace: () => void;
  onCreateWorkspace: () => void;
}

export const WelcomeView: FC<WelcomeViewProps> = ({ onAddWorkspace, onCreateWorkspace }) => {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
      <div className="max-w-lg w-full mx-auto text-center p-8">
        <div className="mb-8">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <WorkspaceIcon className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-3">欢迎使用 Worktree Manager</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            一款 Git Worktree 可视化管理工具，帮助你高效管理多分支开发工作流。
          </p>
        </div>

        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 text-left">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <FolderIcon className="w-4 h-4 text-blue-400" />
              什么是 Workspace？
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Workspace 是包含多个相关项目的工作目录。典型结构如下：
            </p>
            <pre className="mt-2 text-xs text-slate-500 bg-slate-900/50 rounded p-2 overflow-x-auto">
{`workspace/
├── projects/      # 主仓库目录
│   ├── backend/
│   └── frontend/
└── worktrees/     # Worktree 目录`}
            </pre>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              className="h-12"
              onClick={onAddWorkspace}
            >
              <FolderIcon className="w-4 h-4 mr-2" />
              导入现有目录
            </Button>
            <Button
              className="h-12"
              onClick={onCreateWorkspace}
            >
              <PlusIcon className="w-4 h-4 mr-2" />
              新建 Workspace
            </Button>
          </div>

          <p className="text-xs text-slate-500">
            导入：选择已有项目目录 | 新建：创建全新的 Workspace 结构
          </p>
        </div>
      </div>
    </div>
  );
};
