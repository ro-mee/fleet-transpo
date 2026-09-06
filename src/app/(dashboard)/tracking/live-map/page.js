"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getActiveTrips, getLatestLocations } from "@/services/trip.service";
import { apiFetch } from "@/lib/api/client";
import { formatGpsAge, getGpsHealth, isValidCoordinate, speedKmhFromMps } from "@/lib/gps";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import {
  Activity,
  CarFront,
  Clock3,
  Eye,
  Gauge,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Signal,
  Siren,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

const LiveLocationsMap = dynamic(
  () => import("@/components/maps/live-locations-map"),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-hover" /> }
);

function driverNameFor(trip) {
  const name = trip?.drivers
    ? `${trip.drivers.first_name || ""} ${trip.drivers.last_name || ""}`.trim()
    : "";
  return name || "Unassigned driver";
}

function plateFor(trip) {
  return trip?.vehicles?.plate_number || `Trip #${trip?.trip_id ?? "—"}`;
}

const PICKUP_ROUTE_STATUSES = new Set(["Trip Started"]);
const PICKUP_CONTEXT_STATUSES = new Set(["At Pickup"]);
const DESTINATION_ROUTE_STATUSES = new Set(["Passenger Onboard", "En Route", "In Progress"]);
const DESTINATION_CONTEXT_STATUSES = new Set(["Drop-off", "Arrived"]);

function locationFor(trip, locations) {
  if (!trip) return null;
  // GPS is trip-scoped. Never substitute another trip's or an idle vehicle's
  // last fix for the selected trip.
  return locations.find((location) => String(location?.trip_id) === String(trip.trip_id)) || null;
}

function pickupFor(trip) {
  return trip?.transportation_requests?.pickup_location ||
    trip?.routes?.origin ||
    "Pickup unavailable";
}

function destinationFor(trip) {
  return trip?.transportation_requests?.dropoff_location ||
    trip?.routes?.destination ||
    trip?.routes?.route_name ||
    "Destination unavailable";
}

function coordinatesFor(trip, kind) {
  const latitude = kind === "pickup"
    ? trip?.routes?.origin_latitude
    : trip?.routes?.destination_latitude;
  const longitude = kind === "pickup"
    ? trip?.routes?.origin_longitude
    : trip?.routes?.destination_longitude;
  return isValidCoordinate(latitude, longitude) ? [Number(latitude), Number(longitude)] : null;
}

function mapTargetFor(trip) {
  const status = trip?.trip_status;
  if (PICKUP_ROUTE_STATUSES.has(status)) {
    return { kind: "pickup", coords: coordinatesFor(trip, "pickup"), drawRoute: true };
  }
  if (PICKUP_CONTEXT_STATUSES.has(status)) {
    return { kind: "pickup", coords: coordinatesFor(trip, "pickup"), drawRoute: false };
  }
  if (DESTINATION_ROUTE_STATUSES.has(status)) {
    return { kind: "destination", coords: coordinatesFor(trip, "destination"), drawRoute: true };
  }
  if (DESTINATION_CONTEXT_STATUSES.has(status)) {
    return { kind: "destination", coords: coordinatesFor(trip, "destination"), drawRoute: false };
  }
  return { kind: null, coords: null, drawRoute: false };
}

function formatDateTime(value) {
  if (!value) return "No signal";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No signal";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSpeed(location) {
  const speed = location?.speed_kmh ?? speedKmhFromMps(location?.speed);
  return speed == null ? "—" : `${speed.toFixed(1)} km/h`;
}

function formatAccuracy(location) {
  return location?.accuracy == null ? "—" : `${Math.round(location.accuracy)} m`;
}

function Metric({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <p className="mt-1 text-sm font-semibold font-data text-foreground">{value}</p>
    </div>
  );
}

export default function LiveMapPage() {
  useRequireRole();

  const [selectedTripId, setSelectedTripId] = useState(null);
  const [selectedRescueId, setSelectedRescueId] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // Trip and rescue selections are mutually exclusive — picking one clears the
  // other so the map's route/waypoint props always describe a single mission.
  const selectTrip = (tripId) => {
    setSelectedTripId(tripId ?? null);
    setSelectedRescueId(null);
  };
  const selectRescue = (incidentId) => {
    setSelectedRescueId(incidentId ?? null);
    setSelectedTripId(null);
  };

  const tripsQuery = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 30000,
  });

  const locationsQuery = useQuery({
    queryKey: ["latest-locations"],
    queryFn: () => getLatestLocations(),
    refetchInterval: 15000,
  });

  // Rescue missions (open incidents with a fleet responder assigned) — the
  // responder's counterpart to the trip feed, so a rescue shows on this map
  // exactly like a guest trip does.
  const respondersQuery = useQuery({
    queryKey: ["active-rescues"],
    queryFn: () => apiFetch("/api/incidents/responders/active"),
    refetchInterval: 30000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const activeTrips = useMemo(
    () => (Array.isArray(tripsQuery.data) ? tripsQuery.data : []),
    [tripsQuery.data]
  );
  const locations = useMemo(
    () => (Array.isArray(locationsQuery.data) ? locationsQuery.data : []),
    [locationsQuery.data]
  );
  const rescueRows = useMemo(
    () => (Array.isArray(respondersQuery.data) ? respondersQuery.data : []),
    [respondersQuery.data]
  );

  // The initial view is a fleet overview. A trip becomes route-focused only
  // after the dispatcher explicitly selects it.
  const activeTrip = useMemo(
    () => selectedTripId == null
      ? null
      : activeTrips.find((trip) => String(trip.trip_id) === String(selectedTripId)) || null,
    [activeTrips, selectedTripId]
  );

  const selectedRescue = useMemo(
    () => selectedRescueId == null
      ? null
      : rescueRows.find((rescue) => String(rescue.incident_id) === String(selectedRescueId)) || null,
    [rescueRows, selectedRescueId]
  );

  const selectedLocation = useMemo(
    () => locationFor(activeTrip, locations),
    [activeTrip, locations]
  );

  const mapTarget = useMemo(() => mapTargetFor(activeTrip), [activeTrip]);
  const targetCoords = mapTarget.coords;
  const targetName = mapTarget.kind === "pickup"
    ? pickupFor(activeTrip)
    : mapTarget.kind === "destination"
    ? destinationFor(activeTrip)
    : "Upcoming trip context";

  // A route is meaningful only from a fresh GPS fix. Delayed/offline fixes are
  // still visible as last-known data, but must not be presented as live route
  // origins.
  const originCoords = useMemo(() => {
    if (!isValidCoordinate(selectedLocation?.latitude, selectedLocation?.longitude)) return null;
    if (getGpsHealth(selectedLocation?.recorded_at, now).key !== "fresh") return null;
    return [Number(selectedLocation.latitude), Number(selectedLocation.longitude)];
  }, [selectedLocation, now]);

  // Same freshness rule for the rescue route: the responder's live position is
  // the origin, the stranded driver's position the destination.
  const rescueOriginCoords = useMemo(() => {
    if (!isValidCoordinate(selectedRescue?.responder?.latitude, selectedRescue?.responder?.longitude)) return null;
    if (getGpsHealth(selectedRescue?.responder?.last_location_update, now).key !== "fresh") return null;
    return [Number(selectedRescue.responder.latitude), Number(selectedRescue.responder.longitude)];
  }, [selectedRescue, now]);
  const rescueTargetCoords = useMemo(
    () => (isValidCoordinate(selectedRescue?.driver?.latitude, selectedRescue?.driver?.longitude)
      ? [Number(selectedRescue.driver.latitude), Number(selectedRescue.driver.longitude)]
      : null),
    [selectedRescue]
  );

  // One route query for whichever mission is selected — a guest trip or a
  // rescue. Both draw the same TomTom polyline via the shared endpoint.
  const isRescueSelection = !activeTrip && Boolean(selectedRescue);
  const routeOriginCoords = activeTrip ? originCoords : rescueOriginCoords;
  const routeTargetCoords = activeTrip ? targetCoords : rescueTargetCoords;
  const routeDrawEnabled = activeTrip ? Boolean(mapTarget.drawRoute) : true;

  const routeQuery = useQuery({
    queryKey: [
      isRescueSelection ? "rescue-route" : "driver-trip-route",
      activeTrip?.trip_id ?? selectedRescue?.incident_id ?? null,
      routeOriginCoords?.join(",") ?? null,
      routeTargetCoords?.join(",") ?? null,
      routeDrawEnabled,
    ],
    queryFn: async () => {
      if (!routeOriginCoords || !routeTargetCoords || !routeDrawEnabled) return null;
      return apiFetch(
        `/api/tomtom/route?origin=${routeOriginCoords[1]},${routeOriginCoords[0]}&destination=${routeTargetCoords[1]},${routeTargetCoords[0]}`
      );
    },
    enabled: Boolean((activeTrip || selectedRescue) && routeOriginCoords && routeTargetCoords && routeDrawEnabled),
    retry: 0,
    staleTime: 10000,
  });

  const healthRows = useMemo(
    () => activeTrips.map((trip) => {
      const location = locationFor(trip, locations);
      return { trip, location, health: getGpsHealth(location?.recorded_at, now) };
    }),
    [activeTrips, locations, now]
  );

  const gpsSummary = useMemo(() => ({
    fresh: healthRows.filter((row) => row.health.key === "fresh").length,
    delayed: healthRows.filter((row) => row.health.key === "delayed").length,
    offline: healthRows.filter((row) => row.health.key === "stale").length,
    noSignal: healthRows.filter((row) => row.health.key === "no-signal").length,
    positioned: healthRows.filter((row) => isValidCoordinate(row.location?.latitude, row.location?.longitude)).length,
  }), [healthRows]);

  const activeTripIds = useMemo(
    () => new Set(activeTrips.map((trip) => trip.trip_id).filter((id) => id != null).map(String)),
    [activeTrips]
  );

  const mapLocations = useMemo(
    () => locations.filter((location) => {
      if (!isValidCoordinate(location?.latitude, location?.longitude)) return false;
      return location?.trip_id != null && activeTripIds.has(String(location.trip_id));
    }),
    [locations, activeTripIds]
  );

  const selectedHealth = getGpsHealth(selectedLocation?.recorded_at, now);
  const isFetching = tripsQuery.isFetching || locationsQuery.isFetching || respondersQuery.isFetching || routeQuery.isFetching;
  const routePoints = routeQuery.data?.coordinates;
  const routeReady = Array.isArray(routePoints) && routePoints.length >= 2;
  const driverName = driverNameFor(activeTrip);
  const driverPlate = plateFor(activeTrip);
  const pickupName = pickupFor(activeTrip);
  const destinationName = destinationFor(activeTrip);

  const handleRefresh = async () => {
    await Promise.all([
      tripsQuery.refetch(),
      locationsQuery.refetch(),
      respondersQuery.refetch(),
      routeQuery.refetch(),
    ]);
  };

  return (
    <div className="space-y-6 pb-12">
      <HeroHeader
        icon={Navigation}
        title="Live GPS Tracking"
        badge="Operations"
        description={activeTrip
          ? `${driverName} · ${driverPlate} · ${activeTrip.trip_status}. ${mapTarget.kind ? `Next stop: ${targetName}.` : "Marker context only until the trip starts."}`
          : selectedRescue
          ? `Rescue mission — ${selectedRescue.responder?.name || "responder"} going to ${selectedRescue.driver?.name || "stranded driver"}. ${selectedRescue.response_status || "Dispatched"}.`
          : rescueRows.length
          ? `Monitor active trip positions, GPS health, and routes from one operational map. ${rescueRows.length} rescue ${rescueRows.length === 1 ? "mission is" : "missions are"} in progress.`
          : "Monitor active trip positions, GPS health, and routes from one operational map."}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge
              variant={locationsQuery.isError ? "danger" : activeTrips.length && gpsSummary.fresh ? "success" : "outline"}
              className="gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", gpsSummary.fresh ? "bg-success" : "bg-foreground-muted", gpsSummary.fresh && "animate-pulse")} />
              {locationsQuery.isError ? "GPS feed unavailable" : activeTrips.length ? `${gpsSummary.fresh} fresh GPS` : "No active trips"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              className={cn(heroButtonOutlineClass)}
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
              Refresh data
            </Button>
          </div>
        }
      />

      <StatGrid cols={3}>
        <StatCard icon={Navigation} label="Active trips" value={activeTrips.length} tone="primary" trend="currently in the live-trip window" />
        <StatCard icon={Signal} label="Fresh GPS" value={gpsSummary.fresh} tone="success" trend={`${gpsSummary.positioned} active trips have coordinates`} />
        <StatCard icon={Clock3} label="Delayed / offline" value={gpsSummary.delayed + gpsSummary.offline} tone={gpsSummary.delayed + gpsSummary.offline ? "warning" : "neutral"} trend={`${gpsSummary.noSignal} active trips have no measurement`} />
      </StatGrid>

      {tripsQuery.isError && (
        <QueryErrorBanner
          query={tripsQuery}
          title="Unable to load active trips"
          description="The map may be incomplete until the active-trip feed is available."
        />
      )}
      {locationsQuery.isError && (
        <QueryErrorBanner
          query={locationsQuery}
          title="Unable to refresh GPS positions"
          description="Trip records remain visible, but their positions may be unavailable or outdated."
        />
      )}
      {respondersQuery.isError && (
        <QueryErrorBanner
          query={respondersQuery}
          title="Unable to load rescue missions"
          description="Active trips remain visible, but responder positions may be missing from the map."
        />
      )}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 xl:col-span-9">
          <Card className="overflow-hidden rounded-3xl border-0 bg-surface shadow-xs">
            <CardHeader className="flex-row items-center justify-between border-b border-border/60 bg-muted/20 pb-3.5">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <MapPin className="h-4 w-4 text-primary" />
                Operations map
              </CardTitle>
              <span className="font-data text-xs text-foreground-muted">
                {mapLocations.length} positioned
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="h-[min(640px,70vh)] min-h-[420px] bg-muted/20">
                {locationsQuery.isLoading || tripsQuery.isLoading || respondersQuery.isLoading ? (
                  <div className="flex h-full items-center justify-center bg-hover/40" aria-busy="true">
                    <div className="w-full max-w-sm space-y-3 px-6">
                      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-full animate-pulse rounded bg-muted" />
                      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                ) : mapLocations.length === 0 && rescueRows.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      icon={Navigation}
                      title="No live positions"
                      description="The live map will populate when a trip enters the operational tracking window or a rescue is dispatched."
                      variant="waiting"
                    />
                  </div>
                ) : (
                  <LiveLocationsMap
                    locations={mapLocations}
                    responders={rescueRows}
                    // Pass the resolved trip, not stale selection state, so a
                    // completed/removed trip cannot leave the map highlighting
                    // or focusing a different marker than the selected panel.
                    selectedTripId={activeTrip?.trip_id ?? null}
                    onSelectTrip={selectTrip}
                    selectedResponderId={selectedRescue?.incident_id ?? null}
                    onSelectResponder={selectRescue}
                    route={routeReady ? routePoints : null}
                    // Rescue markers come from the responders feed — waypoints
                    // (green origin / red destination pins) only describe a
                    // selected trip.
                    waypoints={activeTrip ? { origin: originCoords, destination: targetCoords } : { origin: null, destination: null }}
                    originName={activeTrip && originCoords ? `Driver: ${driverName} (${driverPlate})` : ""}
                    destinationName={activeTrip && targetCoords ? targetName : ""}
                    traffic
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 lg:col-span-4 xl:col-span-3">
          <Card className="overflow-hidden rounded-3xl border-0 bg-surface shadow-xs">
            <CardHeader className="border-b border-border/60 bg-muted/20 pb-3.5">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Activity className="h-4 w-4 text-primary" />
                Selected mission
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              {!activeTrip && !selectedRescue ? (
                <p className="text-sm text-foreground-secondary">Select an active trip or rescue mission when one is available.</p>
              ) : activeTrip ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-data text-base font-semibold text-foreground">{driverPlate}</p>
                      <p className="mt-0.5 truncate text-xs text-foreground-secondary">{driverName}</p>
                    </div>
                    <StatusBadge status={activeTrip.trip_status} entity="trip" className="shrink-0 text-[11px]" />
                  </div>
                  <div className="flex items-center justify-between gap-2 border-y border-border/60 py-3">
                    <span className="text-xs font-semibold text-foreground-muted">GPS health</span>
                    <StatusBadge status={selectedHealth.label} entity="gps" className="text-[11px]" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Speed" value={formatSpeed(selectedLocation)} icon={Gauge} />
                    <Metric label="Accuracy" value={formatAccuracy(selectedLocation)} icon={Signal} />
                    <Metric label="Last update" value={formatGpsAge(selectedLocation?.recorded_at, now)} icon={Clock3} />
                    <Metric label="Recorded" value={formatDateTime(selectedLocation?.recorded_at)} icon={Activity} />
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                      {mapTarget.kind === "pickup" ? "Next stop · Pickup" : mapTarget.kind === "destination" ? "Next stop · Destination" : "Trip context"}
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground" title={targetName}>
                      {mapTarget.kind ? targetName : `${pickupName} → ${destinationName}`}
                    </p>
                    {routeReady ? (
                      <p className="mt-1 font-data text-xs text-primary">
                        {routeQuery.data.distanceKm != null ? `${routeQuery.data.distanceKm} km` : "Distance unavailable"}
                        {routeQuery.data.travelTimeMin != null ? ` · ~${routeQuery.data.travelTimeMin} min` : ""}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-foreground-muted">
                        {routeQuery.isError
                          ? "Route unavailable"
                          : !mapTarget.kind
                          ? "Route appears after the trip starts"
                          : !targetCoords
                          ? `${mapTarget.kind === "pickup" ? "Pickup" : "Destination"} coordinates unavailable`
                          : selectedHealth.key === "delayed"
                          ? "Waiting for a fresh GPS fix"
                          : selectedHealth.key === "stale"
                          ? "GPS fix offline"
                          : !originCoords
                          ? "Waiting for a GPS fix"
                          : "Calculating route"}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs">
                    <Metric label="Pickup" value={pickupName} icon={MapPin} />
                    <Metric label="Destination" value={destinationName} icon={Navigation} />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-data text-base font-semibold text-foreground">
                        Rescue — {selectedRescue.responder?.name || "Fleet responder"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-foreground-secondary">
                        Going to {selectedRescue.driver?.name || "stranded driver"}
                      </p>
                    </div>
                    <StatusBadge status={selectedRescue.response_status || "Dispatched"} entity="trip" className="shrink-0 text-[11px]" />
                  </div>
                  <div className="flex items-center justify-between gap-2 border-y border-border/60 py-3">
                    <span className="text-xs font-semibold text-foreground-muted">Responder GPS</span>
                    <StatusBadge status={getGpsHealth(selectedRescue.responder?.last_location_update, now).label} entity="gps" className="text-[11px]" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric
                      label="ETA"
                      value={selectedRescue.response_eta && selectedRescue.response_status !== "Arrived"
                        ? new Date(selectedRescue.response_eta).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                        : "—"}
                      icon={Clock3}
                    />
                    <Metric label="Last update" value={formatDateTime(selectedRescue.responder?.last_location_update)} icon={Activity} />
                    <Metric label="Incident" value={selectedRescue.incident_type || "—"} icon={Siren} />
                    <Metric label="Location" value={selectedRescue.location || "—"} icon={MapPin} />
                  </div>
                  {routeReady ? (
                    <p className="font-data text-xs text-primary">
                      {routeQuery.data.distanceKm != null ? `${routeQuery.data.distanceKm} km` : "Distance unavailable"}
                      {routeQuery.data.travelTimeMin != null ? ` · ~${routeQuery.data.travelTimeMin} min` : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-foreground-muted">
                      {routeQuery.isError
                        ? "Route unavailable"
                        : !routeOriginCoords
                        ? "Waiting for a fresh responder GPS fix"
                        : !routeTargetCoords
                        ? "Stranded driver coordinates unavailable"
                        : "Calculating route"}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-3xl border-0 bg-surface shadow-xs">
            <CardHeader className="flex-row items-center justify-between border-b border-border/60 bg-muted/20 pb-3.5">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CarFront className="h-4 w-4 text-primary" />
                Active trips
              </CardTitle>
              <div className="flex items-center gap-2">
                {(activeTrip || selectedRescue) && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => selectTrip(null)}
                    className="h-7 rounded-xl px-2 text-[11px] font-semibold"
                  >
                    Fleet overview
                  </Button>
                )}
                <Badge variant="outline" className="rounded-full font-data text-[11px]">{activeTrips.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {activeTrips.length === 0 ? (
                <p className="p-5 text-center text-xs text-foreground-muted">No trips are currently being tracked.</p>
              ) : (
                <div className="max-h-[360px] divide-y divide-border/60 overflow-y-auto">
                  {healthRows.map(({ trip, location, health }) => {
                    const plate = plateFor(trip);
                    const isSelected = activeTrip?.trip_id === trip.trip_id;
                    const hasCoordinates = isValidCoordinate(location?.latitude, location?.longitude);
                    return (
                      <div key={trip.trip_id} className={cn("p-3.5", isSelected && "bg-primary/10")}>
                        <button
                          type="button"
                          onClick={() => selectTrip(trip.trip_id)}
                          className="flex w-full items-start justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          aria-pressed={isSelected}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border", health.key === "fresh" ? "border-success/20 bg-success/10 text-success" : health.key === "stale" ? "border-danger/20 bg-danger/10 text-danger-700" : health.key === "no-signal" ? "border-border bg-hover text-foreground-muted" : "border-warning/20 bg-warning/10 text-warning-700")}>
                              <CarFront className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-data text-xs font-semibold text-foreground">{plate}</span>
                              <span className="mt-0.5 block truncate text-[11px] text-foreground-muted">{driverNameFor(trip)}</span>
                            </span>
                          </span>
                          <StatusBadge status={health.label} entity="gps" className="shrink-0 text-[11px]" />
                        </button>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant={isSelected ? "default" : "outline"}
                            onClick={() => selectTrip(trip.trip_id)}
                            className="h-7 flex-1 rounded-xl text-[11px] font-semibold"
                          >
                            <Route className="mr-1 h-3 w-3" />
                            {isSelected ? "Tracking route" : "Show route"}
                          </Button>
                          {hasCoordinates && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${location.latitude},${location.longitude}`, "_blank", "noopener,noreferrer")}
                              className="h-7 rounded-xl px-2 text-[11px] font-semibold"
                              aria-label={`Open Street View for ${plate}`}
                            >
                              <Eye className="h-3 w-3" />
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

          {rescueRows.length > 0 && (
            <Card className="overflow-hidden rounded-3xl border-0 bg-surface shadow-xs">
              <CardHeader className="flex-row items-center justify-between border-b border-border/60 bg-muted/20 pb-3.5">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Siren className="h-4 w-4 text-primary" />
                  Rescue missions
                </CardTitle>
                <Badge variant="outline" className="rounded-full font-data text-[11px]">{rescueRows.length}</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[360px] divide-y divide-border/60 overflow-y-auto">
                  {rescueRows.map((rescue) => {
                    const isSelected = selectedRescue?.incident_id === rescue.incident_id;
                    const health = getGpsHealth(rescue.responder?.last_location_update, now);
                    return (
                      <div key={rescue.incident_id} className={cn("p-3.5", isSelected && "bg-primary/10")}>
                        <button
                          type="button"
                          onClick={() => selectRescue(rescue.incident_id)}
                          className="flex w-full items-start justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          aria-pressed={isSelected}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border", health.key === "fresh" ? "border-success/20 bg-success/10 text-success" : health.key === "stale" ? "border-danger/20 bg-danger/10 text-danger-700" : "border-warning/20 bg-warning/10 text-warning-700")}>
                              <Siren className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-data text-xs font-semibold text-foreground">
                                {rescue.responder?.name || "Fleet responder"}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-foreground-muted">
                                → {rescue.driver?.name || "stranded driver"}
                              </span>
                            </span>
                          </span>
                          <StatusBadge status={rescue.response_status || "Dispatched"} entity="trip" className="shrink-0 text-[11px]" />
                        </button>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant={isSelected ? "default" : "outline"}
                            onClick={() => selectRescue(rescue.incident_id)}
                            className="h-7 flex-1 rounded-xl text-[11px] font-semibold"
                          >
                            <Route className="mr-1 h-3 w-3" />
                            {isSelected ? "Tracking route" : "Show route"}
                          </Button>
                          {rescue.response_eta && rescue.response_status !== "Arrived" && (
                            <span className="font-data text-[11px] font-semibold text-foreground-muted">
                              ETA {new Date(rescue.response_eta).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
