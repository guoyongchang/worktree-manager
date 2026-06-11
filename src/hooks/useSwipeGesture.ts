import { useRef, useCallback, useEffect } from 'react';

interface SwipeOptions {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    onSwipeDown?: () => void;
    threshold?: number;
}

/**
 * Hook to detect horizontal/vertical swipe gestures on a touch device.
 * Attach the returned ref to the container element.
 */
export function useSwipeGesture<T extends HTMLElement>(options: SwipeOptions) {
    const { onSwipeLeft, onSwipeRight, onSwipeDown, threshold = 80 } = options;
    const ref = useRef<T>(null);
    const startRef = useRef({ x: 0, y: 0, time: 0 });

    const handleTouchStart = useCallback((e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        startRef.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: Date.now(),
        };
    }, []);

    const handleTouchEnd = useCallback((e: TouchEvent) => {
        if (e.changedTouches.length !== 1) return;
        const end = e.changedTouches[0];
        const { x: sx, y: sy, time } = startRef.current;
        const dx = end.clientX - sx;
        const dy = end.clientY - sy;
        const dt = Date.now() - time;

        // Must be fast enough (< 500ms) and long enough distance
        if (dt > 500) return;

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // Horizontal swipe (must be predominantly horizontal)
        if (absDx > threshold && absDx > absDy * 1.5) {
            if (dx < 0 && onSwipeLeft) {
                onSwipeLeft();
            } else if (dx > 0 && onSwipeRight) {
                onSwipeRight();
            }
            return;
        }

        // Vertical swipe down (pull-to-refresh style)
        if (dy > threshold && absDy > absDx * 1.5 && onSwipeDown) {
            onSwipeDown();
        }
    }, [onSwipeLeft, onSwipeRight, onSwipeDown, threshold]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        el.addEventListener('touchstart', handleTouchStart, { passive: true });
        el.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
            el.removeEventListener('touchstart', handleTouchStart);
            el.removeEventListener('touchend', handleTouchEnd);
        };
    }, [handleTouchStart, handleTouchEnd]);

    return ref;
}
