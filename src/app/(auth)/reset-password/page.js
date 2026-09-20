"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Check, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { resetSessionPassword } from "@/services/auth.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CapsLockHint, useCapsLock } from "@/components/ui/caps-lock-hint";
import { isPasswordByteLengthAllowed } from "@/lib/validation/helpers";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import {
  RecoveryAlert,
  RecoveryFooterLink,
  RecoveryHeader,
  RecoveryIcon,
  RecoveryShell,
  RecoverySteps,
  SecurityLine,
} from "@/components/auth/recovery-shell";
import { cn } from "@/lib/utils";

const resetSchema = {
  currentPassword: (value, values) => (!values.token && !value ? "Current password is required." : null),
  password: (value) => {
    if (!value) return "New password is required.";
    if (!isPasswordByteLengthAllowed(value)) return "Password must be no more than 72 UTF-8 bytes.";
    if (value.length < 8) return "Password must be at least 8 characters.";
    if (!/[a-z]/.test(value)) return "Include at least one lowercase letter.";
    if (!/[A-Z]/.test(value)) return "Include at least one uppercase letter.";
    if (!/[0-9]/.test(value)) return "Include at least one number.";
    if (!/[^A-Za-z0-9]/.test(value)) return "Include at least one special character.";
    return null;
  },
  confirmPassword: (value, values) => {
    if (!value) return "Confirm password is required.";
    if (value !== values.password) return "Passwords do not match.";
    return null;
  },
};

// Four visual rows keep the checklist calm while the combined case row mirrors
// the server's stronger uppercase + lowercase policy.
const RULE_CHECKS = [
  { key: "length", label: "At least 8 characters", test: (value) => value.length >= 8 },
  {
    key: "case",
    label: "Uppercase and lowercase letters",
    test: (value) => /[a-z]/.test(value) && /[A-Z]/.test(value),
  },
  { key: "number", label: "One number", test: (value) => /[0-9]/.test(value) },
  {
    key: "special",
    label: "One special character",
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
];

const EASE = [0.32, 0.72, 0, 1];

function passwordStrength(value) {
  if (!value) return { label: "", score: 0 };
  const score = RULE_CHECKS.filter(({ test }) => test(value)).length;
  if (score <= 1) return { label: "Weak", score: 1 };
  if (score < RULE_CHECKS.length) return { label: "Fair", score: 2 };
  return { label: "Strong", score: 4 };
}

function RequirementList({ password }) {
  return (
    <ul aria-label="Password requirements" className="space-y-2">
      {RULE_CHECKS.map(({ key, label, test }) => {
        const met = test(password);
        return (
          <li key={key} className={cn("flex items-center gap-2 text-xs transition-colors duration-200", met ? "text-success" : "text-foreground-muted")}>
            <motion.span
              initial={false}
              animate={{ scale: met ? 1 : 0.9, opacity: 1 }}
              transition={{ duration: 0.18, ease: EASE }}
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                met ? "border-success bg-success text-white" : "border-border bg-transparent"
              )}
            >
              {met ? <Check className="h-2.5 w-2.5" strokeWidth={2.5} /> : null}
            </motion.span>
            <span className={met ? "font-medium" : "font-normal"}>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function StrengthIndicator({ password }) {
  const { label, score } = passwordStrength(password);
  const fill = score === 1 ? "bg-danger/70" : score === 2 ? "bg-warning/80" : "bg-success";

  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex min-w-0 flex-1 items-center gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3].map((segment) => (
          <motion.span
            key={segment}
            initial={false}
            animate={{ opacity: segment < score ? 1 : 0.35, scaleX: segment < score ? 1 : 0.92 }}
            transition={{ duration: 0.2, ease: EASE }}
            className={cn("h-1.5 flex-1 origin-left rounded-full", segment < score ? fill : "bg-border")}
          />
        ))}
      </div>
      <span className="min-w-12 text-right text-[11px] font-medium text-foreground-muted">{label || "Strength"}</span>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  onBlur,
  onFocus,
  show,
  onToggle,
  autoComplete,
  invalid,
  register,
  capsBind,
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium text-foreground">{label}</Label>
      <div className="relative">
        <Lock
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
          strokeWidth={1.75}
        />
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onFocus={onFocus}
          ref={register}
          invalid={invalid}
          className="h-12 rounded-[0.9rem] bg-surface pl-11 pr-12 text-[15px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] caret-primary focus-visible:ring-offset-surface"
          {...capsBind}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-foreground-muted transition-colors duration-200 hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {show ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}

function StateFrame({ children, current = 2, eyebrow = "Account recovery", showSteps = true }) {
  return (
    <div className="flex min-h-[30rem] flex-col space-y-7">
      <RecoveryHeader eyebrow={eyebrow} />
      {showSteps && (
        <div className="flex items-center justify-center">
          <RecoverySteps current={current} />
        </div>
      )}
      {children}
    </div>
  );
}

function AccessState({ loading = false }) {
  return (
    <StateFrame showSteps={false} eyebrow="Account recovery">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {loading ? (
          <Loader2 className="h-7 w-7 animate-spin text-foreground-muted" aria-label="Loading" />
        ) : (
          <>
            <h1 id="reset-title" className="text-2xl font-bold tracking-[-0.03em] text-foreground">Sign in first</h1>
            <p id="reset-description" className="mt-2 max-w-sm text-sm leading-relaxed text-foreground-secondary">
              Sign in with your current password, then change it here or from Settings → Security.
            </p>
            <Button asChild className="mt-7 h-11 w-full max-w-xs rounded-full bg-primary font-semibold text-primary-bg">
              <Link href="/login">Go to login</Link>
            </Button>
          </>
        )}
      </div>
    </StateFrame>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const resetToken = searchParams.get("token");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const { validate, fieldError, registerField } = useFormValidation(resetSchema);
  const { active: capsOnCurrent, bind: capsBindCurrent } = useCapsLock();
  const { active: capsOnPassword, bind: capsBindPassword } = useCapsLock();
  const { active: capsOnConfirm, bind: capsBindConfirm } = useCapsLock();

  const confirmStatus = !confirmPassword
    ? "idle"
    : confirmPassword === password
      ? "valid"
      : "invalid";
  const passwordReady = isPasswordByteLengthAllowed(password) && RULE_CHECKS.every(({ test }) => test(password));
  const canSubmit = passwordReady && confirmStatus === "valid" && (resetToken || currentPassword.length > 0);

  if (!resetToken && sessionStatus === "loading") {
    return <AccessState loading />;
  }

  if (!resetToken && !session?.user?.email) {
    return <AccessState />;
  }

  const handleSubmit = (event) => {
    event.preventDefault();
    if (phase !== "idle") return;
    setError("");
    setConfirmTouched(true);

    validate({ token: resetToken, currentPassword, password, confirmPassword }, {
      onSuccess: async () => {
        setPhase("verifying");
        const startedAt = Date.now();
        try {
          await resetSessionPassword(password, currentPassword, resetToken);
          const remaining = 620 - (Date.now() - startedAt);
          if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
          setPhase("success");
        } catch (err) {
          const message = err?.message || "We couldn't update your password. Please try again.";
          if (/invalid or expired reset link/i.test(message)) {
            setPhase("expired");
          } else {
            setError(message);
            setPhase("idle");
          }
        }
      },
    });
  };

  if (phase === "verifying") {
    return (
      <StateFrame>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <RecoveryIcon kind="verify" />
          <h1 id="reset-title" className="mt-6 text-2xl font-bold tracking-[-0.03em] text-foreground">Updating your password…</h1>
          <p id="reset-description" className="mt-2 text-sm leading-relaxed text-foreground-secondary">
            Please wait while we secure your account.
          </p>
        </div>
      </StateFrame>
    );
  }

  if (phase === "success") {
    return (
      <StateFrame current={3}>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <RecoveryIcon />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-success">Step 2 complete</p>
          <h1 id="reset-title" className="mt-3 text-2xl font-bold tracking-[-0.03em] text-foreground">Password updated</h1>
          <p id="reset-description" className="mt-2 max-w-sm text-sm leading-relaxed text-foreground-secondary">
            Your password has been securely changed.
          </p>
          <Button
            type="button"
            onClick={() => router.replace("/login")}
            className="mt-7 h-11 w-full max-w-xs rounded-full bg-primary font-semibold text-primary-bg transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_16px_30px_-16px_rgba(15,23,42,0.6)]"
          >
            Continue to sign in
          </Button>
          <div className="mt-6 flex items-center gap-2 text-xs text-foreground-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-success" strokeWidth={1.75} />
            Your previous password can no longer be used.
          </div>
        </div>
      </StateFrame>
    );
  }

  if (phase === "expired") {
    return (
      <StateFrame>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <RecoveryIcon kind="expired" />
          <h1 id="reset-title" className="mt-6 text-2xl font-bold tracking-[-0.03em] text-foreground">Reset link expired</h1>
          <p id="reset-description" className="mt-2 max-w-sm text-sm leading-relaxed text-foreground-secondary">
            This password reset link is no longer valid. Request a new one to continue.
          </p>
          <Button asChild className="mt-7 h-11 w-full max-w-xs rounded-full bg-primary font-semibold text-primary-bg">
            <Link href="/forgot-password">Send a new reset link</Link>
          </Button>
          <div className="mt-5">
            <RecoveryFooterLink />
          </div>
        </div>
      </StateFrame>
    );
  }

  return (
    <div className="space-y-7">
      <RecoveryHeader eyebrow={resetToken ? "Account recovery" : "Password settings"} />

      {resetToken && (
        <div className="flex items-center justify-center">
          <RecoverySteps current={2} />
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-foreground-muted">{resetToken ? "Step 2 of 2" : "Password settings"}</p>
        <h1 id="reset-title" className="mt-3 text-2xl font-bold tracking-[-0.03em] text-foreground sm:text-3xl">Create a new password</h1>
        <p id="reset-description" className="mt-2 text-sm leading-relaxed text-foreground-secondary">
          {resetToken ? "Choose a strong password you haven’t used before." : "Confirm your current password, then choose a strong new one."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <RecoveryAlert>{error}</RecoveryAlert>}

        {!resetToken && (
          <div>
            <PasswordField
              id="currentPassword"
              label="Current password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              show={showCurrent}
              onToggle={() => setShowCurrent((value) => !value)}
              autoComplete="current-password"
              invalid={fieldError("currentPassword").invalid}
              register={registerField("currentPassword")}
              capsBind={capsBindCurrent}
            />
            <CapsLockHint on={capsOnCurrent} />
            {fieldError("currentPassword").error && <p className="mt-2 text-xs text-danger">{fieldError("currentPassword").error}</p>}
          </div>
        )}

        <div>
          <PasswordField
            id="password"
            label="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            show={showPassword}
            onToggle={() => setShowPassword((value) => !value)}
            autoComplete="new-password"
            invalid={fieldError("password").invalid}
            register={registerField("password")}
            capsBind={capsBindPassword}
          />
          <CapsLockHint on={capsOnPassword} />
          {fieldError("password").error && <p className="mt-2 text-xs text-danger">{fieldError("password").error}</p>}
          <div className="mt-3 space-y-3 rounded-xl border border-border/70 bg-background/45 px-3.5 py-3">
            <RequirementList password={password} />
            <StrengthIndicator password={password} />
          </div>
        </div>

        <div>
          <PasswordField
            id="confirmPassword"
            label="Confirm password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              setConfirmTouched(true);
            }}
            show={showConfirm}
            onToggle={() => setShowConfirm((value) => !value)}
            autoComplete="new-password"
            invalid={confirmStatus === "invalid" || fieldError("confirmPassword").invalid}
            register={registerField("confirmPassword")}
            capsBind={capsBindConfirm}
          />
          <CapsLockHint on={capsOnConfirm} />
          <AnimatePresence initial={false} mode="wait">
            {confirmTouched && confirmStatus === "invalid" && (
              <motion.p
                key="mismatch"
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                className="mt-2 text-xs text-danger"
              >
                Passwords don&apos;t match yet.
              </motion.p>
            )}
            {confirmTouched && confirmStatus === "valid" && (
              <motion.p
                key="match"
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                className="mt-2 flex items-center gap-1.5 text-xs text-success"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.1} />
                Passwords match.
              </motion.p>
            )}
          </AnimatePresence>
          {fieldError("confirmPassword").error && confirmStatus !== "invalid" && confirmStatus !== "valid" && (
            <p className="mt-2 text-xs text-danger">{fieldError("confirmPassword").error}</p>
          )}
        </div>

        <Button
          type="submit"
          disabled={!canSubmit || phase !== "idle"}
          className="h-12 w-full rounded-full bg-primary text-sm font-semibold text-primary-bg shadow-[0_12px_24px_-16px_rgba(15,23,42,0.55)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_16px_30px_-16px_rgba(15,23,42,0.6)] disabled:bg-muted disabled:text-foreground-muted disabled:shadow-none"
        >
          Reset password
        </Button>
      </form>

      <div className="flex flex-col items-center gap-5">
        {!resetToken && <RecoveryFooterLink />}
        <SecurityLine />
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
          <div className="text-sm text-foreground-secondary">Loading recovery…</div>
        </div>
      }
    >
      <MotionConfig reducedMotion="user">
        <RecoveryShell>
          <ResetPasswordForm />
        </RecoveryShell>
      </MotionConfig>
    </Suspense>
  );
}
