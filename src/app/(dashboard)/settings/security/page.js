"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Lock,
  LogOut,
  Monitor,
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
import { CapsLockHint, useCapsLock } from "@/components/ui/caps-lock-hint";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------
   Brand SVG Icons for Supported Authenticators & Browsers
------------------------------------------------------------------------- */

function GoogleAuthIcon({ className = "h-7 w-7 sm:h-8 sm:w-8 shrink-0" }) {
  return (
    <svg className={className} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#1A73E8"
        d="M440 256c0 17.121-13.879 31-31 31H302l-46-93.01 49.651-85.995c8.56-14.826 27.518-19.907 42.345-11.347l.006.003c14.828 8.56 19.909 27.52 11.348 42.347L309.7 225H409c17.121 0 31 13.879 31 31Z"
      />
      <path
        fill="#EA4335"
        d="m348.002 415.349-.006.003c-14.827 8.559-33.785 3.479-42.345-11.347L256 318.01l-49.651 85.995c-8.56 14.826-27.518 19.907-42.345 11.347l-.006-.003c-14.828-8.56-19.909-27.519-11.348-42.347L202.3 287l53.7-2 53.7 2 49.65 86.002c8.56 14.828 3.48 33.787-11.348 42.347Z"
      />
      <path
        fill="#FBBC04"
        d="M256 193.99 242 232l-39.7-7-49.65-86.002c-8.56-14.828-3.479-33.787 11.348-42.347l.006-.003c14.827-8.559 33.785-3.479 42.345 11.347L256 193.99Z"
      />
      <path fill="#34A853" d="m248 225-36 62H103c-17.121 0-31-13.879-31-31s13.879-31 31-31h145Z" />
      <path fill="#185DB7" d="M309.7 287H202.3l53.7-93.01L309.7 287Z" />
    </svg>
  );
}

function MicrosoftAuthIcon({ className = "h-7 w-7 sm:h-8 sm:w-8 shrink-0" }) {
  return (
    <Image
      src="/brands/authenticators/microsoft.png"
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      className={cn("object-contain", className)}
      unoptimized
    />
  );
}

function AuthyIcon({ className = "h-7 w-7 sm:h-8 sm:w-8 shrink-0" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="12" fill="#EC1C24" />
      <path
        fill="#FFFFFF"
        d="M15.42 5.338c.274 0 .551.105.769.315l2.862 2.862c2.054 2.039 2.084 5.35.105 7.449a.21.21 0 0 1-.045.06l-.03.03-.03.03c-.015.015-.045.03-.06.045-2.098 1.978-5.41 1.948-7.463-.105l-2.863-2.863a1.05 1.05 0 0 1 0-1.499 1.05 1.05 0 0 1 1.5 0l2.861 2.863a3.23 3.23 0 0 0 4.542.03 3.244 3.244 0 0 0-.03-4.541l-2.863-2.862a1.05 1.05 0 0 1 0-1.5c.203-.209.472-.314.746-.314zM8.758 6.397a5.33 5.33 0 0 1 3.715 1.564l2.863 2.862c.42.42.42 1.08 0 1.5-.42.419-1.08.419-1.5 0L10.975 9.46a3.249 3.249 0 0 0-4.558-.015 3.243 3.243 0 0 0 .03 4.54l2.863 2.863c.42.42.42 1.08 0 1.499a1.05 1.05 0 0 1-1.499 0L4.95 15.484c-2.054-2.053-2.084-5.365-.105-7.463.015-.03.03-.045.045-.06l.03-.03.03-.03c.015-.015.045-.03.06-.045a5.355 5.355 0 0 1 3.748-1.46z"
      />
    </svg>
  );
}

function OnePasswordIcon({ className = "h-7 w-7 sm:h-8 sm:w-8 shrink-0" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="12" fill="#0A85EA" />
      <path
        fill="#FFFFFF"
        d="M11.107 4.86c-.485 0-.727.001-.913.095a.87.87 0 0 0-.378.379c-.094.185-.095.428-.095.912v2.747c0 .12 0 .182.016.238q.02.075.065.138a1 1 0 0 0 .175.162l.695.564c.113.092.17.139.19.194a.22.22 0 0 1 0 .15c-.02.056-.077.102-.19.194l-.695.564a1 1 0 0 0-.175.162.4.4 0 0 0-.065.138 1 1 0 0 0-.016.238v6.019c0 .485 0 .728.095.913a.87.87 0 0 0 .378.378c.186.094.428.094.913.094h1.786c.485 0 .727 0 .913-.094a.87.87 0 0 0 .378-.378c.095-.185.095-.428.095-.913v-2.747c0-.12 0-.182-.016-.238a.4.4 0 0 0-.065-.138 1 1 0 0 0-.175-.162l-.695-.564c-.113-.092-.17-.138-.191-.193a.22.22 0 0 1 0-.152c.02-.055.078-.1.19-.193l.696-.564a1 1 0 0 0 .175-.162.4.4 0 0 0 .065-.138 1 1 0 0 0 .016-.238V6.246c0-.484 0-.727-.095-.912a.87.87 0 0 0-.378-.379c-.186-.094-.428-.094-.913-.094Z"
      />
    </svg>
  );
}

function ChromeBrandIcon({ className = "h-10 w-10 sm:h-11 sm:w-11 shrink-0" }) {
  return (
    <Image
      src="/brands/browsers/chrome.svg"
      alt=""
      aria-hidden="true"
      width={44}
      height={44}
      className={cn("object-contain shrink-0", className)}
      unoptimized
    />
  );
}

function BrowserIcon({ device = "", kind = "web", className = "h-10 w-10 sm:h-11 sm:w-11 shrink-0" }) {
  if (kind === "mobile") {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400", className)}>
        <Smartphone className="h-5 w-5" />
      </div>
    );
  }
  const d = String(device || "").toLowerCase();
  if (d.includes("chrome")) {
    return <ChromeBrandIcon className={className} />;
  }
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400", className)}>
      <Monitor className="h-5 w-5" />
    </div>
  );
}

/* -------------------------------------------------------------------------
   Validation Schema & Helpers
------------------------------------------------------------------------- */

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
    if (value !== values.newPassword) return "Passwords do not match yet.";
    return null;
  },
};

const CORE_REQUIREMENTS = [
  { label: "At least 8 characters", valid: (v) => v.length >= 8 },
  { label: "An uppercase letter", valid: hasPasswordUppercase },
  { label: "A number", valid: hasPasswordNumber },
  { label: "A special character", valid: hasPasswordSpecial },
];

function utf8Length(value) {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

const STRENGTH_META = {
  0: { label: "", color: "text-slate-400", bar: "bg-slate-100 dark:bg-slate-800" },
  1: { label: "Weak", color: "text-red-500", bar: "bg-red-500" },
  2: { label: "Fair", color: "text-amber-500", bar: "bg-amber-500" },
  3: { label: "Good", color: "text-blue-600 dark:text-blue-400", bar: "bg-blue-600 dark:bg-blue-500" },
  4: { label: "Strong", color: "text-emerald-600 dark:text-emerald-500", bar: "bg-emerald-600 dark:bg-emerald-500" },
};

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

/* -------------------------------------------------------------------------
   Subcomponents
------------------------------------------------------------------------- */

function SectionHeader({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/50 border border-sky-100 dark:border-sky-900/40 text-sky-600 dark:text-sky-400">
          <Icon aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={1.8} />
        </span>
        <div className="pt-0.5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight leading-tight">
            {title}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-[54ch]">
            {description}
          </p>
        </div>
      </div>
      {action && <div className="shrink-0 self-start sm:self-auto">{action}</div>}
    </div>
  );
}

function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  visible,
  onToggle,
  inputRef,
  autoComplete,
  invalid,
  placeholder,
  help,
  error,
}) {
  const { active: capsActive, bind } = useCapsLock();

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
        {label}
      </label>
      <div className="relative">
        <Lock
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          strokeWidth={1.75}
        />
        <input
          id={id}
          name={name}
          autoComplete={autoComplete}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          ref={inputRef}
          placeholder={placeholder}
          className={cn(
            "flex h-11 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 pl-10 pr-10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all shadow-2xs",
            invalid && "caps-field-active !border-rose-400 dark:!border-rose-500 focus-visible:!border-rose-400 focus-visible:!ring-rose-400/20",
            capsActive && "caps-field-active !border-rose-400 dark:!border-rose-500 focus-visible:!border-rose-400 focus-visible:!ring-rose-400/20"
          )}
          {...bind}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <Eye className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      </div>
      <CapsLockHint on={capsActive} />
      {help && <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-1">{help}</p>}
      {error && <p role="alert" className="text-xs text-red-500 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function AuthenticatorApps() {
  return (
    <div className="mt-6 pt-1">
      <p className="text-xs font-semibold text-slate-900 dark:text-white">Supported Authenticator Apps</p>
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-4 sm:gap-5">
        <div className="flex items-center gap-2.5">
          <GoogleAuthIcon className="h-7 w-7 sm:h-8 sm:w-8 shrink-0" />
          <div className="flex flex-col text-[11px] sm:text-xs font-medium leading-tight text-slate-700 dark:text-slate-300">
            <span>Google</span>
            <span>Authenticator</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <MicrosoftAuthIcon className="h-7 w-7 sm:h-8 sm:w-8 shrink-0" />
          <div className="flex flex-col text-[11px] sm:text-xs font-medium leading-tight text-slate-700 dark:text-slate-300">
            <span>Microsoft</span>
            <span>Authenticator</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <AuthyIcon className="h-7 w-7 sm:h-8 sm:w-8 shrink-0" />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Authy</span>
        </div>

        <div className="flex items-center gap-2.5">
          <OnePasswordIcon className="h-7 w-7 sm:h-8 sm:w-8 shrink-0" />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">1Password</span>
        </div>
      </div>
      <p className="mt-4 text-[12px] text-slate-400 dark:text-slate-500">
        Scan the QR code with your preferred authenticator app during setup.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Main Security Settings Component
------------------------------------------------------------------------- */

export default function SecurityPage() {
  const { signOut } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const [visibility, setVisibility] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
    mfaSetupPassword: false,
    mfaManagePassword: false,
  });
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

  const passwordRequirements = CORE_REQUIREMENTS.map(({ label, valid }) => ({
    label,
    valid: valid(form.newPassword),
  }));
  const score = CORE_REQUIREMENTS.filter((r) => r.valid(form.newPassword)).length;
  const strengthMeta = STRENGTH_META[score] || STRENGTH_META[0];

  const byteLen = utf8Length(form.newPassword);
  const showByteRule = form.newPassword.length > 0 && (byteLen > 64 || !isPasswordByteLengthAllowed(form.newPassword));
  const byteValid = isPasswordByteLengthAllowed(form.newPassword);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sessionsResponse, mfaResponse] = await Promise.all([
          fetch("/api/auth/sessions", { cache: "no-store" }),
          fetch("/api/auth/mfa", { cache: "no-store" }),
        ]);
        const [sessionData, mfaData] = await Promise.all([
          sessionsResponse.json().catch(() => ({})),
          mfaResponse.json().catch(() => ({})),
        ]);
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
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (e) => setForm((current) => ({ ...current, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const isValid = validate(form, {
      onSuccess: async () => {
        setSaving(true);
        try {
          const response = await fetch("/api/auth/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
          });
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
    <div className="space-y-4">
      {/* Top 2-Column Section */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Card 1: Change Password */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-border/60 bg-white dark:bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.03)] p-6 sm:p-7 flex flex-col justify-between">
          <div>
            <SectionHeader
              icon={Key}
              title="Change Password"
              description="Use a new password you do not use anywhere else. You will be signed out after it is changed."
            />

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <PasswordField
                id="currentPassword"
                name="currentPassword"
                label="Current Password"
                value={form.currentPassword}
                onChange={handleChange}
                visible={visibility.currentPassword}
                onToggle={() => toggleVisibility("currentPassword")}
                inputRef={registerField("currentPassword")}
                autoComplete="current-password"
                invalid={currentPasswordError.invalid}
                help="Required to confirm this change."
                error={currentPasswordError.error}
              />

              <PasswordField
                id="newPassword"
                name="newPassword"
                label="New Password"
                value={form.newPassword}
                onChange={handleChange}
                visible={visibility.newPassword}
                onToggle={() => toggleVisibility("newPassword")}
                inputRef={registerField("newPassword")}
                autoComplete="new-password"
                invalid={newPasswordError.invalid}
                error={newPasswordError.error}
              />

              {/* Segmented Password Strength Bar */}
              <div className="space-y-2 mt-3.5" aria-live="polite">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Password strength</p>
                  {form.newPassword && (
                    <p className={cn("text-xs font-semibold tabular-nums", strengthMeta.color)}>
                      {strengthMeta.label}
                    </p>
                  )}
                </div>
                <div className="flex gap-2" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.5 flex-1 rounded-full transition-all duration-200",
                        form.newPassword && i < score ? strengthMeta.bar : "bg-slate-100 dark:bg-slate-800"
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Requirement Checklist Box */}
              <ul
                id="password-requirements"
                aria-label="Password requirements"
                className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/40 p-3.5 sm:p-4"
              >
                {passwordRequirements.map(({ label, valid }) => (
                  <li key={label} className="flex items-center gap-2">
                    {valid ? (
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 dark:bg-emerald-500 text-white">
                        <Check className="h-2.5 w-2.5 stroke-[3]" />
                      </span>
                    ) : (
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-300 dark:border-slate-600" />
                    )}
                    <span className="text-xs text-slate-600 dark:text-slate-300 font-normal">{label}</span>
                  </li>
                ))}
                {showByteRule && (
                  <li className="flex items-center gap-2 sm:col-span-2 text-xs">
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                        byteValid ? "border border-slate-300 dark:border-slate-600" : "bg-red-500 text-white"
                      )}
                    >
                      {byteValid ? null : <AlertCircle className="h-3 w-3" />}
                    </span>
                    <span className={byteValid ? "text-slate-600 dark:text-slate-400" : "text-red-600 dark:text-red-400 font-medium"}>
                      Within 72 bytes ({byteLen} used)
                    </span>
                  </li>
                )}
              </ul>

              <PasswordField
                id="confirmPassword"
                name="confirmPassword"
                label="Confirm New Password"
                value={form.confirmPassword}
                onChange={handleChange}
                visible={visibility.confirmPassword}
                onToggle={() => toggleVisibility("confirmPassword")}
                inputRef={registerField("confirmPassword")}
                autoComplete="new-password"
                invalid={confirmPasswordError.invalid || (Boolean(form.confirmPassword) && form.newPassword !== form.confirmPassword)}
              />

              {/* Inline Passwords Match / Mismatch Speech-Notch Hint */}
              {form.confirmPassword && (
                form.newPassword === form.confirmPassword ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="relative mt-1.5 inline-flex max-w-full items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/90 dark:border-emerald-900/50 dark:bg-[#0c2419] p-1.5 pr-3 text-xs shadow-2xs select-none caps-hint-enter"
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -top-1 left-[18px] h-2.5 w-2.5 rotate-45 border-l border-t border-emerald-200/80 bg-emerald-50 dark:border-emerald-900/50 dark:bg-[#0c2419]"
                    />
                    <span
                      aria-hidden="true"
                      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white shadow-2xs select-none"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 stroke-[2.5]" />
                    </span>
                    <span className="relative font-medium text-emerald-700 dark:text-emerald-400 select-none">
                      Passwords match.
                    </span>
                  </div>
                ) : (
                  <div
                    role="status"
                    aria-live="polite"
                    className="caps-hint-bubble relative mt-1.5 inline-flex max-w-full items-center gap-2 rounded-xl border p-1.5 pr-3 text-xs shadow-2xs select-none caps-hint-enter"
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -top-1 left-[18px] h-2.5 w-2.5 rotate-45 border-l border-t border-[inherit] bg-[inherit]"
                    />
                    <span
                      aria-hidden="true"
                      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-rose-500 text-white shadow-2xs select-none"
                    >
                      <AlertCircle className="h-3.5 w-3.5 stroke-[2.5]" />
                    </span>
                    <span className="relative font-medium text-rose-600 dark:text-rose-400 select-none">
                      Passwords do not match yet.
                    </span>
                  </div>
                )
              )}
              {confirmPasswordError.error && !form.confirmPassword && (
                <p role="alert" className="text-xs text-red-500 dark:text-red-400 mt-1.5">
                  {confirmPasswordError.error}
                </p>
              )}

              {/* Update Password Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[#0f172a] hover:bg-[#1e293b] text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-sm font-medium transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="mr-2 h-4 w-4" strokeWidth={2} />
                  )}
                  <span>{saving ? "Updating..." : "Update Password"}</span>
                  {!saving && <ChevronRight className="ml-2 h-4 w-4 stroke-[2.5]" />}
                </button>
                <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-2.5">
                  Updating your password revokes existing web and mobile sessions.
                </p>
              </div>
            </form>
          </div>
        </div>

        {/* Card 2: Two-Factor Authentication */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-border/60 bg-white dark:bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.03)] p-6 sm:p-7 flex flex-col justify-between">
          <div>
            <SectionHeader
              icon={Smartphone}
              title="Two-Factor Authentication"
              description="Use an authenticator app as a second sign-in step for web and driver mobile access."
            />

            {/* 2FA Status Panel */}
            <div
              className={cn(
                "flex items-start gap-3.5 rounded-xl border p-4 transition-colors",
                mfa.enabled
                  ? "border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20"
                  : mfa.setupPending
                    ? "border-amber-100 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20"
                    : "border-sky-100/90 dark:border-sky-900/40 bg-gradient-to-r from-sky-50/70 via-slate-50/40 to-sky-50/30 dark:from-slate-900/60 dark:to-slate-900/30"
              )}
            >
              <Shield
                aria-hidden="true"
                className={cn(
                  "h-6 w-6 shrink-0 stroke-[1.5] mt-0.5",
                  mfa.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"
                )}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">2FA Status</span>
                  <span
                    className={cn(
                      "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium",
                      mfa.enabled
                        ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
                        : mfa.setupPending
                          ? "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300"
                          : "bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                    )}
                  >
                    {mfa.enabled ? "Enabled" : mfa.setupPending ? "Setup pending" : "Not configured"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {mfa.enabled
                    ? "Authenticator codes are required at the next web or mobile login."
                    : mfa.setupPending
                      ? "Enrollment was started but has not been confirmed with an authenticator code."
                      : "Protect both browser and driver app sign-ins with an authenticator."}
                </p>
              </div>
            </div>

            {mfaLoading ? (
              <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 p-4" role="status">
                <span className="sr-only">Loading factor status...</span>
                <div className="animate-pulse space-y-2">
                  <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-3 w-3/4 rounded bg-slate-200/70 dark:bg-slate-800/70" />
                </div>
              </div>
            ) : mfa.enabled ? (
              /* State: 2FA Enabled -> Manage factor */
              <div className="mt-5 space-y-4">
                {recoveryCodes.length > 0 && (
                  <div className="space-y-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 p-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">Save these recovery codes now</p>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      They are shown once and replace any previous recovery codes.
                    </p>
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-white dark:bg-slate-900 p-3 font-mono text-xs text-slate-800 dark:text-slate-200 border border-amber-200/40 sm:grid-cols-3">
                      {recoveryCodes.map((code) => (
                        <code key={code}>{code}</code>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={copyRecoveryCodes}
                        className="inline-flex items-center h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <Clipboard className="mr-1.5 h-3.5 w-3.5" />
                        Copy codes
                      </button>
                      <button
                        type="button"
                        onClick={signOut}
                        className="inline-flex items-center h-8 px-3 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors"
                      >
                        <LogOut className="mr-1.5 h-3.5 w-3.5" />
                        Continue to sign in
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Manage factor</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Enter your current password and a current authenticator code. Disabling 2FA signs out every device.
                    </p>
                  </div>
                  <PasswordField
                    id="mfa-manage-password"
                    name="mfaManagePassword"
                    label="Current password"
                    value={mfaManagePassword}
                    onChange={(e) => setMfaManagePassword(e.target.value)}
                    visible={visibility.mfaManagePassword}
                    onToggle={() => toggleVisibility("mfaManagePassword")}
                    autoComplete="current-password"
                  />
                  <div className="space-y-1.5">
                    <label htmlFor="mfa-manage-code" className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Authenticator code
                    </label>
                    <input
                      id="mfa-manage-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit authenticator code"
                      value={mfaManageCode}
                      onChange={(e) => setMfaManageCode(e.target.value)}
                      className="flex h-11 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 px-3.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all shadow-2xs"
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap pt-1">
                    <button
                      type="button"
                      disabled={Boolean(mfaBusy)}
                      onClick={regenerateRecoveryCodes}
                      className="inline-flex items-center justify-center h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs disabled:opacity-50"
                    >
                      {mfaBusy === "recovery" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Regenerate recovery codes
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(mfaBusy)}
                      onClick={disableMfa}
                      className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/30 text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {mfaBusy === "disable" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shield className="mr-2 h-4 w-4" />}
                      Disable 2FA
                    </button>
                  </div>
                </div>
              </div>
            ) : mfaSetup ? (
              /* State: Setup in progress with QR code */
              <div className="mt-5 space-y-4">
                <div className="flex flex-col gap-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-4 sm:flex-row sm:items-center">
                  <Image
                    src={mfaSetup.qrCode}
                    alt="Scan this QR code with an authenticator app"
                    width={144}
                    height={144}
                    unoptimized
                    className="h-36 w-36 self-center rounded-lg bg-white p-2 border border-slate-200 shadow-2xs"
                  />
                  <div className="min-w-0 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                    <p className="font-semibold text-slate-900 dark:text-white text-xs">Scan with your authenticator app</p>
                    <p className="text-xs text-slate-500">If scanning is unavailable, enter this key manually:</p>
                    <code className="block break-all rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 font-mono text-xs text-slate-900 dark:text-white">
                      {mfaSetup.manualKey}
                    </code>
                    <p className="text-[11px] text-slate-400">Setup expires at {formatDate(mfaSetup.expiresAt)}.</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="mfa-confirm-code" className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Confirm with a code
                  </label>
                  <input
                    id="mfa-confirm-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6-digit authenticator code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="flex h-11 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 px-3.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all shadow-2xs"
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={mfaBusy === "confirm" || !mfaCode}
                    onClick={confirmMfa}
                    className="inline-flex items-center justify-center h-10 px-5 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {mfaBusy === "confirm" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Enable 2FA
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(mfaBusy)}
                    onClick={() => setMfaSetup(null)}
                    className="inline-flex items-center justify-center h-10 px-4 rounded-xl border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* State: 2FA Not Configured */
              <div className="mt-4 space-y-4">
                <PasswordField
                  id="mfa-setup-password"
                  name="mfaSetupPassword"
                  label="Current password"
                  value={mfaSetupPassword}
                  onChange={(e) => setMfaSetupPassword(e.target.value)}
                  visible={visibility.mfaSetupPassword}
                  onToggle={() => toggleVisibility("mfaSetupPassword")}
                  autoComplete="current-password"
                  placeholder="Enter your current password"
                />

                <div>
                  <button
                    type="button"
                    disabled={mfaBusy === "setup" || !mfaSetupPassword}
                    onClick={startMfaSetup}
                    className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[#475569] hover:bg-[#334155] text-white dark:bg-slate-700 dark:hover:bg-slate-600 text-sm font-medium transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {mfaBusy === "setup" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    <span>{mfaBusy === "setup" ? "Preparing setup..." : "Set up authenticator"}</span>
                    {mfaBusy !== "setup" && <ChevronRight className="ml-2 h-4 w-4 stroke-[2.5]" />}
                  </button>
                </div>

                <AuthenticatorApps />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Full-Width Section: Session Management */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-border/60 bg-white dark:bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.03)] p-6 sm:p-7">
        <SectionHeader
          icon={Monitor}
          title="Session Management"
          description="Review active browser and driver-app sessions. Revoking a session takes effect immediately."
          action={
            <button
              type="button"
              disabled={Boolean(revoking) || sessionsLoading}
              onClick={revokeOthers}
              className="inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer shrink-0"
            >
              {revoking === "others" ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-600" />
              ) : (
                <LogOut className="h-4 w-4 text-slate-600 dark:text-slate-400" strokeWidth={1.75} />
              )}
              <span>Sign out all other sessions</span>
            </button>
          }
        />

        <div className="space-y-3" aria-busy={sessionsLoading}>
          {sessionsError && (
            <div role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 p-3.5 text-xs text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              <span>{sessionsError}</span>
            </div>
          )}

          {sessionsLoading ? (
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-5" role="status">
              <span className="sr-only">Loading active sessions...</span>
              <div className="flex items-center gap-4 animate-pulse">
                <div className="h-9 w-9 shrink-0 rounded-full bg-slate-200 dark:bg-slate-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-48 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-3 w-64 rounded bg-slate-200/70 dark:bg-slate-800/70" />
                </div>
              </div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-slate-400 justify-center">
              <Monitor className="h-5 w-5" />
              <p className="text-sm">No active sessions were found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => {
                const isCurrent = session.current || session.is_current;

                return (
                  <div
                    key={`${session.kind}-${session.id}`}
                    className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/30 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <BrowserIcon device={session.device} kind={session.kind} className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                            {session.device}
                          </p>
                          {isCurrent && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-sky-50 text-sky-600 border border-sky-100 dark:bg-sky-950/60 dark:text-sky-400 dark:border-sky-900/50">
                              Current Device
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 mt-1">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0 inline-block" />
                          <span>{session.location || "Unknown Location"}</span>
                        </div>

                        <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-1">
                          {session.kind === "mobile" ? "Driver app" : "Web browser"}
                          {session.ipAddress ? ` • IP: ${session.ipAddress}` : ""}
                          {` • Last active ${formatDate(session.lastActiveAt)}`}
                        </p>

                        <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">
                          Signed in on {formatDate(session.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        disabled={Boolean(revoking)}
                        onClick={() => revokeSession(session)}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 text-xs font-semibold transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        {revoking === session.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LogOut className="h-3.5 w-3.5 text-red-500" />
                        )}
                        <span>{revoking === session.id ? "Signing out..." : "Sign out"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
