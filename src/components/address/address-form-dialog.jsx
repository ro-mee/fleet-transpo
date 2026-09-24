"use client";

// The Add / Edit Address modal.
//
// It owns one `value` object and hands each part of it to one specialised child.
// All the rules live elsewhere and are imported: the cascade logic and the
// completeness rule in `@/lib/address/structured`, the geography seam in
// `@/services/geography.service`. This file is layout, state and submit, which is
// what keeps it from becoming the second place those rules are written down.
//
// EVERY EDIT GOES THROUGH `setField`, AND `setField` RUNS `editDetail`. That is
// the single place the pin is invalidated. Spreading the rule across a dozen
// onChange handlers is how one of them quietly stops doing it, and the failure
// that produces — a stored address carrying a coordinate from the text it used
// to have — has no visible symptom.
//
// SAVE IS DISABLED UNTIL THE ADDRESS IS COMPLETE, and the reason is always on
// screen. A greyed-out button with no explanation is the failure mode of that
// pattern; the checklist above the footer names exactly which required fields are
// still empty, using the same `structuredErrors` the server validates with, so
// the disabled state cannot outlive the reason for it.
//
// INPUT SURVIVES A FAILED SAVE. Nothing here clears `value` on error — the
// operator's work is not discarded because the server said no. The server's
// message is shown and the form stays exactly as it was.

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertCircle, Building2, FileText, Hash, MapPin, StickyNote, Warehouse } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FloatingShell } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EMPTY_STRUCTURED_ADDRESS,
  editDetail,
  requiredDetailFields,
  structuredErrors,
} from "@/lib/address/structured";
import { AddressTypeSelector } from "./address-type-selector";
import { AddressPreview } from "./address-preview";
import { LocationCascade, useProvinceRequirement } from "./location-cascade";

// Leaflet touches `window` at import time, so the pin map is client-only — the
// same loading strategy as every other map in this app.
const AddressPinMap = dynamic(() => import("./address-pin-map"), { ssr: false });

// Matches FLOATING_INPUT_CLASS in address-validator.jsx — the floating shell's
// own type scale, so every control in this grid lines up.
const FLOATING_INPUT_CLASS =
  "w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1";

function SectionLabel({ children }) {
  return (
    <h3 className="text-[0.68rem] font-bold uppercase tracking-[0.11em] text-foreground-muted">
      {children}
    </h3>
  );
}

/**
 * A single-line field in the floating shell.
 *
 * `onValue` receives the raw string; the parent applies it through `setField`,
 * which is also what clears the pin. This component deliberately knows nothing
 * about invalidation.
 */
function TextField({
  field,
  label,
  icon,
  value,
  onValue,
  error,
  required,
  hint,
  transform,
  ...props
}) {
  return (
    <FloatingShell icon={icon} label={label} required={required} error={error} hint={hint}>
      <input
        id={`address-${field}`}
        value={value ?? ""}
        onChange={(event) =>
          onValue(transform ? transform(event.target.value) : event.target.value)
        }
        className={FLOATING_INPUT_CLASS}
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        {...props}
      />
    </FloatingShell>
  );
}

export function AddressFormDialog({
  open,
  onOpenChange,
  /** Existing address for edit mode; omit for add. */
  initialValue,
  onSubmit,
  title = "Add address",
  description,
  submitLabel = "Save address",
  saving = false,
  /** Server-side failure to display. The form is never cleared because of it. */
  error,
  /** Hide the pin step for surfaces where a coordinate is meaningless. */
  showPinMap = true,
  /**
   * Hide the Home / Office / Other selector.
   *
   * For surfaces where the address belongs to a PLACE rather than a person — a
   * canonical location, a hotel — "home" is not a smaller truth but a different
   * kind of claim, and the default would store it without anyone asserting it.
   * Such a caller gets `forcedType` instead.
   */
  showTypeSelector = true,
  /**
   * The `type` recorded when the selector is hidden. Ignored when it is shown.
   *
   * `operational` is what the two place-shaped surfaces pass, because that is
   * what they are: a canonical location and a hotel base are points the fleet
   * operates to and from, not somebody's home or office. Defaults to `other`,
   * which is what they recorded before `operational` existed — a caller that does
   * not say otherwise keeps the old answer rather than silently acquiring a new
   * claim.
   */
  forcedType = "other",
}) {
  const [value, setValue] = useState(initialValue ?? EMPTY_STRUCTURED_ADDRESS);
  const [touched, setTouched] = useState(false);

  // Re-seed when the dialog opens, and when an async-loaded `initialValue`
  // arrives for it. Adjusted DURING RENDER rather than in an effect: an effect
  // would paint one frame of the previous address before correcting itself,
  // which in an edit form reads as the fields flickering to someone else's data.
  const [wasOpen, setWasOpen] = useState(open);
  const [lastInitial, setLastInitial] = useState(initialValue);
  if (wasOpen !== open || lastInitial !== initialValue) {
    setWasOpen(open);
    setLastInitial(initialValue);
    if (open || lastInitial !== initialValue) {
      setValue(initialValue ?? EMPTY_STRUCTURED_ADDRESS);
      setTouched(false);
    }
  }

  // Shared with the cascade through the react-query cache — one request, one
  // answer, so the Save button and the Province field cannot disagree about
  // whether Metro Manila needs a province.
  const requiresProvince = useProvinceRequirement(value.regionCode);

  /**
   * The value the form is actually working with, type included.
   *
   * When the selector is hidden this applies `forcedType` for the WHOLE lifetime
   * of the form, not only at submit — and that is the point, not a convenience.
   * `operational` is the one type that does not require a house number, so a form
   * validating the unforced `home` would demand one the server never asks for:
   * the operator would be shown a required field with nothing to put in it, and
   * Save would stay disabled with no way to satisfy it. Coercing the type at
   * submit (which is all this file used to do) validates against a value the
   * request will not carry — a disagreement that is invisible whenever the two
   * rules happen to match, and only ever surfaces for the one type where they
   * differ.
   */
  const effective = useMemo(
    () => (showTypeSelector ? value : { ...value, type: forcedType }),
    [value, showTypeSelector, forcedType]
  );

  const errors = useMemo(
    () => structuredErrors(effective, { requiresProvince }),
    [effective, requiresProvince]
  );
  const remaining = Object.values(errors);
  const complete = remaining.length === 0;

  // Which detail fields this address must carry — the same rule the validator
  // applies, read from the same function, so the asterisk and the refusal can
  // never name different fields.
  const requiredDetails = useMemo(() => requiredDetailFields(effective), [effective]);
  const isRequired = (field) => requiredDetails.includes(field);

  // Errors appear once the operator has engaged with the form. Seven "required"
  // messages on a form nobody has touched is noise, not help.
  const showErrors = touched || Boolean(value.regionCode);

  /** The one route an address detail takes into state — and the pin's death. */
  function setField(field, next) {
    setTouched(true);
    setValue((previous) => editDetail(previous, field, next));
  }

  /**
   * The address TYPE is set directly rather than through `setField`.
   * Changing what an address is for does not change WHERE it is, so routing it
   * through `editDetail` would throw away a pin that is still perfectly valid —
   * marking a driver's home as also being their office should not cost you the
   * pin you just placed.
   */
  function setType(type) {
    setTouched(true);
    setValue((previous) => ({ ...previous, type }));
  }

  function handleGeography(next) {
    setTouched(true);
    setValue(next);
  }

  function handleSubmit(event) {
    event.preventDefault();
    setTouched(true);
    if (!complete || saving) return;
    // `effective`, not `value`: the type was coerced above and the whole form
    // has been validated against the coerced version. Sending `value` here would
    // reintroduce the exact disagreement `effective` exists to remove.
    // No clearing, no reset: if the server rejects this, the operator's input is
    // still here when the message comes back.
    onSubmit?.(effective);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 p-6 pt-5">
          {/* ── What it is for ─────────────────────────────────────────────── */}
          {showTypeSelector && (
            <div className="space-y-2.5">
              <SectionLabel>Address type</SectionLabel>
              <AddressTypeSelector value={value.type} onChange={setType} disabled={saving} />
            </div>
          )}

          {/* ── Where it is ────────────────────────────────────────────────── */}
          <div className="space-y-2.5">
            <SectionLabel>Location</SectionLabel>
            <LocationCascade
              value={value}
              onChange={handleGeography}
              errors={showErrors ? errors : {}}
              disabled={saving}
            />
          </div>

          {/* ── The street-level detail ────────────────────────────────────── */}
          <div className="space-y-4">
            <SectionLabel>Address details</SectionLabel>

            {/* Short fields paired; long ones full width, which is what the
                width is actually good for. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                field="houseBuildingNumber"
                label="House / Building No."
                icon={Hash}
                // Optional for an operational address, and optional here for the
                // same reason the validator makes it so — see
                // `requiredDetailFields`. The mark follows the rule rather than
                // restating it.
                required={isRequired("houseBuildingNumber")}
                value={value.houseBuildingNumber}
                onValue={(next) => setField("houseBuildingNumber", next)}
                error={showErrors ? errors.houseBuildingNumber : undefined}
                placeholder="8572"
                maxLength={50}
              />
              <TextField
                field="postalCode"
                label="ZIP code"
                icon={MapPin}
                required={isRequired("postalCode")}
                value={value.postalCode}
                onValue={(next) => setField("postalCode", next)}
                // Strip non-digits rather than rejecting them at submit: a pasted
                // "4026 " or "4,026" should just work. The field cannot produce a
                // value its own validator would reject.
                transform={(raw) => raw.replace(/\D/g, "").slice(0, 4)}
                error={showErrors ? errors.postalCode : undefined}
                hint="4 digits"
                placeholder="4026"
                inputMode="numeric"
                maxLength={4}
              />
            </div>

            <TextField
              field="streetRoad"
              label="Street / Road"
              icon={MapPin}
              required={isRequired("streetRoad")}
              value={value.streetRoad}
              onValue={(next) => setField("streetRoad", next)}
              error={showErrors ? errors.streetRoad : undefined}
              placeholder="Winding Creek Boulevard"
              maxLength={200}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                field="unitFloorBuilding"
                label="Unit / Floor / Building"
                icon={Building2}
                value={value.unitFloorBuilding}
                onValue={(next) => setField("unitFloorBuilding", next)}
                placeholder="Unit 4B, 2nd floor"
                maxLength={120}
              />
              <TextField
                field="subdivisionVillage"
                label="Subdivision / Village"
                icon={Warehouse}
                value={value.subdivisionVillage}
                onValue={(next) => setField("subdivisionVillage", next)}
                placeholder="Example Village"
                maxLength={120}
              />
            </div>
          </div>

          {/* ── Delivery notes, kept out of the stored address ─────────────── */}
          <div className="space-y-4">
            <SectionLabel>Delivery notes</SectionLabel>

            <TextField
              field="landmark"
              label="Landmark"
              icon={StickyNote}
              value={value.landmark}
              onValue={(next) => setField("landmark", next)}
              hint="A nearby place a driver would recognise"
              placeholder="Across from the barangay hall"
              maxLength={255}
            />

            <FloatingShell
              icon={FileText}
              label="Additional details"
              hint="Gate colour, floor, who to ask for — instructions, not part of the address"
            >
              <textarea
                id="address-additionalDetails"
                value={value.additionalDetails}
                onChange={(event) => setField("additionalDetails", event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Blue gate, ring the bell on the left"
                className={cn(FLOATING_INPUT_CLASS, "resize-y leading-relaxed")}
              />
            </FloatingShell>
          </div>

          {/* ── The pin, last on purpose ───────────────────────────────────── */}
          {showPinMap && (
            <div className="space-y-2.5">
              <SectionLabel>Map pin</SectionLabel>
              <AddressPinMap
                latitude={value.latitude}
                longitude={value.longitude}
                onChange={({ latitude, longitude }) =>
                  setValue((previous) => ({ ...previous, latitude, longitude }))
                }
              />
            </div>
          )}

          {/* ── What will actually be saved ────────────────────────────────── */}
          <AddressPreview value={effective} />

          {/* The reason Save is disabled, present for exactly as long as it is. */}
          {showErrors && !complete && (
            <div role="status" className="rounded-2xl border border-border bg-muted/20 p-3.5">
              <p className="text-xs font-bold text-foreground-secondary">
                {remaining.length === 1
                  ? "1 required field left"
                  : `${remaining.length} required fields left`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {remaining.map((message) => (
                  <li
                    key={message}
                    className="flex items-center gap-1.5 text-xs text-foreground-muted"
                  >
                    <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          )}

          <DialogFooter className="-mx-6 -mb-6 border-t border-border/60">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange?.(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!complete || saving}>
              {saving ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default AddressFormDialog;
