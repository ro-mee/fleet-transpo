"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/tables/data-table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { getDrivers, getDriverStats, deleteDriver, linkDriverAccount } from "@/services/driver.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { toast } from "@/components/ui/toast";
import {
  Users, UserCheck, Truck, Clock, UserX, Ban,
  Download, Plus, Search, Eye, Pencil, Archive, RotateCcw, Link2
} from "lucide-react";
import { exportToCSV } from "@/lib/export";

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
    { key: "driver_id", label: "Driver ID", sortable: true, render: (val) => <span className="font-data text-xs text-foreground-muted">{val}</span> },
    {
      key: "name",
      label: "Driver Name",
      sortable: true,
      render: (_, row) => {
        const emp = row.employees;
        return emp ? `${emp.first_name} ${emp.last_name}` : "—";
      },
    },
    {
      key: "email",
      label: "Email / Phone",
      render: (_, row) => (
        <div className="text-xs space-y-0.5">
          <div className="font-medium text-foreground">{row.employees?.email || "—"}</div>
          <div className="text-foreground-secondary">{row.employees?.phone || "—"}</div>
        </div>
      ),
    },
    {
      key: "license",
      label: "License Info",
      render: (_, row) => (
        <div className="text-xs space-y-0.5">
          <div className="font-data font-medium">{row.license_number || "—"}</div>
          <div className="text-foreground-secondary">
            Class {row.license_class || "—"} • {row.years_of_experience || 0} yrs exp
          </div>
        </div>
      ),
    },
    {
      key: "driver_status",
      label: "Status",
      sortable: true,
      render: (val) => <StatusBadge status={val || "Available"} entity="driver" />,
    },
    {
      key: "account",
      label: "Login",
      render: (_, row) =>
        row.account ? (
          <Badge variant={row.account.has_password ? "success" : "secondary"}>
            {row.account.has_password ? "Enabled" : "No login"}
          </Badge>
        ) : (
          <Badge variant="warning">Needs profile</Badge>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (_, row) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {row.requires_completion ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => linkMutation.mutate(row.employee_id)}
              disabled={linkMutation.isPending}
            >
              <Link2 className="w-3.5 h-3.5 mr-1" /> Complete Profile
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-primary"
                onClick={() => router.push(`/drivers/${row.driver_id}`)}
              >
                <Eye className="w-3.5 h-3.5 mr-1" /> View
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-foreground-secondary hover:text-foreground"
                onClick={() => router.push(`/drivers/${row.driver_id}/edit`)}
                title="Edit Driver"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-warning hover:text-warning hover:bg-warning/10"
                onClick={() => setDeletingId(row.driver_id)}
                title="Archive Driver"
              >
                <Archive className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Drivers Directory"
        description="Manage operational drivers, license compliance, shifts, and performance metrics."
        actions={
          <>
            <Button
              variant="outline"
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
            <Button onClick={() => router.push("/drivers/new")}>
              <Plus className="w-4 h-4 mr-2" />
              Add Driver
            </Button>
          </>
        }
      />

      {isLoading ? (
        <StatsGridSkeleton count={6} />
      ) : (
        <StatGrid cols={6}>
          {statCards.map((card) => (
            <StatCard
              key={card.label}
              {...card}
              active={statusFilter === card.status}
              onClick={() => setStatusFilter(card.status)}
            />
          ))}
        </StatGrid>
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-foreground-muted" />
              <Input
                placeholder="Search name, license, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-10"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Available">Available</SelectItem>
                <SelectItem value="On Trip">On Trip</SelectItem>
                <SelectItem value="Off Duty">Off Duty</SelectItem>
                <SelectItem value="On Leave">On Leave</SelectItem>
                <SelectItem value="Suspended">Suspended</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>

            <Select value={licenseClassFilter} onValueChange={setLicenseClassFilter}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="All License Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All License Classes</SelectItem>
                <SelectItem value="B">Class B — Passenger Cars & Light Vehicles</SelectItem>
                <SelectItem value="B1">Class B1 — Light Vans & Commercial Vehicles</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(search || statusFilter !== "all" || licenseClassFilter !== "all") && (
            <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
              <span className="text-foreground-secondary">
                Showing filtered drivers ({drivers.length} results)
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-foreground-muted hover:text-foreground"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setLicenseClassFilter("all");
                }}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset Filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={drivers}
            isLoading={isLoading}
            searchable={false}
            emptyTitle="No drivers found"
            emptyDescription="Try adjusting your filters, or add a new driver to the directory."
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
        message="Are you sure you want to archive this driver? The record will be hidden from active dispatch selection while preserving historical trip data."
        confirmLabel="Archive Driver"
        variant="archive"
        onConfirm={() => {
          if (deletingId) deleteMutation.mutate(deletingId);
        }}
      />
    </div>
  );
}
