"use client";

import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
} from "framer-motion";
import { rememberTrustedDevice, revokeTrustedDevice, signIn } from "@/services/auth.service";
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  describeOtpTtl,
  maskEmailAddress,
} from "@/lib/auth/otp-policy";
import { getSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  ArrowRight,
  CarFront,
  Check,
  Eye,
  EyeOff,
  Gauge,
  Info,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { CapsLockHint, useCapsLock } from "@/components/ui/caps-lock-hint";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { cn } from "@/lib/utils";
import { getAndClearReturnTo } from "@/lib/auth/return-to";

const loginSchema = {
  email: { required: true, type: "email", label: "Email" },
  password: { required: true, label: "Password" },
};

const EASE = [0.32, 0.72, 0, 1];
const MFA_SCAN_MIN_MS = 500;

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.75, ease: EASE },
  },
};

function BrandMark({ className }) {
  return (
    <div
      className={cn(
        "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.1rem] bg-primary text-primary-bg",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_24px_-12px_rgba(0,0,0,0.4)]",
        className
      )}
    >
      <CarFront className="h-[22px] w-[22px]" strokeWidth={1.75} />
    </div>
  );
}

function RouteGraphic() {
  const routePathRef = useRef(null);

  return (
    <svg
      viewBox="0 0 480 260"
      fill="none"
      aria-hidden="true"
      className="mt-9 w-full max-w-[26rem]"
    >
      <defs>
        <linearGradient id="route-primary" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="route-sub" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.08" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0.3" />
        </linearGradient>
      </defs>

      <motion.path
        d="M 24 140 C 96 150, 150 214, 228 208 C 316 201, 350 70, 452 44"
        stroke="url(#route-sub)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 8"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.6, delay: 0.9, ease: EASE }}
      />

      <motion.path
        ref={routePathRef}
        d="M 14 196 C 84 204, 96 96, 186 96 C 276 96, 264 198, 356 196 C 408 195, 446 152, 460 88"
        stroke="url(#route-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.9, delay: 0.55, ease: EASE }}
      />

      <motion.circle
        cx="14"
        cy="196"
        r="5"
        fill="var(--primary)"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 1.9, ease: EASE }}
      />
      <motion.circle
        cx="14"
        cy="196"
        r="5"
        fill="none"
        stroke="var(--primary)"
        strokeOpacity="0.35"
        animate={{ scale: [1, 2.6], opacity: [0.6, 0] }}
        transition={{ duration: 2.6, delay: 2, repeat: Infinity, ease: "easeOut" }}
      />

      <motion.circle
        cx="186"
        cy="96"
        r="4.5"
        fill="var(--sf)"
        stroke="var(--primary)"
        strokeWidth="2"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 2.15, ease: EASE }}
      />
      <motion.circle
        cx="356"
        cy="196"
        r="4.5"
        fill="var(--sf)"
        stroke="var(--primary)"
        strokeWidth="2"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 2.3, ease: EASE }}
      />

      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 2.45, ease: EASE }}
      >
        <circle
          cx="460"
          cy="88"
          r="10"
          fill="none"
          stroke="var(--primary)"
          strokeOpacity="0.25"
          strokeWidth="1.5"
        />
        <circle cx="460" cy="88" r="5" fill="var(--primary)" />
      </motion.g>

      <RouteCar pathRef={routePathRef} />
    </svg>
  );
}

const CAR_APPEAR_MS = 2500;
const CAR_LOOP_MS = 7000;

function RouteCar({ pathRef }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(14);
  const y = useMotionValue(196);
  const startedAt = useRef(null);

  useAnimationFrame((now) => {
    const path = pathRef.current;
    if (reduce || !path) return;
    if (startedAt.current === null) startedAt.current = now;
    // Hold at the origin until the route finishes drawing, then loop forever.
    const raw = (now - startedAt.current - CAR_APPEAR_MS) / CAR_LOOP_MS;
    const t = raw <= 0 ? 0 : raw % 1;
    const point = path.getPointAtLength(t * path.getTotalLength());
    x.set(point.x);
    y.set(point.y);
  });

  if (reduce) return null;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, delay: CAR_APPEAR_MS / 1000, ease: EASE }}
      style={{ x, y }}
    >
      <circle r="12" fill="var(--sf)" stroke="var(--primary)" strokeWidth="2" />
      <CarFront width={14} height={14} x={-7} y={-7} color="var(--primary)" strokeWidth={2} />
    </motion.g>
  );
}

const FEATURES = [
  { icon: Navigation, label: "Dispatch orchestration" },
  { icon: Gauge, label: "Fleet readiness" },
  { icon: MapPin, label: "Trip visibility" },
];

function MfaCodeCells({ value, onChange, onComplete, inputRef, status, disabled }) {
  const hasError = status === "error";
  const isSuccess = status === "success";
  const activeIndex = Math.min(value.length, 5);

  return (
    <motion.div
      animate={hasError ? { x: [0, -4, 4, -3, 3, 0] } : { x: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
      className="relative mx-auto grid w-full max-w-[25.5rem] grid-cols-6 gap-2.5"
    >
      <input
        ref={inputRef}
        id="mfaCode"
        value={value}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "").slice(0, 6);
          onChange(next);
          if (next.length === 6) onComplete(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.length !== 6) event.preventDefault();
        }}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        disabled={disabled}
        aria-label="Six-digit verification code"
        aria-invalid={hasError}
        aria-describedby="mfa-code-status"
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0 disabled:cursor-default"
      />

      {Array.from({ length: 6 }, (_, index) => {
        const digit = value[index] || "";
        const isActive = !isSuccess && index === activeIndex;

        return (
          <motion.span
            key={`${index}-${digit || "empty"}`}
            initial={digit ? { opacity: 0, scale: 0.82 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, ease: EASE }}
            className={cn(
              "relative flex h-[3.5rem] min-w-0 items-center justify-center rounded-[0.75rem] border-[1.5px] bg-white text-lg font-semibold tabular-nums text-[#17213a] shadow-[0_3px_9px_-7px_rgba(15,23,42,0.55)] transition-[background-color,border-color,box-shadow,color] duration-200 dark:bg-slate-950 dark:text-slate-100",
              "border-[#d7deea] dark:border-slate-700",
              digit && "border-[#b8c9eb] bg-[#f8faff] dark:bg-slate-900",
              isActive &&
                "border-[#3475e8] bg-white shadow-[0_0_0_2px_rgba(52,117,232,0.12),0_8px_20px_-14px_rgba(52,117,232,0.9)] dark:bg-slate-950",
              hasError && "border-danger/70 bg-danger-bg/60 text-danger",
              isSuccess && "border-success/60 bg-success-bg text-success-700"
            )}
          >
            {digit}
            {isActive && !digit && !hasError && !isSuccess && (
              <motion.span
                aria-hidden="true"
                className="absolute h-6 w-0.5 rounded-full bg-[#235ec7]"
                animate={{ opacity: [1, 0.25, 1] }}
                transition={{ duration: 1.05, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </motion.span>
        );
      })}
    </motion.div>
  );
}

const SUCCESS_PARTICLES = [
  { x: -34, y: -22 },
  { x: 35, y: -28 },
  { x: -46, y: 12 },
  { x: 45, y: 10 },
  { x: -22, y: 37 },
  { x: 27, y: 39 },
];

function MfaVerificationVisual({ status }) {
  const isSuccess = status === "success";

  return (
    <motion.div
      key={isSuccess ? "success" : "verifying"}
      initial={{ opacity: 0, scale: 0.78 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.88 }}
      transition={{ duration: 0.36, ease: EASE }}
      aria-hidden="true"
      className="relative mx-auto h-[6.5rem] w-[6.5rem]"
    >
      <motion.span
        className={cn(
          "absolute inset-0 rounded-full border",
          isSuccess ? "border-[#9beedc]/70" : "border-[#8de9d5]/55"
        )}
        animate={
          isSuccess
            ? { scale: [0.88, 1.08, 1], opacity: [0, 0.9, 0.65] }
            : { scale: [0.9, 1.04, 0.9], opacity: [0.3, 0.82, 0.3] }
        }
        transition={
          isSuccess
            ? { duration: 0.7, ease: EASE }
            : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
        }
      />
      <motion.span
        className={cn(
          "absolute inset-[0.65rem] rounded-full border",
          isSuccess ? "border-[#c5f7ec]" : "border-[#c4f4ea]"
        )}
        animate={isSuccess ? { scale: [0.86, 1, 1.04], opacity: [0, 1, 0.85] } : { opacity: [0.45, 0.95, 0.45] }}
        transition={
          isSuccess
            ? { duration: 0.52, delay: 0.04, ease: EASE }
            : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
        }
      />

      {isSuccess &&
        SUCCESS_PARTICLES.map((particle, index) => (
          <motion.span
            key={`${particle.x}-${particle.y}`}
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-[#22cda2]"
            initial={{ opacity: 0, scale: 0.3, x: 0, y: 0 }}
            animate={{ opacity: [0, 1, 0], scale: [0.3, 1, 0.7], x: particle.x, y: particle.y }}
            transition={{ duration: 0.6, delay: 0.06 + index * 0.035, ease: EASE }}
          />
        ))}

      <motion.div
        className={cn(
          "absolute left-1/2 top-1/2 flex h-[4.35rem] w-[4.35rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-[0_16px_26px_-18px_rgba(17,37,69,0.4)]",
          isSuccess ? "bg-[#17c998] text-white" : "border border-[#b9efe4] bg-[#f2fffc] text-[#17213a]"
        )}
        animate={isSuccess ? { scale: [0.82, 1.08, 1] } : { y: [-1, 1, -1] }}
        transition={isSuccess ? { duration: 0.48, ease: EASE } : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        {isSuccess ? (
          <motion.svg viewBox="0 0 52 52" className="h-10 w-10" fill="none">
            <motion.path
              d="M14 27.5 22.5 36 39 17.5"
              stroke="currentColor"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.42, delay: 0.1, ease: EASE }}
            />
          </motion.svg>
        ) : (
          <Lock className="h-8 w-8" strokeWidth={1.8} />
        )}
      </motion.div>

      {!isSuccess && (
        <motion.span
          className="absolute left-[0.75rem] right-[0.75rem] z-10 h-[2px] rounded-full bg-[#42d9b8] shadow-[0_0_10px_2px_rgba(66,217,184,0.58)]"
          animate={{ top: ["1.25rem", "5.15rem", "1.25rem"], opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.55, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </motion.div>
  );
}

function MfaVerificationDialog({
  open,
  code,
  onCodeChange,
  onVerify,
  onClose,
  onToggleRecovery,
  onResend,
  resendSeconds,
  resendNotice,
  email,
  recoveryMode,
  status,
  error,
  loading,
  rememberDevice,
  onRememberDeviceChange,
  codeInputRef,
  recoveryInputRef,
}) {
  useEffect(() => {
    if (!open || !recoveryMode) return undefined;
    const timer = setTimeout(() => recoveryInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open, recoveryMode, recoveryInputRef]);

  const isSuccess = status === "success";
  const isVerifying = status === "verifying";
  const showProgress = isVerifying || isSuccess;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) onClose();
      }}
    >
      <DialogContent
        overlayClassName="bg-[#d7e0ef]/[0.7] backdrop-blur-[8px] dark:bg-slate-950/[0.72]"
        className="w-[calc(100%-2rem)] min-w-0 max-w-[32rem] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[1.4rem] border-[#d7dfed] bg-[#f9fbff] p-0 shadow-[0_24px_58px_-24px_rgba(19,32,60,0.42)] backdrop-blur-none dark:border-slate-700 dark:bg-slate-950 dark:shadow-[0_24px_58px_-24px_rgba(0,0,0,0.72)]"
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (loading) event.preventDefault();
        }}
      >
        <div className="relative px-7 pb-8 pt-7 sm:px-10 sm:pb-9 sm:pt-8">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close verification dialog"
            className="absolute right-5 top-5 rounded-full p-1.5 text-[#536078] transition-colors duration-200 hover:bg-[#edf1f8] hover:text-[#17213a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3475e8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f9fbff] disabled:pointer-events-none disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" strokeWidth={1.65} />
          </button>

          <DialogHeader className="p-0 text-center">
            <AnimatePresence initial={false} mode="wait">
              {showProgress ? (
                <MfaVerificationVisual key={isSuccess ? "success" : "verifying"} status={status} />
              ) : (
                <motion.div
                  key="ready"
                  initial={{ opacity: 0, scale: 0.92, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: EASE }}
                  className="relative mx-auto h-[6rem] w-[6rem]"
                >
              <svg viewBox="0 0 120 110" aria-hidden="true" className="absolute inset-0 h-full w-full">
                <path
                  d="M60 4c9 0 16 5 21 12 10-2 20 3 24 12 9 4 13 13 10 23 6 8 5 19-3 26-1 10-10 17-20 17-7 8-18 9-27 4-10 5-21 2-27-7-10-1-17-9-17-19-8-6-10-17-4-26-4-10 2-20 11-24 2-10 11-16 21-15 5-2 7-3 11-3Z"
                  fill="#dce7ff"
                />
              </svg>
              <motion.div
                key={isSuccess ? "success" : "lock"}
                initial={{ opacity: 0, scale: 0.72 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="absolute left-1/2 top-[0.95rem] flex h-[4.1rem] w-[4.1rem] -translate-x-1/2 items-center justify-center rounded-[1.2rem] bg-[#101a31] text-white shadow-[0_12px_22px_-14px_rgba(15,23,42,0.75)]"
              >
                {isSuccess ? <Check className="h-8 w-8" strokeWidth={1.8} /> : <Lock className="h-8 w-8" strokeWidth={1.8} />}
              </motion.div>
              <span className="absolute bottom-[0.62rem] right-[0.68rem] flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#f9fbff] bg-[#3f73e7] text-white shadow-[0_5px_12px_-8px_rgba(63,115,231,0.95)] dark:border-slate-950">
                <Check className="h-4 w-4" strokeWidth={2.25} />
              </span>
                </motion.div>
              )}
            </AnimatePresence>

            <DialogTitle className="mt-2.5 text-[1.45rem] font-bold tracking-[-0.025em] text-[#17213a] dark:text-slate-100">
              {isVerifying ? "Verifying your code" : isSuccess ? "You're all set!" : "Email Verification"}
            </DialogTitle>
            <DialogDescription className="mx-auto mt-1.5 max-w-[24rem] text-sm leading-[1.45] text-[#536078] dark:text-slate-400">
              {isVerifying ? (
                "Please wait while we confirm your identity."
              ) : isSuccess ? (
                "Your identity has been verified successfully."
              ) : recoveryMode ? (
                "Enter one unused recovery code to continue to FleetOps."
              ) : (
                <>
                  Enter the 6-digit code we emailed to
                  <br />
                  <span className="font-semibold text-[#17213a] dark:text-slate-200">
                    {maskEmailAddress(email)}
                  </span>{" "}
                  to continue to FleetOps.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {!showProgress && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onVerify();
              }}
              className="mx-auto mt-6 max-w-[25.5rem]"
            >
            {recoveryMode ? (
              <Input
                ref={recoveryInputRef}
                id="mfaRecoveryCode"
                type="text"
                value={code}
                onChange={(event) => {
                  const nextCode = event.target.value;
                  onCodeChange(nextCode);
                  if (nextCode.replace(/[\s-]/g, "").length === 20) onVerify(nextCode);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onVerify();
                  }
                }}
                placeholder="Enter your recovery code"
                autoComplete="one-time-code"
                disabled={loading}
                className="h-[3.5rem] rounded-[0.75rem] border-[1.5px] border-[#d7deea] bg-white text-[15px] tracking-[0.12em] shadow-[0_3px_9px_-7px_rgba(15,23,42,0.55)] caret-[#235ec7] focus-visible:border-[#3475e8] focus-visible:ring-2 focus-visible:ring-[#3475e8]/15 focus-visible:ring-offset-0 dark:border-slate-700 dark:bg-slate-900"
              />
            ) : (
              <MfaCodeCells
                value={code}
                onChange={onCodeChange}
                onComplete={onVerify}
                inputRef={codeInputRef}
                status={status}
                disabled={loading}
              />
            )}

            <div className="mt-4 flex items-start gap-2.5 text-[#536078] dark:text-slate-400">
              {recoveryMode ? (
                <Smartphone className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.6} />
              ) : (
                <Mail className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.6} />
              )}
              <p className="text-sm leading-[1.45]">
                {recoveryMode
                  ? "Each recovery code works once. Use one you saved when you set up your account."
                  : `The code expires in ${describeOtpTtl(OTP_TTL_SECONDS)}. If it has not arrived, check your spam folder.`}
              </p>
            </div>

            <div
              id="mfa-code-status"
              role={error ? "alert" : "status"}
              aria-live="polite"
              className={cn(
                "mt-3 text-center text-[13px] leading-relaxed",
                !error && !isSuccess && "sr-only",
                error ? "text-danger" : "text-success-700"
              )}
            >
              {error || (isSuccess ? "Verification complete." : "")}
            </div>

            {!recoveryMode && (
              <div className="mt-2 text-center">
                <button
                  type="button"
                  onClick={onResend}
                  disabled={loading || isSuccess || resendSeconds > 0}
                  className="text-[13px] font-semibold text-[#3475e8] underline-offset-2 transition-colors duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3475e8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f9fbff] disabled:cursor-default disabled:text-[#7b8599] disabled:no-underline dark:text-[#6f9bf0] dark:focus-visible:ring-offset-slate-950 dark:disabled:text-slate-500"
                >
                  {resendSeconds > 0 ? `Email a new code in ${resendSeconds}s` : "Email me a new code"}
                </button>
                {resendNotice && (
                  <p className="mt-1 text-[12px] leading-relaxed text-[#536078] dark:text-slate-400">
                    {resendNotice}
                  </p>
                )}
              </div>
            )}

            <label
              htmlFor="rememberDevice"
              className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-sm text-[#536078] select-none dark:text-slate-400"
            >
              <input
                id="rememberDevice"
                type="checkbox"
                checked={rememberDevice}
                onChange={(event) => onRememberDeviceChange(event.target.checked)}
                disabled={loading || isSuccess}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-[1.05rem] w-[1.05rem] items-center justify-center rounded-[0.25rem] border transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-[#3475e8]/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#f9fbff]",
                  rememberDevice
                    ? "border-[#3e73e7] bg-[#3e73e7] text-white shadow-[0_3px_8px_-6px_rgba(62,115,231,0.85)]"
                    : "border-[#b8c3d6] bg-white text-transparent dark:border-slate-600 dark:bg-slate-900"
                )}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
              <span>Remember this device for 7 days</span>
              <Info
                className="h-4 w-4 text-[#536078] dark:text-slate-400"
                strokeWidth={1.7}
                aria-hidden="true"
                title="This browser can skip the emailed code for 7 days"
              />
            </label>

            <div className="mt-6 flex items-center gap-3 text-[13px] text-[#7b8599] dark:text-slate-500">
              <span className="h-px flex-1 bg-[#d7deea] dark:bg-slate-800" />
              <span className="shrink-0">Having trouble?</span>
              <span className="h-px flex-1 bg-[#d7deea] dark:bg-slate-800" />
            </div>

            <button
              type="button"
              onClick={onToggleRecovery}
              disabled={loading}
              className="mx-auto mt-3 flex h-[3rem] w-full max-w-[19rem] items-center justify-center gap-2.5 rounded-[0.9rem] border border-[#d1d9e8] bg-transparent px-5 text-sm font-semibold text-[#17213a] transition-colors duration-200 hover:bg-[#eef3fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3475e8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f9fbff] disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-900 dark:focus-visible:ring-offset-slate-950"
            >
              <RefreshCw className="h-[1.15rem] w-[1.15rem] text-[#536078] dark:text-slate-400" strokeWidth={1.8} />
              {recoveryMode ? "Use an emailed code instead" : "Use a recovery code instead"}
            </button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaRecoveryMode, setMfaRecoveryMode] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [mfaStatus, setMfaStatus] = useState("idle");
  // The server refuses to send a second code within OTP_RESEND_COOLDOWN_SECONDS
  // of the first, so the button counts that window down rather than offering a
  // resend that would silently do nothing. Imported from the shared policy
  // module so the two cannot drift apart.
  const [resendSeconds, setResendSeconds] = useState(0);
  const [resendNotice, setResendNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const mfaCodeInputRef = useRef(null);
  const mfaRecoveryInputRef = useRef(null);
  // Live lockout countdown (seconds). Set from /api/auth/login-status after a
  // failed attempt; ticks 50, 49, 48… to 0 so the user sees exactly when retry
  // is allowed again. Submit is blocked while it runs.
  const [lockSeconds, setLockSeconds] = useState(0);
  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = setTimeout(() => {
      setLockSeconds((s) => {
        if (s <= 1) {
          setError("The temporary lock has lifted — you can try signing in again.");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [lockSeconds]);
  // Browser-only query param read without a hydration mismatch: the server
  // snapshot is false (matching SSR HTML, so no banner), and the client
  // snapshot reads the live URL. A lazy useState initializer would render
  // the banner on the client but not the server -> hydration mismatch.
  const sessionExpiredNotice = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("reason") === "expired",
    () => false
  );
  const { active: capsActive, bind: capsBind } = useCapsLock();
  const { validate, fieldError, registerField } = useFormValidation(loginSchema);

  useEffect(() => {
    if (!mfaRequired || mfaRecoveryMode) return undefined;
    const timer = setTimeout(() => mfaCodeInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [mfaRequired, mfaRecoveryMode]);

  const redirectAfterSignIn = async (session) => {
    const activeSession = session || (await getSession());
    // Forced first-login password change outranks any saved return-to target:
    // the server gate rejects every other API call until it is done.
    if (activeSession?.user?.mustChangePassword) {
      router.replace("/set-password");
      return;
    }
    const targetUrl = getAndClearReturnTo(activeSession?.user?.role);
    router.push(targetUrl);
    router.refresh();
  };

  const closeMfaDialog = () => {
    if (loading) return;
    setMfaRequired(false);
    setMfaCode("");
    setMfaRecoveryMode(false);
    setRememberDevice(false);
    setMfaStatus("idle");
    setError("");
  };

  // Countdown for the resend affordance. Kept beside the lockout countdown above
  // and shaped the same way, so the modal has one obvious "why is this disabled"
  // idiom rather than two.
  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const timer = setTimeout(() => {
      setResendSeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  const handleMfaCodeChange = (nextCode) => {
    setMfaCode(nextCode);
    setMfaStatus("idle");
    if (error) setError("");
  };

  const toggleMfaRecoveryMode = () => {
    if (loading) return;
    setMfaRecoveryMode((current) => !current);
    setMfaCode("");
    setMfaStatus("idle");
    setError("");
  };

  const handleMfaSubmit = async (submittedCode = mfaCode) => {
    if (loading || mfaStatus === "success") return;

    const normalizedCode = mfaRecoveryMode
      ? submittedCode.trim()
      : submittedCode.replace(/\D/g, "");
    const isValidCode = mfaRecoveryMode
      ? normalizedCode.length > 0
      : /^\d{6}$/.test(normalizedCode);

    if (!isValidCode) {
      setError(mfaRecoveryMode ? "Enter a recovery code to continue." : "Enter all 6 digits to continue.");
      setMfaStatus("error");
      return;
    }

    setError("");
    setMfaStatus("verifying");
    setLoading(true);
    const verificationStartedAt = Date.now();

    try {
      await signIn(email, password, { otpCode: normalizedCode });
      const session = await getSession();
      try {
        if (rememberDevice) await rememberTrustedDevice();
        else await revokeTrustedDevice();
      } catch (deviceError) {
        // Remembering is a convenience, never a reason to discard a valid
        // authenticated session when the preference endpoint is unavailable.
        console.warn("Trusted device preference could not be saved:", deviceError?.message || deviceError);
      }
      const scanRemaining = MFA_SCAN_MIN_MS - (Date.now() - verificationStartedAt);
      if (scanRemaining > 0) await new Promise((resolve) => setTimeout(resolve, scanRemaining));
      setMfaStatus("success");
      await new Promise((resolve) => setTimeout(resolve, 350));
      await redirectAfterSignIn(session);
    } catch (err) {
      if (err.message === "MFA_INVALID" || err.message === "CredentialsSignin") {
        setError("That verification code is invalid or already used.");
        setMfaCode("");
        setMfaStatus("error");
        setTimeout(() => {
          if (mfaRecoveryMode) mfaRecoveryInputRef.current?.focus();
          else mfaCodeInputRef.current?.focus();
        }, 0);
        return;
      }

      if (err.message === "MFA_UNAVAILABLE") {
        setError(
          "Verification is temporarily unavailable, so no code could be sent. Please try again shortly."
        );
        setMfaStatus("error");
        return;
      }

      if (err.message === "OTP_UNDELIVERABLE") {
        setError(
          "No verification code could be sent to this account, so the sign-in was stopped. Contact your administrator."
        );
        setMfaStatus("error");
        return;
      }

      if (err.message === "TEMP_PASSWORD_EXPIRED") {
        setError("This temporary password has expired. Ask your administrator to resend it.");
        setMfaStatus("error");
        return;
      }

      setError("We couldn't verify that code. Please try again.");
      setMfaStatus("error");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Re-sends the code.
   *
   * There is no resend endpoint: submitting the form with no code is the resend.
   * `authorize` only runs after the password verified, so a stray caller cannot
   * make this mail anybody, and the server's own cooldown is the throttle — which
   * is why the button below mirrors that cooldown instead of trusting itself.
   */
  const handleResendCode = async () => {
    if (loading || mfaStatus === "success" || resendSeconds > 0) return;
    setError("");
    setResendNotice("");
    setLoading(true);
    try {
      // Never returns a session: the server answers MFA_REQUIRED whenever no
      // code is supplied, which is exactly what is wanted here.
      await signIn(email, password, { otpCode: "" });
    } catch (err) {
      if (err.message === "MFA_REQUIRED") {
        setMfaCode("");
        setMfaStatus("idle");
        setResendSeconds(OTP_RESEND_COOLDOWN_SECONDS);
        setResendNotice(`A new code is on its way to ${maskEmailAddress(email)}.`);
        return;
      }
      if (err.message === "OTP_UNDELIVERABLE" || err.message === "MFA_UNAVAILABLE") {
        setError(
          "No verification code could be sent to this account. Contact your administrator."
        );
        setMfaStatus("error");
        return;
      }
      if (err.message === "TEMP_PASSWORD_EXPIRED") {
        setError("This temporary password has expired. Ask your administrator to resend it.");
        setMfaStatus("error");
        return;
      }
      setError("We couldn't send a new code. Please try again.");
      setMfaStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Frozen accounts wait out the visible countdown — no wasted attempts.
    if (lockSeconds > 0 || mfaRequired) return;
    setError("");

    const values = { email, password };
    const isValid = validate(values, {
      onSuccess: async () => {
        setLoading(true);
        try {
          // No code yet, so this call is what sends one: the server issues the
          // challenge, emails it, and answers MFA_REQUIRED.
          await signIn(email, password, { otpCode: "" });
          await redirectAfterSignIn();
        } catch (err) {
          if (err.message === "MFA_REQUIRED") {
            setMfaRequired(true);
            setMfaCode("");
            setMfaRecoveryMode(false);
            setRememberDevice(false);
            setMfaStatus("idle");
            setError("");
            setResendSeconds(OTP_RESEND_COOLDOWN_SECONDS);
            setResendNotice("");
            return;
          }
          if (err.message === "MFA_INVALID") {
            setMfaRequired(true);
            setError("That verification code is invalid or already used.");
            setMfaStatus("error");
            return;
          }
          if (err.message === "MFA_UNAVAILABLE") {
            setError(
              "Verification is temporarily unavailable, so no code could be sent. Please try again shortly."
            );
            return;
          }
          if (err.message === "OTP_UNDELIVERABLE") {
            setError(
              "No verification code could be sent to this account, so the sign-in was stopped. Contact your administrator."
            );
            return;
          }
          if (err.message === "TEMP_PASSWORD_EXPIRED") {
            setError("This temporary password has expired. Ask your administrator to resend it.");
            return;
          }
          // NextAuth collapses every authorize() failure (wrong password, IP
          // throttle, frozen account) into "CredentialsSignin", so without
          // translation the user would stare at a cryptic code. Check the
          // public throttle status (now account-aware) and speak plainly.
          try {
            const res = await fetch(`/api/auth/login-status?email=${encodeURIComponent(email)}`);
            if (res.ok) {
              const status = await res.json().catch(() => ({}));
              if (status?.locked) {
                const secs = status.retryAfterSec || 60;
                setLockSeconds(secs);
                setError(
                  status?.reason === "account"
                    ? "Too many incorrect attempts. This account is temporarily locked for your protection."
                    : "Too many login attempts from this network. Please wait a moment."
                );
                return;
              }
            }
          } catch {
            // Status check is best-effort — fall back to the generic message.
          }
          setError("Incorrect email or password. Please check and try again.");
        } finally {
          setLoading(false);
        }
      },
    });
    if (!isValid) return;
  };

  const emailField = fieldError("email");
  const passwordField = fieldError("password");

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background lg:flex">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-40 -top-44 h-[38rem] w-[38rem] rounded-full bg-primary/[0.05] blur-3xl" />
        <div className="absolute -bottom-56 -left-36 h-[34rem] w-[34rem] rounded-full bg-info/[0.06] blur-3xl" />
        <div className="absolute left-[42%] top-[30%] h-80 w-80 rounded-full bg-success/[0.045] blur-3xl" />
      </div>

      <motion.aside
        variants={container}
        initial="hidden"
        animate="show"
        className="relative z-10 hidden w-[46%] shrink-0 flex-col overflow-hidden border-r border-border/70 bg-surface p-12 xl:p-16 lg:flex 2xl:p-20"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -right-28 -top-36 h-[30rem] w-[30rem] rounded-full bg-primary/[0.06] blur-3xl" />
          <div className="absolute -left-28 bottom-0 h-[26rem] w-[26rem] rounded-full bg-info/[0.07] blur-3xl" />
        </div>

        <motion.div variants={item} className="relative flex items-center gap-3.5">
          <BrandMark />
          <div>
            <p className="text-lg font-bold leading-none tracking-tight text-foreground">{APP_NAME}</p>
            <p className="mt-1.5 text-xs text-foreground-muted">Fleet Transportation Management</p>
          </div>
        </motion.div>

        <div className="relative flex flex-1 flex-col justify-center py-10">
          <motion.h1
            variants={item}
            className="max-w-lg text-[clamp(2.5rem,4.2vw,4rem)] font-bold leading-[1.02] tracking-[-0.03em] text-foreground"
          >
            Operate your fleet
            <span className="block text-foreground-muted">with total clarity.</span>
          </motion.h1>
          <motion.p
            variants={item}
            className="mt-7 max-w-md text-base leading-relaxed text-foreground-secondary"
          >
            Coordinate drivers, vehicles, and every trip, from dispatch to drop-off, in one
            intelligent command center.
          </motion.p>
          <motion.div variants={item}>
            <RouteGraphic />
          </motion.div>
        </div>

        <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <motion.ul variants={item} className="flex flex-wrap gap-2.5">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3.5 py-2 text-xs font-medium text-foreground-secondary"
              >
                <Icon className="h-3.5 w-3.5 text-foreground" strokeWidth={1.75} />
                {label}
              </li>
            ))}
          </motion.ul>
          <motion.p variants={item} className="text-xs text-foreground-muted">
            © {new Date().getFullYear()} {APP_NAME}
          </motion.p>
        </div>
      </motion.aside>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[27rem]">
          <motion.div
            initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.8, ease: EASE }}
            className="mb-10 flex items-center gap-3 lg:hidden"
          >
            <BrandMark />
            <div>
              <p className="text-lg font-bold leading-none tracking-tight text-foreground">{APP_NAME}</p>
              <p className="mt-1.5 text-xs text-foreground-muted">Fleet Transportation Management</p>
            </div>
          </motion.div>

          <motion.div variants={container} initial="hidden" animate="show">
            <motion.div
              variants={item}
              className="rounded-[1.75rem] bg-background p-1.5 shadow-[0_24px_60px_-32px_rgba(17,24,39,0.4)] ring-1 ring-black/[0.04] dark:ring-white/[0.07]"
            >
              <div className="rounded-[calc(1.75rem-0.375rem)] bg-surface px-6 py-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] sm:px-8 dark:shadow-none">
                <div className="mb-8">
                  <h2 className="text-[1.65rem] font-bold tracking-tight text-foreground">
                    Welcome back
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                    Enter your credentials to access the system.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                  <AnimatePresence initial={false}>
                    {sessionExpiredNotice && !dismissedNotice && !error && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -8, height: 0 }}
                        transition={{ duration: 0.35, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div
                          role="status"
                          className="flex items-start justify-between gap-3 rounded-2xl border border-orange-200/50 dark:border-orange-900/30 bg-[#fff8f3] dark:bg-[#27150a] px-4 py-3.5 shadow-2xs"
                        >
                          <div className="flex items-start gap-3">
                            <AlertCircle
                              className="mt-0.5 h-5 w-5 shrink-0 text-orange-500 dark:text-orange-400"
                              strokeWidth={1.8}
                            />
                            <div className="space-y-0.5">
                              <p className="text-sm font-semibold text-orange-600 dark:text-orange-400 leading-snug">
                                Your session expired.
                              </p>
                              <p className="text-xs font-normal text-[#9c7860] dark:text-stone-400 leading-normal">
                                Please sign in to resume your work.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDismissedNotice(true)}
                            aria-label="Dismiss notification"
                            className="shrink-0 p-1 -mr-1 -mt-0.5 rounded-lg text-[#bda89b] hover:text-stone-600 dark:text-orange-300/40 dark:hover:text-orange-200 transition-colors cursor-pointer"
                          >
                            <X className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        </div>
                      </motion.div>
                    )}
                    {error && !mfaRequired && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -8, height: 0 }}
                        transition={{ duration: 0.35, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div
                          role="alert"
                          className="flex items-start gap-2.5 rounded-[0.9rem] bg-danger-bg px-3.5 py-3 text-sm text-danger"
                        >
                          <AlertCircle className="mt-px h-4 w-4 shrink-0" strokeWidth={2} />
                          <span>
                            {error}
                            {lockSeconds > 0 && (
                              <> Try again in <strong className="tabular-nums">{lockSeconds}s</strong>.</>
                            )}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-[13px] font-medium text-foreground">
                      Email
                    </Label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                        strokeWidth={1.75}
                      />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        ref={registerField("email")}
                        invalid={emailField.invalid}
                        autoComplete="email"
                        autoFocus
                        className="h-12 rounded-[0.9rem] bg-surface pl-11 text-[15px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] caret-primary focus-visible:ring-offset-surface"
                      />
                    </div>
                    {emailField.error && <p className="text-xs text-danger">{emailField.error}</p>}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-[13px] font-medium text-foreground">
                        Password
                      </Label>
                      <Link
                        href="/forgot-password"
                        className="text-xs font-medium text-foreground-muted transition-colors duration-200 hover:text-foreground"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                        strokeWidth={1.75}
                      />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        ref={registerField("password")}
                        invalid={passwordField.invalid}
                        autoComplete="current-password"
                        className={cn("h-12 rounded-[0.9rem] bg-surface pl-11 pr-12 text-[15px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] caret-primary focus-visible:ring-offset-surface", capsActive && "caps-field-active")}
                        {...capsBind}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-foreground-muted transition-colors duration-200 hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                        ) : (
                          <Eye className="h-4 w-4" strokeWidth={1.75} />
                        )}
                      </button>
                    </div>
                    {passwordField.error && <p className="text-xs text-danger">{passwordField.error}</p>}
                    <CapsLockHint on={capsActive} />
                  </div>

                  <Button
                    type="submit"
                    disabled={loading || lockSeconds > 0}
                    className="group relative h-14 w-full overflow-hidden rounded-full bg-foreground text-[15px] font-semibold text-surface transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 hover:shadow-[0_16px_32px_-16px_rgba(0,0,0,0.45)] active:scale-[0.985] disabled:opacity-70"
                  >
                    {!loading && <span>Sign in</span>}
                    <span
                      aria-hidden={loading || undefined}
                      className={cn(
                        "absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface/20 dark:bg-black/10",
                        "transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                        loading && "pointer-events-none scale-50 opacity-0"
                      )}
                    >
                      <ArrowRight className="h-4 w-4" strokeWidth={2} />
                    </span>
                    {loading && (
                      <span className="absolute inset-0 flex items-center justify-center gap-2.5 select-none">
                        <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} /> Signing in…
                      </span>
                    )}
                  </Button>
                </form>

                <div className="mt-7 flex items-center justify-center gap-2 text-xs text-foreground-muted">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Protected by {APP_NAME} role-based security
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </main>
      <MfaVerificationDialog
        open={mfaRequired}
        code={mfaCode}
        onCodeChange={handleMfaCodeChange}
        onVerify={handleMfaSubmit}
        onClose={closeMfaDialog}
        onToggleRecovery={toggleMfaRecoveryMode}
        onResend={handleResendCode}
        resendSeconds={resendSeconds}
        resendNotice={resendNotice}
        email={email}
        recoveryMode={mfaRecoveryMode}
        status={mfaStatus}
        error={error}
        loading={loading}
        rememberDevice={rememberDevice}
        onRememberDeviceChange={setRememberDevice}
        codeInputRef={mfaCodeInputRef}
        recoveryInputRef={mfaRecoveryInputRef}
      />
    </div>
    </MotionConfig>
  );
}
