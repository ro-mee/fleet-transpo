"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { injectTransportRequest, pullTransportRequests } from "@/services/transport.service";
import { getVehicleCategories } from "@/services/vehicle.service";
import { ArrowLeft, Loader2, FlaskConical, DownloadCloud, Inbox } from "lucide-react";
import { toast } from "@/components/ui/toast";

// ============================================================================
// DEV-ONLY: Mock transportation-request injector.
//
// In production, transportation requests arrive FROM the Booking subsystem over
// the integration boundary (webhook -> POST /api/integration/transport-requests,
// or the poller -> /api/integration/pull). Fleet NEVER authors guest bookings.
//
// This page exists only so a developer without a live Booking system can push a
// request shaped EXACTLY like a real Booking payload (TransportationRequestSchema)
// through that same inbound boundary. It is hidden when the HTTP gateway is live.
// ============================================================================

// Client can't read a server-only env var; BOOKING gateway mode is mirrored to a
// NEXT_PUBLIC_ var. Default (unset) is treated as mock/dev.
const GATEWAY = process.env.NEXT_PUBLIC_BOOKING_GATEWAY || "mock";

function nowPlusHoursLocal(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours, 0, 0, 0);
  // datetime-local wants "YYYY-MM-DDTHH:mm" with no timezone.
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MockInjectorPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Vehicle classes, for the field Booking really sends. This used to offer
  // service_types, which is an empty table — the dropdown opened onto nothing.
  const { data: categories = [] } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: () => getVehicleCategories(),
  });

  const [form, setForm] = useState({
    external_booking_id: "",
    source_system: "PMS",
    booking_reference: "",
    guest_name: "",
    pickup_location: "",
    dropoff_location: "",
    pickup_datetime: nowPlusHoursLocal(2),
    passenger_count: 1,
    special_requests: "",
    // Free text, exactly as Booking sends it. The dropdown offers Fleet's own
    // category names for convenience, but the value crossing the boundary is a
    // STRING — Booking does not know Fleet's category ids and must never send
    // one. Ingest resolves it back to requested_category_id.
    requested_vehicle_type: "",
    priority: "Normal",
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const injectMutation = useMutation({
    mutationFn: injectTransportRequest,
    onSuccess: (res) => {
      toast.success(
        res?.idempotent
          ? "Already ingested — request is already in the queue"
          : "Mock request injected into the Fleet queue"
      );
      queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
      router.push("/reservations/queue");
    },
    onError: (err) => toast.error(err.message || "Failed to inject request"),
  });

  const pullMutation = useMutation({
    mutationFn: pullTransportRequests,
    onSuccess: (res) => {
      toast.success(
        res?.ingested
          ? `Pulled ${res.ingested} canned request${res.ingested === 1 ? "" : "s"} from the mock gateway`
          : "Mock gateway returned nothing new"
      );
      queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
      router.push("/reservations/queue");
    },
    onError: (err) => toast.error(err.message || "Failed to pull from mock gateway"),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.external_booking_id.trim()) return toast.error("External booking ID is required");
    if (!form.pickup_location.trim()) return toast.error("Pickup location is required");
    if (!form.pickup_datetime) return toast.error("Pickup datetime is required");

    // Shape the payload EXACTLY like a real Booking webhook (contracts.js).
    const payload = {
      external_booking_id: form.external_booking_id.trim(),
      source_system: form.source_system || "PMS",
      booking_reference: form.booking_reference || null,
      guest_name: form.guest_name || null,
      pickup_location: form.pickup_location.trim(),
      dropoff_location: form.dropoff_location || null,
      // Send an ISO string with the local offset, as a real payload would.
      pickup_datetime: new Date(form.pickup_datetime).toISOString(),
      passenger_count: Number(form.passenger_count) || 1,
      special_requests: form.special_requests || null,
      requested_vehicle_type: form.requested_vehicle_type || null,
      priority: form.priority || "Normal",
      booking_status: "Pending",
    };
    injectMutation.mutate(payload);
  };

  if (GATEWAY === "http") {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/reservations/queue")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Mock Injector Disabled</h1>
            <p className="text-foreground-secondary mt-1">
              The live Booking gateway is active — requests arrive automatically.
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-foreground-secondary">
            <Inbox className="w-8 h-8 mx-auto mb-3 opacity-60" />
            <p>Transportation requests flow in from the Booking system.</p>
            <Button className="mt-4" onClick={() => router.push("/reservations/queue")}>
              Go to Request Queue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/reservations/queue")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-warning" />
            <h1 className="text-2xl font-bold text-foreground">Inject Mock Request</h1>
          </div>
          <p className="text-foreground-secondary mt-1">
            Developer tool — simulates a transportation request from the Booking system.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
        <FlaskConical className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <div className="text-sm text-foreground-secondary">
          <p className="font-medium text-foreground">This is not a real reservation form.</p>
          <p className="mt-0.5">
            Fleet never authors guest bookings. This pushes a Booking-shaped payload through the
            same inbound boundary a real webhook uses, so you can exercise the queue in dev.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">Or pull the canned mock requests</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => pullMutation.mutate()}
            disabled={pullMutation.isPending}
          >
            <DownloadCloud className="w-4 h-4 mr-2" />
            {pullMutation.isPending ? "Pulling…" : "Pull mock batch"}
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Custom Request</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="external_booking_id">External Booking ID *</Label>
              <Input
                id="external_booking_id"
                value={form.external_booking_id}
                onChange={(e) => set("external_booking_id", e.target.value)}
                placeholder="BK-2026-00999"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source_system">Source System</Label>
              <Select value={form.source_system} onValueChange={(v) => set("source_system", v)}>
                <SelectTrigger id="source_system">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PMS">PMS (Hotel)</SelectItem>
                  <SelectItem value="POS">POS (Restaurant)</SelectItem>
                  <SelectItem value="Web">Web Booking</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking_reference">Booking Reference</Label>
              <Input
                id="booking_reference"
                value={form.booking_reference}
                onChange={(e) => set("booking_reference", e.target.value)}
                placeholder="Confirmation # (optional)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guest_name">Guest Name</Label>
              <Input
                id="guest_name"
                value={form.guest_name}
                onChange={(e) => set("guest_name", e.target.value)}
                placeholder="From Booking (optional)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pickup_location">Pickup Location *</Label>
              <Input
                id="pickup_location"
                value={form.pickup_location}
                onChange={(e) => set("pickup_location", e.target.value)}
                placeholder="Hotel lobby"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dropoff_location">Dropoff Location</Label>
              <Input
                id="dropoff_location"
                value={form.dropoff_location}
                onChange={(e) => set("dropoff_location", e.target.value)}
                placeholder="Airport (optional)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pickup_datetime">Pickup Date & Time *</Label>
              <Input
                id="pickup_datetime"
                type="datetime-local"
                value={form.pickup_datetime}
                onChange={(e) => set("pickup_datetime", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="passenger_count">Passenger Count</Label>
              <Input
                id="passenger_count"
                type="number"
                min="1"
                value={form.passenger_count}
                onChange={(e) => set("passenger_count", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority">Priority</Label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Normal">Normal</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requested_vehicle_type">Vehicle Class</Label>
              <Select
                value={form.requested_vehicle_type}
                onValueChange={(v) => set("requested_vehicle_type", v)}
              >
                <SelectTrigger id="requested_vehicle_type">
                  <SelectValue placeholder="What booking is asking for" />
                </SelectTrigger>
                <SelectContent>
                  {categories.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-foreground-muted">
                      No vehicle categories yet. Add them under Fleet → Categories.
                    </div>
                  ) : (
                    categories.map((c) => (
                      <SelectItem key={c.category_id} value={c.category_name}>
                        {c.category_name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="special_requests">Special Requests</Label>
              <textarea
                id="special_requests"
                value={form.special_requests}
                onChange={(e) => set("special_requests", e.target.value)}
                className="flex min-h-[70px] w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Wheelchair access, extra luggage, etc."
              />
            </div>

            <div className="md:col-span-2 flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/reservations/queue")}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={injectMutation.isPending}>
                {injectMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Inject Request
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
