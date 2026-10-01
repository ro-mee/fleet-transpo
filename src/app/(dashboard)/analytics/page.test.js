import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ queries: {}, options: [], motion: [] }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options) => {
    state.options.push(options);
    return (
      state.queries[options.queryKey[0]] || {
        data: undefined,
        isLoading: false,
        isSuccess: true,
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
// The stand-in stays render-transparent but records the props each motion
// element received: the punctuality bar's entire render output is a
// `style={{ width }}` on an inner motion element, so a pure passthrough mock
// makes the bar — and the defect of drawing it for an unmeasured driver —
// invisible in the static markup. The recorded props are the channel that tells
// a drawn bar from an absent one.
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, {
    get: () => (props) => {
      state.motion.push(props || {});
      return props ? props.children : null;
    },
  }),
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
const { toCalendarDay } = await import("@/lib/dates");

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
  return { data, isLoading: false, isSuccess: true, isError: false, isRefetching: false, refetch: vi.fn() };
}

// The window the page sends for the default timeframe (30d). Mirrors
// src/app/(dashboard)/analytics/page.js `dateBounds` exactly.
function window30d() {
  const now = new Date();
  const to = toCalendarDay(now);
  const fromDate = new Date(now);
  fromDate.setDate(now.getDate() - 30);
  return { from: toCalendarDay(fromDate), to };
}

// What a reader can actually see. Attributes are NOT value renders: this
// dashboard draws decorative SVG gradient stops (`offset="0%"`) and CSS bar
// widths (`style="width:0%"`), so a whole-document search for "0%" can never be
// clean. Stripping every tag leaves only the text nodes, where a fabricated
// "0%" — the defect this guards — still shows up.
function visibleText(html) {
  return html.replace(/<[^>]+>/g, " ");
}

// The widths of the punctuality bars this page actually drew. Only the bar
// carries a `style` width, so an empty list means no bar rendered at all —
// which is exactly what an unmeasured driver must get, and what a
// value-render check on stripped text can never see.
function barWidths() {
  return state.motion
    .filter((props) => props.style && typeof props.style.width === "string")
    .map((props) => props.style.width);
}

// The leaderboard row for `name`, read back through the motion element that
// wraps it. `motion` is a passthrough here, so a row has no delimiter of its
// own in the static markup and a bare document-wide search for its text is
// satisfied by unrelated markup elsewhere on the page. Rendering each recorded
// element's children and taking the smallest that contains the name recovers
// exactly the row, the way reports/page.test.js reads its row back cell by
// cell. Returns null when no row carries the name, so callers fail loudly.
function rosterRowText(name) {
  const row = state.motion
    .map((props) => renderToStaticMarkup(React.createElement(React.Fragment, null, props.children)))
    .filter((markup) => markup.includes(name))
    .map((markup) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .sort((a, b) => a.length - b.length)[0];
  return row ?? null;
}

function render() {
  return renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(AnalyticsPage)));
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.queries = {};
  state.options = [];
  state.motion = [];
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
    // Scoped to the roster row. A document-wide search for the dash is
    // satisfied by unrelated markup elsewhere on the page, so it proves nothing
    // about this row; the row's own text is what has to carry it.
    const row = rosterRowText("Ana Reyes");
    expect(row).toContain("—");
    // Text-only, per `visibleText`: the page's SVG gradient stops and CSS bar
    // widths are not value renders, and the retired read would have printed a
    // real "0%" in the leaderboard's own text.
    expect(visibleText(html)).not.toContain("0%");
  });

  it("labels each row with the measurement behind the rate", () => {
    state.queries["analytics-drivers"] = query(payload([
      driver({ driver_id: 1, name: "Ana Reyes", measured_trips: 0, on_time_trips: 0, punctuality_rate: null }),
    ]));
    render();
    expect(rosterRowText("Ana Reyes")).toContain("Not measured");

    state.motion = [];
    state.queries["analytics-drivers"] = query(payload([driver({ driver_id: 1, name: "Ana Reyes" })]));
    render();
    expect(rosterRowText("Ana Reyes")).toContain("7 of 8 on time");
  });

  it("draws the punctuality bar only for a measured driver, at the measured width", () => {
    state.queries["analytics-drivers"] = query(payload([
      driver({ driver_id: 1, name: "Ana Reyes", measured_trips: 0, on_time_trips: 0, punctuality_rate: null }),
    ]));
    render();
    // No bar at all — not a 0%-wide one, which would read as a measured zero.
    expect(barWidths()).toEqual([]);

    state.motion = [];
    state.queries["analytics-drivers"] = query(payload([driver({ driver_id: 1, name: "Ana Reyes", punctuality_rate: 88 })]));
    render();
    // …and a measured driver gets one, at the rate as-is: the retired multiply
    // would clamp a 8800% width to a full 100% bar.
    expect(barWidths()).toEqual(["88%"]);
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

describe("Analytics — the AI narrative is gated and window-keyed", () => {
  it("does not ask for a narrative until every report feed has succeeded", () => {
    // Hold one feed back. The snapshot would otherwise be a page of default
    // zeros, and the analyst would describe them as fact.
    state.queries["analytics-fuel"] = {
      data: undefined,
      isLoading: true,
      isSuccess: false,
      isError: false,
      isRefetching: false,
      refetch: vi.fn(),
    };
    render();
    const option = state.options.find((o) => o.queryKey[0] === "report-narrative");
    expect(option.enabled).toBe(false);
    expect(option.queryKey[3]).toBe("pending");
    // …and the card shows its loading state rather than "no analysis".
    expect(render()).toContain("Generating analysis");
  });

  it("stops loading and shows the honest empty state when a feed fails", () => {
    state.queries["analytics-financial"] = {
      data: undefined,
      isLoading: false,
      isSuccess: false,
      isError: true,
      isRefetching: false,
      refetch: vi.fn(),
    };
    const html = render();
    expect(html).not.toContain("Generating analysis");
    expect(html).toContain("No analysis available for this report in the selected period yet.");
  });

  it("keys the narrative on the numbers it narrates, not only the window", () => {
    state.queries["analytics-drivers"] = query(payload([driver({ punctuality_rate: 88 })]));
    render();
    const first = state.options.find((o) => o.queryKey[0] === "report-narrative");
    expect(first.enabled).toBe(true);
    expect(first.queryKey[3]).toContain('"driverPunctuality":88');
    expect(first.queryKey[3]).not.toBe("pending");

    // A different metric snapshot in the SAME window must be a different query,
    // otherwise the cached analysis describes numbers no longer on screen.
    state.options = [];
    state.queries["analytics-drivers"] = query(payload([driver({ on_time_trips: 2 })]));
    render();
    const second = state.options.find((o) => o.queryKey[0] === "report-narrative");
    expect(second.queryKey[3]).toContain('"driverPunctuality":25');
    expect(second.queryKey[3]).not.toBe(first.queryKey[3]);
    expect(second.queryKey[2]).toEqual(first.queryKey[2]);
  });

  it("renders a narrative generated for the window on screen", () => {
    const range = window30d();
    state.queries["report-narrative"] = {
      data: { report: "analytics", narrative: "Cost per km is PHP 4.2.", actions: [], flag: "success", range },
      isLoading: false,
      isFetching: false,
      isSuccess: true,
      isError: false,
      refetch: vi.fn(),
    };
    const html = render();
    expect(html).toContain("Cost per km is PHP 4.2.");
  });

  it("refuses a narrative generated for a different window", () => {
    // The response arrived after the period changed: a stale claim must never
    // render under the new period's figures.
    state.queries["report-narrative"] = {
      data: {
        report: "analytics",
        narrative: "STALE CLAIM FROM ANOTHER PERIOD",
        actions: [],
        flag: "success",
        range: { from: "1999-01-01", to: "1999-01-31" },
      },
      isLoading: false,
      isFetching: false,
      isSuccess: true,
      isError: false,
      refetch: vi.fn(),
    };
    const html = render();
    expect(html).not.toContain("STALE CLAIM FROM ANOTHER PERIOD");
    expect(html).toContain("No analysis available for this report in the selected period yet.");
  });

  it("refuses a narrative that narrates a different report", () => {
    state.queries["report-narrative"] = {
      data: { report: "fleet", narrative: "WRONG REPORT NARRATIVE", actions: [], flag: "success", range: window30d() },
      isLoading: false,
      isFetching: false,
      isSuccess: true,
      isError: false,
      refetch: vi.fn(),
    };
    expect(render()).not.toContain("WRONG REPORT NARRATIVE");
  });
});
