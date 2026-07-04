import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backendMocks = vi.hoisted(() => ({
  voiceStart: vi.fn(),
  voiceSendAudio: vi.fn(),
  voiceStop: vi.fn(),
  voiceRefineText: vi.fn(),
  getVoiceRefineEnabled: vi.fn(),
  isTauri: vi.fn(),
}));

const websocketMocks = vi.hoisted(() => {
  const state: {
    handler?: (event: string, payload: Record<string, unknown>) => void;
  } = {};
  const unsubscribe = vi.fn();
  const manager = {
    subscribeVoiceEvents: vi.fn((handler: (event: string, payload: Record<string, unknown>) => void) => {
      state.handler = handler;
      return unsubscribe;
    }),
  };

  return { manager, state, unsubscribe };
});

vi.mock('../lib/backend', () => backendMocks);

vi.mock('../lib/websocket', () => ({
  getWebSocketManager: () => websocketMocks.manager,
}));

import { appendFinalVoiceText, useVoiceInput, type StagingState } from './useVoiceInput';

function staging(overrides: Partial<StagingState> = {}): StagingState {
  return {
    rawText: '',
    interimText: '',
    refinedText: '',
    isRefining: false,
    refineFailed: false,
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('appendFinalVoiceText', () => {
  it('starts a fresh refine when final text is appended after a previous refine', () => {
    const update = appendFinalVoiceText(
      staging({
        rawText: '第一句话',
        interimText: '临时文本',
        refinedText: '精炼后的第一句话',
      }),
      ' 第二句话 ',
      true,
    );

    expect(update).toEqual({
      staging: staging({
        rawText: '第一句话第二句话',
        refinedText: '',
        isRefining: true,
      }),
      rawTextForRefine: '第一句话第二句话',
    });
  });

  it('does not keep stale refined text when refine is disabled', () => {
    const update = appendFinalVoiceText(
      staging({
        rawText: 'first',
        refinedText: 'old refined text',
      }),
      ' second',
      false,
    );

    expect(update).toEqual({
      staging: staging({
        rawText: 'firstsecond',
      }),
      rawTextForRefine: null,
    });
  });
});

describe('useVoiceInput refine flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    websocketMocks.state.handler = undefined;

    backendMocks.isTauri.mockReturnValue(false);
    backendMocks.getVoiceRefineEnabled.mockResolvedValue(true);
    backendMocks.voiceStart.mockResolvedValue(undefined);
    backendMocks.voiceStop.mockResolvedValue(undefined);
    backendMocks.voiceRefineText.mockImplementation(async (text: string) => `refined:${text}`);

    const track = { stop: vi.fn() };
    const stream = {
      getAudioTracks: vi.fn(() => [track]),
      getTracks: vi.fn(() => [track]),
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });

    class MockAudioContext {
      sampleRate = 16000;
      state = 'running';
      destination = {};
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
      createAnalyser = vi.fn(() => ({
        fftSize: 0,
        connect: vi.fn(),
        disconnect: vi.fn(),
        getByteFrequencyData: vi.fn(),
      }));
      createScriptProcessor = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null,
      }));
      close = vi.fn(async () => undefined);
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('calls voice refine again with accumulated text when a later final result arrives', async () => {
    const { result, unmount } = renderHook(() => useVoiceInput(vi.fn()));

    await act(async () => {
      await flushMicrotasks();
    });
    expect(websocketMocks.manager.subscribeVoiceEvents).toHaveBeenCalledTimes(1);
    expect(websocketMocks.state.handler).toBeDefined();

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      websocketMocks.state.handler?.('voice-result', { text: '第一句话', is_final: true });
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(backendMocks.voiceRefineText).toHaveBeenCalledTimes(1);
    expect(backendMocks.voiceRefineText).toHaveBeenLastCalledWith('第一句话');
    expect(result.current.staging?.refinedText).toBe('refined:第一句话');

    await act(async () => {
      websocketMocks.state.handler?.('voice-result', { text: '第二句话', is_final: true });
    });

    expect(result.current.staging?.rawText).toBe('第一句话第二句话');
    expect(result.current.staging?.refinedText).toBe('');
    expect(result.current.staging?.isRefining).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(backendMocks.voiceRefineText).toHaveBeenCalledTimes(2);
    expect(backendMocks.voiceRefineText).toHaveBeenLastCalledWith('第一句话第二句话');
    expect(result.current.staging?.refinedText).toBe('refined:第一句话第二句话');

    unmount();
  });

  it('ignores an in-flight stale refine result after a later final result arrives', async () => {
    const firstRefine = deferred<string>();
    const secondRefine = deferred<string>();
    backendMocks.voiceRefineText
      .mockImplementationOnce(() => firstRefine.promise)
      .mockImplementationOnce(() => secondRefine.promise);

    const { result, unmount } = renderHook(() => useVoiceInput(vi.fn()));

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      websocketMocks.state.handler?.('voice-result', { text: '第一句话', is_final: true });
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(backendMocks.voiceRefineText).toHaveBeenCalledTimes(1);

    await act(async () => {
      websocketMocks.state.handler?.('voice-result', { text: '第二句话', is_final: true });
    });
    expect(result.current.staging?.refinedText).toBe('');

    await act(async () => {
      firstRefine.resolve('stale:first');
      await flushMicrotasks();
    });
    expect(result.current.staging?.refinedText).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(backendMocks.voiceRefineText).toHaveBeenCalledTimes(2);
    expect(backendMocks.voiceRefineText).toHaveBeenLastCalledWith('第一句话第二句话');

    await act(async () => {
      secondRefine.resolve('fresh:both');
      await flushMicrotasks();
    });
    expect(result.current.staging?.refinedText).toBe('fresh:both');

    unmount();
  });
});
