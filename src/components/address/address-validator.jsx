"use client";

// THE reusable address field. Every address input in the application is this
// component — there is no second implementation, and no per-form address
// validation logic anywhere else.
//
// CONTRACT
// --------
// Controlled: `value` in, `onChange(next)` out. That is deliberately the same
// shape whether the caller uses react-hook-form (`<Controller>`) or a plain
// `useState`, because this repo does both.
//
//   <AddressValidator
//     id="emergency_contact_address"
//     label="Address"
//     value={addressValue}
//     onChange={setAddressValue}
//     autoGeocode={false}   // personal -> opt-in [Verify], typing costs no request
//     showMap
//   />
//
// `value.raw` is the single source of truth for the input text. There is no
// parallel local "query" state, so the field cannot drift out of sync with the
// record it is editing.
//
// THE TWO STATES THAT MUST BE ABLE TO COEXIST
// -------------------------------------------
// "Location verified" and "ZIP code provided" are INDEPENDENT facts. Plenty of
// real Philippine addresses geocode to a confident position with no postal code
// on record, so `✓ Location verified` beside `⚠ ZIP code not provided` is a
// normal, expected rendering — not a contradiction and not a failure. Nothing
// in this component may collapse the two into one "valid/invalid" verdict.
//
// SELECTION IS WHAT VERIFIES
// --------------------------
// Typed text is never verified, no matter how complete it looks. Only choosing
// a suggestion and having the SERVER resolve it produces `verified: true`. Any
// edit to a verified address routes through `invalidateForInput`, which clears
// the coordinate, the components and the verification in the same operation
// that changes the text — so there is no instant in which this form holds new
// text beside an old coordinate.

import { useCallback, useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  BadgeCheck,
  Loader2,
  MapPin,
  Search,
  ShieldQuestion,
  X,
} from "lucide-react";
import { FloatingShell } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { emptyAddressValue } from "@/lib/address/parse";
import { confirmResolved, invalidateForInput } from "@/lib/address/invalidate";
import { useAddressSearch, useDebouncedSearch } from "./use-address-search";

// Leaflet touches `window` at import time, so the preview is client-only —
// the same loading strategy as every other map in this app.
const AddressMapPreview = dynamic(() => import("./address-map-preview"), { ssr: false });

// Matches the input styling used inside FloatingField across the driver forms.
const FLOATING_INPUT_CLASS =
  "w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1 pr-6";

/** One state chip. Icon AND text, always — colour is never the only signal. */
function StatusChip({ tone, icon: Icon, children }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tone === "error" && "border-danger/30 bg-danger/10 text-danger",
        tone === "neutral" && "border-border bg-muted/40 text-foreground-secondary"
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

export function AddressValidator({
  id,
  label = "Address",
  icon = MapPin,
  value,
  onChange,
  required = false,
  error,
  hint,
  disabled = false,
  /** false -> typing makes no network request; a [Verify address] button does. */
  autoGeocode = false,
  showMap = false,
  placeholder = "Search or enter an address",
  variant = "floating",
  className,
}) {
  const reactId = useId();
  const inputId = id || `address-${reactId}`;
  const listboxId = `${inputId}-listbox`;

  const current = value ?? emptyAddressValue();

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState(null);
  // The formatted address a selection produced. Held so the debounced search
  // does not immediately re-fire on the very string the operator just picked
  // out of the list.
  const [selectedRaw, setSelectedRaw] = useState(null);
  const [changedSinceSelection, setChangedSinceSelection] = useState(false);

  const { suggestions, searching, error: searchError, run, reset } = useAddressSearch({
    live: autoGeocode,
  });

  useDebouncedSearch(current.raw, autoGeocode, run, selectedRaw);

  const showListbox = open && suggestions.length > 0 && !disabled;

  // Reset the keyboard cursor whenever the list itself changes, so Enter can
  // never select an option that belongs to a previous keystroke's results.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component before committing, so a stale index is never painted and no extra
  // render pass is spent on it. An effect here would set state synchronously
  // and cascade a second render for every keystroke.
  const [lastSuggestions, setLastSuggestions] = useState(suggestions);
  if (lastSuggestions !== suggestions) {
    setLastSuggestions(suggestions);
    setActiveIndex(-1);
  }

  const handleInputChange = useCallback(
    (event) => {
      const text = event.target.value;
      // Anything the previous selection contributed is stale the moment the
      // text changes. `invalidateForInput` is the single definition of that.
      if (current.verified || current.providerPlaceId) setChangedSinceSelection(true);
      setSelectedRaw(null);
      setOpen(false);
      setGeocodeError(null);
      onChange(invalidateForInput(current, text));
    },
    [current, onChange]
  );

  const select = useCallback(
    async (suggestion) => {
      setOpen(false);
      setActiveIndex(-1);
      setGeocoding(true);
      setGeocodeError(null);

      try {
        const params = new URLSearchParams({ place_id: suggestion.placeId });
        // Carry the typed text through so the stored record keeps what the
        // operator actually entered, not only the provider's rendering.
        if (current.raw) params.set("q", current.raw);

        const response = await fetch(`/api/address/geocode?${params.toString()}`);
        if (!response.ok) throw new Error(`geocode failed (${response.status})`);
        const payload = await response.json();
        if (!payload?.address) throw new Error("no address in response");

        setSelectedRaw(payload.address.formattedAddress);
        setChangedSinceSelection(false);
        onChange(confirmResolved(payload.address));
      } catch {
        // The provider failing is not "no such address" — say which happened.
        setGeocodeError("Could not verify that location. Try again, or choose another result.");
      } finally {
        setGeocoding(false);
      }
    },
    [current.raw, onChange]
  );

  const clear = useCallback(() => {
    setSelectedRaw(null);
    setChangedSinceSelection(false);
    setGeocodeError(null);
    setOpen(false);
    reset();
    onChange(emptyAddressValue(""));
  }, [onChange, reset]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        setActiveIndex(-1);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!suggestions.length) return;
        event.preventDefault();
        setOpen(true);
        setActiveIndex((index) => {
          const next = event.key === "ArrowDown" ? index + 1 : index - 1;
          if (next < 0) return suggestions.length - 1;
          if (next >= suggestions.length) return 0;
          return next;
        });
        return;
      }
      if (event.key === "Enter" && showListbox && activeIndex >= 0) {
        // Only swallow Enter when it is actually choosing an option — otherwise
        // it must still submit the surrounding form.
        event.preventDefault();
        select(suggestions[activeIndex]);
      }
    },
    [activeIndex, select, showListbox, suggestions]
  );

  const handleVerifyClick = useCallback(() => {
    if (!current.raw) return;
    run(current.raw);
  }, [current.raw, run]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const busy = searching || geocoding;
  const hasText = Boolean(String(current.raw ?? "").trim());

  const status = useMemo(() => {
    if (busy) return "searching";
    if (geocodeError || searchError) return "error";
    if (current.verified) return "verified";
    if (changedSinceSelection && hasText) return "changed";
    if (hasText) return "unverified";
    return "empty";
  }, [busy, changedSinceSelection, current.verified, geocodeError, hasText, searchError]);

  // ZIP presence is a separate axis from location verification — both chips can
  // render at once, and often should.
  const hasCoordinate = current.latitude !== null && current.longitude !== null;

  const inputProps = {
    id: inputId,
    type: "text",
    value: current.raw ?? "",
    onChange: handleInputChange,
    onKeyDown: handleKeyDown,
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    disabled,
    placeholder,
    autoComplete: "off",
    role: "combobox",
    "aria-expanded": showListbox,
    "aria-controls": listboxId,
    "aria-autocomplete": "list",
    "aria-activedescendant":
      showListbox && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined,
    "aria-invalid": Boolean(error),
  };

  const listbox = showListbox ? (
    <ul
      id={listboxId}
      role="listbox"
      aria-label={`Address suggestions for ${label}`}
      // z-50 so a dialog or sticky action bar can never paint over it.
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={suggestion.placeId}
          id={`${listboxId}-option-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          // onMouseDown + preventDefault, so the input never blurs (which would
          // close the list) before the click registers.
          onMouseDown={(event) => {
            event.preventDefault();
            select(suggestion);
          }}
          onMouseEnter={() => setActiveIndex(index)}
          className={cn(
            "cursor-pointer px-3 py-2 text-xs",
            index === activeIndex ? "bg-primary/10 text-foreground" : "text-foreground-secondary"
          )}
        >
          <span className="block font-semibold text-foreground">{suggestion.label}</span>
          {suggestion.secondary ? (
            <span className="mt-0.5 block text-[11px] text-foreground-muted">
              {suggestion.secondary}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  ) : null;

  const clearButton =
    hasText && !disabled ? (
      <button
        type="button"
        onClick={clear}
        aria-label={`Clear ${label}`}
        className="text-foreground-muted transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    ) : null;

  const meta = (
    <div className="mt-1.5 space-y-2 px-1">
      {/* aria-live so each state change is announced, rather than relying on the
          operator noticing a colour shift. */}
      <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
        {status === "searching" && (
          <StatusChip tone="neutral" icon={Loader2}>
            Searching locations…
          </StatusChip>
        )}
        {status === "verified" && (
          <StatusChip tone="ok" icon={BadgeCheck}>
            Location verified
          </StatusChip>
        )}
        {status === "unverified" && (
          <StatusChip tone="warn" icon={ShieldQuestion}>
            Address could not be verified
          </StatusChip>
        )}
        {status === "changed" && (
          <StatusChip tone="warn" icon={ShieldQuestion}>
            Address changed. Please select a location again.
          </StatusChip>
        )}
        {status === "error" && (
          <StatusChip tone="error" icon={AlertCircle}>
            Unable to validate location. Try again.
          </StatusChip>
        )}

        {current.postalCode ? (
          <StatusChip tone={current.postalCodeUnconfirmed ? "warn" : "neutral"} icon={MapPin}>
            {current.postalCodeUnconfirmed
              ? `Confirm ZIP for the new address: ${current.postalCode}`
              : `ZIP Code: ${current.postalCode}`}
          </StatusChip>
        ) : (
          status === "verified" && (
            <StatusChip tone="warn" icon={AlertCircle}>
              ZIP code not provided
            </StatusChip>
          )
        )}
      </div>

      {geocodeError ? <p className="text-[11px] font-medium text-danger">{geocodeError}</p> : null}

      {/* Personal addresses only: the explicit, opt-in verification action.
          Operational fields geocode as you type and never show this. */}
      {!autoGeocode && !disabled && hasText && !current.verified ? (
        <button
          type="button"
          onClick={handleVerifyClick}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          {busy ? "Verifying…" : "Verify address"}
        </button>
      ) : null}

      {showMap && hasCoordinate ? (
        <AddressMapPreview
          latitude={current.latitude}
          longitude={current.longitude}
          label={current.formattedAddress || current.raw}
        />
      ) : null}
    </div>
  );

  // The two visual languages this app already has. Only the chrome differs —
  // every behaviour above is shared, which is the point of the component.
  if (variant === "plain") {
    return (
      <div className={cn("space-y-1.5", className)}>
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        <div className="relative">
          {/* Input's own `invalid` drives aria-invalid and the red ring. */}
          <Input {...inputProps} invalid={Boolean(error)} className="pr-9" />
          {listbox}
          {clearButton ? (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">{clearButton}</div>
          ) : null}
        </div>
        {hint && <p className="text-xs text-foreground-muted">{hint}</p>}
        {error && (
          <p className="flex items-center gap-1 text-xs font-medium text-danger">
            <AlertCircle className="h-3 w-3 shrink-0" /> {error}
          </p>
        )}
        {meta}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* FloatingShell renders the label, hint and error; `pr-6` on the input
          leaves room for the clear button beneath them. */}
      <FloatingShell icon={icon} label={label} required={required} error={error} hint={hint}>
        <div className="relative w-full pt-1">
          <input {...inputProps} className={FLOATING_INPUT_CLASS} />
          {listbox}
          {clearButton ? (
            <div className="absolute right-0 top-1/2 -translate-y-1/2">{clearButton}</div>
          ) : null}
        </div>
      </FloatingShell>
      {meta}
    </div>
  );
}

export default AddressValidator;
