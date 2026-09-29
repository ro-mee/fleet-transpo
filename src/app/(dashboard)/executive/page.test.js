import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ queries: {} }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }) =>
    state.queries[queryKey[0]] || { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/executive",
}));
vi.mock("@/lib/auth/role-guard", () => ({
  useRequireRole: () => ({ authorized: true, role: "admin", loading: false, missingRole: false }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock("@/services/report.service", () => ({
  getDriverPerformanceReport: vi.fn(),
  getFinancialSummary: vi.fn(),
  getFleetUtilizationReport: vi.fn(),
}));
vi.mock("@/services/driver.service", () => ({ getIncidentSummary: vi.fn() }));
vi.mock("@/services/ai.service", () => ({ getAiInsights: vi.fn() }));
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => ({ children }) => children }),
  MotionConfig: ({ children }) => children,
  AnimatePresence: ({ children }) => children,
  animate: () => ({ stop: () => {} }),
}));

// A global React has to exist before any module-scope JSX is evaluated.
vi.stubGlobal("React", React);
const { default: ExecutiveKpiPage } = await import("./page");
const { TooltipProvider } = await import("@/components/ui/tooltip");

function driver(overrides = {}) {
  return {
    driver_id: 1,
    name: "Juan Dela Cruz",
    face_image_url: null,
    avatar_url: null,
    driver_status: "Available",
    completed_trips: 10,
    measured_trips: 8,
    on_time_trips: 7,
    late_trips: 1,
    unmeasured_trips: 2,
    override_trips: 0,
    punctuality_rate: 88,
    avg_late_minutes: 12.4,
    max_late_minutes: 20,
    ...overrides,
  };
}

function payload(details) {
  const sum = (key) => details.reduce((total, row) => total + row[key], 0);
  const measuredTrips = sum("measured_trips");
  const onTimeTrips = sum("on_time_trips");
  return {
    totalDrivers: details.length,
    totalCompletedTrips: sum("completed_trips"),
    punctuality: {
      measuredTrips,
      onTimeTrips,
      lateTrips: sum("late_trips"),
      unmeasuredTrips: sum("unmeasured_trips"),
      overrideTrips: sum("override_trips"),
      // 0-100 integer, already weighted by the backend.
      onTimeRate: measuredTrips === 0 ? null : Math.round((onTimeTrips / measuredTrips) * 100),
      avgLateMinutes: null,
      maxLateMinutes: null,
    },
    details,
    trips: [],
    methodology: "Completed non-deleted trips by end_time in window.",
  };
}

function query(data) {
  return { data, isLoading: false, isError: false, isRefetching: false, refetch: vi.fn() };
}

function render() {
  return renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(ExecutiveKpiPage)));
}

// StatCard renders `<span … title={label}>{label}</span>` and its value is the
// first paragraph after that span; reading the card from its own label is what
// makes a dropped or renamed card fail.
function kpiValue(html, label) {
  const at = html.indexOf(`title="${label}"`);
  if (at === -1) return null;
  const match = html.slice(at).match(/<p[^>]*>([^<]*)<\/p>/);
  return match ? match[1].trim() : null;
}

function headers(html) {
  return [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, "").trim());
}

// The driver snapshot is this page's only table in these fixtures. Slicing it and
// dropping tags scopes the "no fabricated 0%" check to the driver row — the page
// also renders legitimate zero measurements elsewhere (fleet utilization "0%")
// and CSS bar widths, neither of which a document-wide search can tell apart
// from a value. Callers assert the slice is non-empty so it cannot pass vacuously.
function driverTableText(html) {
  const start = html.indexOf("<table");
  const end = html.indexOf("</table>");
  if (start === -1 || end === -1) return "";
  return html.slice(start, end).replace(/<[^>]+>/g, " ");
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.queries = {
    "exec-financial": query({ monthlyData: [], totalCost: 0, totalDistance: 0, costPerKm: 0, fuelCost: 0, maintCost: 0 }),
    "exec-utilization": query({ vehicleRoster: [], statusBreakdown: [], monthlyData: [] }),
    "exec-driver-perf": query(payload([driver()])),
    "exec-incident-summary": query({}),
    "exec-insights": query([]),
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("Executive — driver performance snapshot", () => {
  it("renders Driver | Completed | Punctuality and nothing else", () => {
    const html = render();
    const labels = headers(html);
    const at = labels.indexOf("Driver");
    expect(at).toBeGreaterThan(-1);
    expect(labels.slice(at, at + 3)).toEqual(["Driver", "Completed", "Punctuality"]);
    expect(html).toContain("Juan Dela Cruz");
  });

  it("shows the completed-trip count and the punctuality rate, not blank cells", () => {
    const html = render();
    expect(html).toContain("88%");
    // A mechanical rename that keeps the retired `* 100` renders 8800%.
    expect(html).not.toContain("8800%");
    // The row's completed count is 10, and the retired score/distance cells are
    // gone rather than reading as blank or 0.
    expect(html).toContain(">10</td>");
    expect(html).not.toContain("Score");
  });

  it("renders — for a driver with no measured trips, never 0%", () => {
    state.queries["exec-driver-perf"] = query(payload([
      driver({ measured_trips: 0, on_time_trips: 0, late_trips: 0, punctuality_rate: null }),
    ]));
    const html = render();
    expect(html).toContain("—");
    const row = driverTableText(html);
    expect(row).toContain("Juan Dela Cruz");
    expect(row).not.toContain("0%");
  });

  it("carries the fleet totals on the headline cards from the punctuality payload", () => {
    state.queries["exec-driver-perf"] = query(payload([
      driver({ driver_id: 1, completed_trips: 8, measured_trips: 8, on_time_trips: 8, late_trips: 0 }),
      driver({ driver_id: 2, name: "Ben Cruz", completed_trips: 2, measured_trips: 2, on_time_trips: 0, late_trips: 2 }),
    ]));
    const html = render();
    expect(kpiValue(html, "Completed trips")).toBe("10");
    expect(kpiValue(html, "Punctuality")).toBe("80%");
    expect(html).toContain("10 measured completed trips");
  });

  it("removes the risk badge whose only input was the retired incident count", () => {
    const html = render();
    // The badge failed OPEN to "Healthy" once `driver.incidents` was removed —
    // a safety-facing column that clears every driver is worse than no column.
    expect(html).not.toContain("Healthy");
    expect(html).not.toContain("Incidents</th>");
    expect(html).not.toContain("performance_score");
  });
});
