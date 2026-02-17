import { useRef, useState, useEffect, type FC } from 'react';
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
import type { VoiceStatus } from '../hooks/useVoiceInput';
import type { TerminalTab } from '../types';

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
}) => {
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
          className="h-1 bg-slate-700 hover:bg-blue-500 cursor-ns-resize shrink-0 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            onStartResize();
          }}
        />
      )}
      {/* Header with tabs */}
      <div className="flex items-center bg-slate-800/50 select-none shrink-0 border-b border-slate-700/50">
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400 cursor-pointer hover:bg-slate-700/50 transition-colors"
          onClick={onToggle}
          role="button"
          aria-label={visible ? "折叠终端面板" : "展开终端面板"}
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
                  {isActivated && (
                    <span
                      className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-slate-600 text-slate-500 hover:text-slate-300 transition-colors"
                      onClick={(e) => { e.stopPropagation(); onCloseTab(tab.path); }}
                      title="关闭"
                      role="button"
                      aria-label={`关闭终端 ${tab.name}`}
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
                className={`p-1.5 rounded transition-colors relative ${
                  voiceStatus === 'recording'
                    ? 'text-red-400 hover:bg-red-900/30'
                    : voiceStatus === 'ready'
                      ? 'text-green-400 hover:bg-green-900/30'
                      : voiceStatus === 'error'
                        ? 'text-red-400 hover:bg-slate-700'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'
                }`}
                title={
                  voiceStatus === 'recording'
                    ? isKeyHeld ? '松开 Alt+V 停止' : '点击关闭语音模式'
                    : voiceStatus === 'ready'
                      ? '按住 Alt+V 开始说话 | 点击关闭语音模式'
                      : voiceError
                        ? `语音输入错误: ${voiceError}`
                        : '开启语音模式'
                }
                aria-label="语音输入"
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
                title={isFullscreen ? "退出全屏" : "终端全屏"}
                aria-label={isFullscreen ? "退出终端全屏" : "终端全屏"}
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
                title="折叠终端"
                aria-label="折叠终端面板"
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
                点击上方项目标签打开终端
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            点击上方项目标签打开终端
          </div>
        )}

        {/* 语音错误提示 */}
        {showError && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-red-900/90 border border-red-700/50 rounded-lg text-sm text-red-200 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
            {showError}
          </div>
        )}

        {/* 录音遮罩 + 波形 */}
        {voiceStatus === 'recording' && (
          <div className="absolute inset-0 z-10 bg-black/50 flex flex-col items-center justify-center gap-3 fade-in-0">
            {analyserNode && <AudioWaveform analyserNode={analyserNode} />}
            <span className="text-sm text-slate-400 select-none">
              正在录音... 松开 Alt+V 停止
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
