"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
} from "framer-motion";
import { signIn } from "@/services/auth.service";
import { getSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  ArrowRight,
  CarFront,
  Eye,
  EyeOff,
  Gauge,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Navigation,
  ShieldCheck,
} from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { cn } from "@/lib/utils";

const loginSchema = {
  email: { required: true, type: "email", label: "Email" },
  password: { required: true, label: "Password" },
};

const EASE = [0.32, 0.72, 0, 1];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.75, ease: EASE },
  },
};

function BrandMark({ className }) {
  return (
    <div
      className={cn(
        "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.1rem] bg-primary text-primary-bg",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_24px_-12px_rgba(0,0,0,0.4)]",
        className
      )}
    >
      <CarFront className="h-[22px] w-[22px]" strokeWidth={1.75} />
    </div>
  );
}

function RouteGraphic() {
  const routePathRef = useRef(null);

  return (
    <svg
      viewBox="0 0 480 260"
      fill="none"
      aria-hidden="true"
      className="mt-9 w-full max-w-[26rem]"
    >
      <defs>
        <linearGradient id="route-primary" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="route-sub" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.08" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0.3" />
        </linearGradient>
      </defs>

      <motion.path
        d="M 24 140 C 96 150, 150 214, 228 208 C 316 201, 350 70, 452 44"
        stroke="url(#route-sub)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 8"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.6, delay: 0.9, ease: EASE }}
      />

      <motion.path
        ref={routePathRef}
        d="M 14 196 C 84 204, 96 96, 186 96 C 276 96, 264 198, 356 196 C 408 195, 446 152, 460 88"
        stroke="url(#route-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.9, delay: 0.55, ease: EASE }}
      />

      <motion.circle
        cx="14"
        cy="196"
        r="5"
        fill="var(--primary)"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 1.9, ease: EASE }}
      />
      <motion.circle
        cx="14"
        cy="196"
        r="5"
        fill="none"
        stroke="var(--primary)"
        strokeOpacity="0.35"
        animate={{ scale: [1, 2.6], opacity: [0.6, 0] }}
        transition={{ duration: 2.6, delay: 2, repeat: Infinity, ease: "easeOut" }}
      />

      <motion.circle
        cx="186"
        cy="96"
        r="4.5"
        fill="var(--sf)"
        stroke="var(--primary)"
        strokeWidth="2"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 2.15, ease: EASE }}
      />
      <motion.circle
        cx="356"
        cy="196"
        r="4.5"
        fill="var(--sf)"
        stroke="var(--primary)"
        strokeWidth="2"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 2.3, ease: EASE }}
      />

      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 2.45, ease: EASE }}
      >
        <circle
          cx="460"
          cy="88"
          r="10"
          fill="none"
          stroke="var(--primary)"
          strokeOpacity="0.25"
          strokeWidth="1.5"
        />
        <circle cx="460" cy="88" r="5" fill="var(--primary)" />
      </motion.g>

      <RouteCar pathRef={routePathRef} />
    </svg>
  );
}

const CAR_APPEAR_MS = 2500;
const CAR_LOOP_MS = 7000;

function RouteCar({ pathRef }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(14);
  const y = useMotionValue(196);
  const startedAt = useRef(null);

  useAnimationFrame((now) => {
    const path = pathRef.current;
    if (reduce || !path) return;
    if (startedAt.current === null) startedAt.current = now;
    // Hold at the origin until the route finishes drawing, then loop forever.
    const raw = (now - startedAt.current - CAR_APPEAR_MS) / CAR_LOOP_MS;
    const t = raw <= 0 ? 0 : raw % 1;
    const point = path.getPointAtLength(t * path.getTotalLength());
    x.set(point.x);
    y.set(point.y);
  });

  if (reduce) return null;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, delay: CAR_APPEAR_MS / 1000, ease: EASE }}
      style={{ x, y }}
    >
      <circle r="12" fill="var(--sf)" stroke="var(--primary)" strokeWidth="2" />
      <CarFront width={14} height={14} x={-7} y={-7} color="var(--primary)" strokeWidth={2} />
    </motion.g>
  );
}

const FEATURES = [
  { icon: Navigation, label: "Dispatch orchestration" },
  { icon: Gauge, label: "Fleet readiness" },
  { icon: MapPin, label: "Trip visibility" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { validate, fieldError, registerField } = useFormValidation(loginSchema);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const values = { email, password };
    const isValid = validate(values, {
      onSuccess: async () => {
        setLoading(true);
        try {
          await signIn(email, password, { mfaCode });
          // Drivers land on their personal home; every other role gets the
          // operations dashboard.
          const session = await getSession();
          router.push(session?.user?.role === "driver" ? "/driver" : "/dashboard");
          router.refresh();
        } catch (err) {
          if (err.message === "MFA_REQUIRED") {
            setMfaRequired(true);
            setError("Enter the verification code from your authenticator app.");
            return;
          }
          if (err.message === "MFA_INVALID") {
            setMfaRequired(true);
            setError("That verification code is invalid or already used.");
            return;
          }
          if (err.message === "MFA_UNAVAILABLE") {
            setError("Two-factor authentication is temporarily unavailable. Try again later.");
            return;
          }
          // NextAuth collapses every authorize() failure (including the IP
          // throttle) into "CredentialsSignin", so a locked-out user would be
          // told their password is wrong. Check the public throttle status and
          // tell them the truth instead.
          try {
            const res = await fetch("/api/auth/login-status");
            const status = await res.json();
            if (status?.locked) {
              setError(
                `Too many login attempts from this network. Try again in ${status.retryAfterSec || 60}s.`
              );
              return;
            }
          } catch {
            // Status check is best-effort — fall back to the generic message.
          }
          setError(err.message || "Invalid email or password");
        } finally {
          setLoading(false);
        }
      },
    });
    if (!isValid) return;
  };

  const emailField = fieldError("email");
  const passwordField = fieldError("password");

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background lg:flex">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-40 -top-44 h-[38rem] w-[38rem] rounded-full bg-primary/[0.05] blur-3xl" />
        <div className="absolute -bottom-56 -left-36 h-[34rem] w-[34rem] rounded-full bg-info/[0.06] blur-3xl" />
        <div className="absolute left-[42%] top-[30%] h-80 w-80 rounded-full bg-success/[0.045] blur-3xl" />
      </div>

      <motion.aside
        variants={container}
        initial="hidden"
        animate="show"
        className="relative z-10 hidden w-[46%] shrink-0 flex-col overflow-hidden border-r border-border/70 bg-surface p-12 xl:p-16 lg:flex 2xl:p-20"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -right-28 -top-36 h-[30rem] w-[30rem] rounded-full bg-primary/[0.06] blur-3xl" />
          <div className="absolute -left-28 bottom-0 h-[26rem] w-[26rem] rounded-full bg-info/[0.07] blur-3xl" />
        </div>

        <motion.div variants={item} className="relative flex items-center gap-3.5">
          <BrandMark />
          <div>
            <p className="text-lg font-bold leading-none tracking-tight text-foreground">{APP_NAME}</p>
            <p className="mt-1.5 text-xs text-foreground-muted">Fleet Transportation Management</p>
          </div>
        </motion.div>

        <div className="relative flex flex-1 flex-col justify-center py-10">
          <motion.h1
            variants={item}
            className="max-w-lg text-[clamp(2.5rem,4.2vw,4rem)] font-bold leading-[1.02] tracking-[-0.03em] text-foreground"
          >
            Operate your fleet
            <span className="block text-foreground-muted">with total clarity.</span>
          </motion.h1>
          <motion.p
            variants={item}
            className="mt-7 max-w-md text-base leading-relaxed text-foreground-secondary"
          >
            Coordinate drivers, vehicles, and every trip, from dispatch to drop-off, in one
            intelligent command center.
          </motion.p>
          <motion.div variants={item}>
            <RouteGraphic />
          </motion.div>
        </div>

        <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <motion.ul variants={item} className="flex flex-wrap gap-2.5">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3.5 py-2 text-xs font-medium text-foreground-secondary"
              >
                <Icon className="h-3.5 w-3.5 text-foreground" strokeWidth={1.75} />
                {label}
              </li>
            ))}
          </motion.ul>
          <motion.p variants={item} className="text-xs text-foreground-muted">
            © {new Date().getFullYear()} {APP_NAME}
          </motion.p>
        </div>
      </motion.aside>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[27rem]">
          <motion.div
            initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.8, ease: EASE }}
            className="mb-10 flex items-center gap-3 lg:hidden"
          >
            <BrandMark />
            <div>
              <p className="text-lg font-bold leading-none tracking-tight text-foreground">{APP_NAME}</p>
              <p className="mt-1.5 text-xs text-foreground-muted">Fleet Transportation Management</p>
            </div>
          </motion.div>

          <motion.div variants={container} initial="hidden" animate="show">
            <motion.div
              variants={item}
              className="rounded-[1.75rem] bg-background p-1.5 shadow-[0_24px_60px_-32px_rgba(17,24,39,0.4)] ring-1 ring-black/[0.04] dark:ring-white/[0.07]"
            >
              <div className="rounded-[calc(1.75rem-0.375rem)] bg-surface px-6 py-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] sm:px-8 dark:shadow-none">
                <div className="mb-8">
                  <h2 className="text-[1.65rem] font-bold tracking-tight text-foreground">
                    Welcome back
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                    Enter your credentials to access the system.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                  <AnimatePresence initial={false}>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -8, height: 0 }}
                        transition={{ duration: 0.35, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div
                          role="alert"
                          className="flex items-start gap-2.5 rounded-[0.9rem] bg-danger-bg px-3.5 py-3 text-sm text-danger"
                        >
                          <AlertCircle className="mt-px h-4 w-4 shrink-0" strokeWidth={2} />
                          <span>{error}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-[13px] font-medium text-foreground">
                      Email
                    </Label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                        strokeWidth={1.75}
                      />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        ref={registerField("email")}
                        invalid={emailField.invalid}
                        autoComplete="email"
                        autoFocus
                        className="h-12 rounded-[0.9rem] bg-surface pl-11 text-[15px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] caret-primary focus-visible:ring-offset-surface"
                      />
                    </div>
                    {emailField.error && <p className="text-xs text-danger">{emailField.error}</p>}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-[13px] font-medium text-foreground">
                        Password
                      </Label>
                      <Link
                        href="/forgot-password"
                        className="text-xs font-medium text-foreground-muted transition-colors duration-200 hover:text-foreground"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                        strokeWidth={1.75}
                      />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        ref={registerField("password")}
                        invalid={passwordField.invalid}
                        autoComplete="current-password"
                        className="h-12 rounded-[0.9rem] bg-surface pl-11 pr-12 text-[15px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] caret-primary focus-visible:ring-offset-surface"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-foreground-muted transition-colors duration-200 hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                        ) : (
                          <Eye className="h-4 w-4" strokeWidth={1.75} />
                        )}
                      </button>
                    </div>
                    {passwordField.error && <p className="text-xs text-danger">{passwordField.error}</p>}
                  </div>

                  {mfaRequired && (
                    <div className="space-y-2">
                      <Label htmlFor="mfaCode" className="text-[13px] font-medium text-foreground">
                        Verification code
                      </Label>
                      <div className="relative">
                        <ShieldCheck
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                          strokeWidth={1.75}
                        />
                        <Input
                          id="mfaCode"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="6-digit code or recovery code"
                          value={mfaCode}
                          onChange={(e) => setMfaCode(e.target.value)}
                          className="h-12 rounded-[0.9rem] bg-surface pl-11 text-[15px] tracking-[0.12em] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] caret-primary focus-visible:ring-offset-surface"
                          autoFocus
                        />
                      </div>
                      <p className="text-xs text-foreground-muted">Use a current authenticator code or one unused recovery code.</p>
                    </div>
                  )}

<Button
                    type="submit"
                    disabled={loading}
                    className="group relative h-14 w-full overflow-hidden rounded-full bg-foreground text-[15px] font-semibold text-surface transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 hover:shadow-[0_16px_32px_-16px_rgba(0,0,0,0.45)] active:scale-[0.985] disabled:opacity-70"
                  >
                    {!loading && <span>Sign in</span>}
                    <span
                      aria-hidden={loading || undefined}
                      className={cn(
                        "absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface/20 dark:bg-black/10",
                        "transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                        loading && "pointer-events-none scale-50 opacity-0"
                      )}
                    >
                      <ArrowRight className="h-4 w-4" strokeWidth={2} />
                    </span>
                    {loading && (
                      <span className="absolute inset-0 flex items-center justify-center gap-2.5 select-none">
                        <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} /> Signing in…
                      </span>
                    )}
                  </Button>
                </form>

                <div className="mt-7 flex items-center justify-center gap-2 text-xs text-foreground-muted">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Protected by {APP_NAME} role-based security
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </main>
    </div>
    </MotionConfig>
  );
}
