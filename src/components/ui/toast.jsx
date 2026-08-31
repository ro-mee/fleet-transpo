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

// Springy pop language borrowed from the AnimatedList pattern: items scale
// from zero with a stiff spring, and `layout` lets survivors reflow smoothly
// when one is dismissed.
const SPRING = { type: "spring", stiffness: 350, damping: 40 };

const themeConfig = {
  info: {
    gradient: "from-sky-500/[0.08] via-sky-500/[0.03] to-transparent dark:from-sky-500/[0.15] dark:via-sky-500/[0.04]",
    border: "border-sky-500/30 dark:border-sky-500/40",
    glow: "shadow-[0_12px_36px_-6px_rgba(14,165,233,0.2),0_4px_12px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_16px_40px_-8px_rgba(14,165,233,0.35)]",
    iconBg: "bg-sky-50 dark:bg-sky-950/80 border border-sky-500/30 dark:border-sky-500/40 text-sky-600 dark:text-sky-400",
    defaultTitle: "Information",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
  success: {
    gradient: "from-emerald-500/[0.08] via-emerald-500/[0.03] to-transparent dark:from-emerald-500/[0.15] dark:via-emerald-500/[0.04]",
    border: "border-emerald-500/30 dark:border-emerald-500/40",
    glow: "shadow-[0_12px_36px_-6px_rgba(16,185,129,0.2),0_4px_12px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_16px_40px_-8px_rgba(16,185,129,0.35)]",
    iconBg: "bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-500/30 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
    defaultTitle: "Success",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  warning: {
    gradient: "from-amber-500/[0.08] via-amber-500/[0.03] to-transparent dark:from-amber-500/[0.15] dark:via-amber-500/[0.04]",
    border: "border-amber-500/30 dark:border-amber-500/40",
    glow: "shadow-[0_12px_36px_-6px_rgba(245,158,11,0.2),0_4px_12px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_16px_40px_-8px_rgba(245,158,11,0.35)]",
    iconBg: "bg-amber-50 dark:bg-amber-950/80 border border-amber-500/30 dark:border-amber-500/40 text-amber-600 dark:text-amber-400",
    defaultTitle: "Warning",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  error: {
    gradient: "from-rose-500/[0.08] via-rose-500/[0.03] to-transparent dark:from-rose-500/[0.15] dark:via-rose-500/[0.04]",
    border: "border-rose-500/30 dark:border-rose-500/40",
    glow: "shadow-[0_12px_36px_-6px_rgba(244,63,94,0.2),0_4px_12px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_16px_40px_-8px_rgba(244,63,94,0.35)]",
    iconBg: "bg-rose-50 dark:bg-rose-950/80 border border-rose-500/30 dark:border-rose-500/40 text-rose-600 dark:text-rose-400",
    defaultTitle: "Error",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
};

function ToastItem({ t, onClose }) {
  const type = t.type in themeConfig ? t.type : "info";
  const config = themeConfig[type];
  const isBellToast = t.position === "top-right";

  useEffect(() => {
    const timer = setTimeout(onClose, t.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [onClose, t.duration]);

  return (
    <motion.div
      layout
      initial={{ scale: 0, opacity: 0 }}
      animate={
        isBellToast
          ? { scale: 1, opacity: 1, originX: 1, originY: 0 }
          : { scale: 1, opacity: 1, originY: 0 }
      }
      exit={{ scale: 0, opacity: 0 }}
      transition={SPRING}
      className={cn(
        "pointer-events-auto relative flex items-start gap-3.5 rounded-[20px] p-4 border transition-all",
        // Solid background base guarantees 100% opacity & zero bleed-through on black/dark surfaces
        "bg-surface backdrop-blur-2xl",
        "bg-gradient-to-r",
        config.gradient,
        config.border,
        config.glow
      )}
    >
      {/* Top Specular Reflection Gleam */}
      <div className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/20 to-transparent pointer-events-none" />

      {/* Modern Soft Square / Pill Icon Container */}
      <div className={cn("flex-shrink-0 w-11 h-11 rounded-[14px] flex items-center justify-center shadow-xs", config.iconBg)}>
        {config.icon}
      </div>

      {/* Text Copy */}
      <div className="min-w-0 flex-1 pt-0.5">
        <h4 className="text-[14px] font-bold text-foreground tracking-tight leading-tight">
          {t.title || config.defaultTitle}
        </h4>
        {t.message && (
          <p className="mt-1 text-[13px] font-medium leading-relaxed text-foreground-secondary">
            {t.message}
          </p>
        )}
      </div>

      {/* Close Button */}
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        className="flex-shrink-0 -mr-1 -mt-1 w-7 h-7 rounded-full flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-hover transition-colors cursor-pointer"
      >
        <X className="h-4 w-4 stroke-[2]" />
      </button>
    </motion.div>
  );
}

function ToastItemWrapper({ t, remove }) {
  const handleClose = useCallback(() => remove(t.id), [t.id, remove]);
  return <ToastItem t={t} onClose={handleClose} />;
}

const toastStackClass =
  "fixed z-[100] flex flex-col gap-3 w-[380px] max-w-[calc(100vw-2rem)] pointer-events-none";

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
