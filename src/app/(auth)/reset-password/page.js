"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { MotionConfig, motion } from "framer-motion";
import { resetSessionPassword } from "@/services/auth.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CarFront, Eye, EyeOff, Check, ArrowLeft } from "lucide-react";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { CapsLockHint, useCapsLock } from "@/components/ui/caps-lock-hint";
import { isPasswordByteLengthAllowed } from "@/lib/validation/helpers";
import { cn } from "@/lib/utils";

// Same policy as /settings/security so both change paths enforce identical rules.
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

// Live version of the password policy: each rule lights up as the typed
// password satisfies it. Mirrors the server-side `type: "password"` policy
// so the checklist can never promise what the server will reject.
const RULE_CHECKS = [
  { key: "length", label: "At least 8 characters", test: (v) => v.length >= 8 },
  {
    key: "case",
    label: "Upper and lowercase letters",
    test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v),
  },
  { key: "number", label: "At least one number", test: (v) => /[0-9]/.test(v) },
  {
    key: "special",
    label: "At least one special character",
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
];

// Same entrance curve as the login page and PageEntrance.
const EASE = [0.32, 0.72, 0, 1];

// Recovery is a genuine two-step sequence (email, then new password), so a
// step rail encodes real information here rather than decorating.
function RecoverySteps({ current }) {
  const steps = ["Email", "New password"];
  return (
    <ol aria-label="Recovery progress" className="flex items-center justify-center gap-2">
      {steps.map((label, i) => {
        const done = i + 1 < current;
        const active = i + 1 === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                done && "bg-success text-white",
                active && "bg-primary text-white",
                !done && !active && "bg-muted text-foreground-muted"
              )}
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-xs font-medium",
                active ? "text-foreground" : "text-foreground-muted"
              )}
            >
              {label}
            </span>
            {i === 0 && <span aria-hidden="true" className="mx-1 h-px w-6 bg-border" />}
          </li>
        );
      })}
    </ol>
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
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const { active: capsOnCurrent, bind: capsBindCurrent } = useCapsLock();
  const { active: capsOnPassword, bind: capsBindPassword } = useCapsLock();
  const { active: capsOnConfirm, bind: capsBindConfirm } = useCapsLock();
  const { validate, fieldError, registerField } = useFormValidation(resetSchema);

  // The reset endpoint changes the SESSION user's password — an anonymous
  // visitor has nothing to reset. Say so before they fill the form.
  if (!resetToken && sessionStatus !== "loading" && !session?.user?.email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="shadow-xl border-0 text-center max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-xl">Sign in first</CardTitle>
            <CardDescription>
              Sign in with your current password, then change it here or from Settings &rarr; Security.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login">
              <Button className="w-full h-11">Go to login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!resetToken && !session?.user?.email) {
      setError("You must be logged in to reset your password");
      return;
    }

    const isValid = validate({ token: resetToken, currentPassword, password, confirmPassword }, {
      onSuccess: async () => {
        setLoading(true);
        try {
          await resetSessionPassword(password, currentPassword, resetToken);
          setSuccess(true);
          setTimeout(() => router.push("/login"), 2000);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      },
    });
    if (!isValid) return;
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <MotionConfig reducedMotion="user">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="w-full max-w-md"
          >
            <Card className="shadow-xl border-0 text-center">
              <CardHeader>
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center">
                    <Check className="w-8 h-8 text-success" />
                  </div>
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                  {resetToken ? "Step 2 of 2 complete" : "Password updated"}
                </p>
                <CardTitle className="text-xl mt-1">Password updated</CardTitle>
                <CardDescription className="mt-1">
                  Signing you out everywhere for safety — redirecting to login so you can sign in fresh.
                </CardDescription>
              </CardHeader>
            </Card>
          </motion.div>
        </MotionConfig>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <MotionConfig reducedMotion="user">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="w-full max-w-md"
        >
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary shadow-lg shadow-primary/25 mb-4">
            <CarFront className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{resetToken ? "Reset password" : "Change password"}</h1>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted">
            {resetToken ? "Account recovery" : "Password settings"}
          </p>
        </div>

        {resetToken && (
          <div className="mb-5">
            <RecoverySteps current={2} />
          </div>
        )}

        <Card className="shadow-xl border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">{resetToken ? "Choose a new password" : "Change your password"}</CardTitle>
            <CardDescription>
              {resetToken ? "This link works once — pick something strong" : "Confirm your current password, then choose a new one"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="mb-4 space-y-1.5 text-xs" aria-label="Password requirements">
              {RULE_CHECKS.map(({ key, label, test }) => {
                const met = test(password);
                return (
                  <li
                    key={key}
                    className={cn(
                      "flex items-center gap-1.5 font-medium",
                      met ? "text-success" : "text-foreground-muted"
                    )}
                  >
                    {met ? (
                      <Check aria-hidden="true" className="h-3.5 w-3.5" />
                    ) : (
                      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-foreground-muted" />
                    )}
                    {label}
                  </li>
                );
              })}
            </ul>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
                  {error}
                </div>
              )}
              {!resetToken && (
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    ref={registerField("currentPassword")}
                    invalid={fieldError("currentPassword").invalid}
                    {...capsBindCurrent}
                  />
                  <CapsLockHint on={capsOnCurrent} />
                  {fieldError("currentPassword").error && <p className="text-xs text-danger">{fieldError("currentPassword").error}</p>}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    ref={registerField("password")}
                    invalid={fieldError("password").invalid}
                    {...capsBindPassword}
                  />
                  <CapsLockHint on={capsOnPassword} />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  {fieldError("password").error && <p className="text-xs text-danger">{fieldError("password").error}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  ref={registerField("confirmPassword")}
                  invalid={fieldError("confirmPassword").invalid}
                  {...capsBindConfirm}
                />
                <CapsLockHint on={capsOnConfirm} />
                {fieldError("confirmPassword").error && <p className="text-xs text-danger">{fieldError("confirmPassword").error}</p>}
              </div>
              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                Update password
              </Button>
            </form>
          </CardContent>
          {!resetToken && (
            <CardContent className="pt-0">
              <Link href="/login">
                <Button variant="link" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to login
                </Button>
              </Link>
            </CardContent>
          )}
        </Card>
        </motion.div>
      </MotionConfig>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="animate-pulse text-foreground-secondary">Loading...</div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
