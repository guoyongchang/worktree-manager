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
import { RefreshCw, Search, Mic, Eye, EyeOff, Settings, Globe, Info, Trash2, Wrench, FolderOpen, Brain, Link2, Folder, FileText, ChevronRight, ChevronDown, Star, Copy, Check } from 'lucide-react';
import { BackIcon, PlusIcon, TrashIcon } from './Icons';
import { BranchCombobox } from './BranchCombobox';
import type { WorkspaceRef, WorkspaceConfig, ProjectConfig, ScannedFolder, VaultStatus, VaultItemChild } from '../types';
import { getAppVersion, getAppIcon, getNgrokToken, setNgrokToken as saveNgrokToken, getDashscopeApiKey, setDashscopeApiKey as saveDashscopeApiKey, getDashscopeBaseUrl, setDashscopeBaseUrl as saveDashscopeBaseUrl, getVoiceRefineEnabled, setVoiceRefineEnabled as saveVoiceRefineEnabled, voiceStart, voiceStop, isTauri, getRemoteBranches, openLink, callBackend, loadWorkspaceConfigByPath, saveWorkspaceConfigByPath, getVaultStatus, vaultLink, listVaultItemChildren, getCommitPrefixConfig, setCommitPrefixConfig, getGitUserGlobalConfig, setGitUserGlobalConfig, getSkipGitHooks, setSkipGitHooks as saveSkipGitHooks, cloudGetStatus, cloudStartPairing, cloudCheckPairingStatus, cloudApprovePairing, cloudRejectPairing, cloudDisconnect } from '../lib/backend';
import type { CloudStatus, PairingStatus } from '../lib/backend';

// ==================== VaultItemTree (recursive) ====================
interface VaultItemTreeProps {
  vaultPath: string;
  relativePath: string;
  itemName: string;
  itemType: 'file' | 'directory';
  depth?: number;
}

const VaultItemTree: FC<VaultItemTreeProps> = ({
  vaultPath,
  relativePath,
  itemName,
  itemType,
  depth = 0,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<VaultItemChild[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooMany, setTooMany] = useState(false);
  const isDir = itemType === 'directory';

  const handleToggle = async () => {
    if (!isDir || tooMany) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (children.length === 0 && !error) {
      setLoading(true);
      try {
        const result = await listVaultItemChildren(vaultPath, relativePath);
        setChildren(result);
        setTooMany(false);
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes('too many') || msg.includes('>99')) {
          setTooMany(true);
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  };

  const indent = depth * 12;

  return (
    <div>
      <div
        className={`flex items-center gap-1 text-xs ${isDir ? 'text-slate-300 cursor-pointer hover:text-slate-100' : 'text-slate-400'}`}
        style={{ paddingLeft: `${indent}px` }}
        onClick={isDir ? handleToggle : undefined}
      >
        {isDir ? (
          <>
            {tooMany ? (
              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
            ) : expanded ? (
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
            )}
            <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          </>
        ) : (
          <>
            <span className="w-3 inline-block" />
            <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          </>
        )}
        <span className={tooMany ? 'text-slate-500' : ''}>
          {itemName}{isDir ? '/' : ''}
        </span>
        {loading && <span className="text-[10px] text-slate-600">{t('common.loading', '...')}</span>}
        {tooMany && (
          <span className="text-[10px] text-amber-500 ml-1">{t('settings.vaultTooManyItems', '99+')}</span>
        )}
      </div>
      {error && (
        <div className="text-[10px] text-red-400 pl-4" style={{ paddingLeft: `${indent + 16}px` }}>
          {error}
        </div>
      )}
      {expanded && !tooMany && (
        <div className="mt-0.5 space-y-0.5">
          {children.map((child) => (
            <VaultItemTree
              key={child.name}
              vaultPath={vaultPath}
              relativePath={`${relativePath}/${child.name}`}
              itemName={child.name}
              itemType={child.item_type}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ==================== CopyableCommand ====================
const CopyableCommand: FC<{ command: string; step: number }> = ({ command, step }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-1.5 group">
      <span className="text-[10px] text-amber-400/60 font-medium shrink-0">{step}.</span>
      <code className="text-[11px] text-slate-300 bg-slate-800 px-2 py-0.5 rounded font-mono select-all break-all flex-1">
        {command}
      </code>
      <button
        type="button"
        className="shrink-0 p-0.5 text-slate-500 hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100"
        onClick={handleCopy}
        title="Copy"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
};

// ==================== MemoryHookGuide ====================
const MemoryHookGuide: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="mt-4 bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <Brain className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-amber-300">
            {t('settings.memoryHookTitle', 'Memory Hook 插件')}
          </h3>
          <p className="text-xs text-slate-400 mt-1 space-y-0.5">
            <span className="block">{t('settings.memoryHookDesc', '安装 Claude Code 插件以增强知识库集成：')}</span>
            <span className="block text-amber-400/70">
              <strong>MemoryInject</strong> — {t('settings.memoryInjectDesc', '会话开始时自动注入知识库上下文')}
            </span>
            <span className="block text-amber-400/70">
              <strong>/memory-sync</strong> — {t('settings.memorySyncDesc', '压缩时临时归档会话记录')}
            </span>
            <span className="block text-amber-400/70">
              <strong>/memory-archive</strong> — {t('settings.memoryArchiveDesc', '需求结束时全局归档到知识库')}
            </span>
          </p>
          <div className="mt-2.5 space-y-1.5">
            <CopyableCommand step={1} command="claude plugin marketplace add guoyongchang/worktree-manager-obsidian-bridge" />
            <CopyableCommand step={2} command="claude plugin install worktree-manager-memory-hook@worktree-manager-obsidian-bridge" />
          </div>
          <button
            type="button"
            className="mt-2.5 text-[11px] text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1"
            onClick={() => openLink('https://github.com/guoyongchang/worktree-manager-obsidian-bridge')}
          >
            GitHub
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== VaultSettingsSection ====================
const VaultSettingsSection: FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showItems, setShowItems] = useState(false);
  const [inputPath, setInputPath] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const s = await getVaultStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleConnect = useCallback(async (selectedPath: string) => {
    if (!selectedPath.trim()) return;
    setError(null);
    setLinking(true);
    try {
      const result = await vaultLink(selectedPath.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setStatus({
          connected: result.connected,
          vault_path: selectedPath.trim(),
          synced_items: result.synced_items,
        });
        setInputPath('');
        if (result.warning) {
          setError(result.warning);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLinking(false);
    }
  }, []);

  const handleSelectFolder = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.vaultSelectTitle', '选择 Vault Workspace 目录'),
      });
      if (selected) {
        await handleConnect(selected as string);
      }
    } catch {
      // Dialog not available (browser mode) — user uses input field instead
    }
  }, [t, handleConnect]);

  const handleRefresh = useCallback(async () => {
    if (!status?.vault_path) return;
    setError(null);
    setLinking(true);
    try {
      const result = await vaultLink(status.vault_path);
      if (result.error) {
        setError(result.error);
      } else {
        setStatus({
          connected: result.connected,
          vault_path: status.vault_path,
          synced_items: result.synced_items,
        });
        if (result.warning) {
          setError(result.warning);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLinking(false);
    }
  }, [status?.vault_path]);

  const handleDisconnect = useCallback(async (keepSymlinks = false) => {
    const msg = keepSymlinks
      ? t('settings.vaultSoftDisconnectConfirm', '断开 Vault 配置但保留本地软链接，确定？')
      : t('settings.vaultDisconnectConfirm', '确定要断开 Vault 吗？这将移除所有软链接。');
    if (!window.confirm(msg)) {
      return;
    }
    setError(null);
    setLinking(true);
    try {
      await vaultLink(null, keepSymlinks);
      setStatus({ connected: false, vault_path: null, synced_items: [] });
    } catch (e) {
      setError(String(e));
    } finally {
      setLinking(false);
    }
  }, [t]);

  if (loading) {
    return <div className="text-xs text-slate-500 py-4">{t('common.loading', '加载中...')}</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-medium mb-4">{t('settings.vaultTitle', 'Vault')}</h2>
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
        {status?.connected ? (
          <>
            {/* Connected state */}
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-sm font-medium text-slate-200">
                {t('settings.vaultConnected', '已挂载')}
              </span>
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">
                {t('settings.vaultPath', '路径')}
              </label>
              <button
                className="text-sm text-slate-300 font-mono break-all text-left hover:text-blue-400 transition-colors flex items-center gap-1"
                onClick={() => {
                  if (status.vault_path) {
                    callBackend('reveal_in_finder', { path: status.vault_path }).catch(() => {});
                  }
                }}
                title={t('settings.vaultOpenPath', '在文件夹中打开')}
              >
                <FolderOpen className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                {status.vault_path}
              </button>
            </div>

            {/* Synced items toggle */}
            <div>
              <button
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                onClick={() => setShowItems(!showItems)}
              >
                <span className="w-3 h-3 inline-flex items-center justify-center text-[10px]">
                  {showItems ? '\u25BC' : '\u25B6'}
                </span>
                {t('settings.vaultSyncedItems', '已同步项')}
                <span className="text-slate-500">({status.synced_items.length})</span>
              </button>
              {showItems && status.vault_path && (
                <div className="mt-2 space-y-0.5 max-h-64 overflow-y-auto pr-1">
                  {status.synced_items.map((item) => (
                    <VaultItemTree
                      key={item.name}
                      vaultPath={status.vault_path!}
                      relativePath={item.name}
                      itemName={item.name}
                      itemType={item.item_type}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button variant="secondary" size="sm" disabled={linking} onClick={handleRefresh}>
                {t('settings.vaultRefresh', '刷新')}
              </Button>
              <Button variant="secondary" size="sm" disabled={linking} onClick={handleSelectFolder}>
                {t('settings.vaultChange', '更换...')}
              </Button>
              <Button
                variant="ghost" size="sm" disabled={linking}
                onClick={() => handleDisconnect(false)}
                className="text-red-400 hover:text-red-300"
              >
                {t('settings.vaultDisconnect', '断开')}
              </Button>
              <Button
                variant="ghost" size="sm" disabled={linking}
                onClick={() => handleDisconnect(true)}
                className="text-orange-400 hover:text-orange-300"
              >
                {t('settings.vaultSoftDisconnect', '断开(保留链接)')}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Not connected state */}
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-500" />
              <span className="text-sm text-slate-400">
                {t('settings.vaultNotConnected', '未挂载')}
              </span>
            </div>

            {/* Folder select button (Tauri) + manual input fallback (browser) */}
            <div className="space-y-2">
              <Button variant="secondary" size="sm" disabled={linking} onClick={handleSelectFolder}>
                {linking ? t('common.loading', '加载中...') : t('settings.vaultSelect', '选择 Vault 目录...')}
              </Button>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  placeholder={t('settings.vaultInputPlaceholder', '或粘贴 Vault 目录路径...')}
                  className="h-8 text-sm flex-1"
                />
                <Button
                  variant="secondary" size="sm"
                  disabled={linking || !inputPath.trim()}
                  onClick={() => handleConnect(inputPath)}
                >
                  {t('settings.vaultConnect', '挂载')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Memory Hook Plugin Guide */}
      <MemoryHookGuide />
    </div>
  );
};

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

type SettingsSection = 'workspaces' | 'vault' | 'tools' | 'share' | 'commit' | 'voice' | 'cloud' | 'about';

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
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);

  // Load vault status
  useEffect(() => {
    getVaultStatus().then(setVaultStatus).catch(() => setVaultStatus(null));
  }, []);

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

  const updateProject = useCallback((index: number, field: keyof ProjectConfig, value: string | boolean | string[] | number | undefined) => {
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

  // Commit prefix & git user state (must be before useCallbacks that reference them)
  const [prefixTemplates, setPrefixTemplates] = useState<string[]>(['[{{worktree-name}}]']);
  const [prefixEnabled, setPrefixEnabled] = useState(true);
  const [defaultPrefixIndex, setDefaultPrefixIndex] = useState(0);
  const [prefixSaving, setPrefixSaving] = useState(false);
  const [globalGitName, setGlobalGitName] = useState('');
  const [globalGitEmail, setGlobalGitEmail] = useState('');
  const [gitUserSaving, setGitUserSaving] = useState(false);
  const [skipGitHooks, setSkipGitHooks] = useState(false);
  const [skipGitHooksLoaded, setSkipGitHooksLoaded] = useState(false);

  const handleSavePrefixConfig = useCallback(async () => {
    setPrefixSaving(true);
    try {
      await setCommitPrefixConfig({
        templates: prefixTemplates.slice(0, 3),
        enabled: prefixEnabled,
        default_index: defaultPrefixIndex,
      });
    } finally {
      setPrefixSaving(false);
    }
  }, [prefixTemplates, prefixEnabled, defaultPrefixIndex]);

  const handleSaveGitUser = useCallback(async () => {
    setGitUserSaving(true);
    try {
      await setGitUserGlobalConfig({
        name: globalGitName.trim() || undefined,
        email: globalGitEmail.trim() || undefined,
      });
    } finally {
      setGitUserSaving(false);
    }
  }, [globalGitName, globalGitEmail]);

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

  // Cloud connection state
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [pairingStatus, setPairingStatus] = useState<PairingStatus | null>(null)
  const pairingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // DEV settings
  const [devConsoleEnabled, setDevConsoleEnabled] = useState(() => localStorage.getItem('dev-console-enabled') === 'true');

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

  // Tools detection state
  interface DetectedTool { id: string; name: string; path: string; icon?: string }
  interface DetectedToolsResult { git: DetectedTool[]; terminals: DetectedTool[]; editors: DetectedTool[]; shells: DetectedTool[] }
  const [detectedTools, setDetectedTools] = useState<DetectedToolsResult | null>(() => {
    try {
      const editors: DetectedTool[] = JSON.parse(localStorage.getItem('detected_editors') || '[]');
      const terminals: DetectedTool[] = JSON.parse(localStorage.getItem('detected_terminals') || '[]');
      const shells: DetectedTool[] = JSON.parse(localStorage.getItem('detected_shells') || '[]');
      const git: DetectedTool[] = JSON.parse(localStorage.getItem('detected_git') || '[]');
      if (editors.length > 0 || terminals.length > 0 || shells.length > 0 || git.length > 0) {
        const editorIcons: Record<string, string> = JSON.parse(localStorage.getItem('editor_icons') || '{}');
        const terminalIcons: Record<string, string> = JSON.parse(localStorage.getItem('terminal_icons') || '{}');
        return {
          git,
          editors: editors.map((e) => ({ ...e, icon: e.icon || editorIcons[e.id] || undefined })),
          terminals: terminals.map((t) => ({ ...t, icon: t.icon || terminalIcons[t.id] || undefined })),
          shells,
        } as DetectedToolsResult;
      }
    } catch { /* ignore */ }
    return null;
  });
  const [toolsDetecting, setToolsDetecting] = useState(false);
  const [toolPaths, setToolPaths] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('tool_paths') || '{}'); }
    catch { return {}; }
  });

  const saveToolPaths = useCallback((updated: Record<string, string>) => {
    setToolPaths(updated);
    localStorage.setItem('tool_paths', JSON.stringify(updated));
    if (updated.git !== undefined) {
      callBackend('set_git_path', { path: updated.git || '' }).catch(() => { });
    }
  }, []);

  const handleDetectTools = useCallback(async () => {
    setToolsDetecting(true);
    try {
      const tools = await callBackend('detect_tools') as DetectedToolsResult;
      console.log('[detect_tools] editors received:', tools.editors.map(e => ({ id: e.id, hasIcon: !!e.icon, iconLen: e.icon?.length || 0 })));
      setDetectedTools(tools);

      // Store all tool data in localStorage for cross-component access and state restoration
      const editorIcons: Record<string, string> = {};
      const editorList: Array<{ id: string; name: string; icon?: string }> = [];
      for (const editor of tools.editors) {
        if (editor.icon) editorIcons[editor.id] = editor.icon;
        editorList.push({ id: editor.id, name: editor.name, icon: editor.icon });
      }
      localStorage.setItem('editor_icons', JSON.stringify(editorIcons));
      localStorage.setItem('detected_editors', JSON.stringify(editorList));
      const terminalIcons: Record<string, string> = {};
      for (const term of tools.terminals) {
        if (term.icon) terminalIcons[term.id] = term.icon;
      }
      localStorage.setItem('terminal_icons', JSON.stringify(terminalIcons));
      localStorage.setItem('detected_terminals', JSON.stringify(tools.terminals.map((t) => ({ id: t.id, name: t.name, path: t.path }))));
      localStorage.setItem('detected_shells', JSON.stringify(tools.shells));
      localStorage.setItem('detected_git', JSON.stringify(tools.git));
      window.dispatchEvent(new Event('editors-detected'));
      window.dispatchEvent(new Event('terminals-detected'));
      setToolPaths(prev => {
        const updated = { ...prev };
        if (!updated.git && tools.git.length > 0) updated.git = tools.git[0].path;
        if (!updated.terminal && tools.terminals.length > 0) updated.terminal = tools.terminals[0].id;
        if (!updated.shell && tools.shells.length > 0) updated.shell = tools.shells[0].id;
        // Auto-fill per-IDE editor paths
        for (const ed of tools.editors) {
          const key = `editor_${ed.id}`;
          if (!updated[key]) updated[key] = ed.path;
        }
        localStorage.setItem('tool_paths', JSON.stringify(updated));
        if (updated.git) callBackend('set_git_path', { path: updated.git }).catch(() => { });
        return updated;
      });
    } catch (e) {
      console.error('detect_tools failed:', e);
    } finally {
      setToolsDetecting(false);
    }
  }, []);

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

  // Load cloud status on mount
  useEffect(() => {
    cloudGetStatus().then(setCloudStatus).catch(() => {})
  }, [])

  // Cleanup pairing interval on unmount
  useEffect(() => {
    return () => {
      if (pairingIntervalRef.current) clearInterval(pairingIntervalRef.current)
    }
  }, [])

  // Load commit prefix & git user global config
  useEffect(() => {
    getCommitPrefixConfig()
      .then(cfg => {
        setPrefixTemplates(cfg.templates.length > 0 ? cfg.templates : ['[{{worktree-name}}]']);
        setPrefixEnabled(cfg.enabled);
        setDefaultPrefixIndex(cfg.default_index ?? 0);
      })
      .catch(() => {});

    getGitUserGlobalConfig()
      .then(cfg => {
        setGlobalGitName(cfg.name || '');
        setGlobalGitEmail(cfg.email || '');
      })
      .catch(() => {});

    getSkipGitHooks()
      .then(v => {
        setSkipGitHooks(v);
        setSkipGitHooksLoaded(true);
      })
      .catch(() => setSkipGitHooksLoaded(true));
  }, []);

  // ==================== Cloud connection handlers ====================
  const handleStartPairing = async () => {
    try {
      const info = await cloudStartPairing()
      setPairingCode(info.code)
      const interval = setInterval(async () => {
        try {
          const status = await cloudCheckPairingStatus()
          setPairingStatus(status)
          if (status.status === 'expired') {
            clearInterval(interval)
            pairingIntervalRef.current = null
            setPairingCode(null)
          }
        } catch { /* ignore */ }
      }, 3000)
      pairingIntervalRef.current = interval
    } catch (e: any) {
      console.error('Pairing failed:', e)
    }
  }

  const handleCloudApprove = async () => {
    await cloudApprovePairing()
    if (pairingIntervalRef.current) clearInterval(pairingIntervalRef.current)
    setPairingCode(null)
    setPairingStatus(null)
    setCloudStatus(await cloudGetStatus())
  }

  const handleCloudReject = async () => {
    await cloudRejectPairing()
    if (pairingIntervalRef.current) clearInterval(pairingIntervalRef.current)
    setPairingCode(null)
    setPairingStatus(null)
  }

  const handleCloudDisconnect = async () => {
    await cloudDisconnect()
    setCloudStatus(await cloudGetStatus())
  }

  // ==================== Menu items ====================
  const menuItems = [
    { id: 'workspaces' as SettingsSection, label: t('settings.workspaceConfig'), icon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'vault' as SettingsSection, label: t('settings.vaultNav'), icon: <Brain className="w-3.5 h-3.5 text-amber-400" /> },
    { id: 'tools' as SettingsSection, label: t('settings.toolsNav', '工具'), icon: <Wrench className="w-3.5 h-3.5" /> },
    ...(isTauri() ? [{ id: 'share' as SettingsSection, label: t('settings.externalShareNav', '外网分享'), icon: <Globe className="w-3.5 h-3.5" /> }] : []),
    { id: 'commit' as SettingsSection, label: t('settings.commitNav', '提交设置'), icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'voice' as SettingsSection, label: t('settings.voiceNav'), icon: <Mic className="w-3.5 h-3.5" /> },
    // { id: 'cloud' as SettingsSection, label: t('settings.cloudNav', '云端连接'), icon: <Link2 className="w-3.5 h-3.5" /> },
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
          <h1 className="text-lg font-semibold">{t('settings.settingsTitle', '设置')}</h1>
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
        <div className="w-48 shrink-0 border-r border-slate-700/50 py-2 overflow-y-auto">
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
        <div className="flex-1 overflow-y-auto p-4 select-text">
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
                      {/* Merge linked_workspace_items + vault synced items, deduplicated, sorted */}
                      {(() => {
                        const vaultMap = new Map<string, { name: string; item_type: 'file' | 'directory' }>();
                        if (vaultStatus?.connected) {
                          for (const si of vaultStatus.synced_items) {
                            vaultMap.set(si.name, si);
                          }
                        }
                        const allItems = [...config.linked_workspace_items];
                        for (const [name] of vaultMap) {
                          if (!allItems.includes(name)) allItems.push(name);
                        }
                        // Sort: 1) custom before vault, 2) file before dir, 3) name ASC
                        allItems.sort((a, b) => {
                          const aIsVault = vaultMap.has(a);
                          const bIsVault = vaultMap.has(b);
                          if (aIsVault !== bIsVault) return aIsVault ? 1 : -1;
                          const aIsDir = vaultMap.get(a)?.item_type === 'directory';
                          const bIsDir = vaultMap.get(b)?.item_type === 'directory';
                          if (aIsDir !== bIsDir) return aIsDir ? 1 : -1;
                          return a.localeCompare(b);
                        });
                        return allItems.map((item, index) => {
                          const vaultItem = vaultMap.get(item);
                          const isVaultManaged = vaultItem !== undefined;
                          const isInConfig = config.linked_workspace_items.includes(item);
                          const isDir = vaultItem?.item_type === 'directory';
                          return (
                            <span key={index} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${isVaultManaged ? 'bg-emerald-900/30 border border-emerald-700/40 text-emerald-300' : 'bg-slate-700/50 border border-slate-600/50 text-slate-300'}`}>
                              {isVaultManaged && <Link2 className="w-3 h-3 text-emerald-400" />}
                              {item}{isDir ? '/' : ''}
                              {isInConfig && !isVaultManaged && (
                                <button type="button" onClick={() => removeLinkedItem(config.linked_workspace_items.indexOf(item))} className="text-slate-500 hover:text-red-400 transition-colors ml-0.5">&times;</button>
                              )}
                            </span>
                          );
                        });
                      })()}
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
                              <div>
                                <label className="block text-[10px] text-slate-600 mb-0.5">{t('settings.preferredIDE', '偏好 IDE')}</label>
                                {(() => {
                                  const prefs: Record<string, string> = JSON.parse(localStorage.getItem('project_preferred_editors') || '{}');
                                  const allEditors: Array<{ id: string; name: string }> =
                                    (detectedTools?.editors || []).length > 0
                                      ? detectedTools!.editors.map(e => ({ id: e.id, name: e.name }))
                                      : JSON.parse(localStorage.getItem('detected_editors') || '[]');
                                  const hiddenIds: string[] = JSON.parse(localStorage.getItem('hidden_editors') || '[]');
                                  const visibleEditors = allEditors.filter(e => !hiddenIds.includes(e.id));
                                  const currentPref = prefs[proj.name] || '_default';
                                  return (
                                    <Select value={currentPref} onValueChange={(value) => {
                                      const freshPrefs = JSON.parse(localStorage.getItem('project_preferred_editors') || '{}');
                                      if (value === '_default') {
                                        delete freshPrefs[proj.name];
                                      } else {
                                        freshPrefs[proj.name] = value;
                                      }
                                      localStorage.setItem('project_preferred_editors', JSON.stringify(freshPrefs));
                                      // Force re-render
                                      setConfig(prev => ({ ...prev }));
                                    }}>
                                      <SelectTrigger className="w-full h-7 text-xs"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="_default">{t('settings.useGlobalEditor', '跟随全局')}</SelectItem>
                                        {visibleEditors.map(ed => (
                                          <SelectItem key={ed.id} value={ed.id}>{ed.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  );
                                })()}
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-600 mb-0.5">{t('settings.commitPrefixLabel', '前缀模板')}</label>
                                <Select value={String(proj.commit_prefix_index ?? 0)}
                                  onValueChange={(value) => updateProject(index, 'commit_prefix_index', parseInt(value, 10))}
                                >
                                  <SelectTrigger className="w-full h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="0">模板 1</SelectItem>
                                    <SelectItem value="1">模板 2</SelectItem>
                                    <SelectItem value="2">模板 3</SelectItem>
                                    <SelectItem value="3">{t('settings.noPrefix', '无')}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-600 mb-0.5">{t('settings.gitUserNameOverride', 'Git 用户名(覆盖)')}</label>
                                <Input type="text" value={proj.git_user_name || ''}
                                  onChange={(e) => updateProject(index, 'git_user_name', e.target.value || undefined)}
                                  placeholder={t('settings.inheritGlobal', '继承全局')} className="h-7 text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-600 mb-0.5">{t('settings.gitUserEmailOverride', 'Git 邮箱(覆盖)')}</label>
                                <Input type="text" value={proj.git_user_email || ''}
                                  onChange={(e) => updateProject(index, 'git_user_email', e.target.value || undefined)}
                                  placeholder={t('settings.inheritGlobal', '继承全局')} className="h-7 text-xs"
                                />
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

            {/* ==================== Vault Section ==================== */}
            {activeSection === 'vault' && (
              <VaultSettingsSection />
            )}

            {/* ==================== Tools Section ==================== */}
            {activeSection === 'tools' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-100">{t('settings.toolsTitle', '工具路径配置')}</h2>
                  <Button variant="secondary" size="sm" onClick={handleDetectTools} disabled={toolsDetecting} className="gap-1.5">
                    <RefreshCw className={`w-3.5 h-3.5 ${toolsDetecting ? 'animate-spin' : ''}`} />
                    {toolsDetecting ? t('settings.detecting', '检测中...') : t('settings.autoDetect', '自动检测')}
                  </Button>
                </div>

                {/* Git */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-slate-300">Git</h3>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('settings.gitPath', 'Git 可执行文件路径')}</label>
                    {detectedTools && detectedTools.git.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {detectedTools.git.map((g, i) => (
                          <button key={i} type="button"
                            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${toolPaths.git === g.path ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-slate-700/50 border-slate-600/50 text-slate-400 hover:text-slate-200'}`}
                            onClick={() => saveToolPaths({ ...toolPaths, git: g.path })}
                          >{g.name}: {g.path}</button>
                        ))}
                      </div>
                    )}
                    <Input type="text" value={toolPaths.git || ''} placeholder={t('settings.gitPathPlaceholder', '留空自动检测，如 /usr/bin/git')}
                      onChange={(e) => saveToolPaths({ ...toolPaths, git: e.target.value })}
                      className="h-8 text-sm font-mono"
                    />
                  </div>
                </div>

                {/* Terminal */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-slate-300">{t('settings.terminalTitle', '终端')}</h3>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('settings.defaultTerminal', '默认终端')}</label>
                    {detectedTools && detectedTools.terminals.length > 0 ? (
                      <Select value={toolPaths.terminal || 'auto'}
                        onValueChange={(value) => {
                          saveToolPaths({ ...toolPaths, terminal: value, terminal_custom: '' });
                          localStorage.setItem('preferred_terminal', value);
                        }}
                      >
                        <SelectTrigger className="w-full h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">{t('settings.terminalAuto', '自动检测')}</SelectItem>
                          {detectedTools.terminals.map((term) => (
                            <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="text-xs text-slate-500 bg-slate-900/50 border border-slate-700/30 rounded-md px-3 py-2">
                        {t('settings.terminalAutoHint', '当前使用自动检测。点击上方「自动检测」按钮可发现已安装的终端。')}
                      </div>
                    )}
                    <p className="text-[10px] text-slate-600 mt-1">{t('settings.defaultTerminalHint', '打开终端时使用的默认终端程序')}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('settings.terminalCustomPath', '自定义终端路径（覆盖上方选择）')}</label>
                    <Input type="text" value={toolPaths.terminal_custom || ''} placeholder={t('settings.terminalCustomPlaceholder', '如 C:\\Tools\\cmder\\Cmder.exe 或 /usr/local/bin/fish')}
                      onChange={(e) => {
                        const val = e.target.value;
                        saveToolPaths({ ...toolPaths, terminal_custom: val });
                        // If custom path is set, store it as preferred_terminal for PTY
                        localStorage.setItem('preferred_terminal', val || toolPaths.terminal || 'auto');
                      }}
                      className="h-8 text-sm font-mono"
                    />
                    <p className="text-[10px] text-slate-600 mt-1">{t('settings.terminalCustomHint', '填写后将忽略上方下拉选择，直接使用该路径作为终端程序')}</p>
                  </div>
                </div>

                {/* Shell */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-slate-300">{t('settings.shellTitle', 'Shell')}</h3>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('settings.defaultShell', '默认 Shell')}</label>
                    {detectedTools && detectedTools.shells.length > 0 ? (
                      <Select value={toolPaths.shell || 'auto'}
                        onValueChange={(value) => {
                          saveToolPaths({ ...toolPaths, shell: value });
                          localStorage.setItem('preferred_shell', value);
                        }}
                      >
                        <SelectTrigger className="w-full h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">{t('settings.shellAuto', '系统默认')}</SelectItem>
                          {detectedTools.shells.map((sh) => (
                            <SelectItem key={sh.id} value={sh.id}>{sh.name} ({sh.path})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="text-xs text-slate-500 bg-slate-900/50 border border-slate-700/30 rounded-md px-3 py-2">
                        {t('settings.shellAutoHint', '当前使用系统默认 Shell。点击上方「自动检测」按钮可发现已安装的 Shell。')}
                      </div>
                    )}
                    <p className="text-[10px] text-slate-600 mt-1">{t('settings.defaultShellHint', '内置终端面板使用的 Shell 程序（如 zsh、bash、fish）')}</p>
                  </div>
                </div>

                {/* Unified Editor/IDE list */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-slate-300">{t('settings.editorTitle', '编辑器 / IDE')}</h3>
                  {(detectedTools?.editors || []).map((editor) => {
                    const pathKey = `editor_${editor.id}`;
                    return (
                      <div key={editor.id} className="flex items-center gap-3 py-1.5 border-t border-slate-700/20 first:border-0 first:pt-0">
                        {editor.icon ? (
                          <img src={editor.icon} width={20} height={20} alt="" className="shrink-0 rounded" style={{ imageRendering: 'auto' }} />
                        ) : (
                          <span className="w-5 h-5 shrink-0 flex items-center justify-center text-slate-500 text-[10px]">⌘</span>
                        )}
                        <div className="w-28 shrink-0">
                          <span className="text-xs text-slate-300">{editor.name}</span>
                        </div>
                        <Input
                          type="text"
                          value={toolPaths[pathKey] || ''}
                          placeholder={editor.path || 'auto'}
                          onChange={(e) => saveToolPaths({ ...toolPaths, [pathKey]: e.target.value })}
                          className="h-7 text-xs font-mono flex-1"
                        />
                        <button
                          type="button"
                          className="text-slate-500 hover:text-red-400 transition-colors shrink-0"
                          title={t('common.delete', '删除')}
                          onClick={() => {
                            const cached: Array<{ id: string; name: string; icon?: string }> = JSON.parse(localStorage.getItem('detected_editors') || '[]');
                            localStorage.setItem('detected_editors', JSON.stringify(cached.filter(e => e.id !== editor.id)));
                            const customs: Array<{ id: string; name: string; path: string }> = JSON.parse(localStorage.getItem('custom_editors') || '[]');
                            localStorage.setItem('custom_editors', JSON.stringify(customs.filter(e => e.id !== editor.id)));
                            const icons: Record<string, string> = JSON.parse(localStorage.getItem('editor_icons') || '{}');
                            delete icons[editor.id];
                            localStorage.setItem('editor_icons', JSON.stringify(icons));
                            const tp = { ...toolPaths };
                            delete tp[pathKey];
                            saveToolPaths(tp);
                            setDetectedTools(prev => prev ? { ...prev, editors: prev.editors.filter(e => e.id !== editor.id) } : prev);
                            window.dispatchEvent(new Event('editors-detected'));
                          }}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    );
                  })}
                  {/* Add custom editor */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-700/30">
                    <Input
                      type="text"
                      placeholder={t('settings.customEditorName', '名称')}
                      id="custom-editor-name"
                      className="h-7 text-xs flex-none w-28"
                    />
                    <div className="flex flex-1 gap-1">
                      <Input
                        type="text"
                        placeholder={t('settings.customEditorPath', '可执行文件路径 / .app 路径')}
                        id="custom-editor-path"
                        className="h-7 text-xs font-mono flex-1"
                      />
                      {isTauri() && (
                        <button
                          type="button"
                          className="h-7 px-2 text-slate-400 hover:text-blue-400 transition-colors shrink-0 flex items-center border border-slate-700 rounded-md"
                          title={t('settings.browseForApp', '选择应用')}
                          onClick={async () => {
                            const { open } = await import('@tauri-apps/plugin-dialog');
                            const isWindows = navigator.platform.toLowerCase().includes('win');
                            const selected = await open({
                              multiple: false,
                              filters: isWindows
                                ? [{ name: 'Executable', extensions: ['exe'] }]
                                : [{ name: 'Application', extensions: ['app'] }],
                            }).catch(() => null);
                            if (!selected || typeof selected !== 'string') return;
                            const pathInput = document.getElementById('custom-editor-path') as HTMLInputElement;
                            if (pathInput) pathInput.value = selected;
                            const nameInput = document.getElementById('custom-editor-name') as HTMLInputElement;
                            if (nameInput && !nameInput.value.trim()) {
                              const basename = selected.split(/[/\\]/).pop()?.replace(/\.(app|exe)$/i, '') ?? '';
                              nameInput.value = basename;
                            }
                            const icon = await getAppIcon(selected).catch(() => null);
                            if (pathInput && icon) pathInput.dataset.pendingIcon = icon;
                          }}
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-slate-400 hover:text-green-400 transition-colors shrink-0"
                      title={t('settings.addCustomEditor', '添加')}
                      onClick={() => {
                        const nameInput = document.getElementById('custom-editor-name') as HTMLInputElement;
                        const pathInput = document.getElementById('custom-editor-path') as HTMLInputElement;
                        const name = nameInput?.value?.trim();
                        const path = pathInput?.value?.trim();
                        if (!name || !path) return;
                        const id = `custom-${name.toLowerCase().replace(/\s+/g, '-')}`;
                        const customs: Array<{ id: string; name: string; path: string }> = JSON.parse(localStorage.getItem('custom_editors') || '[]');
                        if (customs.some(c => c.id === id)) return;
                        customs.push({ id, name, path });
                        localStorage.setItem('custom_editors', JSON.stringify(customs));
                        const pendingIcon = pathInput?.dataset?.pendingIcon;
                        if (pendingIcon) {
                          const icons: Record<string, string> = JSON.parse(localStorage.getItem('editor_icons') || '{}');
                          icons[id] = pendingIcon;
                          localStorage.setItem('editor_icons', JSON.stringify(icons));
                          delete pathInput.dataset.pendingIcon;
                        }
                        const detected: Array<{ id: string; name: string; icon?: string }> = JSON.parse(localStorage.getItem('detected_editors') || '[]');
                        detected.push({ id, name, icon: pendingIcon });
                        localStorage.setItem('detected_editors', JSON.stringify(detected));
                        const tp = JSON.parse(localStorage.getItem('tool_paths') || '{}');
                        tp[`editor_${id}`] = path;
                        localStorage.setItem('tool_paths', JSON.stringify(tp));
                        window.dispatchEvent(new Event('editors-detected'));
                        setDetectedTools(prev => prev
                          ? { ...prev, editors: [...prev.editors, { id, name, path, icon: pendingIcon || undefined }] }
                          : { git: [], terminals: [], shells: [], editors: [{ id, name, path, icon: pendingIcon || undefined }] }
                        );
                        nameInput.value = '';
                        pathInput.value = '';
                      }}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    </button>
                  </div>
                </div>
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

            {/* ==================== Commit ==================== */}
            {activeSection === 'commit' && (
              <div>
                <h2 className="text-lg font-medium mb-4">{t('settings.commitTitle', '提交设置')}</h2>
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-4">
                  {/* 前缀开关 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-slate-400">{t('settings.prefixEnabled', '启用提交前缀')}</label>
                      <p className="text-xs text-slate-500">{t('settings.prefixEnabledDesc', '在 commit message 前自动添加前缀')}</p>
                    </div>
                    <button type="button"
                      onClick={() => setPrefixEnabled(v => !v)}
                      className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${prefixEnabled ? 'bg-blue-500' : 'bg-slate-600'}`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${prefixEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>

                  {/* Skip Git Hooks */}
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-slate-400">{t('settings.skipGitHooks', '跳过 Git Hooks')}</label>
                      <p className="text-xs text-slate-500">{t('settings.skipGitHooksDesc', '提交时跳过 pre-commit / commit-msg hooks')}</p>
                    </div>
                    <button type="button"
                      onClick={() => { const newVal = !skipGitHooks; setSkipGitHooks(newVal); saveSkipGitHooks(newVal).catch(() => {}); }}
                      disabled={!skipGitHooksLoaded}
                      className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${skipGitHooks ? 'bg-blue-500' : 'bg-slate-600'}`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${skipGitHooks ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>

                  {/* 模板列表 */}
                  {prefixEnabled && (
                    <div className="space-y-2">
                      <label className="block text-sm text-slate-400">{t('settings.prefixTemplates', '前缀模板（最多3个）')}</label>
                      {prefixTemplates.map((tpl, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDefaultPrefixIndex(i)}
                            className={`px-1.5 ${defaultPrefixIndex === i ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                            title={t('settings.setDefault', '设为默认')}
                          >
                            <Star className={`w-4 h-4 ${defaultPrefixIndex === i ? 'fill-amber-400' : ''}`} />
                          </Button>
                          <Input type="text" value={tpl}
                            onChange={(e) => {
                              const next = [...prefixTemplates];
                              next[i] = e.target.value;
                              setPrefixTemplates(next);
                            }}
                            placeholder="[{{worktree-name}}]"
                            className="flex-1 text-xs"
                          />
                          {prefixTemplates.length > 1 && (
                            <Button variant="ghost" size="sm"
                              onClick={() => {
                                const next = prefixTemplates.filter((_, idx) => idx !== i);
                                setPrefixTemplates(next);
                                if (defaultPrefixIndex === i) {
                                  setDefaultPrefixIndex(0);
                                } else if (defaultPrefixIndex > i) {
                                  setDefaultPrefixIndex(defaultPrefixIndex - 1);
                                }
                              }}
                              className="text-red-400/60 hover:text-red-300"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {prefixTemplates.length < 3 && (
                        <Button variant="secondary" size="sm"
                          onClick={() => setPrefixTemplates([...prefixTemplates, ''])}
                          className="text-xs"
                        >
                          <PlusIcon className="w-3 h-3" /> {t('settings.addTemplate', '添加模板')}
                        </Button>
                      )}
                      <p className="text-xs text-slate-500">
                        {t('settings.prefixVarsHint', '可用变量: {{worktree-name}}, {{project-name}}, {{branch-name}}, {{repo-name}}, {{date}}')}
                      </p>
                    </div>
                  )}

                  <div className="border-t border-slate-700/50 pt-4">
                    <Button variant="secondary" size="sm" onClick={handleSavePrefixConfig} disabled={prefixSaving}>
                      {prefixSaving ? t('common.saving') : t('common.save')}
                    </Button>
                  </div>

                  {/* 全局 Git User */}
                  <div className="border-t border-slate-700/50 pt-4 space-y-3">
                    <h3 className="text-sm font-medium text-slate-300">{t('settings.globalGitUser', '全局 Git 用户')}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">{t('settings.gitUserName', '用户名')}</label>
                        <Input type="text" value={globalGitName}
                          onChange={(e) => setGlobalGitName(e.target.value)}
                          placeholder="Git 用户名" className="text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">{t('settings.gitUserEmail', '邮箱')}</label>
                        <Input type="text" value={globalGitEmail}
                          onChange={(e) => setGlobalGitEmail(e.target.value)}
                          placeholder="user@example.com" className="text-xs"
                        />
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleSaveGitUser} disabled={gitUserSaving}>
                      {gitUserSaving ? t('common.saving') : t('common.save')}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== Cloud (hidden from menu) ==================== */}
            {activeSection === 'cloud' && (
              <div className="space-y-4">
                <h2 className="text-lg font-medium mb-4">{t('settings.cloudTitle', '云端连接')}</h2>
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
                  {cloudStatus?.connected ? (
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-green-700 dark:text-green-300">{t('settings.cloudConnected', '已连接')}</p>
                          <p className="text-xs text-muted-foreground">{cloudStatus.server_url}</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={handleCloudDisconnect}>{t('settings.cloudDisconnect', '断开连接')}</Button>
                      </div>
                      {(cloudStatus.username || cloudStatus.user_email) && (
                        <div className="text-xs text-muted-foreground space-y-0.5 pt-1 border-t border-green-200/30">
                          {cloudStatus.username && (
                            <p>{t('settings.cloudUsername', '用户名')}: <span className="text-slate-300">{cloudStatus.username}</span></p>
                          )}
                          {cloudStatus.user_email && (
                            <p>{t('settings.cloudEmail', '邮箱')}: <span className="text-slate-300">{cloudStatus.user_email}</span></p>
                          )}
                          {cloudStatus.token_expires_at && (
                            <p>{t('settings.cloudTokenExpiry', 'Token 有效期至')}: <span className="text-slate-300">{new Date(cloudStatus.token_expires_at).toLocaleString()}</span></p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : pairingCode ? (
                    <div className="space-y-3 p-4 border border-slate-700/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">{t('settings.cloudPairingHint', '请在 WMS 管理后台输入以下配对码：')}</p>
                      <p className="text-3xl font-mono font-bold text-center tracking-wider">{pairingCode}</p>
                      {pairingStatus?.status === 'claimed' && (
                        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                          <p className="text-sm">{t('settings.cloudPairingRequest', '用户')} <strong>{pairingStatus.user_email || pairingStatus.username}</strong> {t('settings.cloudPairingRequestSuffix', '请求连接此设备')}</p>
                          <div className="flex gap-2 mt-2">
                            <Button size="sm" onClick={handleCloudApprove}>{t('settings.cloudApprove', '同意')}</Button>
                            <Button size="sm" variant="outline" onClick={handleCloudReject}>{t('settings.cloudReject', '拒绝')}</Button>
                          </div>
                        </div>
                      )}
                      <Button variant="ghost" size="sm" onClick={handleCloudReject}>{t('settings.cloudCancelPairing', '取消配对')}</Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">服务端 <code className="bg-slate-700/50 px-1.5 py-0.5 rounded text-xs">https://wms.kirov-opensource.com/</code></p>
                      <p className="text-sm text-muted-foreground">设备名称 <code className="bg-slate-700/50 px-1.5 py-0.5 rounded text-xs">自动获取 hostname</code></p>
                      <Button onClick={handleStartPairing}>{t('settings.cloudStartPairing', '开始配对')}</Button>
                    </div>
                  )}
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
                  {isTauri() && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700/50">
                      <div>
                        <label className="text-sm text-slate-400">DevTools (F12)</label>
                        <p className="text-xs text-slate-500">{t('settings.devToolsDesc', 'Press F12 to open developer tools')}</p>
                      </div>
                      <button type="button" onClick={() => { const newVal = !devConsoleEnabled; setDevConsoleEnabled(newVal); localStorage.setItem('dev-console-enabled', String(newVal)); }}
                        className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${devConsoleEnabled ? 'bg-blue-500' : 'bg-slate-600'}`}
                      ><span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${devConsoleEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} /></button>
                    </div>
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
