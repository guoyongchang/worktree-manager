import type { FC } from 'react';
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

interface TerminalPanelProps {
  visible: boolean;
  height: number;
  onStartResize: () => void;
  terminalTabs: TerminalTab[];
  activatedTerminals: Set<string>;
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
  /** 0 = just spoke, 1 = about to auto-stop */
  silenceProgress?: number;
  onToggleVoice?: () => void;
}

export const TerminalPanel: FC<TerminalPanelProps> = ({
  visible,
  height,
  onStartResize,
  terminalTabs,
  activatedTerminals,
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
  silenceProgress = 0,
  onToggleVoice,
}) => {
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
        {/* Silence countdown bar — fills up as silence duration increases */}
        {voiceStatus === 'recording' && silenceProgress > 0 && (
          <div className="w-20 h-1 bg-slate-700/50 rounded-full mx-1 shrink-0 overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-[width] duration-100"
              style={{ width: `${silenceProgress * 100}%` }}
            />
          </div>
        )}
        {/* Voice, Fullscreen & Collapse buttons */}
        {visible && (
          <div className="flex items-center mx-1">
            {onToggleVoice && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleVoice(); }}
                className={`p-1.5 rounded transition-colors relative ${
                  voiceStatus === 'recording'
                    ? 'text-red-400 hover:bg-red-900/30'
                    : voiceStatus === 'error'
                      ? 'text-red-400 hover:bg-slate-700'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'
                }`}
                title={
                  voiceStatus === 'recording'
                    ? '停止语音输入'
                    : voiceError
                      ? `语音输入错误: ${voiceError}`
                      : '语音输入'
                }
                aria-label="语音输入"
              >
                <MicIcon className="w-3.5 h-3.5" />
                {voiceStatus === 'recording' && (
                  <span
                    className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full animate-pulse bg-red-500"
                  />
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
        {/* Always render all activated terminals to preserve PTY sessions across view switches */}
        {activatedTerminals.size > 0 ? (
          <>
            {Array.from(activatedTerminals).map(path => (
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
      </div>
    </div>
  );
};
