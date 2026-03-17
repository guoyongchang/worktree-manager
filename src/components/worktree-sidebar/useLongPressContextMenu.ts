import { useCallback, useRef, type MouseEvent, type TouchEvent } from 'react';

import type { WorktreeListItem } from '../../types';

export function useLongPressContextMenu(
  onContextMenu: (e: MouseEvent, worktree: WorktreeListItem) => void,
) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent, worktree: WorktreeListItem) => {
    longPressFiredRef.current = false;
    const touch = e.touches[0];
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      onContextMenu(
        { preventDefault: () => { }, clientX: touch.clientX, clientY: touch.clientY } as unknown as MouseEvent,
        worktree,
      );
    }, 500);
  }, [onContextMenu]);

  const clearTouchTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  return {
    longPressFiredRef,
    handleTouchStart,
    handleTouchEnd: clearTouchTimer,
    handleTouchMove: clearTouchTimer,
  };
}
