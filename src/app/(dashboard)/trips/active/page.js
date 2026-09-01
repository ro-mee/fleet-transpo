"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CardSkeleton } from "@/components/ui/skeleton";
import { getActiveTrips } from "@/services/trip.service";
import { formatTime } from "@/lib/utils";
import { Truck, Users, MapPin, Navigation, Clock, Route } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

// pg returns DECIMAL columns as strings — coerce before formatting, mirroring
// the dispatch card's num() helper.
const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };

export default function ActiveTripsPage() {
  useRequireRole();
  const router = useRouter();

  const {
    data: activeTrips = [],
    isLoading,
  } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Route}
        title="Active Trips"
        badge="Operations"
        description={`${activeTrips.length} trip${activeTrips.length === 1 ? "" : "s"} currently in progress — updated every 15 seconds.`}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push("/tracking/live-map")} className={heroButtonOutlineClass}>
            <MapPin className="w-4 h-4 mr-2" />
            Live Map
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : activeTrips.length === 0 ? (
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
              role="link"
              tabIndex={0}
              aria-label={`Open trip #${trip.trip_id}`}
              className="cursor-pointer transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={() => router.push(`/trips/${trip.trip_id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  router.push(`/trips/${trip.trip_id}`);
                }
              }}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-foreground">
                    Trip #{trip.trip_id}
                  </span>
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
                  {(num(trip.distance) ?? 0) > 0 && (
                    <div className="flex items-center gap-2">
                      <Navigation className="w-4 h-4 text-foreground-muted" />
                      <span className="text-foreground-secondary">{num(trip.distance).toFixed(1)} km</span>
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
