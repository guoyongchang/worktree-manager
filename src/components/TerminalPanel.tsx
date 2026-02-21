import { useRef, useState, useEffect, useCallback, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from './Terminal';
import {
  FolderIcon,
  TerminalIcon,
  ChevronIcon,
  ChevronDownIcon,
  CloseIcon,
  MaximizeIcon,
  RestoreIcon,
  MicIcon,
} from './Icons';
import type { VoiceStatus, StagingState } from '../hooks/useVoiceInput';
import type { TerminalTab } from '../types';
import { isTauri } from '@/lib/backend';

const IS_MOBILE = typeof window !== 'undefined' && 'ontouchstart' in window;
const IS_MOBILE_WEB = IS_MOBILE && !isTauri();

// ---- 音频波形组件 ----
// 颜色取自 Tailwind red-400 (248,113,113)，与录音按钮/圆点一致
const BAR_COLOR_R = 248, BAR_COLOR_G = 113, BAR_COLOR_B = 113;

const AudioWaveform: FC<{ analyserNode: AnalyserNode }> = ({ analyserNode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let animId: number;
    const draw = () => {
      animId = requestAnimationFrame(draw);
      analyserNode.getByteFrequencyData(dataArray);

      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const barCount = 48;
      const barWidth = 3;
      const gap = 2;
      const totalWidth = barCount * (barWidth + gap) - gap;
      const startX = (w - totalWidth) / 2;
      const centerY = h / 2;

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor(i * bufferLength / barCount);
        const value = dataArray[dataIndex] / 255;
        const barHeight = Math.max(2, value * centerY * 0.85);
        const x = startX + i * (barWidth + gap);
        const alpha = 0.35 + value * 0.65;

        ctx.fillStyle = `rgba(${BAR_COLOR_R},${BAR_COLOR_G},${BAR_COLOR_B},${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x, centerY - barHeight, barWidth, barHeight * 2, barWidth / 2);
        ctx.fill();
      }
    };

    draw();
    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, [analyserNode]);

  return (
    <div ref={containerRef} className="w-64 h-16">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
};

// ---- 悬浮可拖动录音按钮（移动端 Web）----

const FLOATING_BTN_SIZE = 48;   // w-12 = 3rem = 48px
const FLOATING_BTN_MARGIN = 16; // 距离右边缘的默认间距

const FloatingMicButton: FC<{
  voiceStatus: VoiceStatus;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
}> = ({ voiceStatus, onStartRecording, onStopRecording }) => {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ x: number | null; y: number }>({ x: null, y: 80 });
  const posRef = useRef(pos);
  posRef.current = pos;

  const dragRef = useRef({
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0,
    isDragging: false,
  });
  const btnRef = useRef<HTMLButtonElement>(null);

  const constrain = useCallback((x: number, y: number) => {
    const parent = btnRef.current?.parentElement;
    if (!parent) return { x, y };
    const pr = parent.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(x, pr.width - FLOATING_BTN_SIZE)),
      y: Math.max(0, Math.min(y, pr.height - FLOATING_BTN_SIZE)),
    };
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const d = dragRef.current;
    const cur = posRef.current;
    let currentX = cur.x;
    if (currentX === null && btnRef.current?.parentElement) {
      const pr = btnRef.current.parentElement.getBoundingClientRect();
      currentX = pr.width - FLOATING_BTN_SIZE - FLOATING_BTN_MARGIN;
      setPos(p => ({ ...p, x: currentX }));
    }
    d.startX = touch.clientX;
    d.startY = touch.clientY;
    d.startPosX = currentX ?? 0;
    d.startPosY = cur.y;
    d.isDragging = false;
    onStartRecording?.();
  }, [onStartRecording]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const d = dragRef.current;
    const dx = touch.clientX - d.startX;
    const dy = touch.clientY - d.startY;
    if (!d.isDragging && Math.abs(dx) + Math.abs(dy) > 5) {
      d.isDragging = true;
    }
    if (d.isDragging) {
      setPos(constrain(d.startPosX + dx, d.startPosY + dy));
    }
  }, [constrain]);

  const handleTouchEnd = useCallback(() => {
    dragRef.current.isDragging = false;
    onStopRecording?.();
  }, [onStopRecording]);

  const isRecording = voiceStatus === 'recording';

  const style: React.CSSProperties = pos.x === null
    ? { position: 'absolute', right: FLOATING_BTN_MARGIN, top: pos.y }
    : { position: 'absolute', left: pos.x, top: pos.y };

  return (
    <button
      ref={btnRef}
      className={`z-20 w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-sm touch-none ${
        isRecording
          ? 'bg-red-900/70 border-2 border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse'
          : 'bg-slate-800/70 border-2 border-green-500/60'
      }`}
      style={style}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      aria-label={isRecording ? t('terminal.releaseToStopRecord') : t('terminal.holdToRecord')}
    >
      <MicIcon className={`w-5 h-5 ${isRecording ? 'text-red-400' : 'text-white'}`} />
    </button>
  );
};

function getVoiceButtonTitle(
  voiceStatus: VoiceStatus,
  isKeyHeld: boolean,
  voiceError?: string | null,
  t?: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const _t = t || ((k: string) => k);
  if (voiceStatus === 'recording') {
    return isKeyHeld ? _t('terminal.releaseToStop') : _t('terminal.clickToCloseVoice');
  }
  if (voiceStatus === 'ready') {
    return IS_MOBILE ? _t('terminal.clickToCloseVoice') : _t('terminal.holdAltVToSpeak');
  }
  if (voiceError) {
    return _t('terminal.voiceError', { error: voiceError });
  }
  return _t('terminal.enableVoice');
}

function getVoiceButtonClass(voiceStatus: VoiceStatus): string {
  switch (voiceStatus) {
    case 'recording': return 'text-red-400 hover:bg-red-900/30';
    case 'ready':     return 'text-green-400 hover:bg-green-900/30';
    case 'error':     return 'text-red-400 hover:bg-slate-700';
    default:          return 'text-slate-500 hover:text-slate-300 hover:bg-slate-700';
  }
}

// ---- TerminalPanel ----

interface TerminalPanelProps {
  visible: boolean;
  height: number;
  onStartResize: () => void;
  terminalTabs: TerminalTab[];
  activatedTerminals: Set<string>;
  mountedTerminals: Set<string>;
  activeTerminalTab: string | null;
  onTabClick: (path: string) => void;
  onTabContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
  onCloseTab: (path: string) => void;
  onToggle: () => void;
  onCollapse: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  voiceStatus?: VoiceStatus;
  voiceError?: string | null;
  isKeyHeld?: boolean;
  analyserNode?: AnalyserNode | null;
  onToggleVoice?: () => void;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  staging?: StagingState | null;
}

export const TerminalPanel: FC<TerminalPanelProps> = ({
  visible,
  height,
  onStartResize,
  terminalTabs,
  activatedTerminals,
  mountedTerminals,
  activeTerminalTab,
  onTabClick,
  onTabContextMenu,
  onCloseTab,
  onToggle,
  onCollapse,
  isFullscreen = false,
  onToggleFullscreen,
  voiceStatus = 'idle',
  voiceError,
  isKeyHeld = false,
  analyserNode,
  onToggleVoice,
  onStartRecording,
  onStopRecording,
  staging,
}) => {
  const { t } = useTranslation();
  const [showError, setShowError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show voice errors as a visible toast
  useEffect(() => {
    if (voiceError) {
      setShowError(voiceError);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setShowError(null), 4000);
    }
    return () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); };
  }, [voiceError]);

  return (
    <div
      className={`border-t border-slate-700 flex flex-col shrink-0 ${isFullscreen ? 'fixed inset-0 z-50 border-t-0 bg-slate-900' : ''}`}
      style={isFullscreen ? undefined : { height: visible ? height : 32 }}
    >
      {/* Resize handle - hidden in fullscreen */}
      {visible && !isFullscreen && (
        <div
          className="h-3 flex items-center justify-center cursor-ns-resize shrink-0 group"
          onMouseDown={(e) => {
            e.preventDefault();
            onStartResize();
          }}
        >
          <div className="w-10 h-1 rounded-full bg-slate-600 group-hover:bg-blue-500 group-hover:h-1.5 transition-all" />
        </div>
      )}
      {/* Header with tabs */}
      <div className="flex items-center bg-slate-800/50 select-none shrink-0 border-b border-slate-700/50">
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400 cursor-pointer hover:bg-slate-700/50 transition-colors"
          onClick={onToggle}
          role="button"
          aria-label={visible ? t('terminal.collapsePanel') : t('terminal.expandPanel')}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        >
          <TerminalIcon className="w-4 h-4" />
          <ChevronIcon expanded={visible} className="w-3 h-3 text-slate-500" />
        </div>
        {/* Project tabs - horizontal scroll */}
        <div className="flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600">
          <div className="flex items-center gap-0.5 px-1">
            {terminalTabs.map(tab => {
              const isActive = activeTerminalTab === tab.path;
              const isActivated = activatedTerminals.has(tab.path);
              return (
                <div
                  key={tab.path}
                  className={`group px-2 py-1.5 text-xs font-medium whitespace-nowrap rounded-t transition-colors flex items-center gap-1 cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-blue-400 border-t border-l border-r border-slate-600'
                      : isActivated
                        ? 'text-slate-300 hover:bg-slate-700/50'
                        : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-400'
                  }`}
                  onClick={() => onTabClick(tab.path)}
                  onContextMenu={(e) => onTabContextMenu(e, tab.path, tab.name)}
                >
                  {tab.isRoot && <FolderIcon className="w-3 h-3" />}
                  <span>{tab.name}</span>
                  {tab.isDuplicate && (
                    <span className="text-[9px] text-slate-500 font-mono">{t('terminal.duplicate')}</span>
                  )}
                  {isActivated && (
                    <span
                      className="w-5 h-5 ml-1 flex items-center justify-center rounded-full hover:bg-slate-600 text-slate-500 hover:text-slate-300 transition-colors"
                      onClick={(e) => { e.stopPropagation(); onCloseTab(tab.path); }}
                      title={t('terminal.close')}
                      role="button"
                      aria-label={t('terminal.closeTerminalTab', { name: tab.name })}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onCloseTab(tab.path); } }}
                    >
                      <CloseIcon className="w-2.5 h-2.5" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Voice, Fullscreen & Collapse buttons */}
        {visible && (
          <div className="flex items-center mx-1">
            {onToggleVoice && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleVoice(); }}
                className={`p-1.5 rounded transition-colors relative ${getVoiceButtonClass(voiceStatus)}`}
                title={getVoiceButtonTitle(voiceStatus, isKeyHeld, voiceError, t)}
                aria-label={t('terminal.voiceOff')}
              >
                <MicIcon className="w-3.5 h-3.5" />
                {voiceStatus === 'recording' && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full animate-pulse bg-red-500" />
                )}
                {voiceStatus === 'ready' && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-green-500" />
                )}
              </button>
            )}
            {onToggleFullscreen && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}
                className="p-1.5 hover:bg-slate-700 rounded text-slate-500 hover:text-slate-300 transition-colors"
                title={isFullscreen ? t('terminal.exitFullscreen') : t('terminal.fullscreen')}
                aria-label={isFullscreen ? t('terminal.exitFullscreen') : t('terminal.fullscreen')}
              >
                {isFullscreen ? (
                  <RestoreIcon className="w-3.5 h-3.5" />
                ) : (
                  <MaximizeIcon className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            {!isFullscreen && (
              <button
                onClick={(e) => { e.stopPropagation(); onCollapse(); }}
                className="p-1.5 hover:bg-slate-700 rounded text-slate-500 hover:text-slate-300 transition-colors"
                title={t('terminal.collapseTerminal')}
                aria-label={t('terminal.collapsePanel')}
              >
                <ChevronDownIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      {/* Terminal content - always mounted but hidden when collapsed to preserve PTY sessions */}
      <div
        className="flex-1 min-h-0 overflow-hidden relative"
        style={{ display: visible ? 'flex' : 'none' }}
      >
        {/* Render from mountedTerminals (global, survives worktree switches) to keep PTY sessions alive */}
        {mountedTerminals.size > 0 ? (
          <>
            {Array.from(mountedTerminals).map(path => (
              <div
                key={path}
                className="absolute inset-0"
                style={{ display: path === activeTerminalTab ? 'block' : 'none' }}
              >
                <Terminal
                  cwd={path}
                  visible={visible && path === activeTerminalTab}
                />
              </div>
            ))}
            {!activeTerminalTab && (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                {t('terminal.clickTabToOpen')}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            {t('terminal.clickTabToOpen')}
          </div>
        )}

        {/* 语音错误提示 */}
        {showError && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-red-900/90 border border-red-700/50 rounded-lg text-sm text-red-200 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
            {showError}
          </div>
        )}

        {/* 悬浮录音按钮（移动端 Web）*/}
        {IS_MOBILE_WEB && (voiceStatus === 'ready' || voiceStatus === 'recording') && (
          <FloatingMicButton
            voiceStatus={voiceStatus}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
          />
        )}

        {/* ALT+V 提示（非移动端，语音就绪时）*/}
        {voiceStatus === 'ready' && !IS_MOBILE && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-slate-800/90 border border-slate-600/50 rounded-lg text-xs text-slate-300 shadow-lg pointer-events-none animate-in fade-in duration-200">
            {t('terminal.altVHint')}
          </div>
        )}

        {/* 录音暂存区遮罩（桌面端全屏 / 移动端底部卡片）*/}
        {voiceStatus === 'recording' && !IS_MOBILE_WEB && (
          <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4 fade-in-0 p-4">
            {analyserNode && <AudioWaveform analyserNode={analyserNode} />}

            {/* 暂存区内容 */}
            {staging && (staging.rawText || staging.interimText) && (
              <div className="w-full max-w-md flex flex-col gap-2">
                {/* 原始语音 */}
                <div className="rounded-lg bg-slate-800/80 border border-slate-600/50 p-3">
                  <div className="text-[10px] text-slate-500 mb-1 font-medium uppercase tracking-wider">{t('voice.rawText')}</div>
                  <div className="text-sm text-slate-200 leading-relaxed break-all">
                    {staging.rawText}
                    {staging.interimText && (
                      <span className="text-slate-500 italic">{staging.interimText}</span>
                    )}
                  </div>
                </div>

                {/* AI 整理 */}
                {(staging.refinedText || staging.isRefining || staging.refineFailed) && (
                  <div className={`rounded-lg p-3 ${
                    staging.refineFailed
                      ? 'bg-red-900/30 border border-red-700/50'
                      : 'bg-slate-800/80 border border-blue-500/40'
                  }`}>
                    <div className="text-[10px] mb-1 font-medium uppercase tracking-wider flex items-center gap-1">
                      <span className={staging.refineFailed ? 'text-red-400' : 'text-blue-400'}>
                        {t('voice.refinedText')}
                      </span>
                      {staging.isRefining && (
                        <span className="text-slate-500 animate-pulse">{t('voice.refining')}</span>
                      )}
                    </div>
                    <div className="text-sm leading-relaxed break-all">
                      {staging.refineFailed ? (
                        <span className="text-red-300/80">{t('voice.refineFailed')}</span>
                      ) : (
                        <span className="text-blue-200">{staging.refinedText}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <span className="text-sm text-slate-400 select-none">
              {t('terminal.recordingHint')}
            </span>
          </div>
        )}

        {/* 移动端 Web 暂存区卡片（在悬浮按钮上方）*/}
        {voiceStatus === 'recording' && IS_MOBILE_WEB && staging && (staging.rawText || staging.interimText) && (
          <div className="absolute bottom-20 left-2 right-2 z-15 rounded-xl bg-slate-800/95 border border-slate-600/50 p-3 shadow-2xl backdrop-blur-sm">
            <div className="text-[10px] text-slate-500 mb-1 font-medium uppercase tracking-wider">{t('voice.rawText')}</div>
            <div className="text-sm text-slate-200 leading-relaxed break-all mb-2">
              {staging.rawText}
              {staging.interimText && (
                <span className="text-slate-500 italic">{staging.interimText}</span>
              )}
            </div>
            {(staging.refinedText || staging.isRefining || staging.refineFailed) && (
              <>
                <div className="text-[10px] font-medium uppercase tracking-wider flex items-center gap-1 mb-1">
                  <span className={staging.refineFailed ? 'text-red-400' : 'text-blue-400'}>
                    {t('voice.refinedText')}
                  </span>
                  {staging.isRefining && (
                    <span className="text-slate-500 animate-pulse">{t('voice.refining')}</span>
                  )}
                </div>
                <div className="text-sm leading-relaxed break-all">
                  {staging.refineFailed ? (
                    <span className="text-red-300/80">{t('voice.refineFailed')}</span>
                  ) : (
                    <span className="text-blue-200">{staging.refinedText}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
