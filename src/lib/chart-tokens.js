/**
 * Single source of truth for chart color values.
 *
 * Recharts SVG attributes cannot consume Tailwind classes, so charts need raw
 * hex strings. Before this module existed, role-dashboard, analytics and
 * reports each kept a private palette that drifted apart — the same semantic
 * status could render as three different ambers. These values mirror the CSS
 * custom properties in src/app/globals.css (--success/--warning/--danger/
 * --info); if you change one, change both.
 */
export const CHART_COLORS = {
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  neutral: "#9ca3af",
  primaryLight: "#111827",
};

/** Ordered donut/pie palette keyed by vehicle fleet-status buckets. */
export const VEHICLE_PIE_COLORS = {
  Available: CHART_COLORS.success,
  "In Use": CHART_COLORS.warning,
  "Under Maintenance": CHART_COLORS.danger,
  "Out of Service": "#b91c1c", // deepened danger so adjacent slices differ
  "Registration Expired": CHART_COLORS.info,
  Reserved: CHART_COLORS.neutral,
  Decommissioned: CHART_COLORS.neutral,
};

/** Fallback series colors for multi-series line/bar charts. */
export const SERIES = [CHART_COLORS.primaryLight, CHART_COLORS.info, CHART_COLORS.success, CHART_COLORS.warning, CHART_COLORS.danger];

export function vehiclePieColor(name) {
  return VEHICLE_PIE_COLORS[name] || CHART_COLORS.neutral;
}
