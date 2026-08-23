"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/services/auth.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CarFront, ArrowLeft, MailCheck } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { useFormValidation } from "@/lib/validation/useFormValidation";

const forgotSchema = {
  email: { required: true, type: "email", label: "Email" },
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const { validate, fieldError, registerField } = useFormValidation(forgotSchema);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const isValid = validate({ email }, {
      onSuccess: async () => {
        setLoading(true);
        try {
          await requestPasswordReset(email);
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

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md">
          <Card className="shadow-xl border-0 text-center">
            <CardHeader>
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center">
                  <MailCheck className="w-8 h-8 text-success" />
                </div>
              </div>
              <CardTitle className="text-xl">Request received</CardTitle>
              <CardDescription>
                If an account exists for <strong>{email}</strong>, contact your FleetOps administrator to receive a
                reset link — reset links are issued by administrators, not emailed automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/login">
                <Button variant="outline" className="mt-2">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to login
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
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
          <h1 className="text-2xl font-bold text-foreground">{APP_NAME}</h1>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Forgot password</CardTitle>
            <CardDescription>
              Enter your email — your FleetOps administrator can issue a reset link for your account
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
                Request reset
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
      </div>
    </div>
  );
}
