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
import { formatDateTime, formatDuration, formatCurrency } from "@/lib/utils";
import { DISPATCH_STATUS as D } from "@/lib/constants";
import { useRoleAccess } from "@/hooks/use-role-access";
import {
  ArrowLeft,
  Truck,
  Users,
  Route,
  Clock,
  MapPin,
  Navigation,
  Gauge,
  Fuel,
  DollarSign,
  CheckCircle2,
  Loader2,
  Play,
  Square,
  ChevronRight,
  TrendingUp,
  Star,
  TriangleAlert,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";

const TripRouteMap = dynamic(() => import("@/components/maps/live-locations-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-hover rounded-xl" />,
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
      queryClient.invalidateQueries({ queryKey: ["dispatches-status"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch"] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      queryClient.invalidateQueries({ queryKey: ["reservation"] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <DetailSkeleton />;

  if (isError) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Go back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Trip Details</h1>
        </div>
        <EmptyState
          icon={TriangleAlert}
          title="Could not load this trip"
          description={error?.message || "Something went wrong reading the trip details."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="space-y-6 max-w-4xl">
        <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Go back">
          <ArrowLeft className="w-5 h-5" />
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

  const driverName = trip.drivers
    ? `${trip.drivers.first_name || ""} ${trip.drivers.last_name || ""}`.trim()
    : "Unassigned";

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
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Go back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">Trip #{trip.trip_id}</h1>
              <Badge
                variant={
                  trip.trip_status === "Completed"
                    ? "success"
                    : trip.trip_status === "En Route"
                    ? "warning"
                    : "default"
                }
              >
                {trip.trip_status}
              </Badge>
            </div>
            <p className="text-foreground-secondary mt-1">
              {trip.vehicles?.plate_number} · {pickup} → {dropoff}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canStart && (
            <Button
              size="sm"
              className="bg-success hover:bg-emerald-600"
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
              className="bg-primary"
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
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {tripSteps.map((step, i) => {
              const isCompleted = i <= currentStepIndex;
              const isCurrent = i === currentStepIndex;
              return (
                <div
                  key={step}
                  className="flex items-center gap-1 flex-shrink-0"
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <div
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] whitespace-nowrap transition-all font-medium ${
                      isCurrent
                        ? "bg-primary text-surface font-semibold"
                        : isCompleted
                        ? "bg-success/10 text-success"
                        : "bg-muted text-foreground-muted"
                    }`}
                  >
                    {isCompleted && !isCurrent && (
                      <CheckCircle2 className="w-2.5 h-2.5" aria-hidden="true" />
                    )}
                    {step}
                  </div>
                  {i < tripSteps.length - 1 && (
                    <ChevronRight
                      className={`w-2.5 h-2.5 ${
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Truck className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">
              {trip.vehicles?.plate_number || "—"}
            </p>
            <p className="text-xs text-foreground-muted">{trip.vehicles?.vehicle_name || "Vehicle"}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Users className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">{driverName}</p>
            <p className="text-xs text-foreground-muted">Driver</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Gauge className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground font-data">
              {trip.distance != null ? `${trip.distance} km` : "—"}
            </p>
            <p className="text-xs text-foreground-muted">Distance Traveled</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Clock className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">
              {formatDuration(trip.actual_duration)}
            </p>
            <p className="text-xs text-foreground-muted">Actual Duration</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Route &amp; Schedule Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-foreground-muted">Pickup Location</p>
                <p className="text-sm font-medium text-foreground">{pickup}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Navigation className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-foreground-muted">Dropoff Location</p>
                <p className="text-sm font-medium text-foreground">{dropoff}</p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-foreground-muted mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-foreground-muted">Start Time</p>
                <p className="text-sm font-medium text-foreground font-data">
                  {formatDateTime(trip.start_time)}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-foreground-muted mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-foreground-muted">End Time</p>
                <p className="text-sm font-medium text-foreground font-data">
                  {formatDateTime(trip.end_time)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {hasPerformanceMetrics && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Performance &amp; Efficiency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-xl bg-muted/30">
                <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-emerald-500" />
                <p className="text-lg font-bold text-foreground">
                  {trip.on_time_completion ? "Yes" : "No"}
                </p>
                <p className="text-xs text-foreground-muted">On Time</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-muted/30">
                <TrendingUp className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-lg font-bold text-foreground">{trip.fuel_efficiency ?? "—"}</p>
                <p className="text-xs text-foreground-muted">km/L</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-muted/30">
                <Star className="w-5 h-5 mx-auto mb-1 text-warning" />
                <p className="text-lg font-bold text-foreground">{trip.customer_rating ?? "—"}</p>
                <p className="text-xs text-foreground-muted">Rating</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dynamic Route Map Card */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center justify-between">
            <span>Route Tracked ({locations.length} points)</span>
            <Badge variant="outline" className="text-xs font-data">
              {locations.length > 0 ? "GPS Tracked" : "No Coordinates"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full rounded-xl overflow-hidden border border-border">
            {locations.length > 0 ? (
              <TripRouteMap locations={locations} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-foreground-muted bg-muted/30">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">No GPS tracking data recorded for this trip</p>
                <p className="text-xs text-foreground-muted mt-1">
                  GPS location points will render here when recorded during en route status.
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
        onClose={() => setOdometerMode(null)}
        isPending={startMutation.isPending || completeMutation.isPending}
        onSubmit={({ mode, body }) =>
          mode === "start" ? startMutation.mutate(body) : completeMutation.mutate(body)
        }
      />
    </div>
  );
}
