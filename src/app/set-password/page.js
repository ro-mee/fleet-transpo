"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Check, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { setInitialPassword } from "@/services/auth.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CapsLockHint, useCapsLock } from "@/components/ui/caps-lock-hint";
import { isPasswordByteLengthAllowed } from "@/lib/validation/helpers";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import {
  RecoveryAlert,
  RecoveryHeader,
  RecoveryIcon,
  RecoveryShell,
  SecurityLine,
} from "@/components/auth/recovery-shell";
import { cn } from "@/lib/utils";

// Forced first sign-in after a temp-password invite: no current-password field
// (the mustChangePassword session claim authorizes the change server-side).
const setPasswordSchema = {
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

function Frame({ children }) {
  return (
    <div className="flex min-h-[30rem] flex-col space-y-7">
      <RecoveryHeader eyebrow="Account setup" />
      {children}
    </div>
  );
}

function RedirectingState() {
  return (
    <Frame>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Loader2 className="h-7 w-7 animate-spin text-foreground-muted" aria-label="Redirecting" />
      </div>
    </Frame>
  );
}

function SetPasswordForm() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const { validate, fieldError, registerField } = useFormValidation(setPasswordSchema);
  const { active: capsOnPassword, bind: capsBindPassword } = useCapsLock();
  const { active: capsOnConfirm, bind: capsBindConfirm } = useCapsLock();

  // Session guards: send strays where they belong while this page is the only
  // place a must-change session may land (the layout gate bounces the rest).
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);
  useEffect(() => {
    if (status === "authenticated" && session?.user && !session.user.mustChangePassword && phase !== "success") {
      router.replace("/dashboard");
    }
  }, [status, session, phase, router]);

  // Success screen auto-advances; the button below is the manual fallback.
  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(() => {
      router.replace("/dashboard");
      router.refresh();
    }, 1000);
    return () => clearTimeout(t);
  }, [phase, router]);

  const confirmStatus = !confirmPassword
    ? "idle"
    : confirmPassword === password
      ? "valid"
      : "invalid";
  const passwordReady = isPasswordByteLengthAllowed(password) && RULE_CHECKS.every(({ test }) => test(password));
  const canSubmit = passwordReady && confirmStatus === "valid";

  if (status === "loading" || status === "unauthenticated") {
    return <RedirectingState />;
  }
  if (session?.user && !session.user.mustChangePassword && phase !== "success") {
    return <RedirectingState />;
  }

  const handleSubmit = (event) => {
    event.preventDefault();
    if (phase !== "idle") return;
    setError("");
    setConfirmTouched(true);

    validate({ password, confirmPassword }, {
      onSuccess: async () => {
        setPhase("verifying");
        try {
          await setInitialPassword(password);
          // Refetches /api/auth/session → decodes the rotated cookie →
          // mustChangePassword flips false for the redirect.
          await update();
          setPhase("success");
        } catch (err) {
          setError(err?.message || "We couldn't set your password. Please try again.");
          setPhase("idle");
        }
      },
    });
  };

  if (phase === "verifying") {
    return (
      <Frame>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <RecoveryIcon kind="verify" />
          <h1 id="set-password-title" className="mt-6 text-2xl font-bold tracking-[-0.03em] text-foreground">Setting your password…</h1>
          <p id="set-password-description" className="mt-2 text-sm leading-relaxed text-foreground-secondary">
            Please wait while we secure your account.
          </p>
        </div>
      </Frame>
    );
  }

  if (phase === "success") {
    return (
      <Frame>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <RecoveryIcon />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-success">Setup complete</p>
          <h1 id="set-password-title" className="mt-3 text-2xl font-bold tracking-[-0.03em] text-foreground">Password set</h1>
          <p id="set-password-description" className="mt-2 max-w-sm text-sm leading-relaxed text-foreground-secondary">
            Your account is ready — taking you to the dashboard.
          </p>
          <Button
            type="button"
            onClick={() => {
              router.replace("/dashboard");
              router.refresh();
            }}
            className="mt-7 h-11 w-full max-w-xs rounded-full bg-primary font-semibold text-primary-bg transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_16px_30px_-16px_rgba(15,23,42,0.6)]"
          >
            Go to dashboard now
          </Button>
          <div className="mt-6 flex items-center gap-2 text-xs text-foreground-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-success" strokeWidth={1.75} />
            Your temporary password can no longer be used.
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <div className="space-y-7">
      <RecoveryHeader eyebrow="Account setup" />

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-foreground-muted">First sign-in</p>
        <h1 id="set-password-title" className="mt-3 text-2xl font-bold tracking-[-0.03em] text-foreground sm:text-3xl">Set your password</h1>
        <p id="set-password-description" className="mt-2 text-sm leading-relaxed text-foreground-secondary">
          You signed in with a temporary password. Choose your own to finish setting up your account — you&apos;ll stay signed in.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <RecoveryAlert>{error}</RecoveryAlert>}

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
          Set password &amp; continue
        </Button>
      </form>

      <SecurityLine>Your temporary password stops working once you save</SecurityLine>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <MotionConfig reducedMotion="user">
      <RecoveryShell>
        <SetPasswordForm />
      </RecoveryShell>
    </MotionConfig>
  );
}
