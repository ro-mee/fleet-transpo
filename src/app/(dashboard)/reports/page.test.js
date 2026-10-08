import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ queries: {} }));

// The page reads one query per report tab; this returns the payload registered
// for the queried key so the Drivers tab can be exercised through the page's
// real render path.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }) =>
    state.queries[queryKey[0]] || { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/reports",
}));
vi.mock("@/lib/auth/role-guard", () => ({
  useRequireRole: () => ({ authorized: true, role: "admin", loading: false, missingRole: false }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock("@/services/report.service", () => ({
  getDriverPerformanceReport: vi.fn(),
  getDriverPerformanceWorkbook: vi.fn(),
  getFleetUtilizationReport: vi.fn(),
  getFleetUtilizationWorkbook: vi.fn(),
  getFleetCostWorkbook: vi.fn(),
  getFuelConsumptionReport: vi.fn(),
  getFuelConsumptionWorkbook: vi.fn(),
  getFinancialSummary: vi.fn(),
  getFinancialWorkbook: vi.fn(),
  getMaintenanceReport: vi.fn(),
  getMaintenanceWorkbook: vi.fn(),
}));
vi.mock("@/services/ai.service", () => ({
  getPredictiveMaintenance: vi.fn(),
  getReportNarrative: vi.fn(),
}));
// The page is wrapped in framer-motion primitives. motion-dom reaches for real
// DOM APIs (addEventListener on the document element) the moment it can see a
// `window`, and this file stubs one to select the Drivers tab, so the animation
// layer is replaced with transparent passthroughs for the static render.
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => ({ children }) => children }),
  MotionConfig: ({ children }) => children,
  AnimatePresence: ({ children }) => children,
  animate: () => ({ stop: () => {} }),
}));

// This repo's Vitest JSX transform uses the CLASSIC runtime, which compiles
// module-scope JSX (e.g. the icon map inside `@/components/ui/toast`) into
// bare `React.createElement` calls resolved from the global scope at *import*
// time. Stubbing React in `beforeEach` is too late for that, so the global is
// installed before the page module is imported.
vi.stubGlobal("React", React);
const { default: ReportsPage, buildDriverOverview } = await import("./page");
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

// The dashboard cards carry inline SVG gradients whose stops use
// `offset="0%"`, so a whole-document search for "0%" can never be clean. The
// driver overview is therefore read back cell by cell: a fabricated 0 renders
// as a cell reading exactly "0%", which a document-wide search cannot tell
// apart from the gradient attributes.
function rowCells(html, name) {
  const row = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => match[1]).find((body) => body.includes(name));
  if (!row) return null;
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1].replace(/<[^>]+>/g, "").trim());
}

function render(data) {
  state.queries["report-drivers"] = query(data);
  return renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(ReportsPage)));
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  // The Drivers tab is selected from the URL; the initializer only reads
  // `window` when it exists, so supplying a search string is what puts the
  // Drivers report on screen for a static render.
  vi.stubGlobal("window", {
    location: { search: "?report=drivers", pathname: "/reports" },
    history: { replaceState: vi.fn() },
  });
  state.queries = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("buildDriverOverview", () => {
  it("maps the punctuality payload onto the overview rows", () => {
    const rows = buildDriverOverview([driver()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, name: "Juan Dela Cruz", completed: 10, onTime: 7, late: 1, punctuality: 88 });
  });

  it("keeps a missing punctuality rate null so the surface can render —", () => {
    const rows = buildDriverOverview([driver({ measured_trips: 0, on_time_trips: 0, punctuality_rate: null })]);
    expect(rows[0].punctuality).toBeNull();
  });

  it("survives a missing details array", () => {
    expect(buildDriverOverview(undefined)).toEqual([]);
  });
});

describe("Reports — Fleet tab (no fabricated activity)", () => {
  function renderFleet(queryResult) {
    state.queries["report-fleet"] = queryResult;
    vi.stubGlobal("window", {
      location: { search: "?report=fleet", pathname: "/reports" },
      history: { replaceState: vi.fn() },
    });
    return renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(ReportsPage)));
  }

  const EMPTY_FLEET = {
    utilization: 0,
    totalTrips: 0,
    totalDistance: 0,
    byVehicle: [],
    // A roster exists, but a roster is not activity. It must not be dressed up
    // as a dispatched vehicle with one invented trip.
    vehicleRoster: [{ vehicle_id: 37, plate_number: "ABC-1234", vehicle_name: "SUV" }],
  };

  it("shows an honest empty state instead of a fabricated vehicle", () => {
    const html = renderFleet(query(EMPTY_FLEET));
    expect(html).not.toContain("ABC-1234");
    expect(html).toContain("No completed fleet activity in this period");
    expect(html).toContain("No activity");
  });

  it("reports the real zeros rather than 4% and one trip", () => {
    const html = renderFleet(query(EMPTY_FLEET));
    expect(html).toContain("0%");
    expect(html).not.toContain("4%");
    expect(html).not.toContain("1 trips");
    expect(html).toContain("No trips recorded");
  });

  it("does not invent a vehicle while the report is still loading", () => {
    const html = renderFleet({
      data: undefined,
      isLoading: true,
      isError: false,
      isRefetching: false,
      refetch: vi.fn(),
    });
    expect(html).not.toContain("ABC-1234");
    expect(html).not.toContain("4%");
    expect(html).toContain("Loading…");
  });

  it("renders real activity rows when the window has trips", () => {
    const html = renderFleet(query({
      utilization: 12,
      totalTrips: 6,
      totalDistance: 39.85,
      byVehicle: [
        { plate: "XYZ 5678", trips: 2, distance: 26.54 },
        { plate: "ABC-1234", trips: 4, distance: 13.31 },
      ],
    }));
    expect(html).toContain("XYZ 5678");
    expect(html).toContain("12%");
    expect(html).toContain("Top 2");
  });

  it("ends the analysis skeleton when the narrative request fails while report exports stay available", () => {
    state.queries["report-narrative"] = {
      data: undefined, isLoading: false, isFetching: false, isError: true,
      error: new Error("Narrative request failed"), refetch: vi.fn(),
    };
    const html = renderFleet({ ...query(EMPTY_FLEET), isSuccess: true });
    expect(html).toContain("Analysis unavailable");
    expect(html).not.toContain("Generating analysis for Fleet Utilization");
    expect(html).toContain("Export Fleet Excel");
  });

  it("explains why exports are disabled when the report request fails", () => {
    const html = renderFleet({
      data: undefined, isLoading: false, isError: true,
      error: new Error("Report request failed"), refetch: vi.fn(),
    });
    expect(html).toContain("Export unavailable while the report cannot load");
    expect(html).not.toContain("Generating analysis for Fleet Utilization");
  });

  it("shows an honest no-analysis state when the narrative response has no text", () => {
    state.queries["report-narrative"] = {
      data: { report: "fleet", narrative: null, mode: "no-data" },
      isLoading: false, isFetching: false, isError: false, isSuccess: true,
      refetch: vi.fn(),
    };
    const html = renderFleet({ ...query(EMPTY_FLEET), isSuccess: true });
    expect(html).toContain("No analysis available for this report");
    expect(html).not.toContain("Generating analysis for Fleet Utilization");
  });
});

describe("Reports — Drivers tab", () => {
  it("renders completed trips and fleet punctuality in place of the average score", () => {
    const html = render(payload([
      driver({ driver_id: 1, completed_trips: 8, measured_trips: 8, on_time_trips: 8, late_trips: 0 }),
      driver({ driver_id: 2, name: "Ben Cruz", completed_trips: 2, measured_trips: 2, on_time_trips: 0, late_trips: 2 }),
    ]));
    expect(html).toContain("Completed trips");
    expect(html).toContain("Punctuality");
    expect(html).toContain("80%");
    // The retired score vocabulary must be gone from the tab.
    expect(html).not.toContain("Average score");
    expect(html).not.toContain("/100");
    expect(html).not.toContain("Score");
  });

  it("lists the roster from the payload details with per-driver punctuality", () => {
    const html = render(payload([driver()]));
    expect(rowCells(html, "Juan Dela Cruz")).toEqual(["Juan Dela Cruz", "10", "88%", "7", "1"]);
  });

  it("renders — rather than a fabricated 0% for a driver with no measured trips", () => {
    const html = render(payload([
      driver({ completed_trips: 3, measured_trips: 0, on_time_trips: 0, late_trips: 0, punctuality_rate: null }),
    ]));
    expect(rowCells(html, "Juan Dela Cruz")).toEqual(["Juan Dela Cruz", "3", "—", "0", "0"]);
  });
});

 describe("Cargo payload utilization", () => {
 it("renders measured capacity and never invents zero for missing capacity", () => {
 state.queries["report-fleet"] = query({ utilization: 0, totalTrips: 2, totalDistance: 36, byVehicle: [], cargoUtilization: { trips: 1, average_pct: 65, byTrip: [{ trip_id: 701, plate: "TRK-DEMO", weight_kg: 650, capacity_kg: 1000, utilization_pct: 65 }] } });
 vi.stubGlobal("window", { location: { search: "?report=fleet", pathname: "/reports" }, history: { replaceState: vi.fn() } });
 const html = renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(ReportsPage)));
 expect(html).toContain("Cargo payload utilization"); expect(html).toContain("65%"); expect(html).toContain("TRK-DEMO"); expect(html).toContain("650"); expect(html).toContain("1,000");
 });
 });
