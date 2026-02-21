import { useState, useRef, useCallback, useEffect } from 'react';
import i18next from 'i18next';
import { voiceStart, voiceSendAudio, voiceStop, voiceRefineText, isTauri } from '../lib/backend';

/**
 * 状态机：
 *   idle    → 未开启，麦克风未获取
 *   ready   → 麦克风已打开，等待 Alt+V 触发录音
 *   recording → 按住 Alt+V，正在向 Dashscope 发送音频
 *   error   → 出错
 *
 * 流程：
 *   点击麦克风按钮: idle → ready（获取麦克风）  /  ready → idle（释放麦克风）
 *   按下 Alt+V:     ready → recording（连接 Dashscope，开始发送音频）
 *   松开 Alt+V:     recording → ready（停止 Dashscope，麦克风保持）
 *
 * 暂存区（Staging）：
 *   录音期间，转写结果累积到暂存区而非直接写入终端。
 *   后台调用 Qwen LLM 对累积文本做 AI 优化（去语气词、精简表达）。
 *   松开 Alt+V 后，将 AI 优化后的文本（或兜底原始文本）发送到终端。
 */
export type VoiceStatus = 'idle' | 'ready' | 'recording' | 'error';

export interface StagingState {
  rawText: string;       // 累积的所有 final 句子
  interimText: string;   // 当前正在说的 interim 文本
  refinedText: string;   // AI 优化后的文本
  isRefining: boolean;   // AI 请求中
  refineFailed: boolean; // AI 失败标记
}

export interface UseVoiceInputReturn {
  voiceStatus: VoiceStatus;
  voiceError: string | null;
  isKeyHeld: boolean;
  analyserNode: AnalyserNode | null;
  staging: StagingState | null;
  toggleVoice: () => void;
  stopVoice: () => void;
  startRecording: () => void;
  stopRecording: () => void;
}

function float32ToBase64Pcm(samples: Float32Array): string {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useVoiceInput(
  onTranscribed: (text: string) => void,
): UseVoiceInputReturn {
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isKeyHeld, setIsKeyHeld] = useState(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [staging, setStaging] = useState<StagingState | null>(null);

  // 音频管道（在 ready 和 recording 期间保持）
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sampleRateRef = useRef(16000);

  // 控制是否发送音频数据的开关
  const isStreamingRef = useRef(false);

  // 防重入
  const busyRef = useRef(false);

  // 用 ref 追踪状态，避免 keyboard handler 闭包过期
  const voiceStatusRef = useRef(voiceStatus);
  voiceStatusRef.current = voiceStatus;

  // Staging refs for async callbacks
  const stagingRef = useRef<StagingState | null>(null);
  const refineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refineAbortRef = useRef<AbortController | null>(null);
  const pendingSendRef = useRef(false);
  const lastFinalRef = useRef(''); // 前端去重：跳过 Dashscope finish-task 重发的同句 final
  const onTranscribedRef = useRef(onTranscribed);
  onTranscribedRef.current = onTranscribed;

  // Keep stagingRef in sync
  useEffect(() => { stagingRef.current = staging; }, [staging]);

  // ---- AI 文本优化（500ms 防抖）----
  const triggerRefine = useCallback((rawText: string) => {
    // Clear previous timer
    if (refineTimerRef.current) {
      clearTimeout(refineTimerRef.current);
    }

    refineTimerRef.current = setTimeout(async () => {
      // Abort previous request
      if (refineAbortRef.current) {
        refineAbortRef.current.abort();
      }
      const abort = new AbortController();
      refineAbortRef.current = abort;

      setStaging(prev => prev ? { ...prev, isRefining: true } : prev);

      try {
        const refined = await voiceRefineText(rawText);
        if (abort.signal.aborted) return;
        setStaging(prev => prev ? {
          ...prev,
          refinedText: refined,
          isRefining: false,
          refineFailed: false,
        } : prev);
      } catch {
        if (abort.signal.aborted) return;
        setStaging(prev => prev ? {
          ...prev,
          isRefining: false,
          refineFailed: true,
        } : prev);
      }
    }, 500);
  }, []);

  // ---- 最终发送 ----
  const finalizeStagingAndSend = useCallback(() => {
    const s = stagingRef.current;
    if (!s || !s.rawText.trim()) {
      setStaging(null);
      return;
    }
    // Prefer refined text if available and not failed
    const textToSend = (s.refinedText && !s.refineFailed) ? s.refinedText : s.rawText;
    onTranscribedRef.current(textToSend);
    setStaging(null);
  }, []);

  // ---- 清理 staging 状态 ----
  const clearStaging = useCallback(() => {
    if (refineTimerRef.current) {
      clearTimeout(refineTimerRef.current);
      refineTimerRef.current = null;
    }
    if (refineAbortRef.current) {
      refineAbortRef.current.abort();
      refineAbortRef.current = null;
    }
    pendingSendRef.current = false;
    setStaging(null);
  }, []);

  // ---- 释放全部音频资源 ----
  const cleanupAudio = useCallback(() => {
    isStreamingRef.current = false;
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    setAnalyserNode(null);
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  // ---- 进入 ready 状态：获取麦克风，建立音频管道 ----
  const enterReady = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setVoiceError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(i18next.t('voice.micNeedsHttps'));
      }

      const preferredDeviceId = localStorage.getItem('preferred-mic-device-id');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          ...(preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : {}),
        },
      });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      sampleRateRef.current = audioCtx.sampleRate;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // AnalyserNode 用于 UI 波形绘制
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      setAnalyserNode(analyser);

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // onaudioprocess 始终运行，但只在 isStreamingRef.current === true 时发送数据
      processor.onaudioprocess = (e) => {
        if (!isStreamingRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const base64Data = float32ToBase64Pcm(inputData);
        voiceSendAudio(base64Data).catch(() => {});
      };

      // source → analyser → processor → destination
      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(audioCtx.destination);

      setVoiceStatus('ready');
    } catch (e) {
      cleanupAudio();
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setVoiceError(i18next.t('voice.permissionDenied'));
      } else if (msg.includes('NotFound') || msg.includes('audio-capture')) {
        setVoiceError(i18next.t('voice.noMicDetected'));
      } else {
        setVoiceError(msg);
      }
      setVoiceStatus('error');
    } finally {
      busyRef.current = false;
    }
  }, [cleanupAudio]);

  // ---- 退出 ready 状态：释放麦克风 ----
  const exitReady = useCallback(async () => {
    isStreamingRef.current = false;
    await voiceStop().catch(() => {});
    cleanupAudio();
    clearStaging();
    setVoiceStatus('idle');
    setIsKeyHeld(false);
  }, [cleanupAudio, clearStaging]);

  // ---- 开始录音：连接 Dashscope，打开音频发送开关，初始化暂存区 ----
  const startStreaming = useCallback(async () => {
    if (busyRef.current) return;
    if (voiceStatusRef.current !== 'ready') return;
    busyRef.current = true;

    try {
      await voiceStart(sampleRateRef.current);
      isStreamingRef.current = true;
      // 初始化暂存区
      setStaging({
        rawText: '',
        interimText: '',
        refinedText: '',
        isRefining: false,
        refineFailed: false,
      });
      pendingSendRef.current = false;
      lastFinalRef.current = '';
      setVoiceStatus('recording');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVoiceError(msg);
      // 连接 Dashscope 失败不影响 ready 状态
      setVoiceStatus('ready');
    } finally {
      busyRef.current = false;
    }
  }, []);

  // ---- 停止录音：关闭音频发送，断开 Dashscope，回到 ready ----
  const stopStreaming = useCallback(async () => {
    isStreamingRef.current = false;
    pendingSendRef.current = true;
    await voiceStop().catch(() => {});
    // voice-stopped 事件会触发 finalizeStagingAndSend
    // 但如果事件已经触发了（racing），主动检查
    if (voiceStatusRef.current === 'recording') {
      setVoiceStatus('ready');
    }
  }, []);

  // ---- toggleVoice：麦克风按钮点击，切换 idle ↔ ready ----
  const toggleVoice = useCallback(() => {
    const status = voiceStatusRef.current;
    if (status === 'idle' || status === 'error') {
      enterReady();
    } else if (status === 'ready') {
      exitReady();
    } else if (status === 'recording') {
      // 录音中点击按钮 → 直接关闭一切
      exitReady();
    }
  }, [enterReady, exitReady]);

  // ---- 监听后端语音事件（Tauri 事件 / WebSocket） ----
  useEffect(() => {
    let unlisten: Array<() => void> = [];

    const handleVoiceEvent = (event: string, payload: Record<string, unknown>) => {
      // Only process voice events if this client has an active voice session (microphone acquired).
      if (!mediaStreamRef.current) return;

      switch (event) {
        case 'voice-result': {
          const text = payload.text as string;
          const isFinal = payload.is_final as boolean;
          if (isFinal && text?.trim()) {
            const trimmed = text.trim();
            // 前端去重：Dashscope finish-task 后可能重发最后一句（标点微变），跳过
            if (trimmed === lastFinalRef.current) break;
            lastFinalRef.current = trimmed;
            // 累积到暂存区 rawText，然后触发 AI 优化
            setStaging(prev => {
              if (!prev) return prev;
              const newRaw = prev.rawText ? prev.rawText + trimmed : trimmed;
              return { ...prev, rawText: newRaw, interimText: '' };
            });
            // 副作用放在 setter 外面
            const currentRaw = stagingRef.current?.rawText ?? '';
            const newRawForRefine = currentRaw ? currentRaw + trimmed : trimmed;
            triggerRefine(newRawForRefine);
          } else if (!isFinal && text) {
            // interim → 更新暂存区灰色文本
            setStaging(prev => prev ? { ...prev, interimText: text } : prev);
          }
          break;
        }
        case 'voice-stopped':
          isStreamingRef.current = false;
          if (mediaStreamRef.current) {
            setVoiceStatus('ready');
          } else {
            setVoiceStatus('idle');
          }
          setIsKeyHeld(false);
          // 如果松开了 Alt+V（pendingSend），发送最终文本
          if (pendingSendRef.current) {
            pendingSendRef.current = false;
            // 小延迟等待最后的 staging 更新
            setTimeout(() => finalizeStagingAndSend(), 50);
          }
          break;
        case 'voice-error':
          isStreamingRef.current = false;
          setVoiceError(payload.message as string);
          if (mediaStreamRef.current) {
            setVoiceStatus('ready');
          } else {
            setVoiceStatus('error');
          }
          break;
      }
    };

    if (isTauri()) {
      // Tauri desktop: listen via event system
      (async () => {
        try {
          const { listen } = await import('@tauri-apps/api/event');

          const u1 = await listen<{ text: string; is_final: boolean }>('voice-result', (event) => {
            handleVoiceEvent('voice-result', event.payload as unknown as Record<string, unknown>);
          });
          unlisten.push(u1);

          const u2 = await listen('voice-stopped', () => {
            handleVoiceEvent('voice-stopped', {});
          });
          unlisten.push(u2);

          const u3 = await listen<{ message: string }>('voice-error', (event) => {
            handleVoiceEvent('voice-error', event.payload as unknown as Record<string, unknown>);
          });
          unlisten.push(u3);
        } catch {
          // Not in Tauri environment
        }
      })();
    } else {
      // Browser mode: subscribe via WebSocket
      import('../lib/websocket').then(({ getWebSocketManager }) => {
        const unsub = getWebSocketManager().subscribeVoiceEvents(handleVoiceEvent);
        unlisten.push(unsub);
      }).catch(() => {});
    }

    return () => { unlisten.forEach(fn => fn()); };
  }, [triggerRefine, finalizeStagingAndSend]);

  // ---- Alt+V 按住说话 ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt/Option + V（用 e.code 检测物理按键，避免 macOS Option 产生 √ 等字符）
      if (e.altKey && e.code === 'KeyV' && !e.repeat) {
        e.preventDefault();
        setIsKeyHeld(true);
        if (voiceStatusRef.current === 'ready') {
          startStreaming();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.code === 'KeyV') {
        setIsKeyHeld(prev => {
          if (prev && voiceStatusRef.current === 'recording') {
            stopStreaming();
          }
          return false;
        });
      }
    };

    const handleBlur = () => {
      setIsKeyHeld(prev => {
        if (prev && voiceStatusRef.current === 'recording') {
          stopStreaming();
        }
        return false;
      });
    };

    // capture: true — 在事件到达 xterm textarea 之前截获
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [startStreaming, stopStreaming]);

  // ---- 移动端长按录音：一步完成 enterReady + startStreaming ----
  const startRecording = useCallback(async () => {
    const status = voiceStatusRef.current;
    if (status === 'idle' || status === 'error') {
      await enterReady();
      // enterReady 成功后 status 变为 ready，继续 startStreaming
      if (voiceStatusRef.current === 'ready') {
        await startStreaming();
      }
    } else if (status === 'ready') {
      await startStreaming();
    }
  }, [enterReady, startStreaming]);

  // ---- 移动端松开停止 ----
  const stopRecording = useCallback(async () => {
    if (voiceStatusRef.current === 'recording') {
      await stopStreaming();
    }
  }, [stopStreaming]);

  // ---- 组件卸载时清理 ----
  useEffect(() => {
    return () => {
      isStreamingRef.current = false;
      cleanupAudio();
      clearStaging();
      voiceStop().catch(() => {});
    };
  }, [cleanupAudio, clearStaging]);

  return { voiceStatus, voiceError, isKeyHeld, analyserNode, staging, toggleVoice, stopVoice: exitReady, startRecording, stopRecording };
}
