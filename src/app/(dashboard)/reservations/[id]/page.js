"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getReservation, updateReservation, cancelReservation } from "@/services/reservation.service";
import { getDispatches } from "@/services/dispatch.service";
import { createDispatch } from "@/services/dispatch.service";
import { formatDate, formatTime, formatDateTime } from "@/lib/utils";
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Users,
  Phone,
  Mail,
  FileText,
  CheckCircle2,
  XCircle,
  Send,
  Truck,
  Loader2,
  ChevronRight,
  AlertTriangle,
  ExternalLink,
  Building,
  DoorOpen,
  CreditCard,
} from "lucide-react";
import { toast } from "@/components/ui/toast";

const statusSteps = [
  "Pending",
  "Approved",
  "Dispatched",
  "Completed",
];

const statusVariant = {
  Pending: "warning",
  Approved: "success",
  Rejected: "danger",
  Cancelled: "secondary",
  Dispatched: "default",
  Completed: "success",
};

export default function ReservationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const reservationId = Number(params.id);

  const { data: reservation, isLoading, error } = useQuery({
    queryKey: ["reservation", reservationId],
    queryFn: () => getReservation(reservationId),
    enabled: !!reservationId,
  });

  const { data: dispatches = [] } = useQuery({
    queryKey: ["dispatches"],
    queryFn: () => getDispatches({}),
  });

  const dispatchForReservation = dispatches.find(
    (d) => d.reservation_id === reservationId
  );

  const approveMutation = useMutation({
    mutationFn: () => updateReservation(reservationId, { status: "Approved" }),
    onSuccess: () => {
      toast.success("Reservation approved");
      queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: () => updateReservation(reservationId, { status: "Rejected" }),
    onSuccess: () => {
      toast.success("Reservation rejected");
      queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelReservation(reservationId),
    onSuccess: () => {
      toast.success("Reservation cancelled");
      queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const dispatchNumber = `DSP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(reservationId).padStart(4, "0")}`;
      return createDispatch({
        reservation_id: reservationId,
        vehicle_id: reservation.vehicle_id,
        driver_id: reservation.driver_id,
        dispatch_number: dispatchNumber,
        scheduled_departure: `${reservation.reservation_date}T${reservation.pickup_time}`,
        status: "Scheduled",
      });
    },
    onSuccess: () => {
      toast.success("Reservation dispatched");
      updateReservation(reservationId, { status: "Dispatched" });
      queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      queryClient.invalidateQueries({ queryKey: ["dispatches"] });
      queryClient.invalidateQueries({ queryKey: ["dispatches-status"] });
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

  if (!reservation) {
    return (
      <div className="text-center py-12 text-foreground-muted">
        <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">Reservation not found</p>
        <p className="text-sm mt-2">The reservation could not be loaded. It may have been deleted or you may not have permission to view it.</p>
        {error && <p className="text-xs mt-2 text-destructive">Error: {error.message}</p>}
        <Button variant="outline" className="mt-4" onClick={() => router.push("/reservations")}>
          Back to Reservations
        </Button>
      </div>
    );
  }

  const currentStatusIndex = statusSteps.indexOf(reservation.status);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">
                Reservation #{reservation.reservation_id}
              </h1>
              <Badge variant={statusVariant[reservation.status] || "default"}>
                {reservation.status}
              </Badge>
            </div>
            <p className="text-foreground-secondary mt-1">
              Created {formatDateTime(reservation.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {reservation.status === "Pending" && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="text-danger border-danger/20"
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Reject
              </Button>
              <Button
                size="sm"
                className="bg-success hover:bg-emerald-600"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                Approve
              </Button>
            </>
          )}
          {reservation.status === "Approved" && (
            <Button
              size="sm"
              onClick={() => dispatchMutation.mutate()}
              disabled={dispatchMutation.isPending}
            >
              {dispatchMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Create Dispatch
            </Button>
          )}
          {(reservation.status === "Pending" || reservation.status === "Approved") && (
            <Button
              variant="ghost"
              size="sm"
              className="text-foreground-muted"
              onClick={() => cancelMutation.mutate()}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Trip Progress</h3>
            <Badge variant={currentStatusIndex >= 2 ? "success" : "default"}>
              Step {Math.max(currentStatusIndex + 1, 0)} of {statusSteps.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {statusSteps.map((step, i) => {
              const isCompleted = i <= currentStatusIndex;
              const isCurrent = i === currentStatusIndex;
              return (
                <div key={step} className="flex items-center gap-1">
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all ${
                      isCurrent
                        ? "bg-primary text-white"
                        : isCompleted
                        ? "bg-success/10 text-success"
                        : "bg-muted text-foreground-muted"
                    }`}
                  >
                    {isCompleted && !isCurrent && <CheckCircle2 className="w-3 h-3" />}
                    {step}
                  </div>
                  {i < statusSteps.length - 1 && (
                    <ChevronRight className={`w-3 h-3 ${i < currentStatusIndex ? "text-success" : "text-foreground-muted"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Guest Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
              <Users className="w-4 h-4 text-foreground-muted" />
              <div>
                <p className="text-sm font-medium text-foreground">{reservation.guest_name || "Walk-in Guest"}</p>
                <p className="text-xs text-foreground-muted">{reservation.passenger_count || 1} passenger(s)</p>
              </div>
            </div>
            {reservation.guest_phone && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <Phone className="w-4 h-4 text-foreground-muted" />
                <p className="text-sm text-foreground">{reservation.guest_phone}</p>
              </div>
            )}
            {reservation.guest_email && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <Mail className="w-4 h-4 text-foreground-muted" />
                <p className="text-sm text-foreground">{reservation.guest_email}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Trip Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
              <MapPin className="w-4 h-4 text-danger" />
              <div>
                <p className="text-xs text-foreground-muted">Pickup</p>
                <p className="text-sm font-medium text-foreground">{reservation.pickup_location}</p>
              </div>
            </div>
            {reservation.dropoff_location && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <MapPin className="w-4 h-4 text-success" />
                <div>
                  <p className="text-xs text-foreground-muted">Dropoff</p>
                  <p className="text-sm font-medium text-foreground">{reservation.dropoff_location}</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <Calendar className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-xs text-foreground-muted">Date</p>
                  <p className="text-sm font-medium text-foreground">{formatDate(reservation.reservation_date)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <Clock className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-xs text-foreground-muted">Time</p>
                  <p className="text-sm font-medium text-foreground">{reservation.pickup_time?.slice(0, 5)}</p>
                </div>
              </div>
            </div>
            {reservation.purpose && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <FileText className="w-4 h-4 text-foreground-muted" />
                <div>
                  <p className="text-xs text-foreground-muted">Purpose</p>
                  <p className="text-sm text-foreground">{reservation.purpose}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {reservation.notes && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground-secondary">{reservation.notes}</p>
          </CardContent>
        </Card>
      )}

      {(reservation.external_booking_id || reservation.service_types || reservation.booking_channels) && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-foreground-muted" />
              <CardTitle className="text-base font-semibold">Integration Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {reservation.service_types && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                  <Building className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-xs text-foreground-muted">Service Type</p>
                    <p className="text-sm font-medium text-foreground">{reservation.service_types.service_name}</p>
                  </div>
                </div>
              )}
              {reservation.booking_channels && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                  <CreditCard className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-xs text-foreground-muted">Booked Via</p>
                    <p className="text-sm font-medium text-foreground">{reservation.booking_channels.channel_name}</p>
                  </div>
                </div>
              )}
              {reservation.external_booking_id && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                  <ExternalLink className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-xs text-foreground-muted">External Booking</p>
                    <p className="text-sm font-medium text-foreground font-data text-xs">{reservation.external_booking_id}</p>
                    {reservation.integration_source && (
                      <p className="text-[10px] text-foreground-muted">Source: {reservation.integration_source}</p>
                    )}
                  </div>
                </div>
              )}
              {reservation.room_number && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                  <DoorOpen className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-xs text-foreground-muted">Room</p>
                    <p className="text-sm font-medium text-foreground">{reservation.room_number}</p>
                    {reservation.bill_to_room && (
                      <p className="text-[10px] text-success">Bill to room</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {dispatchForReservation && (
        <Card className="">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Dispatch Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Send className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">{dispatchForReservation.dispatch_number}</p>
                  <p className="text-xs text-foreground-muted">
                    Vehicle: {dispatchForReservation.vehicles?.plate_number || "—"} · Driver: {dispatchForReservation.drivers?.employees?.first_name || "—"}
                  </p>
                </div>
              </div>
              <Badge>{dispatchForReservation.status}</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {reservation.ai_vehicle_recommendation && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <CardTitle className="text-base font-semibold">AI Recommendation</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-xs text-foreground-secondary bg-muted/30 p-3 rounded-xl overflow-x-auto">
              {JSON.stringify(reservation.ai_vehicle_recommendation, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
