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
import { RefreshCw, Search, Mic, Eye, EyeOff, Settings, Globe, Info, Trash2 } from 'lucide-react';
import { BackIcon, PlusIcon, TrashIcon } from './Icons';
import { BranchCombobox } from './BranchCombobox';
import type { WorkspaceRef, WorkspaceConfig, ProjectConfig, ScannedFolder } from '../types';
import { getAppVersion, getNgrokToken, setNgrokToken as saveNgrokToken, getDashscopeApiKey, setDashscopeApiKey as saveDashscopeApiKey, getDashscopeBaseUrl, setDashscopeBaseUrl as saveDashscopeBaseUrl, getVoiceRefineEnabled, setVoiceRefineEnabled as saveVoiceRefineEnabled, voiceStart, voiceStop, isTauri, getRemoteBranches, openLink, callBackend, loadWorkspaceConfigByPath, saveWorkspaceConfigByPath } from '../lib/backend';

interface SettingsViewProps {
  workspaceConfig: WorkspaceConfig;
  configPath: string;
  error: string | null;
  onBack: () => void;
  onSaveConfig: (config: WorkspaceConfig) => Promise<void>;
  onClearError: () => void;
  onCheckUpdate?: () => void;
  checkingUpdate?: boolean;
  workspaces?: WorkspaceRef[];
  currentWorkspace?: WorkspaceRef | null;
  onRemoveWorkspace?: (path: string) => void;
}

type SettingsSection = 'workspaces' | 'share' | 'voice' | 'about';

export const SettingsView: FC<SettingsViewProps> = ({
  workspaceConfig,
  configPath,
  error,
  onBack,
  onSaveConfig,
  onClearError,
  onCheckUpdate,
  checkingUpdate = false,
  workspaces = [],
  currentWorkspace = null,
  onRemoveWorkspace,
}) => {
  const { t, i18n } = useTranslation();

  // Section navigation
  const [activeSection, setActiveSection] = useState<SettingsSection>('workspaces');

  // ==================== Workspace editing state ====================
  // Which workspace is selected for editing (defaults to current)
  const [selectedWsPath, setSelectedWsPath] = useState<string>(currentWorkspace?.path || workspaces[0]?.path || '');
  const isCurrentWs = selectedWsPath === currentWorkspace?.path;

  // The config being edited
  const [config, setConfig] = useState<WorkspaceConfig>(() => JSON.parse(JSON.stringify(workspaceConfig)));
  const [saving, setSaving] = useState(false);
  const [scanningProject, setScanningProject] = useState<string | null>(null);
  const [scanResultsMap, setScanResultsMap] = useState<Record<string, ScannedFolder[]>>({});

  // Project view mode: form or json
  const [projectViewMode, setProjectViewMode] = useState<'form' | 'json'>('form');
  const [projectJsonText, setProjectJsonText] = useState('');
  const [projectJsonError, setProjectJsonError] = useState<string | null>(null);

  // Load config when switching workspace
  useEffect(() => {
    if (isCurrentWs) {
      setConfig(JSON.parse(JSON.stringify(workspaceConfig)));
    } else if (selectedWsPath) {
      loadWorkspaceConfigByPath(selectedWsPath).then(cfg => {
        setConfig(JSON.parse(JSON.stringify(cfg)));
      }).catch(() => { });
    }
    setScanResultsMap({});
    setProjectViewMode('form');
  }, [selectedWsPath, isCurrentWs, workspaceConfig]);

  // Sync project JSON when switching to json mode
  useEffect(() => {
    if (projectViewMode === 'json') {
      setProjectJsonText(JSON.stringify(config.projects, null, 2));
      setProjectJsonError(null);
    }
  }, [projectViewMode, config.projects]);

  // Also sync when source config changes
  useEffect(() => {
    if (isCurrentWs) {
      setConfig(JSON.parse(JSON.stringify(workspaceConfig)));
    }
  }, [workspaceConfig, isCurrentWs]);

  // ==================== Config update helpers ====================
  const updateField = useCallback((field: 'name' | 'worktrees_dir', value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  }, []);

  const updateProject = useCallback((index: number, field: keyof ProjectConfig, value: string | boolean | string[]) => {
    setConfig(prev => {
      const newProjects = [...prev.projects];
      newProjects[index] = { ...newProjects[index], [field]: value };
      return { ...prev, projects: newProjects };
    });
  }, []);

  const addNewProject = useCallback(() => {
    setConfig(prev => ({
      ...prev,
      projects: [
        ...prev.projects,
        { name: '', base_branch: 'uat', test_branch: 'test', merge_strategy: 'merge', linked_folders: [] },
      ],
    }));
  }, []);

  const removeProject = useCallback((index: number) => {
    setConfig(prev => ({
      ...prev,
      projects: prev.projects.filter((_, i) => i !== index),
    }));
  }, []);

  const addLinkedItem = useCallback((item: string) => {
    setConfig(prev => ({
      ...prev,
      linked_workspace_items: [...prev.linked_workspace_items, item],
    }));
  }, []);

  const removeLinkedItem = useCallback((index: number) => {
    setConfig(prev => ({
      ...prev,
      linked_workspace_items: prev.linked_workspace_items.filter((_, i) => i !== index),
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (isCurrentWs) {
        await onSaveConfig(config);
      } else {
        await saveWorkspaceConfigByPath(selectedWsPath, config);
      }
    } finally {
      setSaving(false);
    }
  }, [config, isCurrentWs, onSaveConfig, selectedWsPath]);

  const handleScanProject = useCallback(async (projectName: string) => {
    setScanningProject(projectName);
    setScanResultsMap(prev => ({ ...prev, [projectName]: [] }));
    try {
      const wsPath = selectedWsPath || configPath.replace('/.worktree-manager.json', '');
      const projectPath = `${wsPath}/projects/${projectName}`;
      const results = await callBackend('scan_linked_folders', { projectPath }) as ScannedFolder[];
      setScanResultsMap(prev => ({ ...prev, [projectName]: results }));
    } catch {
      // silently fail
    } finally {
      setScanningProject(null);
    }
  }, [selectedWsPath, configPath]);

  const handleApplyProjectJson = useCallback(() => {
    try {
      const parsed = JSON.parse(projectJsonText) as ProjectConfig[];
      if (!Array.isArray(parsed)) {
        setProjectJsonError('JSON 必须是数组');
        return;
      }
      setConfig(prev => ({ ...prev, projects: parsed }));
      setProjectJsonError(null);
    } catch (e) {
      setProjectJsonError(`JSON 格式错误: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectJsonText]);

  // ==================== Other state ====================
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

  // Voice refine toggle
  const [voiceRefineEnabled, setVoiceRefineEnabled] = useState(true);
  const [voiceRefineLoaded, setVoiceRefineLoaded] = useState(false);

  // Microphone
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState(() =>
    localStorage.getItem('preferred-mic-device-id') || ''
  );
  const [micTesting, setMicTesting] = useState(false);
  const [micVolume, setMicVolume] = useState(0);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestAudioCtxRef = useRef<AudioContext | null>(null);
  const micTestAnimRef = useRef<number>(0);
  const micTestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showNgrokToken, setShowNgrokToken] = useState(false);
  const [showDashscopeKey, setShowDashscopeKey] = useState(false);

  // Dashscope connection test
  const [dashscopeTesting, setDashscopeTesting] = useState(false);
  const [dashscopeTestResult, setDashscopeTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Load mic devices
  const loadMicDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      if (audioInputs.length > 0 && !audioInputs[0].label) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          const devicesAfter = await navigator.mediaDevices.enumerateDevices();
          setMicDevices(devicesAfter.filter(d => d.kind === 'audioinput'));
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

  const stopMicTest = useCallback(() => {
    if (micTestAnimRef.current) cancelAnimationFrame(micTestAnimRef.current);
    if (micTestTimerRef.current) clearTimeout(micTestTimerRef.current);
    micTestStreamRef.current?.getTracks().forEach(t => t.stop());
    micTestAudioCtxRef.current?.close();
    micTestStreamRef.current = null;
    micTestAudioCtxRef.current = null;
    setMicTesting(false);
    setMicVolume(0);
  }, []);

  const startMicTest = useCallback(async () => {
    stopMicTest();
    try {
      const constraints: MediaStreamConstraints = { audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micTestStreamRef.current = stream;
      const audioCtx = new AudioContext();
      micTestAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      setMicTesting(true);
      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setMicVolume(Math.min(100, Math.round(avg / 1.28)));
        micTestAnimRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();
      micTestTimerRef.current = setTimeout(stopMicTest, 10000);
    } catch { stopMicTest(); }
  }, [selectedMicId, stopMicTest]);

  // Init loaders
  useEffect(() => {
    loadMicDevices();
    getAppVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
    if (isTauri()) {
      getNgrokToken().then(token => {
        setNgrokToken(token || '');
        setNgrokTokenLoaded(true);
      }).catch(() => setNgrokTokenLoaded(true));
    }
    getDashscopeApiKey().then(k => {
      setDashscopeKey(k || '');
      setDashscopeKeyLoaded(true);
    }).catch(() => setDashscopeKeyLoaded(true));
    getDashscopeBaseUrl().then(u => {
      setDashscopeUrl(u || '');
    }).catch(() => { });
    getVoiceRefineEnabled().then(v => {
      setVoiceRefineEnabled(v);
      setVoiceRefineLoaded(true);
    }).catch(() => setVoiceRefineLoaded(true));
  }, [loadMicDevices]);

  // Auto-select first mic if saved device not found
  useEffect(() => {
    if (selectedMicId && micDevices.length > 0 && !micDevices.some(d => d.deviceId === selectedMicId)) {
      setSelectedMicId('');
      localStorage.removeItem('preferred-mic-device-id');
    }
  }, [micDevices, selectedMicId]);

  // Cleanup mic test on unmount
  useEffect(() => stopMicTest, [stopMicTest]);

  // ==================== Menu items ====================
  const menuItems = [
    { id: 'workspaces' as SettingsSection, label: t('settings.workspaceConfig'), icon: <Settings className="w-3.5 h-3.5" /> },
    ...(isTauri() ? [{ id: 'share' as SettingsSection, label: t('settings.externalShareNav', '外网分享'), icon: <Globe className="w-3.5 h-3.5" /> }] : []),
    { id: 'voice' as SettingsSection, label: t('settings.voiceNav'), icon: <Mic className="w-3.5 h-3.5" /> },
    { id: 'about' as SettingsSection, label: t('settings.about'), icon: <Info className="w-3.5 h-3.5" /> },
  ];

  // ==================== Render ====================
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/50 shrink-0 bg-slate-900/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('settings.backLabel')}>
            <BackIcon className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold">{t('settings.workspaceSettings')}</h1>
        </div>
        {activeSection === 'workspaces' && (
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? t('common.saving') : t('settings.saveConfig')}
          </Button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 p-3 bg-red-900/30 border border-red-800/50 rounded-lg shrink-0">
          <div className="text-red-300 text-sm select-text">{error}</div>
          <Button variant="link" size="sm" onClick={onClearError} className="text-red-400 hover:text-red-200 mt-1 p-0 h-auto">{t('common.close')}</Button>
        </div>
      )}

      {/* Main: left menu + right content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <div className="w-36 shrink-0 border-r border-slate-700/50 py-2 overflow-y-auto">
          <nav className="space-y-0.5 px-2">
            {menuItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors text-left ${activeSection === item.id
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Right content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto">

            {/* ==================== Workspaces Section ==================== */}
            {activeSection === 'workspaces' && (
              <div className="space-y-6">
                {/* Horizontal workspace tabs */}
                {workspaces.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {workspaces.map(ws => (
                      <button
                        key={ws.path}
                        onClick={() => setSelectedWsPath(ws.path)}
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${selectedWsPath === ws.path
                            ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                            : 'text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-700/50 border border-transparent'
                          }`}
                      >
                        <span>{ws.name}</span>
                        {currentWorkspace?.path === ws.path && (
                          <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded">{t('settings.current')}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Workspace Config */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-4">
                  <h3 className="text-sm font-medium text-slate-300">{t('settings.workspaceConfig')}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">{t('settings.workspaceName')}</label>
                      <Input type="text" value={config.name} onChange={(e) => updateField('name', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">{t('settings.worktreesDirLabel')}</label>
                      <Input type="text" value={config.worktrees_dir} onChange={(e) => updateField('worktrees_dir', e.target.value)} className="h-8 text-sm" />
                    </div>
                  </div>
                  {/* Linked Workspace Items */}
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">{t('settings.linkedWorktreeItems')}</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {config.linked_workspace_items.map((item, index) => (
                        <span key={index} className="inline-flex items-center gap-1 bg-slate-700/50 border border-slate-600/50 rounded px-2 py-0.5 text-xs text-slate-300">
                          {item}
                          <button type="button" onClick={() => removeLinkedItem(index)} className="text-slate-500 hover:text-red-400 transition-colors ml-0.5">&times;</button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input type="text" value={newLinkedItem} onChange={(e) => setNewLinkedItem(e.target.value)}
                        placeholder={t('settings.linkedPlaceholder')} className="h-7 text-xs"
                        onKeyDown={(e) => { if (e.key === 'Enter' && newLinkedItem.trim()) { e.preventDefault(); addLinkedItem(newLinkedItem.trim()); setNewLinkedItem(''); } }}
                      />
                      <Button type="button" variant="secondary" size="sm" className="h-7 text-xs"
                        onClick={() => { if (newLinkedItem.trim()) { addLinkedItem(newLinkedItem.trim()); setNewLinkedItem(''); } }}
                        disabled={!newLinkedItem.trim()}
                      >{t('common.add')}</Button>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1">{t('settings.linkedWorktreeItemsHint')}</p>
                  </div>
                </div>

                {/* Projects Config */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-slate-300">{t('settings.projectConfig')}</h3>
                    <div className="flex items-center gap-2">
                      {/* Form/JSON toggle */}
                      <div className="flex bg-slate-700/50 rounded-md p-0.5">
                        <button
                          onClick={() => setProjectViewMode('form')}
                          className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${projectViewMode === 'form' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
                        >{t('settings.formView', '表单')}</button>
                        <button
                          onClick={() => setProjectViewMode('json')}
                          className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${projectViewMode === 'json' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
                        >JSON</button>
                      </div>
                      {projectViewMode === 'form' && (
                        <Button variant="secondary" size="sm" className="h-6 text-xs" onClick={addNewProject}>
                          <PlusIcon className="w-3 h-3" />
                          {t('settings.addProject')}
                        </Button>
                      )}
                      {projectViewMode === 'json' && (
                        <Button variant="secondary" size="sm" className="h-6 text-xs" onClick={handleApplyProjectJson}>
                          {t('settings.applyJson', '应用')}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* JSON view */}
                  {projectViewMode === 'json' && (
                    <div>
                      {projectJsonError && (
                        <div className="mb-2 p-2 bg-red-900/30 border border-red-800/50 rounded text-xs text-red-300">{projectJsonError}</div>
                      )}
                      <textarea
                        value={projectJsonText}
                        onChange={(e) => { setProjectJsonText(e.target.value); setProjectJsonError(null); }}
                        className="w-full h-64 bg-slate-950 border border-slate-700/50 rounded-lg p-3 font-mono text-xs text-slate-300 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50 leading-relaxed"
                        spellCheck={false}
                      />
                    </div>
                  )}

                  {/* Form view */}
                  {projectViewMode === 'form' && (
                    <div className="space-y-3">
                      {config.projects.map((proj, index) => (
                        <div key={index} className="bg-slate-900/50 border border-slate-700/30 rounded-lg p-3">
                          <div className="flex items-start gap-3 mb-2">
                            <div className="w-5 h-5 rounded bg-slate-700/50 flex items-center justify-center shrink-0 mt-4">
                              <span className="text-[10px] font-mono text-slate-500">{index + 1}</span>
                            </div>
                            <div className="flex-1 grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] text-slate-600 mb-0.5">{t('settings.projectName')}</label>
                                <Input type="text" value={proj.name} onChange={(e) => updateProject(index, 'name', e.target.value)} placeholder="project-name" className="h-7 text-xs" />
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-600 mb-0.5">{t('settings.baseBranchLabel')}</label>
                                <BranchCombobox
                                  value={proj.base_branch} onChange={(value) => updateProject(index, 'base_branch', value)}
                                  onLoadBranches={async () => { const wsPath = selectedWsPath || configPath.replace('/.worktree-manager.json', ''); return await getRemoteBranches(`${wsPath}/projects/${proj.name}`); }}
                                  placeholder="main"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-600 mb-0.5">{t('settings.testBranchLabel')}</label>
                                <BranchCombobox
                                  value={proj.test_branch} onChange={(value) => updateProject(index, 'test_branch', value)}
                                  onLoadBranches={async () => { const wsPath = selectedWsPath || configPath.replace('/.worktree-manager.json', ''); return await getRemoteBranches(`${wsPath}/projects/${proj.name}`); }}
                                  placeholder="test"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-600 mb-0.5">{t('settings.mergeStrategyLabel')}</label>
                                <Select value={proj.merge_strategy} onValueChange={(value) => updateProject(index, 'merge_strategy', value)}>
                                  <SelectTrigger className="w-full h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="merge">merge</SelectItem>
                                    <SelectItem value="cherry-pick">cherry-pick</SelectItem>
                                    <SelectItem value="rebase">rebase</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => removeProject(index)}
                              className="h-6 w-6 text-red-400/60 hover:text-red-300 hover:bg-red-900/30 shrink-0"
                              title={t('settings.deleteProject')}
                            ><TrashIcon className="w-3.5 h-3.5" /></Button>
                          </div>
                          {/* Linked Folders */}
                          <div className="border-t border-slate-700/30 pt-2 ml-8">
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] text-slate-600">{t('settings.linkedFoldersLabel')}</label>
                              <Button type="button" variant="ghost" size="sm" className="h-5 text-[10px] gap-0.5 text-slate-500 hover:text-slate-300 px-1"
                                onClick={() => handleScanProject(proj.name)} disabled={scanningProject === proj.name || !proj.name}
                              >
                                {scanningProject === proj.name ? (<><div className="w-2.5 h-2.5 border border-blue-500 border-t-transparent rounded-full animate-spin" />{t('settings.scanning')}</>) : (<><Search className="w-2.5 h-2.5" />{t('settings.scan')}</>)}
                              </Button>
                            </div>
                            {/* Scan Results */}
                            {proj.name && (scanResultsMap[proj.name]?.length ?? 0) > 0 && scanningProject !== proj.name && (() => {
                              const projScanResults = scanResultsMap[proj.name] || [];
                              const existingFolders = new Set(proj.linked_folders || []);
                              const filteredResults = projScanResults.filter(r => !existingFolders.has(r.relative_path));
                              if (filteredResults.length === 0) return null;
                              return (
                                <div className="mb-1.5 p-1.5 bg-blue-900/20 border border-blue-800/30 rounded">
                                  <div className="text-[9px] font-medium text-blue-400 mb-1">{t('settings.scanResult')}</div>
                                  <div className="space-y-0.5">
                                    {filteredResults.map(result => (
                                      <button key={result.relative_path} type="button" className="w-full flex items-center justify-between px-1.5 py-0.5 text-left rounded hover:bg-blue-900/30 transition-colors"
                                        onClick={() => { const newFolders = [...(proj.linked_folders || []), result.relative_path]; updateProject(index, 'linked_folders', newFolders); }}
                                      >
                                        <span className="text-[10px] text-slate-300 font-mono">{result.relative_path}</span>
                                        <span className="text-[9px] text-slate-500 ml-2">{result.size_display}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                            {(proj.linked_folders || []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {(proj.linked_folders || []).map((folder, folderIdx) => (
                                  <span key={folderIdx} className="inline-flex items-center gap-0.5 bg-slate-700/50 border border-slate-600/50 rounded px-1.5 py-0.5 text-[10px] text-slate-300">
                                    {folder}
                                    <button type="button" onClick={() => { const nf = [...(proj.linked_folders || [])]; nf.splice(folderIdx, 1); updateProject(index, 'linked_folders', nf); }}
                                      className="text-slate-500 hover:text-red-400 transition-colors">&times;</button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-1.5">
                              <Input type="text" value={newProjectLinkedFolder[index] || ''}
                                onChange={(e) => setNewProjectLinkedFolder(prev => ({ ...prev, [index]: e.target.value }))}
                                placeholder={t('settings.linkedFolderPlaceholder')} className="h-6 text-[10px]"
                                onKeyDown={(e) => { const val = (newProjectLinkedFolder[index] || '').trim(); if (e.key === 'Enter' && val) { e.preventDefault(); const nf = [...(proj.linked_folders || []), val]; updateProject(index, 'linked_folders', nf); setNewProjectLinkedFolder(prev => ({ ...prev, [index]: '' })); } }}
                              />
                              <Button type="button" variant="secondary" size="sm" className="h-6 text-[10px] px-2"
                                onClick={() => { const val = (newProjectLinkedFolder[index] || '').trim(); if (val) { const nf = [...(proj.linked_folders || []), val]; updateProject(index, 'linked_folders', nf); setNewProjectLinkedFolder(prev => ({ ...prev, [index]: '' })); } }}
                                disabled={!(newProjectLinkedFolder[index] || '').trim()}
                              >{t('common.add')}</Button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {config.projects.length === 0 && (
                        <div className="text-center py-6 text-xs text-slate-600">
                          {t('settings.noProjects', '暂无项目配置')}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Delete Workspace */}
                {workspaces.length > 1 && onRemoveWorkspace && (
                  <div className="border-t border-slate-700/30 pt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400/70 hover:text-red-300 hover:bg-red-900/20 text-xs gap-1.5"
                      disabled={isCurrentWs}
                      onClick={() => {
                        const ws = workspaces.find(w => w.path === selectedWsPath);
                        if (ws) setRemoveConfirmWorkspace(ws);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('settings.removeWorkspace', '删除此工作区')}
                    </Button>
                    {isCurrentWs && (
                      <p className="text-[10px] text-slate-600 mt-1">{t('settings.cannotDeleteCurrent', '当前工作区无法删除')}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ==================== External Share (ngrok) ==================== */}
            {activeSection === 'share' && isTauri() && ngrokTokenLoaded && (
              <div>
                <h2 className="text-lg font-medium mb-2">{t('settings.externalShareTitle', '外网分享')}</h2>
                <p className="text-xs text-amber-500/80 mb-4">{t('settings.tokenStorageWarning')}</p>
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-slate-300">{t('settings.ngrokShareSubtitle', 'ngrok 分享')}</h3>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">{t('settings.ngrokAuthtokenLabel')}</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input type={showNgrokToken ? 'text' : 'password'} value={ngrokToken}
                          onChange={(e) => { setNgrokToken(e.target.value); setNgrokSaved(false); }}
                          placeholder={t('settings.ngrokAuthtokenPlaceholder')} className="w-full pr-9"
                        />
                        <button type="button" onClick={() => setShowNgrokToken(v => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                        >{showNgrokToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                      </div>
                      <Button variant="secondary" size="sm" disabled={ngrokSaving}
                        onClick={async () => { setNgrokSaving(true); setNgrokError(null); try { await saveNgrokToken(ngrokToken.trim()); setNgrokSaved(true); setTimeout(() => setNgrokSaved(false), 2000); } catch (e) { setNgrokError(String(e)); } finally { setNgrokSaving(false); } }}
                      >{ngrokSaving ? t('common.saving') : ngrokSaved ? t('settings.savedSuccess') : t('common.save')}</Button>
                    </div>
                    {ngrokError && <p className="text-sm text-red-400 mt-1">{ngrokError}</p>}
                  </div>
                  <p className="text-xs text-slate-500">
                    {t('settings.ngrokHint')}
                    <button type="button" className="text-blue-400 hover:text-blue-300 ml-1 underline cursor-pointer transition-colors"
                      onClick={() => openLink('https://dashboard.ngrok.com/get-started/your-authtoken')}
                    >{t('settings.ngrokGetToken')}</button>
                  </p>
                </div>
              </div>
            )}

            {/* ==================== Voice ==================== */}
            {activeSection === 'voice' && dashscopeKeyLoaded && (
              <div>
                <h2 className="text-lg font-medium mb-4">{t('settings.voiceTitle')}</h2>
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
                  {/* Microphone */}
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">{t('settings.micDevice')}</label>
                    <div className="flex gap-2">
                      <Select value={selectedMicId || '__default__'}
                        onValueChange={(value) => { const id = value === '__default__' ? '' : value; setSelectedMicId(id); if (id) { localStorage.setItem('preferred-mic-device-id', id); } else { localStorage.removeItem('preferred-mic-device-id'); } }}
                      >
                        <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">{t('settings.defaultDevice')}</SelectItem>
                          {micDevices.map((device) => (
                            <SelectItem key={device.deviceId} value={device.deviceId}>{device.label || t('settings.micLabel', { id: device.deviceId.slice(0, 8) })}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="secondary" size="sm" onClick={() => { if (micTesting) { stopMicTest(); } else { startMicTest(); } }}>
                        <Mic className="w-4 h-4" />
                        {micTesting ? t('settings.stopTest') : t('settings.test')}
                      </Button>
                    </div>
                    {micTesting && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-slate-500 shrink-0">{t('settings.volume')}</span>
                        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-green-500 rounded-full" style={{ width: `${micVolume}%` }} /></div>
                      </div>
                    )}
                  </div>
                  {/* Voice Refine Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-slate-400">{t('settings.voiceRefineLabel')}</label>
                      <p className="text-xs text-slate-500">{t('settings.voiceRefineDesc')}</p>
                    </div>
                    <button type="button" onClick={() => { const newVal = !voiceRefineEnabled; setVoiceRefineEnabled(newVal); saveVoiceRefineEnabled(newVal).catch(() => { }); }}
                      disabled={!voiceRefineLoaded}
                      className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${voiceRefineEnabled ? 'bg-blue-500' : 'bg-slate-600'}`}
                    ><span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${voiceRefineEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} /></button>
                  </div>
                  {/* Dashscope API Key */}
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">{t('settings.dashscopeKeyLabel')}</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input type={showDashscopeKey ? 'text' : 'password'} value={dashscopeKey}
                          onChange={(e) => { setDashscopeKey(e.target.value); setDashscopeSaved(false); }}
                          placeholder={t('settings.dashscopeKeyPlaceholder')} className="w-full pr-9"
                        />
                        <button type="button" onClick={() => setShowDashscopeKey(v => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                        >{showDashscopeKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                      </div>
                      <Button variant="secondary" size="sm" disabled={dashscopeSaving}
                        onClick={async () => { setDashscopeSaving(true); setDashscopeError(null); try { await saveDashscopeApiKey(dashscopeKey.trim()); setDashscopeSaved(true); setTimeout(() => setDashscopeSaved(false), 2000); } catch (e) { setDashscopeError(String(e)); } finally { setDashscopeSaving(false); } }}
                      >{dashscopeSaving ? t('common.saving') : dashscopeSaved ? t('settings.savedSuccess') : t('common.save')}</Button>
                    </div>
                    {dashscopeError && <p className="text-sm text-red-400 mt-1">{dashscopeError}</p>}
                  </div>
                  {/* Dashscope Base URL */}
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">{t('settings.wsAddressLabel')}</label>
                    <div className="flex gap-2">
                      <Input type="text" value={dashscopeUrl}
                        onChange={(e) => { setDashscopeUrl(e.target.value); setDashscopeUrlSaved(false); }}
                        placeholder={DEFAULT_DASHSCOPE_URL} className="flex-1"
                      />
                      <Button variant="secondary" size="sm" disabled={dashscopeUrlSaving}
                        onClick={async () => { setDashscopeUrlSaving(true); setDashscopeUrlError(null); try { await saveDashscopeBaseUrl(dashscopeUrl.trim()); setDashscopeUrlSaved(true); setTimeout(() => setDashscopeUrlSaved(false), 2000); } catch (e) { setDashscopeUrlError(String(e)); } finally { setDashscopeUrlSaving(false); } }}
                      >{dashscopeUrlSaving ? t('common.saving') : dashscopeUrlSaved ? t('settings.savedSuccess') : t('common.save')}</Button>
                      {dashscopeUrl && dashscopeUrl !== DEFAULT_DASHSCOPE_URL && (
                        <Button variant="ghost" size="sm"
                          onClick={async () => { setDashscopeUrl(''); setDashscopeUrlError(null); try { await saveDashscopeBaseUrl(''); setDashscopeUrlSaved(true); setTimeout(() => setDashscopeUrlSaved(false), 2000); } catch (e) { setDashscopeUrlError(String(e)); } }}
                          className="text-slate-400 hover:text-slate-200"
                        >{t('settings.restoreDefault')}</Button>
                      )}
                    </div>
                    {dashscopeUrlError && <p className="text-sm text-red-400 mt-1">{dashscopeUrlError}</p>}
                    <p className="text-xs text-slate-500 mt-1">{t('settings.wsAddressHint', { url: DEFAULT_DASHSCOPE_URL })}</p>
                  </div>
                  {/* Connection Test */}
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" size="sm" disabled={dashscopeTesting || !dashscopeKey.trim()}
                      onClick={async () => { setDashscopeTesting(true); setDashscopeTestResult(null); try { await saveDashscopeApiKey(dashscopeKey.trim()); if (dashscopeUrl.trim()) { await saveDashscopeBaseUrl(dashscopeUrl.trim()); } await voiceStart(16000); await voiceStop(); setDashscopeTestResult({ ok: true, message: t('settings.connectionSuccess') }); } catch (e) { setDashscopeTestResult({ ok: false, message: String(e) }); } finally { setDashscopeTesting(false); setTimeout(() => setDashscopeTestResult(null), 4000); } }}
                    >
                      {dashscopeTesting ? (<><div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />{t('settings.testing')}</>) : t('settings.testConnection')}
                    </Button>
                    {dashscopeTestResult && (
                      <span className={`text-sm ${dashscopeTestResult.ok ? 'text-green-400' : 'text-red-400'}`}>{dashscopeTestResult.message}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {t('settings.voiceHint')}
                    <button type="button" className="text-blue-400 hover:text-blue-300 ml-1 underline cursor-pointer transition-colors"
                      onClick={() => openLink('https://dashscope.console.aliyun.com/apiKey')}
                    >{t('settings.getApiKey')}</button>
                  </p>
                </div>
              </div>
            )}

            {/* ==================== About ==================== */}
            {activeSection === 'about' && (
              <div>
                <h2 className="text-lg font-medium mb-4">{t('settings.aboutTitle')}</h2>
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
                    <Select value={i18n.language} onValueChange={(lng) => { i18n.changeLanguage(lng); localStorage.setItem('i18n-lang', lng); }}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zh-CN">中文</SelectItem>
                        <SelectItem value="en-US">English</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {onCheckUpdate && (
                    <Button variant="secondary" size="sm" onClick={onCheckUpdate} disabled={checkingUpdate}>
                      <RefreshCw className={`w-4 h-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
                      {checkingUpdate ? t('settings.checkingUpdate') : t('settings.checkUpdate')}
                    </Button>
                  )}
                </div>
              </div>
            )}

          </div>
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
                // Switch back to current workspace after deletion
                if (currentWorkspace) setSelectedWsPath(currentWorkspace.path);
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
