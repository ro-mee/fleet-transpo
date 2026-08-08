"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FleetTable } from "@/components/tables/fleet-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Plus, Download, Truck, Wrench, AlertTriangle, CheckCircle2, Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getVehicles } from "@/services/vehicle.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { getUvvrpPolicy } from "@/services/settings.service";
import { isRestricted } from "@/lib/uvvrp/policy";
import { exportToCSV } from "@/lib/export";
import { useVehicleStatusSync } from "@/hooks/use-vehicle-status-sync";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";

export default function FleetVehiclesPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  useVehicleStatusSync();
  const router = useRouter();
  const [filters, setFilters] = useState({});

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });

  const { data: uvvrpPolicy } = useQuery({ queryKey: ["uvvrp-policy"], queryFn: getUvvrpPolicy });
  const restrictedPlates = new Set();
  if (uvvrpPolicy?.enabled) {
    vehicles.forEach((v) => {
      if (v.plate_number && isRestricted(v.plate_number, uvvrpPolicy, new Date())) restrictedPlates.add(v.plate_number);
    });
  }

  const stats = {
    total: vehicles.length,
    available: vehicles.filter((v) => v.vehicle_status === "Available" && !restrictedPlates.has(v.plate_number)).length,
    inUse: vehicles.filter((v) => v.vehicle_status === "In Use").length,
    maintenance: vehicles.filter((v) => v.vehicle_status === "Under Maintenance").length,
    outOfService: vehicles.filter((v) => v.vehicle_status === "Out of Service").length,
    registrationExpired: vehicles.filter((v) => v.vehicle_status === "Registration Expired").length,
    codingRestricted: restrictedPlates.size,
  };

  const statCards = [
    { label: "Total Vehicles", value: stats.total, icon: Truck, tone: "primary", trend: "in your fleet", active: !filters.status, onClick: () => setFilters({}) },
    { label: "Available", value: stats.available, icon: CheckCircle2, tone: "success", trend: "ready for dispatch", active: filters.status === "Available", onClick: () => setFilters({ status: "Available" }) },
    { label: "Coding Restricted", value: stats.codingRestricted, icon: AlertTriangle, tone: "warning", trend: "restricted today", active: false, onClick: () => setFilters({}) },
    { label: "In Use", value: stats.inUse, icon: Activity, tone: "info", trend: "on the road", active: filters.status === "In Use", onClick: () => setFilters({ status: "In Use" }) },
    { label: "Under Maintenance", value: stats.maintenance, icon: Wrench, tone: "warning", trend: "being serviced", active: filters.status === "Under Maintenance", onClick: () => setFilters({ status: "Under Maintenance" }) },
    { label: "Out of Service", value: stats.outOfService, icon: AlertTriangle, tone: "danger", trend: "cannot be dispatched", active: filters.status === "Out of Service", onClick: () => setFilters({ status: "Out of Service" }) },
    { label: "Registration Expired", value: stats.registrationExpired, icon: AlertTriangle, tone: "danger", trend: "renew immediately", active: filters.status === "Registration Expired", onClick: () => setFilters({ status: "Registration Expired" }) },
  ];

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Truck}
        title="Fleet Vehicles Registry"
        badge="Fleet Management"
        description="Manage and monitor your complete vehicle fleet."
        actions={
          <>
            <Button
              variant="outline"
              className={heroButtonOutlineClass}
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
            <Button className={heroButtonPrimaryClass} onClick={() => router.push("/fleet/vehicles/new")}>
              <Plus className="w-4 h-4 mr-2" />
              Add Vehicle
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              className={cn(
                "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-3 cursor-pointer select-none",
                card.active ? "border-primary bg-primary/10 shadow-xs" : "border-border/80 bg-surface hover:border-primary/40"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">{card.label}</span>
                <div className={cn("p-2 rounded-xl", {
                  "bg-primary/10 text-primary": card.tone === "primary",
                  "bg-success/10 text-success": card.tone === "success",
                  "bg-warning/10 text-warning": card.tone === "warning",
                  "bg-info/10 text-info": card.tone === "info",
                  "bg-danger/10 text-danger": card.tone === "danger"
                })}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-3xl font-medium text-foreground font-data">{isLoading ? "..." : card.value}</div>
                <p className={cn("text-[11px] font-medium mt-1", {
                  "text-primary": card.tone === "primary",
                  "text-success": card.tone === "success",
                  "text-warning": card.tone === "warning",
                  "text-info": card.tone === "info",
                  "text-danger": card.tone === "danger"
                })}>{card.trend}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilters({})}
          className={cn("px-4 h-8 rounded-full text-xs font-bold border transition-all cursor-pointer", !filters.status ? "bg-primary text-white dark:text-slate-950 border-primary" : "bg-surface text-foreground-secondary border-border/80 hover:border-primary/40")}
        >
          All
        </button>
        <button
          onClick={() => setFilters({ status: "Available" })}
          className={cn("px-4 h-8 rounded-full text-xs font-bold border transition-all cursor-pointer", filters.status === "Available" ? "bg-primary text-white dark:text-slate-950 border-primary" : "bg-surface text-foreground-secondary border-border/80 hover:border-primary/40")}
        >
          Available
        </button>
        <button
          onClick={() => setFilters({ status: "In Use" })}
          className={cn("px-4 h-8 rounded-full text-xs font-bold border transition-all cursor-pointer", filters.status === "In Use" ? "bg-primary text-white dark:text-slate-950 border-primary" : "bg-surface text-foreground-secondary border-border/80 hover:border-primary/40")}
        >
          In Use
        </button>
        <button
          onClick={() => setFilters({ status: "Under Maintenance" })}
          className={cn("px-4 h-8 rounded-full text-xs font-bold border transition-all cursor-pointer", filters.status === "Under Maintenance" ? "bg-primary text-white dark:text-slate-950 border-primary" : "bg-surface text-foreground-secondary border-border/80 hover:border-primary/40")}
        >
          Maintenance
        </button>
        <button
          onClick={() => setFilters({ status: "Registration Expired" })}
          className={cn("px-4 h-8 rounded-full text-xs font-bold border transition-all cursor-pointer", filters.status === "Registration Expired" ? "bg-primary text-white dark:text-slate-950 border-primary" : "bg-surface text-foreground-secondary border-border/80 hover:border-primary/40")}
        >
          Registration Expired
        </button>
      </div>

      <FleetTable filters={filters} />
    </div>
  );
}
