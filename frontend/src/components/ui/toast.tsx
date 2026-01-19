"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning" | "info" | "loading";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  toasts: Toast[];
  toast: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((newToast: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    const toastWithId = { ...newToast, id, duration: newToast.duration ?? 5000 };
    setToasts((prev) => [...prev, toastWithId]);

    if (toastWithId.type !== "loading" && toastWithId.duration && toastWithId.duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, toastWithId.duration);
    }

    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

function ToastContainer({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  return (
    <div
      className="fixed top-5 left-1/2 z-[100] w-full max-w-3xl -translate-x-1/2 px-4 space-y-3 pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} dismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => dismiss(toast.id), 300);
  };

  const iconMap = {
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
    loading: Loader2,
  };

  const appearance: Record<
    ToastType,
    {
      container: string;
      accent: string;
      icon: string;
      action: string;
      close: string;
    }
  > = {
    success: {
      container:
        "border-emerald-200/80 bg-white/95 text-slate-900 shadow-[0_20px_50px_rgba(16,185,129,0.18)] dark:bg-slate-900/90 dark:text-white dark:border-emerald-500/40",
      accent: "from-emerald-400/90 via-emerald-300/70 to-transparent",
      icon: "text-emerald-600 bg-emerald-50 border border-emerald-100/80 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30",
      action: "text-emerald-700 hover:text-emerald-600 dark:text-emerald-200 dark:hover:text-emerald-100",
      close: "text-emerald-500/70 hover:text-emerald-600 dark:text-emerald-200/70 dark:hover:text-white",
    },
    error: {
      container:
        "border-red-200/80 bg-white/95 text-slate-900 shadow-[0_20px_50px_rgba(239,68,68,0.18)] dark:bg-slate-900/90 dark:text-white dark:border-red-500/40",
      accent: "from-red-400/90 via-red-300/70 to-transparent",
      icon: "text-red-600 bg-red-50 border border-red-100/80 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/30",
      action: "text-red-600 hover:text-red-500 dark:text-red-200",
      close: "text-red-500/70 hover:text-red-600 dark:text-red-200/70 dark:hover:text-white",
    },
    warning: {
      container:
        "border-amber-200/80 bg-white/95 text-slate-900 shadow-[0_20px_50px_rgba(245,158,11,0.2)] dark:bg-slate-900/90 dark:text-white dark:border-amber-500/40",
      accent: "from-amber-400/90 via-amber-300/70 to-transparent",
      icon: "text-amber-600 bg-amber-50 border border-amber-100/80 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30",
      action: "text-amber-700 hover:text-amber-600 dark:text-amber-200",
      close: "text-amber-500/70 hover:text-amber-600 dark:text-amber-200/70 dark:hover:text-white",
    },
    info: {
      container:
        "border-sky-200/80 bg-white/95 text-slate-900 shadow-[0_20px_50px_rgba(14,165,233,0.2)] dark:bg-slate-900/90 dark:text-white dark:border-sky-500/40",
      accent: "from-sky-400/90 via-sky-300/70 to-transparent",
      icon: "text-sky-600 bg-sky-50 border border-sky-100/80 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/30",
      action: "text-sky-700 hover:text-sky-600 dark:text-sky-200",
      close: "text-sky-500/70 hover:text-sky-600 dark:text-sky-200/70 dark:hover:text-white",
    },
    loading: {
      container:
        "border-slate-200/80 bg-white/95 text-slate-900 shadow-[0_20px_50px_rgba(148,163,184,0.22)] dark:bg-slate-900/90 dark:text-white dark:border-slate-600/60",
      accent: "from-slate-400/80 via-slate-300/50 to-transparent",
      icon: "text-slate-600 bg-slate-100 border border-slate-200/80 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
      action: "text-slate-600 hover:text-slate-500 dark:text-slate-200",
      close: "text-slate-500/70 hover:text-slate-700 dark:text-slate-200/70",
    },
  };

  const Icon = iconMap[toast.type];
  const styles = appearance[toast.type];

  return (
    <div
      className={cn(
        "pointer-events-auto w-full overflow-hidden rounded-2xl border backdrop-blur-xl transition-all duration-300 animate-in fade-in-0 slide-in-from-top-4",
        styles.container,
        isExiting && "animate-out fade-out-0 slide-out-to-top-4 opacity-0"
      )}
      role="alert"
      aria-live={toast.type === "error" ? "assertive" : "polite"}
    >
      <div className={cn("h-1 w-full bg-gradient-to-r", styles.accent)} aria-hidden />
      <div className="flex items-start gap-4 px-5 py-4">
        <div
          className={cn(
            "mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border text-base",
            styles.icon
          )}
        >
          {toast.type === "loading" ? (
            <Icon className="h-5 w-5 animate-spin" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold tracking-tight">{toast.title}</p>
          {toast.description && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{toast.description}</p>
          )}
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.onClick();
                handleDismiss();
              }}
              className={cn(
                "mt-2 inline-flex items-center text-xs font-semibold uppercase tracking-wide",
                styles.action
              )}
            >
              {toast.action.label}
            </button>
          )}
        </div>
        {toast.type !== "loading" && (
          <button
            onClick={handleDismiss}
            className={cn(
              "flex-shrink-0 rounded-full p-1.5 transition-colors",
              styles.close
            )}
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
