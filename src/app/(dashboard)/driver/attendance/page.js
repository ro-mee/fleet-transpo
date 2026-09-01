"use client";

import { useQuery } from "@tanstack/react-query";
import { getMyDriverProfile } from "@/services/driver.service";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Fingerprint } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { AttendanceCard } from "@/components/drivers/attendance-card";
import { HeroHeader } from "@/components/ui/hero-header";

export default function DriverAttendancePage() {
  useRequireRole();

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ["driver-me"],
    queryFn: getMyDriverProfile,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[400px] w-full rounded-2xl" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <EmptyState
        icon={Fingerprint}
        title="Attendance unavailable"
        description="We couldn't load your attendance records."
      />
    );
  }

  return (
    <DriverConsentGate>
      <div className="space-y-8 w-full">
        <HeroHeader
          icon={Fingerprint}
          title="My Attendance"
          badge="Driver Workspace"
          description="Track your attendance, working hours, and review your daily logs."
        />
        <AttendanceCard attendance={profile.attendance || []} />
      </div>
    </DriverConsentGate>
  );
}
