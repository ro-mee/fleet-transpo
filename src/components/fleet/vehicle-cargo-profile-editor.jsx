"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Truck } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { deriveUsablePayload } from "@/lib/cargo/physical-load";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { HANDLING_CAPABILITIES, PROFILE_ERROR_KEYS, PROFILE_FIELDS, PROFILE_FIELD_LIMITS, nextUtcDate, profilePayload, profileToForm, validateProfile } from "./vehicle-cargo-profile-form";

function numberText(value) {
  return value == null || !Number.isFinite(Number(value)) ? "Not recorded" : new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(Number(value));
}

function recordedAt(value) {
  const date = new Date(value);
  return !value || !Number.isFinite(date.getTime()) ? "time unavailable" : new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(date);
}

function profileInputId(key) {
  return `fleet-cargo-${key}`;
}

function focusErrors(errors) {
  const firstKey = Object.keys(errors)[0];
  if (firstKey) requestAnimationFrame(() => document.getElementById(profileInputId(firstKey))?.focus());
}

function Field({ name, label, unit, value, onChange, type = "number", required = false, min, max, minLength, maxLength, error }) {
  const id = profileInputId(name);
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="flex items-baseline justify-between gap-2 text-xs font-medium text-foreground-secondary">
        <span>{label}{required && <span className="text-danger"> *</span>}</span>
        {unit && <span>{unit}</span>}
      </Label>
      <Input id={id} type={type} value={value} onChange={onChange} min={min} max={max} minLength={minLength} maxLength={maxLength} step={type === "number" ? "any" : undefined} required={required} invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
      {error && <p id={`${id}-error`} className="text-xs text-danger-800 dark:text-rose-200">{error}</p>}
    </div>
  );
}

function CargoProfileForm({ vehicleId, savedProfile, legacyCapacityKg, queryKey }) {
  const queryClient = useQueryClient();
  // Seed once per saved vehicle. A background refresh updates provenance without
  // replacing the measurements the user is editing.
  const [profileForm, setProfileForm] = useState(() => profileToForm(savedProfile));
  const [profileErrors, setProfileErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [openedAt] = useState(Date.now);
  const mutation = useMutation({
    mutationFn: body => apiFetch("/api/supply/vehicles/cargo-profile", { method: "PUT", body }),
    onSuccess: result => {
      setProfileForm(profileToForm(result.profile));
      setProfileErrors({});
      setSaveError("");
      queryClient.setQueryData(queryKey, current => ({ ...current, profiles: current.profiles.map(profile => Number(profile.vehicle_id) === vehicleId ? { ...profile, ...result.profile } : profile) }));
      queryClient.invalidateQueries({ queryKey: ["supply-cargo-profiles"] });
      toast.success("Vehicle cargo profile saved");
    },
    onError: error => {
      const fieldErrors = Object.fromEntries(Object.entries(error.data?.errors ?? {}).filter(([key, message]) => PROFILE_ERROR_KEYS.includes(key) && typeof message === "string"));
      setProfileErrors(fieldErrors);
      setSaveError(error.message);
      focusErrors(fieldErrors);
    },
  });

  function setField(key, value) {
    setProfileForm(current => ({ ...current, [key]: value }));
    setSaveError("");
    setProfileErrors(current => {
      if (key === "supports_supply_delivery" && !value) return {};
      const next = { ...current };
      delete next[key];
      if (["gross_vehicle_weight_limit_kg", "operating_mass_kg"].includes(key) && next.gross_vehicle_weight_limit_kg === "Gross vehicle weight must exceed operating mass.") delete next.gross_vehicle_weight_limit_kg;
      if (["temperature_min_c", "temperature_max_c"].includes(key) && next.temperature_max_c === "Maximum temperature must not be below minimum temperature.") delete next.temperature_max_c;
      return next;
    });
  }

  function submit(event) {
    event.preventDefault();
    const errors = profileForm.supports_supply_delivery ? validateProfile(profileForm) : {};
    setProfileErrors(errors);
    if (Object.keys(errors).length) { focusErrors(errors); return; }
    mutation.mutate(profilePayload(profileForm, vehicleId));
  }

  const savedPayload = deriveUsablePayload(savedProfile);
  const draftPayload = deriveUsablePayload(profileForm);
  const expiry = Date.parse(savedProfile.verification_valid_until ?? "");
  const verificationExpired = Number.isFinite(expiry) && expiry <= openedAt;
  const legacy = legacyCapacityKg == null || String(legacyCapacityKg).trim() === "" ? null : Number(legacyCapacityKg);
  const discrepancy = savedPayload != null && Number.isFinite(legacy) && Number(savedPayload.toFixed(3)) !== Number(legacy.toFixed(3));

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <dl className="grid gap-4 border-b border-border pb-4 sm:grid-cols-2">
        <div><dt className="text-xs text-foreground-secondary">Saved profile usable payload</dt><dd className="mt-1 font-data text-base font-semibold">{numberText(savedPayload)}{savedPayload != null && " kg"}</dd></div>
        <div><dt className="text-xs text-foreground-secondary">Legacy recorded capacity</dt><dd className="mt-1 font-data text-base font-semibold">{numberText(legacy)}{legacy != null && Number.isFinite(legacy) && " kg"}</dd></div>
      </dl>
      <p className="text-xs text-foreground-secondary">Profile: {savedProfile.supports_supply_delivery === true ? "enabled" : "not enabled"}. Measurement validity: {verificationExpired ? "expired — update the record before enhanced cargo checks" : Number.isFinite(expiry) ? "within the recorded validity period" : "not recorded"}. Payload alone does not establish cargo eligibility.</p>
      {discrepancy && <p role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-amber-900 dark:text-amber-100">The saved profile and legacy capacity disagree. Review the measurements and their source before enabling enhanced cargo checks. Saving this profile does not change the legacy value.</p>}
      <p className="text-xs leading-relaxed text-foreground-secondary">Usable payload is the lower of rated payload and gross weight limit minus operating mass, then minus the operating reserve. Confirm where crew, fuel and equipment are counted so each is included once. Dimensions and handling still require separate load checks.</p>
      <fieldset disabled={mutation.isPending} className="min-w-0 space-y-5">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={profileForm.supports_supply_delivery} onChange={event => setField("supports_supply_delivery", event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
          <span><span className="font-medium">Enable cargo capability profile</span><span className="mt-1 block text-xs text-foreground-secondary">Records measured capabilities for cargo checks. It does not commission the vehicle or approve an assignment.</span></span>
        </label>
        {profileForm.supports_supply_delivery && <>
          <fieldset className="min-w-0 space-y-3">
            <legend className="text-sm font-semibold">Capacity measurements</legend>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PROFILE_FIELDS.slice(0, 5).map(([key, label, unit]) => <Field key={key} name={key} label={label} unit={unit} required value={profileForm[key]} onChange={event => setField(key, event.target.value)} min="0" max={PROFILE_FIELD_LIMITS[key]} error={profileErrors[key]} />)}
            </div>
            <p className="text-xs text-foreground-secondary">Draft usable payload: <span className="font-data font-medium text-foreground">{numberText(draftPayload)}{draftPayload != null && " kg"}</span>. Save the profile to record these measurements.</p>
          </fieldset>
          <fieldset className="min-w-0 space-y-3 border-t border-border pt-4">
            <legend className="text-sm font-semibold">Compartment and loading opening</legend>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PROFILE_FIELDS.slice(5).map(([key, label, unit]) => <Field key={key} name={key} label={label} unit={unit} required value={profileForm[key]} onChange={event => setField(key, event.target.value)} min="0" max={PROFILE_FIELD_LIMITS[key]} error={profileErrors[key]} />)}
            </div>
          </fieldset>
          <fieldset className="min-w-0 space-y-3 border-t border-border pt-4">
            <legend className="text-sm font-semibold">Temperature and handling</legend>
            <p className="text-xs text-foreground-secondary">Leave both temperature limits blank when no range is recorded.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="temperature_min_c" label="Temperature minimum" unit="°C" value={profileForm.temperature_min_c} onChange={event => setField("temperature_min_c", event.target.value)} min="-80" max="80" error={profileErrors.temperature_min_c} />
              <Field name="temperature_max_c" label="Temperature maximum" unit="°C" value={profileForm.temperature_max_c} onChange={event => setField("temperature_max_c", event.target.value)} min="-80" max="80" error={profileErrors.temperature_max_c} />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {HANDLING_CAPABILITIES.map(([code, label]) => <label key={code} className="inline-flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" checked={profileForm.handling_capabilities.includes(code)} onChange={() => setField("handling_capabilities", profileForm.handling_capabilities.includes(code) ? profileForm.handling_capabilities.filter(value => value !== code) : [...profileForm.handling_capabilities, code])} className="h-4 w-4 accent-primary" />{label}</label>)}
            </div>
          </fieldset>
          <fieldset className="min-w-0 space-y-3 border-t border-border pt-4">
            <legend className="text-sm font-semibold">Measurement record</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="verification_reference" label="Verification reference" type="text" required minLength={3} maxLength={255} value={profileForm.verification_reference} onChange={event => setField("verification_reference", event.target.value)} error={profileErrors.verification_reference} />
              <Field name="verification_valid_until" label="Verification valid until" type="date" required min={nextUtcDate()} value={profileForm.verification_valid_until} onChange={event => setField("verification_valid_until", event.target.value)} error={profileErrors.verification_valid_until} />
            </div>
          </fieldset>
        </>}
        {savedProfile.verified_at && <div className="border-t border-border pt-4 text-xs text-foreground-secondary"><p className="font-medium text-foreground">Recorded by employee ID {savedProfile.verified_by ?? "unavailable"} · {recordedAt(savedProfile.verified_at)} · Reference: {savedProfile.verification_reference || "unavailable"}</p><p className="mt-1">Valid until: {savedProfile.verification_valid_until?.slice(0, 10) || "not recorded"}. This stamp identifies the recording employee and time; it is not a separate compliance approval.</p></div>}
        {saveError && <p role="alert" className="text-sm text-danger-800 dark:text-rose-200">{saveError} Your draft is preserved.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-foreground-secondary">Cargo profile saves separately from vehicle details.</p>
          <Button type="submit"><Truck className="mr-2 h-4 w-4" aria-hidden="true" />{mutation.isPending ? "Saving…" : "Save cargo profile"}</Button>
        </div>
      </fieldset>
    </form>
  );
}

export default function VehicleCargoProfileEditor({ vehicleId, legacyCapacityKg }) {
  const queryKey = ["supply-cargo-profiles", vehicleId];
  const query = useQuery({ queryKey, queryFn: () => apiFetch(`/api/supply/vehicles/cargo-profile?vehicle_id=${vehicleId}`), enabled: Boolean(vehicleId), staleTime: 30_000 });
  const profile = query.data?.profiles?.find(row => Number(row.vehicle_id) === vehicleId);
  return (
    <Card id="cargo-capability">
      <CardHeader><CardTitle className="text-base">Measured cargo capability</CardTitle><CardDescription>Record the saved Cargo vehicle’s payload, compartment and handling capabilities in Fleet.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {!vehicleId ? <p className="text-sm text-foreground-secondary">Save the vehicle with Cargo operational use first, then open Edit Vehicle to record measured cargo capabilities.</p> : query.isLoading ? <div aria-busy="true" aria-label="Loading cargo profile" className="space-y-3"><div className="h-10 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" /><div className="h-10 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" /></div> : !profile ? <div className="space-y-3" role="alert"><p className="text-sm text-danger-800 dark:text-rose-200">{query.isError ? "The cargo profile could not be loaded. Retry before editing." : "The saved vehicle is unavailable for cargo profile editing."}</p><Button type="button" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Try again</Button></div> : <>
          {query.isError && <p role="alert" className="text-xs text-danger-800 dark:text-rose-200">The latest profile refresh failed. Your draft is preserved; retry before relying on the saved comparison.</p>}
          <CargoProfileForm key={vehicleId} vehicleId={vehicleId} savedProfile={profile} legacyCapacityKg={legacyCapacityKg} queryKey={queryKey} />
        </>}
      </CardContent>
    </Card>
  );
}
