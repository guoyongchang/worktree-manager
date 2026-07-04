import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/backend', () => ({
  callBackend: vi.fn(),
  getPlatform: () => 'windows',
  isTauri: () => false,
  openLink: vi.fn(),
}));

describe('TerminalPanel mobile voice controls', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'ontouchstart', {
      configurable: true,
      value: () => {},
    });
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    delete (window as Window & { ontouchstart?: unknown }).ontouchstart;
    vi.restoreAllMocks();
  });

  it('starts recording from the mobile floating button when voice is ready', async () => {
    const { TerminalPanel: Panel } = await import('./TerminalPanel');
    const onToggleVoice = vi.fn();
    const onStartRecording = vi.fn();
    const onStopRecording = vi.fn();

    render(
      <Panel
        visible={true}
        height={300}
        onStartResize={vi.fn()}
        terminalTabs={[]}
        activatedTerminals={new Set<string>()}
        mountedTerminals={new Set<string>()}
        activeTerminalTab={null}
        onTabClick={vi.fn()}
        onTabContextMenu={vi.fn()}
        onCloseTab={vi.fn()}
        onCloseAllTabs={vi.fn()}
        onToggle={vi.fn()}
        onCollapse={vi.fn()}
        voiceStatus="ready"
        onToggleVoice={onToggleVoice}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
      />,
    );

    const floatingMic = screen.getByRole('button', { name: 'terminal.holdToRecord' });
    fireEvent.touchStart(floatingMic, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchEnd(floatingMic);

    expect(onStartRecording).toHaveBeenCalledTimes(1);
    expect(onToggleVoice).not.toHaveBeenCalled();
    expect(onStopRecording).not.toHaveBeenCalled();
  });

  it('keeps the mobile floating button anchored during a tap', async () => {
    const { TerminalPanel: Panel } = await import('./TerminalPanel');

    render(
      <Panel
        visible={true}
        height={300}
        onStartResize={vi.fn()}
        terminalTabs={[]}
        activatedTerminals={new Set<string>()}
        mountedTerminals={new Set<string>()}
        activeTerminalTab={null}
        onTabClick={vi.fn()}
        onTabContextMenu={vi.fn()}
        onCloseTab={vi.fn()}
        onCloseAllTabs={vi.fn()}
        onToggle={vi.fn()}
        onCollapse={vi.fn()}
        voiceStatus="ready"
        onToggleVoice={vi.fn()}
        onStartRecording={vi.fn()}
        onStopRecording={vi.fn()}
      />,
    );

    const floatingMic = screen.getByRole('button', { name: 'terminal.holdToRecord' });
    expect(floatingMic).toHaveStyle({ right: '16px', bottom: '80px' });

    fireEvent.touchStart(floatingMic, { touches: [{ clientX: 10, clientY: 10 }] });

    expect(floatingMic).toHaveStyle({ right: '16px', bottom: '80px' });
  });
});
