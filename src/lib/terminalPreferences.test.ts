import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import {
  getPreferredExternalTerminal,
  getPreferredPtyShell,
  getShellForTerminalLaunch,
  getTerminalPreferenceDebugInfo,
  logTerminalPreferenceDebugInfo,
} from './terminalPreferences';

describe('getPreferredPtyShell', () => {
  const originalUserAgent = navigator.userAgent;

  function setUserAgent(value: string) {
    Object.defineProperty(window.navigator, 'userAgent', {
      value,
      configurable: true,
    });
  }

  beforeEach(() => {
    localStorage.clear();
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  });

  afterAll(() => {
    setUserAgent(originalUserAgent);
  });

  it('uses the explicit shell preference for built-in PTY sessions', () => {
    localStorage.setItem('preferred_shell', 'cmd');
    localStorage.setItem('preferred_terminal', 'gitbash');

    expect(getPreferredPtyShell()).toBe('cmd');
  });

  it('falls back to shell-compatible terminal preferences when no shell is set', () => {
    localStorage.setItem('preferred_terminal', 'gitbash');

    expect(getPreferredPtyShell()).toBe('gitbash');
  });

  it('uses persisted tool path terminal settings when legacy preferred_terminal is missing', () => {
    localStorage.setItem('tool_paths', JSON.stringify({ terminal: 'gitbash' }));

    expect(getPreferredExternalTerminal()).toBe('gitbash');
  });

  it('prefers custom terminal path from tool_paths over selected terminal id', () => {
    localStorage.setItem('tool_paths', JSON.stringify({
      terminal: 'windowsterminal',
      terminal_custom: 'C:\\Tools\\WezTerm\\wezterm-gui.exe',
    }));

    expect(getPreferredExternalTerminal()).toBe('C:\\Tools\\WezTerm\\wezterm-gui.exe');
  });

  it('uses persisted tool path shell settings for Windows Terminal launches', () => {
    localStorage.setItem('tool_paths', JSON.stringify({
      terminal: 'windowsterminal',
      shell: 'gitbash',
    }));

    expect(getShellForTerminalLaunch('windowsterminal')).toBe('gitbash');
  });

  it('includes resolved terminal settings in debug info', () => {
    localStorage.setItem('tool_paths', JSON.stringify({
      terminal: 'windowsterminal',
      shell: 'cmd',
    }));

    expect(getTerminalPreferenceDebugInfo()).toMatchObject({
      'Preferred Terminal': 'not set',
      'Tool Paths Terminal': 'windowsterminal',
      'Tool Paths Shell': 'cmd',
      'Resolved External Terminal': 'windowsterminal',
      'Resolved PTY Shell': 'cmd',
      'Resolved Launch Shell': 'cmd',
    });
  });

  it('prints terminal preference debug details to the console', () => {
    localStorage.setItem('tool_paths', JSON.stringify({
      terminal: 'windowsterminal',
      shell: 'cmd',
    }));
    const logger = { info: vi.fn() };

    logTerminalPreferenceDebugInfo(
      'open_in_terminal',
      { path: 'C:\\repo', terminal: 'windowsterminal', shell: 'cmd' },
      localStorage,
      'windowsterminal',
      logger,
    );

    expect(logger.info).toHaveBeenCalledWith('[terminal-preferences]', expect.objectContaining({
      event: 'open_in_terminal',
      path: 'C:\\repo',
      terminal: 'windowsterminal',
      shell: 'cmd',
      preferences: expect.objectContaining({
        'Resolved External Terminal': 'windowsterminal',
        'Resolved Launch Shell': 'cmd',
      }),
    }));
  });

  it('does not pass Windows Terminal itself as a PTY shell', () => {
    localStorage.setItem('preferred_terminal', 'windowsterminal');

    expect(getPreferredPtyShell()).toBeUndefined();
  });

  it('ignores PowerShell shell preferences on non-Windows platforms', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    localStorage.setItem('preferred_shell', 'pwsh');

    expect(getPreferredPtyShell()).toBeUndefined();
  });
});
