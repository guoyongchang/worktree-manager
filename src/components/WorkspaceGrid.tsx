import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CellContext } from '../contexts/CellContext';
import { WorkspaceCell } from './WorkspaceCell';
import { PlusIcon } from './Icons';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface GridCellState {
  id: string;  // Stable identity derived from key — never reassigned
  key: number; // Stable React key (monotonically increasing)
  initialWorkspacePath: string;
}

type GridState = GridCellState[][];

function isCellClosable(grid: GridState, r: number, c: number): boolean {
  if (r === 0 && c === 0) return false;
  if (grid[r].length === 3 && c === 1) return false;
  if (c === 0 && grid.length === 3 && r === 1) return false;
  return true;
}

/** Create an evenly distributed array of percentages */
function evenSplit(n: number): number[] {
  return Array(n).fill(100 / n);
}

const MIN_PCT = 15; // Minimum cell/row size in percent

interface WorkspaceGridProps {
  currentWorkspacePath: string;
}

export function WorkspaceGrid({ currentWorkspacePath }: WorkspaceGridProps) {
  const { t } = useTranslation();
  const nextKey = useRef(1);
  const [grid, setGrid] = useState<GridState>(() => [[
    { id: '0', key: 0, initialWorkspacePath: currentWorkspacePath },
  ]]);

  // Row heights as percentages (sum = 100)
  const [rowHeights, setRowHeights] = useState<number[]>([100]);
  // Per-row column widths as percentages (each row's sum = 100)
  const [colWidths, setColWidths] = useState<number[][]>([[100]]);

  const containerRef = useRef<HTMLDivElement>(null);

  const addCellToRow = useCallback((rowIndex: number) => {
    setGrid(prev => {
      const row = prev[rowIndex];
      if (row.length >= 3) return prev;
      const lastCell = row[row.length - 1];
      const key = nextKey.current++;
      const newCell: GridCellState = {
        id: String(key),
        key,
        initialWorkspacePath: lastCell.initialWorkspacePath,
      };
      return prev.map((r, i) => i === rowIndex ? [...r, newCell] : r);
    });
    setColWidths(prev => prev.map((widths, i) => {
      if (i !== rowIndex) return widths;
      if (widths.length >= 3) return widths;
      return evenSplit(widths.length + 1);
    }));
  }, []);

  const addRow = useCallback(() => {
    setGrid(prev => {
      if (prev.length >= 3) return prev;
      const lastRow = prev[prev.length - 1];
      const key = nextKey.current++;
      const newCell: GridCellState = {
        id: String(key),
        key,
        initialWorkspacePath: lastRow[0].initialWorkspacePath,
      };
      return [...prev, [newCell]];
    });
    setRowHeights(prev => {
      if (prev.length >= 3) return prev;
      return evenSplit(prev.length + 1);
    });
    setColWidths(prev => [...prev, [100]]);
  }, []);

  const [showSplitMenu, setShowSplitMenu] = useState(false);
  const [showFab, setShowFab] = useState(() => {
    try { return JSON.parse(localStorage.getItem('show_split_button') ?? 'true'); } catch { return true; }
  });
  const canAddRow = grid.length < 3;
  const canAddAnyCol = grid.some(row => row.length < 3);

  useEffect(() => { setShowSplitMenu(false); }, [grid]);

  // Listen for setting changes from SettingsView
  useEffect(() => {
    const handler = () => {
      try { setShowFab(JSON.parse(localStorage.getItem('show_split_button') ?? 'true')); } catch { setShowFab(true); }
    };
    window.addEventListener('split-button-changed', handler);
    return () => window.removeEventListener('split-button-changed', handler);
  }, []);

  const closeCell = useCallback((rowIndex: number, colIndex: number) => {
    setGrid(prev => {
      const newGrid = prev.map((row, r) => {
        if (r !== rowIndex) return row;
        return row.filter((_, c) => c !== colIndex);
      }).filter(row => row.length > 0);
      return newGrid;
    });
    setColWidths(prev => {
      const updated = prev.map((widths, r) => {
        if (r !== rowIndex) return widths;
        const newWidths = widths.filter((_, c) => c !== colIndex);
        if (newWidths.length === 0) return newWidths;
        // Redistribute: normalize to 100%
        const sum = newWidths.reduce((a, b) => a + b, 0);
        return newWidths.map(w => (w / sum) * 100);
      }).filter(widths => widths.length > 0);
      return updated;
    });
    setRowHeights(prev => {
      // Check if this row will be removed
      const rowWillBeRemoved = grid[rowIndex].length === 1;
      if (!rowWillBeRemoved) return prev;
      const newHeights = prev.filter((_, r) => r !== rowIndex);
      const sum = newHeights.reduce((a, b) => a + b, 0);
      return newHeights.map(h => (h / sum) * 100);
    });
  }, [grid]);

  // --- Resize logic ---
  const resizingRef = useRef<{
    type: 'col' | 'row';
    rowIndex: number;
    index: number; // The divider index (between index and index+1)
    startPos: number;
    startSizes: number[];
    containerSize: number;
  } | null>(null);

  const handleResizeStart = useCallback((
    e: React.MouseEvent,
    type: 'col' | 'row',
    rowIndex: number,
    index: number,
  ) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    resizingRef.current = {
      type,
      rowIndex,
      index,
      startPos: type === 'col' ? e.clientX : e.clientY,
      startSizes: type === 'col' ? [...(colWidths[rowIndex] || [])] : [...rowHeights],
      containerSize: type === 'col' ? rect.width : rect.height,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const delta = (r.type === 'col' ? ev.clientX : ev.clientY) - r.startPos;
      const deltaPct = (delta / r.containerSize) * 100;

      const newSizes = [...r.startSizes];
      const a = r.index;
      const b = r.index + 1;
      newSizes[a] = r.startSizes[a] + deltaPct;
      newSizes[b] = r.startSizes[b] - deltaPct;

      // Enforce minimums
      if (newSizes[a] < MIN_PCT) {
        newSizes[b] -= MIN_PCT - newSizes[a];
        newSizes[a] = MIN_PCT;
      }
      if (newSizes[b] < MIN_PCT) {
        newSizes[a] -= MIN_PCT - newSizes[b];
        newSizes[b] = MIN_PCT;
      }

      if (r.type === 'col') {
        setColWidths(prev => prev.map((w, i) => i === r.rowIndex ? newSizes : w));
      } else {
        setRowHeights(newSizes);
      }
    };

    const handleMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = type === 'col' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths, rowHeights]);

  return (
    <div ref={containerRef} className="h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] flex flex-col relative overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col">
        {grid.map((row, rowIndex) => (
          <div key={`row-wrapper-${row[0].key}`} className="min-h-0 flex flex-col" style={{ height: `${rowHeights[rowIndex] ?? 100}%` }}>
            {/* Row resize handle */}
            {rowIndex > 0 && (
              <div
                className="shrink-0 h-1 cursor-row-resize group/row-handle flex items-center justify-center bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/40 transition-colors z-10"
                onMouseDown={(e) => handleResizeStart(e, 'row', 0, rowIndex - 1)}
              >
                <div className="w-8 h-0.5 rounded-full bg-[var(--color-accent)]/60 group-hover/row-handle:bg-[var(--color-accent)] transition-colors" />
              </div>
            )}
            <div className="flex-1 min-h-0 flex">
              {row.map((cell, colIndex) => {
                const closable = isCellClosable(grid, rowIndex, colIndex);
                return (
                  <div key={`cell-wrapper-${cell.key}`} className="min-w-0 flex" style={{ width: `${colWidths[rowIndex]?.[colIndex] ?? 100}%` }}>
                    {/* Column resize handle */}
                    {colIndex > 0 && (
                      <div
                        className="shrink-0 w-1 cursor-col-resize group/col-handle flex items-center justify-center bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/40 transition-colors z-10"
                        onMouseDown={(e) => handleResizeStart(e, 'col', rowIndex, colIndex - 1)}
                      >
                        <div className="h-8 w-0.5 rounded-full bg-[var(--color-accent)]/60 group-hover/col-handle:bg-[var(--color-accent)] transition-colors" />
                      </div>
                    )}
                    <CellContext.Provider
                      value={{ cellId: cell.id, isPrimary: cell.key === 0 }}
                    >
                      <div className="flex-1 min-w-0 group/cell relative">
                        <WorkspaceCell
                          initialWorkspacePath={cell.initialWorkspacePath}
                          closable={closable}
                          onClose={closable ? () => closeCell(rowIndex, colIndex) : undefined}
                        />
                      </div>
                    </CellContext.Provider>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* FAB + split triggers */}
      {showFab && (canAddAnyCol || canAddRow) && (
        <>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowSplitMenu(prev => !prev)}
                  style={{ bottom: 4, right: 4, width: 25, height: 25 }}
                  className={`absolute z-[60] rounded-full flex items-center justify-center
                             shadow-lg transition-all duration-200 cursor-pointer
                             ${showSplitMenu
                               ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] rotate-45'
                               : 'bg-[var(--color-accent)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-fg)]'
                             }`}
                >
                  <PlusIcon className="w-2.5 h-2.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('grid.splitView')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {showSplitMenu && (
            <>
              <div className="absolute inset-0 z-40" onClick={() => setShowSplitMenu(false)} />

              {grid.map((row, rowIndex) => row.length < 3 && (
                <div
                  key={`add-col-${row[0].key}`}
                  onClick={() => { addCellToRow(rowIndex); setShowSplitMenu(false); }}
                  className="absolute right-0 z-50 w-8 flex items-center justify-center
                             cursor-pointer bg-[var(--color-accent)]/10 border-l-2 border-[var(--color-accent)]/40
                             hover:bg-[var(--color-accent)]/20 transition-colors animate-in fade-in duration-150"
                  style={{
                    top: `${rowHeights.slice(0, rowIndex).reduce((a, b) => a + b, 0)}%`,
                    height: `${rowHeights[rowIndex]}%`,
                  }}
                >
                  <div className="text-[var(--color-accent)]">
                    <PlusIcon className="w-3.5 h-3.5" />
                  </div>
                </div>
              ))}

              {canAddRow && (
                <div
                  onClick={() => { addRow(); setShowSplitMenu(false); }}
                  className="absolute bottom-0 left-0 right-0 z-50 h-8 flex items-center justify-center
                             cursor-pointer bg-[var(--color-accent)]/10 border-t-2 border-[var(--color-accent)]/40
                             hover:bg-[var(--color-accent)]/20 transition-colors animate-in fade-in duration-150"
                >
                  <div className="flex items-center gap-1 text-[var(--color-accent)]">
                    <PlusIcon className="w-3.5 h-3.5" />
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
