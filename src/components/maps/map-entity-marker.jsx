"use client";

import React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// 1. Color and Status Mappings (Source of Truth)
// ---------------------------------------------------------------------------

export const MARKER_TONES = {
  green: {
    pinBg: "#10b981",
    statusColor: "#059669",
    statusClass: "text-emerald-600 dark:text-emerald-400",
    name: "Active trip",
  },
  blue: {
    pinBg: "#2563eb",
    statusColor: "#2563eb",
    statusClass: "text-blue-600 dark:text-blue-400",
    name: "At pickup",
  },
  slate: {
    pinBg: "#64748b",
    statusColor: "#64748b",
    statusClass: "text-slate-500 dark:text-slate-400",
    name: "Available / idle",
  },
  rose: {
    pinBg: "#ef4444",
    statusColor: "#dc2626",
    statusClass: "text-rose-600 dark:text-rose-400",
    name: "Maintenance",
  },
  amber: {
    pinBg: "#f59e0b",
    statusColor: "#d97706",
    statusClass: "text-amber-600 dark:text-amber-400",
    name: "Delayed / attention",
  },
  gray: {
    pinBg: "#94a3b8",
    statusColor: "#64748b",
    statusClass: "text-slate-500 dark:text-slate-400",
    name: "Offline / no signal",
  },
};

// SVG Icons in pure string format for Leaflet divIcon HTML
const SVG_ICONS = {
  car: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"/><rect width="18" height="8" x="3" y="10" rx="2"/><circle cx="7" cy="14" r="1.2" fill="#ffffff" stroke="none"/><circle cx="17" cy="14" r="1.2" fill="#ffffff" stroke="none"/><path d="M5 18v2"/><path d="M19 18v2"/></svg>',
  van: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><circle cx="8" cy="15" r="1.2" fill="#ffffff" stroke="none"/><circle cx="16" cy="15" r="1.2" fill="#ffffff" stroke="none"/><path d="M6 19v2"/><path d="M18 21v-2"/></svg>',
  wrench: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  alert: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  rescue: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z"/></svg>',
  pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
};

// ---------------------------------------------------------------------------
// 2. Deterministic Marker Config Resolver
// ---------------------------------------------------------------------------

export function resolveMarkerConfig(entity, context = {}) {
  if (!entity) {
    return {
      title: "Unknown",
      status: "Idle",
      tone: "slate",
      iconKey: "car",
      selected: false,
      stale: false,
      pulse: false,
      zIndexOffset: 500,
    };
  }

  // A. Rescue Unit Entity
  if (context.type === "rescue" || entity.responder || entity.response_status) {
    const isSelected = context.selectedId != null && String(context.selectedId) === String(entity.incident_id || entity.id);
    return {
      type: "rescue",
      id: entity.incident_id || entity.id,
      title: entity.label || entity.responder_name || "Rescue Unit",
      status: entity.response_status || "Dispatched",
      tone: "blue",
      iconKey: "rescue",
      selected: isSelected,
      stale: false,
      pulse: false,
      zIndexOffset: 1500,
    };
  }

  // B. Incident Entity
  if (context.type === "incident" || entity.incident_id) {
    const severity = String(entity.severity || "Moderate").toLowerCase();
    const isCritical = severity === "critical" || severity === "major";
    const typeLabel = entity.incident_type || "Incident";
    const isPending = !entity.acknowledged_at && entity.status !== "Resolved";
    const hasAssistance = Array.isArray(entity.assistance_needed) && entity.assistance_needed.length > 0;
    const isSelected = context.selectedId != null && String(context.selectedId) === String(entity.incident_id);

    return {
      type: "incident",
      id: entity.incident_id,
      title: entity.plate_number || `INC-${String(entity.incident_id).padStart(3, "0")}`,
      status: isCritical ? `Critical · ${typeLabel}` : typeLabel,
      tone: isCritical ? "rose" : "amber",
      iconKey: "alert",
      selected: isSelected,
      stale: false,
      pulse: isCritical && (isPending || hasAssistance),
      zIndexOffset: isCritical ? 2500 : 1800,
    };
  }

  // C. Vehicle / Trip Entity
  const tripStatus = entity.trip_status || entity.status;
  const vehicleStatus = entity.vehicle_status;
  const isSelected = context.selectedId != null && (
    String(context.selectedId) === String(entity.trip_id) ||
    String(context.selectedId) === String(entity.vehicle_id)
  );

  // Check GPS freshness
  const isStaleGps = context.isStale === true || (
    entity.recorded_at &&
    (Date.now() - new Date(entity.recorded_at).getTime()) > 10 * 60 * 1000 // >10 mins without update
  );

  const plate = entity.vehicles?.plate_number || entity.plate_number || entity.vehicles?.vehicle_name || entity.vehicle_name || `TRP-${entity.trip_id || "—"}`;

  // State mapping
  if (isStaleGps) {
    return {
      type: "vehicle",
      id: entity.trip_id || entity.vehicle_id,
      title: plate,
      status: "No signal",
      tone: "gray",
      iconKey: "car",
      selected: isSelected,
      stale: true,
      pulse: false,
      zIndexOffset: 400,
    };
  }

  if (vehicleStatus === "Under Maintenance" || vehicleStatus === "Maintenance" || entity.maintenance_id) {
    return {
      type: "vehicle",
      id: entity.trip_id || entity.vehicle_id,
      title: plate,
      status: "Maintenance",
      tone: "rose",
      iconKey: "wrench",
      selected: isSelected,
      stale: false,
      pulse: false,
      zIndexOffset: 800,
    };
  }

  const normalizedTripStatus = String(tripStatus || "").toLowerCase();

  if (normalizedTripStatus.includes("pickup") || normalizedTripStatus.includes("driver accepted")) {
    return {
      type: "trip",
      id: entity.trip_id || entity.vehicle_id,
      title: plate,
      status: "At pickup",
      tone: "blue",
      iconKey: "car",
      selected: isSelected,
      stale: false,
      pulse: false,
      zIndexOffset: isSelected ? 2000 : 1200,
    };
  }

  if (
    normalizedTripStatus.includes("en route") ||
    normalizedTripStatus.includes("progress") ||
    normalizedTripStatus.includes("onboard") ||
    normalizedTripStatus.includes("started")
  ) {
    return {
      type: "trip",
      id: entity.trip_id || entity.vehicle_id,
      title: plate,
      status: "On trip",
      tone: "green",
      iconKey: "car",
      selected: isSelected,
      stale: false,
      pulse: false,
      zIndexOffset: isSelected ? 2000 : 1000,
    };
  }

  if (normalizedTripStatus.includes("delayed")) {
    return {
      type: "trip",
      id: entity.trip_id || entity.vehicle_id,
      title: plate,
      status: "Delayed",
      tone: "amber",
      iconKey: "car",
      selected: isSelected,
      stale: false,
      pulse: false,
      zIndexOffset: isSelected ? 2000 : 1100,
    };
  }

  // Idle / Available default
  return {
    type: "vehicle",
    id: entity.trip_id || entity.vehicle_id,
    title: plate,
    status: "Idle",
    tone: "slate",
    iconKey: "car",
    selected: isSelected,
    stale: false,
    pulse: false,
    zIndexOffset: isSelected ? 2000 : 500,
  };
}

// ---------------------------------------------------------------------------
// 3. Leaflet HTML & DivIcon Generators
// ---------------------------------------------------------------------------

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

export function createMapEntityMarkerHtml({
  title = "ABC 9876",
  status = "On trip",
  tone = "green",
  iconKey = "car",
  selected = false,
  stale = false,
  pulse = false,
}) {
  const toneCfg = MARKER_TONES[tone] || MARKER_TONES.green;
  const iconSvg = SVG_ICONS[iconKey] || SVG_ICONS.car;
  const safeTitle = escapeHtml(title);
  const safeStatus = escapeHtml(status);

  const pulseHtml = pulse
    ? `<span class="fleet-marker-pulse" style="position: absolute; top: -2px; left: -2px; width: 34px; height: 34px; border-radius: 50%; background-color: ${toneCfg.pinBg}; pointer-events: none;"></span>`
    : "";

  const selectedClass = selected ? "fleet-map-entity-marker--selected" : "";
  const staleClass = stale ? "fleet-map-entity-marker--stale" : "";
  const selectedPinStyle = selected ? "box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.45);" : "box-shadow: 0 2px 6px -1px rgba(15, 23, 42, 0.25);";
  const selectedCardStyle = selected
    ? "border-color: rgba(37, 99, 235, 0.85); box-shadow: 0 4px 14px -1px rgba(37, 99, 235, 0.25); outline: 2px solid rgba(37, 99, 235, 0.35);"
    : "box-shadow: 0 2px 8px -1px rgba(15, 23, 42, 0.12), 0 1px 4px -1px rgba(15, 23, 42, 0.06);";
  const opacityStyle = stale ? "opacity: 0.85;" : "";

  return `
    <div class="fleet-map-entity-marker ${selectedClass} ${staleClass}" style="position: relative; display: inline-flex; align-items: center; cursor: pointer; user-select: none; white-space: nowrap; vertical-align: middle; ${opacityStyle}">
      <div class="fleet-map-marker-pin-wrap" style="position: relative; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; z-index: 2;">
        ${pulseHtml}
        <div class="fleet-map-marker-pin" style="width: 30px; height: 30px; min-width: 30px; min-height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background-color: ${toneCfg.pinBg}; border: 1.5px solid rgba(255, 255, 255, 0.85); position: relative; ${selectedPinStyle}">
          ${iconSvg}
          <div class="fleet-map-marker-tip" style="position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 5px solid ${toneCfg.pinBg}; margin-top: 0;"></div>
        </div>
      </div>
      <div class="fleet-map-marker-card" style="margin-left: -6px; padding: 3px 10px 3.5px 10px; border-radius: 12px; background-color: #ffffff; border: 1px solid rgba(226, 232, 240, 0.95); display: flex; flex-direction: column; justify-content: center; min-width: 76px; max-width: 160px; z-index: 1; ${selectedCardStyle}">
        <span class="fleet-map-marker-title" style="font-size: 12px; font-weight: 700; color: #0f172a; line-height: 1.2; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-inter, system-ui, -apple-system, sans-serif);">${safeTitle}</span>
        <span class="fleet-map-marker-status" style="font-size: 10.5px; font-weight: 600; color: ${toneCfg.statusColor}; line-height: 1.2; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-inter, system-ui, -apple-system, sans-serif);">${safeStatus}</span>
      </div>
    </div>
  `.trim();
}

export function createMapEntityMarkerIcon(options, customL = null) {
  const html = createMapEntityMarkerHtml(options);
  const leaflet = customL || (typeof window !== "undefined" ? window.L : null);
  if (leaflet?.divIcon) {
    return leaflet.divIcon({
      className: "fleet-map-entity-divicon",
      html,
      iconSize: [160, 36],
      iconAnchor: [15, 35],
      popupAnchor: [0, -36],
    });
  }
  return {
    options: {
      className: "fleet-map-entity-divicon",
      html,
      iconSize: [160, 36],
      iconAnchor: [15, 35],
      popupAnchor: [0, -36],
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Reusable React Map Entity Marker Component
// ---------------------------------------------------------------------------

export function MapEntityMarker({
  title = "ABC 9876",
  status = "On trip",
  tone = "green",
  iconKey = "car",
  selected = false,
  stale = false,
  pulse = false,
  className,
  onClick,
}) {
  const toneCfg = MARKER_TONES[tone] || MARKER_TONES.green;
  const iconSvg = SVG_ICONS[iconKey] || SVG_ICONS.car;

  return (
    <div
      onClick={onClick}
      className={cn(
        "inline-flex items-center select-none cursor-pointer group transition-all duration-150",
        selected && "scale-[1.02]",
        className
      )}
    >
      <div className="relative flex flex-col items-center shrink-0 z-10">
        {pulse && (
          <span
            className="absolute -top-1 -left-1 h-8 w-8 rounded-full animate-ping opacity-60 pointer-events-none"
            style={{ backgroundColor: toneCfg.pinBg }}
          />
        )}
        <div
          className={cn(
            "h-[30px] w-[30px] rounded-full flex items-center justify-center shadow-xs border border-white/40",
            selected && "ring-2 ring-blue-500/50"
          )}
          style={{ backgroundColor: toneCfg.pinBg }}
          dangerouslySetInnerHTML={{ __html: iconSvg }}
        />
        <div
          className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[5px]"
          style={{ borderTopColor: toneCfg.pinBg }}
        />
      </div>

      <div
        className={cn(
          "ml-[-6px] pl-3 pr-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/80 shadow-xs flex flex-col justify-center min-w-[84px] max-w-[150px] transition-shadow",
          selected
            ? "border-blue-500/80 shadow-md ring-1 ring-blue-500/30 bg-blue-50/20 dark:bg-blue-950/20"
            : "hover:shadow-sm"
        )}
      >
        <span className="text-[12px] font-bold text-slate-900 dark:text-white truncate leading-tight tracking-tight">
          {title}
        </span>
        <span
          className={cn(
            "text-[10.5px] font-semibold truncate leading-tight mt-0.5",
            toneCfg.statusClass
          )}
        >
          {status}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Minimal Map Legend Component (Section 9)
// ---------------------------------------------------------------------------

export function MinimalMapLegend({ className }) {
  const items = [
    { label: "Active trip", dotColor: "#10b981", shape: "circle" },
    { label: "At pickup", dotColor: "#2563eb", shape: "circle" },
    { label: "Available / idle", dotColor: "#64748b", shape: "circle" },
    { label: "Maintenance", dotColor: "#ef4444", shape: "circle" },
    { label: "Incident", dotColor: "#ef4444", shape: "triangle" },
  ];

  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-2xl bg-white/95 dark:bg-surface/95 backdrop-blur-md border border-slate-200/80 dark:border-border/80 shadow-xs text-xs font-medium text-slate-700 dark:text-slate-300 select-none",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5 shrink-0">
          {item.shape === "triangle" ? (
            <span
              className="inline-block w-0 h-0 border-x-[4px] border-x-transparent border-b-[7px]"
              style={{ borderBottomColor: item.dotColor }}
            />
          ) : (
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: item.dotColor }}
            />
          )}
          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
