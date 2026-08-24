"use client";

// Merged resource availability board for the dispatch module. Combines the
// former /drivers/availability and /fleet/availability pages behind one
// Drivers | Vehicles switcher so a dispatcher can check readiness without
// leaving the assignment workflow. The boards themselves live in
// components/dispatch/*-availability-board.jsx and own their data.

import { useState } from "react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { HeroHeader } from "@/components/ui/hero-header";
import { DriverAvailabilityBoard } from "@/components/dispatch/driver-availability-board";
import { VehicleAvailabilityBoard } from "@/components/dispatch/vehicle-availability-board";
import { Users, CarFront } from "lucide-react";
import { cn } from "@/lib/utils";

const RESOURCES = [
  { id: "drivers", label: "Drivers", icon: Users },
  { id: "vehicles", label: "Vehicles", icon: CarFront },
];

export default function ResourceAvailabilityPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);

  const [resource, setResource] = useState("drivers");

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Users}
        title="Resource Availability"
        badge="Dispatch"
        description="Live view of driver and vehicle readiness for assignment."
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Resource type">
        {RESOURCES.map((r) => {
          const Icon = r.icon;
          const active = resource === r.id;
          return (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setResource(r.id)}
              className={cn(
                "inline-flex items-center gap-2 px-5 h-9 rounded-full text-sm font-bold border transition-all cursor-pointer",
                active
                  ? "bg-primary text-white dark:text-slate-950 border-primary shadow-xs"
                  : "bg-surface border-border/60 text-foreground-secondary hover:border-primary/40 hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {r.label}
            </button>
          );
        })}
      </div>

      {resource === "drivers" ? <DriverAvailabilityBoard /> : <VehicleAvailabilityBoard />}
    </div>
  );
}
