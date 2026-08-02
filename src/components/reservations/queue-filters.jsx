"use client";

import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { RESERVATION_LIFECYCLE as L, RESERVATION_PRIORITY as P } from "@/lib/constants";
import { getVehicleCategories } from "@/services/vehicle.service";
import { Search, X } from "lucide-react";

// The queue's filter surface. Every control maps 1:1 onto a query param the list
// GET already understands (see api/integration/transport-requests/route.js), so
// filtering is server-side — the page never holds a full unfiltered list in
// memory and paging can be added later without touching this file.
//
// ANY is a sentinel rather than "": Radix Select treats an empty string value as
// "no selection" and refuses to render the item, and buildQuery() drops ""
// anyway. Mapping ANY -> undefined at the page boundary keeps both happy.
export const ANY = "any";

export const EMPTY_FILTERS = {
  search: "",
  fleet_status: ANY,
  priority: ANY,
  requested_category_id: ANY,
  pickup_date: "",
  has_vehicle: ANY,
  has_driver: ANY,
};

/** True when anything is narrowing the list — drives the Clear button. */
export function hasActiveFilters(filters) {
  return Object.entries(filters).some(([key, value]) => value !== EMPTY_FILTERS[key]);
}

/** Translate UI state into the query params the list GET accepts. */
export function toQueryParams(filters) {
  const out = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === "" || value === ANY || value == null) continue;
    out[key] = value;
  }
  return out;
}

function FilterSelect({ label, value, onChange, options, placeholder }) {
  return (
    <div className="min-w-0">
      <label className="text-xs font-medium text-foreground-secondary">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1 h-9">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function QueueFilters({ filters, onChange, resultCount, isFetching }) {
  const set = (key) => (value) => onChange({ ...filters, [key]: value });

  // The vehicle-class options come from the database, not a constant, because
  // categories are user-editable (api/vehicle-categories). Fetched here rather
  // than by the page so the filter surface owns its own vocabulary. A failure
  // degrades to "Any class" only — the rest of the filters keep working.
  const { data: categories = [] } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: () => getVehicleCategories(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-foreground-muted"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            placeholder="Search reservation number, guest, booking ref, location, plate, or driver…"
            value={filters.search}
            onChange={(e) => set("search")(e.target.value)}
            aria-label="Search the request queue"
          />
        </div>
        {hasActiveFilters(filters) && (
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
            <X className="w-3.5 h-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <FilterSelect
          label="Status"
          value={filters.fleet_status}
          onChange={set("fleet_status")}
          placeholder="Any status"
          options={[
            { value: ANY, label: "Any status" },
            ...Object.values(L).map((s) => ({ value: s, label: s })),
          ]}
        />
        <FilterSelect
          label="Priority"
          value={filters.priority}
          onChange={set("priority")}
          placeholder="Any priority"
          options={[
            { value: ANY, label: "Any priority" },
            ...Object.values(P).map((p) => ({ value: p, label: p })),
          ]}
        />
        {/* Vehicle class, as the resolved category rather than free text.
            This used to be a text input over requested_vehicle_type — Booking's
            raw wording. That no longer matches what the queue displays: a card
            shows "VIP Guest Transport" while the raw string behind it is
            "Executive SUV", so typing what you saw returned nothing. Filtering on
            the resolved category_id makes the control agree with the cards, and
            it is a closed set, so a dropdown is the honest shape for it. */}
        <FilterSelect
          label="Vehicle Class"
          value={filters.requested_category_id}
          onChange={set("requested_category_id")}
          placeholder="Any class"
          options={[
            { value: ANY, label: "Any class" },
            ...categories.map((c) => ({ value: String(c.category_id), label: c.category_name })),
          ]}
        />
        <div className="min-w-0">
          <label className="text-xs font-medium text-foreground-secondary" htmlFor="q-pickup-date">
            Pickup Date
          </label>
          <Input
            id="q-pickup-date"
            type="date"
            className="mt-1 h-9"
            value={filters.pickup_date}
            onChange={(e) => set("pickup_date")(e.target.value)}
          />
        </div>
        <FilterSelect
          label="Vehicle"
          value={filters.has_vehicle}
          onChange={set("has_vehicle")}
          placeholder="Any"
          options={[
            { value: ANY, label: "Any" },
            { value: "true", label: "Assigned" },
            { value: "false", label: "Unassigned" },
          ]}
        />
        <FilterSelect
          label="Driver"
          value={filters.has_driver}
          onChange={set("has_driver")}
          placeholder="Any"
          options={[
            { value: ANY, label: "Any" },
            { value: "true", label: "Assigned" },
            { value: "false", label: "Unassigned" },
          ]}
        />
      </div>

      {resultCount != null && (
        <p className="mt-3 text-xs text-foreground-muted" aria-live="polite">
          {resultCount} request{resultCount === 1 ? "" : "s"}
          {isFetching && " · refreshing…"}
        </p>
      )}
    </div>
  );
}
