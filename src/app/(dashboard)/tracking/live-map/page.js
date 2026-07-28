"use client";

import { useQuery } from "@tanstack/react-query";
import { getActiveTrips } from "@/services/trip.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Truck, MapPin, Navigation, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function LiveMapPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();
  const [mapLoaded, setMapLoaded] = useState(false);

  const { data: activeTrips = [] } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 30000,
  });

  useEffect(() => {
    import("leaflet/dist/leaflet.css").then(() => {
      setMapLoaded(true);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Live GPS Tracking</h1>
          <p className="text-foreground-secondary mt-1">
            {activeTrips.length} vehicle(s) currently active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success" className="gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            Live
          </Badge>
          <Button variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Card className="border-0 shadow-sm overflow-hidden">
            <div className="h-[600px] bg-muted/30 flex items-center justify-center">
              {mapLoaded ? (
                <div className="text-center text-foreground-muted">
                  <MapPin className="w-12 h-12 mx-auto mb-3" />
                  <p className="text-lg font-medium">Interactive Map</p>
                  <p className="text-sm">React Leaflet + OpenStreetMap tiles</p>
                  <div className="mt-4 space-y-2">
                    {activeTrips.map((trip) => (
                      <div key={trip.trip_id} className="flex items-center gap-2 text-xs text-left bg-surface/80 p-2 rounded-lg">
                        <span className="w-2 h-2 rounded-full bg-success" />
                        <span className="font-medium">{trip.vehicles?.plate_number}</span>
                        <span className="text-foreground-muted">—</span>
                        <span>{trip.drivers?.employees?.first_name}</span>
                        <Badge variant="success" className="text-[10px]">{trip.trip_status}</Badge>
                      </div>
                    ))}
                    {activeTrips.length === 0 && (
                      <p className="text-xs text-foreground-muted">No active vehicles to display</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="animate-pulse text-foreground-muted">Loading map...</div>
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
                        {trip.drivers?.employees?.first_name || "—"}
                      </p>
                    </div>
                    <Navigation className="w-3.5 h-3.5 text-success animate-pulse" />
                  </div>
                ))}
                {activeTrips.length === 0 && (
                  <div className="p-4 text-center text-sm text-foreground-muted">
                    No active vehicles
                  </div>
                )}
              </div>
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
