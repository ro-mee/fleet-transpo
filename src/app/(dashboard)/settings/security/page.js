"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeroHeader } from "@/components/ui/hero-header";
import { toast } from "@/components/ui/toast";
import { Shield, Key, Lock, Smartphone, MonitorSmartphone, Loader2, Eye, EyeOff } from "lucide-react";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { isPassword, hasPasswordLowercase, hasPasswordUppercase, hasPasswordNumber, hasPasswordSpecial } from "@/lib/validation/helpers";

const securitySchema = {
  currentPassword: { required: true, label: "Current password" },
  newPassword: (value, values) => {
    if (!value) return "New password is required.";
    if (!isPassword(value)) {
      if (value.length < 8) return "Password must be at least 8 characters.";
      if (!hasPasswordLowercase(value)) return "Password must contain at least one lowercase letter.";
      if (!hasPasswordUppercase(value)) return "Password must contain at least one uppercase letter.";
      if (!hasPasswordNumber(value)) return "Password must contain at least one number.";
      if (!hasPasswordSpecial(value)) return "Password must contain at least one special character.";
    }
    if (value === values.currentPassword) return "New password must be different from the current password.";
    return null;
  },
  confirmPassword: (value, values) => {
    if (!value) return "Confirm password is required.";
    if (value !== values.newPassword) return "Passwords do not match.";
    return null;
  },
};

export default function SecurityPage() {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const { validate, fieldError, registerField, resetValidation } = useFormValidation(securitySchema);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const isValid = validate(form, {
      onSuccess: async () => {
        setSaving(true);
        try {
          const res = await fetch("/api/auth/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currentPassword: form.currentPassword,
              newPassword: form.newPassword,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to update password");
          toast.success("Password updated successfully");
          setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
          resetValidation();
        } catch (err) {
          toast.error(err.message);
        } finally {
          setSaving(false);
        }
      },
    });
    if (!isValid) return;
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Shield}
        title="Security"
        badge="Settings"
        description="Manage account security and authentication methods."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" /> Change Password
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="currentPassword" className="text-sm text-foreground-secondary">Current Password</label>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    name="currentPassword"
                    autoComplete="current-password"
                    type={showPasswords ? "text" : "password"}
                    value={form.currentPassword}
                    onChange={handleChange}
                    ref={registerField("currentPassword")}
                    invalid={fieldError("currentPassword").invalid}
                  />
                  {fieldError("currentPassword").error && <p className="text-xs text-danger mt-1">{fieldError("currentPassword").error}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="newPassword" className="text-sm text-foreground-secondary">New Password</label>
                <Input
                  id="newPassword"
                  name="newPassword"
                  autoComplete="new-password"
                  type={showPasswords ? "text" : "password"}
                  value={form.newPassword}
                  onChange={handleChange}
                  ref={registerField("newPassword")}
                  invalid={fieldError("newPassword").invalid}
                />
                {fieldError("newPassword").error && <p className="text-xs text-danger mt-1">{fieldError("newPassword").error}</p>}
              </div>
              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm text-foreground-secondary">Confirm New Password</label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  autoComplete="new-password"
                  type={showPasswords ? "text" : "password"}
                  value={form.confirmPassword}
                  onChange={handleChange}
                  ref={registerField("confirmPassword")}
                  invalid={fieldError("confirmPassword").invalid}
                />
                {fieldError("confirmPassword").error && <p className="text-xs text-danger mt-1">{fieldError("confirmPassword").error}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPasswords(!showPasswords)}
                  className="flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showPasswords ? "Hide" : "Show"} passwords
                </button>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
                {saving ? "Updating..." : "Update Password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" /> Two-Factor Authentication
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <Shield className="w-8 h-8 text-foreground-muted" />
              <div>
                <p className="text-sm font-medium">2FA Status</p>
                <Badge variant="secondary" className="mt-1">Not Enabled</Badge>
              </div>
            </div>
            <p className="text-sm text-foreground-secondary">
              Add an extra layer of security to your account by enabling two-factor authentication.
            </p>
            <div>
              <Button variant="outline" disabled>Enable 2FA</Button>
              <p className="mt-2 text-xs text-foreground-muted">Two-factor authentication isn&apos;t available yet — it&apos;s on the roadmap.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <MonitorSmartphone className="w-4 h-4 text-primary" /> Session Management
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-foreground-secondary space-y-2">
          <p>
            Web sessions are signed in per browser and end when you sign out or the session expires.
            On shared computers, always use <span className="font-medium text-foreground">Sign out</span> from
            the top-right account menu when you&apos;re done.
          </p>
          <p className="text-xs text-foreground-muted">
            Driver mobile devices can be signed out individually from the mobile app, or all at once via
            &ldquo;Logout on all devices&rdquo; there. Per-device session history isn&apos;t tracked.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
