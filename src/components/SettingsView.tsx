import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { useTranslation } from 'react-i18next';
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
import { RefreshCw, Search, Mic } from 'lucide-react';
import { BackIcon, PlusIcon, TrashIcon } from './Icons';
import { BranchCombobox } from './BranchCombobox';
import type { WorkspaceRef, WorkspaceConfig, ProjectConfig, ScannedFolder } from '../types';
import { getAppVersion, getNgrokToken, setNgrokToken as saveNgrokToken, getDashscopeApiKey, setDashscopeApiKey as saveDashscopeApiKey, getDashscopeBaseUrl, setDashscopeBaseUrl as saveDashscopeBaseUrl, voiceStart, voiceStop, isTauri, getRemoteBranches, openLink } from '../lib/backend';

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
  scanResultsMap?: Record<string, ScannedFolder[]>;
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
  scanResultsMap = {},
  workspaces = [],
  currentWorkspace = null,
  onRemoveWorkspace,
}) => {
  const { t, i18n } = useTranslation();
  const [newLinkedItem, setNewLinkedItem] = useState('');
  const [newProjectLinkedFolder, setNewProjectLinkedFolder] = useState<Record<number, string>>({});
  const [appVersion, setAppVersion] = useState('');
  const [removeConfirmWorkspace, setRemoveConfirmWorkspace] = useState<WorkspaceRef | null>(null);

  // ngrok token state
  const [ngrokToken, setNgrokToken] = useState('');
  const [ngrokTokenLoaded, setNgrokTokenLoaded] = useState(false);
  const [ngrokSaving, setNgrokSaving] = useState(false);
  const [ngrokSaved, setNgrokSaved] = useState(false);
  const [ngrokError, setNgrokError] = useState<string | null>(null);

  // Dashscope API key state
  const [dashscopeKey, setDashscopeKey] = useState('');
  const [dashscopeKeyLoaded, setDashscopeKeyLoaded] = useState(false);
  const [dashscopeSaving, setDashscopeSaving] = useState(false);
  const [dashscopeSaved, setDashscopeSaved] = useState(false);
  const [dashscopeError, setDashscopeError] = useState<string | null>(null);

  // Dashscope base URL state
  const DEFAULT_DASHSCOPE_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';
  const [dashscopeUrl, setDashscopeUrl] = useState('');
  const [dashscopeUrlSaving, setDashscopeUrlSaving] = useState(false);
  const [dashscopeUrlSaved, setDashscopeUrlSaved] = useState(false);
  const [dashscopeUrlError, setDashscopeUrlError] = useState<string | null>(null);

  // Microphone selection state
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState(() =>
    localStorage.getItem('preferred-mic-device-id') || ''
  );

  // Microphone test state
  const [micTesting, setMicTesting] = useState(false);
  const [micVolume, setMicVolume] = useState(0);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestAudioCtxRef = useRef<AudioContext | null>(null);
  const micTestAnimRef = useRef<number>(0);
  const micTestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dashscope connection test state
  const [dashscopeTesting, setDashscopeTesting] = useState(false);
  const [dashscopeTestResult, setDashscopeTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Load microphone devices
  const loadMicDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      // If labels are empty, we need to request permission first
      if (audioInputs.length > 0 && !audioInputs[0].label) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          const devicesWithLabels = await navigator.mediaDevices.enumerateDevices();
          setMicDevices(devicesWithLabels.filter(d => d.kind === 'audioinput'));
        } catch {
          setMicDevices(audioInputs);
        }
      } else {
        setMicDevices(audioInputs);
      }
    } catch {
      setMicDevices([]);
    }
  }, []);

  // Stop microphone test
  const stopMicTest = useCallback(() => {
    if (micTestAnimRef.current) {
      cancelAnimationFrame(micTestAnimRef.current);
      micTestAnimRef.current = 0;
    }
    if (micTestTimerRef.current) {
      clearTimeout(micTestTimerRef.current);
      micTestTimerRef.current = null;
    }
    if (micTestAudioCtxRef.current) {
      micTestAudioCtxRef.current.close().catch(() => {});
      micTestAudioCtxRef.current = null;
    }
    if (micTestStreamRef.current) {
      micTestStreamRef.current.getTracks().forEach(t => t.stop());
      micTestStreamRef.current = null;
    }
    setMicTesting(false);
    setMicVolume(0);
  }, []);

  // Start microphone test
  const startMicTest = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(selectedMicId ? { deviceId: { exact: selectedMicId } } : {}),
        },
      });
      micTestStreamRef.current = stream;

      const audioCtx = new AudioContext();
      micTestAudioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.fftSize);
      const updateVolume = () => {
        analyser.getByteTimeDomainData(dataArray);
        // RMS calculation on time-domain data — no FFT smoothing delay
        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / dataArray.length);
        setMicVolume(Math.min(100, Math.round(rms * 400)));
        micTestAnimRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();
      setMicTesting(true);

      // Auto-stop after 10 seconds
      micTestTimerRef.current = setTimeout(stopMicTest, 10000);
    } catch {
      stopMicTest();
    }
  }, [selectedMicId, stopMicTest]);

  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
    if (isTauri()) {
      getNgrokToken().then(token => {
        setNgrokToken(token || '');
        setNgrokTokenLoaded(true);
      }).catch(() => setNgrokTokenLoaded(true));
    }
    // Load Dashscope config in both Tauri and browser modes
    getDashscopeApiKey().then(k => {
      setDashscopeKey(k || '');
      setDashscopeKeyLoaded(true);
    }).catch(() => setDashscopeKeyLoaded(true));
    getDashscopeBaseUrl().then(u => {
      setDashscopeUrl(u || '');
    }).catch(() => {});
    loadMicDevices();
  }, [loadMicDevices]);

  // Validate stored deviceId against available devices
  useEffect(() => {
    if (micDevices.length > 0 && selectedMicId) {
      const exists = micDevices.some(d => d.deviceId === selectedMicId);
      if (!exists) {
        setSelectedMicId('');
        localStorage.removeItem('preferred-mic-device-id');
      }
    }
  }, [micDevices, selectedMicId]);

  // Cleanup mic test on unmount
  useEffect(() => stopMicTest, [stopMicTest]);
  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm py-3 -mx-4 px-4 border-b border-slate-700/30">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label={t('settings.backLabel')}
          >
            <BackIcon className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-semibold">{t('settings.workspaceSettings')}</h1>
        </div>
        <Button
          onClick={onSave}
          disabled={saving}
        >
          {saving ? t('common.saving') : t('settings.saveConfig')}
        </Button>
      </div>

      {/* Section Navigation */}
      <div className="sticky top-14 z-[9] bg-slate-900/95 backdrop-blur-sm py-2 -mx-4 px-4 mb-4 border-b border-slate-700/30 flex items-center gap-1.5 overflow-x-auto">
        {[
          { id: 'settings-workspace', label: t('settings.workspaceConfig') },
          { id: 'settings-management', label: t('settings.management') },
          { id: 'settings-projects', label: t('settings.projectsNav') },
          ...(isTauri() ? [{ id: 'settings-ngrok', label: 'ngrok' }] : []),
          { id: 'settings-voice', label: t('settings.voiceNav') },
          { id: 'settings-about', label: t('settings.about') },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}
            className="px-3 py-1 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-700/50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-800/50 rounded-lg">
          <div className="text-red-300 text-sm select-text">{error}</div>
          <Button variant="link" size="sm" onClick={onClearError} className="text-red-400 hover:text-red-200 mt-1 p-0 h-auto">{t('common.close')}</Button>
        </div>
      )}

      {/* Config Path Info */}
      <div className="mb-6 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <div className="text-xs text-slate-500">{t('settings.configFilePath')}</div>
        <div className="text-sm text-slate-300 mt-1 font-mono select-text">{configPath}</div>
      </div>

      {/* Workspace Settings */}
      <div className="mb-8">
        <h2 id="settings-workspace" className="text-lg font-medium mb-4 scroll-mt-32">{t('settings.workspaceConfig')}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">{t('settings.workspaceName')}</label>
            <Input
              type="text"
              value={config.name}
              onChange={(e) => onUpdateField('name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">{t('settings.worktreesDirLabel')}</label>
            <Input
              type="text"
              value={config.worktrees_dir}
              onChange={(e) => onUpdateField('worktrees_dir', e.target.value)}
            />
          </div>

          {/* Linked Workspace Items */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">{t('settings.linkedWorktreeItems')}</label>
            <div className="space-y-2">
              {config.linked_workspace_items.map((item, index) => (
                <div key={index} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded px-3 py-2">
                  <span className="flex-1 text-sm text-slate-300 select-text">{item}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveLinkedItem(index)}
                    className="text-slate-500 hover:text-red-400 text-xs transition-colors"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                type="text"
                value={newLinkedItem}
                onChange={(e) => setNewLinkedItem(e.target.value)}
                placeholder={t('settings.linkedPlaceholder')}
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
                {t('common.add')}
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {t('settings.linkedWorktreeItemsHint')}
            </p>
          </div>
        </div>
      </div>

      {/* Workspace Management */}
      {workspaces.length > 0 && onRemoveWorkspace && (
        <div className="mb-8">
          <h2 id="settings-management" className="text-lg font-medium mb-4 scroll-mt-32">{t('settings.workspaceManagement')}</h2>
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
                      <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">{t('settings.current')}</span>
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
                    title={t('settings.removeWorkspace')}
                    aria-label={t('settings.removeWorkspaceLabel', { name: ws.name })}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {t('settings.workspaceManagementHint')}
          </p>
        </div>
      )}

      {/* Projects */}
      <div className="pt-6 border-t border-slate-700/50">
        <div className="flex items-center justify-between mb-4">
          <h2 id="settings-projects" className="text-lg font-medium scroll-mt-32">{t('settings.projectConfig')}</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={onAddProject}
          >
            <PlusIcon className="w-4 h-4" />
            {t('settings.addProject')}
          </Button>
        </div>

        <div className="space-y-3">
          {config.projects.map((proj, index) => (
            <div key={index} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-6 h-6 rounded-md bg-slate-700/50 flex items-center justify-center shrink-0 mt-5">
                  <span className="text-xs font-mono text-slate-400">{index + 1}</span>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('settings.projectName')}</label>
                    <Input
                      type="text"
                      value={proj.name}
                      onChange={(e) => onUpdateProject(index, 'name', e.target.value)}
                      placeholder="project-name"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('settings.baseBranchLabel')}</label>
                    <BranchCombobox
                      value={proj.base_branch}
                      onChange={(value) => onUpdateProject(index, 'base_branch', value)}
                      onLoadBranches={async () => {
                        const projectPath = `${configPath.replace('/.worktree-manager.json', '')}/projects/${proj.name}`;
                        return await getRemoteBranches(projectPath);
                      }}
                      placeholder="main"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('settings.testBranchLabel')}</label>
                    <BranchCombobox
                      value={proj.test_branch}
                      onChange={(value) => onUpdateProject(index, 'test_branch', value)}
                      onLoadBranches={async () => {
                        const projectPath = `${configPath.replace('/.worktree-manager.json', '')}/projects/${proj.name}`;
                        return await getRemoteBranches(projectPath);
                      }}
                      placeholder="test"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('settings.mergeStrategyLabel')}</label>
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
                  title={t('settings.deleteProject')}
                  aria-label={t('settings.deleteProjectLabel', { name: proj.name || '' })}
                >
                  <TrashIcon className="w-4 h-4" />
                </Button>
              </div>
              {/* Linked Folders */}
              <div className="border-t border-slate-700/50 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs text-slate-500">{t('settings.linkedFoldersLabel')}</label>
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
                          {t('settings.scanning')}
                        </>
                      ) : (
                        <>
                          <Search className="w-3 h-3" />
                          {t('settings.scan')}
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {/* Scan Results Panel */}
                {proj.name && (scanResultsMap[proj.name]?.length ?? 0) > 0 && scanningProject !== proj.name && (() => {
                  const projScanResults = scanResultsMap[proj.name] || [];
                  const existingFolders = new Set(proj.linked_folders || []);
                  const filteredResults = projScanResults.filter(r => !existingFolders.has(r.relative_path));
                  if (filteredResults.length === 0) return null;
                  return (
                    <div className="mb-2 p-2 bg-blue-900/20 border border-blue-800/30 rounded-lg">
                      <div className="text-[10px] font-medium text-blue-400 mb-1.5">{t('settings.scanResult')}</div>
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
                          className="text-slate-500 hover:text-red-400 text-xs ml-2 transition-colors"
                        >
                          {t('common.delete')}
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
                    placeholder={t('settings.linkedFolderPlaceholder')}
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
                    {t('common.add')}
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
          <h2 id="settings-ngrok" className="text-lg font-medium mb-4 scroll-mt-32">{t('settings.ngrokTitle')}</h2>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">{t('settings.ngrokAuthtokenLabel')}</label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={ngrokToken}
                  onChange={(e) => { setNgrokToken(e.target.value); setNgrokSaved(false); }}
                  placeholder={t('settings.ngrokAuthtokenPlaceholder')}
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={ngrokSaving}
                  onClick={async () => {
                    setNgrokSaving(true);
                    setNgrokError(null);
                    try {
                      await saveNgrokToken(ngrokToken.trim());
                      setNgrokSaved(true);
                      setTimeout(() => setNgrokSaved(false), 2000);
                    } catch (e) {
                      setNgrokError(String(e));
                    } finally {
                      setNgrokSaving(false);
                    }
                  }}
                >
                  {ngrokSaving ? t('common.saving') : ngrokSaved ? t('settings.savedSuccess') : t('common.save')}
                </Button>
              </div>
              {ngrokError && (
                <p className="text-sm text-red-400 mt-1">{ngrokError}</p>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {t('settings.ngrokHint')}
              <button
                type="button"
                className="text-blue-400 hover:text-blue-300 ml-1 underline cursor-pointer transition-colors"
                onClick={() => openLink('https://dashboard.ngrok.com/get-started/your-authtoken')}
              >
                {t('settings.ngrokGetToken')}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* Dashscope Voice Recognition Config */}
      {dashscopeKeyLoaded && (
        <div className="mt-8 pt-8 border-t border-slate-700/50">
          <h2 id="settings-voice" className="text-lg font-medium mb-4 scroll-mt-32">{t('settings.voiceTitle')}</h2>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
            {/* Microphone Selection */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">{t('settings.micDevice')}</label>
              <div className="flex gap-2">
                <Select
                  value={selectedMicId || '__default__'}
                  onValueChange={(value) => {
                    const id = value === '__default__' ? '' : value;
                    setSelectedMicId(id);
                    if (id) {
                      localStorage.setItem('preferred-mic-device-id', id);
                    } else {
                      localStorage.removeItem('preferred-mic-device-id');
                    }
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">{t('settings.defaultDevice')}</SelectItem>
                    {micDevices.map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || t('settings.micLabel', { id: device.deviceId.slice(0, 8) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (micTesting) {
                      stopMicTest();
                    } else {
                      startMicTest();
                    }
                  }}
                >
                  <Mic className="w-4 h-4" />
                  {micTesting ? t('settings.stopTest') : t('settings.test')}
                </Button>
              </div>
              {/* Volume Bar */}
              {micTesting && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-slate-500 shrink-0">{t('settings.volume')}</span>
                  <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${micVolume}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">{t('settings.dashscopeKeyLabel')}</label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={dashscopeKey}
                  onChange={(e) => { setDashscopeKey(e.target.value); setDashscopeSaved(false); }}
                  placeholder={t('settings.dashscopeKeyPlaceholder')}
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={dashscopeSaving}
                  onClick={async () => {
                    setDashscopeSaving(true);
                    setDashscopeError(null);
                    try {
                      await saveDashscopeApiKey(dashscopeKey.trim());
                      setDashscopeSaved(true);
                      setTimeout(() => setDashscopeSaved(false), 2000);
                    } catch (e) {
                      setDashscopeError(String(e));
                    } finally {
                      setDashscopeSaving(false);
                    }
                  }}
                >
                  {dashscopeSaving ? t('common.saving') : dashscopeSaved ? t('settings.savedSuccess') : t('common.save')}
                </Button>
              </div>
              {dashscopeError && (
                <p className="text-sm text-red-400 mt-1">{dashscopeError}</p>
              )}
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">{t('settings.wsAddressLabel')}</label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={dashscopeUrl}
                  onChange={(e) => { setDashscopeUrl(e.target.value); setDashscopeUrlSaved(false); }}
                  placeholder={DEFAULT_DASHSCOPE_URL}
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={dashscopeUrlSaving}
                  onClick={async () => {
                    setDashscopeUrlSaving(true);
                    setDashscopeUrlError(null);
                    try {
                      await saveDashscopeBaseUrl(dashscopeUrl.trim());
                      setDashscopeUrlSaved(true);
                      setTimeout(() => setDashscopeUrlSaved(false), 2000);
                    } catch (e) {
                      setDashscopeUrlError(String(e));
                    } finally {
                      setDashscopeUrlSaving(false);
                    }
                  }}
                >
                  {dashscopeUrlSaving ? t('common.saving') : dashscopeUrlSaved ? t('settings.savedSuccess') : t('common.save')}
                </Button>
                {dashscopeUrl && dashscopeUrl !== DEFAULT_DASHSCOPE_URL && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      setDashscopeUrl('');
                      setDashscopeUrlError(null);
                      try {
                        await saveDashscopeBaseUrl('');
                        setDashscopeUrlSaved(true);
                        setTimeout(() => setDashscopeUrlSaved(false), 2000);
                      } catch (e) {
                        setDashscopeUrlError(String(e));
                      }
                    }}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    {t('settings.restoreDefault')}
                  </Button>
                )}
              </div>
              {dashscopeUrlError && (
                <p className="text-sm text-red-400 mt-1">{dashscopeUrlError}</p>
              )}
              <p className="text-xs text-slate-500 mt-1">
                {t('settings.wsAddressHint', { url: DEFAULT_DASHSCOPE_URL })}
              </p>
            </div>
            {/* Dashscope Connection Test */}
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={dashscopeTesting || !dashscopeKey.trim()}
                onClick={async () => {
                  setDashscopeTesting(true);
                  setDashscopeTestResult(null);
                  try {
                    // Save current key & url before testing
                    await saveDashscopeApiKey(dashscopeKey.trim());
                    if (dashscopeUrl.trim()) {
                      await saveDashscopeBaseUrl(dashscopeUrl.trim());
                    }
                    await voiceStart(16000);
                    await voiceStop();
                    setDashscopeTestResult({ ok: true, message: t('settings.connectionSuccess') });
                  } catch (e) {
                    setDashscopeTestResult({ ok: false, message: String(e) });
                  } finally {
                    setDashscopeTesting(false);
                    setTimeout(() => setDashscopeTestResult(null), 4000);
                  }
                }}
              >
                {dashscopeTesting ? (
                  <>
                    <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                    {t('settings.testing')}
                  </>
                ) : t('settings.testConnection')}
              </Button>
              {dashscopeTestResult && (
                <span className={`text-sm ${dashscopeTestResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {dashscopeTestResult.message}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {t('settings.voiceHint')}
              <button
                type="button"
                className="text-blue-400 hover:text-blue-300 ml-1 underline cursor-pointer transition-colors"
                onClick={() => openLink('https://dashscope.console.aliyun.com/apiKey')}
              >
                {t('settings.getApiKey')}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* About Section */}
      <div className="mt-8 pt-8 border-t border-slate-700/50">
        <h2 id="settings-about" className="text-lg font-medium mb-4 scroll-mt-32">{t('settings.aboutTitle')}</h2>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
          <div className="flex items-center gap-4 mb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-100">Worktree Manager</h3>
              <p className="text-xs text-slate-400 mt-0.5 select-text">{t('settings.versionLabel', { version: appVersion })}</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">{t('settings.appDescription')}</p>
          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-1">{t('settings.language')}</label>
            <Select
              value={i18n.language}
              onValueChange={(lng) => {
                i18n.changeLanguage(lng);
                localStorage.setItem('i18n-lang', lng);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">中文</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {onCheckUpdate && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onCheckUpdate}
              disabled={checkingUpdate}
            >
              <RefreshCw className={`w-4 h-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
              {checkingUpdate ? t('settings.checkingUpdate') : t('settings.checkUpdate')}
            </Button>
          )}
        </div>
      </div>

      {/* Remove Workspace Confirmation Dialog */}
      <Dialog open={!!removeConfirmWorkspace} onOpenChange={(open) => !open && setRemoveConfirmWorkspace(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('settings.removeWorkspaceTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.removeWorkspaceDesc', { name: removeConfirmWorkspace?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoveConfirmWorkspace(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="warning" onClick={() => {
              if (removeConfirmWorkspace && onRemoveWorkspace) {
                onRemoveWorkspace(removeConfirmWorkspace.path);
                setRemoveConfirmWorkspace(null);
              }
            }}>
              {t('settings.confirmRemove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
