"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { createEmployeeAccount } from "@/services/auth.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { createUserSchema } from "@/lib/validation/schemas";
import { REGISTRATION_ROLES } from "@/lib/constants";
import { ArrowLeft, Loader2, UserPlus, CheckCircle2, Eye, EyeOff, ShieldCheck, Mail, Lock, User, Truck } from "lucide-react";
import { FloatingField } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";

const ACCOUNT_ROLES = REGISTRATION_ROLES.filter((r) => r.value !== "driver");

export default function AddUserPage() {
  useRequireRole(["system_admin", "admin"]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: "",
      password: "",
      first_name: "",
      last_name: "",
      role_id: "",
    },
  });

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

  return (
    <div className="space-y-6 w-full pb-6">
      {/* ── Top Hero Header Bar ── */}
      <HeroHeader
        icon={UserPlus}
        title="Create Employee Account"
        badge="User Provisioning"
        description="Provision a new internal staff or driver user account with role-based access control."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              className={cn("rounded-xl", heroButtonOutlineClass)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={form.handleSubmit(onSubmit)}
              disabled={isSubmitting}
              className={cn("rounded-xl px-5 h-10 shadow-xs font-bold", heroButtonPrimaryClass)}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Create Account
                </>
              )}
            </Button>
          </>
        }
      />

      {/* ── USER ACCOUNT PROVISIONING CARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
            <UserPlus className="w-4 h-4 text-primary" /> Employee Profile &amp; Role Credentials
          </CardTitle>
          <CardDescription className="text-xs text-foreground-secondary">
            Fill in account credentials and select access permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FloatingField label="First Name" icon={User} required error={form.formState.errors.first_name?.message}>
                <input
                  id="first_name"
                  {...form.register("first_name")}
                  placeholder="e.g. Juan"
                  className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
                />
              </FloatingField>

              <FloatingField label="Last Name" icon={User} required error={form.formState.errors.last_name?.message}>
                <input
                  id="last_name"
                  {...form.register("last_name")}
                  placeholder="e.g. Dela Cruz"
                  className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
                />
              </FloatingField>

              <FloatingField label="Email Address" icon={Mail} required error={form.formState.errors.email?.message}>
                <input
                  id="email"
                  type="email"
                  {...form.register("email")}
                  placeholder="employee@example.com"
                  className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1 font-data"
                />
              </FloatingField>

              <FloatingField label="Initial Password" icon={Lock} required error={form.formState.errors.password?.message}>
                <div className="relative flex items-center">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    {...form.register("password")}
                    placeholder="At least 6 characters"
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1 pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 text-foreground-muted hover:text-foreground p-1 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </FloatingField>

              <FloatingField label="Assigned System Role" icon={ShieldCheck} required error={form.formState.errors.role_id?.message} className="md:col-span-2">
                <select
                  id="role_id"
                  {...form.register("role_id")}
                  className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
                >
                  <option value="">Select system role</option>
                  {ACCOUNT_ROLES.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name} ({role.label})
                    </option>
                  ))}
                </select>
              </FloatingField>
            </div>

            <div className="p-4 rounded-2xl bg-info/10 border border-info/20 text-xs text-foreground-secondary flex items-start gap-2.5 md:col-span-2 mt-4">
              <ShieldCheck className="w-4 h-4 text-info shrink-0 mt-0.5" />
              <span>
                Use this screen for staff and support roles.{" "}
                <strong className="text-foreground font-bold">Driver</strong> accounts
                are created from the{" "}
                <Link href="/drivers" className="text-primary font-bold underline underline-offset-2 inline-flex items-center gap-1">
                  <Truck className="w-3.5 h-3.5" /> Drivers Directory
                </Link>{" "}
                section, which also sets up their mobile login and consent.
              </span>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
