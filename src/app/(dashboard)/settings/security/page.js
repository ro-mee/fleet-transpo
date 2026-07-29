"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { Shield, Key, Lock, Smartphone, History, Loader2, Eye, EyeOff } from "lucide-react";

export default function SecurityPage() {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const validate = () => {
    if (!form.currentPassword) return "Current password is required";
    if (!form.newPassword) return "New password is required";
    if (form.newPassword.length < 6) return "New password must be at least 6 characters";
    if (form.newPassword === form.currentPassword) return "New password must be different from current password";
    if (form.newPassword !== form.confirmPassword) return "Passwords do not match";
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }

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
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Security</h1>
        <p className="text-foreground-secondary mt-1">Manage account security and authentication methods</p>
      </div>

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
                <label className="text-sm text-foreground-secondary">Current Password</label>
                <div className="relative">
                  <Input
                    name="currentPassword"
                    type={showPasswords ? "text" : "password"}
                    value={form.currentPassword}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-foreground-secondary">New Password</label>
                <Input
                  name="newPassword"
                  type={showPasswords ? "text" : "password"}
                  value={form.newPassword}
                  onChange={handleChange}
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-foreground-secondary">Confirm New Password</label>
                <Input
                  name="confirmPassword"
                  type={showPasswords ? "text" : "password"}
                  value={form.confirmPassword}
                  onChange={handleChange}
                  required
                  minLength={6}
                />
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
            <Button variant="outline" disabled>Enable 2FA</Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-primary" /> Recent Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { device: "Chrome on Windows", location: "Manila, PH", ip: "192.168.1.100", lastActive: "2 min ago", current: true },
              { device: "Safari on iPhone", location: "Quezon City, PH", ip: "192.168.1.101", lastActive: "2 hrs ago", current: false },
              { device: "Firefox on macOS", location: "Makati, PH", ip: "192.168.1.102", lastActive: "3 days ago", current: false },
            ].map((session, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg hover:bg-hover transition-colors">
                <div className={`w-2 h-2 rounded-full ${session.current ? "bg-success" : "bg-muted"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{session.device}</p>
                    {session.current && <Badge variant="success" className="text-[9px]">Current</Badge>}
                  </div>
                  <p className="text-xs text-foreground-muted">{session.location} · {session.ip}</p>
                </div>
                <span className="text-xs text-foreground-muted">{session.lastActive}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
