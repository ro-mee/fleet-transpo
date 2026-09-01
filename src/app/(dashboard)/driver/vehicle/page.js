"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HeroHeader } from "@/components/ui/hero-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getMyVehicleInspection } from "@/services/driver.service";
import { formatDate } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { FullscreenReceiptDialog } from "@/components/fuel/fullscreen-receipt-dialog";
import { CarFront, TriangleAlert, Maximize } from "lucide-react";

export default function DriverVehiclePage() {
  useRequireRole();
  const [zoomImageUrl, setZoomImageUrl] = useState(null);

  const { data: inspection, isLoading, isError } = useQuery({
    queryKey: ["driver-inspection"],
    queryFn: getMyVehicleInspection,
  });

  return (
    <DriverConsentGate>
      <div className="space-y-6">
        <HeroHeader
          icon={CarFront}
          title="My Vehicle"
          badge="My Work"
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
              <div className="flex flex-col md:flex-row gap-6">
                {inspection.image_url && (
                  <div 
                    className="shrink-0 relative group cursor-pointer rounded-xl overflow-hidden border border-border shadow-sm w-full md:w-48 h-32"
                    onClick={() => setZoomImageUrl(inspection.image_url)}
                  >
                    <img
                      src={inspection.image_url}
                      alt="Vehicle"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center text-white">
                      <Maximize className="w-5 h-5 mb-1" />
                      <span className="text-[11px] font-bold tracking-wide">Full View</span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs flex-1">
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

      {/* ── FULLSCREEN IMAGE ZOOM DIALOG ── */}
      <FullscreenReceiptDialog
        open={!!zoomImageUrl}
        onOpenChange={(open) => {
          if (!open) setZoomImageUrl(null);
        }}
        receiptUrl={zoomImageUrl}
        title="Vehicle Full View"
      />
    </DriverConsentGate>
  );
}
