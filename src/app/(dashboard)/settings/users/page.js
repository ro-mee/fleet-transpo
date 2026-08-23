"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Search, UserCog, UserPlus, ShieldAlert, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// Staff account index — every employee account (not driver profiles; those live
// in the Drivers directory). Admins can review roles and disable/enable
// accounts. Disabling soft-deletes the employee row, which is what actually
// blocks login (auth checks deleted_at IS NULL).
export default function UsersPage() {
  useRequireRole(["admin", "system_admin"]);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [target, setTarget] = useState(null); // {employee, action: disable|enable}

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
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        statusFilter === "all"
          ? true
          : statusFilter === "active"
          ? !r.deleted_at
          : Boolean(r.deleted_at)
      ),
    [rows, statusFilter]
  );
  const activeCount = rows.filter((r) => !r.deleted_at).length;
  const inactiveCount = rows.length - activeCount;

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

  return (
    <div className="space-y-6 pb-12">
      <HeroHeader
        icon={UserCog}
        title="User Management"
        badge="Staff Accounts"
        description="Every staff account across workspaces. Disable to revoke sign-in; enable to restore access."
        actions={
          <Link href="/settings/users/new" className={cn("rounded-2xl h-10 px-4 text-xs font-semibold inline-flex items-center gap-2", heroButtonPrimaryClass)}>
            <UserPlus className="w-3.5 h-3.5" />
            Add User
          </Link>
        }
      />

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2">
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
              "h-8 px-3 rounded-full text-xs font-semibold border transition-colors cursor-pointer",
              statusFilter === chip.id
                ? "bg-primary border-primary text-white dark:text-slate-950"
                : "border-border bg-surface text-foreground-secondary hover:border-primary/40 hover:text-primary"
            )}
          >
            {chip.label}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search staff accounts"
            className="w-full h-9 pl-9 pr-3 rounded-full bg-surface border border-border text-xs font-medium text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
          />
        </div>
      </div>

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
      ) : isLoading ? (
        <div className="rounded-3xl border border-border/80 bg-surface shadow-xs p-6">
          <TableSkeleton rows={6} cols={5} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title={rows.length === 0 ? "No staff accounts yet" : "No accounts match"}
          description={
            rows.length === 0
              ? "Create the first staff account to grant dashboard access."
              : "Try a different name, email or filter."
          }
          action={
            rows.length === 0 ? (
              <Link href="/settings/users/new">
                <Button size="sm"><UserPlus className="w-4 h-4 mr-2" />Add User</Button>
              </Link>
            ) : undefined
          }
          className="py-16"
        />
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-border/80 bg-surface shadow-xs">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="border-b border-border/60 bg-surface">
                <th scope="col" className="px-5 py-3.5 text-[11px] font-black uppercase tracking-widest text-foreground-muted whitespace-nowrap">Name</th>
                <th scope="col" className="px-5 py-3.5 text-[11px] font-black uppercase tracking-widest text-foreground-muted whitespace-nowrap">Role</th>
                <th scope="col" className="px-5 py-3.5 text-[11px] font-black uppercase tracking-widest text-foreground-muted whitespace-nowrap">Status</th>
                <th scope="col" className="px-5 py-3.5 text-[11px] font-black uppercase tracking-widest text-foreground-muted whitespace-nowrap">Created</th>
                <th scope="col" className="px-5 py-3.5 text-[11px] font-black uppercase tracking-widest text-foreground-muted whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.map((u) => {
                const disabled = Boolean(u.deleted_at);
                return (
                  <tr key={u.employee_id} className="hover:bg-hover/30 transition-colors">
                    <td className="px-5 py-3.5 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {u.first_name} {u.last_name}
                        {u.position && <span className="ml-2 text-xs font-normal text-foreground-muted">{u.position}</span>}
                      </p>
                      <p className="text-xs text-foreground-muted truncate">{u.email}</p>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <Badge variant={u.role_name === "system_admin" ? "primary" : "default"} className="capitalize">
                        {(u.role_name || "no role").replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={cn("h-1.5 w-1.5 rounded-full", disabled ? "bg-transparent border border-border" : "bg-success")}
                        />
                        <span className={cn("text-xs font-medium", disabled ? "text-foreground-muted" : "text-success")}>
                          {disabled ? "Disabled" : "Active"}
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-foreground-secondary whitespace-nowrap">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
    </div>
  );
}
