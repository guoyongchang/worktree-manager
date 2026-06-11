import React, { useState, useEffect, useRef, useCallback, type FC } from 'react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RefreshCw, Search, Mic, Eye, EyeOff, Settings, Globe, Info, Trash2, Wrench, FolderOpen, Link2, Folder, FileText, ChevronRight, ChevronDown, Star, Palette, Check, Brain, AlertCircle } from 'lucide-react';
import { BackIcon, PlusIcon, TrashIcon } from './Icons';
import { useTheme } from '../hooks/useTheme';
import { BranchCombobox } from './BranchCombobox';
import type { WorkspaceRef, WorkspaceConfig, ProjectConfig, ScannedFolder, VaultStatus, VaultItemChild, FailedVaultItem, TagDefinition } from '../types';
import { getAppVersion, getAppIcon, getNgrokToken, setNgrokToken as saveNgrokToken, getDashscopeApiKey, setDashscopeApiKey as saveDashscopeApiKey, getDashscopeBaseUrl, setDashscopeBaseUrl as saveDashscopeBaseUrl, getVoiceRefineEnabled, setVoiceRefineEnabled as saveVoiceRefineEnabled, getVoiceAsrModel, setVoiceAsrModel as saveVoiceAsrModel, getVoiceRefineModel, setVoiceRefineModel as saveVoiceRefineModel, voiceStart, voiceStop, voiceRefineText, isTauri, getPlatform, getRemoteBranches, openLink, callBackend, loadWorkspaceConfigByPath, saveWorkspaceConfigByPath, getVaultStatus, vaultLink, listVaultItemChildren, getCommitPrefixConfig, setCommitPrefixConfig, getGitUserGlobalConfig, setGitUserGlobalConfig, getSkipGitHooks, setSkipGitHooks as saveSkipGitHooks, getShellIntegrationEnabled, setShellIntegrationEnabled as saveShellIntegrationEnabled, cloudGetStatus, cloudStartPairing, cloudCheckPairingStatus, cloudApprovePairing, cloudRejectPairing, cloudDisconnect, getCommitAiApiKey, setCommitAiApiKey as saveCommitAiApiKey, setCommitAiEnabled as saveCommitAiEnabled, getCommitAiEnabled, listDashscopeModels, getVoiceRefineBaseUrl, setVoiceRefineBaseUrl as saveVoiceRefineBaseUrl } from '../lib/backend';
import type { CloudStatus, PairingStatus } from '../lib/backend';

const isWindowsPowerShellId = (id?: string) => id === 'powershell' || id === 'pwsh';

import { TAG_PRESET_COLORS } from '../constants';

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
        className={`flex items-center gap-1 text-xs ${isDir ? 'text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
        style={{ paddingLeft: `${indent}px` }}
        onClick={isDir ? handleToggle : undefined}
      >
        {isDir ? (
          <>
            {tooMany ? (
              <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)] shrink-0" />
            ) : expanded ? (
              <ChevronDown className="w-3 h-3 text-[var(--color-text-secondary)] shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[var(--color-text-secondary)] shrink-0" />
            )}
            <Folder className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
          </>
        ) : (
          <>
            <span className="w-3 inline-block" />
            <FileText className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
          </>
        )}
        <span className={tooMany ? 'text-[var(--color-text-muted)]' : ''}>
          {itemName}{isDir ? '/' : ''}
        </span>
        {loading && <span className="text-[10px] text-[var(--color-text-muted)]">{t('common.loading', '...')}</span>}
        {tooMany && (
          <span className="text-[10px] text-amber-500 ml-1">{t('settings.vaultTooManyItems', '99+')}</span>
        )}
      </div>
      {error && (
        <div className="text-[10px] text-[var(--color-error)] pl-4" style={{ paddingLeft: `${indent + 16}px` }}>
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


// ==================== WorkspaceVaultSection ====================
const WorkspaceVaultSection: FC = () => {
  const { t } = useTranslation();
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [inputPath, setInputPath] = useState('');
  const [linking, setLinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showItems, setShowItems] = useState(false);
  const [failedItems, setFailedItems] = useState<FailedVaultItem[]>([]);
  const [showFailedItems, setShowFailedItems] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await getVaultStatus();
      setVaultStatus(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleConnect = async (selectedPath: string) => {
    if (!selectedPath.trim()) return;
    setError(null);
    setFailedItems([]);
    setLinking(true);
    try {
      const result = await vaultLink(selectedPath.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setVaultStatus({
          connected: result.connected,
          vault_path: selectedPath.trim(),
          synced_items: result.synced_items,
        });
        setInputPath('');
        if (result.warning) setError(result.warning);
      }
      if (result.failed_items && result.failed_items.length > 0) {
        setFailedItems(result.failed_items);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLinking(false);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.vaultSelectTitle', '选择知识库目录'),
      });
      if (selected) {
        await handleConnect(selected as string);
      }
    } catch {
      // Dialog not available in browser mode
    }
  };

  const handleRefresh = async () => {
    if (!vaultStatus?.vault_path) return;
    setError(null);
    setFailedItems([]);
    setLinking(true);
    try {
      const result = await vaultLink(vaultStatus.vault_path);
      if (result.error) {
        setError(result.error);
      } else {
        setVaultStatus({
          connected: result.connected,
          vault_path: vaultStatus.vault_path,
          synced_items: result.synced_items,
        });
        if (result.warning) setError(result.warning);
      }
      if (result.failed_items && result.failed_items.length > 0) {
        setFailedItems(result.failed_items);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLinking(false);
    }
  };

  const handleDisconnect = async (keepSymlinks = false) => {
    const msg = keepSymlinks
      ? t('settings.vaultSoftDisconnectConfirm', '断开但保留本地软链接？')
      : t('settings.vaultDisconnectConfirm', '确定要断开 Vault 吗？这将移除所有软链接。');
    if (!window.confirm(msg)) return;
    setError(null);
    setLinking(true);
    try {
      await vaultLink(null, keepSymlinks);
      setVaultStatus({ connected: false, vault_path: null, synced_items: [] });
    } catch (e) {
      setError(String(e));
    } finally {
      setLinking(false);
    }
  };

  if (loading) {
    return <div className="text-xs text-[var(--color-text-muted)]">{t('common.loading', '...')}</div>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
      {vaultStatus?.connected ? (
        <>
          {/* Connected state */}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-[var(--color-text-secondary)]">
              {t('settings.vaultConnected', '已连接')}
            </span>
          </div>
          {vaultStatus.vault_path && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-[var(--color-text-muted)] font-mono truncate max-w-[200px]" title={vaultStatus.vault_path}>
                {vaultStatus.vault_path}
              </span>
            </div>
          )}
          {/* Synced items toggle */}
          <div>
            <button
              className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              onClick={() => setShowItems(!showItems)}
            >
              <span className="w-3 h-3 inline-flex items-center justify-center text-[10px]">
                {showItems ? '\u25BC' : '\u25B6'}
              </span>
              {t('settings.vaultSyncedItems', '已同步项')}
              <span className="text-[var(--color-text-muted)]">({vaultStatus.synced_items.length})</span>
            </button>
            {showItems && vaultStatus.vault_path && (
              <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto pr-1">
                {vaultStatus.synced_items.map((item) => (
                  <VaultItemTree
                    key={item.name}
                    vaultPath={vaultStatus.vault_path!}
                    relativePath={item.name}
                    itemName={item.name}
                    itemType={item.item_type}
                  />
                ))}
              </div>
            )}
          </div>
          {/* Failed items with collapse */}
          {failedItems.length > 0 && (
            <div>
              <button
                className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                onClick={() => setShowFailedItems(!showFailedItems)}
              >
                <span className="w-3 h-3 inline-flex items-center justify-center text-[10px]">
                  {showFailedItems ? '\u25BC' : '\u25B6'}
                </span>
                {t('settings.vaultFailedItems', '失败项')}
                <span className="text-orange-500/70">({failedItems.length})</span>
                {failedItems.length > 3 && !showFailedItems && (
                  <span className="text-[10px] text-orange-600/60">还有 {failedItems.length - 3} 项失败</span>
                )}
              </button>
              {showFailedItems && (
                <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto pr-1">
                  {failedItems.slice(0, 3).map((item, index) => (
                    <div key={index} className="text-xs text-orange-400/80 flex items-start gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="font-mono truncate" title={item.path}>{item.path}</span>
                      <span className="text-orange-500/60">- {item.reason}</span>
                    </div>
                  ))}
                  {failedItems.length > 3 && (
                    <div className="text-[10px] text-orange-500/60 pl-4">
                      还有 {failedItems.length - 3} 项失败
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={linking} onClick={handleRefresh}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="secondary" size="sm" disabled={linking} onClick={handleSelectFolder}>
              {t('settings.vaultChange', '更换')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={linking}
              onClick={() => handleDisconnect(true)}
              className="text-orange-400 hover:text-orange-300"
            >
              {t('settings.vaultSoftDisconnect', '断开(保留链接)')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={linking}
              onClick={() => handleDisconnect(false)}
              className="text-[var(--color-error)] hover:text-[var(--color-error)]"
            >
              {t('settings.vaultDisconnect', '断开')}
            </Button>
          </div>
        </>
      ) : (
        /* Not connected */
        <div className="flex gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] mt-2 shrink-0" />
          <span className="text-xs text-[var(--color-text-muted)] mr-2">{t('settings.vaultNotConnected', '未连接')}</span>
          <Input
            type="text"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder={t('settings.vaultInputPlaceholder', '/path/to/vault')}
            className="flex-1 h-8 text-sm"
          />
          <Button variant="secondary" size="sm" onClick={handleSelectFolder}>
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            disabled={linking || !inputPath.trim()}
            onClick={() => handleConnect(inputPath)}
          >
            {linking ? t('common.loading', '...') : t('settings.vaultConnect', '连接')}
          </Button>
        </div>
      )}
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

type SettingsSection = 'workspaces' | 'appearance' | 'tools' | 'share' | 'commit' | 'voice' | 'cloud' | 'about';

// ==================== AppearanceSettingsSection ====================
const THEME_I18N_KEY: Record<string, string> = {
  'default-dark': 'themes.defaultDark',
  'monokai': 'themes.monokai',
  'dracula': 'themes.dracula',
  'solarized-dark': 'themes.solarizedDark',
  'nord': 'themes.nord',
  'default-light': 'themes.defaultLight',
  'solarized-light': 'themes.solarizedLight',
  'github-light': 'themes.githubLight',
};

const AppearanceSettingsSection: FC = () => {
  const { t } = useTranslation();
  const { themeId, setTheme, themes } = useTheme();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('settings.activeTheme')}</h3>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">{t('settings.themeDesc')}</p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {themes.map(theme => {
          const isActive = themeId === theme.id;
          const c = theme.colors;
          return (
            <button
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              className={`relative flex items-center gap-3 w-full p-3 rounded-lg border transition-all text-left ${
                isActive
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                  : 'border-[var(--color-border)]/50 bg-[var(--color-bg-surface)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]'
              }`}
            >
              {/* Color preview dots */}
              <div className="flex gap-1.5 shrink-0">
                <div className="w-5 h-5 rounded-full border border-[var(--color-text-muted)]/30" style={{ background: c.bgBase }} />
                <div className="w-5 h-5 rounded-full border border-[var(--color-text-muted)]/30" style={{ background: c.bgSurface }} />
                <div className="w-5 h-5 rounded-full border border-[var(--color-text-muted)]/30" style={{ background: c.accent }} />
                <div className="w-5 h-5 rounded-full border border-[var(--color-text-muted)]/30" style={{ background: c.success }} />
                <div className="w-5 h-5 rounded-full border border-[var(--color-text-muted)]/30" style={{ background: c.error }} />
              </div>

              {/* Theme name */}
              <span className={`text-sm font-medium flex-1 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>
                {t(THEME_I18N_KEY[theme.id] || theme.id)}
              </span>

              {/* Active indicator */}
              {isActive && (
                <Check className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

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

  const handleAddTag = useCallback(() => {
    const usedColors = new Set((config.tags ?? []).map(t => t.color));
    const nextColor = TAG_PRESET_COLORS.find(c => !usedColors.has(c)) ?? TAG_PRESET_COLORS[0];
    const newTag: TagDefinition = { id: crypto.randomUUID(), name: '', color: nextColor };
    setConfig(prev => ({ ...prev, tags: [...(prev.tags ?? []), newTag] }));
  }, [config.tags]);

  const handleUpdateTag = useCallback((tagId: string, field: 'name' | 'color', value: string) => {
    setConfig(prev => ({
      ...prev,
      tags: (prev.tags ?? []).map(t => t.id === tagId ? { ...t, [field]: value } : t),
    }));
  }, []);

  const handleDeleteTag = useCallback((tagId: string) => {
    setConfig(prev => ({
      ...prev,
      tags: (prev.tags ?? []).filter(t => t.id !== tagId),
      projects: prev.projects.map(p => ({
        ...p,
        tags: (p.tags ?? []).filter(t => t !== tagId),
      })),
    }));
  }, []);

  const [openColorPickerId, setOpenColorPickerId] = useState<string | null>(null);

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
  const [shellIntegrationEnabled, setShellIntegrationEnabled] = useState(true);
  const [shellIntegrationLoaded, setShellIntegrationLoaded] = useState(false);
  const [showSplitButton, setShowSplitButton] = useState(() => {
    try { return JSON.parse(localStorage.getItem('show_split_button') ?? 'true'); } catch { return true; }
  });

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

  // Voice model config
  const [voiceAsrModel, setVoiceAsrModel] = useState('');
  const [voiceRefineModel, setVoiceRefineModel] = useState('');
  const [voiceModelsLoaded, setVoiceModelsLoaded] = useState(false);

  // Refine base URL state
  const DEFAULT_REFINE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const [refineBaseUrl, setRefineBaseUrl] = useState('');
  const [refineUrlSaving, setRefineUrlSaving] = useState(false);
  const [refineUrlSaved, setRefineUrlSaved] = useState(false);
  const [refineUrlError, setRefineUrlError] = useState<string | null>(null);

  // Refine test
  const [refineTesting, setRefineTesting] = useState(false);
  const [refineTestResult, setRefineTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Commit AI key state
  const [commitAiKey, setCommitAiKey] = useState('');
  const [commitAiKeyMasked, setCommitAiKeyMasked] = useState(false);
  const [commitAiKeyLoaded, setCommitAiKeyLoaded] = useState(false);
  const [commitAiSaving, setCommitAiSaving] = useState(false);
  const [commitAiSaved, setCommitAiSaved] = useState(false);
  const [commitAiError, setCommitAiError] = useState<string | null>(null);
  const [commitAiEnabled, setCommitAiEnabled] = useState(true);

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
  // getPlatform() reads the client (browser) user-agent, not the server platform.
  // In the normal Tauri desktop case these are the same. In remote-browser mode
  // (Mac browser → Windows Tauri server), filtering may hide Windows-specific shells
  // from the UI even though the backend can run them. This is an accepted trade-off:
  // the settings UI uses client platform as a proxy for "what makes sense to show the
  // user", keeping the UI consistent with what the user expects on their own machine.
  const isWindowsPlatform = getPlatform() === 'windows';
  const filterDetectedShells = useCallback((shells: DetectedTool[]) =>
    isWindowsPlatform ? shells : shells.filter((shell) => !isWindowsPowerShellId(shell.id)),
  [isWindowsPlatform]);
  const sanitizeToolPaths = useCallback((paths: Record<string, string>) => {
    if (isWindowsPlatform || !isWindowsPowerShellId(paths.shell)) return paths;
    // Windows-only shell ID detected on a non-Windows platform (e.g. after
    // migrating settings from a Windows machine). Clear it so the backend does
    // not receive an unsupported shell identifier.
    console.warn(
      '[settings] Cleared Windows-only shell preference on non-Windows platform:',
      paths.shell,
    );
    const next = { ...paths };
    delete next.shell;
    return next;
  }, [isWindowsPlatform]);
  const [detectedTools, setDetectedTools] = useState<DetectedToolsResult | null>(() => {
    try {
      const editors: DetectedTool[] = JSON.parse(localStorage.getItem('detected_editors') || '[]');
      const terminals: DetectedTool[] = JSON.parse(localStorage.getItem('detected_terminals') || '[]');
      const shells = filterDetectedShells(JSON.parse(localStorage.getItem('detected_shells') || '[]') as DetectedTool[]);
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
    try { return sanitizeToolPaths(JSON.parse(localStorage.getItem('tool_paths') || '{}')); }
    catch { return {}; }
  });

  const saveToolPaths = useCallback((updated: Record<string, string>) => {
    const sanitized = sanitizeToolPaths(updated);
    setToolPaths(sanitized);
    localStorage.setItem('tool_paths', JSON.stringify(sanitized));
    if (updated.git !== undefined) {
      callBackend('set_git_path', { path: sanitized.git || '' }).catch(() => { });
    }
  }, [sanitizeToolPaths]);

  const handleDetectTools = useCallback(async () => {
    if (!isTauri()) return; // detect_tools is localhost-only
    setToolsDetecting(true);
    try {
      const tools = await callBackend('detect_tools') as DetectedToolsResult;
      const sanitizedTools = {
        ...tools,
        shells: filterDetectedShells(tools.shells),
      };
      console.log('[detect_tools] editors received:', tools.editors.map(e => ({ id: e.id, hasIcon: !!e.icon, iconLen: e.icon?.length || 0 })));
      setDetectedTools(sanitizedTools);

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
      localStorage.setItem('detected_shells', JSON.stringify(sanitizedTools.shells));
      localStorage.setItem('detected_git', JSON.stringify(tools.git));
      window.dispatchEvent(new Event('editors-detected'));
      window.dispatchEvent(new Event('terminals-detected'));
      setToolPaths(prev => {
        const updated = { ...prev };
        if (!updated.git && tools.git.length > 0) updated.git = tools.git[0].path;
        if (!updated.terminal && tools.terminals.length > 0) updated.terminal = tools.terminals[0].id;
        if (!updated.shell && sanitizedTools.shells.length > 0) updated.shell = sanitizedTools.shells[0].id;
        // Auto-fill per-IDE editor paths
        for (const ed of tools.editors) {
          const key = `editor_${ed.id}`;
          if (!updated[key]) updated[key] = ed.path;
        }
        const sanitized = sanitizeToolPaths(updated);
        localStorage.setItem('tool_paths', JSON.stringify(sanitized));
        if (sanitized.git) callBackend('set_git_path', { path: sanitized.git }).catch(() => { });
        return sanitized;
      });
    } catch (e) {
      console.error('detect_tools failed:', e);
    } finally {
      setToolsDetecting(false);
    }
  }, [filterDetectedShells, sanitizeToolPaths]);

  // Load mic devices.
  // When requestLabels=false, only enumerate (safe, no permission prompt).
  // When requestLabels=true, request getUserMedia to get device labels (may trigger permission dialog).
  const loadMicDevices = useCallback(async (requestLabels = false) => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setMicDevices([]);
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput' && d.deviceId);
      if (requestLabels && audioInputs.length > 0 && !audioInputs[0].label) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          const devicesAfter = await navigator.mediaDevices.enumerateDevices();
          setMicDevices(devicesAfter.filter(d => d.kind === 'audioinput' && d.deviceId));
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

  // Init loaders — no mic permission request on mount (deferred to voice section)
  useEffect(() => {
    loadMicDevices(false);
    getAppVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
    if (isTauri()) {
      getNgrokToken().then(token => {
        setNgrokToken(token || '');
        setNgrokTokenLoaded(true);
      }).catch(() => setNgrokTokenLoaded(true));
    }
    if (isTauri()) {
      getDashscopeApiKey().then(k => {
        setDashscopeKey(k || '');
        setDashscopeKeyLoaded(true);
      }).catch(() => setDashscopeKeyLoaded(true));
      getDashscopeBaseUrl().then(u => {
        setDashscopeUrl(u || '');
      }).catch(() => { });
    } else {
      setDashscopeKeyLoaded(true);
    }
    getVoiceRefineEnabled().then(v => {
      setVoiceRefineEnabled(v);
      setVoiceRefineLoaded(true);
    }).catch(() => setVoiceRefineLoaded(true));
    getVoiceAsrModel().then(m => setVoiceAsrModel(m || '')).catch(() => {});
    getVoiceRefineModel().then(m => setVoiceRefineModel(m || '')).catch(() => {});
    getVoiceRefineBaseUrl().then(u => setRefineBaseUrl(u || '')).catch(() => {});
    setVoiceModelsLoaded(true);
  }, [loadMicDevices]);

  // When navigating to voice section, request mic permission to get device labels
  const micLabelsRequestedRef = useRef(false);
  useEffect(() => {
    if (activeSection === 'voice' && !micLabelsRequestedRef.current) {
      micLabelsRequestedRef.current = true;
      loadMicDevices(true);
    }
  }, [activeSection, loadMicDevices]);

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

    getShellIntegrationEnabled()
      .then(v => {
        setShellIntegrationEnabled(v);
        setShellIntegrationLoaded(true);
      })
      .catch(() => setShellIntegrationLoaded(true));

    getCommitAiApiKey()
      .then(key => {
        const k = key || '';
        // Detect masked key from HTTP mode (e.g. "sk-1...5678") to avoid overwriting real key
        const isMasked = k.includes('...');
        setCommitAiKey(isMasked ? '' : k);
        setCommitAiKeyMasked(isMasked);
        setCommitAiKeyLoaded(true);
      })
      .catch(() => setCommitAiKeyLoaded(true));

    getCommitAiEnabled()
      .then(v => setCommitAiEnabled(v))
      .catch(() => {});
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
  interface MenuItem {
    id: SettingsSection;
    label: string;
    icon: React.ReactNode;
    group?: 'common' | 'advanced' | 'info';
  }

  const menuItems: MenuItem[] = [
    // Common group
    { id: 'workspaces' as SettingsSection, label: t('settings.workspaceConfig'), icon: <Settings className="w-3.5 h-3.5" />, group: 'common' },
    { id: 'appearance' as SettingsSection, label: t('settings.appearance'), icon: <Palette className="w-3.5 h-3.5" />, group: 'common' },
    // Advanced group
    { id: 'tools' as SettingsSection, label: t('settings.toolsNav', '工具'), icon: <Wrench className="w-3.5 h-3.5" />, group: 'advanced' },
    ...(isTauri() ? [{ id: 'share' as SettingsSection, label: t('settings.externalShareNav', '外网分享'), icon: <Globe className="w-3.5 h-3.5" />, group: 'advanced' as const }] : []),
    { id: 'commit' as SettingsSection, label: t('settings.commitNav', '提交设置'), icon: <FileText className="w-3.5 h-3.5" />, group: 'advanced' },
    { id: 'voice' as SettingsSection, label: t('settings.voiceNav'), icon: <Mic className="w-3.5 h-3.5" />, group: 'advanced' },
    // { id: 'cloud' as SettingsSection, label: t('settings.cloudNav', '云端连接'), icon: <Link2 className="w-3.5 h-3.5" /> },
    // Info group
    { id: 'about' as SettingsSection, label: t('settings.about'), icon: <Info className="w-3.5 h-3.5" />, group: 'info' },
  ];

  // ==================== Render ====================
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]/50 shrink-0 bg-[var(--color-bg-base)]/95 backdrop-blur-sm">
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
        <div className="mx-4 mt-2 p-3 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-lg shrink-0">
          <div className="text-[var(--color-error)] text-sm select-text">{error}</div>
          <Button variant="link" size="sm" onClick={onClearError} className="text-[var(--color-error)] hover:text-[var(--color-error)] mt-1 p-0 h-auto">{t('common.close')}</Button>
        </div>
      )}

      {/* Main: left menu + right content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <div className="w-48 shrink-0 border-r border-[var(--color-border)]/50 py-2 overflow-y-auto">
          <nav className="space-y-0.5 px-2">
            {menuItems.map((item, index) => {
              const prevGroup = index > 0 ? menuItems[index - 1].group : null;
              const showDivider = prevGroup !== item.group;

              return (
                <React.Fragment key={item.id}>
                  {showDivider && item.group && (
                    <div className="text-[10px] text-[var(--color-text-muted)] px-2.5 pt-3 pb-1 uppercase tracking-wider">
                      {item.group === 'advanced' ? t('settings.navAdvanced', 'Advanced') :
                       item.group === 'info' ? t('settings.navInfo', 'Info') : null}
                    </div>
                  )}
                  <button
                    onClick={() => setActiveSection(item.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors text-left ${activeSection === item.id
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]'
                    }`}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </button>
                </React.Fragment>
              );
            })}
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
                          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)]/50 border border-transparent'
                          }`}
                      >
                        <span>{ws.name}</span>
                        {currentWorkspace?.path === ws.path && (
                          <span className="text-[10px] text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1 py-0.5 rounded">{t('settings.current')}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Workspace Config */}
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-4">
                  <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{t('settings.workspaceConfig')}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--color-text-muted)] mb-1">{t('settings.workspaceName')}</label>
                      <Input type="text" value={config.name} onChange={(e) => updateField('name', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--color-text-muted)] mb-1">{t('settings.worktreesDirLabel')}</label>
                      <Input type="text" value={config.worktrees_dir} onChange={(e) => updateField('worktrees_dir', e.target.value)} className="h-8 text-sm" />
                    </div>
                  </div>
                  {/* Linked Workspace Items */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5">{t('settings.linkedWorktreeItems')}</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {/* Merge linked_workspace_items + vault synced items, deduplicated, sorted */}
                      {/* Note: vault items have higher priority than custom items.
                          When a path exists in both, only the vault version is kept.
                          The sort order puts vault items before custom items. */}
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
                            <span key={index} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${isVaultManaged ? 'bg-emerald-900/30 border border-emerald-700/40 text-emerald-300' : 'bg-[var(--color-bg-elevated)]/50 border border-[var(--color-border)]/50 text-[var(--color-text-secondary)]'}`}>
                              {isVaultManaged && <Link2 className="w-3 h-3 text-emerald-400" />}
                              {item}{isDir ? '/' : ''}
                              {isInConfig && !isVaultManaged && (
                                <button type="button" onClick={() => removeLinkedItem(config.linked_workspace_items.indexOf(item))} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors ml-0.5">&times;</button>
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
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{t('settings.linkedWorktreeItemsHint')}</p>
                  </div>
                </div>

                {/* 知识库 */}
                <div className="border border-[var(--color-border)]/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-4 h-4 text-[var(--color-accent)]" />
                    <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{t('settings.vaultNav', '知识库')}</h3>
                  </div>
                  <details className="bg-[var(--color-bg-base)] border border-[var(--color-border)]/30 rounded mb-3">
                    <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-secondary)] p-2">
                      {t('settings.vaultGuideSummary', '什么是知识库挂载？点击查看说明')}
                    </summary>
                    <div className="px-3 pb-3 text-xs text-[var(--color-text-secondary)] space-y-1">
                      <p>{t('settings.vaultGuideLine1', '知识库挂载将任意文件夹关联到工作区，通过软链接在工作树中快速访问。参考 Karpathy 的 LLM wiki 流程：把知识库和工作区放在同一父目录下，用相对路径软链接关联。')}</p>
                      <p>{t('settings.vaultGuideLine2', '支持 Obsidian、Zettelkasten、Roam Research 等任意笔记工具。挂载后支持软链接和同步项管理。')}</p>
                    </div>
                  </details>
                  <WorkspaceVaultSection />
                </div>

                {/* Projects Config */}
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{t('settings.projectConfig')}</h3>
                    <div className="flex items-center gap-2">
                      {/* Form/JSON toggle */}
                      <div className="flex bg-[var(--color-bg-elevated)]/50 rounded-md p-0.5">
                        <button
                          onClick={() => setProjectViewMode('form')}
                          className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${projectViewMode === 'form' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                        >{t('settings.formView', '表单')}</button>
                        <button
                          onClick={() => setProjectViewMode('json')}
                          className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${projectViewMode === 'json' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
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
                        <div className="mb-2 p-2 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded text-xs text-[var(--color-error)]">{projectJsonError}</div>
                      )}
                      <textarea
                        value={projectJsonText}
                        onChange={(e) => { setProjectJsonText(e.target.value); setProjectJsonError(null); }}
                        className="w-full h-64 bg-[var(--color-bg-base)] border border-[var(--color-border)]/50 rounded-lg p-3 font-mono text-xs text-[var(--color-text-secondary)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/50 leading-relaxed"
                        spellCheck={false}
                      />
                    </div>
                  )}

                  {/* Form view */}
                  {projectViewMode === 'form' && (
                    <div className="space-y-3">
                      {config.projects.map((proj, index) => (
                        <div key={index} className="bg-[var(--color-bg-base)]/50 border border-[var(--color-border)]/30 rounded-lg p-3">
                          <div className="flex items-start gap-3 mb-2">
                            <div className="w-5 h-5 rounded bg-[var(--color-bg-elevated)]/50 flex items-center justify-center shrink-0 mt-4">
                              <span className="text-[10px] font-mono text-[var(--color-text-muted)]">{index + 1}</span>
                            </div>
                            <div className="flex-1 grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">{t('settings.projectName')}</label>
                                <Input type="text" value={proj.name} onChange={(e) => updateProject(index, 'name', e.target.value)} placeholder="project-name" className="h-7 text-xs" />
                              </div>
                              <div>
                                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">{t('settings.baseBranchLabel')}</label>
                                <BranchCombobox
                                  value={proj.base_branch} onChange={(value) => updateProject(index, 'base_branch', value)}
                                  onLoadBranches={async () => { const wsPath = selectedWsPath || configPath.replace('/.worktree-manager.json', ''); return await getRemoteBranches(`${wsPath}/projects/${proj.name}`); }}
                                  placeholder="main"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">{t('settings.testBranchLabel')}</label>
                                <BranchCombobox
                                  value={proj.test_branch} onChange={(value) => updateProject(index, 'test_branch', value)}
                                  onLoadBranches={async () => { const wsPath = selectedWsPath || configPath.replace('/.worktree-manager.json', ''); return await getRemoteBranches(`${wsPath}/projects/${proj.name}`); }}
                                  placeholder="test"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">{t('settings.mergeStrategyLabel')}</label>
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
                                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">{t('settings.preferredIDE', '偏好 IDE')}</label>
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
                                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">{t('settings.commitPrefixLabel', '前缀模板')}</label>
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
                                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">{t('settings.gitUserNameOverride', 'Git 用户名(覆盖)')}</label>
                                <Input type="text" value={proj.git_user_name || ''}
                                  onChange={(e) => updateProject(index, 'git_user_name', e.target.value || undefined)}
                                  placeholder={t('settings.inheritGlobal', '继承全局')} className="h-7 text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">{t('settings.gitUserEmailOverride', 'Git 邮箱(覆盖)')}</label>
                                <Input type="text" value={proj.git_user_email || ''}
                                  onChange={(e) => updateProject(index, 'git_user_email', e.target.value || undefined)}
                                  placeholder={t('settings.inheritGlobal', '继承全局')} className="h-7 text-xs"
                                />
                              </div>
                            </div>
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" onClick={() => removeProject(index)}
                                    className="h-6 w-6 text-[var(--color-error)]/60 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 shrink-0"
                                  ><TrashIcon className="w-3.5 h-3.5" /></Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">{t('settings.deleteProject')}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          {/* Linked Folders */}
                          <div className="border-t border-[var(--color-border)]/30 pt-2 ml-8">
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] text-[var(--color-text-muted)]">{t('settings.linkedFoldersLabel')}</label>
                              <Button type="button" variant="ghost" size="sm" className="h-5 text-[10px] gap-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] px-1"
                                onClick={() => handleScanProject(proj.name)} disabled={scanningProject === proj.name || !proj.name}
                              >
                                {scanningProject === proj.name ? (<><div className="w-2.5 h-2.5 border border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />{t('settings.scanning')}</>) : (<><Search className="w-2.5 h-2.5" />{t('settings.scan')}</>)}
                              </Button>
                            </div>
                            {/* Scan Results */}
                            {proj.name && (scanResultsMap[proj.name]?.length ?? 0) > 0 && scanningProject !== proj.name && (() => {
                              const projScanResults = scanResultsMap[proj.name] || [];
                              const existingFolders = new Set(proj.linked_folders || []);
                              const filteredResults = projScanResults.filter(r => !existingFolders.has(r.relative_path));
                              if (filteredResults.length === 0) return null;
                              return (
                                <div className="mb-1.5 p-1.5 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 rounded">
                                  <div className="text-[9px] font-medium text-[var(--color-accent)] mb-1">{t('settings.scanResult')}</div>
                                  <div className="space-y-0.5">
                                    {filteredResults.map(result => (
                                      <button key={result.relative_path} type="button" className="w-full flex items-center justify-between px-1.5 py-0.5 text-left rounded hover:bg-[var(--color-accent)]/10 transition-colors"
                                        onClick={() => { const newFolders = [...(proj.linked_folders || []), result.relative_path]; updateProject(index, 'linked_folders', newFolders); }}
                                      >
                                        <span className="text-[10px] text-[var(--color-text-secondary)] font-mono">{result.relative_path}</span>
                                        <span className="text-[9px] text-[var(--color-text-muted)] ml-2">{result.size_display}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                            {(proj.linked_folders || []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {(proj.linked_folders || []).map((folder, folderIdx) => (
                                  <span key={folderIdx} className="inline-flex items-center gap-0.5 bg-[var(--color-bg-elevated)]/50 border border-[var(--color-border)]/50 rounded px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
                                    {folder}
                                    <button type="button" onClick={() => { const nf = [...(proj.linked_folders || [])]; nf.splice(folderIdx, 1); updateProject(index, 'linked_folders', nf); }}
                                      className="text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors">&times;</button>
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
                        <div className="text-center py-6 text-xs text-[var(--color-text-muted)]">
                          {t('settings.noProjects', '暂无项目配置')}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Tag Management */}
                <div className="border-t border-[var(--color-border)]/30 pt-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-medium text-[var(--color-text-primary)] flex items-center gap-2">
                      <Palette className="w-4 h-4" />
                      {t('settings.tagsTitle')}
                    </h3>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('settings.tagsDescription')}</p>
                  </div>

                  <div className="space-y-2">
                    {(config.tags ?? []).map(tag => {
                      const projectCount = config.projects.filter(p => (p.tags ?? []).includes(tag.id)).length;
                      return (
                        <div key={tag.id} className="flex items-center gap-2 bg-[var(--color-bg-base)]/50 border border-[var(--color-border)]/30 rounded-lg px-3 py-2">
                          {/* Color picker - dropdown of preset colors */}
                          <div className="relative">
                            <button
                              className="w-5 h-5 rounded-full border-2 border-[var(--color-border)] shrink-0"
                              style={{ backgroundColor: tag.color }}
                              aria-label={t('settings.tagColor')}
                              onClick={() => setOpenColorPickerId(openColorPickerId === tag.id ? null : tag.id)}
                            />
                            {openColorPickerId === tag.id && (
                              <div className="absolute z-10 top-7 left-0 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-2 shadow-lg grid grid-cols-5 gap-1.5">
                                {TAG_PRESET_COLORS.map(color => (
                                  <button
                                    key={color}
                                    className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                                      tag.color === color ? 'border-[var(--color-accent)] scale-110' : 'border-transparent'
                                    }`}
                                    style={{ backgroundColor: color }}
                                    onClick={() => {
                                      handleUpdateTag(tag.id, 'color', color);
                                      setOpenColorPickerId(null);
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Tag name input */}
                          <Input
                            type="text"
                            value={tag.name}
                            onChange={(e) => handleUpdateTag(tag.id, 'name', e.target.value)}
                            placeholder={t('settings.tagName')}
                            className="h-7 text-xs flex-1"
                          />

                          {/* Project count */}
                          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                            {t('settings.tagProjects', { count: projectCount })}
                          </span>

                          {/* Delete button */}
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    if (projectCount > 0) {
                                      if (!confirm(t('settings.deleteTagConfirm', { name: tag.name, count: projectCount }))) return;
                                    }
                                    handleDeleteTag(tag.id);
                                  }}
                                  className="h-6 w-6 text-[var(--color-error)]/60 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 shrink-0"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">{t('settings.deleteTag')}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add new tag button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAddTag}
                    className="text-xs gap-1.5 text-[var(--color-text-secondary)]"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    {t('settings.addTag')}
                  </Button>
                </div>

                {/* Delete Workspace */}
                {workspaces.length > 1 && onRemoveWorkspace && (
                  <div className="border-t border-[var(--color-border)]/30 pt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[var(--color-error)]/70 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 text-xs gap-1.5"
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
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{t('settings.cannotDeleteCurrent', '当前工作区无法删除')}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ==================== Appearance Section ==================== */}
            {activeSection === 'appearance' && (
              <AppearanceSettingsSection />
            )}

            
            {/* ==================== Tools Section ==================== */}
            {activeSection === 'tools' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.toolsTitle', '工具路径配置')}</h2>
                  <Button variant="secondary" size="sm" onClick={handleDetectTools} disabled={toolsDetecting} className="gap-1.5">
                    <RefreshCw className={`w-3.5 h-3.5 ${toolsDetecting ? 'animate-spin' : ''}`} />
                    {toolsDetecting ? t('settings.detecting', '检测中...') : t('settings.autoDetect', '自动检测')}
                  </Button>
                </div>

                {/* Git */}
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">Git</h3>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">{t('settings.gitPath', 'Git 可执行文件路径')}</label>
                    {detectedTools && detectedTools.git.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {detectedTools.git.map((g, i) => (
                          <button key={i} type="button"
                            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${toolPaths.git === g.path ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)]/50 text-[var(--color-accent)]' : 'bg-[var(--color-bg-elevated)]/50 border-[var(--color-border)]/50 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
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
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{t('settings.terminalTitle', '终端')}</h3>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">{t('settings.defaultTerminal', '默认终端')}</label>
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
                      <div className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-base)]/50 border border-[var(--color-border)]/30 rounded-md px-3 py-2">
                        {t('settings.terminalAutoHint', '当前使用自动检测。点击上方「自动检测」按钮可发现已安装的终端。')}
                      </div>
                    )}
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{t('settings.defaultTerminalHint', '打开终端时使用的默认终端程序')}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">{t('settings.terminalCustomPath', '自定义终端路径（覆盖上方选择）')}</label>
                    <Input type="text" value={toolPaths.terminal_custom || ''} placeholder={t('settings.terminalCustomPlaceholder', '如 C:\\Tools\\cmder\\Cmder.exe 或 /usr/local/bin/fish')}
                      onChange={(e) => {
                        const val = e.target.value;
                        saveToolPaths({ ...toolPaths, terminal_custom: val });
                        // If custom path is set, store it as preferred_terminal for PTY
                        localStorage.setItem('preferred_terminal', val || toolPaths.terminal || 'auto');
                      }}
                      className="h-8 text-sm font-mono"
                    />
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{t('settings.terminalCustomHint', '填写后将忽略上方下拉选择，直接使用该路径作为终端程序')}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-[var(--color-text-secondary)]">{t('settings.shellIntegration')}</label>
                      <p className="text-xs text-[var(--color-text-muted)]">{t('settings.shellIntegrationDesc')}</p>
                    </div>
                    <button type="button"
                      onClick={() => { const newVal = !shellIntegrationEnabled; setShellIntegrationEnabled(newVal); saveShellIntegrationEnabled(newVal).catch(() => {}); }}
                      disabled={!shellIntegrationLoaded}
                      className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${shellIntegrationEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${shellIntegrationEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                </div>

                {/* Shell */}
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{t('settings.shellTitle', 'Shell')}</h3>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">{t('settings.defaultShell', '默认 Shell')}</label>
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
                      <div className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-base)]/50 border border-[var(--color-border)]/30 rounded-md px-3 py-2">
                        {t('settings.shellAutoHint', '当前使用系统默认 Shell。点击上方「自动检测」按钮可发现已安装的 Shell。')}
                      </div>
                    )}
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{t('settings.defaultShellHint', '内置终端面板使用的 Shell 程序（如 zsh、bash、fish）')}</p>
                  </div>
                </div>

                {/* Unified Editor/IDE list */}
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{t('settings.editorTitle', '编辑器 / IDE')}</h3>
                  {(detectedTools?.editors || []).map((editor) => {
                    const pathKey = `editor_${editor.id}`;
                    return (
                      <div key={editor.id} className="flex items-center gap-3 py-1.5 border-t border-[var(--color-border)]/20 first:border-0 first:pt-0">
                        {editor.icon ? (
                          <img src={editor.icon} width={20} height={20} alt="" className="shrink-0 rounded" style={{ imageRendering: 'auto' }} />
                        ) : (
                          <span className="w-5 h-5 shrink-0 flex items-center justify-center text-[var(--color-text-muted)] text-[10px]">⌘</span>
                        )}
                        <div className="w-28 shrink-0">
                          <span className="text-xs text-[var(--color-text-secondary)]">{editor.name}</span>
                        </div>
                        <Input
                          type="text"
                          value={toolPaths[pathKey] || ''}
                          placeholder={editor.path || 'auto'}
                          onChange={(e) => saveToolPaths({ ...toolPaths, [pathKey]: e.target.value })}
                          className="h-7 text-xs font-mono flex-1"
                        />
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors shrink-0"
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
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{t('common.delete', '删除')}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    );
                  })}
                  {/* Add custom editor */}
                  <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border)]/30">
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
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="h-7 px-2 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors shrink-0 flex items-center border border-[var(--color-border)] rounded-md"
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
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{t('settings.browseForApp', '选择应用')}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-success)] transition-colors shrink-0"
                            onClick={async () => {
                              const nameInput = document.getElementById('custom-editor-name') as HTMLInputElement;
                              const pathInput = document.getElementById('custom-editor-path') as HTMLInputElement;
                              let name = nameInput?.value?.trim();
                              const path = pathInput?.value?.trim();
                              if (!path) return;
                              if (!name) {
                                name = path.split(/[/\\]/).pop()?.replace(/\.(app|exe)$/i, '') ?? '';
                                if (!name) return;
                                if (nameInput) nameInput.value = name;
                              }
                              const id = `custom-${name.toLowerCase().replace(/\s+/g, '-')}`;
                              const customs: Array<{ id: string; name: string; path: string }> = JSON.parse(localStorage.getItem('custom_editors') || '[]');
                              const existingIdx = customs.findIndex(c => c.id === id);
                              if (existingIdx >= 0) {
                                customs[existingIdx] = { id, name, path };
                              } else {
                                customs.push({ id, name, path });
                              }
                              localStorage.setItem('custom_editors', JSON.stringify(customs));
                              let iconData = pathInput?.dataset?.pendingIcon;
                              if (!iconData) {
                                iconData = await getAppIcon(path).catch(() => null) ?? undefined;
                              }
                              if (iconData) {
                                const icons: Record<string, string> = JSON.parse(localStorage.getItem('editor_icons') || '{}');
                                icons[id] = iconData;
                                localStorage.setItem('editor_icons', JSON.stringify(icons));
                                if (pathInput?.dataset?.pendingIcon) delete pathInput.dataset.pendingIcon;
                              }
                              const detected: Array<{ id: string; name: string; icon?: string }> = JSON.parse(localStorage.getItem('detected_editors') || '[]');
                              const detIdx = detected.findIndex(e => e.id === id);
                              if (detIdx >= 0) {
                                detected[detIdx] = { id, name, icon: iconData };
                              } else {
                                detected.push({ id, name, icon: iconData });
                              }
                              localStorage.setItem('detected_editors', JSON.stringify(detected));
                              const tp = JSON.parse(localStorage.getItem('tool_paths') || '{}');
                              tp[`editor_${id}`] = path;
                              localStorage.setItem('tool_paths', JSON.stringify(tp));
                              window.dispatchEvent(new Event('editors-detected'));
                              setDetectedTools(prev => {
                                const newEditor = { id, name, path, icon: iconData || undefined };
                                if (!prev) return { git: [], terminals: [], shells: [], editors: [newEditor] };
                                const idx = prev.editors.findIndex(e => e.id === id);
                                if (idx >= 0) {
                                  const editors = [...prev.editors];
                                  editors[idx] = newEditor;
                                  return { ...prev, editors };
                                }
                                return { ...prev, editors: [...prev.editors, newEditor] };
                              });
                              nameInput.value = '';
                              pathInput.value = '';
                            }}
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t('settings.addCustomEditor', '添加')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>

                {/* UI Preferences */}
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{t('settings.uiPreferences', '界面')}</h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-[var(--color-text-secondary)]">{t('settings.showSplitButton', '显示分屏按钮')}</label>
                      <p className="text-xs text-[var(--color-text-muted)]">{t('settings.showSplitButtonDesc', '在右下角显示分屏快捷按钮，用于添加多工作区面板')}</p>
                    </div>
                    <button type="button"
                      onClick={() => {
                        const next = !showSplitButton;
                        setShowSplitButton(next);
                        localStorage.setItem('show_split_button', JSON.stringify(next));
                        window.dispatchEvent(new Event('split-button-changed'));
                      }}
                      className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${showSplitButton ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${showSplitButton ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
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
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{t('settings.ngrokShareSubtitle', 'ngrok 分享')}</h3>
                  <div>
                    <label className="block text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.ngrokAuthtokenLabel')}</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input type={showNgrokToken ? 'text' : 'password'} value={ngrokToken}
                          onChange={(e) => { setNgrokToken(e.target.value); setNgrokSaved(false); }}
                          placeholder={t('settings.ngrokAuthtokenPlaceholder')} className="w-full pr-9"
                        />
                        <button type="button" onClick={() => setShowNgrokToken(v => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                        >{showNgrokToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                      </div>
                      <Button variant="secondary" size="sm" disabled={ngrokSaving}
                        onClick={async () => { setNgrokSaving(true); setNgrokError(null); try { await saveNgrokToken(ngrokToken.trim()); setNgrokSaved(true); setTimeout(() => setNgrokSaved(false), 2000); } catch (e) { setNgrokError(String(e)); } finally { setNgrokSaving(false); } }}
                      >{ngrokSaving ? t('common.saving') : ngrokSaved ? t('settings.savedSuccess') : t('common.save')}</Button>
                    </div>
                    {ngrokError && <p className="text-sm text-[var(--color-error)] mt-1">{ngrokError}</p>}
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {t('settings.ngrokHint')}
                    <button type="button" className="text-[var(--color-accent)] hover:text-[var(--color-accent)] ml-1 underline cursor-pointer transition-colors"
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
                {/* Shared: API Key + Mic */}
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-3 mb-4">
                  {/* Microphone */}
                  <div>
                    <label className="block text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.micDevice')}</label>
                    <div className="flex gap-2">
                      <Select value={selectedMicId || '__default__'}
                        onValueChange={(value) => { const id = value === '__default__' ? '' : value; setSelectedMicId(id); if (id) { localStorage.setItem('preferred-mic-device-id', id); } else { localStorage.removeItem('preferred-mic-device-id'); } }}
                      >
                        <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">{t('settings.defaultDevice')}</SelectItem>
                          {micDevices.map((device, idx) => {
                            const id = device.deviceId || `device-${idx}`;
                            return (
                              <SelectItem key={id} value={id}>{device.label || t('settings.micLabel', { id: id.slice(0, 8) })}</SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <Button variant="secondary" size="sm" onClick={() => { if (micTesting) { stopMicTest(); } else { startMicTest(); } }}>
                        <Mic className="w-4 h-4" />
                        {micTesting ? t('settings.stopTest') : t('settings.test')}
                      </Button>
                    </div>
                    {micTesting && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-[var(--color-text-muted)] shrink-0">{t('settings.volume')}</span>
                        <div className="flex-1 h-2 bg-[var(--color-bg-elevated)] rounded-full overflow-hidden"><div className="h-full bg-green-500 rounded-full" style={{ width: `${micVolume}%` }} /></div>
                      </div>
                    )}
                  </div>
                  {/* Dashscope API Key */}
                  <div>
                    <label className="block text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.dashscopeKeyLabel')}</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input type={showDashscopeKey ? 'text' : 'password'} value={dashscopeKey}
                          onChange={(e) => { setDashscopeKey(e.target.value); setDashscopeSaved(false); }}
                          placeholder={t('settings.dashscopeKeyPlaceholder')} className="w-full pr-9"
                        />
                        <button type="button" onClick={() => setShowDashscopeKey(v => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                        >{showDashscopeKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                      </div>
                      <Button variant="secondary" size="sm" disabled={dashscopeSaving}
                        onClick={async () => { setDashscopeSaving(true); setDashscopeError(null); try { await saveDashscopeApiKey(dashscopeKey.trim()); setDashscopeSaved(true); setTimeout(() => setDashscopeSaved(false), 2000); } catch (e) { setDashscopeError(String(e)); } finally { setDashscopeSaving(false); } }}
                      >{dashscopeSaving ? t('common.saving') : dashscopeSaved ? t('settings.savedSuccess') : t('common.save')}</Button>
                    </div>
                    {dashscopeError && <p className="text-sm text-[var(--color-error)] mt-1">{dashscopeError}</p>}
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      {t('settings.voiceHint')}
                      <button type="button" className="text-[var(--color-accent)] hover:text-[var(--color-accent)] ml-1 underline cursor-pointer transition-colors"
                        onClick={() => openLink('https://dashscope.console.aliyun.com/apiKey')}
                      >{t('settings.getApiKey')}</button>
                    </p>
                  </div>
                </div>

                {/* ASR Section */}
                <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">{t('settings.voiceAsrTitle')}</h3>
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-3 mb-4">
                  {/* ASR WebSocket URL */}
                  <div>
                    <label className="block text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.wsAddressLabel')}</label>
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
                          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        >{t('settings.restoreDefault')}</Button>
                      )}
                    </div>
                    {dashscopeUrlError && <p className="text-sm text-[var(--color-error)] mt-1">{dashscopeUrlError}</p>}
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('settings.wsAddressHint', { url: DEFAULT_DASHSCOPE_URL })}</p>
                  </div>
                  {/* ASR Model */}
                  {voiceModelsLoaded && (
                    <div>
                      <label className="block text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.voiceAsrModel')}</label>
                      <BranchCombobox
                        value={voiceAsrModel}
                        onChange={(v) => { setVoiceAsrModel(v); saveVoiceAsrModel(v.trim()); }}
                        onLoadBranches={async () => [
                          'paraformer-realtime-v2',
                          'paraformer-realtime-v1',
                          'paraformer-realtime-8k-v2',
                          'paraformer-realtime-8k-v1',
                        ]}
                        placeholder="paraformer-realtime-v2"
                      />
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('settings.voiceAsrModelHint')}</p>
                    </div>
                  )}
                  {/* ASR Test */}
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" size="sm" disabled={dashscopeTesting || !dashscopeKey.trim()}
                      onClick={async () => { setDashscopeTesting(true); setDashscopeTestResult(null); try { await saveDashscopeApiKey(dashscopeKey.trim()); if (dashscopeUrl.trim()) { await saveDashscopeBaseUrl(dashscopeUrl.trim()); } await voiceStart(16000); await voiceStop(); setDashscopeTestResult({ ok: true, message: t('settings.connectionSuccess') }); } catch (e) { setDashscopeTestResult({ ok: false, message: String(e) }); } finally { setDashscopeTesting(false); setTimeout(() => setDashscopeTestResult(null), 4000); } }}
                    >
                      {dashscopeTesting ? (<><div className="w-3 h-3 border border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />{t('settings.testing')}</>) : t('settings.testConnection')}
                    </Button>
                    {dashscopeTestResult && (
                      <span className={`text-sm ${dashscopeTestResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>{dashscopeTestResult.message}</span>
                    )}
                  </div>
                </div>

                {/* Refine Section */}
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.voiceRefineTitle')}</h3>
                  <button type="button" onClick={() => { const newVal = !voiceRefineEnabled; setVoiceRefineEnabled(newVal); saveVoiceRefineEnabled(newVal).catch(() => { }); }}
                    disabled={!voiceRefineLoaded}
                    className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${voiceRefineEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`}
                  ><span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${voiceRefineEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} /></button>
                </div>
                {voiceRefineEnabled && (
                  <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-3">
                    <p className="text-xs text-[var(--color-text-muted)]">{t('settings.voiceRefineDesc')}</p>
                    {/* Refine Base URL */}
                    <div>
                      <label className="block text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.refineBaseUrlLabel')}</label>
                      <div className="flex gap-2">
                        <Input type="text" value={refineBaseUrl}
                          onChange={(e) => { setRefineBaseUrl(e.target.value); setRefineUrlSaved(false); }}
                          placeholder={DEFAULT_REFINE_URL} className="flex-1"
                        />
                        <Button variant="secondary" size="sm" disabled={refineUrlSaving}
                          onClick={async () => { setRefineUrlSaving(true); setRefineUrlError(null); try { await saveVoiceRefineBaseUrl(refineBaseUrl.trim()); setRefineUrlSaved(true); setTimeout(() => setRefineUrlSaved(false), 2000); } catch (e) { setRefineUrlError(String(e)); } finally { setRefineUrlSaving(false); } }}
                        >{refineUrlSaving ? t('common.saving') : refineUrlSaved ? t('settings.savedSuccess') : t('common.save')}</Button>
                        {refineBaseUrl && refineBaseUrl !== DEFAULT_REFINE_URL && (
                          <Button variant="ghost" size="sm"
                            onClick={async () => { setRefineBaseUrl(''); setRefineUrlError(null); try { await saveVoiceRefineBaseUrl(''); setRefineUrlSaved(true); setTimeout(() => setRefineUrlSaved(false), 2000); } catch (e) { setRefineUrlError(String(e)); } }}
                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                          >{t('settings.restoreDefault')}</Button>
                        )}
                      </div>
                      {refineUrlError && <p className="text-sm text-[var(--color-error)] mt-1">{refineUrlError}</p>}
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('settings.refineBaseUrlHint', { url: DEFAULT_REFINE_URL })}</p>
                    </div>
                    {/* Refine Model */}
                    {voiceModelsLoaded && (
                      <div>
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.voiceRefineModel')}</label>
                        <BranchCombobox
                          value={voiceRefineModel}
                          onChange={(v) => { setVoiceRefineModel(v); saveVoiceRefineModel(v.trim()); }}
                          onLoadBranches={async () => {
                            const models = await listDashscopeModels();
                            return models.filter(m => m.includes('qwen'));
                          }}
                          placeholder="qwen3.7-max"
                        />
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('settings.voiceRefineModelHint')}</p>
                      </div>
                    )}
                    {/* Refine Test */}
                    <div className="flex items-center gap-3">
                      <Button variant="secondary" size="sm" disabled={refineTesting || !dashscopeKey.trim()}
                        onClick={async () => {
                          setRefineTesting(true); setRefineTestResult(null);
                          try {
                            const result = await voiceRefineText('嗯那个就是我想说的就是这个功能还是蛮好用的然后呃我觉得可以的');
                            setRefineTestResult({ ok: true, message: `${t('settings.refineTestSuccess')}: "${result}"` });
                          } catch (e) {
                            setRefineTestResult({ ok: false, message: String(e) });
                          } finally {
                            setRefineTesting(false);
                            setTimeout(() => setRefineTestResult(null), 8000);
                          }
                        }}
                      >
                        {refineTesting ? (<><div className="w-3 h-3 border border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />{t('settings.testing')}</>) : t('settings.testRefine')}
                      </Button>
                      {refineTestResult && (
                        <span className={`text-sm ${refineTestResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>{refineTestResult.message}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== Commit ==================== */}
            {activeSection === 'commit' && (
              <div>
                <h2 className="text-lg font-medium mb-4">{t('settings.commitTitle', '提交设置')}</h2>
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-4">
                  {/* AI 助手 */}
                  <div>
                    <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-4">{t('settings.commitAiTitle', 'AI 助手')}</h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)]">{t('settings.commitAiLabel', 'AI 生成 commit message')}</label>
                          <p className="text-xs text-[var(--color-text-muted)]">{t('settings.commitAiDesc', '根据 diff 自动生成提交信息')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => { const newVal = !commitAiEnabled; setCommitAiEnabled(newVal); await saveCommitAiEnabled(newVal); }}
                          disabled={!commitAiKeyLoaded}
                          className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${commitAiEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`}
                        >
                          <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${commitAiEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                      <div>
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.commitAiKeyLabel', 'Dashscope API Key')}</label>
                        <div className="flex gap-2">
                          <Input
                            type="password"
                            value={commitAiKey}
                            onChange={(e) => { setCommitAiKey(e.target.value); setCommitAiKeyMasked(false); }}
                            placeholder={commitAiKeyMasked ? t('settings.commitAiKeyMaskedPlaceholder', 'Key already set (enter new key to replace)') : t('settings.commitAiKeyPlaceholder', 'sk-...')}
                            className="flex-1"
                          />
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={commitAiSaving || (commitAiKeyMasked && !commitAiKey.trim())}
                            onClick={async () => {
                              setCommitAiSaving(true);
                              setCommitAiError(null);
                              try {
                                await saveCommitAiApiKey(commitAiKey.trim());
                                setCommitAiSaved(true);
                                setTimeout(() => setCommitAiSaved(false), 2000);
                              } catch (e) {
                                setCommitAiError(String(e));
                              } finally {
                                setCommitAiSaving(false);
                              }
                            }}
                          >
                            {commitAiSaving ? t('common.saving') : commitAiSaved ? t('settings.savedSuccess') : t('common.save')}
                          </Button>
                        </div>
                        {commitAiError && <p className="text-sm text-[var(--color-error)] mt-1">{commitAiError}</p>}
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('settings.commitAiKeyHint', '需要独立的 Dashscope API Key，与语音 Key 分离')}</p>
                      </div>
                    </div>
                  </div>

                  {/* 前缀开关 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-[var(--color-text-secondary)]">{t('settings.prefixEnabled', '启用提交前缀')}</label>
                      <p className="text-xs text-[var(--color-text-muted)]">{t('settings.prefixEnabledDesc', '在 commit message 前自动添加前缀')}</p>
                    </div>
                    <button type="button"
                      onClick={() => setPrefixEnabled(v => !v)}
                      className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${prefixEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${prefixEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>

                  {/* Skip Git Hooks */}
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-[var(--color-text-secondary)]">{t('settings.skipGitHooks', '跳过 Git Hooks')}</label>
                      <p className="text-xs text-[var(--color-text-muted)]">{t('settings.skipGitHooksDesc', '提交时跳过 pre-commit / commit-msg hooks')}</p>
                    </div>
                    <button type="button"
                      onClick={() => { const newVal = !skipGitHooks; setSkipGitHooks(newVal); saveSkipGitHooks(newVal).catch(() => {}); }}
                      disabled={!skipGitHooksLoaded}
                      className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${skipGitHooks ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${skipGitHooks ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>

                  {/* 模板列表 */}
                  {prefixEnabled && (
                    <div className="space-y-2">
                      <label className="block text-sm text-[var(--color-text-secondary)]">{t('settings.prefixTemplates', '前缀模板（最多3个）')}</label>
                      {prefixTemplates.map((tpl, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDefaultPrefixIndex(i)}
                                  className={`px-1.5 ${defaultPrefixIndex === i ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                                >
                                  <Star className={`w-4 h-4 ${defaultPrefixIndex === i ? 'fill-amber-400' : ''}`} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">{t('settings.setDefault', '设为默认')}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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
                              className="text-[var(--color-error)]/60 hover:text-[var(--color-error)]"
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
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {t('settings.prefixVarsHint', '可用变量: {{worktree-name}}, {{project-name}}, {{branch-name}}, {{repo-name}}, {{date}}')}
                      </p>
                    </div>
                  )}

                  <div className="border-t border-[var(--color-border)]/50 pt-4">
                    <Button variant="secondary" size="sm" onClick={handleSavePrefixConfig} disabled={prefixSaving}>
                      {prefixSaving ? t('common.saving') : t('common.save')}
                    </Button>
                  </div>

                  {/* 全局 Git User */}
                  <div className="border-t border-[var(--color-border)]/50 pt-4 space-y-3">
                    <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{t('settings.globalGitUser', '全局 Git 用户')}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">{t('settings.gitUserName', '用户名')}</label>
                        <Input type="text" value={globalGitName}
                          onChange={(e) => setGlobalGitName(e.target.value)}
                          placeholder="Git 用户名" className="text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">{t('settings.gitUserEmail', '邮箱')}</label>
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
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4">
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
                            <p>{t('settings.cloudUsername', '用户名')}: <span className="text-[var(--color-text-secondary)]">{cloudStatus.username}</span></p>
                          )}
                          {cloudStatus.user_email && (
                            <p>{t('settings.cloudEmail', '邮箱')}: <span className="text-[var(--color-text-secondary)]">{cloudStatus.user_email}</span></p>
                          )}
                          {cloudStatus.token_expires_at && (
                            <p>{t('settings.cloudTokenExpiry', 'Token 有效期至')}: <span className="text-[var(--color-text-secondary)]">{new Date(cloudStatus.token_expires_at).toLocaleString()}</span></p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : pairingCode ? (
                    <div className="space-y-3 p-4 border border-[var(--color-border)]/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">{t('settings.cloudPairingHint', '请在 WMS 管理后台输入以下配对码：')}</p>
                      <p className="text-3xl font-mono font-bold text-center tracking-wider">{pairingCode}</p>
                      {pairingStatus?.status === 'claimed' && (
                        <div className="p-3 bg-yellow-50 dark:bg-[var(--color-warning)]/10 rounded">
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
                      <p className="text-sm text-muted-foreground">服务端 <code className="bg-[var(--color-bg-elevated)]/50 px-1.5 py-0.5 rounded text-xs">https://wms.kirov-opensource.com/</code></p>
                      <p className="text-sm text-muted-foreground">设备名称 <code className="bg-[var(--color-bg-elevated)]/50 px-1.5 py-0.5 rounded text-xs">自动获取 hostname</code></p>
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
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4">
                  <div className="flex items-center gap-4 mb-3">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Worktree Manager</h3>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 select-text">{t('settings.versionLabel', { version: appVersion })}</p>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-4">{t('settings.appDescription')}</p>
                  <div className="mb-4">
                    <label className="block text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.language')}</label>
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
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--color-border)]/50">
                      <div>
                        <label className="text-sm text-[var(--color-text-secondary)]">DevTools (F12)</label>
                        <p className="text-xs text-[var(--color-text-muted)]">{t('settings.devToolsDesc', 'Press F12 to open developer tools')}</p>
                      </div>
                      <button type="button" onClick={() => { const newVal = !devConsoleEnabled; setDevConsoleEnabled(newVal); localStorage.setItem('dev-console-enabled', String(newVal)); window.dispatchEvent(new Event('dev-console-enabled-changed')); }}
                        className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${devConsoleEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`}
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
