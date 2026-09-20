"use client";

import { useState } from "react";
import Link from "next/link";
import { MotionConfig, motion } from "framer-motion";
import { requestPasswordReset } from "@/services/auth.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CarFront, ArrowLeft, MailCheck, Check } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { cn } from "@/lib/utils";

const forgotSchema = {
  email: { required: true, type: "email", label: "Email" },
};

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

// Same ambient backdrop as the login page: three soft aurora blobs over the
// app background. Pure atmosphere — aria-hidden, never interactive, and the
// card below sits at z-10 so nothing shifts.
function AuthBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-40 -top-44 h-[38rem] w-[38rem] rounded-full bg-primary/[0.05] blur-3xl" />
      <div className="absolute -bottom-56 -left-36 h-[34rem] w-[34rem] rounded-full bg-info/[0.06] blur-3xl" />
      <div className="absolute left-[42%] top-[30%] h-80 w-80 rounded-full bg-success/[0.045] blur-3xl" />
    </div>
  );
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [error, setError] = useState("");
  const { validate, fieldError, registerField } = useFormValidation(forgotSchema);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const isValid = validate({ email }, {
      onSuccess: async () => {
        setLoading(true);
        try {
          // The server owns the response wording: it reports a sent email
          // when email delivery is configured and the administrator path
          // otherwise — identical whether or not the account exists
          // (no enumeration).
          const result = await requestPasswordReset(email);
          setServerMessage(
            result?.message ||
              "If an account exists for that email, a reset link has been sent. It expires in 30 minutes."
          );
          setSent(true);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      },
    });
    if (!isValid) return;
  };

  const startOver = () => {
    setSent(false);
    setServerMessage("");
    setError("");
  };

  if (sent) {
    return (
      <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background">
        <AuthBackdrop />
        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center p-4">
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
                    <MailCheck className="w-8 h-8 text-success" />
                  </div>
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                  Step 1 of 2 complete
                </p>
                <CardTitle className="text-xl mt-1">Check your inbox</CardTitle>
                <CardDescription className="mt-1">
                  {serverMessage} If you use the mobile app, the same email carries a code you can paste on its
                  reset screen. Nothing arrived? Check spam, then try again.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button variant="outline" onClick={startOver}>
                  Use a different email
                </Button>
                <Link href="/login">
                  <Button variant="link" className="w-full">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to login
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </motion.div>
        </MotionConfig>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background">
      <AuthBackdrop />
      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center p-4">
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
            <h1 className="text-2xl font-bold text-foreground">{APP_NAME}</h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted">
              Account recovery
            </p>
          </div>

          <div className="mb-5">
            <RecoverySteps current={1} />
          </div>

          <Card className="shadow-xl border-0">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl">Forgot password</CardTitle>
              <CardDescription>
                Enter your account email and we will send a reset link if an account exists for it
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
                    {error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    ref={registerField("email")}
                    invalid={fieldError("email").invalid}
                  />
                  {fieldError("email").error && <p className="text-xs text-danger">{fieldError("email").error}</p>}
                </div>
                <Button type="submit" className="w-full h-11" disabled={loading}>
                  {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                  Send reset link
                </Button>
              </form>
            </CardContent>
            <CardContent className="pt-0">
              <Link href="/login">
                <Button variant="link" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to login
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      </MotionConfig>
      </div>
    </div>
  );
}
