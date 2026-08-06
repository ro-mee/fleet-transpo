"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FleetTable } from "@/components/tables/fleet-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { Plus, Download, Truck, Wrench, AlertTriangle, CheckCircle2, Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getVehicles } from "@/services/vehicle.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";
import { useVehicleStatusSync } from "@/hooks/use-vehicle-status-sync";

export default function FleetVehiclesPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  useVehicleStatusSync();
  const router = useRouter();
  const [filters, setFilters] = useState({});

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });

  const stats = {
    total: vehicles.length,
    available: vehicles.filter((v) => v.vehicle_status === "Available").length,
    inUse: vehicles.filter((v) => v.vehicle_status === "In Use").length,
    maintenance: vehicles.filter((v) => v.vehicle_status === "Under Maintenance").length,
    outOfService: vehicles.filter((v) => v.vehicle_status === "Out of Service").length,
    registrationExpired: vehicles.filter((v) => v.vehicle_status === "Registration Expired").length,
  };

  const statCards = [
    { label: "Total Vehicles", value: stats.total, icon: Truck, tone: "primary", trend: "in your fleet", active: !filters.status, onClick: () => setFilters({}) },
    { label: "Available", value: stats.available, icon: CheckCircle2, tone: "success", trend: "ready for dispatch", active: filters.status === "Available", onClick: () => setFilters({ status: "Available" }) },
    { label: "In Use", value: stats.inUse, icon: Activity, tone: "info", trend: "on the road", active: filters.status === "In Use", onClick: () => setFilters({ status: "In Use" }) },
    { label: "Under Maintenance", value: stats.maintenance, icon: Wrench, tone: "warning", trend: "being serviced", active: filters.status === "Under Maintenance", onClick: () => setFilters({ status: "Under Maintenance" }) },
    { label: "Out of Service", value: stats.outOfService, icon: AlertTriangle, tone: "danger", trend: "cannot be dispatched", active: filters.status === "Out of Service", onClick: () => setFilters({ status: "Out of Service" }) },
    { label: "Registration Expired", value: stats.registrationExpired, icon: AlertTriangle, tone: "danger", trend: "renew immediately", active: filters.status === "Registration Expired", onClick: () => setFilters({ status: "Registration Expired" }) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Fleet Vehicles"
        description="Manage and monitor your vehicle fleet."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => exportToCSV(vehicles, "fleet-vehicles", [
                { label: "Plate Number", key: "plate_number" },
                { label: "Vehicle Name", key: "vehicle_name" },
                { label: "Manufacturer", key: "manufacturer" },
                { label: "Model", key: "model" },
                { label: "Year", key: "year" },
                { label: "Color", key: "color" },
                { label: "Fuel Type", key: "fuel_type" },
                { label: "Seating Capacity", key: "seating_capacity" },
                { label: "Mileage (km)", key: "mileage" },
                { label: "Fuel Level (%)", key: "fuel_level" },
                { label: "Status", key: "vehicle_status" },
                { label: "Category", accessor: (v) => v.vehiclecategories?.category_name || "" },
                { label: "Purchase Price", key: "purchase_price" },
                { label: "Insurance Expiry", key: "insurance_expiry" },
              ])}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button onClick={() => router.push("/fleet/vehicles/new")}>
              <Plus className="w-4 h-4 mr-2" />
              Add Vehicle
            </Button>
          </>
        }
      />

      {isLoading ? (
        <StatsGridSkeleton count={6} />
      ) : (
        <StatGrid cols={6}>
          {statCards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </StatGrid>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={!filters.status ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters({})}
        >
          All
        </Button>
        <Button
          variant={filters.status === "Available" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters({ status: "Available" })}
        >
          Available
        </Button>
        <Button
          variant={filters.status === "In Use" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters({ status: "In Use" })}
        >
          In Use
        </Button>
        <Button
          variant={filters.status === "Under Maintenance" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters({ status: "Under Maintenance" })}
        >
          Maintenance
        </Button>
        <Button
          variant={filters.status === "Registration Expired" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters({ status: "Registration Expired" })}
        >
          Registration Expired
        </Button>
      </div>

      <FleetTable filters={filters} />
    </div>
  );
}
