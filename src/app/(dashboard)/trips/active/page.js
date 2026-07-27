"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getActiveTrips } from "@/services/trip.service";
import { formatTime, formatDistance, formatDuration } from "@/lib/utils";
import { Truck, Users, MapPin, Navigation, Clock, ArrowRight } from "lucide-react";

export default function ActiveTripsPage() {
  const router = useRouter();

  const { data: activeTrips = [] } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Active Trips</h1>
          <p className="text-foreground-secondary mt-1">{activeTrips.length} trip(s) currently in progress</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push("/tracking/live-map")}>
          <MapPin className="w-4 h-4 mr-2" />
          Live Map
        </Button>
      </div>

      {activeTrips.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center text-foreground-muted">
            <Navigation className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No active trips</p>
            <p className="text-sm mt-1">All trips are completed or pending dispatch</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {activeTrips.map((trip) => (
            <Card
              key={trip.trip_id}
              className="cursor-pointer"
              onClick={() => router.push(`/trips/${trip.trip_id}`)}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    <span className="text-sm font-medium text-foreground">
                      Trip #{trip.trip_id}
                    </span>
                  </div>
                  <Badge variant="success" className="text-xs">{trip.trip_status}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-foreground-muted" />
                    <span className="text-foreground-secondary">{trip.vehicles?.plate_number || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-foreground-muted" />
                    <span className="text-foreground-secondary">
                      {trip.drivers?.employees?.first_name || "—"} {trip.drivers?.employees?.last_name || ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-danger" />
                    <span className="text-foreground-secondary truncate">{trip.origin || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-success" />
                    <span className="text-foreground-secondary truncate">{trip.destination || "—"}</span>
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

                <div className="mt-3 pt-3 border-t border-border">
                  <Button variant="ghost" size="sm" className="w-full text-xs">
                    View Details <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
