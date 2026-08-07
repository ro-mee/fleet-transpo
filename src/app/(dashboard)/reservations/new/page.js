"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { getLocations } from "@/services/location.service";
import { getRoutes } from "@/services/route.service";
import {
  ArrowLeft,
  Loader2,
  FlaskConical,
  DownloadCloud,
  Inbox,
  Plane,
  Building2,
  MapPin,
  ArrowRight,
  CheckCircle2,
  User,
  Calendar,
  Sparkles,
  Users,
  Clock,
  ShieldCheck,
  Hash,
  Layers,
  FileText,
  CarFront,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FloatingField } from "@/components/ui/field";

const GATEWAY = process.env.NEXT_PUBLIC_BOOKING_GATEWAY || "mock";

function nowPlusHoursLocal(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MockInjectorPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: categories = [] } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: () => getVehicleCategories(),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => getLocations(),
  });

  const { data: routes = [] } = useQuery({
    queryKey: ["routes"],
    queryFn: () => getRoutes(),
  });

  const [form, setForm] = useState({
    external_booking_id: "",
    source_system: "PMS",
    booking_reference: "",
    guest_name: "",
    pickup_location: "NAIA Terminal 2",
    dropoff_location: "CoCo Star Hotel",
    pickup_datetime: "",
    passenger_count: 1,
    special_requests: "",
    requested_vehicle_type: "",
    priority: "Normal",
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const applyRoutePreset = (pickup, dropoff) => {
    setForm((f) => ({
      ...f,
      pickup_location: pickup,
      dropoff_location: dropoff,
    }));
    toast.success(`Connected Route Set: ${pickup} ➔ ${dropoff}`);
  };

  const injectMutation = useMutation({
    mutationFn: injectTransportRequest,
    onSuccess: (res) => {
      toast.success(
        res.created
          ? `Created transport request #${res.id}`
          : `Duplicate or updated request #${res.id}`
      );
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      router.push("/reservations");
    },
    onError: (err) => toast.error(err.message),
  });

  const pullMutation = useMutation({
    mutationFn: () => pullTransportRequests(5),
    onSuccess: (res) => {
      toast.success(`Pulled ${res.total_received ?? 0} request(s) (${res.inserted_count ?? 0} created)`);
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRandomFill = () => {
    const r = Math.floor(Math.random() * 9000) + 1000;
    const names = [
      "Maria Clara",
      "Juan Dela Cruz",
      "Solaire VIP Guest",
      "Shangri-La Guest",
      "Okada Patron",
      "Alexander Wright",
      "Sophia Chen",
    ];
    const name = names[Math.floor(Math.random() * names.length)];
    const dateStr = nowPlusHoursLocal(Math.floor(Math.random() * 48) + 1);

    setForm({
      external_booking_id: `BK-2026-${r}`,
      source_system: ["PMS", "POS", "Web"][Math.floor(Math.random() * 3)],
      booking_reference: `REF-${r}`,
      guest_name: name,
      pickup_location: form.pickup_location,
      dropoff_location: form.dropoff_location,
      pickup_datetime: dateStr,
      passenger_count: Math.floor(Math.random() * 4) + 1,
      special_requests: "Cold towels & bottled water requested.",
      requested_vehicle_type: categories[0]?.category_name || "",
      priority: Math.random() > 0.7 ? "High" : "Normal",
    });
    toast.success("Filled mock transport request data!");
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.external_booking_id.trim()) {
      toast.error("External Booking ID is required");
      return;
    }
    injectMutation.mutate(form);
  };

  const naiaPresets = [
    { label: "NAIA T1 ➔ Hotel", pickup: "NAIA Terminal 1", dropoff: "CoCo Star Hotel" },
    { label: "NAIA T2 ➔ Hotel", pickup: "NAIA Terminal 2", dropoff: "CoCo Star Hotel" },
    { label: "NAIA T3 ➔ Hotel", pickup: "NAIA Terminal 3", dropoff: "CoCo Star Hotel" },
    { label: "NAIA T4 ➔ Hotel", pickup: "NAIA Terminal 4", dropoff: "CoCo Star Hotel" },
    { label: "Hotel ➔ NAIA T3", pickup: "CoCo Star Hotel", dropoff: "NAIA Terminal 3" },
    { label: "Hotel ➔ NAIA T1", pickup: "CoCo Star Hotel", dropoff: "NAIA Terminal 1" },
  ];

  return (
    <div className="space-y-6 w-full pb-6">
      {/* ── Top Page Banner & Header Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface border border-border p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3.5">
          <Button variant="outline" size="icon" className="rounded-xl shrink-0" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5 text-foreground-secondary" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">New Transport Reservation</h1>
              <span className="bg-primary/10 text-primary text-xs font-semibold px-2.5 py-0.5 rounded-full border border-primary/20">
                Integration Gateway ({GATEWAY})
              </span>
            </div>
            <p className="text-xs text-foreground-secondary mt-0.5">
              Inject external transport requests from PMS/POS or generate mock airport transfers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Button type="button" variant="outline" onClick={() => router.push("/reservations")} className="rounded-xl">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={injectMutation.isPending}
            className="rounded-xl px-5 h-10 shadow-sm"
          >
            {injectMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Injecting...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Inject Transport Request
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── GATEWAY CONTROLS & BATCH PULL ── */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader className="pb-3 border-b border-border/60 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <FlaskConical className="w-4 h-4 text-primary" /> Gateway Integration Batch Simulator
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Simulate inbound bookings from external hotel PMS/POS systems.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRandomFill} className="rounded-xl text-xs">
              <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-500" /> Fill Mock Data
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => pullMutation.mutate()}
              disabled={pullMutation.isPending}
              className="rounded-xl text-xs"
            >
              <DownloadCloud className="w-3.5 h-3.5 mr-1" />
              {pullMutation.isPending ? "Pulling..." : "Pull Mock Batch"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* ── CONNECTED AIRPORT & HOTEL ROUTE PRESETS ── */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Plane className="w-4 h-4 text-primary" /> Connected Airport &amp; Hotel Route Presets
          </CardTitle>
          <CardDescription className="text-xs">
            Select a preset route to pre-configure pickup and dropoff points.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {naiaPresets.map((preset) => {
              const active =
                form.pickup_location === preset.pickup && form.dropoff_location === preset.dropoff;
              const terminalMatch = (preset.pickup + preset.dropoff).match(/NAIA Terminal (\d)/);
              const terminalTag = terminalMatch ? `NAIA T${terminalMatch[1]}` : "NAIA";

              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyRoutePreset(preset.pickup, preset.dropoff)}
                  className={cn(
                    "flex items-center justify-between gap-3 p-3.5 rounded-3xl border text-left transition-all group cursor-pointer",
                    active
                      ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/30 font-medium shadow-xs"
                      : "border-border bg-surface hover:bg-hover hover:border-primary/40 text-foreground"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={cn(
                        "flex items-center justify-center h-8 px-2 rounded-lg text-xs font-bold shrink-0 border transition-colors",
                        active
                          ? "bg-primary/25 text-primary border-primary/50"
                          : "bg-hover border-border text-foreground group-hover:border-primary/50 group-hover:text-primary"
                      )}
                    >
                      {terminalTag}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <span className="truncate">{preset.pickup.replace("NAIA ", "").replace(" Hotel", "")}</span>
                        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-primary" />
                        <span className="truncate">{preset.dropoff.replace("NAIA ", "").replace(" Hotel", "")}</span>
                      </div>
                    </div>
                  </div>
                  {active && <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0 ml-1" />}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── CUSTOM REQUEST FORM ── */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
            <User className="w-4 h-4 text-primary" /> Transport Reservation Details
          </CardTitle>
          <CardDescription className="text-xs">
            Enter guest details, pickup schedule, passenger count, and vehicle category.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
            <FloatingField label="External Booking ID" icon={Hash} required>
              <input
                id="external_booking_id"
                value={form.external_booking_id}
                onChange={(e) => set("external_booking_id", e.target.value)}
                placeholder="BK-2026-00999"
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>

            <FloatingField label="Source System" icon={Layers}>
              <select
                id="source_system"
                value={form.source_system}
                onChange={(e) => set("source_system", e.target.value)}
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
              >
                <option value="PMS">PMS (Hotel Front Office)</option>
                <option value="POS">POS (Restaurant / Concierge)</option>
                <option value="Web">Web Booking Portal</option>
              </select>
            </FloatingField>

            <FloatingField label="Booking Reference" icon={FileText}>
              <input
                id="booking_reference"
                value={form.booking_reference}
                onChange={(e) => set("booking_reference", e.target.value)}
                placeholder="REF-999"
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>

            <FloatingField label="Guest Name" icon={User}>
              <input
                id="guest_name"
                value={form.guest_name}
                onChange={(e) => set("guest_name", e.target.value)}
                placeholder="e.g. Maria Clara"
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>

            <FloatingField label="Pickup Location" icon={MapPin}>
              <input
                id="pickup_location"
                value={form.pickup_location}
                onChange={(e) => set("pickup_location", e.target.value)}
                placeholder="NAIA Terminal 2"
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>

            <FloatingField label="Dropoff Location" icon={MapPin}>
              <input
                id="dropoff_location"
                value={form.dropoff_location}
                onChange={(e) => set("dropoff_location", e.target.value)}
                placeholder="CoCo Star Hotel"
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>

            <div>
              <DateTimePicker
                id="pickup_datetime"
                label="Pickup Date & Time"
                value={form.pickup_datetime}
                onChange={(val) => set("pickup_datetime", val)}
              />
            </div>

            <FloatingField label="Passenger Count" icon={Users}>
              <input
                id="passenger_count"
                type="number"
                min={1}
                max={50}
                value={form.passenger_count}
                onChange={(e) => set("passenger_count", parseInt(e.target.value, 10) || 1)}
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 font-data"
              />
            </FloatingField>

            <FloatingField label="Requested Vehicle Category" icon={CarFront}>
              <select
                id="requested_vehicle_type"
                value={form.requested_vehicle_type}
                onChange={(e) => set("requested_vehicle_type", e.target.value)}
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
              >
                <option value="">Any Category</option>
                {categories.map((c) => (
                  <option key={c.category_id} value={c.category_name}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </FloatingField>

            <FloatingField label="Priority Level" icon={AlertCircle}>
              <select
                id="priority"
                value={form.priority}
                onChange={(e) => set("priority", e.target.value)}
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
              >
                <option value="Normal">Normal</option>
                <option value="High">High (VIP)</option>
                <option value="Urgent">Urgent</option>
              </select>
            </FloatingField>

            <FloatingField label="Special Requests & Notes" icon={Sparkles} className="md:col-span-2">
              <input
                id="special_requests"
                value={form.special_requests}
                onChange={(e) => set("special_requests", e.target.value)}
                placeholder="Cold towels, child seat, luggage assistance..."
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
