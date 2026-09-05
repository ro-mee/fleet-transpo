"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { resetSessionPassword } from "@/services/auth.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CarFront, Eye, EyeOff } from "lucide-react";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { CapsLockHint, useCapsLock } from "@/components/ui/caps-lock-hint";
import { isPasswordByteLengthAllowed } from "@/lib/validation/helpers";

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

const PASSWORD_RULES = [
  "At least 8 characters",
  "Upper and lowercase letters",
  "At least one number",
  "At least one special character",
];

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
        <Card className="shadow-xl border-0 text-center max-w-md w-full">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center">
                <CarFront className="w-8 h-8 text-success" />
              </div>
            </div>
            <CardTitle className="text-xl">Password updated</CardTitle>
            <CardDescription>Redirecting to login...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary shadow-lg shadow-primary/25 mb-4">
            <CarFront className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{resetToken ? "Reset password" : "Change password"}</h1>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">{resetToken ? "Reset your password" : "Change your password"}</CardTitle>
            <CardDescription>
              {resetToken ? "Enter your new password below" : "Confirm your current password, then choose a new one"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="mb-4 space-y-1 text-xs text-foreground-secondary" aria-label="Password requirements">
              {PASSWORD_RULES.map((rule) => (
                <li key={rule} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-foreground-muted" />
                  {rule}
                </li>
              ))}
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
        </Card>
      </div>
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
