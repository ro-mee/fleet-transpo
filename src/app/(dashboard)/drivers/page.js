"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/tables/data-table";
import { getDrivers, getDriverStats } from "@/services/driver.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Users, UserCheck, UserX, Truck, Clock, Ban, Download } from "lucide-react";
import { exportToCSV } from "@/lib/export";

const statusColors = {
  "Available": "success",
  "On Trip": "warning",
  "Off Duty": "secondary",
  "On Leave": "info",
  "Suspended": "danger",
};

const columns = [
  { key: "employee_id", label: "ID", sortable: true },
  {
    key: "name", label: "Driver", sortable: true,
    render: (_, row) => {
      const emp = row.employees;
      return emp ? `${emp.first_name} ${emp.last_name}` : "—";
    },
  },
  {
    key: "email", label: "Email",
    render: (_, row) => row.employees?.email || "—",
  },
  {
    key: "phone", label: "Phone",
    render: (_, row) => row.employees?.phone || "—",
  },
  { key: "license_number", label: "License #" },
  {
    key: "driver_status", label: "Status", sortable: true,
    render: (val) => (
      <Badge variant={statusColors[val] || "secondary"}>{val}</Badge>
    ),
  },
  {
    key: "driver_id", label: "",
    render: (id) => (
      <Link
        href={`/drivers/${id}`}
        className="text-primary text-sm hover:underline"
      >
        View
      </Link>
    ),
  },
];

export default function DriversPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const [search, setSearch] = useState("");

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => getDrivers(),
  });

  const { data: stats } = useQuery({
    queryKey: ["driver-stats"],
    queryFn: () => getDriverStats(),
  });

  const s = stats || { total: 0, available: 0, onTrip: 0, offDuty: 0, onLeave: 0, suspended: 0 };

  const filtered = drivers.filter((d) => {
    if (!search) return true;
    const emp = d.employees;
    const name = emp ? `${emp.first_name} ${emp.last_name}`.toLowerCase() : "";
    return name.includes(search.toLowerCase()) ||
      (d.license_number || "").toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Drivers</h1>
          <p className="text-foreground-secondary mt-1">Manage driver profiles, attendance, and performance</p>
        </div>
        <Button
          variant="outline"
          className="h-10"
          onClick={() => exportToCSV(drivers, "drivers", [
            { label: "ID", key: "driver_id" },
            { label: "Name", accessor: (d) => d.employees ? `${d.employees.first_name} ${d.employees.last_name}` : "" },
            { label: "Email", accessor: (d) => d.employees?.email || "" },
            { label: "Phone", accessor: (d) => d.employees?.phone || "" },
            { label: "License #", key: "license_number" },
            { label: "License Expiry", key: "license_expiry" },
            { label: "License Type", key: "license_type" },
            { label: "Experience (years)", key: "years_of_experience" },
            { label: "Status", key: "driver_status" },
          ])}
        >
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10"><Users className="w-5 h-5 text-primary" /></div>
            <div><p className="text-xl font-bold">{s.total}</p><p className="text-xs text-foreground-muted">Total</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-success/10"><UserCheck className="w-5 h-5 text-success" /></div>
            <div><p className="text-xl font-bold">{s.available}</p><p className="text-xs text-foreground-muted">Available</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-warning/10"><Truck className="w-5 h-5 text-warning" /></div>
            <div><p className="text-xl font-bold">{s.onTrip}</p><p className="text-xs text-foreground-muted">On Trip</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-secondary/10"><Clock className="w-5 h-5 text-secondary" /></div>
            <div><p className="text-xl font-bold">{s.offDuty}</p><p className="text-xs text-foreground-muted">Off Duty</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-info/10"><UserX className="w-5 h-5 text-info" /></div>
            <div><p className="text-xl font-bold">{s.onLeave}</p><p className="text-xs text-foreground-muted">On Leave</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-danger/10"><Ban className="w-5 h-5 text-danger" /></div>
            <div><p className="text-xl font-bold">{s.suspended}</p><p className="text-xs text-foreground-muted">Suspended</p></div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={filtered}
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search drivers..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
