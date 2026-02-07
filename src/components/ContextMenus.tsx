import type { FC } from 'react';
import { ArchiveIcon } from './Icons';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onArchive: () => void;
}

export const WorktreeContextMenu: FC<ContextMenuProps> = ({
  x,
  y,
  onClose,
  onArchive,
}) => {
  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
    >
      <div
        className="absolute bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[140px]"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onArchive}
          className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <ArchiveIcon className="w-4 h-4" />
          归档
        </button>
      </div>
    </div>
  );
};

interface TerminalTabContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onDuplicate: () => void;
}

export const TerminalTabContextMenu: FC<TerminalTabContextMenuProps> = ({
  x,
  y,
  onClose,
  onDuplicate,
}) => {
  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
    >
      <div
        className="absolute bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[120px]"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onDuplicate}
          className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          复制终端
        </button>
      </div>
    </div>
  );
};
