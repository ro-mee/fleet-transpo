import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The query result is the only state the page reads; every render test below
// swaps it wholesale, so the page is exercised through its real render path.
const state = vi.hoisted(() => ({ query: {} }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => state.query,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/drivers/performance",
}));
vi.mock("@/lib/auth/role-guard", () => ({
  useRequireRole: () => ({ authorized: true, role: "admin", loading: false, missingRole: false }),
}));
// HeroHeader reads the theme; the provider lives in the dashboard layout, which
// this render path deliberately does not mount.
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock("@/services/report.service", () => ({
  getDriverPerformanceReport: vi.fn(),
}));

import DriverPerformancePage, { buildPunctualitySummary } from "./page";
import { TooltipProvider } from "@/components/ui/tooltip";

// A detail row shaped exactly like getDriverPerformanceReport() emits it
// (src/lib/reports/operational-reports.js), including the photo fields that
// were restored so every driver picture keeps rendering.
function driver(overrides = {}) {
  const row = {
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
  // unmeasured = completed - measured - override, the payload's own identity.
  if (!("unmeasured_trips" in overrides)) {
    row.unmeasured_trips = Math.max(0, row.completed_trips - row.measured_trips - row.override_trips);
  }
  return row;
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

// The dashboard layout mounts the TooltipProvider; this render path has to
// supply it, exactly as the app does.
function renderTree() {
  return renderToStaticMarkup(
    React.createElement(TooltipProvider, null, React.createElement(DriverPerformancePage))
  );
}

function render(data) {
  state.query = { data, isLoading: false, isError: false, refetch: vi.fn(), isRefetching: false };
  return renderTree();
}

const KPI_LABELS = ["Completed Trips", "Punctuality", "On-Time", "Late", "Not Measured"];

// StatCard renders `<span … title={label}>{label}</span>`, and its value is the
// first paragraph after that span. Reading the card from its own label
// attribute is what makes a dropped card fail — a bare substring check cannot,
// because "On-Time" and "Late" are table headers too.
function kpiValue(html, label) {
  const at = html.indexOf(`title="${label}"`);
  if (at === -1) return null;
  const match = html.slice(at).match(/<p[^>]*>([^<]*)<\/p>/);
  return match ? match[1].trim() : null;
}

beforeEach(() => {
  // This repo's Vitest JSX transform uses the classic React runtime.
  vi.stubGlobal("React", React);
  state.query = { data: undefined, isLoading: true, isError: false, refetch: vi.fn(), isRefetching: false };
});
afterEach(() => vi.unstubAllGlobals());

describe("buildPunctualitySummary", () => {
  it("weights the fleet rate by measured trips, not by averaging per-driver rates", () => {
    // 8/8 = 100% and 0/2 = 0%. The unweighted mean of those two rates is 50%;
    // the honest fleet figure is 8/10.
    const details = [
      driver({ driver_id: 1, completed_trips: 8, measured_trips: 8, on_time_trips: 8, late_trips: 0 }),
      driver({ driver_id: 2, completed_trips: 2, measured_trips: 2, on_time_trips: 0, late_trips: 2 }),
    ];
    const summary = buildPunctualitySummary(details);
    expect(summary.measuredTrips).toBe(10);
    expect(summary.onTimeTrips).toBe(8);
    expect(summary.onTimeRate).toBe(80);
    expect(summary.onTimeRate).not.toBe(50);
  });

  it("totals the three donut slices to Completed by folding overrides into the gray slice", () => {
    // The payload's unmeasuredTrips EXCLUDES overrides
    // (unmeasured = completed - measured - override), so a gray slice built
    // from unmeasuredTrips alone would leave the ring short of its centre.
    const details = [
      driver({ driver_id: 1, completed_trips: 10, measured_trips: 6, on_time_trips: 5, late_trips: 1, override_trips: 2, unmeasured_trips: 2 }),
      driver({ driver_id: 2, completed_trips: 4, measured_trips: 3, on_time_trips: 2, late_trips: 1, override_trips: 0, unmeasured_trips: 1 }),
    ];
    const summary = buildPunctualitySummary(details);
    expect(summary.onTimeTrips).toBe(7);
    expect(summary.lateTrips).toBe(2);
    expect(summary.overrideTrips).toBe(2);
    expect(summary.unmeasuredTrips).toBe(3);
    expect(summary.notMeasuredTrips).toBe(5); // 3 unmeasured + 2 override
    expect(summary.onTimeTrips + summary.lateTrips + summary.notMeasuredTrips).toBe(summary.totalCompletedTrips);
    expect(summary.totalCompletedTrips).toBe(14);
  });

  it("reports a null rate when nothing was measured", () => {
    const summary = buildPunctualitySummary([driver({ completed_trips: 3, measured_trips: 0, on_time_trips: 0, late_trips: 0, override_trips: 0 })]);
    expect(summary.onTimeRate).toBeNull();
    expect(summary.measuredTrips).toBe(0);
  });

  it("survives a missing details array", () => {
    const summary = buildPunctualitySummary(undefined);
    expect(summary.totalCompletedTrips).toBe(0);
    expect(summary.onTimeRate).toBeNull();
    expect(summary.onTimeTrips).toBe(0);
  });
});

describe("Driver Performance Center", () => {
  it("renders the five KPI cards", () => {
    const html = render(payload([driver()]));
    // Scoped to each card's own label attribute, not to a loose substring:
    // "On-Time" and "Late" also occur as table headers, so deleting those two
    // cards used to leave this assertion green.
    for (const label of KPI_LABELS) {
      expect(html, `KPI card "${label}" is missing`).toContain(`title="${label}"`);
    }
  });

  it("takes the fleet completed total from the server payload, not from the row sum", () => {
    // The rows below sum to 14 completed trips; the payload deliberately says
    // 99. Rendering 14 here is what re-deriving the aggregate from `details`
    // looks like — and it is what would silently desynchronise this page from
    // the other reports surfaces once they read the same payload.
    const data = payload([
      driver({ driver_id: 1, completed_trips: 10, measured_trips: 6, on_time_trips: 5, late_trips: 1, override_trips: 2, unmeasured_trips: 2 }),
      driver({ driver_id: 2, name: "Ben Cruz", completed_trips: 4, measured_trips: 3, on_time_trips: 2, late_trips: 1, override_trips: 0 }),
    ]);
    data.totalCompletedTrips = 99;
    const html = render(data);
    expect(kpiValue(html, "Completed Trips")).toBe("99");
    // The ring and its caption describe the same fleet as the headline, so they
    // read the same total rather than contradicting it.
    expect(html).toContain("of 99 completed trips");
    // The fleet rate has no payload counterpart at fleet level, so it is still
    // the weighted ratio of the rows: (5 + 2) / (6 + 3).
    expect(kpiValue(html, "Punctuality")).toBe("78%");
  });

  it("shows the weighted fleet rate with its raw counts, never an average of per-driver rates", () => {
    const html = render(payload([
      driver({ driver_id: 1, name: "Ana Reyes", completed_trips: 8, measured_trips: 8, on_time_trips: 8, late_trips: 0 }),
      driver({ driver_id: 2, name: "Ben Cruz", completed_trips: 2, measured_trips: 2, on_time_trips: 0, late_trips: 2 }),
    ]));
    expect(html).toContain("80%");
    expect(html).toContain("8 of 10");
    // The unweighted mean of 100% and 0% would be 50% — it must not appear.
    expect(html).not.toContain("50%");
  });

  it("renders the — empty state when the fleet measured nothing, never 0%", () => {
    const html = render(payload([
      driver({ completed_trips: 2, measured_trips: 0, on_time_trips: 0, late_trips: 0, override_trips: 0, punctuality_rate: null, avg_late_minutes: null }),
    ]));
    expect(html).toContain("—");
    expect(html).toContain("No measured trips");
    expect(html).not.toContain("0%");
    expect(html).not.toContain("NaN");
  });

  it("renders the — empty state when no trip was completed, never 0%", () => {
    const html = render(payload([
      driver({ completed_trips: 0, measured_trips: 0, on_time_trips: 0, late_trips: 0, override_trips: 0, punctuality_rate: null, avg_late_minutes: null }),
    ]));
    expect(html).toContain("No completed trips");
    expect(html).toContain("—");
    expect(html).not.toContain("0%");
    expect(html).not.toContain("NaN");
  });

  it("does not render the retired Score column or its tooltip", () => {
    const html = render(payload([driver()]));
    expect(html).not.toContain("Score");
    expect(html).not.toContain("score");
    expect(html).not.toContain("smooth-driving");
    expect(html).not.toContain("Cost/km");
    expect(html).not.toContain("Distance");
    expect(html).not.toContain("Incidents");
  });

  it("renders the punctuality table columns", () => {
    const html = render(payload([driver()]));
    // The plan's column contract, read back from the rendered headers in order.
    // A bare substring check cannot carry this: every label here also occurs in
    // the KPI band, the ring centre or the table title, so the previous version
    // passed against a table with Completed / On-Time / Late deleted and the
    // rate column relabelled "On-Time" — the exact drift this task repaired.
    const headers = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim()
    );
    expect(headers).toEqual(["Driver", "Status", "Completed", "Punctuality", "On-Time", "Late", "Avg Late", "View"]);
    expect(html).toContain("88%");
    expect(html).toContain("+12.4 min");
    // The View cell keeps the profile affordance the previous page carried.
    // (The "View Driver Profile" tooltip body itself is portal-rendered on
    // hover and so is absent from static markup — the button's own label is
    // what can be asserted here.)
    expect(html).toContain('aria-label="View Juan Dela Cruz profile"');
    expect(html).toContain("lucide-eye");
  });

  it("keeps the ring decorative and carries the distribution as plain text", () => {
    const html = render(payload([
      driver({ driver_id: 1, completed_trips: 10, measured_trips: 6, on_time_trips: 5, late_trips: 1, override_trips: 2, unmeasured_trips: 2 }),
      driver({ driver_id: 2, name: "Ben Cruz", completed_trips: 4, measured_trips: 3, on_time_trips: 2, late_trips: 1, override_trips: 0 }),
    ]));
    // The donut is invisible to assistive technology on purpose — it is the
    // colour-coded ring only. The numbers live in the KPI cards and the caption.
    expect(html).toMatch(/<div[^>]*id="punctuality-donut"[^>]*aria-hidden="true"/);
    expect(html).toContain("7 on-time, 2 late, 5 not measured of 14 completed trips");
  });

  it("resolves driver photos from face_image_url / avatar_url and falls back to initials", () => {
    const html = render(payload([
      driver({ driver_id: 1, name: "Ana Reyes", face_image_url: "https://cdn.test/ana.jpg", avatar_url: null }),
      driver({ driver_id: 2, name: "Ben Cruz", face_image_url: null, avatar_url: "https://cdn.test/ben.jpg" }),
      driver({ driver_id: 3, name: "Cy Lim", face_image_url: null, avatar_url: null }),
    ]));
    expect(html).toContain('src="https://cdn.test/ana.jpg"');
    expect(html).toContain('src="https://cdn.test/ben.jpg"');
    expect(html).toContain("CL");
  });

  it("renders the error panel instead of all-zero KPIs when the report fails", () => {
    state.query = { data: undefined, isLoading: false, isError: true, refetch: vi.fn(), isRefetching: false };
    const html = renderTree();
    expect(html).toContain("Couldn&#x27;t load driver performance data");
  });
});
