"use client";

import { useMemo, useState } from "react";
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
import { createInternalCargoReservation } from "@/services/internal-reservation.client";
import { describeIngestOutcome } from "@/lib/integration/ingest-outcome";
import { getVehicleCategories } from "@/services/vehicle.service";
import { getLocations } from "@/services/location.service";
import { getHotelLocationSettings } from "@/services/settings.service";
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
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FloatingField, FloatingSelect } from "@/components/ui/field";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { PageEntrance, CARD_SHADOW } from "@/components/ui/page-entrance";
import { StickyActionBar } from "@/components/ui/sticky-actions";
import { CargoContentsEditor } from "@/components/cargo/cargo-contents-editor";
import { CARGO_SERVICE_OPTIONS, blankCargoDraftLine, buildPassengerSimulationEnvelope, validateCargoDraft } from "@/lib/cargo/cargo-draft";
import { serviceLoadFor } from "@/lib/integration/contracts";

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

  const { data: hotelSettings } = useQuery({
    queryKey: ["hotel-settings"],
    queryFn: () => getHotelLocationSettings(),
  });

  const [form, setForm] = useState({
    external_booking_id: "",
    source_system: "PMS",
    booking_reference: "",
    guest_name: "",
    pickup_location: "",
    dropoff_location: "",
    pickup_location_id: "",
    dropoff_location_id: "",
    pickup_datetime: "",
    passenger_count: 1,
    special_requests: "",
    requested_vehicle_type: "",
    priority: "Normal",
    service_code: "GUEST_TRANSPORT",
    cargo_description: "",
    cargo_weight_kg: "",
    source_department: "",
  });
  const [cargoLines, setCargoLines] = useState([blankCargoDraftLine("first")]);
  const [cargoErrors, setCargoErrors] = useState({});
  const [cargoNotice, setCargoNotice] = useState("");
  const [submissionId] = useState(() => crypto.randomUUID());
  const isCargo = serviceLoadFor(form.service_code) === "Cargo";
  const cargoValidation = validateCargoDraft({ description: form.cargo_description, declaredWeight: form.cargo_weight_kg, lines: cargoLines });

  // Dynamic defaults from the live registry — never a brand literal. Derived
  // during render (no setState-in-effect): the first airport-like location is
  // the pickup, the configured hotel base the drop-off. Explicitly typed
  // values always win over the derived defaults.
  const defaultPickup = useMemo(() => {
    const airport = (Array.isArray(locations) ? locations : []).find((loc) =>
      /airport|terminal|arrivals|departures/i.test(String(loc?.name ?? ""))
    );
    return String(airport?.name ?? "");
  }, [locations]);
  const defaultDropoff = useMemo(
    () => String(hotelSettings?.hotel_name ?? hotelSettings?.name ?? "").trim(),
    [hotelSettings]
  );

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));



  // The ingest POST answers with the created/found request row — `request_id`,
  // `reservation_number`, and `idempotent: true` on a replay. It does NOT answer
  // `{ id, created }`, which is what this read, so the toast said
  // "Created transport request #undefined" for every submission.
  const injectMutation = useMutation({
    mutationFn: injectTransportRequest,
    onSuccess: (res) => {
      // The route answers with the created/found request ROW (request_id,
      // reservation_number, idempotent?) — never `{ id, created }`, which is
      // what this read and which produced "#undefined" on every submission.
      const outcome = describeIngestOutcome(res);
      toast.success(outcome.message);
      // The queue and the register are keyed under ["transport-requests", ...];
      // ["reservations"] matched no query in the app, so neither list ever
      // refreshed after a submission.
      queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      router.push("/reservations");
    },
    onError: (err) => toast.error(err.message),
  });

  const pullMutation = useMutation({
    mutationFn: () => pullTransportRequests(5),
    onSuccess: (res) => {
      toast.success(`Pulled ${res.total_received ?? 0} request(s) (${res.inserted_count ?? 0} created)`);
      queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const cargoMutation = useMutation({
    mutationFn: createInternalCargoReservation,
    onSuccess: (res) => {
      toast.success(`${res.reservation_number || "Cargo reservation"} ${res.idempotent ? "already saved" : "saved with its item list"}.`);
      queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
      router.push(`/reservations/${res.request_id}`);
    },
    onError: (err) => setCargoNotice(err.message || "Could not save the Cargo reservation. Your details are still here; retry when ready."),
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

    setForm((current) => ({
      ...current,
      external_booking_id: `BK-2026-${r}`,
      source_system: "PMS",
      booking_reference: `REF-${r}`,
      guest_name: name,
      pickup_location: form.pickup_location || defaultPickup,
      dropoff_location: form.dropoff_location || defaultDropoff,
      pickup_datetime: dateStr,
      passenger_count: Math.floor(Math.random() * 4) + 1,
      special_requests: "Cold towels & bottled water requested.",
      requested_vehicle_type: categories[0]?.category_name || "",
      priority: Math.random() > 0.7 ? "High" : "Normal",
    }));
    toast.success("Filled mock transport request data!");
  };

  const handleCargoMockFill = () => {
    const r = Math.floor(Math.random() * 9000) + 1000;
    const dateStr = nowPlusHoursLocal(Math.floor(Math.random() * 48) + 1);
    const cargoCode = "HOTEL_SUPPLY_TRANSFER";

    setForm((current) => ({
      ...current,
      external_booking_id: `CARGO-2026-${r}`,
      source_system: "INTERNAL",
      booking_reference: `CARGO-REF-${r}`,
      guest_name: "",
      pickup_location: form.pickup_location || defaultPickup,
      dropoff_location: form.dropoff_location || defaultDropoff,
      pickup_datetime: dateStr,
      passenger_count: 1,
      special_requests: "",
      requested_vehicle_type: categories[0]?.category_name || "",
      priority: "Normal",
      service_code: cargoCode,
      cargo_description: "Fictional sample vegetables — confirm actual contents before use",
      cargo_weight_kg: "650",
      source_department: "Restaurant",
    }));
    setCargoLines([{ ...blankCargoDraftLine("first"), name: "Fictional sample vegetables", expected_quantity: "10", quantity_basis: "TRANSPORT_PACKAGE", unit: "boxes", transport_package_count: "10", gross_weight_kg_per_package: "65" }]);
    setCargoErrors({});
    setCargoNotice("");
    toast.success("Sample Cargo filled. Confirm locations and actual package measurements before saving.");
  };

  const submit = (e) => {
    e.preventDefault();
    if (isCargo) {
      const pickupInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.pickup_datetime)
        ? `${form.pickup_datetime}:00+08:00` : form.pickup_datetime;
      setCargoErrors(cargoValidation.errors);
      if (!cargoValidation.valid) {
        setCargoNotice("Review the cargo fields below. Your details are still here.");
        return;
      }
      if (!form.pickup_location_id || !form.dropoff_location_id || !pickupInstant || !Number.isFinite(new Date(pickupInstant).getTime())) {
        setCargoNotice("Choose pickup and dropoff locations and a valid pickup date and time.");
        return;
      }
      setCargoNotice("");
      cargoMutation.mutate({
        submission_id: submissionId, load_type: "Cargo", service_code: form.service_code,
        pickup_location_id: Number(form.pickup_location_id), dropoff_location_id: Number(form.dropoff_location_id),
        pickup_datetime: new Date(pickupInstant).toISOString(), cargo_description: form.cargo_description,
        cargo_weight_kg: form.cargo_weight_kg, source_department: form.source_department,
        special_requests: form.special_requests, priority: form.priority,
        requested_category_id: categories.find(category => category.category_name === form.requested_vehicle_type)?.category_id ?? null,
        lines: cargoLines,
      });
      return;
    }
    if (!form.external_booking_id.trim()) {
      toast.error("External Booking ID is required");
      return;
    }
    injectMutation.mutate(buildPassengerSimulationEnvelope({
      ...form,
      pickup_location: form.pickup_location || defaultPickup,
      dropoff_location: form.dropoff_location || defaultDropoff,
    }));
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
        disabled={injectMutation.isPending || cargoMutation.isPending}
        className={cn("rounded-xl px-5 h-10 shadow-xs font-bold", heroButtonPrimaryClass)}
      >
        {injectMutation.isPending || cargoMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isCargo ? "Saving..." : "Injecting..."}
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4 mr-2" /> {isCargo ? "Save Cargo reservation" : "Inject Transport Request"}
          </>
        )}
      </Button>
    </>
  );

  return (
    <PageEntrance className="space-y-6 w-full pb-28">
      {/* ── Top Hero Header Bar ── */}
      <HeroHeader
        icon={isCargo ? Package : Plane}
        title="New Transport Reservation"
        badge={isCargo ? "Internal delivery job" : `Integration Gateway (${GATEWAY})`}
        description="Create an internal Cargo delivery job or simulate a passenger request."
        actions={formActions}
      />
      <StickyActionBar>{formActions}</StickyActionBar>

      {/* ── GATEWAY CONTROLS & BATCH PULL ── */}
      {!isCargo && <Card className={cn("border-0 rounded-3xl overflow-hidden", CARD_SHADOW)}>
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
            <Button variant="outline" size="sm" onClick={handleCargoMockFill} className="rounded-xl text-xs">
              <Package className="w-3.5 h-3.5 mr-1" /> Fill sample Cargo
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
      </Card>}



      {/* ── CUSTOM REQUEST FORM ── */}
      <Card className={cn("border-0 rounded-3xl overflow-hidden", CARD_SHADOW)}>
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-base font-extrabold flex items-center gap-2 text-foreground">
            <User className="w-4 h-4 text-primary" /> Transport Reservation Details
          </CardTitle>
          <CardDescription className="text-xs">
            Choose the load, service, route and schedule. Cargo includes the complete item list and package requirements.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
            <FloatingSelect label="Load type" icon={Layers} value={isCargo ? "Cargo" : "Passenger"} onValueChange={value => { if (!['Passenger', 'Cargo'].includes(value)) return; set("service_code", value === "Cargo" ? "HOTEL_SUPPLY_TRANSFER" : "GUEST_TRANSPORT"); setCargoNotice(""); }}>
              <SelectItem value="Passenger">Passenger</SelectItem>
              <SelectItem value="Cargo">Cargo</SelectItem>
            </FloatingSelect>
            <FloatingSelect label="Service" icon={Layers} value={form.service_code} onValueChange={(value) => { if (serviceLoadFor(value) !== (isCargo ? "Cargo" : "Passenger")) return; set("service_code", value); setCargoNotice(""); }}>
              {CARGO_SERVICE_OPTIONS.filter(([code]) => serviceLoadFor(code) === (isCargo ? "Cargo" : "Passenger")).map(([code, label]) => <SelectItem key={code} value={code}>{isCargo ? label.replace("Supply Chain · ", "") : label}</SelectItem>)}
            </FloatingSelect>
            {!isCargo && <FloatingField label="External Booking ID" icon={Hash} required>
              <input
                id="external_booking_id"
                value={form.external_booking_id}
                onChange={(e) => set("external_booking_id", e.target.value)}
                placeholder="BK-2026-00999"
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>}

            <p className="self-center text-xs text-foreground-secondary">{isCargo ? "Internal delivery job. Saving keeps the reservation and item list together. Assign a driver and vehicle from the saved reservation." : "Staff simulation uses PMS identity. POS and SCM requests require their authenticated source adapters."}</p>

            {!isCargo && <FloatingField label="Booking Reference" icon={FileText}>
              <input
                id="booking_reference"
                value={form.booking_reference}
                onChange={(e) => set("booking_reference", e.target.value)}
                placeholder="REF-999"
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>}

            {!isCargo && <FloatingField label="Guest Name" icon={User}>
              <input
                id="guest_name"
                value={form.guest_name}
                onChange={(e) => set("guest_name", e.target.value)}
                placeholder="e.g. Maria Clara"
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>}

            <FloatingSelect
              label="Pickup Location"
              icon={MapPin}
              id="pickup_location"
              value={isCargo ? String(form.pickup_location_id) : (form.pickup_location || defaultPickup)}
              onValueChange={(val) => isCargo ? setForm(current => ({ ...current, pickup_location_id: val, pickup_location: locations.find(location => String(location.location_id) === val)?.name || "" })) : set("pickup_location", val)}
              placeholder="Select Pickup Location"
            >
              {locations.map((loc) => (
                <SelectItem key={loc.location_id} value={isCargo ? String(loc.location_id) : loc.name}>
                  {loc.name}
                </SelectItem>
              ))}
            </FloatingSelect>

            <FloatingSelect
              label="Dropoff Location"
              icon={MapPin}
              id="dropoff_location"
              value={isCargo ? String(form.dropoff_location_id) : (form.dropoff_location || defaultDropoff)}
              onValueChange={(val) => isCargo ? setForm(current => ({ ...current, dropoff_location_id: val, dropoff_location: locations.find(location => String(location.location_id) === val)?.name || "" })) : set("dropoff_location", val)}
              placeholder="Select Dropoff Location"
            >
              {locations.map((loc) => (
                <SelectItem key={loc.location_id} value={isCargo ? String(loc.location_id) : loc.name}>
                  {loc.name}
                </SelectItem>
              ))}
            </FloatingSelect>

            <div>
              <DateTimePicker
                id="pickup_datetime"
                label={isCargo ? "Pickup Date & Time (Manila)" : "Pickup Date & Time"}
                value={form.pickup_datetime}
                onChange={(val) => set("pickup_datetime", val)}
              />
            </div>

            {!isCargo && <FloatingField label="Passenger Count" icon={Users}>
              <input
                id="passenger_count"
                type="number"
                min={1}
                max={50}
                value={form.passenger_count}
                onChange={(e) => set("passenger_count", parseInt(e.target.value, 10) || 1)}
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 font-data"
              />
            </FloatingField>}

            {isCargo && <>
              <FloatingField label="Cargo description" icon={FileText} required error={cargoErrors.description}><input aria-label="Cargo description" value={form.cargo_description} maxLength={2000} onChange={event => set("cargo_description", event.target.value)} className="w-full bg-transparent py-1 text-xs focus:outline-hidden" /></FloatingField>
              <FloatingField label="Declared gross load (kg)" icon={Layers} required error={cargoErrors.declaredWeight}><input aria-label="Declared gross load (kg)" type="number" min="0.001" step="0.001" value={form.cargo_weight_kg} onChange={event => set("cargo_weight_kg", event.target.value)} className="w-full bg-transparent py-1 text-xs font-data focus:outline-hidden" /></FloatingField>
              <FloatingField label="Source department" icon={Building2}><input aria-label="Source department" value={form.source_department} maxLength={100} onChange={event => set("source_department", event.target.value)} className="w-full bg-transparent py-1 text-xs focus:outline-hidden" /></FloatingField>
            </>}

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
              onValueChange={(val) => set("priority", val)}
            >
              {/* This form simulates the BOOKING side of the boundary, so it must
                  speak Booking's vocabulary: Low/Normal/High/Urgent
                  (TransportationRequestSchema). normalizePriority() translates
                  "Normal" → "Medium" at ingest; "Medium" itself would be rejected
                  by the schema, so never send it from here. */}
              <SelectItem value="Low">Low</SelectItem>
              <SelectItem value="Normal">Normal</SelectItem>
              <SelectItem value="High">High (VIP)</SelectItem>
              <SelectItem value="Urgent">Urgent</SelectItem>
            </FloatingSelect>

            <FloatingField label="Special Requests & Notes" icon={Sparkles} className="md:col-span-2">
              <input
                id="special_requests"
                value={form.special_requests}
                onChange={(e) => set("special_requests", e.target.value)}
                placeholder={isCargo ? "Pickup access, loading instructions, delivery notes…" : "Cold towels, child seat, luggage assistance..."}
                className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
              />
            </FloatingField>
            {isCargo && <>
              <CargoContentsEditor lines={cargoLines} onChange={setCargoLines} errors={cargoErrors} calculatedKg={cargoValidation.calculatedKg} />
              <div className="space-y-2 border-t border-border pt-3 md:col-span-2"><p className="text-xs text-foreground-secondary">Driver pickup and delivery counts, photos and signatures are recorded on the assigned trip. This form saves the expected contents. Leaving before saving discards these entries.</p>{cargoNotice && <p role="alert" className="text-sm font-medium text-danger">{cargoNotice}</p>}</div>
            </>}
          </form>
        </CardContent>
      </Card>
    </PageEntrance>
  );
}
