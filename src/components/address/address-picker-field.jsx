"use client";

// A read-only address display with a button that opens the cascade.
//
// WHY THIS IS A COMPONENT RATHER THAN FOUR MORE COPIES
// ----------------------------------------------------
// The block first appeared on the canonical-location form, where it is written
// inline. The driver surface needs the same block four times — a residential and
// an emergency-contact address, each on the create and the edit page — and a
// fifth copy is where one of them quietly stops matching the others. Same
// reasoning that produced `src/lib/address/picked.js` on the server side: at six
// copies, the rule stops being one rule.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// It does not hold the picked value in form state, and it does not know how the
// page submits it. The pages keep the pick in their own `useState` and send it
// as `structured_address` / `emergency_structured_address` ONLY when one is in
// hand — so omitting it leaves both the stored text and the registry row alone.
// That rule lives in the page, next to the payload it shapes, because a
// component that decided it could not be overridden by a caller that needs the
// other behaviour.
//
// It does not offer a text input, and that is the whole point: an address typed
// by hand has no barangay code, so nothing can check it against the PSGC
// hierarchy and nothing downstream can re-resolve it. What it displays instead
// is the address already on the record — the mirrored composed value, or legacy
// free text that predates the cascade — and it says which of the two it is.

import { useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatStructuredAddress } from "@/lib/address/structured";
import { AddressFormDialog } from "./address-form-dialog";

/**
 * @param {object} props
 * @param {string} props.id          DOM id; the label points at the button
 * @param {string} props.label
 * @param {object|null} props.value  the pick in hand, or null
 * @param {(next: object|null) => void} props.onChange
 * @param {string} [props.stored]    text already on the record, shown unpicked
 * @param {string} [props.dialogTitle]
 * @param {string} [props.dialogDescription]
 * @param {"home"|"office"|"operational"|"other"} [props.forcedType]
 * @param {boolean} [props.showPinMap]
 * @param {boolean} [props.disabled]
 */
export function AddressPickerField({
  id,
  label,
  value,
  onChange,
  stored = "",
  dialogTitle,
  dialogDescription,
  submitLabel = "Use this address",
  forcedType = "home",
  showPinMap = true,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const display = value ? formatStructuredAddress(value) : stored;

  return (
    <div className="space-y-1.5">
      {/* `htmlFor` points at the button, not at a text box: a `<label>` with
          nothing to label is announced as an orphan, and the button is the only
          control in this field. */}
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-start gap-2">
        <div className="min-h-10 flex-1 rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
          {display ? (
            <p className="text-xs font-semibold leading-relaxed text-foreground-secondary">
              {display}
            </p>
          ) : (
            <p className="text-xs text-foreground-muted">No address picked yet.</p>
          )}
        </div>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="h-10 shrink-0"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <MapPin className="mr-1.5 h-4 w-4" />
          {display ? "Replace address" : "Pick address"}
        </Button>
      </div>

      {value && (
        <p className="text-xs text-success-700">
          Picked from the Philippine address cascade. Saving records it as the structured address
          for this field.
        </p>
      )}
      {!value && display && (
        <p className="text-xs text-foreground-muted">
          Shown as stored. This box is read-only — picking an address replaces it with one the
          server can check against the PSGC hierarchy.
        </p>
      )}

      {/* `initialValue` is the pick in hand, so reopening after a change starts
          from what was chosen rather than from blank. The stored text is never
          fed in: reconstructing a barangay code from stored text is the fuzzy
          name match this design refuses, so an existing address is shown
          read-only and is replaced rather than edited. */}
      <AddressFormDialog
        open={open}
        onOpenChange={setOpen}
        initialValue={value ?? undefined}
        showTypeSelector={false}
        forcedType={forcedType}
        showPinMap={showPinMap}
        title={dialogTitle ?? (value ? "Replace address" : "Pick address")}
        description={
          dialogDescription ??
          "Choose the region, province, city or municipality, and barangay, then add the street detail. The full hierarchy is resolved by the server when you save."
        }
        submitLabel={submitLabel}
        onSubmit={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </div>
  );
}

export default AddressPickerField;
