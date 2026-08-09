"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { DataTable } from "@/components/tables/data-table";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { getDrivers, deleteDriver, getDriverStats, linkDriverAccount } from "@/services/driver.service";
import {
  Users,
  UserCheck,
  UserX,
  Truck,
  Clock,
  Ban,
  Plus,
  Download,
  Mail,
  Phone,
  Eye,
  Pencil,
  Archive,
  Link2,
} from "lucide-react";
import { exportToCSV } from "@/lib/export";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";

export default function DriversPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [licenseClassFilter, setLicenseClassFilter] = useState("all");
  const [deletingId, setDeletingId] = useState(null);

  const {
    data: drivers = [],
    isLoading,
  } = useQuery({
    queryKey: ["drivers", statusFilter, licenseClassFilter, search],
    queryFn: () =>
      getDrivers({
        includeUnlinked: 1,
        status: statusFilter !== "all" ? statusFilter : undefined,
        license_class: licenseClassFilter !== "all" ? licenseClassFilter : undefined,
        search: search ? search : undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const { data: stats } = useQuery({
    queryKey: ["driver-stats"],
    queryFn: () => getDriverStats(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteDriver(id),
    onSuccess: () => {
      toast.success("Driver archived successfully");
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver-stats"] });
      setDeletingId(null);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to archive driver");
      setDeletingId(null);
    },
  });

  const linkMutation = useMutation({
    mutationFn: (employeeId) => linkDriverAccount(employeeId),
    onSuccess: () => {
      toast.success("Driver profile completed");
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver-stats"] });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to complete driver profile");
    },
  });

  const s = stats || { total: 0, available: 0, onTrip: 0, offDuty: 0, onLeave: 0, suspended: 0 };

  const statCards = [
    { label: "Total Drivers", value: s.total, icon: Users, tone: "primary", status: "all" },
    { label: "Available", value: s.available, icon: UserCheck, tone: "success", status: "Available" },
    { label: "On Trip", value: s.onTrip, icon: Truck, tone: "warning", status: "On Trip" },
    { label: "Off Duty", value: s.offDuty, icon: Clock, tone: "secondary", status: "Off Duty" },
    { label: "On Leave", value: s.onLeave, icon: UserX, tone: "info", status: "On Leave" },
    { label: "Suspended", value: s.suspended, icon: Ban, tone: "danger", status: "Suspended" },
  ];

  const columns = [
    {
      key: "driver_id",
      label: "Driver ID",
      sortable: true,
      render: (val) => (
        <span className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
          #{val}
        </span>
      ),
    },
    {
      key: "name",
      label: "Driver Name",
      sortable: true,
      render: (_, row) => {
        const emp = row.employees;
        const name = emp ? `${emp.first_name} ${emp.last_name}` : "Unassigned driver";
        const initials = name ? name.split(" ").map((part) => part[0]).join("").slice(0, 2) : "DR";
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs">
              {initials}
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">{name}</p>
              <p className="text-xs text-foreground-muted font-medium">Driver profile</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "email",
      label: "Email / Phone",
      render: (_, row) => (
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Mail className="h-3.5 w-3.5 text-foreground-muted" />
            {row.employees?.email || "—"}
          </div>
          <div className="flex items-center gap-1.5 text-foreground-secondary">
            <Phone className="h-3.5 w-3.5 text-foreground-muted" />
            {row.employees?.phone || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "license",
      label: "License Info",
      render: (_, row) => (
        <div className="space-y-1 text-xs">
          <div className="font-data font-bold text-foreground">{row.license_number || "—"}</div>
          <div className="text-foreground-secondary font-medium">
            Class {row.license_class || "—"} • {row.years_of_experience || 0} yrs exp
          </div>
        </div>
      ),
    },
    {
      key: "driver_status",
      label: "Status",
      sortable: true,
      render: (val) => <StatusBadge status={val || "Available"} entity="driver" className="rounded-full px-3 py-1 text-xs font-bold" />,
    },
    {
      key: "account",
      label: "Login",
      render: (_, row) =>
        row.account ? (
          <Badge variant={row.account.has_password ? "success" : "secondary"} className="rounded-full px-3 py-1 text-xs font-bold">
            {row.account.has_password ? "Enabled" : "No login"}
          </Badge>
        ) : (
          <Badge variant="warning" className="rounded-full px-3 py-1 text-xs font-bold">Needs profile</Badge>
        ),
    },
    {
      key: "actions",
      label: "",
      render: (_, row) => (
        <div className="inline-flex items-center gap-0.5 rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
          {row.requires_completion ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs rounded-full font-bold border-primary/40 text-primary hover:bg-primary/10 cursor-pointer"
              onClick={() => linkMutation.mutate(row.employee_id)}
              disabled={linkMutation.isPending}
            >
              <Link2 className="w-3.5 h-3.5 mr-1" /> Complete Profile
            </Button>
          ) : (
            <>
              <Tooltip content="View">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
                  onClick={() => router.push(`/drivers/${row.driver_id}`)}
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="Edit">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
                  onClick={() => router.push(`/drivers/${row.driver_id}/edit`)}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="Archive">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full text-danger hover:bg-danger/10 hover:text-danger cursor-pointer"
                  onClick={() => setDeletingId(row.driver_id)}
                >
                  <Archive className="w-3.5 h-3.5" />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      ),
    },
  ];

  const TONE_MAP = {
    primary:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   icon: 'bg-slate-500/15 text-slate-500',   dot: 'bg-slate-500',   text: 'text-slate-600 dark:text-slate-400' },
    success:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'bg-emerald-500/15 text-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
    warning:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   icon: 'bg-amber-500/15 text-amber-500',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400' },
    danger:    { bg: 'bg-red-500/10',     border: 'border-red-500/30',     icon: 'bg-red-500/15 text-red-500',       dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400' },
    info:      { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    icon: 'bg-blue-500/15 text-blue-500',     dot: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400' },
    secondary: { bg: 'bg-zinc-500/10',    border: 'border-zinc-500/30',    icon: 'bg-zinc-500/15 text-zinc-500',     dot: 'bg-zinc-500',    text: 'text-zinc-600 dark:text-zinc-400' },
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Users}
        title="Fleet Drivers Directory"
        badge="Operations"
        description="Manage operational drivers, license compliance, and performance metrics."
        actions={
          <>
            <Button
              variant="outline"
              className={cn(heroButtonOutlineClass)}
              onClick={() =>
                exportToCSV(drivers, "drivers", [
                  { label: "Driver ID", key: "driver_id" },
                  { label: "Name", accessor: (d) => (d.employees ? `${d.employees.first_name} ${d.employees.last_name}` : "") },
                  { label: "Email", accessor: (d) => d.employees?.email || "" },
                  { label: "Phone", accessor: (d) => d.employees?.phone || "" },
                  { label: "License #", key: "license_number" },
                  { label: "License Expiry", key: "license_expiry" },
                  { label: "License Class", key: "license_class" },
                  { label: "Experience (yrs)", key: "years_of_experience" },
                  { label: "Status", key: "driver_status" },
                ])
              }
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Button onClick={() => router.push("/drivers/new")} className={cn(heroButtonPrimaryClass)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Driver
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="h-28 bg-muted/20 animate-pulse rounded-3xl border border-border/40" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {statCards.map((card) => {
             const isActive = statusFilter === card.status;
             const Icon = card.icon;
             const t = TONE_MAP[card.tone] || TONE_MAP.primary;
             return (
               <button
                 key={card.label}
                 type="button"
                 onClick={() => setStatusFilter(isActive ? "all" : card.status)}
                 className={cn(
                   "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                   isActive
                     ? cn(t.border, t.bg, "shadow-md")
                     : "border-border/60 bg-surface hover:shadow-sm hover:border-primary/40"
                 )}
               >
                 {/* label + icon */}
                 <div className="flex items-start justify-between gap-2 mt-1">
                   <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">{card.label}</span>
                   <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}>
                     <Icon className="w-4 h-4" />
                   </div>
                 </div>

                 {/* value */}
                 <div className="text-3xl font-bold text-foreground font-data leading-none">{card.value}</div>
               </button>
             );
          })}
        </div>
      )}

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={drivers}
            pageSize={10}
            title="Drivers Directory"
            description="Manage operational drivers and licensing."
            icon={Users}
            context={statusFilter === "all" ? "All Drivers" : statusFilter}
            searchPlaceholder="Search drivers by name or email..."
            onRowClick={(row) => router.push(`/drivers/${row.driver_id}`)}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
        title="Archive Driver Profile?"
        message="Are you sure you want to archive this driver? The driver will be hidden from active dispatch selection."
        confirmLabel="Archive Driver"
        variant="archive"
        onConfirm={() => {
          if (deletingId) deleteMutation.mutate(deletingId);
        }}
      />
    </div>
  );
}
