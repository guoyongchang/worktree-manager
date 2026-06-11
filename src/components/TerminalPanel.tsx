import { useRef, useState, useEffect, useCallback, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';
import { Terminal } from './Terminal';
import { TerminalSearchBar } from './TerminalSearchBar';
import type { TerminalHandle } from './Terminal';
import type { SearchOptions } from '../terminal';
import {
  FolderIcon,
  FolderOpenIcon,
  TerminalIcon,
  ChevronIcon,
  ChevronDownIcon,
  CloseIcon,
  MaximizeIcon,
  RestoreIcon,
  VerticalExpandIcon,
  MicIcon,
  EditorIcon,
} from './Icons';
import type { VoiceStatus, StagingState } from '../hooks/useVoiceInput';
import type { TerminalTab } from '../types';
import { isTauri } from '@/lib/backend';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
        const bh = barHeight * 2;
        const r = barWidth / 2;
        if (ctx.roundRect) {
          ctx.roundRect(x, centerY - barHeight, barWidth, bh, r);
        } else {
          // Fallback for older WebView2 without roundRect support
          ctx.moveTo(x + r, centerY - barHeight);
          ctx.arcTo(x + barWidth, centerY - barHeight, x + barWidth, centerY - barHeight + bh, r);
          ctx.arcTo(x + barWidth, centerY - barHeight + bh, x, centerY - barHeight + bh, r);
          ctx.arcTo(x, centerY - barHeight + bh, x, centerY - barHeight, r);
          ctx.arcTo(x, centerY - barHeight, x + barWidth, centerY - barHeight, r);
          ctx.closePath();
        }
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
  onToggleVoice?: () => void;
  onStopRecording?: () => void;
}> = ({ voiceStatus, onToggleVoice, onStopRecording }) => {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
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
    d.startPosY = cur.y ?? 0;
    d.isDragging = false;
  }, []);

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
    // Only toggle recording if it was a tap (not a drag)
    if (!dragRef.current.isDragging) {
      console.log('[voice-ui] FloatingMicButton tapped, voiceStatus:', voiceStatus);
      if (voiceStatus === 'recording') {
        onStopRecording?.();
      } else {
        onToggleVoice?.();
      }
    }
    dragRef.current.isDragging = false;
  }, [voiceStatus, onToggleVoice, onStopRecording]);

  const isRecording = voiceStatus === 'recording';

  const style: React.CSSProperties = pos.x === null
    ? { position: 'absolute', right: FLOATING_BTN_MARGIN, bottom: 80 }
    : { position: 'absolute', left: pos.x, top: pos.y ?? undefined };

  return (
    <button
      ref={btnRef}
      className={`z-20 w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-sm touch-none ${isRecording
        ? 'bg-[var(--color-error)]/70 border-2 border-[var(--color-error)] shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse'
        : 'bg-[var(--color-bg-surface)]/70 border-2 border-green-500/60'
        }`}
      style={style}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      aria-label={isRecording ? t('terminal.releaseToStopRecord') : t('terminal.holdToRecord')}
    >
      <MicIcon className={`w-5 h-5 ${isRecording ? 'text-[var(--color-error)]' : 'text-white'}`} />
    </button>
  );
};

function getVoiceButtonTitle(
  voiceStatus: VoiceStatus,
  isKeyHeld: boolean,
  voiceError?: string | null,
  t?: (key: string, opts?: Record<string, unknown>) => string,
  voiceWarning?: string | null,
): string {
  const _t = t || ((k: string) => k);
  if (voiceStatus === 'recording') {
    return isKeyHeld ? _t('terminal.releaseToStop') : _t('terminal.clickToCloseVoice');
  }
  if (voiceStatus === 'ready') {
    return IS_MOBILE ? _t('terminal.clickToCloseVoice') : _t('terminal.holdAltVToSpeak');
  }
  if (voiceWarning) {
    return voiceWarning;
  }
  if (voiceError) {
    return _t('terminal.voiceError', { error: voiceError });
  }
  return _t('terminal.enableVoice');
}

function getVoiceButtonClass(voiceStatus: VoiceStatus, voiceWarning?: string | null): string {
  switch (voiceStatus) {
    case 'recording': return 'text-[var(--color-error)] hover:bg-[var(--color-error)]/10';
    case 'ready': return 'text-green-400 hover:bg-green-900/30';
    case 'error': return voiceWarning ? 'text-yellow-400 hover:bg-[var(--color-bg-elevated)]' : 'text-[var(--color-error)] hover:bg-[var(--color-bg-elevated)]';
    default: return 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]';
  }
}

// ---- TerminalPanel ----

interface TerminalPanelProps {
  visible: boolean;
  height: number;
  onStartResize: (y: number) => void;
  terminalTabs: TerminalTab[];
  activatedTerminals: Set<string>;
  mountedTerminals: Set<string>;
  activeTerminalTab: string | null;
  onTabClick: (path: string) => void;
  onTabContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
  onCloseTab: (path: string) => void;
  onCloseAllTabs: () => void;
  onToggle: () => void;
  onCollapse: () => void;
  isFullscreen?: boolean;
  fillContainer?: boolean;
  onToggleFullscreen?: () => void;
  fullscreenMode?: false | 'vertical' | 'full';
  onSetFullscreenMode?: (mode: false | 'vertical' | 'full') => void;
  voiceStatus?: VoiceStatus;
  voiceError?: string | null;
  voiceWarning?: string | null;
  isKeyHeld?: boolean;
  analyserNode?: AnalyserNode | null;
  onToggleVoice?: () => void;
  onStopRecording?: () => void;
  staging?: StagingState | null;
  clientId?: string;
  hasShellIntegration?: boolean;
  onShellIntegrationDetected?: (path: string) => void;
  onCwdChanged?: (path: string, cwd: string) => void;
  selectedWorktreeName?: string | null;
  onOpenInEditor?: (path: string, editor?: string) => void;
  onRevealInFinder?: (path: string) => void;
  selectedEditor?: string;
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
  onCloseAllTabs,
  onToggle,
  onCollapse,
  isFullscreen: isFullscreenProp = false,
  fillContainer = false,
  onToggleFullscreen,
  fullscreenMode = false,
  onSetFullscreenMode,
  voiceStatus = 'idle',
  voiceError,
  voiceWarning,
  isKeyHeld = false,
  analyserNode,
  onToggleVoice,
  onStopRecording,
  staging,
  clientId,
  hasShellIntegration,
  onShellIntegrationDetected,
  onCwdChanged,
  selectedWorktreeName,
  onOpenInEditor,
  onRevealInFinder,
  selectedEditor,
}) => {
  // Derive effective fullscreen state: new fullscreenMode prop takes priority over legacy isFullscreen
  const isFullscreen = fullscreenMode ? fullscreenMode === 'full' : isFullscreenProp;
  const isVerticalFullscreen = fullscreenMode === 'vertical';
  const isAnyFullscreen = isFullscreen || isVerticalFullscreen;

  const { t } = useTranslation();
  const [showError, setShowError] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState<string | null>(null);
  const [badgeCopied, setBadgeCopied] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAltVHint, setShowAltVHint] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalRefsMap = useRef<Map<string, TerminalHandle>>(new Map());
  const [searchOpen, setSearchOpen] = useState(false);
  const [showGpuFallback, setShowGpuFallback] = useState(false);
  const gpuFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Long-press support for terminal tab context menus on touch devices
  const tabLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabLongPressFiredRef = useRef(false);

  const handleTabTouchStart = useCallback((e: React.TouchEvent, path: string, name: string) => {
    tabLongPressFiredRef.current = false;
    const touch = e.touches[0];
    tabLongPressTimerRef.current = setTimeout(() => {
      tabLongPressFiredRef.current = true;
      onTabContextMenu(
        { preventDefault: () => { }, clientX: touch.clientX, clientY: touch.clientY } as unknown as React.MouseEvent,
        path,
        name,
      );
    }, 500);
  }, [onTabContextMenu]);

  const handleTabTouchEnd = useCallback(() => {
    if (tabLongPressTimerRef.current) {
      clearTimeout(tabLongPressTimerRef.current);
      tabLongPressTimerRef.current = null;
    }
  }, []);

  const handleTabTouchMove = useCallback(() => {
    if (tabLongPressTimerRef.current) {
      clearTimeout(tabLongPressTimerRef.current);
      tabLongPressTimerRef.current = null;
    }
  }, []);

  // Show voice errors as a visible toast
  useEffect(() => {
    if (voiceError) {
      setShowError(voiceError);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setShowError(null), 4000);
    }
    return () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); };
  }, [voiceError]);

  // Show voice warnings (no mic, permission denied) as yellow toast
  useEffect(() => {
    if (voiceWarning) {
      setShowWarning(voiceWarning);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      warningTimerRef.current = setTimeout(() => setShowWarning(null), 4000);
    }
    return () => { if (warningTimerRef.current) clearTimeout(warningTimerRef.current); };
  }, [voiceWarning]);

  // Show Alt+V hint briefly when entering ready state
  useEffect(() => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    if (voiceStatus === 'ready') {
      setShowAltVHint(true);
      hintTimerRef.current = setTimeout(() => setShowAltVHint(false), 3000);
    } else {
      setShowAltVHint(false);
    }
    return () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); };
  }, [voiceStatus]);

  // Close search bar when switching terminal tabs
  const prevTabRef = useRef(activeTerminalTab);
  useEffect(() => {
    if (prevTabRef.current !== activeTerminalTab) {
      if (searchOpen) {
        const prevHandle = terminalRefsMap.current.get(prevTabRef.current ?? '');
        prevHandle?.clearSearch();
        setSearchOpen(false);
      }
      prevTabRef.current = activeTerminalTab;
    }
  }, [activeTerminalTab, searchOpen]);

  const handleGpuFallback = useCallback(() => {
    setShowGpuFallback(true);
    if (gpuFallbackTimerRef.current) clearTimeout(gpuFallbackTimerRef.current);
    gpuFallbackTimerRef.current = setTimeout(() => setShowGpuFallback(false), 3000);
  }, []);

  useEffect(() => {
    return () => { if (gpuFallbackTimerRef.current) clearTimeout(gpuFallbackTimerRef.current); };
  }, []);

  const handleSearchToggle = useCallback(() => {
    setSearchOpen(prev => {
      if (prev) {
        terminalRefsMap.current.get(activeTerminalTab ?? '')?.clearSearch();
      }
      return !prev;
    });
  }, [activeTerminalTab]);

  const handleSearchClose = useCallback(() => {
    const handle = terminalRefsMap.current.get(activeTerminalTab ?? '');
    handle?.clearSearch();
    setSearchOpen(false);
  }, [activeTerminalTab]);

  return (
    <div
      className={`border-t border-[var(--color-border)] flex flex-col ${fillContainer || isVerticalFullscreen ? 'flex-1 min-h-0 border-t-0 bg-[var(--color-bg-base)]' : visible ? 'shrink' : 'shrink-0'} ${isFullscreen ? 'absolute inset-0 z-50 border-t-0 bg-[var(--color-bg-base)]' : ''}`}
      style={isAnyFullscreen || fillContainer ? undefined : { height: visible ? height : 32, minHeight: visible ? 100 : undefined }}
    >
      {/* Resize handle - hidden in any fullscreen */}
      {visible && !isAnyFullscreen && (
        <div
          className="h-3 flex items-center justify-center cursor-ns-resize shrink-0 group touch-none"
          onMouseDown={(e) => {
            e.preventDefault();
            onStartResize(e.clientY);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            onStartResize(e.touches[0].clientY);
          }}
        >
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)] group-hover:bg-[var(--color-accent)] group-hover:h-1.5 transition-all" />
        </div>
      )}
      {/* Header with tabs */}
      <div className="flex items-center bg-[var(--color-bg-surface)] select-none shrink-0 border-b border-[var(--color-border)]/50">
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] cursor-pointer hover:bg-[var(--color-bg-elevated)]/50 transition-colors"
          onClick={onToggle}
          role="button"
          aria-label={visible ? t('terminal.collapsePanel') : t('terminal.expandPanel')}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        >
          <span className="relative">
            <TerminalIcon className="w-4 h-4" />
            {activatedTerminals.size > 1 && (
              <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] rounded-full bg-blue-600 text-[9px] text-white font-bold flex items-center justify-center px-0.5 leading-none">
                {activatedTerminals.size}
              </span>
            )}
          </span>
          <ChevronIcon expanded={visible} className="w-3 h-3 text-[var(--color-text-muted)]" />
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
                  className={`group px-2 py-1.5 text-xs font-medium whitespace-nowrap rounded-t transition-colors flex items-center gap-1 cursor-pointer ${isActive
                    ? 'bg-[var(--color-bg-base)] text-[var(--color-accent)] border-t border-l border-r border-[var(--color-border)]'
                    : isActivated
                      ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]/50'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-elevated)]/50 hover:text-[var(--color-text-secondary)]'
                    }`}
                  onClick={() => {
                    if (tabLongPressFiredRef.current) return;
                    onTabClick(tab.path);
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1 && isActivated && !terminalRefsMap.current.get(tab.path)?.isInitializing()) {
                      e.preventDefault();
                      onCloseTab(tab.path);
                    }
                  }}
                  onContextMenu={(e) => onTabContextMenu(e, tab.path, tab.name)}
                  onTouchStart={(e) => handleTabTouchStart(e, tab.path, tab.name)}
                  onTouchEnd={handleTabTouchEnd}
                  onTouchMove={handleTabTouchMove}
                >
                  {tab.isRoot && <FolderIcon className="w-3 h-3" />}
                  <span>{tab.name}</span>
                  {tab.isDuplicate && (
                    <span className="text-[9px] text-[var(--color-text-muted)] font-mono">{t('terminal.duplicate')}</span>
                  )}
                  {isActivated && (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={`w-5 h-5 ml-1 flex items-center justify-center rounded-full transition-colors ${terminalRefsMap.current.get(tab.path)?.isInitializing()
                              ? 'opacity-40 cursor-not-allowed'
                              : 'hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (terminalRefsMap.current.get(tab.path)?.isInitializing()) return;
                              onCloseTab(tab.path);
                            }}
                            role="button"
                            aria-label={t('terminal.closeTerminalTab', { name: tab.name })}
                            tabIndex={terminalRefsMap.current.get(tab.path)?.isInitializing() ? -1 : 0}
                            onKeyDown={(e) => {
                              if (terminalRefsMap.current.get(tab.path)?.isInitializing()) return;
                              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onCloseTab(tab.path); }
                            }}
                          >
                            <CloseIcon className="w-2.5 h-2.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t('terminal.close')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Quick action badges + Worktree name badge (fullscreen only) */}
        {isAnyFullscreen && selectedWorktreeName && (() => {
          const activeTab = terminalTabs.find(tab => tab.path === activeTerminalTab);
          const activePath = activeTerminalTab || '';
          // Resolve project-specific IDE or fall back to global selectedEditor
          let editorId = selectedEditor || '';
          if (activeTab && !activeTab.isRoot) {
            try {
              const prefs: Record<string, string> = JSON.parse(localStorage.getItem('project_preferred_editors') || '{}');
              if (prefs[activeTab.name]) editorId = prefs[activeTab.name];
            } catch { /* ignore */ }
          }
          return (
            <div className="flex items-center gap-1 shrink-0 mr-1">
              {onOpenInEditor && activePath && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onOpenInEditor(activePath, editorId)}
                        className="p-1 rounded text-[var(--color-text-secondary)] hover:text-blue-300 hover:bg-[var(--color-bg-elevated)]/60 transition-colors"
                      >
                        <EditorIcon editorId={editorId} className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('detail.openInEditor')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {onRevealInFinder && activePath && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onRevealInFinder(activePath)}
                        className="p-1 rounded text-[var(--color-text-secondary)] hover:text-blue-300 hover:bg-[var(--color-bg-elevated)]/60 transition-colors"
                      >
                        <FolderOpenIcon className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('detail.revealInFinder')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <button
                className={`terminal-badge-marquee text-xs px-2.5 py-0.5 rounded-md max-w-[160px] overflow-hidden cursor-pointer transition-colors ${
                  badgeCopied
                    ? 'text-green-200 bg-green-500/20 border border-green-400/40'
                    : 'text-[var(--color-accent)] bg-[var(--color-accent)]/20 border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/30 hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 active:bg-[var(--color-accent)]/40'
                }`}
                onClick={() => {
                  navigator.clipboard.writeText(selectedWorktreeName);
                  setBadgeCopied(true);
                  setTimeout(() => setBadgeCopied(false), 1500);
                }}
                title={selectedWorktreeName}
              >
                <span className="inline-block whitespace-nowrap">
                  {badgeCopied ? `✓ ${t('common.copied')}` : selectedWorktreeName}
                </span>
              </button>
            </div>
          );
        })()}
        {/* Close All, Voice, Fullscreen & Collapse buttons */}
        {visible && (
          <div className="flex items-center mx-1">
            {activatedTerminals.size >= 2 && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => { e.stopPropagation(); onCloseAllTabs(); }}
                      className="p-1.5 hover:bg-[var(--color-bg-elevated)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                      aria-label={t('terminal.closeAllTerminals')}
                    >
                      <CloseIcon className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('terminal.closeAllTerminals')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {hasShellIntegration && (
              <>
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => { e.stopPropagation(); terminalRefsMap.current.get(activeTerminalTab ?? '')?.scrollToCommand('prev'); }}
                        className="p-1.5 hover:bg-[var(--color-bg-elevated)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                        aria-label={t('terminal.prevCommand')}
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('terminal.prevCommand')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => { e.stopPropagation(); terminalRefsMap.current.get(activeTerminalTab ?? '')?.scrollToCommand('next'); }}
                        className="p-1.5 hover:bg-[var(--color-bg-elevated)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                        aria-label={t('terminal.nextCommand')}
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('terminal.nextCommand')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSearchToggle(); }}
                    className={`p-1.5 rounded transition-colors ${
                      searchOpen ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]'
                    }`}
                    aria-label={t('terminal.search')}
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('terminal.search')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {onToggleVoice && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log('[voice-ui] tab-bar mic clicked, voiceStatus:', voiceStatus);
                        if (voiceStatus === 'recording') {
                          onStopRecording?.();
                        } else {
                          onToggleVoice?.();
                        }
                      }}
                      className={`p-1.5 rounded transition-colors relative ${getVoiceButtonClass(voiceStatus, voiceWarning)}`}
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
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{getVoiceButtonTitle(voiceStatus, isKeyHeld, voiceError, t, voiceWarning)}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {onSetFullscreenMode ? (
              <>
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => { e.stopPropagation(); onSetFullscreenMode(isVerticalFullscreen ? false : 'vertical'); }}
                        className={`p-1.5 rounded transition-colors ${isVerticalFullscreen ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                        aria-label={isVerticalFullscreen ? t('terminal.exitFullscreen') : t('terminal.verticalFullscreen')}
                      >
                        <VerticalExpandIcon className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{isVerticalFullscreen ? t('terminal.exitFullscreen') : t('terminal.verticalFullscreen')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => { e.stopPropagation(); onSetFullscreenMode(isFullscreen ? false : 'full'); }}
                        className={`p-1.5 rounded transition-colors ${isFullscreen ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                        aria-label={isFullscreen ? t('terminal.exitFullscreen') : t('terminal.fullscreen')}
                      >
                        {isFullscreen ? (
                          <RestoreIcon className="w-3.5 h-3.5" />
                        ) : (
                          <MaximizeIcon className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{isFullscreen ? t('terminal.exitFullscreen') : t('terminal.fullscreen')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            ) : onToggleFullscreen && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}
                      className="p-1.5 hover:bg-[var(--color-bg-elevated)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                      aria-label={isAnyFullscreen ? t('terminal.exitFullscreen') : t('terminal.fullscreen')}
                    >
                      {isAnyFullscreen ? (
                        <RestoreIcon className="w-3.5 h-3.5" />
                      ) : (
                        <MaximizeIcon className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{isAnyFullscreen ? t('terminal.exitFullscreen') : t('terminal.fullscreen')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {!isAnyFullscreen && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => { e.stopPropagation(); onCollapse(); }}
                      className="p-1.5 hover:bg-[var(--color-bg-elevated)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                      aria-label={t('terminal.collapsePanel')}
                    >
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('terminal.collapseTerminal')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
                  ref={(handle: TerminalHandle | null) => {
                    if (handle) terminalRefsMap.current.set(path, handle);
                    else terminalRefsMap.current.delete(path);
                  }}
                  cwd={path}
                  visible={visible && path === activeTerminalTab}
                  clientId={clientId}
                  voiceStatus={voiceStatus}
                  onShellIntegrationDetected={() => onShellIntegrationDetected?.(path)}
                  onCwdChanged={(newCwd) => onCwdChanged?.(path, newCwd)}
                  onSearchRequested={() => setSearchOpen(true)}
                  onRendererFallback={handleGpuFallback}
                />
              </div>
            ))}
            {!activeTerminalTab && (
              <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
                {t('terminal.clickTabToOpen')}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
            {t('terminal.clickTabToOpen')}
          </div>
        )}

        {/* Terminal search bar */}
        {searchOpen && activeTerminalTab && (
          <TerminalSearchBar
            onFindNext={(query: string, opts: SearchOptions) =>
              terminalRefsMap.current.get(activeTerminalTab)?.findNext(query, opts) ?? false
            }
            onFindPrevious={(query: string, opts: SearchOptions) =>
              terminalRefsMap.current.get(activeTerminalTab)?.findPrevious(query, opts) ?? false
            }
            onClose={handleSearchClose}
          />
        )}

        {/* 语音错误提示（红色） */}
        {showError && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-[var(--color-error)]/10 border border-[var(--color-error)]/30 rounded-lg text-sm text-[var(--color-error)] shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
            {showError}
          </div>
        )}

        {/* 语音警告提示（黄色，用于无麦克风等非严重问题） */}
        {showWarning && !showError && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 rounded-lg text-sm text-[var(--color-warning)] shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
            {showWarning}
          </div>
        )}

        {/* GPU renderer fallback toast */}
        {showGpuFallback && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 rounded-lg text-sm text-[var(--color-warning)] shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
            {t('terminal.gpuFallback')}
          </div>
        )}

        {/* 悬浮录音按钮（移动端 Web）*/}
        {IS_MOBILE_WEB && (voiceStatus === 'ready' || voiceStatus === 'recording') && (
          <FloatingMicButton
            voiceStatus={voiceStatus}
            onToggleVoice={onToggleVoice}
            onStopRecording={onStopRecording}
          />
        )}

        {/* ALT+V 提示（非移动端，语音就绪时短暂显示 3 秒）*/}
        {showAltVHint && !IS_MOBILE && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-[var(--color-bg-surface)]/90 border border-[var(--color-border)]/50 rounded-lg text-xs text-[var(--color-text-secondary)] shadow-lg pointer-events-none animate-in fade-in duration-200">
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
                <div className="rounded-lg bg-[var(--color-bg-surface)]/80 border border-[var(--color-border)]/50 p-3">
                  <div className="text-[10px] text-[var(--color-text-muted)] mb-1 font-medium uppercase tracking-wider">{t('voice.rawText')}</div>
                  <div className="text-sm text-[var(--color-text-primary)] leading-relaxed break-all">
                    {staging.rawText}
                    {staging.interimText && (
                      <span className="text-[var(--color-text-muted)] italic">{staging.interimText}</span>
                    )}
                  </div>
                </div>

                {/* AI 整理 */}
                {(staging.refinedText || staging.isRefining || staging.refineFailed) && (
                  <div className={`rounded-lg p-3 ${staging.refineFailed
                    ? 'bg-[var(--color-error)]/10 border border-[var(--color-error)]/30'
                    : 'bg-[var(--color-bg-surface)]/80 border border-[var(--color-accent)]/40'
                    }`}>
                    <div className="text-[10px] mb-1 font-medium uppercase tracking-wider flex items-center gap-1">
                      <span className={staging.refineFailed ? 'text-[var(--color-error)]' : 'text-[var(--color-accent)]'}>
                        {t('voice.refinedText')}
                      </span>
                      {staging.isRefining && (
                        <span className="text-[var(--color-text-muted)] animate-pulse">{t('voice.refining')}</span>
                      )}
                    </div>
                    <div className="text-sm leading-relaxed break-all">
                      {staging.refineFailed ? (
                        <span className="text-[var(--color-error)]/80">{t('voice.refineFailed')}</span>
                      ) : (
                        <span className="text-[var(--color-accent)]">{staging.refinedText}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <span className="text-sm text-[var(--color-text-secondary)] select-none">
              {t('terminal.recordingHint')}
            </span>
          </div>
        )}

        {/* 移动端 Web 录音指示器 + 暂存区卡片 */}
        {voiceStatus === 'recording' && IS_MOBILE_WEB && (
          <div className="absolute bottom-20 left-2 right-2 z-15 rounded-xl bg-[var(--color-bg-surface)]/95 border border-[var(--color-border)]/50 p-3 shadow-2xl backdrop-blur-sm">
            {/* 录音中标题 — 始终显示 */}
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] text-[var(--color-error)] font-medium uppercase tracking-wider">{t('terminal.recordingHint')}</span>
            </div>

            {/* 波形 */}
            {analyserNode && <AudioWaveform analyserNode={analyserNode} />}

            {/* 暂存区内容（有文字时才显示） */}
            {staging && (staging.rawText || staging.interimText) && (
              <>
                <div className="text-[10px] text-[var(--color-text-muted)] mb-1 mt-2 font-medium uppercase tracking-wider">{t('voice.rawText')}</div>
                <div className="text-sm text-[var(--color-text-primary)] leading-relaxed break-all mb-2">
                  {staging.rawText}
                  {staging.interimText && (
                    <span className="text-[var(--color-text-muted)] italic">{staging.interimText}</span>
                  )}
                </div>
                {(staging.refinedText || staging.isRefining || staging.refineFailed) && (
                  <>
                    <div className="text-[10px] font-medium uppercase tracking-wider flex items-center gap-1 mb-1">
                      <span className={staging.refineFailed ? 'text-[var(--color-error)]' : 'text-[var(--color-accent)]'}>
                        {t('voice.refinedText')}
                      </span>
                      {staging.isRefining && (
                        <span className="text-[var(--color-text-muted)] animate-pulse">{t('voice.refining')}</span>
                      )}
                    </div>
                    <div className="text-sm leading-relaxed break-all">
                      {staging.refineFailed ? (
                        <span className="text-[var(--color-error)]/80">{t('voice.refineFailed')}</span>
                      ) : (
                        <span className="text-[var(--color-accent)]">{staging.refinedText}</span>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
