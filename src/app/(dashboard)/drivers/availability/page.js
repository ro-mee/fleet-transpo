"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Users,
  UserCheck,
  Truck,
  Clock,
  Palmtree,
  Ban,
  ShieldCheck,
  Mail,
  Phone,
} from "lucide-react";
import { getDrivers } from "@/services/driver.service";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeroHeader } from "@/components/ui/hero-header";
import { useRequireRole } from "@/lib/auth/role-guard";
import { StatusBoard, BoardCardBase, BoardCardTitle, BoardCardMeta } from "@/components/boards/status-board";
import { toCalendarDay } from "@/lib/dates";

const DRIVER_LANES = [
  { status: "Available", label: "Available", icon: UserCheck, tone: "success", empty: "No drivers idle", emptyHint: "Everyone is busy or scheduled" },
  { status: "On Trip", label: "On Trip", icon: Truck, tone: "warning", empty: "Nobody rolling", emptyHint: "No trips in progress" },
  { status: "Off Duty", label: "Off Duty", icon: Clock, tone: "secondary", empty: "None off duty", emptyHint: "All drivers signed on" },
  { status: "On Leave", label: "On Leave", icon: Palmtree, tone: "info", empty: "Nobody on leave", emptyHint: "Full staffing today" },
  { status: "Suspended", label: "Suspended", icon: Ban, tone: "danger", empty: "No suspensions", emptyHint: "No discipline actions in force" },
];

function licenseReminder(expiry) {
  const day = toCalendarDay(expiry);
  if (!day) return null;
  const today = toCalendarDay(new Date());
  if (day < today) return { label: "License expired", variant: "danger" };
  const daysLeft = Math.round((new Date(`${day}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86_400_000);
  if (daysLeft <= 14) return { label: `Expires in ${daysLeft}d`, variant: "warning" };
  if (daysLeft <= 30) return { label: `Expires in ${daysLeft}d`, variant: "info" };
  return null;
}

function driverInitials(d) {
  const e = d.employees;
  const name = e ? `${e.first_name} ${e.last_name}` : "Unassigned driver";
  return { name, initials: name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "DR" };
}

export default function DriversAvailabilityPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ["drivers-availability"],
    queryFn: () =>
      getDrivers({
        includeUnlinked: 1,
      }),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Users}
        title="Driver Availability Board"
        badge="Dispatch Readiness"
        description="Every operational driver, grouped by duty status. Click a card to open the driver profile."
      />

      <StatusBoard
        columns={DRIVER_LANES}
        items={drivers}
        getStatus={(d) => d.driver_status || "Available"}
        loading={isLoading}
        gridClass="xl:grid-cols-3 2xl:grid-cols-5"
        renderCard={(d) => {
          const { name, initials } = driverInitials(d);
          const reminder = licenseReminder(d.license_expiry);
          const e = d.employees;
          return (
            <BoardCardBase key={d.driver_id} href={`/drivers/${d.driver_id}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60 font-black text-xs text-foreground border border-border/40">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <BoardCardTitle>{name}</BoardCardTitle>
                    <StatusBadge status={d.driver_status || "Available"} entity="driver" className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" />
                  </div>
                  <BoardCardMeta>
                    <span className="inline-flex items-center gap-1 font-data font-bold">
                      <ShieldCheck className="h-3 w-3 text-foreground-muted" />
                      Class {d.license_class || "—"}
                    </span>
                    <span className="mx-1">•</span>
                    {d.years_of_experience || 0} yrs exp
                    {reminder && (
                      <span className="ml-1">
                        <StatusBadge variant={reminder.variant} className="rounded-full px-2 py-0.5 text-[10px] font-bold">
                          {reminder.label}
                        </StatusBadge>
                      </span>
                    )}
                  </BoardCardMeta>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {e?.phone && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[10px] font-bold text-foreground-secondary font-data">
                        <Phone className="h-3 w-3 text-foreground-muted" />
                        {e.phone}
                      </span>
                    )}
                    {e?.email && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[10px] font-bold text-foreground-secondary font-data">
                        <Mail className="h-3 w-3 text-foreground-muted" />
                        {e.email}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </BoardCardBase>
          );
        }}
        empty={{
          title: "No drivers on the board",
          description: "Your driver directory is empty, or nothing matches these duty lanes.",
        }}
      />
    </div>
  );
}