import { type FC, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
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
import { FolderIcon } from './Icons';

interface AddWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  path: string;
  onPathChange: (path: string) => void;
  onSubmit: () => void;
  loading?: boolean;
}

export const AddWorkspaceModal: FC<AddWorkspaceModalProps> = ({
  open: isOpen,
  onOpenChange,
  name,
  onNameChange,
  path,
  onPathChange,
  onSubmit,
  loading = false,
}) => {
  const handleSelectFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择 Workspace 目录',
    });
    if (selected && typeof selected === 'string') {
      onPathChange(selected);
      // Auto-fill name from folder name if empty
      if (!name) {
        const folderName = selected.split('/').pop() || selected.split('\\').pop();
        if (folderName) {
          onNameChange(folderName);
        }
      }
    }
  }, [name, onNameChange, onPathChange]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-0">
        <DialogHeader className="p-5 border-b border-slate-700">
          <DialogTitle>导入现有 Workspace</DialogTitle>
          <DialogDescription>
            选择一个已有的项目目录作为 Workspace
          </DialogDescription>
        </DialogHeader>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">目录路径</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={path}
                onChange={(e) => onPathChange(e.target.value)}
                placeholder="/Users/xxx/Work/my-workspace"
                className="flex-1"
              />
              <Button variant="secondary" onClick={handleSelectFolder}>
                <FolderIcon className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-1">路径下应包含 projects 目录</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">名称</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="My Workspace"
            />
          </div>
        </div>
        <DialogFooter className="p-5 border-t border-slate-700">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            onClick={onSubmit}
            disabled={!name.trim() || !path.trim() || loading}
          >
            {loading ? "导入中..." : "导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface CreateWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  path: string;
  onPathChange: (path: string) => void;
  onSubmit: () => void;
  loading?: boolean;
}

export const CreateWorkspaceModal: FC<CreateWorkspaceModalProps> = ({
  open: isOpen,
  onOpenChange,
  name,
  onNameChange,
  path,
  onPathChange,
  onSubmit,
  loading = false,
}) => {
  const handleSelectFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择父目录',
    });
    if (selected && typeof selected === 'string') {
      onPathChange(selected);
    }
  }, [onPathChange]);

  const fullPath = path && name ? `${path}/${name}` : '';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-0">
        <DialogHeader className="p-5 border-b border-slate-700">
          <DialogTitle>新建 Workspace</DialogTitle>
          <DialogDescription>
            创建一个新的 Workspace，将自动生成 projects 和 worktrees 目录
          </DialogDescription>
        </DialogHeader>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Workspace 名称</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="my-workspace"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">父目录</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={path}
                onChange={(e) => onPathChange(e.target.value)}
                placeholder="/Users/xxx/Work"
                className="flex-1"
              />
              <Button variant="secondary" onClick={handleSelectFolder}>
                <FolderIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {fullPath && (
            <div className="p-3 rounded bg-slate-800/50 border border-slate-700/50">
              <p className="text-xs text-slate-400 mb-1">将创建目录：</p>
              <p className="text-sm font-mono text-slate-300 select-text">{fullPath}</p>
            </div>
          )}
        </div>
        <DialogFooter className="p-5 border-t border-slate-700">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            onClick={onSubmit}
            disabled={!name.trim() || !path.trim() || loading}
          >
            {loading ? "创建中..." : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
