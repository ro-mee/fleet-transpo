"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { createEmployeeAccount } from "@/services/auth.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { createUserSchema } from "@/lib/validation/schemas";
import { REGISTRATION_ROLES } from "@/lib/constants";
import {
  Loader2, UserPlus, CheckCircle2, Eye, EyeOff,
  ShieldCheck, Mail, Lock, User, Truck, Shield,
  Settings, Users, BarChart2, Wrench, Radio,
} from "lucide-react";
import { FloatingField } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { PageEntrance, CARD_SHADOW } from "@/components/ui/page-entrance";
import { StickyActionBar } from "@/components/ui/sticky-actions";

const ACCOUNT_ROLES = REGISTRATION_ROLES.filter((r) => r.value !== "driver");

const ROLE_META = {
  system_admin: {
    icon: Shield,
    color: "text-rose-500",
    bg: "bg-rose-50 dark:bg-rose-950/40",
    ring: "ring-rose-200 dark:ring-rose-800",
    activeBg: "bg-rose-500",
    description: "Full system access. Manages users, configs & audit logs.",
    badge: "Unrestricted",
  },
  admin: {
    icon: Settings,
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/40",
    ring: "ring-violet-200 dark:ring-violet-800",
    activeBg: "bg-violet-500",
    description: "Admin-level access across fleet and operations modules.",
    badge: "High Access",
  },
  fleet_manager: {
    icon: Wrench,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    ring: "ring-blue-200 dark:ring-blue-800",
    activeBg: "bg-blue-500",
    description: "Manages vehicles, maintenance records and fleet health.",
    badge: "Operations",
  },
  dispatcher: {
    icon: Radio,
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    ring: "ring-amber-200 dark:ring-amber-800",
    activeBg: "bg-amber-500",
    description: "Creates and manages dispatch schedules and live trips.",
    badge: "Dispatch",
  },
  management: {
    icon: BarChart2,
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    ring: "ring-emerald-200 dark:ring-emerald-800",
    activeBg: "bg-emerald-500",
    description: "Read-only dashboard access for executives and managers.",
    badge: "View Only",
  },
};

function RoleCard({ role, selected, onSelect }) {
  const meta = ROLE_META[role.value] ?? {
    icon: Users,
    color: "text-foreground-secondary",
    bg: "bg-muted/30",
    ring: "ring-border",
    activeBg: "bg-foreground",
    description: "",
    badge: "",
  };
  const Icon = meta.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(String(role.id))}
      className={cn(
        "group relative w-full text-left rounded-2xl p-3.5 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
        "ring-1 border border-transparent",
        selected
          ? cn("border-transparent shadow-sm -translate-y-0.5", meta.ring, meta.bg)
          : "ring-border/60 bg-surface hover:ring-primary/30 hover:border-primary/20 hover:-translate-y-0.5 hover:shadow-xs"
      )}
    >
      {selected && (
        <span className={cn("absolute top-3 right-3 text-[10px] font-bold text-white px-2 py-0.5 rounded-full tracking-wide", meta.activeBg)}>
          {meta.badge}
        </span>
      )}
      <div className="flex items-start gap-3">
        <div className={cn("shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300", selected ? meta.bg : "bg-muted/40 group-hover:bg-muted/60")}>
          <Icon className={cn("w-4 h-4 transition-colors duration-300", selected ? meta.color : "text-foreground-muted group-hover:text-foreground-secondary")} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className={cn("text-[13px] font-bold leading-tight transition-colors duration-200", selected ? "text-foreground" : "text-foreground-secondary group-hover:text-foreground")}>
            {role.name}
          </p>
          <p className="text-[11px] text-foreground-muted leading-snug mt-0.5 line-clamp-2 pr-12">
            {meta.description}
          </p>
        </div>
      </div>
      <div className={cn("absolute bottom-0 left-4 right-4 h-0.5 rounded-full transition-all duration-300", selected ? cn(meta.activeBg, "opacity-50") : "opacity-0")} />
    </button>
  );
}

export default function AddUserPage() {
  useRequireRole(["system_admin", "admin"]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: "", password: "", first_name: "", last_name: "", role_id: "" },
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form manages its own subscription store
  const selectedRoleId = form.watch("role_id");

  const createMutation = useMutation({
    mutationFn: createEmployeeAccount,
    onSuccess: () => {
      toast.success("Account created successfully!");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      form.reset();
      setShowPassword(false);
    },
    onError: (err) => {
      toast.error(
        err.status === 409 || err.status === 400
          ? err.message || "That email address is already in use."
          : err.message || "Failed to create account."
      );
    },
  });

  const isSubmitting = createMutation.isPending;

  const onSubmit = (data) => {
    createMutation.mutate({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      role_id: data.role_id,
    });
  };

  const formActions = (
    <>
      <Button type="button" variant="outline" onClick={() => router.back()} className={cn("rounded-xl", heroButtonOutlineClass)}>
        Cancel
      </Button>
      <Button type="button" onClick={form.handleSubmit(onSubmit)} disabled={isSubmitting} className={cn("rounded-xl px-5 h-10 shadow-xs font-bold", heroButtonPrimaryClass)}>
        {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</> : <><CheckCircle2 className="w-4 h-4 mr-2" /> Create Account</>}
      </Button>
    </>
  );

  return (
    <PageEntrance className="space-y-6 w-full pb-28">
      <HeroHeader
        icon={UserPlus}
        title="Create Employee Account"
        badge="User Provisioning"
        description="Provision a new internal staff account with role-based access control."
        actions={formActions}
      />
      <StickyActionBar>{formActions}</StickyActionBar>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">

          {/* LEFT — Identity */}
          <div className="xl:col-span-7 space-y-5">

            <div className="flex items-center gap-2.5 px-1">
              <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <User className="w-3 h-3 text-primary" />
              </div>
              <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-widest">Identity</span>
              <div className="flex-1 h-px bg-border/60" />
            </div>

            {/* Full Name card */}
            <div className={cn("rounded-3xl overflow-hidden border-0 bg-surface", CARD_SHADOW)}>
              <div className="px-5 pt-4 pb-3 border-b border-border/50 bg-muted/20">
                <p className="text-xs font-extrabold text-foreground flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-primary" /> Full Name
                </p>
                <p className="text-[11px] text-foreground-muted mt-0.5">Legal name as it appears on employee records.</p>
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FloatingField label="First Name" icon={User} required error={form.formState.errors.first_name?.message}>
                  <input id="first_name" {...form.register("first_name")} placeholder="e.g. Juan" autoComplete="given-name"
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/50 py-1" />
                </FloatingField>
                <FloatingField label="Last Name" icon={User} required error={form.formState.errors.last_name?.message}>
                  <input id="last_name" {...form.register("last_name")} placeholder="e.g. Dela Cruz" autoComplete="family-name"
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/50 py-1" />
                </FloatingField>
              </div>
            </div>

            {/* Credentials card */}
            <div className={cn("rounded-3xl overflow-hidden border-0 bg-surface", CARD_SHADOW)}>
              <div className="px-5 pt-4 pb-3 border-b border-border/50 bg-muted/20">
                <p className="text-xs font-extrabold text-foreground flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-primary" /> Login Credentials
                </p>
                <p className="text-[11px] text-foreground-muted mt-0.5">The employee will use these to sign in to FleetOps.</p>
              </div>
              <div className="p-5 space-y-4">
                <FloatingField label="Email Address" icon={Mail} required error={form.formState.errors.email?.message}>
                  <input id="email" type="email" {...form.register("email")} placeholder="employee@example.com" autoComplete="email"
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/50 py-1 font-data" />
                </FloatingField>
                <FloatingField label="Initial Password" icon={Lock} required error={form.formState.errors.password?.message}>
                  <div className="relative flex items-center">
                    <input id="password" type={showPassword ? "text" : "password"} {...form.register("password")} placeholder="Min. 6 characters" autoComplete="new-password"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/50 py-1 pr-8" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-0 text-foreground-muted hover:text-foreground p-1 cursor-pointer transition-colors duration-200"
                      aria-label={showPassword ? "Hide password" : "Show password"}>
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </FloatingField>
              </div>
            </div>

            {/* Driver notice */}
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-2xl bg-info/8 border border-info/20">
              <div className="w-7 h-7 rounded-lg bg-info/15 flex items-center justify-center shrink-0 mt-0.5">
                <Truck className="w-3.5 h-3.5 text-info" />
              </div>
              <p className="text-[11.5px] text-foreground-secondary leading-relaxed">
                <span className="font-bold text-foreground">Driver accounts</span> are registered separately from the{" "}
                <Link href="/drivers" className="text-primary font-bold underline underline-offset-2 hover:text-primary/80 transition-colors duration-200">
                  Drivers Directory
                </Link>
                , which also configures their mobile login and consent forms.
              </p>
            </div>
          </div>

          {/* RIGHT — Access Level */}
          <div className="xl:col-span-5 space-y-5">

            <div className="flex items-center gap-2.5 px-1">
              <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-3 h-3 text-primary" />
              </div>
              <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-widest">Access Level</span>
              <div className="flex-1 h-px bg-border/60" />
            </div>

            {/* Role picker */}
            <div className={cn("rounded-3xl overflow-hidden border-0 bg-surface", CARD_SHADOW)}>
              <div className="px-5 pt-4 pb-3 border-b border-border/50 bg-muted/20">
                <p className="text-xs font-extrabold text-foreground flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-primary" /> System Role <span className="text-danger text-[11px] ml-0.5">*</span>
                </p>
                <p className="text-[11px] text-foreground-muted mt-0.5">Determines what modules and actions this employee can access.</p>
              </div>
              <div className="p-4 space-y-2.5">
                <Controller
                  control={form.control}
                  name="role_id"
                  render={({ field }) => (
                    <>
                      {ACCOUNT_ROLES.map((role) => (
                        <RoleCard key={role.id} role={role} selected={field.value === String(role.id)} onSelect={(val) => field.onChange(val)} />
                      ))}
                    </>
                  )}
                />
                {form.formState.errors.role_id && (
                  <p className="text-xs text-danger font-medium flex items-center gap-1.5 px-1 pt-0.5">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {form.formState.errors.role_id.message}
                  </p>
                )}
              </div>
            </div>

            {/* Role summary callout */}
            {selectedRoleId && (() => {
              const role = ACCOUNT_ROLES.find((r) => String(r.id) === selectedRoleId);
              const meta = role ? ROLE_META[role.value] : null;
              if (!role || !meta) return null;
              const Icon = meta.icon;
              return (
                <div className={cn("flex items-start gap-3 px-4 py-3.5 rounded-2xl ring-1 transition-all duration-300", meta.bg, meta.ring)}>
                  <div className="w-7 h-7 rounded-lg bg-white/70 dark:bg-black/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className={cn("w-3.5 h-3.5", meta.color)} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-foreground">{role.name} selected</p>
                    <p className="text-[11px] text-foreground-secondary leading-relaxed mt-0.5">{meta.description}</p>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </form>
    </PageEntrance>
  );
}
