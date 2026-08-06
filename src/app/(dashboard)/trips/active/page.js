"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getActiveTrips } from "@/services/trip.service";
import { formatTime } from "@/lib/utils";
import { Truck, Users, MapPin, Navigation, Clock, Route } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function ActiveTripsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();

  const { data: activeTrips = [] } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Active Trips"
        description={`${activeTrips.length} trip${activeTrips.length === 1 ? "" : "s"} currently in progress — updated every 15 seconds.`}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push("/tracking/live-map")}>
            <MapPin className="w-4 h-4 mr-2" />
            Live Map
          </Button>
        }
      />

      {activeTrips.length === 0 ? (
        <EmptyState
          icon={Route}
          title="No active trips"
          description="All trips are completed or pending dispatch. Trips show here the moment a dispatch goes in progress."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {activeTrips.map((trip) => (
            <Card
              key={trip.trip_id}
              className="cursor-pointer transition-all hover:shadow-md"
              onClick={() => router.push(`/trips/${trip.trip_id}`)}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                    <span className="text-sm font-medium text-foreground">
                      Trip #{trip.trip_id}
                    </span>
                  </div>
                  <StatusBadge status={trip.trip_status} entity="trip" />
                </div>

                <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-foreground-muted" />
                    <span className="text-foreground-secondary">{trip.vehicles?.plate_number || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-foreground-muted" />
                    <span className="text-foreground-secondary">
                      {trip.drivers?.first_name || "—"} {trip.drivers?.last_name || ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-danger" />
                    <span className="text-foreground-secondary truncate">
                      {trip.transportation_requests?.pickup_location || trip.routes?.origin || "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-success" />
                    <span className="text-foreground-secondary truncate">
                      {trip.transportation_requests?.dropoff_location || trip.routes?.destination || "—"}
                    </span>
                  </div>
                  {trip.start_time && (
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-foreground-muted" />
                      <span className="text-foreground-secondary">{formatTime(trip.start_time)}</span>
                    </div>
                  )}
                  {trip.distance > 0 && (
                    <div className="flex items-center gap-2">
                      <Navigation className="w-4 h-4 text-foreground-muted" />
                      <span className="text-foreground-secondary">{trip.distance} km</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
