import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

const AUTO_DISMISS_MS = 4000;

export function useToasts(autoDismissMs = AUTO_DISMISS_MS) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'success') => {
      const trimmed = message.trim();
      if (!trimmed) return;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      setToasts((prev) => [...prev, { id, message: trimmed, type }]);

      const timer = window.setTimeout(() => dismissToast(id), autoDismissMs);
      timersRef.current.set(id, timer);
    },
    [autoDismissMs, dismissToast],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { toasts, showToast, dismissToast };
}

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  isLightMode?: boolean;
}

export const ToastStack: React.FC<ToastStackProps> = ({ toasts, onDismiss, isLightMode = false }) => {
  if (toasts.length === 0) return null;

  const typeStyles: Record<ToastType, { container: string; icon: React.ReactNode }> = {
    success: {
      container: isLightMode
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-emerald-800/60 bg-emerald-950/90 text-emerald-200',
      icon: <CheckCircle className="h-4 w-4 shrink-0" />,
    },
    error: {
      container: isLightMode
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-red-800/60 bg-red-950/90 text-red-200',
      icon: <AlertCircle className="h-4 w-4 shrink-0" />,
    },
    info: {
      container: isLightMode
        ? 'border-sky-200 bg-sky-50 text-sky-800'
        : 'border-sky-800/60 bg-sky-950/90 text-sky-200',
      icon: <Info className="h-4 w-4 shrink-0" />,
    },
  };

  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-full max-w-sm flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => {
        const styles = typeStyles[toast.type];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm ${styles.container}`}
            role="status"
          >
            {styles.icon}
            <p className="flex-1 text-sm leading-snug">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className={`shrink-0 rounded p-0.5 transition ${isLightMode ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
