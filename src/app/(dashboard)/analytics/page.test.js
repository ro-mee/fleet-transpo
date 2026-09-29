import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ queries: {}, options: [] }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options) => {
    state.options.push(options);
    return (
      state.queries[options.queryKey[0]] || {
        data: undefined,
        isLoading: false,
        isError: false,
        isRefetching: false,
        refetch: vi.fn(),
      }
    );
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/analytics",
}));
vi.mock("@/lib/auth/role-guard", () => ({
  useRequireRole: () => ({ authorized: true, role: "admin", loading: false, missingRole: false }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock("@/services/report.service", () => ({
  getDriverPerformanceReport: vi.fn(),
  getFleetUtilizationReport: vi.fn(),
  getFuelConsumptionReport: vi.fn(),
  getFinancialSummary: vi.fn(),
  getFleetCostWorkbook: vi.fn(),
}));
vi.mock("@/services/ai.service", () => ({
  getPredictiveMaintenance: vi.fn(),
  getReportNarrative: vi.fn(),
}));
vi.mock("@/services/transport.service", () => ({ getTransportRequests: vi.fn() }));
// motion-dom attaches document listeners as soon as it can see a `window`.
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => ({ children }) => children }),
  MotionConfig: ({ children }) => children,
  AnimatePresence: ({ children }) => children,
  animate: () => ({ stop: () => {} }),
}));

// Classic-runtime JSX reaches for a global React at import time (the toast
// module builds an icon map at module scope), so the global goes in first.
vi.stubGlobal("React", React);
const { default: AnalyticsPage } = await import("./page");
const { TooltipProvider } = await import("@/components/ui/tooltip");
const { getReportNarrative } = await import("@/services/ai.service");

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
      // 0-100 integer, already weighted by the backend — NOT a 0-1 fraction.
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

// What a reader can actually see. Attributes are NOT value renders: this
// dashboard draws decorative SVG gradient stops (`offset="0%"`) and CSS bar
// widths (`style="width:0%"`), so a whole-document search for "0%" can never be
// clean. Stripping every tag leaves only the text nodes, where a fabricated
// "0%" — the defect this guards — still shows up.
function visibleText(html) {
  return html.replace(/<[^>]+>/g, " ");
}

function render() {
  return renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(AnalyticsPage)));
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.queries = {};
  state.options = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("Analytics — driver leaderboard", () => {
  it("ranks the roster from the payload details, not a retired top-drivers list", () => {
    state.queries["analytics-drivers"] = query(payload([
      driver({ driver_id: 1, name: "Ana Reyes", completed_trips: 12 }),
      driver({ driver_id: 2, name: "Ben Cruz", completed_trips: 4 }),
    ]));
    const html = render();
    expect(html).toContain("Ana Reyes");
    expect(html).toContain("Ben Cruz");
    expect(html).toContain("12 Trips Completed");
  });

  it("renders the 0-100 punctuality rate as-is, never multiplied by 100 again", () => {
    state.queries["analytics-drivers"] = query(payload([
      driver({ driver_id: 1, name: "Ana Reyes", punctuality_rate: 88 }),
    ]));
    const html = render();
    expect(html).toContain("88%");
    // A mechanical rename that keeps an existing `* 100` renders 8800%.
    expect(html).not.toContain("8800%");
  });

  it("renders — for a driver with no measured trips rather than a fabricated 0%", () => {
    state.queries["analytics-drivers"] = query(payload([
      driver({ driver_id: 1, name: "Ana Reyes", measured_trips: 0, on_time_trips: 0, punctuality_rate: null }),
    ]));
    const html = render();
    expect(html).toContain("—");
    // Text-only, per `visibleText`: the page's SVG gradient stops and CSS bar
    // widths are not value renders, and the retired read would have printed a
    // real "0%" in the leaderboard's own text.
    expect(visibleText(html)).not.toContain("0%");
  });

  it("drops the retired safety-score vocabulary from the leaderboard", () => {
    state.queries["analytics-drivers"] = query(payload([driver()]));
    const html = render();
    expect(html).not.toContain("Safety Score");
    expect(html).not.toContain("safety score");
    expect(html).not.toContain("Master Driver");
    expect(html).not.toContain("Top Rated Roster");
  });

  it("hands the narrative the punctuality rate under a live key, never the removed avgScore", async () => {
    state.queries["analytics-drivers"] = query(payload([driver({ punctuality_rate: 88 })]));
    render();
    const narrativeOption = state.options.find((option) => option.queryKey[0] === "report-narrative");
    expect(narrativeOption).toBeTruthy();
    narrativeOption.queryFn();
    const snapshot = vi.mocked(getReportNarrative).mock.calls[0][1];
    expect(snapshot.driverPunctuality).toBe(88);
    expect(snapshot).not.toHaveProperty("avgScore");
  });
});
