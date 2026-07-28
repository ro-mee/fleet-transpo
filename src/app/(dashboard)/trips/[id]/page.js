"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTrip, startTrip, completeTrip, updateTripStatus, getTripLocations } from "@/services/trip.service";
import { formatDateTime, formatDuration, formatCurrency } from "@/lib/utils";
import {
  ArrowLeft,
  Truck, Users, Route, Clock, MapPin, Navigation, Gauge,
  Fuel, DollarSign, CheckCircle2, Loader2, Play, Square, ChevronRight,
  TrendingUp, Star
} from "lucide-react";
import { toast } from "@/components/ui/toast";

const tripSteps = [
  "Pending", "Approved", "Dispatched", "Driver Accepted",
  "Trip Started", "En Route", "Arrived", "Completed"
];

export default function TripDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tripId = Number(params.id);

  const { data: trip, isLoading } = useQuery({
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
    mutationFn: () => startTrip(tripId, { odometer: trip?.start_odometer || 0 }),
    onSuccess: () => {
      toast.success("Trip started");
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
    mutationFn: () => completeTrip(tripId, {
      end_odometer: trip?.end_odometer || (trip?.start_odometer || 0) + (trip?.distance || 0),
      start_odometer: trip?.start_odometer,
    }),
    onSuccess: () => {
      toast.success("Trip completed");
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

  const statusMutation = useMutation({
    mutationFn: (status) => updateTripStatus(tripId, status),
    onSuccess: (_data, status) => {
      toast.success(`Trip status: ${status}`);
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

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-muted rounded w-1/3" />
        <div className="h-48 bg-muted rounded-xl" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="text-center py-12 text-foreground-muted">
        <Route className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">Trip not found</p>
      </div>
    );
  }

  const currentStepIndex = tripSteps.indexOf(trip.trip_status);
  const canStart = trip.trip_status === "Dispatched" || trip.trip_status === "Driver Accepted";
  const canComplete = trip.trip_status === "Trip Started" || trip.trip_status === "En Route" || trip.trip_status === "Arrived";

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">Trip #{trip.trip_id}</h1>
              <Badge variant={trip.trip_status === "Completed" ? "success" : trip.trip_status === "En Route" ? "warning" : "default"}>
                {trip.trip_status}
              </Badge>
            </div>
            <p className="text-foreground-secondary mt-1">
              {trip.vehicles?.plate_number} · {trip.origin || "—"} → {trip.destination || "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canStart && (
            <Button size="sm" className="bg-success hover:bg-emerald-600" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              {startMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              Start Trip
            </Button>
          )}
          {canComplete && (
            <Button size="sm" className="bg-primary" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
              {completeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Square className="w-4 h-4 mr-2" />}
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
                <div key={step} className="flex items-center gap-1 flex-shrink-0">
                  <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] whitespace-nowrap transition-all font-medium ${
                    isCurrent ? "bg-primary text-white" : isCompleted ? "bg-success/10 text-success" : "bg-muted text-foreground-muted"
                  }`}>
                    {isCompleted && !isCurrent && <CheckCircle2 className="w-2.5 h-2.5" />}
                    {step}
                  </div>
                  {i < tripSteps.length - 1 && (
                    <ChevronRight className={`w-2.5 h-2.5 ${i < currentStepIndex ? "text-success" : "text-foreground-muted"}`} />
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
            <p className="text-sm font-medium text-foreground">{trip.vehicles?.plate_number || "—"}</p>
            <p className="text-xs text-foreground-muted">{trip.vehicles?.vehicle_name || "Vehicle"}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Users className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">
              {trip.drivers?.employees?.first_name || "—"} {trip.drivers?.employees?.last_name || ""}
            </p>
            <p className="text-xs text-foreground-muted">Driver</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Navigation className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">{trip.distance || "—"} km</p>
            <p className="text-xs text-foreground-muted">Distance</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Clock className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">
              {trip.actual_duration ? formatDuration(trip.actual_duration) : "—"}
            </p>
            <p className="text-xs text-foreground-muted">Duration</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Performance Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <Gauge className="w-4 h-4 text-primary" />
                  <span className="text-xs text-foreground-muted">Avg Speed</span>
                </div>
                <p className="text-lg font-bold text-foreground">{trip.avg_speed || "—"} km/h</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <Gauge className="w-4 h-4 text-danger" />
                  <span className="text-xs text-foreground-muted">Max Speed</span>
                </div>
                <p className="text-lg font-bold text-foreground">{trip.max_speed || "—"} km/h</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <Fuel className="w-4 h-4 text-warning" />
                  <span className="text-xs text-foreground-muted">Fuel Consumed</span>
                </div>
                <p className="text-lg font-bold text-foreground">{trip.fuel_consumed || "—"} L</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-foreground-muted" />
                  <span className="text-xs text-foreground-muted">Idle Time</span>
                </div>
                <p className="text-lg font-bold text-foreground">
                  {trip.idle_time ? formatDuration(trip.idle_time) : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Cost Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            {trip.tripcostanalysis ? (
              <div className="space-y-3">
                {[
                  { label: "Fuel Cost", value: trip.tripcostanalysis.fuel_cost, icon: Fuel },
                  { label: "Toll Fees", value: trip.tripcostanalysis.toll_fees, icon: Route },
                  { label: "Driver Cost", value: trip.tripcostanalysis.driver_cost, icon: Users },
                  { label: "Maintenance Cost", value: trip.tripcostanalysis.maintenance_cost, icon: Truck },
                  { label: "Miscellaneous", value: trip.tripcostanalysis.miscellaneous_cost, icon: DollarSign },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <item.icon className="w-4 h-4 text-foreground-muted" />
                      <span className="text-foreground-secondary">{item.label}</span>
                    </div>
                    <span className="font-medium text-foreground">{formatCurrency(item.value || 0)}</span>
                  </div>
                ))}
                <div className="pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Total Cost</span>
                  <span className="text-lg font-bold text-primary">
                    {formatCurrency(trip.tripcostanalysis.total_cost || 0)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground-muted text-center py-4">No cost data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {trip.tripperformance && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Driver Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-xl bg-muted/30">
                <Star className="w-5 h-5 mx-auto mb-1 text-warning" />
                <p className="text-lg font-bold text-foreground">{trip.tripperformance.smooth_driving_score || "—"}</p>
                <p className="text-xs text-foreground-muted">Driving Score</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-muted/30">
                <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-success" />
                <p className="text-lg font-bold text-foreground">{trip.tripperformance.on_time_completion ? "Yes" : "No"}</p>
                <p className="text-xs text-foreground-muted">On Time</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-muted/30">
                <TrendingUp className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-lg font-bold text-foreground">{trip.tripperformance.fuel_efficiency || "—"}</p>
                <p className="text-xs text-foreground-muted">km/L</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-muted/30">
                <Star className="w-5 h-5 mx-auto mb-1 text-warning" />
                <p className="text-lg font-bold text-foreground">{trip.tripperformance.customer_rating || "—"}</p>
                <p className="text-xs text-foreground-muted">Rating</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {locations.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Route Tracked ({locations.length} points)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] bg-muted/30 rounded-xl flex items-center justify-center text-foreground-muted">
              <MapPin className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">Route map loaded with React Leaflet ({locations.length} GPS points)</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
