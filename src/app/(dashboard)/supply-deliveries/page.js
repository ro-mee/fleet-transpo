"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ClipboardCheck, MapPin, PackageCheck, RefreshCw, Scale, ShieldCheck, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { useAuth } from "@/hooks/use-auth";
import { can, hasRole } from "@/lib/auth/permissions";
import { useRequireRole } from "@/lib/auth/role-guard";
import { toast } from "@/components/ui/toast";
import { compareSupplyLoadFit } from "@/services/supply-shipment.service";
import { getSupplySiteMappings, saveSupplySiteMapping } from "@/services/supply-site-mapping.service";

const HANDLING_CAPABILITIES = [
  ["FRAGILE", "Fragile"],
  ["NO_STACK", "No stacking"],
  ["FOOD_SEPARATION", "Food separation"],
  ["SECURE_LOAD", "Secured load"],
  ["SPILL_CONTAINMENT", "Spill containment"],
];

const PROFILE_FIELDS = [
  ["rated_payload_kg", "Rated payload", "kg"],
  ["gross_vehicle_weight_limit_kg", "Gross vehicle weight limit", "kg"],
  ["operating_mass_kg", "Operating mass", "kg"],
  ["operational_reserve_kg", "Crew and equipment reserve", "kg"],
  ["usable_volume_m3", "Usable cargo volume", "m³"],
  ["compartment_length_m", "Compartment length", "m"],
  ["compartment_width_m", "Compartment width", "m"],
  ["compartment_height_m", "Compartment height", "m"],
  ["opening_length_m", "Opening length", "m"],
  ["opening_width_m", "Opening width", "m"],
  ["opening_height_m", "Opening height", "m"],
];

const blankProfile = {
  supports_supply_delivery: false,
  rated_payload_kg: "",
  gross_vehicle_weight_limit_kg: "",
  operating_mass_kg: "",
  operational_reserve_kg: "",
  usable_volume_m3: "",
  compartment_length_m: "",
  compartment_width_m: "",
  compartment_height_m: "",
  opening_length_m: "",
  opening_width_m: "",
  opening_height_m: "",
  temperature_min_c: "",
  temperature_max_c: "",
  handling_capabilities: [],
  verification_reference: "",
  verification_valid_until: "",
};

function manilaTime(daysAhead, hour) {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${String(hour).padStart(2, "0")}:00:00+08:00`;
}

function syntheticEvent() {
  const suffix = Date.now();
  return {
    schema_version: "1.0",
    event_id: `scm-demo:approval-${suffix}`,
    event_type: "TransportRequestApproved",
    sequence: 1,
    correlation_id: `scm-demo:order-${suffix}`,
    source: { organization_id: "sandbox:demo", module: "SCM_SANDBOX" },
    occurred_at: new Date().toISOString(),
    request: {
      external_request_id: `SCM-DEMO-${suffix}`,
      approver_ref: "demo-approver-01",
      manifest_revision: 1,
      pickup: { site_id: "WH-DEMO-02", address: "Synthetic Demo Warehouse 02", ready: true, ready_at: manilaTime(1, 8) },
      delivery: { site_id: "REST-DEMO-08", address: "Synthetic Restaurant 08", window_start: manilaTime(1, 9), window_end: manilaTime(1, 13) },
      timezone: "Asia/Manila",
      lines: [{
        external_line_id: "line-demo-01",
        sku_ref: "SKU-DEMO-DRY-01",
        description: "Synthetic dry goods carton",
        ordered_quantity: 120,
        ordered_uom: "case",
        transport_package_count: 120,
        units_per_package: 1,
        gross_weight_kg_per_package: 10,
        dimensions_m: { length: 0.5, width: 0.5, height: 0.2 },
        temperature_c: null,
        handling: ["SECURE_LOAD"],
        package_can_rotate: true,
      }],
    },
  };
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function profileToForm(profile) {
  if (!profile) return { ...blankProfile };
  return Object.fromEntries(Object.keys(blankProfile).map((key) => {
    const value = profile[key];
    if (key === "supports_supply_delivery") return [key, value === true];
    if (key === "handling_capabilities") return [key, Array.isArray(value) ? value : []];
    return [key, value == null ? "" : String(value).slice(0, key === "verification_valid_until" ? 10 : undefined)];
  }));
}

function numberText(value, maximumFractionDigits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits }).format(Number(value));
}

function deliveryWindow(shipment) {
  try {
    const timeZone = shipment.requested_timezone || "Asia/Manila";
    const format = (value) => new Intl.DateTimeFormat("en-PH", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
    return `${format(shipment.delivery_window_start)} – ${format(shipment.delivery_window_end)}`;
  } catch {
    return "Delivery window unavailable";
  }
}

function checkTone(status) {
  if (status === "PASS") return "border-success/25 bg-success/10 text-success-800 dark:text-success-200";
  if (status === "BLOCK") return "border-danger/25 bg-danger/10 text-danger-800 dark:text-rose-200";
  return "border-warning/30 bg-warning/10 text-amber-800 dark:text-amber-200";
}

function Field({ id, label, unit, value, onChange, type = "number", required = false, min, step = "any" }) {
  return (
    <label htmlFor={id} className="block min-w-0 space-y-1.5">
      <span className="flex items-baseline justify-between gap-2 text-xs font-medium text-foreground-secondary">
        <span>{label}{required ? <span className="text-danger"> *</span> : null}</span>
        {unit ? <span className="text-[11px] text-foreground-muted">{unit}</span> : null}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        min={min}
        step={type === "number" ? step : undefined}
        required={required}
        onChange={onChange}
        className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
      />
    </label>
  );
}

export default function SupplyDeliveriesPage() {
  useRequireRole();
  const { employee } = useAuth();
  const queryClient = useQueryClient();
  const canManageProfiles = can(employee, "vehicles", "update");
  const canImportSandbox = hasRole(employee, ["admin", "super_admin"]);
  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [profileVehicleId, setProfileVehicleId] = useState("");
  const [profileForm, setProfileForm] = useState({ ...blankProfile });
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState("");
  const [evaluation, setEvaluation] = useState(null);
  const [fleetLoadFit, setFleetLoadFit] = useState(null);
  const [siteMappingKey, setSiteMappingKey] = useState("");
  const [siteMappingLocationId, setSiteMappingLocationId] = useState("");

  const shipmentsQuery = useQuery({
    queryKey: ["supply-shipments"],
    queryFn: () => requestJson("/api/supply/shipments"),
    staleTime: 15_000,
  });
  const profilesQuery = useQuery({
    queryKey: ["supply-cargo-profiles"],
    queryFn: () => requestJson("/api/supply/vehicles/cargo-profile"),
    staleTime: 30_000,
  });
  const siteMappingsQuery = useQuery({
    queryKey: ["supply-site-mappings"],
    queryFn: getSupplySiteMappings,
    enabled: canImportSandbox,
    staleTime: 30_000,
  });
  const shipments = shipmentsQuery.data?.shipments ?? [];
  const profiles = profilesQuery.data?.profiles ?? [];
  const siteMappings = siteMappingsQuery.data?.mappings ?? [];
  const fleetLocations = siteMappingsQuery.data?.locations ?? [];
  const siteTargets = useMemo(() => {
    const targets = new Map();
    for (const shipment of shipments) {
      for (const [site_id, stop] of [[shipment.pickup_site_id, "Pickup"], [shipment.delivery_site_id, "Delivery"]]) {
        if (!shipment.source_organization_id || !site_id) continue;
        const key = JSON.stringify([shipment.source_organization_id, site_id]);
        const current = targets.get(key) ?? { key, source_organization_id: shipment.source_organization_id, external_site_id: site_id, stops: [] };
        if (!current.stops.includes(stop)) current.stops.push(stop);
        targets.set(key, current);
      }
    }
    return [...targets.values()].sort((a, b) => a.source_organization_id.localeCompare(b.source_organization_id) || a.external_site_id.localeCompare(b.external_site_id));
  }, [shipments]);
  const selectedShipment = shipments.find((item) => item.supply_shipment_id === selectedShipmentId) ?? shipments[0] ?? null;
  const selectedVehicle = profiles.find((item) => String(item.vehicle_id) === selectedVehicleId) ?? null;
  const profileVehicle = profiles.find((item) => String(item.vehicle_id) === profileVehicleId) ?? null;
  const selectedShipmentRef = useRef("");
  selectedShipmentRef.current = selectedShipment?.supply_shipment_id ?? "";
  const visibleFleetLoadFit = fleetLoadFit?.shipment_id === selectedShipment?.supply_shipment_id ? fleetLoadFit : null;
  const siteMappingKeyIsValid = siteTargets.some((item) => item.key === siteMappingKey);
  const effectiveSiteMappingKey = siteMappingKeyIsValid ? siteMappingKey : siteTargets[0]?.key || "";
  const selectedSiteTarget = siteTargets.find((item) => item.key === effectiveSiteMappingKey) ?? null;
  const selectedSiteMapping = siteMappings.find((item) => item.source_organization_id === selectedSiteTarget?.source_organization_id && item.external_site_id === selectedSiteTarget?.external_site_id) ?? null;
  const selectedMappingLocationIsAvailable = fleetLocations.some((item) => item.location_id === selectedSiteMapping?.location_id);
  const effectiveSiteMappingLocationId = siteMappingKeyIsValid && siteMappingLocationId && fleetLocations.some((item) => String(item.location_id) === siteMappingLocationId)
    ? siteMappingLocationId
    : selectedMappingLocationIsAvailable
      ? String(selectedSiteMapping.location_id)
      : fleetLocations[0] ? String(fleetLocations[0].location_id) : "";

  useEffect(() => {
    if (!selectedShipmentId && shipments[0]) setSelectedShipmentId(shipments[0].supply_shipment_id);
    if (selectedShipmentId && !shipments.some((item) => item.supply_shipment_id === selectedShipmentId)) {
      setSelectedShipmentId(shipments[0]?.supply_shipment_id ?? "");
      setEvaluation(null);
      setFleetLoadFit(null);
    }
  }, [selectedShipmentId, shipments]);

  useEffect(() => {
    if (!selectedVehicleId && profiles[0]) setSelectedVehicleId(String(profiles[0].vehicle_id));
    if (!profileVehicleId && profiles[0]) setProfileVehicleId(String(profiles[0].vehicle_id));
  }, [profiles, selectedVehicleId, profileVehicleId]);

  useEffect(() => {
    setProfileForm(profileToForm(profileVehicle));
  }, [profileVehicleId, profiles]);

  const importMutation = useMutation({
    mutationFn: (event) => requestJson("/api/supply/sandbox/transport-requests", {
      method: "POST",
      body: JSON.stringify(event),
    }),
    onSuccess: (result) => {
      setImportError("");
      toast.success(result.replayed ? "Sandbox event already received" : "Sandbox request imported");
      setSelectedShipmentId(result.shipment_id);
      setEvaluation(null);
      setFleetLoadFit(null);
      queryClient.invalidateQueries({ queryKey: ["supply-shipments"] });
    },
    onError: (error) => setImportError(error.message),
  });

  const evaluationMutation = useMutation({
    mutationFn: () => requestJson("/api/supply/shipments/evaluate", {
      method: "POST",
      body: JSON.stringify({ shipment_id: selectedShipment?.supply_shipment_id, vehicle_id: Number(selectedVehicleId) }),
    }),
    onSuccess: (result) => setEvaluation(result.evaluation),
    onError: (error) => toast.error(error.message),
  });

  const fleetLoadFitMutation = useMutation({
    mutationFn: compareSupplyLoadFit,
    onMutate: () => setFleetLoadFit(null),
    onSuccess: (result, shipmentId) => {
      if (shipmentId === selectedShipmentRef.current) setFleetLoadFit(result);
    },
  });

  const profileMutation = useMutation({
    mutationFn: (body) => requestJson("/api/supply/vehicles/cargo-profile", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      toast.success("Vehicle cargo profile saved");
      queryClient.invalidateQueries({ queryKey: ["supply-cargo-profiles"] });
      setEvaluation(null);
      setFleetLoadFit(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const siteMappingMutation = useMutation({
    mutationFn: saveSupplySiteMapping,
    onSuccess: () => {
      toast.success("Sandbox site mapping saved");
      queryClient.invalidateQueries({ queryKey: ["supply-site-mappings"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const queueSummary = useMemo(() => ({
    total: shipments.length,
    ready: shipments.filter((item) => item.status === "READY_FOR_PLANNING").length,
    waiting: shipments.filter((item) => item.status === "WAITING_FOR_PICKUP").length,
  }), [shipments]);

  function setProfileField(key, value) {
    setProfileForm((current) => ({ ...current, [key]: value }));
  }

  function toggleCapability(code) {
    setProfileForm((current) => ({
      ...current,
      handling_capabilities: current.handling_capabilities.includes(code)
        ? current.handling_capabilities.filter((item) => item !== code)
        : [...current.handling_capabilities, code],
    }));
  }

  function submitSandboxImport(event) {
    event.preventDefault();
    setImportError("");
    let value;
    try {
      value = JSON.parse(importJson);
    } catch {
      setImportError("Paste a valid JSON event before importing.");
      return;
    }
    importMutation.mutate(value);
  }

  function submitProfile(event) {
    event.preventDefault();
    if (!profileForm.supports_supply_delivery) {
      profileMutation.mutate({ vehicle_id: Number(profileVehicleId), supports_supply_delivery: false });
      return;
    }
    const numericFields = PROFILE_FIELDS.map(([key]) => key).concat(["temperature_min_c", "temperature_max_c"]);
    const body = { ...profileForm, vehicle_id: Number(profileVehicleId) };
    for (const key of numericFields) body[key] = profileForm[key] === "" ? null : Number(profileForm[key]);
    profileMutation.mutate(body);
  }

  function submitSiteMapping(event) {
    event.preventDefault();
    const target = siteTargets.find((item) => item.key === effectiveSiteMappingKey);
    if (!target || !effectiveSiteMappingLocationId) return;
    siteMappingMutation.mutate({
      source_organization_id: target.source_organization_id,
      external_site_id: target.external_site_id,
      location_id: Number(effectiveSiteMappingLocationId),
    });
  }

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={PackageCheck}
        title="Supply Deliveries"
        badge="Sandbox"
        description="Inspect approved transport snapshots and measure physical load fit."
        actions={(
          <Button variant="outline" onClick={() => {
            shipmentsQuery.refetch();
            profilesQuery.refetch();
          }} disabled={shipmentsQuery.isRefetching || profilesQuery.isRefetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${shipmentsQuery.isRefetching || profilesQuery.isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        )}
      />

      <div className="flex gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-amber-900 dark:text-amber-100" role="status">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <div>
          <p className="font-semibold">Sandbox planning only</p>
          <p className="mt-1 leading-relaxed text-amber-900/80 dark:text-amber-100/80">
            SCM is not connected. This page stores approved sample snapshots and checks cargo measurements; it does not assign a trip, collect receiving evidence, or post inventory.
          </p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Supply request counts">
        {[
          ["All requests", queueSummary.total],
          ["Ready for planning", queueSummary.ready],
          ["Waiting for pickup", queueSummary.waiting],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3">
            <span className="text-sm text-foreground-secondary">{label}</span>
            <span className="font-data text-lg font-semibold tabular-nums text-foreground">{value}</span>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Transport requests</CardTitle>
              <p className="mt-1 text-xs text-foreground-secondary">Source approvals and manifest revisions retained as received.</p>
            </div>
            <Badge variant="outline">{shipments.length} total</Badge>
          </CardHeader>
          <CardContent>
            {shipmentsQuery.isLoading ? (
              <div className="space-y-3 py-2" aria-busy="true" aria-label="Loading supply requests">
                {[0, 1, 2].map((row) => <div key={row} className="h-[76px] animate-pulse rounded-xl bg-muted/70" />)}
              </div>
            ) : shipmentsQuery.isError ? (
              <div className="rounded-xl border border-danger/25 bg-danger/10 p-4 text-sm text-danger-800 dark:text-rose-200" role="alert">
                Could not load supply requests. Use Refresh to retry.
              </div>
            ) : shipments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
                <PackageCheck className="mx-auto h-6 w-6 text-foreground-muted" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-foreground">No SCM snapshots received</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-foreground-secondary">An administrator can import a synthetic sandbox event below when the server sandbox flag is enabled.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {shipments.map((shipment) => {
                  const active = shipment.supply_shipment_id === (selectedShipment?.supply_shipment_id ?? selectedShipmentId);
                  return (
                    <button
                      key={shipment.supply_shipment_id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => { setSelectedShipmentId(shipment.supply_shipment_id); setEvaluation(null); setFleetLoadFit(null); }}
                      className={`grid w-full gap-3 rounded-xl px-3 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 sm:grid-cols-[minmax(0,1fr)_auto] ${active ? "bg-info/5" : "hover:bg-muted/40"}`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">{shipment.external_request_id}</span>
                          <Badge variant="outline" className="font-data tabular-nums">Rev {shipment.current_manifest_revision}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-foreground-secondary">{shipment.pickup_site_id} <span aria-hidden="true">→</span> {shipment.delivery_site_id}</p>
                        <p className="mt-1 text-xs text-foreground-muted">{deliveryWindow(shipment)}</p>
                      </div>
                      <div className="flex items-end justify-between gap-4 sm:flex-col sm:items-end sm:justify-center">
                        <span className="text-xs font-semibold text-foreground-secondary">{shipment.status.replaceAll("_", " ")}</span>
                        <span className="font-data text-xs tabular-nums text-foreground-secondary">
                          {numberText(shipment.package_count, 0)} pkgs · {numberText(shipment.gross_weight_kg)} kg · {numberText(shipment.nominal_volume_m3)} m³
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
              <CardTitle>Cargo fit check</CardTitle>
              <p className="text-xs text-foreground-secondary">Checks manifest readiness and measured fit. Trip-specific load, driver, documents and shared schedule checks are not included.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5 text-xs font-medium text-foreground-secondary">
              <span>Supply request</span>
              <select
                value={selectedShipment?.supply_shipment_id ?? ""}
                onChange={(event) => { setSelectedShipmentId(event.target.value); setEvaluation(null); setFleetLoadFit(null); }}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
              >
                {shipments.map((shipment) => <option key={shipment.supply_shipment_id} value={shipment.supply_shipment_id}>{shipment.external_request_id} · rev {shipment.current_manifest_revision}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-foreground-secondary">
              <span>Vehicle</span>
              <select
                value={selectedVehicleId}
                onChange={(event) => { setSelectedVehicleId(event.target.value); setEvaluation(null); }}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
              >
                <option value="">Select a fleet vehicle</option>
                {profiles.map((vehicle) => <option key={vehicle.vehicle_id} value={vehicle.vehicle_id}>{vehicle.plate_number} · {vehicle.vehicle_name}</option>)}
              </select>
              {selectedVehicle && <span className="block text-[11px] text-foreground-muted">Cargo profile: {selectedVehicle.supports_supply_delivery ? "enabled" : "not enabled"} · vehicle state: {selectedVehicle.vehicle_status}</span>}
            </label>
            <Button
              className="w-full"
              disabled={!selectedShipment || !selectedVehicleId || evaluationMutation.isPending}
              onClick={() => evaluationMutation.mutate()}
            >
              <Scale className="mr-2 h-4 w-4" aria-hidden="true" />
              {evaluationMutation.isPending ? "Checking measurements…" : "Check load fit"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!selectedShipment || profilesQuery.isLoading || profiles.length === 0 || fleetLoadFitMutation.isPending}
              onClick={() => fleetLoadFitMutation.mutate(selectedShipment.supply_shipment_id)}
            >
              <Truck className="mr-2 h-4 w-4" aria-hidden="true" />
              {fleetLoadFitMutation.isPending ? "Comparing fleet measurements…" : "Compare load fit across fleet"}
            </Button>

            {evaluationMutation.isError && <p role="alert" className="text-sm text-danger-800 dark:text-rose-200">{evaluationMutation.error.message}</p>}
            {fleetLoadFitMutation.isError && <p role="alert" className="text-sm text-danger-800 dark:text-rose-200">{fleetLoadFitMutation.error.message}</p>}
            {evaluation && (
              <div className="space-y-3 border-t border-border pt-4" aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{evaluation.load_checks_pass ? "Load checks pass" : "Load checks blocked"}</p>
                  <Badge variant="outline">{evaluation.load_checks_pass ? "PASS" : "BLOCKED"}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-muted/50 p-3"><span className="text-foreground-secondary">Gross weight</span><p className="mt-1 font-data font-semibold tabular-nums">{numberText(evaluation.totals.gross_weight_kg)} kg</p></div>
                  <div className="rounded-xl bg-muted/50 p-3"><span className="text-foreground-secondary">Nominal volume</span><p className="mt-1 font-data font-semibold tabular-nums">{numberText(evaluation.totals.nominal_volume_m3)} m³</p></div>
                </div>
                <ul className="space-y-2">
                  {evaluation.checks.map((item) => (
                    <li key={item.id} className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${checkTone(item.status)}`}>
                      {item.status === "PASS" ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{item.id.replaceAll("_", " ")} · {item.status}</p>
                        <p className="mt-0.5 leading-relaxed">{item.reason}</p>
                        {item.utilization_pct != null && <p className="mt-1 font-data tabular-nums">{numberText(item.load_kg ?? item.load_m3)} / {numberText(item.capacity_kg ?? item.capacity_m3)} · {numberText(item.utilization_pct, 1)}%</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {visibleFleetLoadFit && (
              <section className="space-y-3 border-t border-border pt-4" aria-label="Fleet load-fit comparison">
                <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">Load-fit pre-screen only</p>
                    <Badge variant="outline">Assignment not evaluated</Badge>
                  </div>
                  <p className="leading-relaxed">
                    A measurement pass does not make a vehicle assignable. These checks are still open: {visibleFleetLoadFit.not_evaluated.join("; ")}.
                  </p>
                </div>
                <p className="text-xs text-foreground-secondary" aria-live="polite">
                  Measurement results for {visibleFleetLoadFit.vehicles.length} {visibleFleetLoadFit.vehicles.length === 1 ? "vehicle" : "vehicles"}.
                </p>
                {visibleFleetLoadFit.vehicles.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-foreground-secondary">No fleet vehicles are available for this comparison.</p>
                ) : (
                  <ul className="space-y-2">
                    {visibleFleetLoadFit.vehicles.map((vehicle) => {
                      const unresolvedChecks = vehicle.evaluation.checks.filter((item) => item.status !== "PASS");
                      return (
                        <li key={vehicle.vehicle_id} className="space-y-2 rounded-xl border border-border bg-background p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground">{vehicle.plate_number} · {vehicle.vehicle_name}</p>
                              <p className="mt-0.5 text-xs text-foreground-secondary">Vehicle state: {vehicle.vehicle_status || "Unknown"}</p>
                            </div>
                            <Badge variant="outline">{vehicle.evaluation.load_checks_pass ? "Measurement pass" : "Blocked"}</Badge>
                          </div>
                          <p className="text-xs text-foreground-secondary">
                            Gross weight: {numberText(vehicle.evaluation.totals.gross_weight_kg)} kg · Nominal volume: {numberText(vehicle.evaluation.totals.nominal_volume_m3)} m³
                          </p>
                          {unresolvedChecks.length > 0 ? (
                            <details className="text-xs">
                              <summary className="cursor-pointer font-medium text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                                Review {unresolvedChecks.length} blocked or unknown measurement {unresolvedChecks.length === 1 ? "check" : "checks"}
                              </summary>
                              <ul className="mt-2 space-y-2">
                                {unresolvedChecks.map((item) => (
                                  <li key={item.id} className={`rounded-lg border px-3 py-2 ${checkTone(item.status)}`}>
                                    <p className="font-semibold">{item.id.replaceAll("_", " ")} · {item.status}</p>
                                    <p className="mt-0.5 leading-relaxed">{item.reason}</p>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : (
                            <p className="text-xs text-success-800 dark:text-success-200">All recorded physical load checks pass.</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        {canImportSandbox && (
          <Card>
            <CardHeader>
              <CardTitle>Import approved sandbox event</CardTitle>
              <p className="text-xs text-foreground-secondary">Admin-only, non-production, and disabled unless SUPPLY_SCM_SANDBOX_ENABLED=true. Contract v1 accepts package weight in kg and dimensions in metres.</p>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={submitSandboxImport}>
                <textarea
                  aria-label="SCM sandbox event JSON"
                  value={importJson}
                  onChange={(event) => { setImportJson(event.target.value); setImportError(""); }}
                  rows={9}
                  spellCheck={false}
                  placeholder="Paste a version 1.0 SCM sandbox event…"
                  className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
                />
                {importError && <p className="text-sm text-danger-800 dark:text-rose-200" role="alert">{importError}</p>}
                <div className="flex flex-wrap justify-between gap-2">
                  <Button type="button" variant="outline" onClick={() => setImportJson(JSON.stringify(syntheticEvent(), null, 2))}>
                    Use synthetic example
                  </Button>
                  <Button type="submit" disabled={!importJson.trim() || importMutation.isPending}>
                    <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                    {importMutation.isPending ? "Importing…" : "Import sandbox event"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {canImportSandbox && (
          <Card>
            <CardHeader>
              <CardTitle>Map SCM sites to Fleet locations</CardTitle>
              <p className="text-xs text-foreground-secondary">
                Match sandbox pickup and delivery IDs to active Fleet locations with a stored address and coordinates. Review the location before saving; this does not look up or guess locations.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {siteMappingsQuery.isLoading ? (
                <p className="text-sm text-foreground-secondary" role="status">Loading site mappings and Fleet locations…</p>
              ) : siteMappingsQuery.isError ? (
                <div className="space-y-3">
                  <p className="text-sm text-danger-800 dark:text-rose-200" role="alert">Site mappings could not be loaded. Refresh to try again.</p>
                  <Button type="button" variant="outline" onClick={() => siteMappingsQuery.refetch()}>
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  {siteTargets.length === 0 ? (
                    <p className="rounded-xl bg-muted/40 p-3 text-sm text-foreground-secondary">
                      Import a sandbox shipment with pickup and delivery site IDs to configure its location mappings.
                    </p>
                  ) : fleetLocations.length === 0 ? (
                    <p className="rounded-xl bg-warning/10 p-3 text-sm text-foreground-secondary">
                      No active Fleet locations have both a stored address and valid coordinates. Add or review a location before mapping SCM sites.
                    </p>
                  ) : (
                    <form className="space-y-3" onSubmit={submitSiteMapping}>
                      <label className="block space-y-1.5 text-xs font-medium text-foreground-secondary" htmlFor="site-mapping-target">
                        <span>Sandbox SCM site</span>
                        <select
                          id="site-mapping-target"
                          value={effectiveSiteMappingKey}
                          onChange={(event) => {
                            const targetKey = event.target.value;
                            setSiteMappingKey(targetKey);
                            const target = siteTargets.find((item) => item.key === targetKey);
                            const savedMapping = siteMappings.find((item) => item.source_organization_id === target?.source_organization_id && item.external_site_id === target?.external_site_id);
                            const locationId = savedMapping?.location_id ?? fleetLocations[0]?.location_id;
                            setSiteMappingLocationId(locationId ? String(locationId) : "");
                          }}
                          required
                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
                        >
                          {siteTargets.map((target) => (
                            <option key={target.key} value={target.key}>
                              {target.source_organization_id} · {target.external_site_id} ({target.stops.join(" / ")})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1.5 text-xs font-medium text-foreground-secondary" htmlFor="site-mapping-location">
                        <span>Fleet location</span>
                        <select
                          id="site-mapping-location"
                          value={effectiveSiteMappingLocationId}
                          onChange={(event) => setSiteMappingLocationId(event.target.value)}
                          required
                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
                        >
                          {fleetLocations.map((location) => (
                            <option key={location.location_id} value={location.location_id}>
                              {location.name} · {location.address}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex justify-end">
                        <Button type="submit" disabled={!effectiveSiteMappingKey || !effectiveSiteMappingLocationId || siteMappingMutation.isPending}>
                          <MapPin className="mr-2 h-4 w-4" aria-hidden="true" />
                          {siteMappingMutation.isPending ? "Saving…" : selectedSiteMapping ? "Update mapping" : "Save mapping"}
                        </Button>
                      </div>
                    </form>
                  )}

                  {siteMappings.length > 0 && (
                    <div className="border-t border-border pt-4">
                      <h3 className="text-sm font-semibold text-foreground">Saved sandbox mappings</h3>
                      <ul className="mt-3 divide-y divide-border">
                        {siteMappings.map((mapping) => {
                          const mappingActive = mapping.is_active && mapping.location_is_active;
                          const coordinates = [mapping.latitude, mapping.longitude].map(Number);
                          const hasCoordinates = coordinates.every(Number.isFinite);
                          return (
                            <li key={mapping.supply_site_mapping_id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                              <div className="min-w-0">
                                <p className="break-all text-sm font-medium text-foreground">{mapping.external_site_id}</p>
                                <p className="break-all text-xs text-foreground-secondary">{mapping.source_organization_id}</p>
                                <p className="mt-1 text-xs text-foreground-secondary">{mapping.location_name} · {hasCoordinates ? coordinates.map((value) => value.toFixed(5)).join(", ") : "Coordinates unavailable"}</p>
                              </div>
                              <Badge variant={mappingActive ? "success" : "warning"}>{mappingActive ? "Active" : "Unavailable"}</Badge>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {canManageProfiles && (
          <Card>
            <CardHeader>
              <CardTitle>Vehicle cargo capability</CardTitle>
              <p className="text-xs text-foreground-secondary">Only enable a vehicle when each measurement and its verification reference are confirmed by Fleet.</p>
            </CardHeader>
            <CardContent>
              {profilesQuery.isError ? (
                <p className="text-sm text-danger-800 dark:text-rose-200" role="alert">Cargo profiles could not be loaded. Refresh and try again.</p>
              ) : (
                <form className="space-y-4" onSubmit={submitProfile}>
                  <label className="block space-y-1.5 text-xs font-medium text-foreground-secondary">
                    <span>Vehicle</span>
                    <select value={profileVehicleId} onChange={(event) => setProfileVehicleId(event.target.value)} required className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2">
                      <option value="">Select a vehicle</option>
                      {profiles.map((vehicle) => <option key={vehicle.vehicle_id} value={vehicle.vehicle_id}>{vehicle.plate_number} · {vehicle.vehicle_name}</option>)}
                    </select>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
                    <input type="checkbox" checked={profileForm.supports_supply_delivery} onChange={(event) => setProfileField("supports_supply_delivery", event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
                    <span><span className="font-medium text-foreground">Enable supply delivery</span><span className="mt-0.5 block text-xs text-foreground-secondary">Requires current measured capacity and verification. Passenger vehicles are not enabled automatically.</span></span>
                  </label>
                  {profileForm.supports_supply_delivery && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {PROFILE_FIELDS.map(([key, label, unit]) => (
                          <Field key={key} id={`cargo-${key}`} label={label} unit={unit} required value={profileForm[key]} onChange={(event) => setProfileField(key, event.target.value)} min="0" />
                        ))}
                        <Field id="cargo-temperature-min" label="Temperature minimum" unit="°C" value={profileForm.temperature_min_c} onChange={(event) => setProfileField("temperature_min_c", event.target.value)} />
                        <Field id="cargo-temperature-max" label="Temperature maximum" unit="°C" value={profileForm.temperature_max_c} onChange={(event) => setProfileField("temperature_max_c", event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-foreground-secondary">Verified handling capabilities</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {HANDLING_CAPABILITIES.map(([code, label]) => (
                            <label key={code} className="inline-flex items-center gap-2 text-xs text-foreground">
                              <input type="checkbox" checked={profileForm.handling_capabilities.includes(code)} onChange={() => toggleCapability(code)} className="h-4 w-4 accent-primary" />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field id="cargo-verification-reference" label="Verification reference" type="text" required value={profileForm.verification_reference} onChange={(event) => setProfileField("verification_reference", event.target.value)} />
                        <Field id="cargo-verification-valid-until" label="Verification valid until" type="date" required value={profileForm.verification_valid_until} onChange={(event) => setProfileField("verification_valid_until", event.target.value)} />
                      </div>
                    </>
                  )}
                  {profileVehicle?.supports_supply_delivery && <p className="flex items-center gap-2 text-xs text-success-800 dark:text-emerald-200"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verified {new Date(profileVehicle.verified_at).toLocaleDateString("en-PH")} · ref {profileVehicle.verification_reference}</p>}
                  <div className="flex justify-end">
                    <Button type="submit" disabled={!profileVehicleId || profileMutation.isPending}>
                      <Truck className="mr-2 h-4 w-4" aria-hidden="true" />
                      {profileMutation.isPending ? "Saving…" : "Save cargo profile"}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-foreground-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Shipment snapshots are separate from passenger bookings. This capability check does not reserve a driver or vehicle, and trip completion cannot create a receiving or inventory event.
      </p>
    </div>
  );
}
