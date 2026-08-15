"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FleetTable } from "@/components/tables/fleet-table";
import { FleetGrid } from "@/components/tables/fleet-grid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Plus, Download, Truck, Wrench, AlertTriangle, CheckCircle2, Activity, LayoutGrid, List } from "lucide-react";
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
  const [viewMode, setViewMode] = useState("grid");

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
    refetchInterval: 30_000,
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

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {statCards.map((card) => {
          const Icon = card.icon;
          const t = TONE_MAP[card.tone] || TONE_MAP.primary;
          return (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden group",
                card.active
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
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{isLoading ? "\u2026" : card.value}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
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
        <div className="flex items-center gap-1 bg-surface border border-border/80 p-1 rounded-full shadow-xs">
          <button onClick={() => setViewMode("grid")} className={cn("p-1.5 rounded-full transition-all cursor-pointer", viewMode === "grid" ? "bg-primary text-white shadow-sm" : "text-foreground-secondary hover:text-foreground")}><LayoutGrid className="w-4 h-4" /></button>
          <button onClick={() => setViewMode("list")} className={cn("p-1.5 rounded-full transition-all cursor-pointer", viewMode === "list" ? "bg-primary text-white shadow-sm" : "text-foreground-secondary hover:text-foreground")}><List className="w-4 h-4" /></button>
        </div>
      </div>

      {viewMode === "grid" ? (
        <FleetGrid filters={filters} />
      ) : (
        <FleetTable filters={filters} />
      )}
    </div>
  );
}
