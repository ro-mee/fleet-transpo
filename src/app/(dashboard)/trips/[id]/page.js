"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { TripOdometerDialog } from "@/components/dispatch/trip-odometer-dialog";
import { getTrip, startTrip, completeTrip, getTripLocations } from "@/services/trip.service";
import { apiFetch } from "@/lib/api/client";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { DISPATCH_STATUS as D } from "@/lib/constants";
import { useRoleAccess } from "@/hooks/use-role-access";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ArrowLeft,
  Truck,
  Users,
  Route,
  Clock,
  MapPin,
  Navigation,
  Gauge,
  CheckCircle2,
  Loader2,
  Play,
  Square,
  ChevronRight,
  TrendingUp,
  Star,
  TriangleAlert,
  Calendar,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";

const TripRouteMap = dynamic(() => import("@/components/maps/live-locations-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-hover rounded-2xl" />,
});

const tripSteps = ["Assigned", "Trip Started", "Completed"];

export default function TripDetailPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tripId = Number(params.id);

  const { can } = useRoleAccess();
  const permissions = useMemo(() => ({ tripsUpdate: can("trips", "update") }), [can]);
  const [odometerMode, setOdometerMode] = useState(null);

  const {
    data: trip,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => getTrip(tripId),
    enabled: !!tripId,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["trip-locations", tripId],
    queryFn: () => getTripLocations(tripId),
    enabled: !!tripId,
  });

  const latestDriverLoc = locations.length > 0 ? locations[locations.length - 1] : null;
  const driverLiveCoords = latestDriverLoc?.latitude && latestDriverLoc?.longitude
    ? [Number(latestDriverLoc.latitude), Number(latestDriverLoc.longitude)]
    : null;

  const routeOrigin = driverLiveCoords
    ? [driverLiveCoords[1], driverLiveCoords[0]]
    : (trip?.routes
      ? [Number(trip.routes.origin_longitude), Number(trip.routes.origin_latitude)]
      : [null, null]);

  const routeDest = trip?.routes
    ? [Number(trip.routes.destination_longitude), Number(trip.routes.destination_latitude)]
    : [null, null];

  const hasRouteCoords =
    (driverLiveCoords || trip?.routes) &&
    routeOrigin.every((n) => Number.isFinite(n) && n !== 0) &&
    routeDest.every((n) => Number.isFinite(n) && n !== 0);

  const { data: routeData = null } = useQuery({
    queryKey: ["trip-route", tripId, trip?.routes?.route_id, driverLiveCoords],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/tomtom/route?origin=${routeOrigin[0]},${routeOrigin[1]}&destination=${routeDest[0]},${routeDest[1]}`
      );
      return res ?? null;
    },
    enabled: !!tripId && !!hasRouteCoords,
    retry: 0,
    staleTime: 10000,
  });
  const routeCoords = routeData?.coordinates ?? null;

  const routeMeta = useMemo(() => {
    const origin = driverLiveCoords || (hasRouteCoords ? [routeOrigin[1], routeOrigin[0]] : null);
    const destination = hasRouteCoords ? [routeDest[1], routeDest[0]] : null;
    if (!origin && !destination) return null;
    return { origin, destination };
  }, [driverLiveCoords, hasRouteCoords, routeOrigin, routeDest]);

  const startMutation = useMutation({
    mutationFn: (body) => startTrip(tripId, body),
    onSuccess: () => {
      toast.success("Trip started");
      setOdometerMode(null);
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trips-active"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver-stats"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const completeMutation = useMutation({
    mutationFn: (body) => completeTrip(tripId, body),
    onSuccess: () => {
      toast.success("Trip completed");
      setOdometerMode(null);
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trips-active"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dispatches"] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <DetailSkeleton />
      </div>
    );
  }

  if (isError || !trip) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()} aria-label="Go back">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <EmptyState
          icon={TriangleAlert}
          title="Trip not found"
          description="The requested trip record could not be found."
          action={<Button onClick={() => router.push("/trips")}>Back to Trips</Button>}
        />
      </div>
    );
  }

  const rawDriverName = trip.drivers
    ? `${trip.drivers.first_name || ""} ${trip.drivers.last_name || ""}`.trim()
    : "";
  const driverName = rawDriverName
    ? rawDriverName.split(" ").map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "")).join(" ")
    : "Unassigned Driver";

  const driverInitials = driverName !== "Unassigned Driver"
    ? driverName.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()
    : "DR";

  const vehiclePlate = trip.vehicles?.plate_number || "—";
  const driverLiveLabel = driverName !== "Unassigned Driver"
    ? `Driver: ${driverName}${vehiclePlate ? ` (${vehiclePlate})` : ""}`
    : "Driver Live GPS Location";

  const pickup = trip.pickup_location || trip.routes?.origin || "—";
  const dropoff = trip.dropoff_location || trip.routes?.destination || "—";

  const currentStepIndex = tripSteps.indexOf(trip.trip_status);

  const canStart =
    permissions.tripsUpdate &&
    ["Assigned", "Scheduled", "Driver Accepted"].includes(trip.trip_status);
  const canComplete =
    permissions.tripsUpdate &&
    ["In Progress", "Trip Started", "En Route", "Arrived"].includes(trip.trip_status);

  const hasPerformanceMetrics = [
    trip.on_time_completion,
    trip.fuel_efficiency,
    trip.customer_rating,
  ].some((v) => v !== null && v !== undefined);

  return (
    <div className="space-y-6 pb-12 select-none">
      <HeroHeader
        icon={Route}
        title={`Trip #${trip.trip_id}`}
        badge="Trip Information"
        description={`${vehiclePlate} · ${pickup} → ${dropoff}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.back()} className={heroButtonOutlineClass}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <StatusBadge status={trip.trip_status} entity="trip" className="text-xs px-3 py-1 font-semibold" />

            {canStart && (
              <Button
                size="sm"
                className="bg-success text-white hover:bg-emerald-600 font-semibold rounded-xl"
                onClick={() => setOdometerMode("start")}
                disabled={startMutation.isPending}
              >
                {startMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Start Trip
              </Button>
            )}
            {canComplete && (
              <Button
                size="sm"
                className="bg-primary text-white font-semibold rounded-xl"
                onClick={() => setOdometerMode("complete")}
                disabled={completeMutation.isPending}
              >
                {completeMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Square className="w-4 h-4 mr-2" />
                )}
                Complete Trip
              </Button>
            )}
          </div>
        }
      />

      {/* Progress Stepper Card */}
      <Card className="border-0 shadow-xs rounded-3xl bg-surface">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {tripSteps.map((step, i) => {
              const isCompleted = i <= currentStepIndex;
              const isCurrent = i === currentStepIndex;
              return (
                <div
                  key={step}
                  className="flex items-center gap-2 flex-shrink-0"
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all font-semibold ${
                      isCurrent
                        ? "bg-primary text-white shadow-2xs"
                        : isCompleted
                        ? "bg-success/15 text-success border border-success/30"
                        : "bg-muted text-foreground-muted border border-border/40"
                    }`}
                  >
                    {isCompleted && !isCurrent && (
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {step}
                  </div>
                  {i < tripSteps.length - 1 && (
                    <ChevronRight
                      className={`w-3.5 h-3.5 ${
                        i < currentStepIndex ? "text-success" : "text-foreground-muted"
                      }`}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Executive Key Information Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-xs rounded-3xl bg-surface hover:-translate-y-0.5 transition-all duration-200">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Assigned Vehicle</p>
              <p className="text-sm font-bold text-foreground font-data truncate">{vehiclePlate}</p>
              <p className="text-[11px] text-foreground-muted truncate">{trip.vehicles?.vehicle_name || "Vehicle Unit"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-xs rounded-3xl bg-surface hover:-translate-y-0.5 transition-all duration-200">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-info/10 text-info border border-info/20 shrink-0 flex items-center justify-center font-bold text-xs font-data">
              {driverInitials}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Driver</p>
              <p className="text-sm font-bold text-foreground truncate">{driverName}</p>
              <p className="text-[11px] text-foreground-muted truncate">Assigned Operator</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-xs rounded-3xl bg-surface hover:-translate-y-0.5 transition-all duration-200">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-warning/10 text-warning border border-warning/20 shrink-0">
              <Gauge className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Distance</p>
              <p className="text-sm font-bold text-foreground font-data">
                {trip.distance != null ? `${trip.distance} km` : "—"}
              </p>
              <p className="text-[11px] text-foreground-muted">Total Traveled</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-xs rounded-3xl bg-surface hover:-translate-y-0.5 transition-all duration-200">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-success/10 text-success border border-success/20 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Duration</p>
              <p className="text-sm font-bold text-foreground">
                {formatDuration(trip.actual_duration)}
              </p>
              <p className="text-[11px] text-foreground-muted">Actual Elapsed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Route & Schedule Details Card */}
      <Card className="border-0 shadow-xs rounded-3xl bg-surface overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" /> Route & Schedule Details
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/20 border border-border/40">
              <div className="p-2 rounded-xl bg-success/10 text-success border border-success/20 shrink-0 mt-0.5">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Pickup Location</p>
                <p className="text-sm font-bold text-foreground mt-0.5">{pickup}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/20 border border-border/40">
              <div className="p-2 rounded-xl bg-danger/10 text-danger border border-danger/20 shrink-0 mt-0.5">
                <Navigation className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Dropoff Location</p>
                <p className="text-sm font-bold text-foreground mt-0.5">{dropoff}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/20 border border-border/40">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0 mt-0.5">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Start Time</p>
                <p className="text-sm font-bold text-foreground font-data mt-0.5">
                  {formatDateTime(trip.start_time)}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/20 border border-border/40">
              <div className="p-2 rounded-xl bg-info/10 text-info border border-info/20 shrink-0 mt-0.5">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">End Time</p>
                <p className="text-sm font-bold text-foreground font-data mt-0.5">
                  {formatDateTime(trip.end_time)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {hasPerformanceMetrics && (
        <Card className="border-0 shadow-xs rounded-3xl bg-surface overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Performance &amp; Efficiency Metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-2xl bg-muted/20 border border-border/40">
                <CheckCircle2 className="w-5 h-5 mx-auto mb-1.5 text-success" />
                <p className="text-lg font-bold text-foreground">
                  {trip.on_time_completion ? "Yes" : "No"}
                </p>
                <p className="text-xs font-medium text-foreground-muted">On Time Arrival</p>
              </div>
              <div className="text-center p-4 rounded-2xl bg-muted/20 border border-border/40">
                <TrendingUp className="w-5 h-5 mx-auto mb-1.5 text-primary" />
                <p className="text-lg font-bold text-foreground font-data">{trip.fuel_efficiency ?? "—"}</p>
                <p className="text-xs font-medium text-foreground-muted">Fuel Efficiency (km/L)</p>
              </div>
              <div className="text-center p-4 rounded-2xl bg-muted/20 border border-border/40">
                <Star className="w-5 h-5 mx-auto mb-1.5 text-warning" />
                <p className="text-lg font-bold text-foreground font-data">{trip.customer_rating ?? "—"}</p>
                <p className="text-xs font-medium text-foreground-muted">Rating</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dynamic Clean GPS Route Map Card */}
      <Card className="border-0 shadow-xs rounded-3xl bg-surface overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Navigation className="w-4 h-4 text-primary" /> Real-Time Live GPS Map ({locations.length} points)
            </span>
            <Badge variant="outline" className="text-[11px] font-medium font-data rounded-full">
              {locations.length > 0 ? "GPS Tracked" : "No Coordinates"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[480px] w-full bg-muted/20">
            {locations.length > 0 || routeCoords?.length ? (
              <TripRouteMap
                locations={locations}
                route={routeCoords}
                waypoints={routeMeta}
                routeDistanceKm={routeData?.distanceKm ?? null}
                routeTravelMin={routeData?.travelTimeMin ?? null}
                originName={driverLiveLabel}
                destinationName={dropoff}
                instructions={routeData?.instructions ?? []}
                showNavigationPanel={false}
                traffic
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-foreground-muted bg-muted/20">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50 text-foreground-muted" />
                <p className="text-sm font-medium text-foreground">No GPS tracking data recorded for this trip</p>
                <p className="text-xs text-foreground-muted mt-1">
                  GPS location points will render here live when recorded during en route status.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <TripOdometerDialog
        dispatch={
          odometerMode
            ? {
                dispatch_id: trip.dispatch_id ?? null,
                dispatch_number:
                  trip.dispatchschedules?.dispatch_number || `Trip #${trip.trip_id}`,
                latest_trip: trip,
                vehicles: trip.vehicles || null,
              }
            : null
        }
        mode={odometerMode}
        onOpenChange={(open) => {
          if (!open) setOdometerMode(null);
        }}
      />
    </div>
  );
}
