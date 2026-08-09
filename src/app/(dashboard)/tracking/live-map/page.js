"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { getActiveTrips, getLatestLocations } from "@/services/trip.service";
import { getAllIncidents } from "@/services/driver.service";
import { apiFetch } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { Truck, Navigation, RefreshCw, Eye, Route, Building2, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRequireRole } from "@/lib/auth/role-guard";

const LiveLocationsMap = dynamic(
  () => import("@/components/maps/live-locations-map"),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-hover" /> }
);

// Coco Hotel & Resort coordinates fallback
const COCO_HOTEL_COORDS = [14.5547, 121.0244];
const COCO_HOTEL_NAME = "Coco Hotel & Resort";

export default function LiveMapPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();

  const [selectedTripId, setSelectedTripId] = useState(null);

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

  const { data: incidents = [] } = useQuery({
    queryKey: ["all-incidents"],
    queryFn: () => getAllIncidents({ limit: 200 }),
    refetchInterval: 60000,
  });

  // Pick selected active trip or default to first active trip
  const activeTrip = useMemo(() => {
    if (selectedTripId) return activeTrips.find((t) => t.trip_id === selectedTripId) || activeTrips[0];
    return activeTrips[0];
  }, [activeTrips, selectedTripId]);

  // Match live driver location
  const driverLoc = useMemo(() => {
    if (!activeTrip) return locations[0] || null;
    const plate = activeTrip.vehicles?.plate_number;
    return locations.find((l) => l.plate_number === plate || l.vehicle_id === activeTrip.vehicle_id) || locations[0] || null;
  }, [activeTrip, locations]);

  // Destination coords (from trip route or Coco Hotel default)
  const destCoords = useMemo(() => {
    if (activeTrip?.routes?.destination_latitude && activeTrip?.routes?.destination_longitude) {
      return [Number(activeTrip.routes.destination_latitude), Number(activeTrip.routes.destination_longitude)];
    }
    return COCO_HOTEL_COORDS;
  }, [activeTrip]);

  const destName = useMemo(() => {
    return activeTrip?.routes?.dropoff_location || activeTrip?.routes?.route_name || COCO_HOTEL_NAME;
  }, [activeTrip]);

  const originCoords = useMemo(() => {
    if (driverLoc?.latitude && driverLoc?.longitude) {
      return [Number(driverLoc.latitude), Number(driverLoc.longitude)];
    }
    if (activeTrip?.routes?.origin_latitude && activeTrip?.routes?.origin_longitude) {
      return [Number(activeTrip.routes.origin_latitude), Number(activeTrip.routes.origin_longitude)];
    }
    return null;
  }, [driverLoc, activeTrip]);

  // Fetch TomTom route from Driver Live Loc -> Hotel Destination
  const { data: routeData = null } = useQuery({
    queryKey: ["driver-hotel-route", activeTrip?.trip_id, originCoords, destCoords],
    queryFn: async () => {
      if (!originCoords || !destCoords) return null;
      const res = await apiFetch(
        `/api/tomtom/route?origin=${originCoords[1]},${originCoords[0]}&destination=${destCoords[1]},${destCoords[0]}`
      );
      return res ?? null;
    },
    enabled: !!originCoords && !!destCoords,
    retry: 0,
    staleTime: 10000,
  });

  const handleRefresh = () => {
    refetchTrips();
  };

  const rawDriverName = activeTrip?.drivers ? `${activeTrip.drivers.first_name || ""} ${activeTrip.drivers.last_name || ""}`.trim() : "Driver";
  const driverName = rawDriverName
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
  const driverPlate = activeTrip?.vehicles?.plate_number || "Vehicle";

  return (
    <div className="space-y-6 pb-12 select-none">
      <HeroHeader
        icon={Navigation}
        title="Live GPS Tracking & Route Navigation"
        badge="Live Routing"
        description={`Tracking driver ${driverName} (${driverPlate}) live GPS route to ${destName}.`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="success" className="gap-1.5 px-3 py-1 text-xs rounded-full font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              Live Route Feed
            </Badge>
            <Button variant="outline" size="sm" onClick={handleRefresh} className={cn(heroButtonOutlineClass)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Sync GPS
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* MAIN MAP AREA (9 COLS) */}
        <div className="lg:col-span-8 xl:col-span-9">
          <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
            <div className="h-[640px] bg-muted/20">
              {!locationsLoading && locations.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <EmptyState
                    icon={Navigation}
                    title="No live locations"
                    description="Active vehicles with GPS updates will appear on the map."
                  />
                </div>
              ) : (
                <LiveLocationsMap
                  locations={locations}
                  route={routeData?.coordinates ?? null}
                  waypoints={{
                    origin: originCoords,
                    destination: destCoords,
                  }}
                  originName={`Driver: ${driverName} (${driverPlate})`}
                  destinationName={destName}
                  routeDistanceKm={routeData?.distanceKm ?? null}
                  routeTravelMin={routeData?.travelTimeMin ?? null}
                  instructions={routeData?.instructions ?? []}
                  showNavigationPanel={true}
                  incidents={incidents}
                  traffic
                />
              )}
            </div>
          </Card>
        </div>

        {/* SIDEBAR ACTIVE VEHICLES & HOTEL ROUTE SELECTOR (3-4 COLS) */}
        <div className="lg:col-span-4 xl:col-span-3 space-y-4">
          <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
            <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2 text-foreground">
                  <Building2 className="w-4 h-4 text-primary" /> Active Hotel Trips
                </span>
                <Badge variant="outline" className="text-[11px] font-medium font-data rounded-full">
                  {activeTrips.length} Active
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {activeTrips.length === 0 ? (
                <div className="p-6 text-center text-xs text-foreground-muted">
                  No active vehicles en route to Coco Hotel
                </div>
              ) : (
                <div className="divide-y divide-border/60 max-h-[420px] overflow-y-auto">
                  {activeTrips.map((trip) => {
                    const plate = trip.vehicles?.plate_number || `Trip #${trip.trip_id}`;
                    const driver = trip.drivers ? `${trip.drivers.first_name || ""} ${trip.drivers.last_name || ""}`.trim() : "Unassigned";
                    const isSelected = (selectedTripId || activeTrips[0]?.trip_id) === trip.trip_id;
                    const loc = locations.find((l) => l.plate_number === plate || l.vehicle_id === trip.vehicle_id);

                    return (
                      <div
                        key={trip.trip_id}
                        onClick={() => setSelectedTripId(trip.trip_id)}
                        className={cn(
                          "p-3.5 transition-colors cursor-pointer flex flex-col space-y-2.5",
                          isSelected ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-muted/40"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-1.5 rounded-xl bg-success/10 text-success border border-success/20 shrink-0">
                              <Truck className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground font-data truncate">{plate}</p>
                              <p className="text-[11px] text-foreground-muted truncate">{driver}</p>
                            </div>
                          </div>
                          <StatusBadge status={trip.trip_status} entity="trip" className="text-[10px] shrink-0" />
                        </div>

                        {/* Route to Hotel Indicator Actions */}
                        <div className="flex items-center gap-1.5 pt-1">
                          <Button
                            size="xs"
                            variant={isSelected ? "default" : "outline"}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTripId(trip.trip_id);
                            }}
                            className="flex-1 h-7 text-[11px] font-semibold rounded-xl cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Route className="w-3 h-3" />
                            {isSelected ? "Tracking Route" : "Show Route"}
                          </Button>

                          {loc?.latitude && loc?.longitude && (
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${loc.latitude},${loc.longitude}`;
                                window.open(url, "_blank", "noopener,noreferrer");
                              }}
                              className="h-7 px-2 text-[11px] font-semibold rounded-xl border-border/80 cursor-pointer flex items-center justify-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              360°
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Map Legend */}
          <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
            <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
              <CardTitle className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Status Legend
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-2 text-xs font-medium">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-success shadow-2xs" />
                  <span className="text-foreground-secondary">En Route</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-warning shadow-2xs" />
                  <span className="text-foreground-secondary">Trip Started</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-info shadow-2xs" />
                  <span className="text-foreground-secondary">Arrived</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-danger shadow-2xs" />
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
