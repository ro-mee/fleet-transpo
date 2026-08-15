"use client";

import { useEffect, useCallback } from "react";
import { create } from "zustand";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

let toastId = 0;

export const useToastStore = create((set) => ({
  toasts: [],
  add: (toast) => {
    const id = ++toastId;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id, position: toast.position || "bottom-right" }] }));
    return id;
  },
  // Drop the item immediately — AnimatePresence plays the exit animation.
  remove: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  success: (message) => useToastStore.getState().add({ type: "success", message }),
  error: (message) => useToastStore.getState().add({ type: "error", message }),
  warning: (message) => useToastStore.getState().add({ type: "warning", message }),
  info: (message) => useToastStore.getState().add({ type: "info", message }),
  // Rich toast for live notifications: optional bold title, muted message,
  // custom auto-dismiss duration (ms), and a position. "top-right" anchors
  // below the top nav's notification bell; default keeps the classic
  // bottom-right corner for action feedback.
  show: ({ type = "info", title, message, duration = 4000, position }) =>
    useToastStore.getState().add({ type, title, message, duration, position }),
};

// Same motion language as the rest of the app.
const EASE = [0.32, 0.72, 0, 1];

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
  const isBellToast = t.position === "top-right";

  useEffect(() => {
    const timer = setTimeout(onClose, t.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [onClose, t.duration]);

  return (
    <motion.div
      // Bell toasts emanate from the bell icon (top-right origin): they grow
      // out of the bell on entry and collapse back into it on exit. Other
      // toasts keep the classic bottom-right slide.
      initial={isBellToast ? { opacity: 0, y: -16, x: 18, scale: 0.82 } : { opacity: 0, x: 48 }}
      animate={isBellToast ? { opacity: 1, y: 0, x: 0, scale: 1 } : { opacity: 1, x: 0 }}
      exit={isBellToast ? { opacity: 0, y: -12, x: 14, scale: 0.82 } : { opacity: 0, x: 48 }}
      transition={{ duration: 0.32, ease: EASE }}
      style={isBellToast ? { transformOrigin: "top right" } : undefined}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg",
        "border-l-[3px]",
        accentClass[t.type]
      )}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 flex-shrink-0", iconColor[t.type])} />
      <div className="min-w-0 flex-1">
        {t.title && <p className="text-sm font-bold text-foreground">{t.title}</p>}
        {t.message && (
          <p className={cn(t.title ? "mt-0.5 text-xs text-foreground-secondary" : "text-sm text-foreground")}>
            {t.message}
          </p>
        )}
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 cursor-pointer text-foreground-muted transition-colors hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

function ToastItemWrapper({ t, remove }) {
  const handleClose = useCallback(() => remove(t.id), [t.id, remove]);
  return <ToastItem t={t} onClose={handleClose} />;
}

const toastStackClass =
  "fixed z-[100] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)] pointer-events-none";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);
  const bottomToasts = toasts.filter((t) => t.position !== "top-right");
  const topToasts = toasts.filter((t) => t.position === "top-right");

  return (
    <MotionConfig reducedMotion="user">
      {/* Action feedback — classic bottom-right corner */}
      <div className={cn(toastStackClass, "bottom-4 right-4")}>
        <AnimatePresence>
          {bottomToasts.map((t) => (
            <ToastItemWrapper key={t.id} t={t} remove={remove} />
          ))}
        </AnimatePresence>
      </div>
      {/* Live notifications — anchored below the bell in the top nav */}
      <div className={cn(toastStackClass, "top-[4.25rem] right-4")}>
        <AnimatePresence>
          {topToasts.map((t) => (
            <ToastItemWrapper key={t.id} t={t} remove={remove} />
          ))}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
