import { type FC, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArchiveIcon, EditorIcon } from './Icons';
import { isTauri } from '@/lib/backend';

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
  const { t } = useTranslation();
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
        {isTauri() && (
        <button
          onClick={onArchive}
          className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <ArchiveIcon className="w-4 h-4" />
          {t('contextMenu.archive')}
        </button>
        )}
      </div>
    </div>
  );
};

interface TerminalTabContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onDuplicate: () => void;
  onCloseTab: () => void;
  onCloseOtherTabs: () => void;
  onCloseAllTabs: () => void;
}

export const TerminalTabContextMenu: FC<TerminalTabContextMenuProps> = ({
  x,
  y,
  onClose,
  onDuplicate,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
}) => {
  const { t } = useTranslation();
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
          onClick={onDuplicate}
          className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {t('contextMenu.duplicateTerminal')}
        </button>
        <div className="border-t border-slate-700 my-1" />
        <button
          onClick={onCloseTab}
          className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
          {t('contextMenu.closeTab')}
        </button>
        <button
          onClick={onCloseOtherTabs}
          className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
          </svg>
          {t('contextMenu.closeOtherTabs')}
        </button>
        <button
          onClick={onCloseAllTabs}
          className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
          {t('contextMenu.closeAllTabs')}
        </button>
      </div>
    </div>
  );
};

interface IdePickerContextMenuProps {
  anchorRect: DOMRect;
  editors: Array<{ id: string; name: string }>;
  onSelect: (editorId: string) => void;
  onClose: () => void;
}

export const IdePickerContextMenu: FC<IdePickerContextMenuProps> = ({
  anchorRect,
  editors,
  onSelect,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Each icon ~32px + 4px gap, plus 8px total padding
  const popoverWidth = editors.length * 36 + 8;
  const left = Math.min(anchorRect.left, window.innerWidth - popoverWidth - 8);
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow >= 52 ? anchorRect.bottom + 4 : anchorRect.top - 48;

  useEffect(() => {
    let removeListener: (() => void) | undefined;
    const timer = setTimeout(() => {
      const handle = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          onCloseRef.current();
        }
      };
      document.addEventListener('mousedown', handle, true);
      removeListener = () => document.removeEventListener('mousedown', handle, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      removeListener?.();
    };
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] flex gap-1 p-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {editors.map((editor) => (
        <button
          key={editor.id}
          title={editor.name}
          onClick={() => {
            onSelect(editor.id);
            onCloseRef.current();
          }}
          className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-colors"
        >
          <EditorIcon editorId={editor.id} className="w-5 h-5" />
        </button>
      ))}
    </div>,
    document.body,
  );
};
