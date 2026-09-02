"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  ShieldAlert,
  LogOut,
  Sparkles,
  ArrowRight,
  AlertCircle,
  Loader2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EASE = [0.32, 0.72, 0, 1];

export function SessionExpiryModal({
  isOpen,
  state, // "idle_warning" | "absolute_warning" | "expired"
  countdownSeconds = 0,
  errorCode = null,
  onStaySignedIn,
  onSignOut,
  onSignInAgain,
  loading = false,
}) {
  const formattedCountdown = useMemo(() => {
    const totalSec = Math.max(0, Math.floor(countdownSeconds));
    const m = Math.floor(totalSec / 60);
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [countdownSeconds]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-modal-title"
        className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 select-none"
      >
        {/* Cinematic Backdrop with Depth Blur */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="fixed inset-0 bg-black/60 backdrop-blur-md"
        />

        {/* Double-Bezel Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 16, filter: "blur(6px)" }}
          animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.94, y: 16, filter: "blur(6px)" }}
          transition={{ duration: 0.45, ease: EASE }}
          className="relative w-full max-w-lg overflow-hidden rounded-[2rem] bg-background p-1.5 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.5)] ring-1 ring-black/[0.08] dark:ring-white/[0.12]"
        >
          {/* Inner Machined Core Container */}
          <div className="relative overflow-hidden rounded-[calc(2rem-0.375rem)] bg-surface px-6 py-8 sm:p-9 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            {/* Top Specular Gleam Highlight */}
            <div className="pointer-events-none absolute left-8 right-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/20 to-transparent" />

            {/* Ambient Corner Glow */}
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute -right-20 -top-20 h-44 w-44 rounded-full blur-3xl opacity-20",
                state === "idle_warning"
                  ? "bg-amber-500"
                  : state === "absolute_warning"
                    ? "bg-orange-500"
                    : "bg-rose-500"
              )}
            />

            {/* STATE A: IDLE WARNING */}
            {state === "idle_warning" && (
              <div className="space-y-6 text-center">
                {/* Eyebrow badge */}
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
                  <Clock className="h-3 w-3" strokeWidth={2.2} />
                  Inactivity Warning
                </div>

                {/* Header Copy */}
                <div className="space-y-2">
                  <h3
                    id="session-modal-title"
                    className="text-2xl font-bold tracking-tight text-foreground sm:text-[1.75rem]"
                  >
                    Are you still there?
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground-secondary">
                    Your session has been idle and will automatically expire in:
                  </p>
                </div>

                {/* Hero Animated Countdown Badge */}
                <div className="mx-auto flex h-20 w-44 items-center justify-center rounded-[1.25rem] border border-amber-500/20 bg-amber-500/[0.06] shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]">
                  <span className="font-mono text-3xl font-extrabold tracking-wider text-amber-600 dark:text-amber-400 tabular-nums">
                    {formattedCountdown}
                  </span>
                </div>

                <p className="text-xs text-foreground-muted">
                  Clicking &ldquo;Stay signed in&rdquo; resets your idle timer by 1 hour. The 12-hour absolute maximum remains unchanged.
                </p>

                {/* Actions */}
                <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onSignOut}
                    disabled={loading}
                    className="h-12 flex-1 rounded-full text-xs font-semibold hover:bg-danger-bg hover:text-danger hover:border-danger/30 transition-colors"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </Button>

                  <button
                    type="button"
                    onClick={onStaySignedIn}
                    disabled={loading}
                    className="group relative flex h-12 flex-1 items-center justify-center overflow-hidden rounded-full bg-foreground px-6 text-xs font-semibold text-surface transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Refreshing…
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 text-amber-400" />
                          Stay signed in
                        </>
                      )}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* STATE B: ABSOLUTE 12-HOUR WARNING */}
            {state === "absolute_warning" && (
              <div className="space-y-6 text-center">
                {/* Eyebrow badge */}
                <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-600 dark:text-orange-400">
                  <ShieldAlert className="h-3 w-3" strokeWidth={2.2} />
                  12-Hour Maximum Limit
                </div>

                {/* Header Copy */}
                <div className="space-y-2">
                  <h3
                    id="session-modal-title"
                    className="text-2xl font-bold tracking-tight text-foreground sm:text-[1.75rem]"
                  >
                    Session ending soon
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground-secondary">
                    For fleet security, active sessions cannot exceed 12 continuous hours. Your session will close in:
                  </p>
                </div>

                {/* Countdown display */}
                <div className="mx-auto flex h-20 w-44 items-center justify-center rounded-[1.25rem] border border-orange-500/20 bg-orange-500/[0.06] shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]">
                  <span className="font-mono text-3xl font-extrabold tracking-wider text-orange-600 dark:text-orange-400 tabular-nums">
                    {formattedCountdown}
                  </span>
                </div>

                <div className="rounded-xl border border-border/80 bg-background/50 p-3.5 text-left text-xs leading-relaxed text-foreground-secondary">
                  <p className="font-medium text-foreground">Important Policy Note:</p>
                  <p className="mt-1 text-foreground-muted">
                    This limit cannot be extended from within this session. You will be redirected to sign in again, and your current page will be remembered.
                  </p>
                </div>

                {/* Actions */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onSignInAgain}
                    disabled={loading}
                    className="group relative flex h-13 w-full items-center justify-center overflow-hidden rounded-full bg-foreground px-6 text-sm font-semibold text-surface transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      Sign in again
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface/20 transition-transform group-hover:translate-x-0.5">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* STATE C: EXPIRED */}
            {state === "expired" && (
              <div className="space-y-6 text-center">
                {/* Eyebrow badge */}
                <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">
                  <Lock className="h-3 w-3" strokeWidth={2.2} />
                  Authentication Required
                </div>

                {/* Icon hero */}
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400 shadow-sm">
                  <AlertCircle className="h-7 w-7" strokeWidth={2} />
                </div>

                {/* Header Copy */}
                <div className="space-y-2">
                  <h3
                    id="session-modal-title"
                    className="text-2xl font-bold tracking-tight text-foreground sm:text-[1.75rem]"
                  >
                    Session expired
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground-secondary">
                    {errorCode === "SESSION_IDLE_TIMEOUT"
                      ? "Your session expired due to 1 hour of inactivity."
                      : errorCode === "SESSION_EXPIRED"
                        ? "Your 12-hour session maximum has been reached."
                        : errorCode === "SESSION_REVOKED"
                          ? "This session was signed out from another device or revoked."
                          : errorCode === "ACCOUNT_DISABLED"
                            ? "This account is currently inactive. Contact your administrator."
                            : "Please sign in again to continue using FleetOps."}
                  </p>
                </div>

                <div className="rounded-xl border border-border/80 bg-background/50 p-3.5 text-xs text-foreground-muted text-center">
                  Your current page location is preserved and you will return to it immediately upon authenticating.
                </div>

                {/* Actions */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onSignInAgain}
                    disabled={loading}
                    className="group relative flex h-13 w-full items-center justify-center overflow-hidden rounded-full bg-foreground px-6 text-sm font-semibold text-surface transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      Sign in
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface/20 transition-transform group-hover:translate-x-0.5">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
