"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCountdown, formatCountdownSpoken } from "@/lib/auth/countdown";

const RING_RADIUS = 56;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ~351.86px
const CRITICAL_THRESHOLD_SECONDS = 60;

/**
 * Enhanced Session Timeout Dialog for FleetOps.
 *
 * Implements the centered blocking modal over a dimmed dashboard backdrop.
 * Follows the Operations Center visual language:
 * - Clean white modal surface (dark-mode adapted)
 * - Subtle #E4E7EC border with soft elevation shadow
 * - Dark navy #0F172A primary action button
 * - Compact amber card in Warning state (4:55)
 * - Circular countdown ring in Critical state (final 60s)
 * - Clear recovery in Expired state
 * - Full accessibility: focus trap, ARIA dialog, polite duration announcements
 */
export function SessionTimeoutDialog({
  state = "hidden", // "hidden" | "warning" | "critical" | "extending" | "extension-error" | "expired"
  remainingSeconds = 0,
  idleExtensionMinutes = 5,
  absoluteSessionLimitHours = 12,
  errorCode = null,
  errorDetails = null,
  isAbsoluteWarning = false,
  onExtendSession,
  onSignOut,
  onSignInAgain,
  onClose,
}) {
  const isVisible = state !== "hidden";
  const isExpired = state === "expired";
  const isExtending = state === "extending";
  const hasExtensionError = state === "extension-error";

  // If state is not strictly expired or hidden, determine if we are in critical ring vs warning card
  const isCritical =
    !isExpired &&
    (state === "critical" ||
      remainingSeconds <= CRITICAL_THRESHOLD_SECONDS ||
      isAbsoluteWarning);

  const formattedCountdown = useMemo(
    () => formatCountdown(remainingSeconds),
    [remainingSeconds]
  );

  // Safe spoken countdown for polite ARIA announcement
  const spokenCountdown = useMemo(
    () => formatCountdownSpoken(remainingSeconds),
    [remainingSeconds]
  );

  // Accessible announcement throttled to meaningful thresholds (60s, 45s, 30s, 15s, 10s, 5s)
  const announcement = useMemo(() => {
    if (!isVisible || isExpired) return "";
    const sec = Math.max(0, Math.floor(remainingSeconds));
    if (sec === 60 || sec === 45 || sec === 30 || sec === 15 || sec === 10 || sec === 5) {
      return `Your session will expire in ${spokenCountdown}.`;
    }
    return "";
  }, [isVisible, isExpired, remainingSeconds, spokenCountdown]);

  // Circular progress ring dash offset calculation
  const strokeDashoffset = useMemo(() => {
    const fraction = Math.min(
      1,
      Math.max(0, remainingSeconds / CRITICAL_THRESHOLD_SECONDS)
    );
    return RING_CIRCUMFERENCE * (1 - fraction);
  }, [remainingSeconds]);

  // Ref for focus trap
  const dialogRef = useRef(null);
  const primaryActionRef = useRef(null);

  // Focus primary action on open
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        primaryActionRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isVisible, state]);

  // Focus trap inside the modal
  const handleKeyDown = useCallback(
    (e) => {
      if (!isVisible) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (onClose) {
          onClose();
        } else if (!isExpired && onExtendSession) {
          void onExtendSession();
        }
        return;
      }

      if (e.key === "Tab") {
        if (!dialogRef.current) return;
        const focusableElements = dialogRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements.length) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    },
    [isVisible, isExpired, onClose, onExtendSession]
  );

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else if (!isExpired && onExtendSession) {
      void onExtendSession();
    }
  };

  const handleExtend = async () => {
    if (onExtendSession) {
      await onExtendSession();
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-modal-title"
          aria-describedby="session-modal-desc"
          aria-label="Session timeout warning"
          onKeyDown={handleKeyDown}
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 sm:p-6 select-none"
        >
          {/* Screen reader live announcements */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {announcement}
          </div>

          {/* Dimmed Dashboard Overlay: rgba(15, 23, 42, 0.38) with blur(2px) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={!isExpired ? handleClose : undefined}
            className="fixed inset-0 bg-[#0F172A]/[0.38] backdrop-blur-[2px]"
          />

          {/* Centered Modal Container */}
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "relative w-full max-w-[480px] overflow-hidden rounded-[28px]",
              "bg-white dark:bg-[#0F172A] p-7 sm:p-8",
              "border border-[#E4E7EC] dark:border-slate-800",
              "shadow-[0_16px_40px_rgba(16,24,40,0.16)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)]"
            )}
          >
            {/* Top Right Close Button (when not expired) */}
            {!isExpired && (
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close session timeout dialog"
                className="absolute top-5 right-5 sm:top-6 sm:right-6 rounded-full p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-200 cursor-pointer"
              >
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
            )}

            <div className="flex flex-col items-center text-center space-y-5">
              {/* 1. Status Pill */}
              {isExpired ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F4C4C4] bg-[#FFF1F1] px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[#B42318] dark:bg-rose-950/40 dark:border-rose-900/50 dark:text-rose-300">
                  <Lock className="h-3.5 w-3.5" strokeWidth={2.2} />
                  SESSION EXPIRED
                </div>
              ) : isAbsoluteWarning ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F6D7AE] bg-[#FFF4E8] px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[#B86708] dark:bg-amber-950/40 dark:border-amber-900/50 dark:text-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2.2} />
                  12-HOUR MAXIMUM LIMIT
                </div>
              ) : isCritical ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F4C4C4] bg-[#FFF1F1] px-3.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[#D92D20] dark:bg-rose-950/40 dark:border-rose-900/50 dark:text-rose-300">
                  <Clock className="h-3.5 w-3.5" strokeWidth={2.2} />
                  SESSION EXPIRING SOON
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F6D7AE] bg-[#FFF4E8] px-3.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[#B86708] dark:bg-amber-950/40 dark:border-amber-900/50 dark:text-amber-300">
                  <Clock className="h-3.5 w-3.5" strokeWidth={2.2} />
                  SESSION INACTIVITY
                </div>
              )}

              {/* 2. Header & Description */}
              <div className="space-y-2">
                <h3
                  id="session-modal-title"
                  className="text-xl sm:text-2xl font-bold tracking-tight text-[#101828] dark:text-white"
                >
                  {isExpired
                    ? "Your session has expired"
                    : isAbsoluteWarning
                      ? "Session ending soon"
                      : isCritical
                        ? "Your session will expire soon"
                        : "Still working?"}
                </h3>
                <p
                  id="session-modal-desc"
                  className="text-sm leading-relaxed text-[#667085] dark:text-slate-400 max-w-sm mx-auto"
                >
                  {isExpired
                    ? errorCode === "SESSION_IDLE_TIMEOUT"
                      ? `For your security, you have been signed out due to ${idleExtensionMinutes} minutes of inactivity.`
                      : errorCode === "SESSION_EXPIRED"
                        ? `For your security, your ${absoluteSessionLimitHours}-hour session maximum limit has been reached.`
                        : errorCode === "SESSION_REVOKED"
                          ? "This session was signed out from another device or revoked."
                          : errorCode === "ACCOUNT_DISABLED"
                            ? "This account is currently inactive. Contact your administrator."
                            : "For your security, you have been signed out due to inactivity."
                    : isAbsoluteWarning
                      ? `For fleet security, active sessions cannot exceed ${absoluteSessionLimitHours} continuous hours.`
                      : isCritical
                        ? "For your security, your session will end automatically if no action is taken."
                        : "Your session has been idle for a while and will automatically expire soon."}
                </p>
              </div>

              {/* 3. Timer Display (Compact Card for Warning, Circular Ring for Critical) */}
              {!isExpired && (
                <div className="py-1">
                  {isCritical ? (
                    /* Circular Countdown Ring: 120px x 120px, 8px thickness */
                    <div className="relative w-[120px] h-[120px] mx-auto flex items-center justify-center">
                      <svg
                        className="w-[120px] h-[120px] -rotate-90 transform"
                        viewBox="0 0 120 120"
                        aria-hidden="true"
                      >
                        {/* Track: #F2F4F7 */}
                        <circle
                          cx="60"
                          cy="60"
                          r={RING_RADIUS}
                          className="stroke-[#F2F4F7] dark:stroke-slate-800"
                          strokeWidth="8"
                          fill="none"
                        />
                        {/* Critical Accent Progress Ring: #D92D20 */}
                        <circle
                          cx="60"
                          cy="60"
                          r={RING_RADIUS}
                          className="stroke-[#D92D20] transition-[stroke-dashoffset] duration-1000 ease-linear"
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={RING_CIRCUMFERENCE}
                          strokeDashoffset={strokeDashoffset}
                          fill="none"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="font-mono text-[32px] font-extrabold leading-none tracking-tight text-[#D92D20] tabular-nums">
                          {formattedCountdown}
                        </span>
                      </div>
                    </div>
                  ) : (
                    /* Compact Timer Card: 148px x 84px, rounded-2xl, #FFF9F1 bg, #F3E3C7 border */
                    <div className="flex h-[84px] w-[148px] items-center justify-center rounded-[20px] border border-[#F3E3C7] bg-[#FFF9F1] dark:bg-amber-950/25 dark:border-amber-900/40 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="font-mono text-[32px] font-extrabold leading-none tracking-wider text-[#D97706] dark:text-amber-400 tabular-nums">
                        {formattedCountdown}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 4. Inline Error Alert (Extension Failure) */}
              {hasExtensionError && (
                <div
                  role="alert"
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-[#FEF3F2] border border-[#F7D3D0] text-[#B42318] text-xs font-medium dark:bg-rose-950/40 dark:border-rose-900/60 dark:text-rose-300"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorDetails || "Couldn’t extend your session. Please try again."}</span>
                </div>
              )}

              {/* 5. Expired State Inline Alert */}
              {isExpired && (
                <div className="w-full rounded-2xl border border-[#E4E7EC] dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-4 text-center">
                  <p className="text-xs text-[#667085] dark:text-slate-400 leading-relaxed">
                    Any unsaved changes may be lost. Please sign in again to continue.
                  </p>
                </div>
              )}

              {/* 6. Supporting Text */}
              <p className="text-[13px] leading-[20px] text-[#98A2B3] dark:text-slate-400 max-w-sm">
                {isExpired
                  ? "Your current page location has been saved."
                  : isAbsoluteWarning
                    ? "This limit cannot be extended. You will be redirected to sign in again, and your route will be saved."
                    : isCritical
                      ? "You will be signed out automatically when the countdown ends."
                      : `Selecting “Stay signed in” extends your idle session by ${idleExtensionMinutes} minutes. Your ${absoluteSessionLimitHours}-hour maximum session limit remains unchanged.`}
              </p>

              {/* 7. Action Buttons */}
              <div className="w-full pt-2">
                {isExpired || isAbsoluteWarning ? (
                  /* Single Primary Recovery Button */
                  <button
                    type="button"
                    ref={primaryActionRef}
                    onClick={onSignInAgain || onSignOut}
                    disabled={isExtending}
                    className="group relative flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0F172A] dark:bg-white px-6 text-sm font-semibold text-white dark:text-[#0F172A] transition-all hover:bg-[#1E293B] dark:hover:bg-slate-100 active:scale-[0.98] disabled:opacity-60 cursor-pointer shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F172A] dark:focus-visible:ring-white"
                  >
                    <span>{isExpired ? "Go to sign in" : "Sign in again"}</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </button>
                ) : (
                  /* Dual Buttons: Responsive Row on desktop, Stack on mobile */
                  <div className="flex flex-col-reverse sm:flex-row items-center gap-3 w-full">
                    {/* Secondary: Sign out */}
                    <button
                      type="button"
                      onClick={onSignOut}
                      disabled={isExtending}
                      className="h-12 w-full sm:flex-1 rounded-full border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-800 px-5 text-sm font-semibold text-[#344054] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-400 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400"
                    >
                      <LogOut className="h-4 w-4 text-[#667085] dark:text-slate-400" />
                      <span>Sign out</span>
                    </button>

                    {/* Primary: Stay signed in */}
                    <button
                      type="button"
                      ref={primaryActionRef}
                      onClick={handleExtend}
                      disabled={isExtending}
                      className="h-12 w-full sm:flex-1 rounded-full bg-[#0F172A] dark:bg-white px-5 text-sm font-semibold text-white dark:text-[#0F172A] hover:bg-[#1E293B] dark:hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F172A] dark:focus-visible:ring-white"
                    >
                      {isExtending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Refreshing…</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 text-amber-400 dark:text-amber-500" />
                          <span>Stay signed in</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
