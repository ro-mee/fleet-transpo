"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyDriverProfile } from "@/services/driver.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import {
  Truck, CarFront, Fuel, AlertTriangle, IdCard,
  ClipboardList, ShieldCheck, ChevronRight, CalendarCheck,
} from "lucide-react";

const MODULES = [
  { href: "/driver/trips", label: "My Trips", description: "Your assigned trips and history.", icon: Truck },
  { href: "/driver/vehicle", label: "My Vehicle", description: "Assigned vehicle and inspection status.", icon: CarFront },
  { href: "/driver/fuel", label: "Fuel Logs", description: "Log fuel and track verification.", icon: Fuel },
  { href: "/driver/incidents", label: "Incident Reporting", description: "Report an incident or near miss.", icon: AlertTriangle },
  { href: "/driver/profile", label: "Profile & Credentials", description: "License, performance and attendance.", icon: IdCard },
];

function Stat({ label, value }) {
  return (
    <div className="p-3 rounded-xl bg-muted/40">
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[11px] text-foreground-muted">{label}</p>
    </div>
  );
}

export default function DriverHomePage() {
  useRequireRole(["driver"]);

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ["driver-me"],
    queryFn: getMyDriverProfile,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <Skeleton className="h-8 w-64" />
        <div className="h-40 bg-muted rounded-2xl animate-pulse" />
        <div className="h-72 bg-muted rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Driver profile unavailable"
        description="We couldn't load your profile. Please try again or contact your fleet administrator."
      />
    );
  }

  return (
    <DriverConsentGate>
      <div className="space-y-6 max-w-5xl">
        <PageHeader
          title={`Hello, ${profile.firstName}`}
          description="Welcome to your Driver Workspace. Pick a module below to get started."
        />

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-primary" /> My Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <Stat label="Total Trips" value={profile.performance?.total_trips ?? 0} />
            <Stat label="Distance" value={`${Math.round(profile.performance?.total_distance ?? 0)} km`} />
            <Stat label="Hours" value={`${Math.round(profile.performance?.total_hours ?? 0)}h`} />
            <Stat label="Rating" value={`${((profile.performance?.rating ?? 0) * 20).toFixed(0)}/100`} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MODULES.map((mod) => (
            <Link
              key={mod.href}
              href={mod.href}
              className="group rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <mod.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{mod.label}</p>
                    <p className="text-xs text-foreground-secondary mt-0.5">{mod.description}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-foreground-muted transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </DriverConsentGate>
  );
}
