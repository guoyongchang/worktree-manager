import { useState, useRef, useCallback } from 'react';

export type VoiceStatus = 'idle' | 'recording' | 'error';

export interface UseVoiceInputReturn {
  voiceStatus: VoiceStatus;
  voiceError: string | null;
  /** 0 = just spoke or in grace period, 1 = about to auto-stop */
  silenceProgress: number;
  toggleVoice: () => void;
}

/**
 * Voice command keywords → terminal control sequences.
 * We normalize before matching: lowercase + strip trailing punctuation.
 */
const VOICE_COMMANDS: Record<string, string> = {
  // 删除 → Backspace
  '删除': '\x7F',
  'backspace': '\x7F',
  'delete': '\x7F',
  // 清空 → Ctrl+C (interrupt current input)
  '清空': '\x03',
  'clear': '\x03',
  // 中断 → ESC
  '中断': '\x1B',
  'escape': '\x1B',
  // 提交 → Enter
  '提交': '\r',
  '回车': '\r',
  'enter': '\r',
  'submit': '\r',
};

/** Normalize transcribed text for command matching */
function normalizeForMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[。，、！？.!?,\s]+$/g, ''); // strip trailing punctuation/whitespace
}

/**
 * Process transcribed text: if it matches a voice command exactly,
 * return the control sequence; otherwise return the original text as-is.
 */
function processTranscription(text: string): string {
  const normalized = normalizeForMatch(text);
  const command = VOICE_COMMANDS[normalized];
  if (command) return command;
  return text;
}

// Type declarations for webkitSpeechRecognition (available in WKWebView / Chrome)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
}

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null) as SpeechRecognitionCtor | null;
}

// ---------------------------------------------------------------------------
// Silence detection via onresult timing (no getUserMedia needed)
// ---------------------------------------------------------------------------

/** How long (ms) silence must persist before auto-stopping. */
const SILENCE_TIMEOUT_MS = 2000;

/** Grace period (ms) after starting — don't auto-stop before user begins speaking. */
const INITIAL_GRACE_MS = 30000;

/** Interval (ms) for updating silenceProgress state. */
const TICK_INTERVAL_MS = 100;

export function useVoiceInput(
  onTranscribed: (text: string) => void,
): UseVoiceInputReturn {
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [silenceProgress, setSilenceProgress] = useState(0);

  // SpeechRecognition
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const intentRef = useRef(false);

  // Silence tracking
  const lastResultRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Whether the user has spoken at least once (got a result). */
  const hasSpokenRef = useRef(false);

  const cleanupTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setSilenceProgress(0);
  }, []);

  const stopRecording = useCallback(() => {
    intentRef.current = false;
    cleanupTick();
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setVoiceStatus('idle');
  }, [cleanupTick]);

  const startRecording = useCallback(() => {
    setVoiceError(null);
    setSilenceProgress(0);

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setVoiceError('当前环境不支持语音识别');
      setVoiceStatus('error');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    // interimResults = true gives us frequent onresult signals while user is speaking
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';

    const now = Date.now();
    lastResultRef.current = now;
    startTimeRef.current = now;
    hasSpokenRef.current = false;

    recognition.onresult = (ev: SpeechRecognitionEvent) => {
      lastResultRef.current = Date.now();
      hasSpokenRef.current = true;
      setSilenceProgress(0);

      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.isFinal) {
          const text = result[0].transcript;
          if (text.trim()) {
            const processed = processTranscription(text);
            onTranscribed(processed);
          }
        }
      }
    };

    recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      console.error('[voice] SpeechRecognition error:', ev.error);
      const messages: Record<string, string> = {
        'not-allowed': '麦克风权限被拒绝，请在系统设置中允许',
        'audio-capture': '未检测到麦克风设备',
        'network': '语音识别网络错误',
      };
      setVoiceError(messages[ev.error] || `语音识别错误: ${ev.error}`);
      setVoiceStatus('error');
      intentRef.current = false;
      cleanupTick();
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      if (intentRef.current) {
        try {
          recognition.start();
        } catch {
          // Already started or other error — ignore
        }
      } else {
        recognitionRef.current = null;
        setVoiceStatus('idle');
      }
    };

    recognitionRef.current = recognition;
    intentRef.current = true;

    try {
      recognition.start();
      setVoiceStatus('recording');
    } catch (e) {
      setVoiceError(`语音识别启动失败: ${e}`);
      setVoiceStatus('error');
      intentRef.current = false;
      recognitionRef.current = null;
      return;
    }

    // Tick loop — compute silenceProgress and auto-stop
    tickRef.current = setInterval(() => {
      if (!intentRef.current) return;

      const elapsed = Date.now() - startTimeRef.current;

      // During grace period, only auto-stop if user has spoken then gone silent
      if (elapsed < INITIAL_GRACE_MS && !hasSpokenRef.current) {
        setSilenceProgress(0);
        return;
      }

      const silenceMs = Date.now() - lastResultRef.current;
      const progress = Math.min(silenceMs / SILENCE_TIMEOUT_MS, 1);
      setSilenceProgress(progress);

      if (progress >= 1) {
        console.log(`[voice] Auto-stop: ${silenceMs}ms silence`);
        stopRecording();
      }
    }, TICK_INTERVAL_MS);
  }, [onTranscribed, cleanupTick, stopRecording]);

  const toggleVoice = useCallback(() => {
    if (voiceStatus === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  }, [voiceStatus, startRecording, stopRecording]);

  return { voiceStatus, voiceError, silenceProgress, toggleVoice };
}
