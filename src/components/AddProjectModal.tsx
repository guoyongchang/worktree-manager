import { type FC, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
import { GitBranchIcon, RefreshIcon } from './Icons';
import type { ScannedFolder } from '../types';
import { scanExistingProjects, addExistingProject, importExternalProject, openDirectoryDialog, type ExistingProjectInfo } from '@/lib/backend';

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
  onSuccess?: () => void;
}

export const AddProjectModal: FC<AddProjectModalProps> = ({
  open,
  onOpenChange,
  onSubmit,
  loading = false,
  scanLinkedFolders,
  workspacePath,
  onUpdateLinkedFolders,
  onSuccess,
}) => {
  const { t } = useTranslation();

  // Elapsed time tracking for clone operation
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loading) {
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
      }
    };
  }, [loading]);

  const formatElapsed = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return min > 0 ? `${min}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
  };

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

  // Tab mode: clone vs existing
  const [mode, setMode] = useState<'clone' | 'existing'>('clone');

  // Existing project state
  const [existingProjects, setExistingProjects] = useState<ExistingProjectInfo[]>([]);
  const [existingLoading, setExistingLoading] = useState(false);
  const [existingError, setExistingError] = useState<string | null>(null);
  const [selectedExisting, setSelectedExisting] = useState<string | null>(null);
  const [existingBaseBranch, setExistingBaseBranch] = useState('');
  const [existingTestBranch, setExistingTestBranch] = useState('test');
  const [existingMergeStrategy, setExistingMergeStrategy] = useState('merge');
  const [addingExisting, setAddingExisting] = useState(false);
  const [importingExternal, setImportingExternal] = useState(false);

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
    setMode('clone');
    setExistingProjects([]);
    setExistingLoading(false);
    setExistingError(null);
    setSelectedExisting(null);
    setExistingBaseBranch('');
    setExistingTestBranch('test');
    setExistingMergeStrategy('merge');
    setAddingExisting(false);
    setImportingExternal(false);
  };

  const handleBrowseProject = async () => {
    try {
      const selectedPath = await openDirectoryDialog(t('addExistingProject.browseTitle'));
      if (!selectedPath) return;

      setImportingExternal(true);
      setExistingError(null);
      const imported = await importExternalProject(selectedPath);

      // Reload list so the imported project appears
      await loadExistingProjects();
      // Auto-select the imported project
      setSelectedExisting(imported.name);
      setExistingBaseBranch(imported.current_branch);
    } catch (e) {
      setExistingError(String(e));
    } finally {
      setImportingExternal(false);
    }
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
        return t('addProject.ghPlaceholder');
      case 'ssh':
        return 'git@github.com:owner/repo.git';
      case 'https':
        return 'https://github.com/owner/repo.git';
    }
  };

  // --- Existing project helpers ---
  const loadExistingProjects = async () => {
    setExistingLoading(true);
    setExistingError(null);
    try {
      const projects = await scanExistingProjects();
      setExistingProjects(projects);
    } catch (e) {
      setExistingError(String(e));
    } finally {
      setExistingLoading(false);
    }
  };

  const handleSelectExisting = (proj: ExistingProjectInfo) => {
    setSelectedExisting(proj.name);
    setExistingBaseBranch(proj.current_branch);
  };

  const handleAddExisting = async () => {
    if (!selectedExisting || !existingBaseBranch) return;
    setAddingExisting(true);
    try {
      await addExistingProject(selectedExisting, existingBaseBranch, existingTestBranch || 'test', existingMergeStrategy);
      onSuccess?.();
      // Reload list so newly-added project shows as "registered"
      setSelectedExisting(null);
      setExistingBaseBranch('');
      setExistingTestBranch('test');
      setExistingMergeStrategy('merge');
      await loadExistingProjects();
    } catch (e) {
      setExistingError(String(e));
    } finally {
      setAddingExisting(false);
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
            {phase === 'form' ? t('addProject.title') : t('addProject.selectLinkedFolders')}
          </DialogTitle>
          <DialogDescription>
            {phase === 'form'
              ? (mode === 'clone' ? t('addProject.cloneDesc') : t('addExistingProject.desc'))
              : t('addProject.selectLinkedFoldersDesc')}
          </DialogDescription>
        </DialogHeader>

        {/* Phase 1: Form */}
        {phase === 'form' && (
          <>
            {/* Tab switching */}
            <div className="px-5 py-3 flex gap-1 justify-center items-center bg-slate-900/50">
              <button
                onClick={() => setMode('clone')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  mode === 'clone'
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {t('addProject.cloneTab', 'Clone')}
              </button>
              <button
                onClick={() => { setMode('existing'); loadExistingProjects(); }}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  mode === 'existing'
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {t('addProject.existingTab', 'Add Existing')}
              </button>
            </div>

            {/* Clone form */}
            {mode === 'clone' && (
              <>
                <div className="p-5 space-y-4 overflow-y-auto">
                  {/* Project Name */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      {t('addProject.projectName')}
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
                      {t('addProject.cloneMethod')}
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
                      {t('addProject.repoUrl')}
                    </label>
                    <Input
                      type="text"
                      value={repoUrl}
                      onChange={(e) => handleRepoUrlChange(e.target.value)}
                      placeholder={getPlaceholder()}
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && repoUrl.trim() && !loading) handleSubmit(); }}
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      {urlFormat === 'gh' && t('addProject.ghShortFormat')}
                      {urlFormat === 'ssh' && t('addProject.sshFormat')}
                      {urlFormat === 'https' && t('addProject.httpsFormat')}
                    </p>
                  </div>

                  {/* Base Branch */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        {t('addProject.baseBranch')}
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
                        {t('addProject.testBranch')}
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
                      {t('addProject.mergeStrategy')}
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

                {loading && (
                  <div className="px-5 pb-1">
                    <div className="flex items-center gap-2 text-xs text-blue-400/80">
                      <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full animate-progress-indeterminate animate-gradient" />
                      </div>
                      <span className="whitespace-nowrap tabular-nums">{t('addProject.cloning')} {formatElapsed(elapsedSeconds)}</span>
                    </div>
                  </div>
                )}
                <DialogFooter className="p-5 border-t border-slate-700">
                  <Button variant="secondary" onClick={() => handleClose(false)} disabled={loading}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={!name.trim() || !repoUrl.trim() || loading}
                  >
                    {loading ? t('addProject.cloning') : t('addProject.cloneProject')}
                  </Button>
                </DialogFooter>
              </>
            )}

            {/* Existing project tab */}
            {mode === 'existing' && (
              <>
                <div className="p-5 space-y-3 overflow-y-auto">
                  {/* Browse external project button */}
                  <button
                    onClick={handleBrowseProject}
                    disabled={importingExternal}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 hover:bg-slate-800/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {importingExternal ? (
                      <>
                        <RefreshIcon className="w-4 h-4 animate-spin" />
                        <span className="text-sm">{t('addExistingProject.importing')}</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1 1.5h6.5c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-11C1.67 13.5 1 12.83 1 12V3.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                        </svg>
                        <span className="text-sm">{t('addExistingProject.browse')}</span>
                      </>
                    )}
                  </button>

                  {existingError && (
                    <div className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg">
                      <div className="text-red-300 text-sm">{existingError}</div>
                    </div>
                  )}

                  {existingLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshIcon className="w-5 h-5 text-blue-400 animate-spin" />
                      <span className="text-slate-400 text-sm ml-2">{t('addExistingProject.scanning')}</span>
                    </div>
                  ) : existingProjects.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-slate-400 text-sm">{t('addExistingProject.noProjects')}</p>
                      <p className="text-slate-500 text-xs mt-1">{t('addExistingProject.noProjectsHint')}</p>
                    </div>
                  ) : (
                    <>
                      <div className="max-h-[240px] overflow-y-auto space-y-1">
                        {existingProjects.map(proj => (
                          <button
                            key={proj.name}
                            onClick={() => !proj.is_registered && handleSelectExisting(proj)}
                            disabled={proj.is_registered}
                            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                              proj.is_registered
                                ? 'border-slate-700/30 bg-slate-800/20 opacity-50 cursor-not-allowed'
                                : selectedExisting === proj.name
                                  ? 'border-blue-500/50 bg-blue-500/10'
                                  : 'border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/60 hover:border-slate-600'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`font-medium truncate ${proj.is_registered ? 'text-slate-500' : 'text-slate-200'}`}>
                                  {proj.name}
                                </span>
                                {proj.is_registered && (
                                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 bg-green-500/15 text-green-400/70 rounded">
                                    {t('addExistingProject.registered', 'Added')}
                                  </span>
                                )}
                              </div>
                              <div className={`flex items-center gap-1.5 text-sm shrink-0 ${proj.is_registered ? 'text-slate-600' : 'text-slate-400'}`}>
                                <GitBranchIcon className="w-3.5 h-3.5" />
                                <span>{proj.current_branch}</span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>

                      {selectedExisting && (
                        <div className="space-y-3 pt-2 border-t border-slate-700/50">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                {t('addExistingProject.baseBranch')}
                              </label>
                              <Input
                                type="text"
                                value={existingBaseBranch}
                                onChange={(e) => setExistingBaseBranch(e.target.value)}
                                placeholder="e.g. uat, main, master"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                {t('addExistingProject.testBranch')}
                              </label>
                              <Input
                                type="text"
                                value={existingTestBranch}
                                onChange={(e) => setExistingTestBranch(e.target.value)}
                                placeholder="e.g. test, develop"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1.5">
                              {t('addProject.mergeStrategy')}
                            </label>
                            <Select value={existingMergeStrategy} onValueChange={setExistingMergeStrategy}>
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
                      )}
                    </>
                  )}
                </div>

                <DialogFooter className="p-5 border-t border-slate-700">
                  <Button variant="secondary" onClick={() => handleClose(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    onClick={handleAddExisting}
                    disabled={!selectedExisting || !existingBaseBranch || addingExisting}
                  >
                    {addingExisting ? t('addExistingProject.adding') : t('addExistingProject.add')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </>
        )}

        {/* Phase 2: Scanning */}
        {phase === 'scanning' && (
          <div className="p-8 flex flex-col items-center justify-center gap-3">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400">{t('addProject.scanning')}</p>
          </div>
        )}

        {/* Phase 3: Results */}
        {phase === 'results' && (
          <>
            <div className="p-5 space-y-4 overflow-y-auto">
              {scanError && (
                <div className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg">
                  <p className="text-sm text-red-300">{t('addProject.scanError', { error: scanError })}</p>
                </div>
              )}

              {scanResults.length === 0 && !scanError && (
                <div className="p-4 bg-slate-800/50 rounded-lg text-center">
                  <p className="text-sm text-slate-400">{t('addProject.noLinkedFoldersFound')}</p>
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
                              {t('addProject.recommended')}
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
                  <div className="text-xs font-medium text-slate-400">{t('addProject.customFolders')}</div>
                  {customSelectedFolders.map(folder => (
                    <div key={folder} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded px-3 py-2">
                      <span className="flex-1 text-sm text-slate-300 font-mono">{folder}</span>
                      <button
                        type="button"
                        onClick={() => toggleFolder(folder)}
                        className="text-slate-500 hover:text-red-400 text-xs"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Custom Folder */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  {t('addProject.addCustomFolder')}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={customFolder}
                    onChange={(e) => setCustomFolder(e.target.value)}
                    placeholder={t('addProject.customFolderPlaceholder')}
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
                    {t('common.add')}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="p-5 border-t border-slate-700">
              <Button variant="secondary" onClick={handleSkip} disabled={savingFolders}>
                {t('addProject.skip')}
              </Button>
              <Button
                onClick={handleSaveFolders}
                disabled={selectedFolders.size === 0 || savingFolders}
              >
                {savingFolders ? t('addProject.savingFolders') : t('addProject.saveLinkedFolders', { count: selectedFolders.size })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
