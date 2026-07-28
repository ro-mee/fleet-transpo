"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/tables/data-table";
import { getFuelRecords } from "@/services/fuel.service";
import { formatDate, formatCurrency } from "@/lib/utils";
<<<<<<< HEAD
import { Fuel, Plus } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
=======
import { Fuel, Plus, Download } from "lucide-react";
import { exportToCSV } from "@/lib/export";
>>>>>>> 37cd408469108f4cb811eff90df67a03bf97045a

const columns = [
  {
    key: "fuel_date", label: "Date", sortable: true,
    render: (val) => val ? formatDate(val) : "—",
  },
  {
    key: "vehicle_info", label: "Vehicle",
    render: (_, row) => row.vehicles?.plate_number || "—",
  },
  {
    key: "driver_info", label: "Driver",
    render: (_, row) => {
      const emp = row.drivers?.employees;
      return emp ? `${emp.first_name} ${emp.last_name}` : "—";
    },
  },
  { key: "fuel_type", label: "Type" },
  {
    key: "liters", label: "Liters",
    render: (val) => val ? `${val} L` : "—",
  },
  {
    key: "price_per_liter", label: "Unit Price",
    render: (val) => val ? formatCurrency(val) : "—",
  },
  {
    key: "amount", label: "Total", sortable: true,
    render: (val) => val ? formatCurrency(val) : "—",
  },
];

export default function FuelPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "driver"]);
  const [search, setSearch] = useState("");

  const { data: records = [] } = useQuery({
    queryKey: ["fuel-records"],
    queryFn: () => getFuelRecords(),
  });

  const totalCost = records.reduce((s, r) => s + (r.total_cost || 0), 0);
  const totalLiters = records.reduce((s, r) => s + (r.quantity || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fuel Records</h1>
          <p className="text-foreground-secondary mt-1">Track fuel consumption and costs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-10"
            onClick={() => exportToCSV(records, "fuel-records", [
              { label: "Date", key: "fuel_date" },
              { label: "Vehicle", accessor: (r) => r.vehicles?.plate_number || "" },
              { label: "Driver", accessor: (r) => r.drivers?.employees ? `${r.drivers.employees.first_name} ${r.drivers.employees.last_name}` : "" },
              { label: "Fuel Type", key: "fuel_type" },
              { label: "Liters", key: "liters" },
              { label: "Price/Liter", key: "price_per_liter" },
              { label: "Total Amount", key: "amount" },
              { label: "Odometer", key: "odometer" },
            ])}
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button className="h-10">
            <Plus className="w-4 h-4 mr-2" />
            Add Record
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10"><Fuel className="w-5 h-5 text-primary" /></div>
            <div><p className="text-xl font-bold">{records.length}</p><p className="text-xs text-foreground-muted">Total Records</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-warning/10"><Fuel className="w-5 h-5 text-warning" /></div>
            <div><p className="text-xl font-bold">{totalLiters.toFixed(1)} L</p><p className="text-xs text-foreground-muted">Total Fuel</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-success/10"><Fuel className="w-5 h-5 text-success" /></div>
            <div><p className="text-xl font-bold">{formatCurrency(totalCost)}</p><p className="text-xs text-foreground-muted">Total Cost</p></div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={records}
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search fuel records..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
