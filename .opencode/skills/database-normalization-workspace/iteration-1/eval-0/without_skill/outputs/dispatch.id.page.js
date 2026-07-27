"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getDispatch } from "@/services/dispatch.service";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Route,
  Clock,
  Calendar,
  User,
  Truck,
  MapPin,
  Phone,
  Mail,
} from "lucide-react";

export default function DispatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const dispatchId = params.id;

  const { data: dispatch, isLoading } = useQuery({
    queryKey: ["dispatch", dispatchId],
    queryFn: () => getDispatch(dispatchId),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!dispatch) {
    return (
      <div className="p-6 text-center text-foreground-muted">
        Dispatch not found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{dispatch.dispatch_number}</h1>
          <p className="text-sm text-foreground-muted">Dispatch Details</p>
        </div>
        <Badge variant={dispatch.status === "Completed" ? "success" : "secondary"}>
          {dispatch.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-primary" />
              <div>
                <p className="text-xs text-foreground-muted">Scheduled Departure</p>
                <p className="text-sm font-medium text-foreground">
                  {new Date(dispatch.scheduled_departure).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-primary" />
              <div>
                <p className="text-xs text-foreground-muted">Scheduled Arrival</p>
                <p className="text-sm font-medium text-foreground">
                  {dispatch.scheduled_arrival ? new Date(dispatch.scheduled_arrival).toLocaleString() : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Vehicle & Driver</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dispatch.vehicles && (
              <div className="flex items-center gap-3">
                <Truck className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-xs text-foreground-muted">Vehicle</p>
                  <p className="text-sm font-medium text-foreground">
                    {dispatch.vehicles.plate_number} — {dispatch.vehicles.vehicle_name}
                  </p>
                </div>
              </div>
            )}
            {dispatch.drivers && (
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-xs text-foreground-muted">Driver</p>
                  <p className="text-sm font-medium text-foreground">
                    {dispatch.drivers.employees?.first_name} {dispatch.drivers.employees?.last_name}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {dispatch.vehiclereservations && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Reservation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-xs text-foreground-muted">Guest</p>
                  <p className="text-sm font-medium text-foreground">{dispatch.vehiclereservations.guest_name}</p>
                </div>
              </div>
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
                    {dispatch.routes.origin_location?.name} → {dispatch.routes.destination_location?.name}
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
