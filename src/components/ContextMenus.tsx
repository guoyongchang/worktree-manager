import { type FC, type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArchiveIcon, EditorIcon, TerminalAppIcon } from './Icons';
import { isTauri } from '@/lib/backend';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onArchive: () => void;
  currentColor?: string | null;
  onSetColor?: (color: string | null) => void;
}

const COLOR_OPTIONS = [
  { key: 'red',    class: 'bg-red-400' },
  { key: 'orange', class: 'bg-orange-400' },
  { key: 'yellow', class: 'bg-yellow-400' },
  { key: 'green',  class: 'bg-emerald-400' },
  { key: 'blue',   class: 'bg-[var(--color-accent)]' },
  { key: 'purple', class: 'bg-purple-400' },
];

export const WorktreeContextMenu: FC<ContextMenuProps> = ({
  x,
  y,
  onClose,
  onArchive,
  currentColor,
  onSetColor,
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
    >
      <div
        className="absolute bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[140px]"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        {onSetColor && (
          <>
            <div className="px-3 py-1.5">
              <div className="text-[10px] text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">{t('contextMenu.setColor', '标记颜色')}</div>
              <div className="flex items-center gap-1.5">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => { onSetColor(c.key); onClose(); }}
                    className={`w-5 h-5 rounded-full ${c.class} ${currentColor === c.key ? 'ring-2 ring-white/60' : 'hover:scale-110'} transition-transform`}
                    title={c.key}
                  />
                ))}
                {currentColor && (
                  <button
                    onClick={() => { onSetColor(null); onClose(); }}
                    className="w-5 h-5 rounded-full border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors ml-1"
                    title={t('contextMenu.removeColor', '清除')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </>
        )}
        {isTauri() && (
          <>
            <div className="border-t border-[var(--color-border)] my-1" />
            <button
              onClick={onArchive}
              className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] flex items-center gap-2 transition-colors"
            >
              <ArchiveIcon className="w-4 h-4" />
              {t('contextMenu.archive')}
            </button>
          </>
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
        className="absolute bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[140px]"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onDuplicate}
          className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] flex items-center gap-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {t('contextMenu.duplicateTerminal')}
        </button>
        <div className="border-t border-[var(--color-border)] my-1" />
        <button
          onClick={onCloseTab}
          className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] flex items-center gap-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
          {t('contextMenu.closeTab')}
        </button>
        <button
          onClick={onCloseOtherTabs}
          className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] flex items-center gap-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
          </svg>
          {t('contextMenu.closeOtherTabs')}
        </button>
        <button
          onClick={onCloseAllTabs}
          className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] flex items-center gap-2 transition-colors"
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

// Shared popover used by both IDE and Terminal pickers
interface AppPickerPopoverProps {
  anchorRect: DOMRect;
  items: Array<{ id: string; name: string }>;
  onSelect: (id: string) => void;
  onClose: () => void;
  renderIcon: (id: string) => ReactNode;
}

const AppPickerPopover: FC<AppPickerPopoverProps> = ({ anchorRect, items, onSelect, onClose, renderIcon }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 3 cols × 32px icon + 2 gaps × 4px + 8px padding ≈ 112px
  const popoverWidth = 116;
  const rows = Math.ceil(items.length / 3);
  const popoverHeight = rows * 36 + 8;
  // Right-align: popover's right edge = button's right edge
  const left = Math.max(8, anchorRect.right - popoverWidth);
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow >= popoverHeight + 8 ? anchorRect.bottom + 4 : anchorRect.top - popoverHeight - 4;

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
      className="fixed z-[9999] grid grid-cols-3 gap-1 p-1 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg shadow-lg"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          title={item.name}
          onClick={() => { onSelect(item.id); onCloseRef.current(); }}
          className="p-1.5 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
        >
          {renderIcon(item.id)}
        </button>
      ))}
    </div>,
    document.body,
  );
};

interface IdePickerContextMenuProps {
  anchorRect: DOMRect;
  editors: Array<{ id: string; name: string }>;
  onSelect: (editorId: string) => void;
  onClose: () => void;
}

export const IdePickerContextMenu: FC<IdePickerContextMenuProps> = ({ anchorRect, editors, onSelect, onClose }) => (
  <AppPickerPopover
    anchorRect={anchorRect}
    items={editors}
    onSelect={onSelect}
    onClose={onClose}
    renderIcon={(id) => <EditorIcon editorId={id} className="w-5 h-5" />}
  />
);

interface TerminalPickerPopoverProps {
  anchorRect: DOMRect;
  terminals: Array<{ id: string; name: string }>;
  onSelect: (terminalId: string) => void;
  onClose: () => void;
}

export const TerminalPickerPopover: FC<TerminalPickerPopoverProps> = ({ anchorRect, terminals, onSelect, onClose }) => (
  <AppPickerPopover
    anchorRect={anchorRect}
    items={terminals}
    onSelect={onSelect}
    onClose={onClose}
    renderIcon={(id) => <TerminalAppIcon terminalId={id} className="w-5 h-5" />}
  />
);
