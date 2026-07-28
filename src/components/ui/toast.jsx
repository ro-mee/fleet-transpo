"use client";

import { useState, useEffect, useCallback } from "react";
import { create } from "zustand";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

let toastId = 0;

export const useToastStore = create((set) => ({
  toasts: [],
  add: (toast) => {
    const id = ++toastId;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    return id;
  },
  remove: (id) => {
    set((state) => ({ toasts: state.toasts.map((t) => t.id === id ? { ...t, leaving: true } : t) }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 200);
  },
}));

export const toast = {
  success: (message) => useToastStore.getState().add({ type: "success", message }),
  error: (message) => useToastStore.getState().add({ type: "error", message }),
  warning: (message) => useToastStore.getState().add({ type: "warning", message }),
  info: (message) => useToastStore.getState().add({ type: "info", message }),
};

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const accentClass = {
  success: "border-l-success",
  error: "border-l-danger",
  warning: "border-l-warning",
  info: "border-l-info",
};

const iconColor = {
  success: "text-success",
  error: "text-danger",
  warning: "text-warning",
  info: "text-info",
};

function ToastItem({ t, onClose }) {
  const Icon = iconMap[t.type];
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={cn(
        "flex items-start gap-3 bg-surface border border-border rounded-xl shadow-lg p-4 transition-all duration-200 ease-out",
        "border-l-[3px]",
        accentClass[t.type],
        mounted && !t.leaving ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
      )}
    >
      <Icon className={cn("w-5 h-5 flex-shrink-0 mt-0.5", iconColor[t.type])} />
      <p className="flex-1 text-sm text-foreground">{t.message}</p>
      <button
        onClick={onClose}
        className="flex-shrink-0 text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function ToastItemWrapper({ t, remove }) {
  const handleClose = useCallback(() => remove(t.id), [t.id, remove]);
  return (
    <div className="pointer-events-auto">
      <ToastItem t={t} onClose={handleClose} />
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((t) => (
        <ToastItemWrapper key={t.id} t={t} remove={remove} />
      ))}
    </div>
  );
}
