"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/hooks/use-role-access";
import { Search, UserCog, UserPlus, ShieldAlert, RefreshCw, AlertTriangle, KeyRound, Copy, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { rolesFor } from "@/lib/auth/permissions";
import { isSuperAdmin } from "@/lib/auth/role-names";
import { isPrivilegedTarget, canMutateAccount } from "@/lib/auth/privilege";

// Staff account index — every employee account (not driver profiles; those live
// in the Drivers directory). Admins can review roles and disable/enable
// accounts. Disabling soft-deletes the employee row, which is what actually
// blocks login (auth checks deleted_at IS NULL).
const columnHelper = createColumnHelper();

export default function UsersPage() {
  useRequireRole();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [target, setTarget] = useState(null); // {employee, action: disable|enable}
  const [resetLink, setResetLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [resendTarget, setResendTarget] = useState(null);
  const canIssueReset = rolesFor("accounts", "update").includes(user?.role);
  const canResendInvite = rolesFor("accounts", "create").includes(user?.role);
  const isSuper = isSuperAdmin(user?.role);
  // Super Admin workspace links here as "Privileged Accounts" — Admin callers
  // never see the tab and the server still enforces target protection.
  const privilegedView = searchParams.get("view") === "privileged" && isSuper;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["staff-users", debouncedSearch],
    queryFn: () =>
      apiFetch(`/api/settings/users${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ""}`),
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const scopedRows = useMemo(
    () => (privilegedView ? rows.filter((r) => isPrivilegedTarget(r.role_name)) : rows),
    [rows, privilegedView]
  );
  const filtered = useMemo(
    () =>
      scopedRows.filter((r) =>
        statusFilter === "all"
          ? true
          : statusFilter === "active"
          ? !r.deleted_at
          : Boolean(r.deleted_at)
      ),
    [scopedRows, statusFilter]
  );
  const activeCount = scopedRows.filter((r) => !r.deleted_at).length;
  const inactiveCount = scopedRows.length - activeCount;
  const privilegedCount = useMemo(() => rows.filter((r) => isPrivilegedTarget(r.role_name)).length, [rows]);

  const toggleMutation = useMutation({
    mutationFn: ({ employee_id, action }) =>
      apiFetch("/api/settings/users", { method: "PUT", body: { employee_id, action } }),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.action === "disable"
          ? "Account disabled — sign-in revoked"
          : "Account re-enabled"
      );
      setTarget(null);
      queryClient.invalidateQueries({ queryKey: ["staff-users"] });
    },
    onError: (e) => toast.error(e.message || "Failed to update account"),
  });

  const resetMutation = useMutation({
    mutationFn: (employee_id) =>
      apiFetch("/api/auth/reset-token", { method: "POST", body: { employee_id } }),
    onSuccess: (result) => {
      setResetLink(result.resetUrl);
      setCopied(false);
      toast.success("One-time reset link created (expires in 30 minutes)");
    },
    onError: (e) => toast.error(e.message || "Failed to create reset link"),
  });
  const { mutate: issueReset, isPending: resetPending } = resetMutation;

  const resendMutation = useMutation({
    mutationFn: (employee_id) =>
      apiFetch(`/api/settings/users/${employee_id}/resend-invite`, { method: "POST", body: {} }),
    onSuccess: (result) => {
      toast.success(result?.message || "A new temporary password was emailed");
      setResendTarget(null);
      queryClient.invalidateQueries({ queryKey: ["staff-users"] });
    },
    onError: (e) => toast.error(e.message || "Failed to resend invitation"),
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => `${row.first_name} ${row.last_name}`, {
        id: "name",
        header: "Name",
        cell: (info) => (
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {info.getValue()}
              {info.row.original.position && <span className="ml-2 text-xs font-normal text-foreground-muted">{info.row.original.position}</span>}
            </p>
            <p className="text-xs text-foreground-muted truncate">{info.row.original.email}</p>
          </div>
        ),
      }),
      columnHelper.accessor("role_name", {
        header: "Role",
        cell: (info) => (
          <Badge variant={info.getValue() === "super_admin" ? "primary" : "default"} className="capitalize">
            {(info.getValue() || "no role").replace(/_/g, " ")}
          </Badge>
        ),
      }),
      columnHelper.accessor("deleted_at", {
        header: "Status",
        cell: (info) => {
          const disabled = Boolean(info.getValue());
          const u = info.row.original;
          if (!disabled && u.must_change_password) {
            const exp = u.temp_credential_expires_at
              ? new Date(u.temp_credential_expires_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
              : null;
            return (
              <span className="inline-flex items-center gap-1.5" title="Temporary password not yet replaced">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
                <span className="text-xs font-medium text-warning">
                  Password not set{exp ? ` · expires ${exp}` : ""}
                </span>
              </span>
            );
          }
          return (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn("h-1.5 w-1.5 rounded-full", disabled ? "bg-transparent border border-border" : "bg-success")}
              />
              <span className={cn("text-xs font-medium", disabled ? "text-foreground-muted" : "text-success")}>
                {disabled ? "Disabled" : "Active"}
              </span>
            </span>
          );
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: (info) => (
          <span className="text-xs text-foreground-secondary">
            {info.getValue() ? new Date(info.getValue()).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"}
          </span>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => {
          const u = info.row.original;
          const disabled = Boolean(u.deleted_at);
          // Privileged targets are Super Admin-managed. An Admin sees a
          // protected label instead of buttons that would only 403.
          if (!canMutateAccount(user?.role, u.role_name)) {
            return (
              <div className="text-right">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground-muted" title="Managed by Super Admin">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Protected account
                </span>
                <p className="text-[11px] text-foreground-muted">Managed by Super Admin</p>
              </div>
            );
          }
          const canResetTarget = canIssueReset && !disabled;
          return (
            <div className="text-right flex items-center justify-end gap-1">
              {canResendInvite && !disabled && u.must_change_password && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 rounded-full text-xs cursor-pointer"
                  onClick={() => setResendTarget(u)}
                  disabled={resendMutation.isPending}
                  title="Email a new temporary password"
                >
                  <Mail className="w-3.5 h-3.5 mr-1.5" />
                  Resend invite
                </Button>
              )}
              {canResetTarget && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 rounded-full text-xs cursor-pointer"
                  onClick={() => issueReset(u.employee_id)}
                  disabled={resetPending}
                  title="Create a one-time password reset link"
                >
                  <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                  Reset password
                </Button>
              )}
              {disabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full text-xs cursor-pointer"
                  onClick={() => setTarget({ employee: u, action: "enable" })}
                >
                  Enable
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 rounded-full text-xs font-bold text-danger hover:bg-danger/10 cursor-pointer"
                  onClick={() => setTarget({ employee: u, action: "disable" })}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
                  Disable
                </Button>
              )}
            </div>
          );
        },
      }),
    ],
    [canIssueReset, canResendInvite, issueReset, resetPending, resendMutation.isPending, user?.role]
  );

  return (
    <div className="space-y-6 pb-12">
      <HeroHeader
        icon={UserCog}
        title={privilegedView ? "Privileged Accounts" : "User Management"}
        badge={privilegedView ? "Super Admin · Admin" : "Staff Accounts"}
        description={
          privilegedView
            ? "Super Admin and Admin accounts. Every change here is audited."
            : "Every staff account across workspaces. Disable to revoke sign-in; enable to restore access."
        }
        actions={
          <Link href="/settings/users/new" className={cn("rounded-2xl h-10 px-4 text-xs font-semibold inline-flex items-center gap-2", heroButtonPrimaryClass)}>
            <UserPlus className="w-3.5 h-3.5" />
            Add User
          </Link>
        }
      />

      {isError ? (
        <div
          className="flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl border border-danger/20 bg-danger-bg/40"
          role="alert"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 mb-4">
            <ShieldAlert className="w-5 h-5 text-danger" />
          </div>
          <p className="text-sm font-medium text-foreground">Couldn&apos;t load accounts</p>
          <p className="text-sm text-foreground-secondary mt-1">The directory didn&apos;t respond. Try again.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isRefetching && "animate-spin")} /> Try again
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          isLoading={isLoading}
          searchable={true}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search name or email…"
          title="Staff Directory"
          description="Manage roles and sign-in access."
          icon={UserCog}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              {isSuper && (
                <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-full border border-border/60">
                  <Link
                    href="/settings/users"
                    aria-current={!privilegedView}
                    className={cn(
                      "px-3 py-1 rounded-full text-[11px] font-bold transition-all",
                      !privilegedView
                        ? "bg-surface shadow-xs text-foreground border border-border/80"
                        : "text-foreground-muted hover:text-foreground border border-transparent cursor-pointer"
                    )}
                  >
                    All Users ({rows.length})
                  </Link>
                  <Link
                    href="/settings/users?view=privileged"
                    aria-current={privilegedView}
                    className={cn(
                      "px-3 py-1 rounded-full text-[11px] font-bold transition-all",
                      privilegedView
                        ? "bg-surface shadow-xs text-foreground border border-border/80"
                        : "text-foreground-muted hover:text-foreground border border-transparent cursor-pointer"
                    )}
                  >
                    Privileged ({privilegedCount})
                  </Link>
                </div>
              )}
              <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-full border border-border/60">
              {[
                { id: "all", label: `All (${rows.length})` },
                { id: "active", label: `Active (${activeCount})` },
                { id: "inactive", label: `Disabled (${inactiveCount})` },
              ].map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => setStatusFilter(chip.id)}
                  aria-pressed={statusFilter === chip.id}
                  className={cn(
                    "px-3 py-1 rounded-full text-[11px] font-bold transition-all",
                    statusFilter === chip.id
                      ? "bg-surface shadow-xs text-foreground border border-border/80"
                      : "text-foreground-muted hover:text-foreground border border-transparent cursor-pointer"
                  )}
                >
                  {chip.label}
                </button>
              ))}
              </div>
            </div>
          }
          emptyTitle={rows.length === 0 ? "No staff accounts yet" : "No accounts match"}
          emptyDescription={rows.length === 0 ? "Create the first staff account to grant dashboard access." : "Try a different name, email or filter."}
          emptyVariant={rows.length === 0 ? "first-run" : "filtered"}
          emptyAction={
            rows.length === 0 ? (
              <Link href="/settings/users/new">
                <Button size="sm"><UserPlus className="w-4 h-4 mr-2" />Add User</Button>
              </Link>
            ) : undefined
          }
        />
      )}

      {resetLink && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 space-y-2" role="status">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">One-time reset link ready</p>
              <p className="text-xs text-foreground-secondary mt-0.5">Share it privately. It expires in 30 minutes and is invalid after one use.</p>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setResetLink(null)}>Dismiss</Button>
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={resetLink}
              aria-label="Password reset link"
              className="min-w-0 flex-1 h-9 rounded-lg border border-border bg-surface px-3 text-xs text-foreground-secondary"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 text-xs"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resetLink);
                  setCopied(true);
                } catch {
                  toast.error("Copy failed — select the link manually");
                }
              }}
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" />
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={(open) => !open && setTarget(null)}
        variant={target?.action === "disable" ? "danger" : "info"}
        title={target?.action === "disable" ? "Disable this account?" : "Re-enable this account?"}
        message={
          target?.action === "disable"
            ? `${target?.employee?.first_name} ${target?.employee?.last_name} (${target?.employee?.email}) will immediately lose dashboard and mobile sign-in. Their records stay intact.`
            : `${target?.employee?.first_name} ${target?.employee?.last_name} (${target?.employee?.email}) will be able to sign in again.`
        }
        confirmLabel={target?.action === "disable" ? "Disable account" : "Enable account"}
        cancelLabel="Keep as is"
        loading={toggleMutation.isPending}
        onConfirm={() => toggleMutation.mutate({ employee_id: target.employee.employee_id, action: target.action })}
      />

      <ConfirmDialog
        open={Boolean(resendTarget)}
        onOpenChange={(open) => !open && setResendTarget(null)}
        variant="warning"
        title="Resend invitation?"
        message={`A new temporary password will be emailed to ${resendTarget?.email}. The previous temporary password stops working immediately.`}
        confirmLabel="Send new password"
        cancelLabel="Cancel"
        loading={resendMutation.isPending}
        onConfirm={() => resendTarget && resendMutation.mutate(resendTarget.employee_id)}
      />
    </div>
  );
}
