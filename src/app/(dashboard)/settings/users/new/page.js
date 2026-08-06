"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { createEmployeeAccount } from "@/services/auth.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { createUserSchema } from "@/lib/validation/schemas";
import { REGISTRATION_ROLES } from "@/lib/constants";
import { ArrowLeft, Loader2, UserPlus, CheckCircle2, Eye, EyeOff, ShieldCheck, Mail, Lock, User } from "lucide-react";

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
    <div className="space-y-6 w-full max-w-4xl mx-auto pb-12">
      {/* ── Top Page Banner & Header Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface border border-border p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3.5">
          <Button variant="outline" size="icon" className="rounded-xl shrink-0" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5 text-foreground-secondary" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">Create Employee Account</h1>
              <span className="bg-primary/10 text-primary text-xs font-semibold px-2.5 py-0.5 rounded-full border border-primary/20">
                User Provisioning
              </span>
            </div>
            <p className="text-xs text-foreground-secondary mt-0.5">
              Provision a new internal staff or driver user account with role-based access control.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Button type="button" variant="outline" onClick={() => router.back()} className="rounded-xl">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={form.handleSubmit(onSubmit)}
            disabled={isSubmitting}
            className="rounded-xl px-5 h-10 shadow-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating Account...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Create Account
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── USER ACCOUNT PROVISIONING CARD ── */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
            <UserPlus className="w-4 h-4 text-primary" /> Employee Profile &amp; Role Credentials
          </CardTitle>
          <CardDescription className="text-xs">
            Fill in account credentials and select access permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="first_name" className="text-xs font-semibold text-foreground">First Name *</Label>
                <Input id="first_name" {...form.register("first_name")} placeholder="e.g. Juan" className="rounded-xl" />
                {form.formState.errors.first_name && (
                  <p className="text-xs text-danger mt-1">{form.formState.errors.first_name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="last_name" className="text-xs font-semibold text-foreground">Last Name *</Label>
                <Input id="last_name" {...form.register("last_name")} placeholder="e.g. Dela Cruz" className="rounded-xl" />
                {form.formState.errors.last_name && (
                  <p className="text-xs text-danger mt-1">{form.formState.errors.last_name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <Mail className="w-3 h-3 text-foreground-muted" /> Email Address *
                </Label>
                <Input id="email" type="email" {...form.register("email")} placeholder="employee@example.com" className="rounded-xl" />
                {form.formState.errors.email && (
                  <p className="text-xs text-danger mt-1">{form.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <Lock className="w-3 h-3 text-foreground-muted" /> Initial Password *
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    {...form.register("password")}
                    placeholder="At least 6 characters"
                    className="rounded-xl pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.formState.errors.password && (
                  <p className="text-xs text-danger mt-1">{form.formState.errors.password.message}</p>
                )}
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="role_id" className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-foreground-muted" /> Assigned System Role *
                </Label>
                <select
                  id="role_id"
                  {...form.register("role_id")}
                  className="flex h-10 w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs"
                >
                  <option value="">Select system role</option>
                  {REGISTRATION_ROLES.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name} ({role.label})
                    </option>
                  ))}
                </select>
                {form.formState.errors.role_id && (
                  <p className="text-xs text-danger mt-1">{form.formState.errors.role_id.message}</p>
                )}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
