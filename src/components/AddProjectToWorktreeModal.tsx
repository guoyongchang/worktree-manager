import { useState, type FC } from 'react';
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
import type { WorkspaceConfig, WorktreeListItem } from '../types';

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
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState<string>('');

  if (!config || !worktree) return null;

  // Filter out projects already in the worktree
  const existingProjectNames = new Set(worktree.projects.map(p => p.name));
  const availableProjects = config.projects.filter(p => !existingProjectNames.has(p.name));

  const selectedProjectConfig = availableProjects.find(p => p.name === selectedProject);

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
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>添加项目到 Worktree</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-slate-400 mb-4">
            将主工作区中的项目添加到 <span className="text-slate-200 font-medium">{worktree.name}</span>
          </p>

          {availableProjects.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <PlusIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>没有可添加的项目</p>
              <p className="text-xs mt-1">所有项目已经在此 Worktree 中</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">选择项目</label>
                <div className="space-y-2">
                  {availableProjects.map(proj => (
                    <div
                      key={proj.name}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedProject === proj.name
                          ? "bg-blue-900/20 border-blue-500/50"
                          : "bg-slate-900/50 border-slate-700 hover:border-slate-600"
                      }`}
                      onClick={() => handleProjectSelect(proj.name)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            selectedProject === proj.name
                              ? "border-blue-500 bg-blue-500"
                              : "border-slate-500"
                          }`}>
                            {selectedProject === proj.name && (
                              <div className="w-2 h-2 rounded-full bg-white" />
                            )}
                          </div>
                          <span className="font-medium text-slate-200">{proj.name}</span>
                        </div>
                      </div>
                      <div className="text-slate-500 text-xs mt-1.5 pl-7">
                        默认: {proj.base_branch} · 测试: {proj.test_branch}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedProjectConfig && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Base 分支</label>
                  <Select value={baseBranch} onValueChange={setBaseBranch}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={selectedProjectConfig.base_branch}>
                        {selectedProjectConfig.base_branch} (默认)
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
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={adding}>取消</Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedProject || !baseBranch || adding || availableProjects.length === 0}
          >
            {adding ? "添加中..." : "添加项目"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
