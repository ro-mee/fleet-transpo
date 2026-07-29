"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDispatch } from "@/services/dispatch.service";
import { formatDateTime } from "@/lib/utils";
import { ArrowLeft, Truck, Users, Route, Clock, MapPin, Send, FileText } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function DispatchDetailPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const params = useParams();
  const router = useRouter();
  const dispatchId = Number(params.id);

  const { data: dispatch, isLoading } = useQuery({
    queryKey: ["dispatch", dispatchId],
    queryFn: () => getDispatch(dispatchId),
    enabled: !!dispatchId,
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-muted rounded w-1/3" />
        <div className="h-48 bg-muted rounded-xl" />
      </div>
    );
  }

  if (!dispatch) {
    return (
      <div className="text-center py-12 text-foreground-muted">
        <Send className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">Dispatch not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{dispatch.dispatch_number}</h1>
            <Badge>{dispatch.status}</Badge>
          </div>
          <p className="text-foreground-secondary mt-1">Created {formatDateTime(dispatch.created_at)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Truck className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">{dispatch.vehicles?.plate_number || "Unassigned"}</p>
            <p className="text-xs text-foreground-muted">Vehicle</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Users className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">
              {dispatch.drivers?.employees
                ? `${dispatch.drivers.employees.first_name} ${dispatch.drivers.employees.last_name}`
                : "Unassigned"}
            </p>
            <p className="text-xs text-foreground-muted">Driver</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Clock className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">
              {dispatch.scheduled_departure ? formatDateTime(dispatch.scheduled_departure) : "—"}
            </p>
            <p className="text-xs text-foreground-muted">Departure</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Route className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">{dispatch.estimated_distance || "—"} km</p>
            <p className="text-xs text-foreground-muted">Est. Distance</p>
          </CardContent>
        </Card>
      </div>

      {dispatch.vehiclereservations && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Reservation Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <MapPin className="w-4 h-4 text-danger" />
                <div>
                  <p className="text-xs text-foreground-muted">Pickup</p>
                  <p className="text-sm font-medium text-foreground">{dispatch.vehiclereservations.pickup_location}</p>
                </div>
              </div>
              {dispatch.vehiclereservations.dropoff_location && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                  <MapPin className="w-4 h-4 text-success" />
                  <div>
                    <p className="text-xs text-foreground-muted">Dropoff</p>
                    <p className="text-sm font-medium text-foreground">{dispatch.vehiclereservations.dropoff_location}</p>
                  </div>
                </div>
              )}
              {dispatch.vehiclereservations.guest_name && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                  <Users className="w-4 h-4 text-foreground-muted" />
                  <div>
                    <p className="text-xs text-foreground-muted">Guest</p>
                    <p className="text-sm font-medium text-foreground">{dispatch.vehiclereservations.guest_name}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {dispatch.routes && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Route</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-3">
                <Route className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">{dispatch.routes.route_name}</p>
                  <p className="text-xs text-foreground-muted">
                    {dispatch.routes.origin} → {dispatch.routes.destination}
                  </p>
                </div>
              </div>
              <span className="text-sm font-medium">{dispatch.routes.estimated_distance} km</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
