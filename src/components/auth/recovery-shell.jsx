"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CarFront,
  Check,
  Gauge,
  LockKeyhole,
  MapPin,
  Navigation,
  ShieldCheck,
} from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

const EASE = [0.32, 0.72, 0, 1];

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

const AUTH_FEATURES = [
  { icon: Navigation, label: "Dispatch orchestration" },
  { icon: Gauge, label: "Fleet readiness" },
  { icon: MapPin, label: "Trip visibility" },
];

function BrandRouteTrace() {
  return (
    <svg viewBox="0 0 480 220" fill="none" aria-hidden="true" className="mt-9 w-full max-w-[26rem]">
      <path
        d="M 20 172 C 88 184, 108 80, 190 80 C 278 80, 270 174, 356 172 C 408 170, 442 130, 460 58"
        stroke="var(--primary)"
        strokeOpacity="0.25"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 8"
      />
      <circle cx="20" cy="172" r="5" fill="var(--primary)" />
      <circle cx="190" cy="80" r="4.5" fill="var(--sf)" stroke="var(--primary)" strokeWidth="2" />
      <circle cx="356" cy="172" r="4.5" fill="var(--sf)" stroke="var(--primary)" strokeWidth="2" />
      <circle cx="460" cy="58" r="10" stroke="var(--primary)" strokeOpacity="0.25" strokeWidth="1.5" />
      <circle cx="460" cy="58" r="5" fill="var(--primary)" />
      <g transform="translate(20 172) rotate(-18)">
        <circle r="12" fill="var(--sf)" stroke="var(--primary)" strokeWidth="2" />
        <CarFront width={14} height={14} x={-7} y={-7} color="var(--primary)" strokeWidth={2} />
      </g>
    </svg>
  );
}

function BrandPanel() {
  return (
    <aside className="relative z-10 hidden w-[46%] shrink-0 flex-col overflow-hidden border-r border-border/70 bg-surface p-12 xl:p-16 lg:flex 2xl:p-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-28 -top-36 h-[30rem] w-[30rem] rounded-full bg-primary/[0.06] blur-3xl" />
        <div className="absolute -left-28 bottom-0 h-[26rem] w-[26rem] rounded-full bg-info/[0.07] blur-3xl" />
      </div>

      <div className="relative flex items-center gap-3.5">
        <BrandMark />
        <div>
          <p className="text-lg font-bold leading-none tracking-tight text-foreground">{APP_NAME}</p>
          <p className="mt-1.5 text-xs text-foreground-muted">Fleet Transportation Management</p>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col justify-center py-10">
        <h1 className="max-w-lg text-[clamp(2.5rem,4.2vw,4rem)] font-bold leading-[1.02] tracking-[-0.03em] text-foreground">
          Operate your fleet
          <span className="block text-foreground-muted">with total clarity.</span>
        </h1>
        <p className="mt-7 max-w-md text-base leading-relaxed text-foreground-secondary">
          Coordinate drivers, vehicles, and every trip, from dispatch to drop-off, in one
          intelligent command center.
        </p>
        <BrandRouteTrace />
      </div>

      <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <ul className="flex flex-wrap gap-2.5">
          {AUTH_FEATURES.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3.5 py-2 text-xs font-medium text-foreground-secondary"
            >
              <Icon className="h-3.5 w-3.5 text-foreground" strokeWidth={1.75} />
              {label}
            </li>
          ))}
        </ul>
        <p className="text-xs text-foreground-muted">&copy; {new Date().getFullYear()} {APP_NAME}</p>
      </div>
    </aside>
  );
}

export function AuthCardShell({ children, className }) {
  return (
    <div
      className={cn(
        "rounded-[1.75rem] bg-background p-1.5 shadow-[0_24px_60px_-32px_rgba(17,24,39,0.4)] ring-1 ring-black/[0.04] dark:ring-white/[0.07]",
        className
      )}
    >
      <div className="rounded-[calc(1.75rem-0.375rem)] bg-surface px-6 py-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] sm:px-8 dark:shadow-none">
        {children}
      </div>
    </div>
  );
}

export function RecoveryShell({ children }) {
  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden bg-background lg:flex">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-40 -top-44 h-[38rem] w-[38rem] rounded-full bg-primary/[0.05] blur-3xl" />
        <div className="absolute -bottom-56 -left-36 h-[34rem] w-[34rem] rounded-full bg-info/[0.06] blur-3xl" />
        <div className="absolute left-[42%] top-[30%] h-80 w-80 rounded-full bg-success/[0.045] blur-3xl" />
      </div>

      <BrandPanel />

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[27rem]">
          <motion.div
            initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.8, ease: EASE }}
          >
            <AuthCardShell>{children}</AuthCardShell>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

export function RecoveryHeader({ eyebrow = "Account recovery" }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark className="h-10 w-10 rounded-[0.9rem]" />
      <div>
        <p className="text-sm font-bold leading-none tracking-tight text-foreground">{APP_NAME}</p>
        <p className="mt-1 text-[11px] text-foreground-muted">{eyebrow}</p>
      </div>
    </div>
  );
}

export function RecoverySteps({ current }) {
  const steps = ["Email", "New password"];

  return (
    <ol aria-label="Recovery progress" className="flex items-center gap-2 text-xs">
      {steps.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold transition-colors duration-200",
                done && "bg-success text-white",
                active && "bg-primary text-primary-bg",
                !done && !active && "bg-muted text-foreground-muted"
              )}
            >
              {done ? <Check className="h-3 w-3" /> : step}
            </span>
            <span className={cn("font-medium", active ? "text-foreground" : "text-foreground-muted")}>
              {label}
            </span>
            {index === 0 && <span aria-hidden="true" className="mx-1 h-px w-8 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

export function RecoveryFooterLink({ href = "/login", children = "Back to sign in" }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-xs font-medium text-foreground-muted transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
      {children}
    </Link>
  );
}

export function SecurityLine({ children = "Secure password recovery" }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-foreground-muted">
      <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
      {children}
    </div>
  );
}

export function RecoveryIcon({ kind = "success" }) {
  if (kind === "verify") {
    return (
      <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-primary/15 bg-primary/[0.04] text-primary">
        <div className="absolute left-2 right-2 top-1/2 h-px overflow-hidden bg-success/30">
          <motion.span
            aria-hidden="true"
            className="absolute inset-y-0 w-1/2 bg-success"
            initial={{ x: "-100%" }}
            animate={{ x: "220%" }}
            transition={{ duration: 0.9, ease: EASE, repeat: Infinity, repeatDelay: 0.45 }}
          />
        </div>
        <LockKeyhole className="relative h-5 w-5" strokeWidth={1.7} />
      </div>
    );
  }

  if (kind === "expired") {
    return (
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-danger/15 bg-danger/[0.05] text-danger">
        <AlertTriangle className="h-6 w-6" strokeWidth={1.6} />
      </div>
    );
  }

  return (
    <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-success/25 bg-success/[0.08] text-success">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 rounded-full border border-success/25"
        initial={{ opacity: 0.7, scale: 0.78 }}
        animate={{ opacity: 0, scale: 1.35 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
      <motion.svg
        viewBox="0 0 24 24"
        className="relative h-7 w-7"
        fill="none"
        aria-hidden="true"
      >
        <motion.path
          d="m5 12.5 4.2 4.2L19 7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: EASE }}
        />
      </motion.svg>
    </div>
  );
}

export function RecoveryAlert({ children }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/15 bg-danger/[0.06] px-3.5 py-3 text-sm text-danger">
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span>{children}</span>
    </div>
  );
}
