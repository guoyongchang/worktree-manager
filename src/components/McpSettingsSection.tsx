import { useEffect, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getMcpSettings,
  installMcpClient,
  setMcpCapability,
  setMcpPort,
  type McpCapability,
  type McpClientId,
  type McpSettings,
} from '@/lib/backend';

function serverConfig(): string {
  return JSON.stringify({
    mcpServers: {
      'worktree-manager': {
        command: 'npx',
        args: ['-y', '@worktree-manager/mcp', 'start'],
      },
    },
  }, null, 2);
}

function codexConfig(): string {
  return [
    '[mcp_servers.worktree-manager]',
    'command = "npx"',
    'args = ["-y", "@worktree-manager/mcp", "start"]',
  ].join('\n');
}

type ClientTab = 'claude' | 'cursor' | 'codex' | 'generic';

const TABS: ClientTab[] = ['claude', 'cursor', 'codex', 'generic'];

type Version = {
  id: string;
  labelKey: string;
  install?: McpClientId;
  config: string;
};

function versionsFor(): Record<Exclude<ClientTab, 'generic'>, Version[]> {
  const json = serverConfig();
  return {
    claude: [
      { id: 'claude-code', labelKey: 'settings.mcpClaudeCode', install: 'claude-code', config: json },
      { id: 'claude-desktop', labelKey: 'settings.mcpClaudeDesktop', install: 'claude-desktop', config: json },
    ],
    cursor: [
      { id: 'cursor', labelKey: 'settings.mcpCursorGlobal', install: 'cursor', config: json },
      { id: 'cursor-project', labelKey: 'settings.mcpCursorProject', config: json },
    ],
    codex: [
      { id: 'codex', labelKey: 'settings.mcpCodexCli', install: 'codex', config: codexConfig() },
    ],
  };
}

export const McpSettingsSection: FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<McpSettings | null>(null);
  const [portDraft, setPortDraft] = useState('42819');
  const [tab, setTab] = useState<ClientTab>('claude');
  const [versionId, setVersionId] = useState('claude-code');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = () => {
    getMcpSettings()
      .then((next) => {
        setSettings(next);
        setPortDraft(String(next.http_port));
      })
      .catch((reason) => setError(String(reason)));
  };

  useEffect(() => {
    reload();
  }, []);

  const capability = settings?.capability_level === 'operate' ? 'operate' : 'read';
  const versions = tab === 'generic' ? [] : versionsFor()[tab];
  const version = versions.find((item) => item.id === versionId) ?? versions[0];

  const pathFor = (id: string | undefined) => {
    if (!settings || !id) return '';
    if (id === 'claude-code') return settings.claude_code_path;
    if (id === 'claude-desktop') return settings.claude_desktop_path;
    if (id === 'cursor') return settings.cursor_path;
    if (id === 'cursor-project') return '<project>/.cursor/mcp.json';
    if (id === 'codex') return settings.codex_path;
    return '';
  };

  const installed = (id: string | undefined) => {
    if (!settings || !id) return false;
    if (id === 'claude-code') return settings.claude_installed;
    if (id === 'claude-desktop') return settings.claude_desktop_installed;
    if (id === 'cursor') return settings.cursor_installed;
    if (id === 'codex') return settings.codex_installed;
    return false;
  };

  const selectTab = (next: ClientTab) => {
    setTab(next);
    if (next !== 'generic') setVersionId(versionsFor()[next][0].id);
  };

  const saveCapability = (level: McpCapability) => {
    setMcpCapability(level)
      .then(() => {
        setNotice(t('settings.mcpRestart'));
        reload();
      })
      .catch((reason) => setError(String(reason)));
  };

  const savePort = () => {
    const port = Number(portDraft);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setError(t('settings.mcpPortHint'));
      return;
    }
    setError('');
    setMcpPort(port)
      .then(() => {
        setNotice(t('settings.mcpPortHint'));
        reload();
      })
      .catch((reason) => setError(String(reason)));
  };

  const generic = t('settings.mcpGenericBody', {
    port: settings?.http_port ?? 42819,
    capability: capability === 'operate' ? t('settings.mcpOperate') : t('settings.mcpRead'),
  });

  return (
    <div>
      <h2 className="text-lg font-medium mb-4">{t('settings.mcpTitle')}</h2>
      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)]/50 rounded-lg p-4 space-y-4">
        <p className="text-xs text-[var(--color-text-secondary)]">{t('settings.mcpDesc')}</p>
        <div>
          <div className="text-sm text-[var(--color-text-primary)] mb-2">{t('settings.mcpCommand')}</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-xs">npx -y @worktree-manager/mcp</code>
            <Button size="sm" variant="secondary" onClick={() => void copyText('npx -y @worktree-manager/mcp')}>
              {t('settings.mcpCopy')}
            </Button>
          </div>
        </div>
        <div>
          <div className="text-sm text-[var(--color-text-primary)] mb-2">{t('settings.mcpPort')}</div>
          <div className="flex items-center gap-2">
            <input
              value={portDraft}
              onChange={(event) => setPortDraft(event.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              className="h-8 w-28 rounded border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 text-xs"
            />
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setPortDraft(String(42800 + Math.floor(Math.random() * (42901 - 42800))))}
                  >
                    🎲
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('share.randomPort')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button size="sm" onClick={savePort}>{t('settings.mcpPortSave')}</Button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{t('settings.mcpPortHint')}</p>
        </div>
        <div>
          <div className="text-sm text-[var(--color-text-primary)] mb-2">{t('settings.mcpCapability')}</div>
          <div className="flex flex-wrap gap-2">
            {(['read', 'operate'] as const).map((level) => (
              <Button
                key={level}
                size="sm"
                variant={capability === level ? 'default' : 'secondary'}
                onClick={() => saveCapability(level)}
              >
                {level === 'read' ? t('settings.mcpRead') : t('settings.mcpOperate')}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            {capability === 'operate' ? t('settings.mcpOperateDesc') : t('settings.mcpReadDesc')}
          </p>
          <p className="mt-1 text-xs font-bold text-[var(--color-error)]">{t('settings.mcpOperateConfirm')}</p>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)]/50 pt-4">
          {TABS.map((item) => (
            <Button key={item} size="sm" variant={tab === item ? 'default' : 'secondary'} onClick={() => selectTab(item)}>
              {item === 'generic' ? t('settings.mcpGeneric') : item[0].toUpperCase() + item.slice(1)}
            </Button>
          ))}
        </div>
        {tab === 'generic' ? (
          <div className="space-y-2">
            <p className="text-xs text-[var(--color-text-secondary)]">{t('settings.mcpGenericHint')}</p>
            <pre className="text-xs whitespace-pre-wrap break-all text-[var(--color-text-secondary)]">{generic}</pre>
            <Button size="sm" variant="secondary" onClick={() => void copyText(generic)}>
              {t('settings.mcpCopy')}
            </Button>
          </div>
        ) : version && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {versions.map((item) => (
                <Button key={item.id} size="sm" variant={version.id === item.id ? 'default' : 'secondary'} onClick={() => setVersionId(item.id)}>
                  {t(item.labelKey)}
                </Button>
              ))}
            </div>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {pathFor(version.id)}
              {installed(version.id) ? ` · ${t('settings.mcpInstalled')}` : ''}
            </div>
            {!version.install && <p className="text-xs text-[var(--color-text-secondary)]">{t('settings.mcpProjectOnly')}</p>}
            <pre className="text-xs whitespace-pre-wrap break-all text-[var(--color-text-secondary)]">{version.config}</pre>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void copyText(version.config)}>
                {t('settings.mcpCopy')}
              </Button>
              {version.install && (
                <Button
                  size="sm"
                  onClick={() => {
                    installMcpClient(version.install!)
                      .then((path) => {
                        setNotice(path);
                        reload();
                      })
                      .catch((reason) => setError(String(reason)));
                  }}
                >
                  {t('settings.mcpInstall')}
                </Button>
              )}
            </div>
          </div>
        )}
        {notice && <p className="text-xs text-[var(--color-text-secondary)]">{notice}</p>}
        {error && <p className="text-xs text-[var(--color-warning)]">{error}</p>}
      </div>
    </div>
  );
};
