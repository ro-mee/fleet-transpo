"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { PhaseRail } from "@/components/ui/phase-rail";
import { TRIP_STATUS as T } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { getTrip, getTripLocations } from "@/services/trip.service";
import { apiFetch } from "@/lib/api/client";
import { formatDateTime, formatDuration } from "@/lib/utils";
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
  Send,
  TrendingUp,
  Star,
  TriangleAlert,
  Calendar,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

const TripRouteMap = dynamic(() => import("@/components/maps/live-locations-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-hover rounded-2xl" />,
});

// The FULL live driver chain from trip-state.js — not a truncated 3-step model.
// Legacy/ingest statuses (Pending, Approved, Vehicle Assigned, Driver Assigned,
// Dispatched, In Progress, Arrived) are not in this rail; PhaseRail degrades
// gracefully for them via the fallbackNote below.
const TRIP_CHAIN = [
  { key: T.ASSIGNED, label: T.ASSIGNED },
  { key: T.DRIVER_ACCEPTED, label: T.DRIVER_ACCEPTED },
  { key: T.TRIP_STARTED, label: T.TRIP_STARTED },
  { key: T.AT_PICKUP, label: T.AT_PICKUP },
  { key: T.PASSENGER_ONBOARD, label: T.PASSENGER_ONBOARD },
  { key: T.EN_ROUTE, label: T.EN_ROUTE },
  { key: T.DROP_OFF, label: T.DROP_OFF },
  { key: T.COMPLETED, label: T.COMPLETED },
];

export default function TripDetailPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const params = useParams();
  const router = useRouter();
  const tripId = Number(params.id);

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
  const driverLiveCoords = useMemo(
    () =>
      latestDriverLoc?.latitude && latestDriverLoc?.longitude
        ? [Number(latestDriverLoc.latitude), Number(latestDriverLoc.longitude)]
        : null,
    [latestDriverLoc]
  );

  const routeOrigin = useMemo(
    () =>
      driverLiveCoords
        ? [driverLiveCoords[1], driverLiveCoords[0]]
        : trip?.routes
          ? [Number(trip.routes.origin_longitude), Number(trip.routes.origin_latitude)]
          : [null, null],
    [driverLiveCoords, trip]
  );

  const routeDest = useMemo(
    () =>
      trip?.routes
        ? [Number(trip.routes.destination_longitude), Number(trip.routes.destination_latitude)]
        : [null, null],
    [trip]
  );

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

  // Render the name exactly as stored (trimmed, spaces collapsed) — no
  // re-casing, which mangled names like "MC Dela Cruz". No fabricated fallback:
  // a missing driver says so plainly.
  const driverName = trip.drivers
    ? `${trip.drivers.first_name || ""} ${trip.drivers.last_name || ""}`.trim().replace(/\s+/g, " ") || null
    : null;

  const driverInitials = driverName
    ? driverName.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
    : null;

  const vehiclePlate = trip.vehicles?.plate_number || "—";
  const driverLiveLabel = driverName
    ? `Driver: ${driverName}${vehiclePlate ? ` (${vehiclePlate})` : ""}`
    : "Driver Live GPS Location";

  const pickup = trip.pickup_location || trip.routes?.origin || "—";
  const dropoff = trip.dropoff_location || trip.routes?.destination || "—";

  // Chain links: the trip back to its dispatch and its originating request.
  // GET /api/trips/:id joins dispatchschedules (dispatch_number) and the
  // transportation request (request_id + reservation_number, but NOT guest_name —
  // that column is deliberately outside the detail projection), so the chip is
  // labelled by reservation number.
  const dispatchNumber = trip.dispatchschedules?.dispatch_number;
  const linkedRequest = trip.transportation_requests || null;

  const hasPerformanceMetrics = [
    trip.on_time_completion,
    trip.fuel_efficiency,
    trip.customer_rating,
  ].some((v) => v !== null && v !== undefined);

  return (
    <div className="space-y-6 pb-12">
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
          </div>
        }
      />

      {/* Chain Links + Progress Rail */}
      <Card className="border-0 shadow-xs rounded-3xl bg-surface">
        <CardContent className="p-5 space-y-4">
          {(trip.dispatch_id || linkedRequest) && (
            <div className="flex items-center flex-wrap gap-2">
              {trip.dispatch_id && (
                <Link
                  href={`/dispatch/${trip.dispatch_id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  Dispatch {dispatchNumber || `#${trip.dispatch_id}`}
                </Link>
              )}
              {linkedRequest?.request_id && (
                <Link
                  href={`/reservations/${linkedRequest.request_id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-info/30 bg-info/5 px-3 py-1 text-xs font-semibold text-info transition-colors hover:bg-info/10"
                >
                  <Route className="w-3.5 h-3.5" aria-hidden="true" />
                  {linkedRequest.reservation_number || `Request #${linkedRequest.request_id}`}
                </Link>
              )}
            </div>
          )}
          <PhaseRail
            steps={TRIP_CHAIN}
            status={trip.trip_status}
            fallbackNote="This trip uses an older status vocabulary."
          />
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
              {driverInitials || <Users className="w-4 h-4 opacity-60" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Driver</p>
              {driverName ? (
                <p className="text-sm font-bold text-foreground truncate">{driverName}</p>
              ) : (
                <p className="text-sm italic text-foreground-muted">No driver assigned</p>
              )}
              <p className="text-[11px] text-foreground-muted truncate">{driverName ? "Assigned Operator" : "Awaiting assignment"}</p>
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
    </div>
  );
}
