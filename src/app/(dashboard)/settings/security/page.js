"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeroHeader } from "@/components/ui/hero-header";
import { toast } from "@/components/ui/toast";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clipboard,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Lock,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Shield,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import {
  hasPasswordLowercase,
  hasPasswordNumber,
  hasPasswordSpecial,
  hasPasswordUppercase,
  isPassword,
  isPasswordByteLengthAllowed,
} from "@/lib/validation/helpers";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const securitySchema = {
  currentPassword: { required: true, label: "Current password" },
  newPassword: (value, values) => {
    if (!value) return "New password is required.";
    if (!isPasswordByteLengthAllowed(value)) return "Password must be no more than 72 UTF-8 bytes.";
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

function PasswordField({ id, name, label, value, onChange, visible, onToggle, inputRef, autoComplete, invalid, describedBy, help, error }) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm text-foreground-secondary">{label}</label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          autoComplete={autoComplete}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          ref={inputRef}
          invalid={invalid}
          aria-describedby={describedBy}
          className="pr-11"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {visible ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
        </button>
      </div>
      {help && <p id={`${id}-help`} className="text-xs text-foreground-muted">{help}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function formatDate(value) {
  if (!value) return "Unknown";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "Unknown";
  }
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function deleteJson(path, body) {
  const response = await fetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function SecurityPage() {
  const { signOut } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const [visibility, setVisibility] = useState({ currentPassword: false, newPassword: false, confirmPassword: false, mfaSetupPassword: false, mfaManagePassword: false });
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState("");
  const [revoking, setRevoking] = useState("");
  const [mfa, setMfa] = useState({ enabled: false, setupPending: false });
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaSetupPassword, setMfaSetupPassword] = useState("");
  const [mfaSetup, setMfaSetup] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaManagePassword, setMfaManagePassword] = useState("");
  const [mfaManageCode, setMfaManageCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const { validate, fieldError, registerField, resetValidation } = useFormValidation(securitySchema);
  const currentPasswordError = fieldError("currentPassword");
  const newPasswordError = fieldError("newPassword");
  const confirmPasswordError = fieldError("confirmPassword");

  const passwordRequirements = [
    { label: "8 or more characters", valid: form.newPassword.length >= 8 },
    { label: "A lowercase letter", valid: hasPasswordLowercase(form.newPassword) },
    { label: "An uppercase letter", valid: hasPasswordUppercase(form.newPassword) },
    { label: "A number", valid: hasPasswordNumber(form.newPassword) },
    { label: "A special character", valid: hasPasswordSpecial(form.newPassword) },
    { label: "No more than 72 UTF-8 bytes", valid: isPasswordByteLengthAllowed(form.newPassword) },
  ];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sessionsResponse, mfaResponse] = await Promise.all([
          fetch("/api/auth/sessions", { cache: "no-store" }),
          fetch("/api/auth/mfa", { cache: "no-store" }),
        ]);
        const [sessionData, mfaData] = await Promise.all([sessionsResponse.json().catch(() => ({})), mfaResponse.json().catch(() => ({}))]);
        if (cancelled) return;
        if (!sessionsResponse.ok) setSessionsError(sessionData.error || "Could not load active sessions.");
        else setSessions(sessionData.sessions || []);
        if (mfaResponse.ok) setMfa({ enabled: Boolean(mfaData.enabled), setupPending: Boolean(mfaData.setupPending) });
      } catch {
        if (!cancelled) setSessionsError("Could not load active sessions.");
      } finally {
        if (!cancelled) {
          setSessionsLoading(false);
          setMfaLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleChange = (e) => setForm((current) => ({ ...current, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const isValid = validate(form, {
      onSuccess: async () => {
        setSaving(true);
        try {
          const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Failed to update password");
          toast.success("Password updated. Sessions revoked — please sign in again.");
          setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
          resetValidation();
          await signOut();
        } catch (error) {
          toast.error(error.message);
        } finally {
          setSaving(false);
        }
      },
    });
    if (!isValid) return;
  };

  const revokeSession = async (session) => {
    if (!window.confirm(`Sign out ${session.device}?`)) return;
    setRevoking(session.id);
    try {
      const data = await deleteJson("/api/auth/sessions", { kind: session.kind, id: session.id });
      setSessions((current) => current.filter((item) => item.id !== session.id));
      toast.success("Session signed out.");
      if (data.signInRequired) await signOut();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRevoking("");
    }
  };

  const revokeOthers = async () => {
    if (!window.confirm("Sign out all other web and mobile sessions?")) return;
    setRevoking("others");
    try {
      await postJson("/api/auth/sessions", {});
      setSessions((current) => current.filter((item) => item.current));
      toast.success("Other sessions signed out.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRevoking("");
    }
  };

  const startMfaSetup = async () => {
    setMfaBusy("setup");
    try {
      const data = await postJson("/api/auth/mfa/setup", { currentPassword: mfaSetupPassword });
      setMfaSetup(data);
      setMfaSetupPassword("");
      setMfaCode("");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setMfaBusy("");
    }
  };

  const confirmMfa = async () => {
    setMfaBusy("confirm");
    try {
      const data = await postJson("/api/auth/mfa/confirm", { code: mfaCode });
      setMfa({ enabled: true, setupPending: false });
      setMfaSetup(null);
      setMfaCode("");
      setRecoveryCodes(data.recoveryCodes || []);
      toast.success("Two-factor authentication enabled. Save your recovery codes before signing in again.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setMfaBusy("");
    }
  };

  const disableMfa = async () => {
    if (!window.confirm("Disable two-factor authentication and sign out every device?")) return;
    setMfaBusy("disable");
    try {
      await postJson("/api/auth/mfa/disable", { currentPassword: mfaManagePassword, code: mfaManageCode });
      toast.success("Two-factor authentication disabled. Please sign in again.");
      await signOut();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setMfaBusy("");
    }
  };

  const regenerateRecoveryCodes = async () => {
    setMfaBusy("recovery");
    try {
      const data = await postJson("/api/auth/mfa/recovery-codes", { currentPassword: mfaManagePassword, code: mfaManageCode });
      setRecoveryCodes(data.recoveryCodes || []);
      setMfaManageCode("");
      toast.success("New recovery codes generated. Previous codes are no longer valid.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setMfaBusy("");
    }
  };

  const copyRecoveryCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      toast.success("Recovery codes copied.");
    } catch {
      toast.error("Copy failed. Save the codes manually.");
    }
  };

  const toggleVisibility = (field) => setVisibility((current) => ({ ...current, [field]: !current[field] }));

  return (
    <div className="space-y-6">
      <HeroHeader icon={Shield} title="Security" badge="Settings" description="Manage your password, session access, and authentication methods." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base font-semibold"><Key className="h-4 w-4 text-primary" /> Change Password</CardTitle><CardDescription>Use a new password you do not use anywhere else. You will be signed out after it is changed.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <PasswordField id="currentPassword" name="currentPassword" label="Current Password" value={form.currentPassword} onChange={handleChange} visible={visibility.currentPassword} onToggle={() => toggleVisibility("currentPassword")} inputRef={registerField("currentPassword")} autoComplete="current-password" invalid={currentPasswordError.invalid} describedBy={currentPasswordError.error ? "currentPassword-help currentPassword-error" : "currentPassword-help"} help="Required to confirm this change." error={currentPasswordError.error} />
              <PasswordField id="newPassword" name="newPassword" label="New Password" value={form.newPassword} onChange={handleChange} visible={visibility.newPassword} onToggle={() => toggleVisibility("newPassword")} inputRef={registerField("newPassword")} autoComplete="new-password" invalid={newPasswordError.invalid} describedBy={newPasswordError.error ? "password-requirements newPassword-error" : "password-requirements"} error={newPasswordError.error} />
              <ul id="password-requirements" aria-label="Password requirements" className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg border border-border bg-hover/30 p-3 text-xs text-foreground-muted sm:grid-cols-2">{passwordRequirements.map(({ label, valid }) => <li key={label} className={cn("flex items-center gap-1.5", valid && "text-success-700")}>{valid ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <Circle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}<span>{label}</span></li>)}</ul>
              <PasswordField id="confirmPassword" name="confirmPassword" label="Confirm New Password" value={form.confirmPassword} onChange={handleChange} visible={visibility.confirmPassword} onToggle={() => toggleVisibility("confirmPassword")} inputRef={registerField("confirmPassword")} autoComplete="new-password" invalid={confirmPasswordError.invalid} describedBy={confirmPasswordError.error ? "confirmPassword-error" : undefined} error={confirmPasswordError.error} />
              <div className="flex flex-col items-start gap-2 pt-1"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}{saving ? "Updating..." : "Update Password"}</Button><p className="text-xs text-foreground-muted">Updating your password revokes existing web and mobile sessions.</p></div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base font-semibold"><Smartphone className="h-4 w-4 text-primary" /> Two-Factor Authentication</CardTitle><CardDescription>Use an authenticator app as a second sign-in step for web and driver mobile access.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {mfaLoading ? <div className="flex items-center gap-2 text-sm text-foreground-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading factor status...</div> : mfa.enabled ? <>
              <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-bg/40 p-3"><ShieldCheck className="h-8 w-8 text-success" /><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">2FA Status</p><Badge variant="success">Enabled</Badge></div><p className="mt-1 text-xs text-foreground-muted">Authenticator codes are required at the next web or mobile login.</p></div></div>
              {recoveryCodes.length > 0 && <div className="space-y-3 rounded-lg border border-warning/40 bg-warning-bg/40 p-4"><div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><p className="text-sm font-medium">Save these recovery codes now</p></div><p className="text-xs text-foreground-secondary">They are shown once and replace any previous recovery codes.</p><div className="grid grid-cols-2 gap-2 rounded-md bg-background/70 p-3 font-mono text-xs text-foreground sm:grid-cols-3">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={copyRecoveryCodes}><Clipboard className="mr-2 h-3.5 w-3.5" />Copy codes</Button><Button type="button" size="sm" onClick={signOut}><LogOut className="mr-2 h-3.5 w-3.5" />Continue to sign in</Button></div></div>}
              <div className="space-y-3 border-t border-border pt-4"><p className="text-sm font-medium">Manage factor</p><p className="text-xs text-foreground-muted">Enter your current password and a current authenticator code. Disabling 2FA signs out every device.</p><PasswordField id="mfa-manage-password" name="mfaManagePassword" label="Current password" value={mfaManagePassword} onChange={(e) => setMfaManagePassword(e.target.value)} visible={visibility.mfaManagePassword} onToggle={() => toggleVisibility("mfaManagePassword")} autoComplete="current-password" /><Input inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit authenticator code" value={mfaManageCode} onChange={(e) => setMfaManageCode(e.target.value)} /><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={Boolean(mfaBusy)} onClick={regenerateRecoveryCodes}>{mfaBusy === "recovery" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Regenerate recovery codes</Button><Button type="button" variant="destructive" disabled={Boolean(mfaBusy)} onClick={disableMfa}>{mfaBusy === "disable" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shield className="mr-2 h-4 w-4" />}Disable 2FA</Button></div></div>
            </> : mfaSetup ? <div className="space-y-4"><div className="flex flex-col gap-4 rounded-lg border border-border bg-hover/20 p-4 sm:flex-row sm:items-center"><img src={mfaSetup.qrCode} alt="Scan this QR code with an authenticator app" className="h-44 w-44 rounded-md bg-white p-2" /><div className="space-y-2 text-sm text-foreground-secondary"><p className="font-medium text-foreground">Scan with your authenticator app</p><p className="text-xs">If scanning is unavailable, enter this setup key manually:</p><code className="block break-all rounded bg-background p-2 text-xs text-foreground">{mfaSetup.manualKey}</code><p className="text-xs text-foreground-muted">Setup expires at {formatDate(mfaSetup.expiresAt)}.</p></div></div><div className="space-y-2"><label htmlFor="mfa-confirm-code" className="text-sm text-foreground-secondary">Confirm with a code</label><Input id="mfa-confirm-code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit authenticator code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} /></div><div className="flex flex-wrap gap-2"><Button type="button" disabled={mfaBusy === "confirm" || !mfaCode} onClick={confirmMfa}>{mfaBusy === "confirm" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enable 2FA</Button><Button type="button" variant="ghost" disabled={Boolean(mfaBusy)} onClick={() => setMfaSetup(null)}>Cancel</Button></div></div> : <><div className="flex items-start gap-3 rounded-lg border border-border bg-hover/30 p-3"><Shield className="h-8 w-8 text-foreground-muted" /><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">2FA Status</p><Badge variant="secondary">Not configured</Badge></div><p className="mt-1 text-xs text-foreground-muted">Protect both browser and driver app sign-ins with an authenticator.</p></div></div><div className="space-y-3"><PasswordField id="mfa-setup-password" name="mfaSetupPassword" label="Current password" value={mfaSetupPassword} onChange={(e) => setMfaSetupPassword(e.target.value)} visible={visibility.mfaSetupPassword} onToggle={() => toggleVisibility("mfaSetupPassword")} autoComplete="current-password" /><Button type="button" disabled={mfaBusy === "setup" || !mfaSetupPassword} onClick={startMfaSetup}>{mfaBusy === "setup" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Set up authenticator</Button></div></>}
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base font-semibold"><MonitorSmartphone className="h-4 w-4 text-primary" /> Session Management</CardTitle><CardDescription>Review active browser and driver-app sessions. Revoking a session takes effect immediately.</CardDescription></div><Button type="button" size="sm" variant="outline" disabled={Boolean(revoking) || sessionsLoading} onClick={revokeOthers}>{revoking === "others" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}Sign out all other sessions</Button></div></CardHeader>
        <CardContent className="space-y-4">{sessionsError && <div role="alert" className="flex items-center gap-2 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger"><AlertCircle className="h-4 w-4 shrink-0" />{sessionsError}</div>}{sessionsLoading ? <div className="flex items-center gap-2 text-sm text-foreground-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading active sessions...</div> : sessions.length === 0 ? <p className="text-sm text-foreground-muted">No active sessions were found.</p> : <ul className="divide-y divide-border rounded-lg border border-border">{sessions.map((session) => { const Icon = session.kind === "mobile" ? Smartphone : MonitorSmartphone; return <li key={`${session.kind}-${session.id}`} className="flex items-center gap-3 p-3"><Icon className="h-5 w-5 shrink-0 text-foreground-muted" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium text-foreground">{session.device}</p>{session.current && <Badge variant="info" size="sm">Current</Badge>}</div><p className="mt-1 text-xs text-foreground-muted">{session.kind === "mobile" ? "Driver app" : "Web browser"}{session.ipAddress ? ` · ${session.ipAddress}` : ""} · Last active {formatDate(session.lastActiveAt)}</p><p className="text-xs text-foreground-muted">Signed in {formatDate(session.createdAt)} · Expires {formatDate(session.expiresAt)}</p></div><Button type="button" variant="ghost" size="sm" disabled={Boolean(revoking)} onClick={() => revokeSession(session)}>{revoking === session.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign out"}</Button></li>; })}</ul>}<p className="text-xs text-foreground-muted">Password, email, role, and account-status changes revoke all sessions automatically.</p></CardContent>
      </Card>
    </div>
  );
}
