"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Check, Loader2, Mail } from "lucide-react";
import { requestPasswordReset } from "@/services/auth.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isEmail } from "@/lib/validation/index";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import {
  RecoveryAlert,
  RecoveryFooterLink,
  RecoveryHeader,
  RecoveryShell,
  RecoverySteps,
  SecurityLine,
} from "@/components/auth/recovery-shell";
import { cn } from "@/lib/utils";

const forgotSchema = {
  email: { required: true, type: "email", label: "Email" },
};

const EASE = [0.32, 0.72, 0, 1];

function EmailStateIcon({ status }) {
  if (status === "valid") {
    return (
      <motion.span
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: EASE }}
        className="text-success"
      >
        <Check className="h-4 w-4" strokeWidth={2.2} />
      </motion.span>
    );
  }

  if (status === "invalid") {
    return <span className="text-danger" aria-hidden="true">!</span>;
  }

  return null;
}

function EmailFeedback({ status }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      {status === "valid" && (
        <motion.p
          key="valid"
          role="status"
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          className="text-xs text-success"
        >
          Email format looks good.
        </motion.p>
      )}
      {status === "invalid" && (
        <motion.p
          key="invalid"
          role="alert"
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          className="text-xs text-danger"
        >
          Enter a valid email address.
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function MailSuccessIcon() {
  return (
    <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-success/25 bg-success/[0.08] text-success">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 rounded-full border border-success/25"
        initial={{ opacity: 0.7, scale: 0.78 }}
        animate={{ opacity: 0, scale: 1.35 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
      <Mail className="relative h-7 w-7" strokeWidth={1.55} />
      <motion.svg
        viewBox="0 0 24 24"
        className="absolute h-7 w-7"
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [emailBlurred, setEmailBlurred] = useState(false);
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [error, setError] = useState("");
  const [resendSeconds, setResendSeconds] = useState(42);
  const { clearError, validate, fieldError, registerField } = useFormValidation(forgotSchema);

  useEffect(() => {
    if (!sent || resendSeconds <= 0) return undefined;
    const timer = setTimeout(() => setResendSeconds((seconds) => Math.max(seconds - 1, 0)), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds, sent]);

  const emailStatus = !email.trim()
    ? "idle"
    : isEmail(email)
      ? "valid"
      : (emailBlurred || emailSubmitted ? "invalid" : "idle");
  const emailField = fieldError("email");

  const submitRequest = async () => {
    try {
      const result = await requestPasswordReset(email);
      setServerMessage(
        result?.message ||
          "If an account exists for that email, a reset link has been sent. It expires in 30 minutes."
      );
      setResendSeconds(42);
      setSent(true);
    } catch (err) {
      setError(err?.message || "We couldn't send a reset link right now. Please try again.");
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setEmailBlurred(true);
    setEmailSubmitted(true);
    setError("");
    validate({ email }, {
      onSuccess: async () => {
        setLoading(true);
        await submitRequest();
        setLoading(false);
      },
    });
  };

  const handleResend = async () => {
    if (resendSeconds > 0 || resending) return;
    setError("");
    setResending(true);
    await submitRequest();
    setResending(false);
  };

  return (
    <MotionConfig reducedMotion="user">
      <RecoveryShell>
        <AnimatePresence mode="wait" initial={false}>
          {!sent ? (
            <motion.div
              key="forgot"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="space-y-7"
            >
              <RecoveryHeader />

              <div className="flex items-center justify-between">
                <RecoverySteps current={1} />
                <span className="text-[11px] font-semibold tabular-nums text-foreground-muted">01 / 02</span>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-foreground-muted">Account recovery</p>
                <h1 id="forgot-title" className="mt-3 text-3xl font-bold tracking-[-0.03em] text-foreground">
                  Forgot your password?
                </h1>
                <p id="forgot-description" className="mt-2 max-w-[30rem] text-sm leading-relaxed text-foreground-secondary">
                  Enter the email associated with your FleetOps account. We&apos;ll send you a secure password reset link.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {error && <RecoveryAlert>{error}</RecoveryAlert>}

                <div className="space-y-2">
                  <Label htmlFor="recovery-email" className="text-sm font-medium text-foreground">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                      strokeWidth={1.75}
                    />
                    <Input
                      id="recovery-email"
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        setEmailBlurred(false);
                        setEmailSubmitted(false);
                        clearError("email");
                        setError("");
                      }}
                      onBlur={() => setEmailBlurred(true)}
                      ref={registerField("email")}
                      invalid={emailStatus === "invalid" || emailField.invalid}
                      aria-describedby="recovery-email-feedback"
                      autoComplete="email"
                      autoFocus
                      className={cn(
                        "h-12 rounded-[0.9rem] bg-surface pl-11 pr-11 text-[15px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] caret-primary focus-visible:ring-offset-surface",
                        emailStatus === "valid" && "border-success/60 focus-visible:ring-success/50",
                        emailStatus === "invalid" && "border-danger/60 focus-visible:ring-danger/50"
                      )}
                    />
                    <span className="absolute right-3.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-xs font-semibold">
                      <EmailStateIcon status={emailStatus} />
                    </span>
                  </div>
                  <div id="recovery-email-feedback" aria-live="polite" className="min-h-4">
                    <EmailFeedback status={emailStatus} />
                    {emailField.error && emailStatus !== "invalid" && <p className="text-xs text-danger">{emailField.error}</p>}
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="h-12 w-full rounded-full bg-primary text-sm font-semibold text-primary-bg shadow-[0_12px_24px_-16px_rgba(15,23,42,0.55)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_16px_30px_-16px_rgba(15,23,42,0.6)] active:scale-[0.99]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} />
                      Sending reset link…
                    </>
                  ) : (
                    "Send reset link"
                  )}
                </Button>
              </form>

              <div className="flex flex-col items-center gap-5">
                <RecoveryFooterLink />
                <SecurityLine />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="sent"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="space-y-7 text-center"
            >
              <div className="flex justify-start text-left">
                <RecoveryHeader />
              </div>

              <div className="flex items-center justify-center">
                <RecoverySteps current={1} />
              </div>

              <div className="flex flex-col items-center">
                <MailSuccessIcon />
                <p className="mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-success">Request received</p>
                <h1 id="forgot-title" className="mt-3 text-3xl font-bold tracking-[-0.03em] text-foreground">
                  Check your email
                </h1>
                <p id="forgot-description" className="mt-2 max-w-[28rem] text-sm leading-relaxed text-foreground-secondary">
                  Reset instructions were requested for <span className="font-medium text-foreground">{email}</span>.
                </p>
                <p className="mt-2 max-w-[29rem] text-xs leading-relaxed text-foreground-muted" aria-live="polite">
                  {serverMessage}
                </p>
              </div>

              {error && <RecoveryAlert>{error}</RecoveryAlert>}

              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={resendSeconds > 0 || resending}
                  onClick={handleResend}
                  className="h-11 w-full rounded-full border-border bg-surface text-sm font-semibold transition-colors hover:bg-hover"
                >
                  {resending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Resend email
                </Button>
                <p className="text-xs tabular-nums text-foreground-muted" role="status" aria-live="polite">
                  {resendSeconds > 0 ? `Resend available in ${resendSeconds}s` : "You can request another email now."}
                </p>
              </div>

              <div className="flex flex-col items-center gap-5">
                <RecoveryFooterLink />
                <SecurityLine />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </RecoveryShell>
    </MotionConfig>
  );
}
