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
import { FloatingField, FloatingSelect } from "@/components/ui/field";
import { SelectItem } from "@/components/ui/select";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { PageEntrance, CARD_SHADOW } from "@/components/ui/page-entrance";
import { StickyActionBar } from "@/components/ui/sticky-actions";

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
    priority: "Medium",
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));



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
      priority: Math.random() > 0.7 ? "High" : "Medium",
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



  const formActions = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => router.push("/reservations")}
        className={cn("rounded-xl", heroButtonOutlineClass)}
      >
        Cancel
      </Button>
      <Button
        type="button"
        onClick={submit}
        disabled={injectMutation.isPending}
        className={cn("rounded-xl px-5 h-10 shadow-xs font-bold", heroButtonPrimaryClass)}
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
    </>
  );

  return (
    <PageEntrance className="space-y-6 w-full pb-28">
      {/* ── Top Hero Header Bar ── */}
      <HeroHeader
        icon={Plane}
        title="New Transport Reservation"
        badge={`Integration Gateway (${GATEWAY})`}
        description="Inject external transport requests from PMS/POS or generate mock airport transfers."
        actions={formActions}
      />
      <StickyActionBar>{formActions}</StickyActionBar>

      {/* ── GATEWAY CONTROLS & BATCH PULL ── */}
      <Card className={cn("border-0 rounded-3xl overflow-hidden", CARD_SHADOW)}>
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
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



      {/* ── CUSTOM REQUEST FORM ── */}
      <Card className={cn("border-0 rounded-3xl overflow-hidden", CARD_SHADOW)}>
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-base font-extrabold flex items-center gap-2 text-foreground">
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

            <FloatingSelect
              label="Source System"
              icon={Layers}
              id="source_system"
              value={form.source_system}
              onValueChange={(val) => set("source_system", val)}
            >
              <SelectItem value="PMS">PMS (Hotel Front Office)</SelectItem>
              <SelectItem value="POS">POS (Restaurant / Concierge)</SelectItem>
              <SelectItem value="Web">Web Booking Portal</SelectItem>
            </FloatingSelect>

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

            <FloatingSelect
              label="Pickup Location"
              icon={MapPin}
              id="pickup_location"
              value={form.pickup_location}
              onValueChange={(val) => set("pickup_location", val)}
              placeholder="Select Pickup Location"
            >
              {locations.map((loc) => (
                <SelectItem key={loc.location_id} value={loc.name}>
                  {loc.name}
                </SelectItem>
              ))}
            </FloatingSelect>

            <FloatingSelect
              label="Dropoff Location"
              icon={MapPin}
              id="dropoff_location"
              value={form.dropoff_location}
              onValueChange={(val) => set("dropoff_location", val)}
              placeholder="Select Dropoff Location"
            >
              {locations.map((loc) => (
                <SelectItem key={loc.location_id} value={loc.name}>
                  {loc.name}
                </SelectItem>
              ))}
            </FloatingSelect>

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

            <FloatingSelect
              label="Requested Vehicle Category"
              icon={CarFront}
              id="requested_vehicle_type"
              value={form.requested_vehicle_type}
              onValueChange={(val) => set("requested_vehicle_type", val)}
              placeholder="Any Category"
            >
              {categories.map((c) => (
                <SelectItem key={c.category_id} value={c.category_name}>
                  {c.category_name}
                </SelectItem>
              ))}
            </FloatingSelect>

            <FloatingSelect
              label="Priority Level"
              icon={AlertCircle}
              id="priority"
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {/* Vocabulary matches chk_transport_priority exactly — "Normal"
                  is silently translated to Medium downstream, so offer Medium
                  here and never show the user a word the record won't carry. */}
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High (VIP)</option>
              <option value="Urgent">Urgent</option>
            </FloatingSelect>

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
    </PageEntrance>
  );
}
