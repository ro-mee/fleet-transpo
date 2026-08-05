"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { createEmployeeAccount } from "@/services/auth.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { createUserSchema } from "@/lib/validation/schemas";
import { REGISTRATION_ROLES } from "@/lib/constants";
import { ArrowLeft, Loader2, UserPlus, CheckCircle2, Eye, EyeOff, ShieldCheck, Truck } from "lucide-react";

// Drivers are created from the Drivers section, not from this account screen —
// a driver login also needs a linked driver profile, which only the drivers
// flow sets up. Staff and support roles (everything except Driver) can be
// provisioned here.
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
      toast.success("Account created");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      // No user-list screen exists yet, so reset the form for the next account
      // rather than navigating somewhere that would 404.
      form.reset();
      setShowPassword(false);
    },
    onError: (err) => {
      // 409 (duplicate email) and 400 (invalid role) carry the API's message;
      // everything else falls back to a generic failure.
      toast.error(
        err.status === 409 || err.status === 400
          ? err.message || "That email address is already in use."
          : err.message || "Failed to create account."
      );
    },
  });

  const values = form.watch();
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
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link
          href="/settings/general"
          className="text-foreground-secondary hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Add New User</h1>
          <p className="text-foreground-secondary mt-1">
            Create an employee account with a specific role and access level.
          </p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-primary" /> Account Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="first_name">First Name *</Label>
                <Input id="first_name" {...form.register("first_name")} placeholder="e.g. Juan" />
                {form.formState.errors.first_name && (
                  <p className="text-xs text-danger">{form.formState.errors.first_name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="last_name">Last Name *</Label>
                <Input id="last_name" {...form.register("last_name")} placeholder="e.g. Dela Cruz" />
                {form.formState.errors.last_name && (
                  <p className="text-xs text-danger">{form.formState.errors.last_name.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email Address *</Label>
              <Input id="email" type="email" {...form.register("email")} placeholder="user@example.com" />
              {form.formState.errors.email && (
                <p className="text-xs text-danger">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password *</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  {...form.register("password")}
                  placeholder="Min. 8 characters"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.formState.errors.password ? (
                <p className="text-xs text-danger">{form.formState.errors.password.message}</p>
              ) : (
                <p className="text-[11px] text-foreground-muted">
                  Requires 8+ characters with upper, lower, number, and a special character.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role">Role *</Label>
              <Select
                value={values.role_id ? String(values.role_id) : undefined}
                onValueChange={(val) => form.setValue("role_id", Number(val), { shouldValidate: true })}
              >
                <SelectTrigger className="w-full text-left font-normal truncate">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_ROLES.map((role) => (
                    <SelectItem key={role.id} value={String(role.id)}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.role_id && (
                <p className="text-xs text-danger">{form.formState.errors.role_id.message}</p>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-info/10 border border-info/30 text-xs text-foreground-secondary flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>
                The new account will have the access of the role you select. Use this
                screen for staff and support roles.{" "}
                <strong className="text-foreground font-semibold">Driver</strong> accounts
                are created from the{" "}
                <Link href="/drivers" className="text-primary font-medium underline underline-offset-2 inline-flex items-center gap-1">
                  <Truck className="w-3 h-3" /> Drivers
                </Link>{" "}
                section, which also sets up their mobile login and consent.
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.push("/settings/general")} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account...</>
            ) : (
              <><CheckCircle2 className="w-4 h-4 mr-1" /> Create Account</>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
