import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface Props {
  children: ReactNode;
  t: TFunction;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
  systemInfo: SystemInfo;
  copied: boolean;
}

interface SystemInfo {
  platform: string;
  userAgentOs: string;
  appVersion: string;
  tauriVersion: string;
  language: string;
  screenResolution: string;
}

const ISSUE_URL = 'https://github.com/guoyongchang/worktree-manager/issues/new';

/** Patterns that indicate sensitive data that should be masked */
const SENSITIVE_PATTERNS = [
  // API keys, tokens, secrets
  { pattern: /api[_-]?key/gi, label: 'api_key' },
  { pattern: /token/gi, label: 'token' },
  { pattern: /password/gi, label: 'password' },
  { pattern: /secret/gi, label: 'secret' },
  // Authorization headers with actual keys
  { pattern: /authorization[\s:=]+[A-Za-z0-9_-]+/gi, label: 'Authorization' },
  // IP addresses
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, label: 'IP' },
];

/** Username paths like /Users/XXXX/ or /home/XXXX/ */
const USERNAME_PATH_PATTERN = /\/Users\/[^/]+\//g;

/**
 * Mask sensitive values in a string while keeping the key/pattern name visible.
 * Replaces detected sensitive values with [MASKED].
 */
function maskSensitiveData(text: string): string {
  let result = text;

  // Mask username paths (replace the username portion)
  result = result.replace(USERNAME_PATH_PATTERN, (match) => {
    return match.replace(/(\/Users\/|\/home\/)([^/]+)(\/)/, '$1[MASKED]$3');
  });

  // Mask values associated with sensitive keywords
  for (const { pattern } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // Check if it's a key=value or key: value pattern
      if (/^[A-Za-z_][A-Za-z0-9_]*[=:][^=:\n]+$/.test(match)) {
        return match.replace(/=[^=:\n]+$/, '=[MASKED]').replace(/:[^=:\n]+$/, ':[MASKED]');
      }
      // Check if it's an Authorization header with a key
      if (/^authorization[\s:=]+[A-Za-z0-9_-]+$/i.test(match)) {
        return 'Authorization: [MASKED]';
      }
      // For standalone sensitive words followed by actual values (like "key: sk-xxx")
      return match.replace(/(key|token|password|secret|api[_-]?key)[^\n]*$/i, '$1=[MASKED]');
    });
  }

  // Generic key=value masking for any remaining suspicious patterns
  result = result.replace(/(api[_-]?key|token|password|secret|authorization)[\s'"]*[=:][\s'"]*([A-Za-z0-9_-]{4,})/gi, '$1=[MASKED]');

  return result;
}

/** Extract a readable OS name from navigator.userAgent */
function extractOsFromUA(ua: string): string {
  if (ua.includes('Mac OS X') || ua.includes('macOS')) {
    const m = ua.match(/Mac OS X ([0-9_]+)/);
    return m ? `macOS ${m[1].replace(/_/g, '.')}` : 'macOS';
  }
  if (ua.includes('Win')) {
    const m = ua.match(/Windows NT ([0-9.]+)/);
    return m ? `Windows ${m[1]}` : 'Windows';
  }
  if (ua.includes('Linux') && !ua.includes('Android')) {
    return 'Linux';
  }
  return 'Unknown';
}

/** Check Tauri environment without importing backend (to avoid module load issues during crash) */
function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/** Gather system information at crash time */
function collectSystemInfo(): SystemInfo {
  const ua = navigator.userAgent;

  let appVersion = 'unknown';
  try {
    appVersion = localStorage.getItem('app_version') || 'unknown';
  } catch { /* localStorage may be unavailable */ }

  let tauriVersion = 'N/A';
  if (isTauri()) {
    try {
      const internals = (window as any).__TAURI_INTERNALS__;
      if (internals?.metadata?.version) {
        tauriVersion = internals.metadata.version;
      } else {
        tauriVersion = localStorage.getItem('tauri_version') || 'unknown';
      }
    } catch {
      tauriVersion = 'unknown';
    }
  }

  return {
    platform: navigator.platform || 'unknown',
    userAgentOs: extractOsFromUA(ua),
    appVersion,
    tauriVersion,
    language: navigator.language || 'unknown',
    screenResolution: (() => {
      try { return `${window.screen.width}x${window.screen.height}`; } catch { return 'unknown'; }
    })(),
  };
}

/** Build a short error summary for the GitHub issue title */
function buildIssueTitle(error: Error): string {
  const msg = error.message || 'Unknown error';
  return msg.length > 80 ? msg.substring(0, 77) + '...' : msg;
}

/** Build the GitHub issue body as markdown */
function buildIssueBody(error: Error, errorInfo: string, systemInfo: SystemInfo): string {
  // Apply privacy filtering to all user-generated content
  const maskedMessage = maskSensitiveData(error.message);
  const maskedStack = maskSensitiveData(error.stack || '(no stack)');
  const maskedErrorInfo = maskSensitiveData(errorInfo);
  const maskedUrl = maskSensitiveData(window.location.href);

  const lines = [
    '## Error Details',
    '',
    '```',
    `Error: ${maskedMessage}`,
    '```',
    '',
    '## Stack Trace',
    '',
    '```',
    maskedStack,
    '```',
    '',
    '## Component Stack',
    '',
    maskedErrorInfo ? '```\n' + maskedErrorInfo + '\n```' : '_N/A_',
    '',
    '## System Information',
    '',
    `| Key | Value |`,
    `|-----|-------|`,
    `| OS | ${systemInfo.userAgentOs} |`,
    `| Platform | ${systemInfo.platform} |`,
    `| App Version | ${systemInfo.appVersion} |`,
    `| Tauri | ${systemInfo.tauriVersion} |`,
    `| Language | ${systemInfo.language} |`,
    `| Screen Resolution | ${systemInfo.screenResolution} |`,
    `| URL | ${maskedUrl} |`,
    `| Time | ${new Date().toISOString()} |`,
    '',
    '_⚠️ Please review and mask any sensitive info (API keys, tokens, usernames, IPs) before posting._',
    '',
    '---',
    '_Automatically generated by ErrorBoundary_',
  ];

  return lines.join('\n');
}

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: '',
    systemInfo: {
      platform: '',
      userAgentOs: '',
      appVersion: '',
      tauriVersion: '',
      language: '',
      screenResolution: '',
    },
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const sysInfo = collectSystemInfo();

    const errorInfo = [
      `Error: ${error.message}`,
      '',
      `Stack:`,
      error.stack || '(no stack)',
      '',
      `Component Stack:`,
      info.componentStack || '(no component stack)',
    ].join('\n');

    this.setState({ errorInfo, systemInfo: sysInfo });
    console.error('[ErrorBoundary] Uncaught error:', error, info);
  }

  handleCopy = () => {
    const { errorInfo, systemInfo } = this.state;
    const fullText = [
      errorInfo,
      '',
      '--- System Info ---',
      `UserAgent: ${navigator.userAgent}`,
      `Platform: ${systemInfo.platform}`,
      `OS: ${systemInfo.userAgentOs}`,
      `App Version: ${systemInfo.appVersion}`,
      `Tauri Version: ${systemInfo.tauriVersion}`,
      `Language: ${systemInfo.language}`,
      `Screen: ${systemInfo.screenResolution}`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n');

    navigator.clipboard.writeText(fullText).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }).catch(() => {
      const el = document.querySelector<HTMLTextAreaElement>('#error-boundary-details');
      if (el) { el.select(); document.execCommand('copy'); }
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleReportIssue = () => {
    const { error, errorInfo, systemInfo } = this.state;
    if (!error) return;

    const title = encodeURIComponent(buildIssueTitle(error));
    const body = encodeURIComponent(buildIssueBody(error, errorInfo, systemInfo));
    const url = `${ISSUE_URL}?title=${title}&body=${body}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  render() {
    const { t } = this.props;
    if (!this.state.hasError) return this.props.children;

    const { error, errorInfo, systemInfo, copied } = this.state;

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', padding: '32px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#0f0f0f', color: '#e0e0e0', overflow: 'auto',
      }}>
        <div style={{ maxWidth: 640, width: '100%', textAlign: 'center' }}>
          {/* Icon */}
          <div style={{ fontSize: 48, marginBottom: 16 }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block' }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>
            {t('error.crashTitle')}
          </h1>
          <p style={{ fontSize: 14, color: '#999', margin: '0 0 24px' }}>
            {t('error.crashDesc')}
          </p>

          {/* Error message + stack */}
          <div style={{
            background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
            padding: 16, marginBottom: 16, textAlign: 'left',
          }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#ef4444', marginBottom: 8 }}>
              {error?.message || 'Unknown error'}
            </div>
            <textarea
              id="error-boundary-details"
              readOnly
              value={errorInfo}
              style={{
                width: '100%', height: 120, resize: 'vertical',
                background: '#111', color: '#aaa', border: '1px solid #2a2a2a', borderRadius: 4,
                padding: 8, fontSize: 11, fontFamily: 'monospace', lineHeight: 1.4,
              }}
            />
          </div>

          {/* System Info */}
          <div style={{
            background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
            padding: 16, marginBottom: 16, textAlign: 'left',
          }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: '#ccc', margin: '0 0 12px' }}>
              {t('error.systemInfo')}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12 }}>
              <InfoRow label={t('error.osInfo')} value={systemInfo.userAgentOs} />
              <InfoRow label={t('error.appVersion')} value={`v${systemInfo.appVersion}`} />
              {systemInfo.tauriVersion !== 'N/A' && (
                <InfoRow label="Tauri" value={`v${systemInfo.tauriVersion}`} />
              )}
              <InfoRow label={t('error.screenResolution')} value={systemInfo.screenResolution} />
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={this.handleCopy} style={{
              padding: '8px 20px', borderRadius: 6, border: '1px solid #333',
              background: '#1a1a1a', color: '#e0e0e0', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              transition: 'background 0.2s',
            }}>
              {copied ? t('error.copied') : t('error.copyInfo')}
            </button>
            <button onClick={this.handleReload} style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              transition: 'background 0.2s',
            }}>
              {t('error.reload')}
            </button>
            <button onClick={this.handleReportIssue} style={{
              padding: '8px 20px', borderRadius: 6, border: '1px solid #333',
              background: '#1a1a1a', color: '#e0e0e0', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              transition: 'background 0.2s',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {t('error.reportIssue')}
            </button>
          </div>

          <p style={{ fontSize: 12, color: '#666', marginTop: 24 }}>
            {t('error.hint')}
          </p>
        </div>
      </div>
    );
  }
}

/** Simple key-value row for system info display */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
      <span style={{ color: '#666', flexShrink: 0 }}>{label}:</span>
      <span style={{ color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

/** Functional wrapper that injects i18n t() into the class-based error boundary */
function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <ErrorBoundaryInner t={t}>{children}</ErrorBoundaryInner>;
}

export { ErrorBoundary };
