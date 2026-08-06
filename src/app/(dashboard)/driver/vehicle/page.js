"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getMyVehicleInspection } from "@/services/driver.service";
import { formatDate } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { CarFront, TriangleAlert } from "lucide-react";

export default function DriverVehiclePage() {
  useRequireRole(["driver"]);

  const { data: inspection, isLoading, isError } = useQuery({
    queryKey: ["driver-inspection"],
    queryFn: getMyVehicleInspection,
  });

  return (
    <DriverConsentGate>
      <div className="space-y-6">
        <PageHeader
          eyebrow="My Work"
          title="My Vehicle"
          description="The vehicle assigned to you and its latest inspection status."
        />

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <CarFront className="w-4 h-4 text-primary" /> Assigned Vehicle
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : isError ? (
              <EmptyState
                icon={TriangleAlert}
                title="Could not load vehicle"
                description="Something went wrong reading your assigned vehicle."
                className="py-8"
              />
            ) : inspection ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <p className="text-foreground-muted">Vehicle</p>
                  <p className="font-medium mt-1">{inspection.plate_number || `#${inspection.vehicle_id}`}</p>
                </div>
                <div>
                  <p className="text-foreground-muted">Vehicle Status</p>
                  <p className="mt-1">
                    {inspection.vehicle_status ? <StatusBadge status={inspection.vehicle_status} entity="vehicle" /> : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-foreground-muted">Last Inspection</p>
                  <p className="font-medium mt-1">{inspection.inspection_date ? formatDate(inspection.inspection_date) : "—"}</p>
                </div>
                <div>
                  <p className="text-foreground-muted">Inspection Status</p>
                  <p className="mt-1"><StatusBadge status={inspection.status} entity="vehicle" /></p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-foreground-muted">Inspection Type</p>
                  <p className="font-medium mt-1">{inspection.inspection_type || "—"}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-foreground-muted">Findings</p>
                  <p className="font-medium mt-1">{inspection.findings || "No findings"}</p>
                </div>
                {inspection.severity && (
                  <div className="md:col-span-4">
                    <p className="text-foreground-muted">Condition</p>
                    <p className="mt-1">
                      <StatusBadge
                        severity={inspection.severity === "Critical" ? "danger" : inspection.severity === "Major" ? "warning" : "info"}
                      />
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon={CarFront}
                title="No vehicle assigned"
                description="Your assigned vehicle and its inspection status will appear here."
                className="py-8"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DriverConsentGate>
  );
}
