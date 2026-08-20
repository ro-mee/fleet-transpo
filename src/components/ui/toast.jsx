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

const themeConfig = {
  info: {
    gradient: "from-sky-500/15 via-sky-500/5 to-white/90 dark:to-zinc-900/95",
    border: "border-sky-500/30",
    glow: "shadow-[0_8px_30px_rgb(14,165,233,0.12)]",
    iconBg: "bg-sky-500/15 border border-sky-500/30 text-sky-600 dark:text-sky-400",
    defaultTitle: "Information",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
  success: {
    gradient: "from-emerald-500/15 via-emerald-500/5 to-white/90 dark:to-zinc-900/95",
    border: "border-emerald-500/30",
    glow: "shadow-[0_8px_30px_rgb(16,185,129,0.12)]",
    iconBg: "bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
    defaultTitle: "Success",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  warning: {
    gradient: "from-amber-500/15 via-amber-500/5 to-white/90 dark:to-zinc-900/95",
    border: "border-amber-500/30",
    glow: "shadow-[0_8px_30px_rgb(245,158,11,0.12)]",
    iconBg: "bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400",
    defaultTitle: "Warning",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  error: {
    gradient: "from-rose-500/15 via-rose-500/5 to-white/90 dark:to-zinc-900/95",
    border: "border-rose-500/30",
    glow: "shadow-[0_8px_30px_rgb(244,63,94,0.12)]",
    iconBg: "bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400",
    defaultTitle: "Error",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      initial={isBellToast ? { opacity: 0, y: -16, x: 18, scale: 0.88 } : { opacity: 0, x: 40, scale: 0.95 }}
      animate={isBellToast ? { opacity: 1, y: 0, x: 0, scale: 1 } : { opacity: 1, x: 0, scale: 1 }}
      exit={isBellToast ? { opacity: 0, y: -12, x: 14, scale: 0.88 } : { opacity: 0, x: 30, scale: 0.95 }}
      transition={{ duration: 0.35, ease: EASE }}
      style={isBellToast ? { transformOrigin: "top right" } : undefined}
      className={cn(
        "pointer-events-auto relative flex items-start gap-3.5 rounded-[22px] p-4 backdrop-blur-xl border transition-all",
        "bg-gradient-to-r",
        config.gradient,
        config.border,
        config.glow
      )}
    >
      {/* Top Specular Reflection Gleam */}
      <div className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/60 dark:via-white/20 to-transparent pointer-events-none" />

      {/* Modern Soft Square / Pill Icon Container */}
      <div className={cn("flex-shrink-0 w-11 h-11 rounded-[14px] flex items-center justify-center shadow-xs", config.iconBg)}>
        {config.icon}
      </div>

      {/* Text Copy */}
      <div className="min-w-0 flex-1 pt-0.5">
        <h4 className="text-[14px] font-extrabold text-foreground tracking-tight leading-tight">
          {t.title || config.defaultTitle}
        </h4>
        {t.message && (
          <p className="mt-1 text-[13px] font-normal leading-relaxed text-foreground-secondary/90">
            {t.message}
          </p>
        )}
      </div>

      {/* Close Button */}
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        className="flex-shrink-0 -mr-1 -mt-1 w-7 h-7 rounded-full flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
      >
        <X className="h-4 w-4 stroke-[1.75]" />
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
