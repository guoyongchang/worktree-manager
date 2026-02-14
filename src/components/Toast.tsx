import { createContext, useContext, useState, useCallback, useRef, type FC, type ReactNode } from 'react';
import { CheckCircle, AlertTriangle, Info, X, XCircle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
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

const typeConfig: Record<ToastType, { bg: string; icon: FC<{ className?: string }> }> = {
  success: { bg: 'bg-green-900/30 text-green-300 border-green-800/50', icon: CheckCircle },
  error: { bg: 'bg-red-900/30 text-red-300 border-red-800/50', icon: XCircle },
  info: { bg: 'bg-blue-500/10 text-blue-400 border-blue-800/50', icon: Info },
  warning: { bg: 'bg-amber-900/30 text-amber-300 border-amber-800/50', icon: AlertTriangle },
};

export const ToastProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

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
              className={`flex items-start gap-3 border rounded-lg p-3 shadow-lg animate-in slide-in-from-bottom-4 fade-in duration-300 max-w-sm ${config.bg}`}
            >
              <Icon className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-sm flex-1 break-words">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
