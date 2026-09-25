"use client";

import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FloatingShell } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

// A type-to-filter single-select, built on the primitives this repo already has.
//
// WHY NOT THE EXISTING Select
// ---------------------------
// `src/components/ui/select.jsx` wraps Radix Select, which filters by FIRST LETTER
// typeahead only. That is fine for a list of 17 regions and unusable for a list of
// barangays, where the operator knows the name they want and needs to jump to it.
//
// WHY NOT A NEW DEPENDENCY
// ------------------------
// `cmdk` is not installed, and adding a package to get a filter box over an array
// is not a trade this repo needs to make. The filtering idiom is copied from
// `command-palette.jsx` — `useDeferredValue` rather than a debounce timer, so
// typing stays instant and the filtered list lags one render behind instead of
// firing on a timer. There is no network call here at all: the parent loads one
// level per selection, so this filters an array that is already in memory.
//
// KEYBOARD
// --------
// ↑↓ move, Home/End jump, Enter selects, Esc closes, and focus returns to the
// trigger on close (Radix does that last part). The trigger is a real
// `role="combobox"` button carrying `aria-expanded` / `aria-controls`, and the
// active option is named by `aria-activedescendant` so a screen reader announces
// the highlight without focus leaving the search field.

/** Case- and accent-insensitive enough for Philippine place names. */
function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    // Strip diacritics so "Peña" matches "pena" — several Philippine place names
    // carry a ñ and operators will not type it.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function SearchableSelect({
  id,
  label,
  icon: Icon,
  value,
  onChange,
  options = [],
  /** The display text for `value` when it is not in `options`. The edit case: an
   *  address arrives with a stored code and its stored name, and the option list
   *  for that level has not loaded yet. Without this the field reads as empty and
   *  a saved address looks like it lost its region. */
  valueLabel,
  disabled = false,
  loading = false,
  required = false,
  error,
  hint,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  loadingMessage = "Loading…",
  emptyMessage = "No matches",
  /** Names the covering reason when the list is empty — e.g. "No barangays are
   *  loaded for this city yet", so the operator is not left guessing whether the
   *  data is missing or their filter is too narrow. */
  emptyDescription,
  className,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef(null);

  // Called unconditionally: `id ?? useId()` would short-circuit the hook whenever a
  // caller passes an `id`, which changes the hook order between renders and breaks
  // the component for every caller that supplies one.
  const generatedId = useId();
  const listId = `${id ?? generatedId}-listbox`;
  const deferredQuery = useDeferredValue(query);

  // Reset the highlight when the filter changes — adjusted DURING RENDER rather
  // than in an effect, which is this repo's pattern for derived-state resets and
  // avoids the extra render pass (and the react-hooks/set-state-in-effect lint).
  const [lastQuery, setLastQuery] = useState(deferredQuery);
  if (lastQuery !== deferredQuery) {
    setLastQuery(deferredQuery);
    setActiveIndex(0);
  }

  const filtered = useMemo(() => {
    const needle = normalize(deferredQuery);
    if (!needle) return options;
    return options.filter((option) => normalize(option.name).includes(needle));
  }, [options, deferredQuery]);

  // Clamped rather than stored, so a filter that shortens the list can never leave
  // the highlight pointing past the end.
  const active = Math.min(activeIndex, Math.max(filtered.length - 1, 0));
  // Falls back to the stored label only when the option list does not have the
  // code — during a load, or for a code the live geography no longer contains.
  const selected =
    options.find((option) => option.code === value) ??
    (value && valueLabel ? { code: value, name: valueLabel } : null);

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function commit(option) {
    onChange?.(option.code, option);
    handleOpenChange(false);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(active + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(active - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(filtered.length - 1, 0));
    } else if (event.key === "Enter") {
      // preventDefault so Enter selects rather than submitting the surrounding
      // form — without this, picking a barangay would save the whole address.
      event.preventDefault();
      if (filtered[active]) commit(filtered[active]);
    }
  }

  const showEmpty = !loading && filtered.length === 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <FloatingShell icon={Icon} label={label} required={required} error={error} hint={hint} className={className}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-haspopup="listbox"
            aria-invalid={error ? true : undefined}
            disabled={disabled || loading}
            className={cn(
              // The floating shell's own type scale, so a combobox and a text
              // input sitting in the same grid line up.
              "flex w-full items-center gap-2 bg-transparent py-1 pr-6 text-left text-xs font-semibold text-foreground outline-hidden",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            <span className={cn("flex-1 truncate", !selected && "font-normal text-foreground-muted/60")}>
              {selected ? selected.name : placeholder}
            </span>
            {loading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-foreground-muted" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden="true" />
            )}
          </button>
        </PopoverTrigger>
      </FloatingShell>

      <PopoverContent
        align="start"
        sideOffset={6}
        // The search field, not the content, should hold focus on open.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            role="searchbox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            aria-label={`Search ${label}`}
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-option-${active}` : undefined}
            className="w-full bg-transparent text-sm text-foreground outline-hidden placeholder:text-foreground-muted/60"
          />
        </div>

        {loading ? (
          <p className="px-3 py-4 text-center text-xs text-foreground-muted">{loadingMessage}</p>
        ) : showEmpty ? (
          <EmptyState
            size="compact"
            variant="filtered"
            title={emptyMessage}
            description={
              deferredQuery
                ? `Nothing matches “${deferredQuery}”. Try a shorter search.`
                : emptyDescription
            }
            className="px-4 py-6"
          />
        ) : (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="custom-scrollbar max-h-64 overflow-y-auto p-1.5"
          >
            {filtered.map((option, index) => {
              const isSelected = option.code === value;
              const isActive = index === active;
              return (
                <li
                  key={option.code}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  // onMouseDown rather than onClick: the search input blurs on
                  // mousedown, and Radix closes the popover on that blur before a
                  // click could land.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(option);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold transition-colors",
                    isActive ? "bg-hover text-primary" : "text-foreground"
                  )}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary stroke-[2.5]" aria-hidden="true" />}
                  </span>
                  <span className="truncate">{option.name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
