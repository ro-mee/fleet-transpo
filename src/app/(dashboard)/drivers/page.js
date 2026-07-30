"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/tables/data-table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getDrivers, getDriverStats, deleteDriver } from "@/services/driver.service";
import { getBranches } from "@/services/vehicle.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { toast } from "@/components/ui/toast";
import {
  Users, UserCheck, UserX, Truck, Clock, Ban,
  Download, Plus, Search, Filter, Eye, Pencil, Archive, RotateCcw
} from "lucide-react";
import { exportToCSV } from "@/lib/export";

const statusColors = {
  Available: "success",
  "On Trip": "warning",
  "Off Duty": "secondary",
  "On Leave": "info",
  Suspended: "danger",
  Inactive: "secondary",
};

export default function DriversPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Filters state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [licenseClassFilter, setLicenseClassFilter] = useState("all");
  const [deletingId, setDeletingId] = useState(null);

  // Queries
  const {
    data: drivers = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["drivers", statusFilter, branchFilter, licenseClassFilter, search],
    queryFn: () =>
      getDrivers({
        status: statusFilter !== "all" ? statusFilter : undefined,
        branch_id: branchFilter !== "all" ? branchFilter : undefined,
        license_class: licenseClassFilter !== "all" ? licenseClassFilter : undefined,
        search: search ? search : undefined,
      }),
  });

  const { data: stats } = useQuery({
    queryKey: ["driver-stats"],
    queryFn: () => getDriverStats(),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: getBranches,
  });

  // Archive / Delete mutation
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

  const s = stats || {
    total: 0,
    available: 0,
    onTrip: 0,
    offDuty: 0,
    onLeave: 0,
    suspended: 0,
  };

  const columns = [
    { key: "driver_id", label: "Driver ID", sortable: true },
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
      key: "branch",
      label: "Branch",
      render: (_, row) => row.employees?.branches?.branch_name || "Headquarters",
    },
    {
      key: "license",
      label: "License Info",
      render: (_, row) => (
        <div className="text-xs space-y-0.5">
          <div className="font-mono font-medium">{row.license_number || "—"}</div>
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
      render: (val) => (
        <Badge variant={statusColors[val] || "secondary"}>{val || "Available"}</Badge>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (_, row) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Drivers Directory</h1>
          <p className="text-foreground-secondary mt-1">
            Manage operational drivers, license compliance, shifts, and performance metrics
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="h-10"
            onClick={() =>
              exportToCSV(drivers, "drivers", [
                { label: "Driver ID", key: "driver_id" },
                {
                  label: "Name",
                  accessor: (d) =>
                    d.employees ? `${d.employees.first_name} ${d.employees.last_name}` : "",
                },
                { label: "Email", accessor: (d) => d.employees?.email || "" },
                { label: "Phone", accessor: (d) => d.employees?.phone || "" },
                {
                  label: "Branch",
                  accessor: (d) => d.employees?.branches?.branch_name || "Headquarters",
                },
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
          <Button className="h-10" onClick={() => router.push("/drivers/new")}>
            <Plus className="w-4 h-4 mr-2" />
            Add Driver
          </Button>
        </div>
      </div>

      {/* ── Stats Summary Grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Drivers", value: s.total, color: "primary", Icon: Users, status: "all" },
          { label: "Available", value: s.available, color: "success", Icon: UserCheck, status: "Available" },
          { label: "On Trip", value: s.onTrip, color: "warning", Icon: Truck, status: "On Trip" },
          { label: "Off Duty", value: s.offDuty, color: "secondary", Icon: Clock, status: "Off Duty" },
          { label: "On Leave", value: s.onLeave, color: "info", Icon: UserX, status: "On Leave" },
          { label: "Suspended", value: s.suspended, color: "danger", Icon: Ban, status: "Suspended" },
        ].map(({ label, value, color, Icon, status }) => (
          <Card
            key={label}
            className={`border-0 shadow-sm transition-all cursor-pointer hover:shadow-md ${
              statusFilter === status ? "ring-2 ring-primary bg-primary/5" : ""
            }`}
            onClick={() => setStatusFilter(status)}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2.5 rounded-xl bg-${color}/10`}>
                <Icon className={`w-5 h-5 text-${color}`} />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{value}</p>
                <p className="text-xs text-foreground-muted">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Filter Toolbar ── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-foreground-muted" />
              <Input
                placeholder="Search name, license, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-10"
              />
            </div>

            {/* Status Filter */}
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

            {/* Branch Filter */}
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.branch_id} value={String(b.branch_id)}>
                    {b.branch_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* License Class Filter */}
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

          {(search || statusFilter !== "all" || branchFilter !== "all" || licenseClassFilter !== "all") && (
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
                  setBranchFilter("all");
                  setLicenseClassFilter("all");
                }}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset Filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Drivers Table ── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={drivers}
            isLoading={isLoading}
            searchable={false}
            onRowClick={(row) => router.push(`/drivers/${row.driver_id}`)}
          />
        </CardContent>
      </Card>

      {/* ── Archive Confirmation Dialog ── */}
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
