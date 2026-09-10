"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

/**
 * Minimal toast/snackbar system — the admin UI had none before this. A
 * single provider at the top of the secure admin layout, `useToast()`
 * anywhere below it. Auto-dismisses; no queue limit needed at this scale.
 */

type ToastTone = "success" | "error" | "info";

interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<ToastTone, string> = {
  success: "bg-state-success text-white",
  error: "bg-state-danger text-white",
  info: "bg-ink text-white",
};

const AUTO_DISMISS_MS = 3500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((text: string, tone: ToastTone = "info") => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded-xl px-4 py-3 text-center text-sm font-semibold shadow-modal ${TONE_CLASS[toast.tone]}`}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}
