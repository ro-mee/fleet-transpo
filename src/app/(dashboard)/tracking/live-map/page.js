"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { getActiveTrips, getLatestLocations } from "@/services/trip.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { Truck, Navigation, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRequireRole } from "@/lib/auth/role-guard";

const LiveLocationsMap = dynamic(
  () => import("@/components/maps/live-locations-map"),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-hover" /> }
);

export default function LiveMapPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();

  const { data: activeTrips = [], refetch: refetchTrips } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 30000,
  });

  const { data: locations = [], isLoading: locationsLoading } = useQuery({
    queryKey: ["latest-locations"],
    queryFn: () => getLatestLocations(),
    refetchInterval: 15000,
  });

  const handleRefresh = () => {
    refetchTrips();
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Navigation}
        title="Live GPS Tracking"
        badge="Tracking"
        description={`${activeTrips.length} vehicle${activeTrips.length === 1 ? "" : "s"} currently active — updated every 15 seconds.`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="success" className="gap-1.5 px-3 py-1 text-xs rounded-full font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              Live
            </Badge>
            <Button variant="outline" size="sm" onClick={handleRefresh} className={cn(heroButtonOutlineClass)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Card className="border-0 shadow-sm overflow-hidden">
            <div className="h-[600px] bg-muted/30">
              {!locationsLoading && locations.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <EmptyState
                    icon={Navigation}
                    title="No live locations"
                    description="Active vehicles with GPS updates will appear on the map."
                  />
                </div>
              ) : (
                <LiveLocationsMap locations={locations} />
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Active Vehicles</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {activeTrips.length === 0 ? (
                <div className="p-4 text-center text-sm text-foreground-muted">
                  No active vehicles
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {activeTrips.map((trip) => (
                    <div
                      key={trip.trip_id}
                      className="flex items-center gap-3 p-3 hover:bg-hover cursor-pointer transition-colors"
                      onClick={() => router.push(`/trips/${trip.trip_id}`)}
                    >
                      <div className="p-1.5 rounded-lg bg-success/10">
                        <Truck className="w-4 h-4 text-success" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {trip.vehicles?.plate_number || "—"}
                        </p>
                        <p className="text-xs text-foreground-muted">
                          {trip.drivers?.first_name || "—"}
                        </p>
                      </div>
                      <StatusBadge status={trip.trip_status} entity="trip" className="text-[11px]" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Legend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-success" />
                  <span className="text-foreground-secondary">En Route</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-warning" />
                  <span className="text-foreground-secondary">Trip Started</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-primary" />
                  <span className="text-foreground-secondary">Arrived</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-danger" />
                  <span className="text-foreground-secondary">Idle</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
