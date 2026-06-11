import { createContext, useContext, useState, useCallback, useRef, type FC, type ReactNode } from 'react';
import { CheckCircle, AlertTriangle, Info, X, XCircle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const EXIT_DURATION = 200;

// Duration per type: 0 = persistent (manual close only)
const TYPE_DURATION: Record<ToastType, number> = {
  success: 3000,
  error: 0,
  info: 3000,
  warning: 5000,
};

const typeConfig: Record<ToastType, { bg: string; icon: FC<{ className?: string }>; barColor: string; iconColor: string }> = {
  success: {
    bg: 'bg-[var(--color-bg-surface)] border-[var(--color-border)]',
    icon: CheckCircle,
    barColor: 'bg-[var(--color-success)]',
    iconColor: 'text-[var(--color-success)]',
  },
  error: {
    bg: 'bg-[var(--color-bg-surface)] border-[var(--color-border)]',
    icon: XCircle,
    barColor: 'bg-[var(--color-error)]',
    iconColor: 'text-[var(--color-error)]',
  },
  info: {
    bg: 'bg-[var(--color-bg-surface)] border-[var(--color-border)]',
    icon: Info,
    barColor: 'bg-[var(--color-accent)]',
    iconColor: 'text-[var(--color-accent)]',
  },
  warning: {
    bg: 'bg-[var(--color-bg-surface)] border-[var(--color-border)]',
    icon: AlertTriangle,
    barColor: 'bg-[var(--color-warning)]',
    iconColor: 'text-[var(--color-warning)]',
  },
};

export const ToastProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    // Clear auto-dismiss timer to prevent double-fire
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }

    setToasts((prev) => {
      // Skip if already exiting or not found
      const target = prev.find((t) => t.id === id);
      if (!target || target.exiting) return prev;
      return prev.map((t) => t.id === id ? { ...t, exiting: true } : t);
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_DURATION);
  }, []);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    const duration = TYPE_DURATION[type];
    if (duration > 0) {
      timersRef.current.set(id, setTimeout(() => dismiss(id), duration));
    }
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2">
        {toasts.map((t) => {
          const config = typeConfig[t.type];
          const Icon = config.icon;
          return (
            <div
              key={t.id}
              className={`relative flex items-stretch border rounded-lg overflow-hidden shadow-lg max-w-sm ${config.bg} ${
                t.exiting ? 'slide-out-to-right' : 'slide-in-from-bottom-4'
              }`}
            >
              {/* Left color bar */}
              <div className={`w-0.5 shrink-0 ${config.barColor}`} />
              <div className="flex items-start gap-2.5 p-3 flex-1">
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${config.iconColor}`} />
                <p className="text-sm text-[var(--color-text-primary)] flex-1 break-words">{t.message}</p>
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* Countdown bar (only for auto-dismissing toasts) */}
              {!t.exiting && TYPE_DURATION[t.type] > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5">
                  <div
                    className={`h-full ${config.barColor} opacity-40`}
                    style={{ animation: `toast-countdown ${TYPE_DURATION[t.type]}ms linear forwards` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
