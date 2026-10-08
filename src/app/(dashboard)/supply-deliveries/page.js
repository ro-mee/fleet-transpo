"use client";

import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, Clock, MapPin, PackageCheck, RefreshCw, Scale, ShieldCheck, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { can, hasRole } from "@/lib/auth/permissions";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { compareSupplyLoadFit } from "@/services/supply-shipment.service";
import { getSupplySiteMappings, saveSupplySiteMapping } from "@/services/supply-site-mapping.service";

const EMPTY_ITEMS = Object.freeze([]);

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

const PROFILE_FIELD_LIMITS = {
  rated_payload_kg: 1000000,
  gross_vehicle_weight_limit_kg: 1000000,
  operating_mass_kg: 1000000,
  operational_reserve_kg: 1000000,
  usable_volume_m3: 10000,
  compartment_length_m: 100,
  compartment_width_m: 100,
  compartment_height_m: 100,
  opening_length_m: 100,
  opening_width_m: 100,
  opening_height_m: 100,
};
const PROFILE_ERROR_KEYS = [
  ...PROFILE_FIELDS.map(([key]) => key),
  "temperature_min_c",
  "temperature_max_c",
  "verification_reference",
  "verification_valid_until",
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

function nextUtcDate() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateProfile(form) {
  const errors = {};
  for (const [key, label] of PROFILE_FIELDS) {
    const raw = form[key].trim();
    const max = PROFILE_FIELD_LIMITS[key];
    if (!raw) {
      errors[key] = `${label} is required when enabling supply delivery.`;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors[key] = `${label} must be a valid number.`;
    } else if (key === "operational_reserve_kg" ? value < 0 : value <= 0) {
      errors[key] = key === "operational_reserve_kg" ? "Must be zero or greater." : "Must be greater than zero.";
    } else if (value > max) {
      errors[key] = `Must be ${max.toLocaleString("en-PH")} or less.`;
    }
  }

  const grossWeight = Number(form.gross_vehicle_weight_limit_kg);
  const operatingMass = Number(form.operating_mass_kg);
  if (
    form.gross_vehicle_weight_limit_kg !== "" && form.operating_mass_kg !== "" &&
    Number.isFinite(grossWeight) && Number.isFinite(operatingMass) && grossWeight <= operatingMass &&
    !errors.gross_vehicle_weight_limit_kg
  ) {
    errors.gross_vehicle_weight_limit_kg = "Gross vehicle weight must exceed operating mass.";
  }

  for (const [key, label] of [["temperature_min_c", "Minimum temperature"], ["temperature_max_c", "Maximum temperature"]]) {
    const raw = form[key].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < -80 || value > 80) {
      errors[key] = `${label} must be between -80 and 80 °C.`;
    }
  }
  const minTemperature = Number(form.temperature_min_c);
  const maxTemperature = Number(form.temperature_max_c);
  if (
    form.temperature_min_c !== "" && form.temperature_max_c !== "" &&
    Number.isFinite(minTemperature) && Number.isFinite(maxTemperature) && minTemperature > maxTemperature &&
    !errors.temperature_max_c
  ) {
    errors.temperature_max_c = "Maximum temperature must not be below minimum temperature.";
  }

  const reference = form.verification_reference.trim();
  if (reference.length < 3) errors.verification_reference = "Use at least 3 non-space characters.";
  else if (reference.length > 255) errors.verification_reference = "Use no more than 255 characters.";

  const validUntil = form.verification_valid_until;
  if (!validUntil) errors.verification_valid_until = "Verification expiry is required when enabling supply delivery.";
  else if (!isCalendarDate(validUntil)) errors.verification_valid_until = "Enter a real calendar date.";
  else if (validUntil <= new Date().toISOString().slice(0, 10)) {
    errors.verification_valid_until = "Verification must remain valid beyond today (UTC).";
  }

  return errors;
}

function profileInputId(key) {
  if (key === "temperature_min_c") return "cargo-temperature-min";
  if (key === "temperature_max_c") return "cargo-temperature-max";
  if (key === "verification_reference") return "cargo-verification-reference";
  if (key === "verification_valid_until") return "cargo-verification-valid-until";
  return `cargo-${key}`;
}

function focusProfileErrors(errors) {
  const firstKey = Object.keys(errors)[0];
  if (firstKey) requestAnimationFrame(() => document.getElementById(profileInputId(firstKey))?.focus());
}

function recordedAt(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
    error.errors = body.errors && typeof body.errors === "object" ? body.errors : null;
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

function locationCoordinates(mapping) {
  if (
    mapping.latitude == null || mapping.longitude == null ||
    String(mapping.latitude).trim() === "" || String(mapping.longitude).trim() === ""
  ) return null;

  const latitude = Number(mapping.latitude);
  const longitude = Number(mapping.longitude);
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) return null;

  return [latitude, longitude];
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

function readableStatus(status) {
  return String(status || "Unknown")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function checkTone(status) {
  if (status === "PASS") return "border-success/25 bg-success/10 text-success-800 dark:text-success-200";
  if (status === "BLOCK") return "border-danger/25 bg-danger/10 text-danger-800 dark:text-rose-200";
  return "border-warning/30 bg-warning/10 text-amber-800 dark:text-amber-200";
}

function Field({ id, label, unit, value, onChange, type = "number", required = false, min, max, minLength, maxLength, error, step = "any" }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="flex items-baseline justify-between gap-2 text-xs font-medium text-foreground-secondary">
        <span>{label}{required ? <span className="text-danger"> *</span> : null}</span>
        {unit ? <span className="text-[11px] text-foreground-muted">{unit}</span> : null}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        min={min}
        max={max}
        minLength={minLength}
        maxLength={maxLength}
        step={type === "number" ? step : undefined}
        required={required}
        invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={onChange}
      />
      {error && <span id={`${id}-error`} className="block text-xs text-danger-800 dark:text-rose-200">{error}</span>}
    </div>
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
  const [profileErrors, setProfileErrors] = useState({});
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
  const shipments = shipmentsQuery.data?.shipments ?? EMPTY_ITEMS;
  const profiles = profilesQuery.data?.profiles ?? EMPTY_ITEMS;
  const siteMappings = siteMappingsQuery.data?.mappings ?? EMPTY_ITEMS;
  const fleetLocations = siteMappingsQuery.data?.locations ?? EMPTY_ITEMS;
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
  const evaluationSelectionRef = useRef({ shipmentId: null, vehicleId: null });
  const evaluationSelection = useMemo(() => ({
    shipmentId: selectedShipmentId || selectedShipment?.supply_shipment_id || null,
    vehicleId: selectedVehicleId ? Number(selectedVehicleId) : null,
    shipmentsUpdatedAt: shipmentsQuery.dataUpdatedAt,
    profilesUpdatedAt: profilesQuery.dataUpdatedAt,
  }), [selectedShipmentId, selectedShipment, selectedVehicleId, shipmentsQuery.dataUpdatedAt, profilesQuery.dataUpdatedAt]);
  useLayoutEffect(() => {
    evaluationSelectionRef.current = evaluationSelection;
  }, [evaluationSelection]);
  const hydratedProfileVehicleRef = useRef("");
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
    startTransition(() => {
      if (!selectedShipmentId && shipments[0]) setSelectedShipmentId(shipments[0].supply_shipment_id);
      if (selectedShipmentId && !shipments.some((item) => item.supply_shipment_id === selectedShipmentId)) {
        setSelectedShipmentId(shipments[0]?.supply_shipment_id ?? "");
        setEvaluation(null);
        setFleetLoadFit(null);
      }
    });
  }, [selectedShipmentId, shipments]);

  useEffect(() => {
    startTransition(() => {
      if (!profilesQuery.isSuccess) return;
      if (profiles.length === 0) {
        if (selectedVehicleId) setSelectedVehicleId("");
        if (profileVehicleId) {
          setProfileVehicleId("");
          setProfileErrors({});
        }
        return;
      }

      const firstVehicleId = String(profiles[0].vehicle_id);
      if (!profiles.some((item) => String(item.vehicle_id) === selectedVehicleId)) {
        setSelectedVehicleId(firstVehicleId);
      }
      if (!profiles.some((item) => String(item.vehicle_id) === profileVehicleId)) {
        setProfileVehicleId(firstVehicleId);
      }
    });
  }, [profiles, profilesQuery.isSuccess, selectedVehicleId, profileVehicleId]);

  useEffect(() => {
    startTransition(() => {
      if (!profilesQuery.isSuccess) return;
      if (!profileVehicleId) {
        setProfileForm({ ...blankProfile });
        setProfileErrors({});
        hydratedProfileVehicleRef.current = "";
        return;
      }
      if (hydratedProfileVehicleRef.current === profileVehicleId) return;

      setProfileForm(profileToForm(profileVehicle));
      setProfileErrors({});
      hydratedProfileVehicleRef.current = profileVehicleId;
    });
  }, [profileVehicleId, profileVehicle, profilesQuery.isSuccess]);

  useEffect(() => {
    startTransition(() => {
      setEvaluation(null);
      setFleetLoadFit(null);
    });
  }, [shipmentsQuery.dataUpdatedAt, profilesQuery.dataUpdatedAt]);

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
    mutationFn: ({ shipmentId, vehicleId }) => requestJson("/api/supply/shipments/evaluate", {
      method: "POST",
      body: JSON.stringify({ shipment_id: shipmentId, vehicle_id: vehicleId }),
    }),
    onMutate: () => setEvaluation(null),
    onSuccess: (result, request) => {
      const currentSelection = evaluationSelectionRef.current;
      if (
        request.shipmentId !== currentSelection.shipmentId ||
        request.vehicleId !== currentSelection.vehicleId ||
        request.shipmentsUpdatedAt !== currentSelection.shipmentsUpdatedAt ||
        request.profilesUpdatedAt !== currentSelection.profilesUpdatedAt ||
        result.shipment_id !== request.shipmentId ||
        Number(result.vehicle_id) !== request.vehicleId
      ) return;
      setEvaluation({ ...result.evaluation, assignment_eligibility: result.assignment_eligibility });
    },
    onError: (error, request) => {
      const currentSelection = evaluationSelectionRef.current;
      if (
        request.shipmentId === currentSelection.shipmentId &&
        request.vehicleId === currentSelection.vehicleId &&
        request.shipmentsUpdatedAt === currentSelection.shipmentsUpdatedAt &&
        request.profilesUpdatedAt === currentSelection.profilesUpdatedAt
      ) toast.error(error.message);
    },
  });

  const fleetLoadFitMutation = useMutation({
    mutationFn: ({ shipmentId }) => compareSupplyLoadFit(shipmentId),
    onMutate: () => setFleetLoadFit(null),
    onSuccess: (result, request) => {
      const currentSelection = evaluationSelectionRef.current;
      if (
        request.shipmentId === currentSelection.shipmentId &&
        request.shipmentsUpdatedAt === currentSelection.shipmentsUpdatedAt &&
        request.profilesUpdatedAt === currentSelection.profilesUpdatedAt &&
        result.shipment_id === request.shipmentId
      ) setFleetLoadFit(result);
    },
  });

  const profileMutation = useMutation({
    mutationFn: (body) => requestJson("/api/supply/vehicles/cargo-profile", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      toast.success("Vehicle cargo profile saved");
      setProfileErrors({});
      queryClient.invalidateQueries({ queryKey: ["supply-cargo-profiles"] });
      setEvaluation(null);
      setFleetLoadFit(null);
    },
    onError: (error) => {
      const fieldErrors = error.errors && typeof error.errors === "object"
        ? Object.fromEntries(Object.entries(error.errors).filter(([key, message]) => PROFILE_ERROR_KEYS.includes(key) && typeof message === "string"))
        : {};
      setProfileErrors(fieldErrors);
      focusProfileErrors(fieldErrors);
      toast.error(error.message);
    },
  });

  const siteMappingMutation = useMutation({
    mutationFn: saveSupplySiteMapping,
    onSuccess: () => {
      toast.success("Sandbox site mapping saved");
      queryClient.invalidateQueries({ queryKey: ["supply-site-mappings"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const currentEvaluationError = evaluationMutation.isError &&
    evaluationMutation.variables?.shipmentId === evaluationSelection.shipmentId &&
    evaluationMutation.variables?.vehicleId === evaluationSelection.vehicleId &&
    evaluationMutation.variables?.shipmentsUpdatedAt === evaluationSelection.shipmentsUpdatedAt &&
    evaluationMutation.variables?.profilesUpdatedAt === evaluationSelection.profilesUpdatedAt
    ? evaluationMutation.error.message
    : null;
  const currentFleetLoadFitError = fleetLoadFitMutation.isError &&
    fleetLoadFitMutation.variables?.shipmentId === evaluationSelection.shipmentId &&
    fleetLoadFitMutation.variables?.shipmentsUpdatedAt === evaluationSelection.shipmentsUpdatedAt &&
    fleetLoadFitMutation.variables?.profilesUpdatedAt === evaluationSelection.profilesUpdatedAt
    ? fleetLoadFitMutation.error.message
    : null;

  const queueSummary = useMemo(() => ({
    total: shipments.length,
    ready: shipments.filter((item) => item.status === "READY_FOR_PLANNING").length,
    waiting: shipments.filter((item) => item.status === "WAITING_FOR_PICKUP").length,
  }), [shipments]);
  const isRefreshingPageData = shipmentsQuery.isFetching || profilesQuery.isFetching ||
    (canImportSandbox && siteMappingsQuery.isFetching);
  const requestCountsUnavailable = shipmentsQuery.isLoading || (shipmentsQuery.isError && !shipmentsQuery.data);

  function setProfileField(key, value) {
    setProfileForm((current) => ({ ...current, [key]: value }));
    setProfileErrors((current) => {
      if (key === "supports_supply_delivery" && !value) return {};
      const next = { ...current };
      delete next[key];
      if (
        (key === "gross_vehicle_weight_limit_kg" || key === "operating_mass_kg") &&
        next.gross_vehicle_weight_limit_kg === "Gross vehicle weight must exceed operating mass."
      ) delete next.gross_vehicle_weight_limit_kg;
      if (
        (key === "temperature_min_c" || key === "temperature_max_c") &&
        next.temperature_max_c === "Maximum temperature must not be below minimum temperature."
      ) delete next.temperature_max_c;
      return next;
    });
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
    setProfileErrors({});
    if (!profileForm.supports_supply_delivery) {
      profileMutation.mutate({ vehicle_id: Number(profileVehicleId), supports_supply_delivery: false });
      return;
    }
    const errors = validateProfile(profileForm);
    if (Object.keys(errors).length > 0) {
      setProfileErrors(errors);
      focusProfileErrors(errors);
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

  function refreshPageData() {
    setEvaluation(null);
    setFleetLoadFit(null);
    evaluationMutation.reset();
    fleetLoadFitMutation.reset();
    void shipmentsQuery.refetch();
    void profilesQuery.refetch();
    if (canImportSandbox) void siteMappingsQuery.refetch();
  }

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={PackageCheck}
        title="Supply Deliveries"
        badge="Sandbox"
        description="Inspect approved transport snapshots and measure physical load fit."
        actions={(
          <Button type="button" variant="outline" className={cn("h-10", heroButtonOutlineClass)} onClick={refreshPageData} disabled={isRefreshingPageData}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingPageData ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
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

      <section aria-label="Supply request counts">
        <StatGrid cols={3}>
          <StatCard icon={PackageCheck} label="All requests" value={requestCountsUnavailable ? "—" : queueSummary.total} trend="Imported sandbox snapshots" tone="primary" />
          <StatCard icon={CheckCircle2} label="Ready for planning" value={requestCountsUnavailable ? "—" : queueSummary.ready} trend="Source status: ready for planning" tone={queueSummary.ready ? "success" : "neutral"} />
          <StatCard icon={Clock} label="Waiting for pickup" value={requestCountsUnavailable ? "—" : queueSummary.waiting} trend="Source status: waiting for pickup" tone={queueSummary.waiting ? "warning" : "neutral"} />
        </StatGrid>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden rounded-3xl">
          <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border/60 bg-muted/20 px-5 py-4">
            <div>
              <CardTitle>Transport requests</CardTitle>
              <p className="mt-1 text-xs text-foreground-secondary">Source approvals and manifest revisions retained as received.</p>
            </div>
              <Badge variant="outline" className="font-data tabular-nums">{shipments.length} total</Badge>
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
              <EmptyState
                icon={PackageCheck}
                title="No shipment snapshots yet"
                description={canImportSandbox
                  ? "Import a synthetic sandbox event to review a sample shipment."
                  : "Ask an administrator to import a synthetic sandbox event for review."}
                variant="first-run"
                size="compact"
                action={canImportSandbox && (
                  <Button asChild variant="outline">
                    <a href="#supply-sandbox-import">Open sandbox import</a>
                  </Button>
                )}
              />
            ) : (
              <div className="divide-y divide-border">
                {shipments.map((shipment) => {
                  const active = shipment.supply_shipment_id === (selectedShipment?.supply_shipment_id ?? selectedShipmentId);
                  return (
                    <button
                      key={shipment.supply_shipment_id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedShipmentId(shipment.supply_shipment_id);
                        setEvaluation(null);
                        setFleetLoadFit(null);
                        evaluationMutation.reset();
                        fleetLoadFitMutation.reset();
                      }}
                      className={`grid w-full gap-3 rounded-xl border px-3 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 sm:grid-cols-[minmax(0,1fr)_auto] ${active ? "border-info/25 bg-info/5" : "border-transparent hover:border-border/60 hover:bg-muted/40"}`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-all font-data text-sm font-semibold tabular-nums text-foreground">{shipment.external_request_id}</span>
                          <Badge variant="outline" className="font-data tabular-nums">Rev {shipment.current_manifest_revision}</Badge>
                        </div>
                        <p className="mt-1 break-all text-sm text-foreground-secondary"><span className="font-data">{shipment.pickup_site_id}</span> <span aria-hidden="true">→</span> <span className="font-data">{shipment.delivery_site_id}</span></p>
                        <p className="mt-1 text-xs text-foreground-muted">{deliveryWindow(shipment)}</p>
                      </div>
                      <div className="flex min-w-0 items-end justify-between gap-4 sm:flex-col sm:items-end sm:justify-center">
                        <Badge variant="outline" className="capitalize">{readableStatus(shipment.status)}</Badge>
                        <span className="break-words text-right font-data text-xs tabular-nums text-foreground-secondary">
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

        <Card className="overflow-hidden rounded-3xl">
          <CardHeader className="flex-row items-start justify-between gap-3 border-b border-border/60 bg-muted/20 px-5 py-4">
            <div className="min-w-0">
              <CardTitle className="text-[15px] tracking-tight">Cargo fit check</CardTitle>
              <p className="mt-1 text-xs leading-relaxed text-foreground-secondary">Checks manifest readiness and measured fit. Trip-specific load, driver, documents and shared schedule checks are not included.</p>
            </div>
            <Badge variant="outline" className="shrink-0">Measurement only</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {shipmentsQuery.isLoading || profilesQuery.isLoading ? (
              <div className="space-y-3" aria-busy="true" aria-label="Loading requests and vehicles">
                <div className="h-10 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
                <div className="h-10 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
                <div className="h-10 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
              </div>
            ) : shipmentsQuery.isError || profilesQuery.isError ? (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-danger/25 bg-danger/10 p-4 text-sm text-danger-800 dark:text-rose-200" role="alert">
                <p>
                  {shipmentsQuery.isError && profilesQuery.isError
                    ? "Shipment and vehicle data could not be loaded."
                    : shipmentsQuery.isError
                      ? "Shipment data could not be loaded."
                      : "Vehicle data could not be loaded."} Use retry to try again.
                </p>
                <Button type="button" variant="outline" onClick={refreshPageData}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  Try again
                </Button>
              </div>
            ) : shipments.length === 0 ? (
              <EmptyState
                icon={PackageCheck}
                title="No shipment to measure"
                description="Import a synthetic sandbox snapshot before running a load check."
                variant="first-run"
                size="compact"
              />
            ) : profiles.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No fleet vehicles available"
                description="Add a vehicle in Fleet before checking measured load fit."
                variant="first-run"
                size="compact"
              />
            ) : (
              <div className="space-y-4">
            <label className="block space-y-1.5 text-xs font-medium text-foreground-secondary">
              <span>Supply request</span>
              <Select
                value={selectedShipment?.supply_shipment_id ?? ""}
                onValueChange={(value) => {
                  setSelectedShipmentId(value);
                  setEvaluation(null);
                  setFleetLoadFit(null);
                  evaluationMutation.reset();
                  fleetLoadFitMutation.reset();
                }}
              >
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue className="min-w-0 truncate" placeholder="Select a supply request" />
                </SelectTrigger>
                <SelectContent>
                  {shipments.map((shipment) => (
                    <SelectItem key={shipment.supply_shipment_id} value={String(shipment.supply_shipment_id)}>
                      {shipment.external_request_id} · rev {shipment.current_manifest_revision}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-foreground-secondary">
              <span>Vehicle</span>
              <Select
                value={selectedVehicleId}
                onValueChange={(value) => {
                  setSelectedVehicleId(value);
                  setEvaluation(null);
                  evaluationMutation.reset();
                }}
              >
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue className="min-w-0 truncate" placeholder="Select a fleet vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((vehicle) => (
                    <SelectItem key={vehicle.vehicle_id} value={String(vehicle.vehicle_id)}>
                      {vehicle.plate_number} · {vehicle.vehicle_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVehicle && <span className="block text-[11px] text-foreground-muted">Cargo profile: {selectedVehicle.supports_supply_delivery ? "enabled" : "not enabled"} · vehicle state: {selectedVehicle.vehicle_status}</span>}
            </label>
            <Button
              className="w-full"
              disabled={!selectedShipment || !selectedVehicle || evaluationMutation.isPending}
              onClick={() => evaluationMutation.mutate({
                shipmentId: selectedShipment.supply_shipment_id,
                vehicleId: Number(selectedVehicleId),
                shipmentsUpdatedAt: shipmentsQuery.dataUpdatedAt,
                profilesUpdatedAt: profilesQuery.dataUpdatedAt,
              })}
            >
              <Scale className="mr-2 h-4 w-4" aria-hidden="true" />
              {evaluationMutation.isPending ? "Checking measurements…" : "Check load fit"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!selectedShipment || profilesQuery.isLoading || profiles.length === 0 || fleetLoadFitMutation.isPending}
              onClick={() => fleetLoadFitMutation.mutate({
                shipmentId: selectedShipment.supply_shipment_id,
                shipmentsUpdatedAt: shipmentsQuery.dataUpdatedAt,
                profilesUpdatedAt: profilesQuery.dataUpdatedAt,
              })}
            >
              <Truck className="mr-2 h-4 w-4" aria-hidden="true" />
              {fleetLoadFitMutation.isPending ? "Comparing fleet measurements…" : "Compare load fit across fleet"}
            </Button>

            {currentEvaluationError && <p role="alert" className="text-sm text-danger-800 dark:text-rose-200">{currentEvaluationError}</p>}
            {currentFleetLoadFitError && <p role="alert" className="text-sm text-danger-800 dark:text-rose-200">{currentFleetLoadFitError}</p>}
            {evaluation && (
              <div className="space-y-3 border-t border-border pt-4" aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{evaluation.load_checks_pass ? "Measured-load checks pass" : "Measured-load checks blocked"}</p>
                  <Badge variant="outline">{evaluation.load_checks_pass ? "MEASURED PASS" : "MEASURED BLOCKED"}</Badge>
                </div>
                <div className="space-y-1 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">Assignment not evaluated</p>
                    <Badge variant="outline">{evaluation.assignment_eligibility || "NOT_EVALUATED"}</Badge>
                  </div>
                  <p className="leading-relaxed">{evaluation.limitations?.join(" ") || "This measurement pre-screen does not determine assignment eligibility."}</p>
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {canImportSandbox && (
        <section className="space-y-4" aria-labelledby="supply-sandbox-tools-title">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="supply-sandbox-tools-title" className="text-base font-semibold tracking-tight text-foreground">Sandbox setup</h2>
              <p className="mt-1 text-xs text-foreground-secondary">Admin tools for sample shipment data and its Fleet site mappings.</p>
            </div>
            <Badge variant="outline">Admin tools</Badge>
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card id="supply-sandbox-import" className="overflow-hidden rounded-3xl">
            <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4">
              <CardTitle className="text-[15px] tracking-tight">Import approved sandbox event</CardTitle>
              <p className="text-xs text-foreground-secondary">Admin-only. Available only in non-production when sandbox import is enabled. Event weights use kilograms and dimensions use metres.</p>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={submitSandboxImport}>
                <textarea
                  aria-label="SCM sandbox event JSON"
                  value={importJson}
                  onChange={(event) => { setImportJson(event.target.value); setImportError(""); }}
                  rows={9}
                  spellCheck={false}
                  placeholder="Paste a version 1.0 synthetic sandbox event…"
                  className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
                />
                {importError && <p className="text-sm text-danger-800 dark:text-rose-200" role="alert">{importError}</p>}
                <div className="flex flex-wrap justify-between gap-2">
                  <Button type="button" variant="outline" onClick={() => { setImportJson(JSON.stringify(syntheticEvent(), null, 2)); setImportError(""); }}>
                    Use sample event
                  </Button>
                  <Button type="submit" disabled={!importJson.trim() || importMutation.isPending}>
                    <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                    {importMutation.isPending ? "Importing…" : "Import sandbox event"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-3xl">
            <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4">
              <CardTitle className="text-[15px] tracking-tight">Map sandbox sites to Fleet locations</CardTitle>
              <p className="text-xs text-foreground-secondary">
                Match sandbox pickup and delivery IDs to active Fleet locations with a stored address and coordinates. Review the location before saving; this does not look up or guess locations.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {siteMappingsQuery.isLoading ? (
                <div className="space-y-3" aria-busy="true" aria-label="Loading site mappings and Fleet locations">
                  <div className="h-10 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
                  <div className="h-10 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
                </div>
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
                        <Select
                          value={effectiveSiteMappingKey}
                          onValueChange={(targetKey) => {
                            setSiteMappingKey(targetKey);
                            const target = siteTargets.find((item) => item.key === targetKey);
                            const savedMapping = siteMappings.find((item) => item.source_organization_id === target?.source_organization_id && item.external_site_id === target?.external_site_id);
                            const locationId = savedMapping?.location_id ?? fleetLocations[0]?.location_id;
                            setSiteMappingLocationId(locationId ? String(locationId) : "");
                          }}
                          required
                        >
                          <SelectTrigger id="site-mapping-target" className="h-10 text-sm">
                            <SelectValue className="min-w-0 truncate" placeholder="Select a sandbox SCM site" />
                          </SelectTrigger>
                          <SelectContent className="max-w-[min(90vw,36rem)]">
                            {siteTargets.map((target) => (
                              <SelectItem key={target.key} value={target.key} className="min-w-0 whitespace-normal break-words leading-5">
                                {target.source_organization_id} · {target.external_site_id} ({target.stops.join(" / ")})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="block space-y-1.5 text-xs font-medium text-foreground-secondary" htmlFor="site-mapping-location">
                        <span>Fleet location</span>
                        <Select
                          value={effectiveSiteMappingLocationId}
                          onValueChange={setSiteMappingLocationId}
                          required
                        >
                          <SelectTrigger id="site-mapping-location" className="h-10 text-sm">
                            <SelectValue className="min-w-0 truncate" placeholder="Select a Fleet location" />
                          </SelectTrigger>
                          <SelectContent className="max-w-[min(90vw,36rem)]">
                            {fleetLocations.map((location) => (
                              <SelectItem key={location.location_id} value={String(location.location_id)} className="min-w-0 whitespace-normal break-words leading-5">
                                {location.name} · {location.address}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                          const coordinates = locationCoordinates(mapping);
                          const mappingActive = mapping.is_active &&
                            mapping.location_is_active &&
                            Boolean(mapping.location_address?.trim()) &&
                            coordinates !== null;
                          return (
                            <li key={mapping.supply_site_mapping_id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                              <div className="min-w-0">
                                <p className="break-all text-sm font-medium text-foreground">{mapping.external_site_id}</p>
                                <p className="break-all text-xs text-foreground-secondary">{mapping.source_organization_id}</p>
                                <p className="mt-1 text-xs text-foreground-secondary">{mapping.location_name} · {coordinates ? coordinates.map((value) => value.toFixed(5)).join(", ") : "Coordinates unavailable"}</p>
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
          </div>
        </section>
      )}

      {canManageProfiles && (
        <Card className="overflow-hidden rounded-3xl">
            <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4">
              <CardTitle className="text-[15px] tracking-tight">Vehicle cargo capability</CardTitle>
              <p className="text-xs text-foreground-secondary">Only enable a vehicle when each measurement and its verification reference are confirmed by Fleet.</p>
            </CardHeader>
            <CardContent>
              {profilesQuery.isLoading ? (
                <div className="space-y-3" aria-busy="true" aria-label="Loading fleet vehicles">
                  <div className="h-10 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
                  <div className="h-10 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
                </div>
              ) : profilesQuery.isError ? (
                <div className="flex flex-col items-start gap-3" role="alert">
                  <p className="text-sm text-danger-800 dark:text-rose-200">Fleet vehicles could not be loaded.</p>
                  <Button type="button" variant="outline" onClick={refreshPageData}>
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                    Try again
                  </Button>
                </div>
              ) : profiles.length === 0 ? (
                <EmptyState
                  icon={Truck}
                  title="No vehicles to configure"
                  description="Add a fleet vehicle before recording its cargo capabilities."
                  variant="first-run"
                  size="compact"
                />
              ) : (
                <form className="space-y-4" onSubmit={submitProfile} noValidate>
                  <label className="block space-y-1.5 text-xs font-medium text-foreground-secondary">
                    <span>Vehicle</span>
                    <Select value={profileVehicleId} onValueChange={(value) => { setProfileErrors({}); setProfileVehicleId(value); }} required>
                      <SelectTrigger className="h-10 text-sm">
                        <SelectValue className="min-w-0 truncate" placeholder="Select a vehicle" />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((vehicle) => (
                          <SelectItem key={vehicle.vehicle_id} value={String(vehicle.vehicle_id)}>
                            {vehicle.plate_number} · {vehicle.vehicle_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
                    <input type="checkbox" checked={profileForm.supports_supply_delivery} onChange={(event) => setProfileField("supports_supply_delivery", event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
                    <span><span className="font-medium text-foreground">Enable supply delivery</span><span className="mt-0.5 block text-xs text-foreground-secondary">Requires current measured capacity and verification. Passenger vehicles are not enabled automatically.</span></span>
                  </label>
                  {profileForm.supports_supply_delivery && (
                    <div className="space-y-5">
                      <fieldset className="min-w-0 space-y-3">
                        <legend className="text-sm font-semibold text-foreground">Capacity measurements</legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {PROFILE_FIELDS.slice(0, 5).map(([key, label, unit]) => (
                            <Field key={key} id={`cargo-${key}`} label={label} unit={unit} required value={profileForm[key]} onChange={(event) => setProfileField(key, event.target.value)} min="0" max={PROFILE_FIELD_LIMITS[key]} error={profileErrors[key]} />
                          ))}
                        </div>
                      </fieldset>
                      <fieldset className="min-w-0 space-y-3 border-t border-border/70 pt-4">
                        <legend className="text-sm font-semibold text-foreground">Compartment dimensions</legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {PROFILE_FIELDS.slice(5).map(([key, label, unit]) => (
                            <Field key={key} id={`cargo-${key}`} label={label} unit={unit} required value={profileForm[key]} onChange={(event) => setProfileField(key, event.target.value)} min="0" max={PROFILE_FIELD_LIMITS[key]} error={profileErrors[key]} />
                          ))}
                        </div>
                      </fieldset>
                      <fieldset className="min-w-0 space-y-3 border-t border-border/70 pt-4">
                        <legend className="text-sm font-semibold text-foreground">Temperature and handling</legend>
                        <p className="text-xs text-foreground-secondary">Temperature limits are optional. Leave both blank when no temperature range is recorded.</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field id="cargo-temperature-min" label="Temperature minimum" unit="°C" value={profileForm.temperature_min_c} onChange={(event) => setProfileField("temperature_min_c", event.target.value)} min="-80" max="80" error={profileErrors.temperature_min_c} />
                          <Field id="cargo-temperature-max" label="Temperature maximum" unit="°C" value={profileForm.temperature_max_c} onChange={(event) => setProfileField("temperature_max_c", event.target.value)} min="-80" max="80" error={profileErrors.temperature_max_c} />
                        </div>
                        <div className="space-y-2 pt-1">
                          <p className="text-xs font-medium text-foreground-secondary">Handling capabilities</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {HANDLING_CAPABILITIES.map(([code, label]) => (
                              <label key={code} className="inline-flex min-h-8 items-center gap-2 text-xs text-foreground">
                                <input type="checkbox" checked={profileForm.handling_capabilities.includes(code)} onChange={() => toggleCapability(code)} className="h-4 w-4 accent-primary" />
                                {label}
                              </label>
                            ))}
                          </div>
                        </div>
                      </fieldset>
                      <fieldset className="min-w-0 space-y-3 border-t border-border/70 pt-4">
                        <legend className="text-sm font-semibold text-foreground">Verification record</legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field id="cargo-verification-reference" label="Verification reference" type="text" required minLength={3} maxLength={255} value={profileForm.verification_reference} onChange={(event) => setProfileField("verification_reference", event.target.value)} error={profileErrors.verification_reference} />
                          <Field id="cargo-verification-valid-until" label="Verification valid until" type="date" required min={nextUtcDate()} value={profileForm.verification_valid_until} onChange={(event) => setProfileField("verification_valid_until", event.target.value)} error={profileErrors.verification_valid_until} />
                        </div>
                      </fieldset>
                    </div>
                  )}
                  {profileVehicle?.supports_supply_delivery && (
                    <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-foreground-secondary">
                      <p className="font-medium text-foreground">
                        Latest recorded save: {profileVehicle.verified_by == null || profileVehicle.verified_by === "" ? "employee ID unavailable" : `employee ID ${profileVehicle.verified_by}`} · {recordedAt(profileVehicle.verified_at)} · Reference: {profileVehicle.verification_reference || "unavailable"}
                      </p>
                      <p className="mt-1">This record shows who saved the profile and when. It is not a separate compliance approval.</p>
                    </div>
                  )}
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
      <p className="flex items-start gap-2 text-xs leading-relaxed text-foreground-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Shipment snapshots are separate from passenger bookings. This capability check does not reserve a driver or vehicle, and trip completion cannot create a receiving or inventory event.
      </p>
    </div>
  );
}
