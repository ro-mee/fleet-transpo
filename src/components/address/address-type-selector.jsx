"use client";

import { useRef } from "react";
import { Building2, Home, MapPin } from "lucide-react";
import { ADDRESS_TYPES } from "@/lib/address/structured";
import { cn } from "@/lib/utils";

// What the address is for. A single choice, so it is a radiogroup rather than a
// row of buttons — `aria-checked` and arrow-key navigation are then free, and a
// screen reader announces it as the set of options it actually is instead of
// three unrelated buttons.
//
// Icons are paired with text rather than replacing it. An icon alone ("Home",
// "Office", "Other") is a guess the operator has to make, and these three are
// distinguished by meaning, not by shape.

const ICONS = { home: Home, office: Building2, other: MapPin };

export function AddressTypeSelector({ value, onChange, disabled = false, className }) {
  const refs = useRef({});

  function focusAndSelect(index) {
    const next = ADDRESS_TYPES[(index + ADDRESS_TYPES.length) % ADDRESS_TYPES.length];
    onChange?.(next.value);
    refs.current[next.value]?.focus();
  }

  function handleKeyDown(event, index) {
    // Arrow keys move AND select, which is the radiogroup convention — a radio
    // group has no separate "focused but unselected" state to move through.
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusAndSelect(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusAndSelect(index - 1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Address type"
      className={cn("grid grid-cols-3 gap-2", className)}
    >
      {ADDRESS_TYPES.map((type, index) => {
        const Icon = ICONS[type.value] ?? MapPin;
        const selected = value === type.value;

        return (
          <button
            key={type.value}
            ref={(node) => {
              refs.current[type.value] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: the group is one tab stop, and the arrow keys move
            // within it. Every button being tabbable would make Tab three stops
            // for one decision.
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange?.(type.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-center transition-colors",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-primary bg-primary-bg text-primary"
                : "border-border bg-surface text-foreground hover:bg-hover"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-bold">{type.label}</span>
          </button>
        );
      })}
    </div>
  );
}
