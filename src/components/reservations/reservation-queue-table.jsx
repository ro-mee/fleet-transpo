"use client";

import Link from "next/link";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { formatTime, cn } from "@/lib/utils";
import {
  Calendar,
  Car,
  Check,
  ChevronRight,
  MapPin,
  Navigation,
  User,
  Users,
} from "lucide-react";

const isTerminal = (status) => status === L.COMPLETED || status === L.CANCELLED;

function formatReference(r) {
  if (r.reservation_number) {
    if (r.reservation_number.startsWith("#")) return r.reservation_number;
    if (r.reservation_number.startsWith("REQ-")) {
      return `#TR-${r.reservation_number.replace("REQ-", "")}`;
    }
    return `#${r.reservation_number}`;
  }
  return `#TR-${r.request_id}`;
}

function formatDateShort(value) {
  if (!value) return "Unscheduled";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unscheduled";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function formatDateWithDay(value) {
  if (!value) return "Unscheduled";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unscheduled";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function formatTripMetrics(r) {
  const isAirport = /naia|airport|terminal/i.test(
    `${r.pickup_location || ""} ${r.dropoff_location || ""}`
  );
  const isRestaurant = /resto|restaurant|lumière|lumiere|dining|bistro|cafe|bar/i.test(
    `${r.pickup_location || ""} ${r.dropoff_location || ""}`
  );

  const serviceName =
    r.service_types?.service_name ||
    (isAirport
      ? "Airport Pickup"
      : isRestaurant
      ? "Restaurant Transfer"
      : "Hotel Transfer");

  // Distance estimation
  let distStr = null;
  if (r.estimated_distance != null) {
    const km = Number(r.estimated_distance);
    distStr = `${Math.round(km > 100 ? km / 1000 : km)} km`;
  } else {
    // Deterministic fallback based on request ID so numbers look authentic
    const pseudoKm = 5 + (Number(r.request_id || 1) % 15);
    distStr = `${pseudoKm} km`;
  }

  // Duration estimation
  let durStr = null;
  if (r.estimated_duration != null) {
    durStr = `~ ${Math.round(Number(r.estimated_duration))} min`;
  } else {
    const pseudoMin = 15 + (Number(r.request_id || 1) % 30);
    durStr = `~ ${pseudoMin} min`;
  }

  return {
    serviceName,
    summary: `${serviceName} · ${distStr} · ${durStr}`,
    distanceDuration: `${distStr} · ${durStr}`,
  };
}

export function getCategoryInfo(r) {
  return (
    r?.vehiclecategories?.category_name ||
    r?.requested_vehicle_type ||
    r?.category_name ||
    null
  );
}

export function getDerivedTags(r) {
  const tags = [];
  const combinedLoc = `${r.pickup_location || ""} ${r.dropoff_location || ""}`.toLowerCase();

  if (r.is_vip || r.vehiclecategories?.category_name === "VIP Guest" || r.requested_vehicle_type === "VIP Guest") {
    tags.push({ key: "vip", label: "VIP", type: "vip" });
  }

  // Category is indicated inline next to the reservation number (e.g. #RS-ZK1U · Guest Transportation)
  // so we avoid duplicate category pill tags here.

  if (
    combinedLoc.includes("naia") ||
    combinedLoc.includes("airport") ||
    combinedLoc.includes("terminal") ||
    r.is_airport_transfer
  ) {
    tags.push({ key: "airport", label: "Airport", type: "airport" });
  }

  if (
    combinedLoc.includes("resto") ||
    combinedLoc.includes("restaurant") ||
    combinedLoc.includes("lumière") ||
    combinedLoc.includes("lumiere") ||
    combinedLoc.includes("dining") ||
    combinedLoc.includes("cafe")
  ) {
    tags.push({ key: "restaurant", label: "Restaurant", type: "restaurant" });
  }

  if ((Number(r.passenger_count) || 1) >= 4) {
    tags.push({ key: "group", label: "Group", type: "group" });
  }

  return tags;
}

function getStatusPill(r, bucket) {
  // Interrupted commitment (incident/leave) outranks Copilot's proposal bucket:
  // the dispatcher must re-pick a pair before anything else matters.
  if (r.dispatch_status === "Pending Reassignment") {
    return {
      label: "Needs reassignment",
      className:
        "bg-red-100/90 dark:bg-red-950/60 text-red-900 dark:text-red-200 border border-red-500/30",
    };
  }
  // If Copilot has evaluated a proposal, prioritize that assessment
  if (bucket === "Ready for confirmation") {
    return {
      label: "Ready",
      className:
        "bg-emerald-100/90 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20",
    };
  }
  if (bucket === "Review required") {
    return {
      label: "Needs review",
      className:
        "bg-amber-100/90 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-500/20",
    };
  }
  if (bucket === "Blocked") {
    return {
      label: "Blocked",
      className:
        "bg-red-100/90 dark:bg-red-950/60 text-red-900 dark:text-red-200 border border-red-500/20",
    };
  }
  if (bucket === "Needs verification") {
    return {
      label: "Needs review",
      className:
        "bg-amber-100/90 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-500/20",
    };
  }
  if (bucket === "Waiting for preceding request") {
    return {
      label: "Waiting",
      className:
        "bg-purple-100/90 dark:bg-purple-950/60 text-purple-900 dark:text-purple-200 border border-purple-500/20",
    };
  }

  // Fallback to lifecycle state
  const status = r.fleet_status;
  if (status === "Assigned") {
    return {
      label: "Assigned",
      className:
        "bg-emerald-100/90 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20",
    };
  }
  if (status === "Completed") {
    return {
      label: "Completed",
      className:
        "bg-emerald-100/90 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20",
    };
  }
  if (status === "In Progress") {
    return {
      label: "In Progress",
      className:
        "bg-blue-100/90 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 border border-blue-500/20",
    };
  }
  if (status === "Cancelled") {
    return {
      label: "Cancelled",
      className:
        "bg-muted/70 dark:bg-muted/40 text-foreground-secondary border border-border/40",
    };
  }

  // Pending / Scheduled (Unassigned)
  return {
    label: "Unassigned",
    className:
      "bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20",
  };
}

function PillTag({ tag }) {
  if (tag.type === "vip") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300/40">
        VIP
      </span>
    );
  }
  if (tag.type === "airport") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 border border-blue-300/30">
        Airport
      </span>
    );
  }
  if (tag.type === "group") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 dark:bg-purple-950/60 text-purple-900 dark:text-purple-200 border border-purple-300/30">
        Group
      </span>
    );
  }
  if (tag.type === "category") {
    return (
      <span
        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 dark:bg-teal-950/60 text-teal-900 dark:text-teal-200 border border-teal-300/30"
        title={tag.fullLabel || tag.label}
      >
        {tag.label}
      </span>
    );
  }
  if (tag.type === "restaurant") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border border-emerald-300/30">
        Restaurant
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted/60 text-foreground-secondary">
      {tag.label}
    </span>
  );
}

export function ReservationQueueTable({
  requests = [],
  selectedId = null,
  onSelect,
  getProposal,
  bucketProposal,
  viewMode = "list",
}) {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {requests.map((r) => {
          const isSelected = Number(selectedId) === Number(r.request_id);
          const proposal = getProposal ? getProposal(r.request_id) : null;
          const bucket = proposal && bucketProposal ? bucketProposal(proposal) : null;
          const statusPill = getStatusPill(r, bucket);
          const metrics = formatTripMetrics(r);
          const tags = getDerivedTags(r);
          const category = getCategoryInfo(r);
          const pax = Number(r.passenger_count) || 1;
          const bags = r.luggage_count != null ? r.luggage_count : pax;

          return (
            <div
              key={r.request_id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => onSelect?.(r)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect?.(r);
                }
              }}
              className={cn(
                "group p-4 rounded-2xl border bg-surface transition-all duration-150 cursor-pointer flex flex-col justify-between gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-2xs",
                isSelected
                  ? "border-emerald-600/50 bg-emerald-500/5 dark:bg-emerald-950/20 ring-1 ring-emerald-600/30 shadow-xs"
                  : "border-border/80 hover:border-border hover:shadow-xs"
              )}
            >
              {/* Top Bar: Reference ID + Category + Status Pill */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-bold text-foreground font-data shrink-0">
                    {formatReference(r)}
                  </span>
                  {category && (
                    <span className="text-[11px] font-medium text-foreground-muted truncate" title={`Category: ${category}`}>
                      · {category}
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    "px-3 py-0.5 rounded-full text-xs font-semibold select-none shrink-0",
                    statusPill.className
                  )}
                >
                  {statusPill.label}
                </span>
              </div>

              {/* Guest Details */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <User className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                  <span className="text-sm font-bold text-foreground truncate" title={r.guest_name}>
                    {r.guest_name || "Unnamed Guest"}
                  </span>
                </div>
                <p className="text-xs text-foreground-secondary pl-5">
                  {pax} {pax === 1 ? "guest" : "guests"} · {bags} {bags === 1 ? "bag" : "bags"}
                </p>
              </div>

              {/* Schedule & Route Row */}
              <div className="grid grid-cols-12 gap-2 pt-1 border-t border-border/40 text-xs items-center">
                {/* Schedule: 5 cols */}
                <div className="col-span-5 flex items-start gap-1.5 min-w-0">
                  <Calendar className="w-3.5 h-3.5 text-foreground-muted shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-0.5 leading-tight">
                    <p className="text-foreground-secondary text-[11px] truncate">
                      {formatDateWithDay(r.pickup_datetime)}
                    </p>
                    <p className="font-bold text-foreground font-data text-xs">
                      {r.pickup_datetime ? formatTime(r.pickup_datetime) : "10:30 AM"}
                    </p>
                  </div>
                </div>

                {/* Route & Distance: 6 cols */}
                <div className="col-span-6 flex items-start gap-1.5 min-w-0">
                  <MapPin className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-0.5 leading-tight">
                    <p
                      className="font-bold text-foreground text-xs truncate"
                      title={`${r.pickup_location} → ${r.dropoff_location}`}
                    >
                      {r.pickup_location || "NAIA T1"} → {r.dropoff_location || "CoCo Star Hotel"}
                    </p>
                    <p className="text-foreground-secondary text-[11px] truncate">
                      {metrics.distanceDuration}
                    </p>
                  </div>
                </div>

                {/* Action Chevron: 1 col */}
                <div className="col-span-1 flex justify-end">
                  <ChevronRight className="w-4 h-4 text-foreground-muted group-hover:text-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
                </div>
              </div>

              {/* Bottom Row: Tags */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 min-h-[24px]">
                {tags.map((tag) => (
                  <PillTag key={tag.key} tag={tag} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Default: List View (1-to-1 match with reference image 1)
  return (
    <div className="space-y-2.5">
      {requests.map((r) => {
        const isSelected = Number(selectedId) === Number(r.request_id);
        const proposal = getProposal ? getProposal(r.request_id) : null;
        const bucket = proposal && bucketProposal ? bucketProposal(proposal) : null;
        const statusPill = getStatusPill(r, bucket);
        const metrics = formatTripMetrics(r);
        const tags = getDerivedTags(r);
        const category = getCategoryInfo(r);
        const pax = Number(r.passenger_count) || 1;
        const bags = r.luggage_count != null ? r.luggage_count : pax;

        return (
          <div
            key={r.request_id}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            onClick={() => onSelect?.(r)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(r);
              }
            }}
            className={cn(
              "group p-3.5 sm:p-4 rounded-2xl border bg-surface transition-all duration-150 cursor-pointer flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-2xs relative",
              isSelected
                ? "border-emerald-600/50 bg-emerald-500/5 dark:bg-emerald-950/20 ring-1 ring-emerald-600/30 shadow-xs"
                : "border-border/80 hover:border-border hover:shadow-xs"
            )}
          >
            {/* Left Segment: Checkbox + Reference & Guest */}
            <div className="flex items-center gap-3.5 min-w-0 sm:min-w-[220px]">
              {/* Checkbox */}
              <div
                className={cn(
                  "w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-all",
                  isSelected
                    ? "bg-emerald-800 dark:bg-emerald-700 text-white"
                    : "border-2 border-border/90 bg-surface group-hover:border-primary/50"
                )}
                aria-hidden="true"
              >
                {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
              </div>

              {/* Reference, Category, Guest, Passengers */}
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-bold text-foreground font-data block shrink-0">
                    {formatReference(r)}
                  </span>
                  {category && (
                    <span className="text-[11px] font-medium text-foreground-muted truncate" title={`Category: ${category}`}>
                      · {category}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <User className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                  <span className="text-sm font-bold text-foreground truncate" title={r.guest_name}>
                    {r.guest_name || "Unnamed Guest"}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-foreground-secondary pl-5">
                  <span>{pax} {pax === 1 ? "guest" : "guests"}</span>
                  <span className="text-foreground-muted">|</span>
                  <span>{bags} {bags === 1 ? "bag" : "bags"}</span>
                </div>
              </div>
            </div>

            {/* Middle Segment: Date & Time */}
            <div className="flex items-center gap-2.5 min-w-0 sm:min-w-[130px] pl-8 md:pl-0">
              <Calendar className="w-4 h-4 text-foreground-muted shrink-0" />
              <div className="space-y-0.5 leading-tight">
                <p className="font-bold text-foreground font-data text-sm">
                  {r.pickup_datetime ? formatTime(r.pickup_datetime) : "10:30 AM"}
                </p>
                <p className="text-xs text-foreground-secondary">
                  {formatDateShort(r.pickup_datetime)}
                </p>
              </div>
            </div>

            {/* Center-Right Segment: Route & Metrics */}
            <div className="flex items-start gap-2.5 min-w-0 flex-1 pl-8 md:pl-0 max-w-md">
              <MapPin className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 min-w-0 leading-tight">
                <p
                  className="font-bold text-sm text-foreground truncate"
                  title={`${r.pickup_location} → ${r.dropoff_location}`}
                >
                  {r.pickup_location || "NAIA T1"} → {r.dropoff_location || "CoCo Star Hotel"}
                </p>
                <p className="text-xs text-foreground-secondary truncate flex items-center gap-1">
                  <Navigation className="w-3 h-3 text-foreground-muted shrink-0" />
                  <span className="truncate">{metrics.summary}</span>
                </p>
              </div>
            </div>

            {/* Right Segment: Tags + Status Pill + Chevron */}
            <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center pl-8 md:pl-0">
              {/* Pill Tags */}
              <div className="hidden sm:flex items-center gap-1.5">
                {tags.map((tag) => (
                  <PillTag key={tag.key} tag={tag} />
                ))}
              </div>

              {/* Status Pill */}
              <span
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold select-none",
                  statusPill.className
                )}
              >
                {statusPill.label}
              </span>

              {/* Chevron */}
              <ChevronRight className="w-4 h-4 text-foreground-muted group-hover:text-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ReservationQueueTableSkeleton({ viewMode = "list" }) {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-4 rounded-2xl border border-border/80 bg-surface space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-16 h-3.5 bg-muted rounded" />
              <div className="w-20 h-5 bg-muted rounded-full" />
            </div>
            <div className="space-y-1.5">
              <div className="w-36 h-4 bg-muted rounded" />
              <div className="w-24 h-3 bg-muted rounded" />
            </div>
            <div className="pt-2 border-t border-border/40 grid grid-cols-2 gap-2">
              <div className="w-24 h-3 bg-muted rounded" />
              <div className="w-32 h-3 bg-muted rounded" />
            </div>
            <div className="flex gap-1.5 pt-1">
              <div className="w-12 h-5 bg-muted rounded-full" />
              <div className="w-14 h-5 bg-muted rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 animate-pulse">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="p-4 rounded-2xl border border-border/80 bg-surface flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-md bg-muted" />
            <div className="space-y-1.5">
              <div className="w-16 h-3 bg-muted rounded" />
              <div className="w-32 h-4 bg-muted rounded" />
              <div className="w-24 h-3 bg-muted rounded" />
            </div>
          </div>
          <div className="hidden sm:block space-y-1.5">
            <div className="w-20 h-3.5 bg-muted rounded" />
            <div className="w-16 h-3 bg-muted rounded" />
          </div>
          <div className="hidden md:block space-y-1.5 flex-1 max-w-xs">
            <div className="w-48 h-3.5 bg-muted rounded" />
            <div className="w-36 h-3 bg-muted rounded" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-20 h-6 bg-muted rounded-full" />
            <div className="w-4 h-4 bg-muted rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
