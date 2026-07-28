"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { createReservation, getServiceTypes, getBookingChannels } from "@/services/reservation.service";
import { getAvailableVehiclesForReservation } from "@/services/ai.service";
import { ArrowLeft, Loader2, Truck, CheckCircle2, ChevronRight, Brain, Sparkles, Building, ExternalLink } from "lucide-react";

const reservationSchema = z.object({
  guest_name: z.string().optional(),
  guest_phone: z.string().optional(),
  guest_email: z.string().email().optional().or(z.literal("")),
  pickup_location: z.string().min(1, "Pickup location is required"),
  dropoff_location: z.string().optional(),
  reservation_date: z.string().min(1, "Date is required"),
  pickup_time: z.string().min(1, "Pickup time is required"),
  estimated_return_time: z.string().optional(),
  purpose: z.string().optional(),
  passenger_count: z.coerce.number().min(1).default(1),
  notes: z.string().optional(),
  vehicle_id: z.coerce.number().optional(),
  driver_id: z.coerce.number().optional(),
  service_type_id: z.coerce.number().optional(),
  booking_channel_id: z.coerce.number().optional(),
  external_booking_id: z.string().optional(),
  integration_source: z.string().optional(),
  room_number: z.string().optional(),
  bill_to_room: z.boolean().optional(),
  guest_id: z.string().optional(),
});

export default function NewReservationPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [showIntegrationFields, setShowIntegrationFields] = useState(false);

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ["serviceTypes"],
    queryFn: getServiceTypes,
  });

  const { data: bookingChannels = [] } = useQuery({
    queryKey: ["bookingChannels"],
    queryFn: getBookingChannels,
  });

  const form = useForm({
    resolver: zodResolver(reservationSchema),
    defaultValues: {
      guest_name: "",
      guest_phone: "",
      guest_email: "",
      pickup_location: "",
      dropoff_location: "",
      reservation_date: new Date().toISOString().split("T")[0],
      pickup_time: "09:00",
      estimated_return_time: "",
      purpose: "",
      passenger_count: 1,
      notes: "",
      service_type_id: "",
      booking_channel_id: "",
      external_booking_id: "",
      integration_source: "",
      room_number: "",
      bill_to_room: false,
      guest_id: "",
    },
  });

  const watchPassengerCount = form.watch("passenger_count");
  const watchDate = form.watch("reservation_date");

  useEffect(() => {
    if (watchPassengerCount && watchDate) {
      loadAiRecommendations();
    }
  }, [watchPassengerCount, watchDate]);

  const loadAiRecommendations = async () => {
    setLoadingAi(true);
    try {
      const data = form.getValues();
      const recommendations = await getAvailableVehiclesForReservation(data);
      setAiRecommendations(recommendations);
      if (recommendations.length > 0) {
        setSelectedVehicle(recommendations[0]);
      }
    } catch (err) {
      console.error("AI recommendation error:", err);
    } finally {
      setLoadingAi(false);
    }
  };

  const [createError, setCreateError] = useState(null);

  const createMutation = useMutation({
    mutationFn: createReservation,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      router.push(`/reservations/${data.reservation_id}`);
    },
    onError: (err) => {
      setCreateError(err.message || "Failed to create reservation");
    },
  });

  const onSubmit = (data) => {
    const payload = {
      ...data,
      service_type_id: data.service_type_id || null,
      booking_channel_id: data.booking_channel_id || null,
      external_booking_id: data.external_booking_id || null,
      integration_source: data.integration_source || null,
      room_number: data.room_number || null,
      bill_to_room: data.bill_to_room || false,
      guest_id: data.guest_id || null,
      vehicle_id: selectedVehicle?.vehicle?.vehicle_id || null,
      ai_vehicle_recommendation: selectedVehicle
        ? { vehicle_id: selectedVehicle.vehicle.vehicle_id, score: selectedVehicle.score, confidence: selectedVehicle.confidence, reasons: selectedVehicle.reasons }
        : null,
    };
    createMutation.mutate(payload);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">New Reservation</h1>
          <p className="text-foreground-secondary mt-1">Create a vehicle reservation for a guest or external booking</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Guest Information</CardTitle>
            </CardHeader>
            <CardContent>
              <form id="reservation-form" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="guest_name">Guest Name</Label>
                    <Input id="guest_name" {...form.register("guest_name")} placeholder="Guest name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="guest_phone">Phone</Label>
                    <Input id="guest_phone" {...form.register("guest_phone")} placeholder="+63 912 345 6789" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="guest_email">Email</Label>
                    <Input id="guest_email" type="email" {...form.register("guest_email")} placeholder="guest@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="passenger_count">Passenger Count</Label>
                    <Input id="passenger_count" type="number" min="1" {...form.register("passenger_count")} />
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Service Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="service_type">Service Type</Label>
                  <Select
                    value={form.watch("service_type_id")?.toString() || ""}
                    onValueChange={(val) => form.setValue("service_type_id", Number(val))}
                  >
                    <SelectTrigger id="service_type">
                      <SelectValue placeholder="Select service type" />
                    </SelectTrigger>
                    <SelectContent>
                      {serviceTypes.map((st) => (
                        <SelectItem key={st.service_type_id} value={st.service_type_id.toString()}>
                          {st.service_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="booking_channel">Booking Channel</Label>
                  <Select
                    value={form.watch("booking_channel_id")?.toString() || ""}
                    onValueChange={(val) => form.setValue("booking_channel_id", Number(val))}
                  >
                    <SelectTrigger id="booking_channel">
                      <SelectValue placeholder="Where was this booked?" />
                    </SelectTrigger>
                    <SelectContent>
                      {bookingChannels.map((bc) => (
                        <SelectItem key={bc.channel_id} value={bc.channel_id.toString()}>
                          {bc.channel_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pickup_location">Pickup Location *</Label>
                  <Input id="pickup_location" {...form.register("pickup_location")} placeholder="Hotel lobby, restaurant, etc." />
                  {form.formState.errors.pickup_location && (
                    <p className="text-xs text-danger">{form.formState.errors.pickup_location.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dropoff_location">Dropoff Location</Label>
                  <Input id="dropoff_location" {...form.register("dropoff_location")} placeholder="Destination (optional)" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reservation_date">Date *</Label>
                  <Input id="reservation_date" type="date" {...form.register("reservation_date")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pickup_time">Pickup Time *</Label>
                  <Input id="pickup_time" type="time" {...form.register("pickup_time")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="estimated_return_time">Est. Return Time</Label>
                  <Input id="estimated_return_time" type="time" {...form.register("estimated_return_time")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="purpose">Purpose</Label>
                  <Input id="purpose" {...form.register("purpose")} placeholder="Airport transfer, delivery, etc." />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  {...form.register("notes")}
                  className="flex min-h-[80px] w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm"
                  placeholder="Special requests or instructions..."
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Parent System Integration</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowIntegrationFields(!showIntegrationFields)}
                >
                  <ExternalLink className="w-4 h-4 mr-1" />
                  {showIntegrationFields ? "Hide" : "Link to Booking"}
                </Button>
              </div>
            </CardHeader>
            {showIntegrationFields && (
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="external_booking_id">External Booking ID</Label>
                    <Input id="external_booking_id" {...form.register("external_booking_id")} placeholder="From PMS, POS, etc." />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="integration_source">Source System</Label>
                    <Select
                      value={form.watch("integration_source") || ""}
                      onValueChange={(val) => form.setValue("integration_source", val)}
                    >
                      <SelectTrigger id="integration_source">
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PMS">PMS (Hotel)</SelectItem>
                        <SelectItem value="POS">POS (Restaurant)</SelectItem>
                        <SelectItem value="RestoBooking">RestoBooking</SelectItem>
                        <SelectItem value="Web">Web Booking</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="room_number">Room Number</Label>
                    <Input id="room_number" {...form.register("room_number")} placeholder="e.g. 1205" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="guest_id">Guest ID (Parent System)</Label>
                    <Input id="guest_id" {...form.register("guest_id")} placeholder="From parent system" />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      id="bill_to_room"
                      {...form.register("bill_to_room")}
                      className="w-4 h-4 rounded border-border"
                    />
                    <Label htmlFor="bill_to_room" className="cursor-pointer">Bill this transport to room</Label>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                <CardTitle className="text-base font-semibold">AI Recommendation</CardTitle>
                <Badge variant="default" className="text-[10px]">AI</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loadingAi ? (
                <div className="flex flex-col items-center justify-center py-8 text-foreground-muted">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <p className="text-sm">Analyzing fleet...</p>
                </div>
              ) : aiRecommendations.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-foreground-muted mb-2">
                    Top {aiRecommendations.length} vehicles recommended based on availability, capacity, and fleet status
                  </p>
                  {aiRecommendations.slice(0, 3).map((rec, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedVehicle(rec)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        selectedVehicle?.vehicle?.vehicle_id === rec.vehicle.vehicle_id
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/50 hover:bg-hover"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Truck className="w-4 h-4 text-foreground-muted" />
                          <span className="text-sm font-medium text-foreground">{rec.vehicle.plate_number}</span>
                        </div>
                        <Badge variant={rec.confidence > 0.7 ? "success" : "warning"} className="text-[10px]">
                          {Math.round(rec.confidence * 100)}%
                        </Badge>
                      </div>
                      <p className="text-xs text-foreground-muted">{rec.vehicle.vehicle_name} · {rec.vehicle.seating_capacity} seats · {rec.vehicle.fuel_level}% fuel</p>
                      <div className="flex items-center gap-1 mt-1.5">
                        <Sparkles className="w-3 h-3 text-warning" />
                        <p className="text-xs text-foreground-secondary">{rec.reasons[0]}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-foreground-muted">
                  <Truck className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Set passenger count and date</p>
                  <p className="text-xs mt-1">AI will recommend vehicles</p>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedVehicle && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Selected Vehicle</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-success/5 border border-success/20">
                  <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{selectedVehicle.vehicle.plate_number}</p>
                    <p className="text-xs text-foreground-muted">{selectedVehicle.vehicle.vehicle_name} · {selectedVehicle.vehicle.vehiclecategories?.category_name}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {createError && (
          <p className="text-sm text-destructive mr-auto">{createError}</p>
        )}
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" form="reservation-form" disabled={createMutation.isPending}>
          {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Create Reservation
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
