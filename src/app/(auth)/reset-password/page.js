"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { resetSessionPassword } from "@/services/auth.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CarFront, Eye, EyeOff } from "lucide-react";
import { useFormValidation } from "@/lib/validation/useFormValidation";

const resetSchema = {
  password: { required: true, type: "password", label: "New password" },
  confirmPassword: (value, values) => {
    if (!value) return "Confirm password is required.";
    if (value !== values.password) return "Passwords do not match.";
    return null;
  },
};

function ResetPasswordForm() {
  const router = useRouter();
  const { data: session } = useSession();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const { validate, fieldError, registerField } = useFormValidation(resetSchema);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!session?.user?.email) {
      setError("You must be logged in to reset your password");
      return;
    }

    const isValid = validate({ password, confirmPassword }, {
      onSuccess: async () => {
        setLoading(true);
        try {
          await resetSessionPassword(password);
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
          <h1 className="text-2xl font-bold text-foreground">Set new password</h1>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Reset your password</CardTitle>
            <CardDescription>Enter your new password below</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
                  {error}
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
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
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
                />
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
