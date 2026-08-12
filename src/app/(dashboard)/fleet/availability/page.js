"use client";

import { useQuery } from "@tanstack/react-query";
import { Truck, CheckCircle2, CalendarClock, Activity, Wrench, Ban, Fuel, Users, Gauge } from "lucide-react";
import { getVehicles } from "@/services/vehicle.service";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeroHeader } from "@/components/ui/hero-header";
import { useRequireRole } from "@/lib/auth/role-guard";
import { StatusBoard, BoardCardBase, BoardCardKicker, BoardCardTitle, BoardCardMeta } from "@/components/boards/status-board";

const VEHICLE_LANES = [
  { status: "Available", label: "Available", icon: CheckCircle2, tone: "success", empty: "No vehicles idle", emptyHint: "Nothing waiting for a dispatch" },
  { status: "Reserved", label: "Reserved", icon: CalendarClock, tone: "info", empty: "No reservations", emptyHint: "Nothing booked ahead" },
  { status: "In Use", label: "In Use", icon: Activity, tone: "warning", empty: "None active", emptyHint: "No trips on the road" },
  { status: "Under Maintenance", label: "Maintenance", icon: Wrench, tone: "warning", empty: "Nothing in the shop", emptyHint: "All vehicles road-ready" },
  { status: "Decommissioned", label: "Decommissioned", icon: Ban, tone: "secondary", empty: "Fleet fully active", emptyHint: "No retired vehicles" },
];

function chips(vehicle) {
  return [
    { icon: Fuel, label: `${vehicle.fuel_level ?? 0}% fuel` },
    { icon: Users, label: `${vehicle.seating_capacity ?? 0} seats` },
    { icon: Gauge, label: `${(vehicle.mileage ?? 0).toLocaleString()} km` },
  ];
}

export default function FleetAvailabilityPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles-availability"],
    queryFn: () => getVehicles(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Truck}
        title="Vehicle Availability Board"
        badge="Fleet Readiness"
        description="Every vehicle in the fleet, grouped by status. Click a card to open the vehicle record."
      />

      <StatusBoard
        columns={VEHICLE_LANES}
        items={vehicles}
        getStatus={(v) => v.vehicle_status}
        loading={isLoading}
        gridClass="xl:grid-cols-3 2xl:grid-cols-5"
        renderCard={(v) => {
          const cat = v.vehiclecategories?.category_name;
          return (
            <BoardCardBase key={v.vehicle_id} href={`/fleet/vehicles/${v.vehicle_id}`}>
              <BoardCardKicker>
                <span className="font-black font-data tracking-wider">{v.plate_number || "—"}</span>
              </BoardCardKicker>
              <div className="flex items-start justify-between gap-2">
                <BoardCardTitle>{v.vehicle_name || v.model || "Vehicle"}</BoardCardTitle>
                <StatusBadge status={v.vehicle_status} entity="vehicle" className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" />
              </div>
              <BoardCardMeta>
                {[cat, v.manufacturer, v.year].filter(Boolean).join(" • ") || "—"}
              </BoardCardMeta>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {chips(v).map(({ icon: Icon, label }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[10px] font-bold text-foreground-secondary font-data"
                  >
                    <Icon className="h-3 w-3 text-foreground-muted" />
                    {label}
                  </span>
                ))}
              </div>
            </BoardCardBase>
          );
        }}
        empty={{
          title: "No vehicles on the board",
          description: "Your fleet list is empty, or nothing matches these status lanes.",
        }}
      />
    </div>
  );
}