import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ queries: {} }));

// One query per dashboard panel, keyed by the first element of its queryKey.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }) =>
    state.queries[queryKey[0]] || { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard",
}));
// Static render: a real <Link> would need the app-router context, and the
// lazily-imported live map is not part of this assertion.
vi.mock("next/link", () => ({ default: ({ children }) => children }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
// motion-dom attaches document listeners as soon as it can see a `window`.
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => ({ children }) => children }),
  MotionConfig: ({ children }) => children,
  AnimatePresence: ({ children }) => children,
  animate: () => ({ stop: () => {} }),
}));

vi.stubGlobal("React", React);
const { RoleDashboard } = await import("@/components/dashboard/role-dashboard");

function driver(overrides = {}) {
  return {
    driver_id: 1,
    name: "Ana Reyes",
    face_image_url: null,
    avatar_url: null,
    driver_status: "Available",
    completed_trips: 12,
    measured_trips: 12,
    on_time_trips: 11,
    late_trips: 1,
    unmeasured_trips: 0,
    override_trips: 0,
    punctuality_rate: 92,
    avg_late_minutes: 4,
    max_late_minutes: 9,
    ...overrides,
  };
}

function render() {
  return renderToStaticMarkup(React.createElement(RoleDashboard, { role: "fleet_manager" }));
}

// The workload panel is the only place this page renders a driver's
// punctuality, so the "no fabricated 0%" check is scoped to it: the dashboard
// also draws bar widths and SVG gradient stops elsewhere, and a document-wide
// search cannot tell a value render apart from one of those. reports/page.js
// and executive/page.js scope the same assertion the same way. Returns "" when
// the panel is not found, so callers fail rather than pass vacuously.
function workloadPanelText(html) {
  // The panel title contains `&`, which React escapes to `&amp;` in the markup;
  // the slice runs to the next landmark below the panel. Both anchors are exact
  // strings, so a renamed panel yields "" and fails the assertion instead of
  // passing vacuously.
  const start = html.indexOf("Utilization &amp; workload");
  const end = html.indexOf("Defects without a work order", start);
  if (start === -1 || end === -1) return "";
  return html.slice(start, end).replace(/<[^>]+>/g, " ");
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.queries = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("Fleet Manager dashboard — driver workload panel", () => {
  it("orders the panel by completed trips, not by a retired total_trips field", () => {
    state.queries["driver-performance"] = {
      // Deliberately listed lightest-first: the panel ranks by completed trips,
      // so a comparator that reads a removed field (and therefore returns 0)
      // leaves this input order intact and fails below.
      data: { details: [driver({ driver_id: 2, name: "Ben Cruz", completed_trips: 4, measured_trips: 4, on_time_trips: 3, late_trips: 1, punctuality_rate: 75 }), driver({ driver_id: 1, name: "Ana Reyes", completed_trips: 12 })] },
      isLoading: false,
      isError: false,
    };
    const html = render();
    expect(html.indexOf("Ana Reyes")).toBeGreaterThan(-1);
    expect(html.indexOf("Ana Reyes")).toBeLessThan(html.indexOf("Ben Cruz"));
  });

  it("shows the completed count and the punctuality rate, never 0 trips / 0 km", () => {
    state.queries["driver-performance"] = {
      data: { details: [driver({ name: "Ana Reyes", completed_trips: 12, punctuality_rate: 92 })] },
      isLoading: false,
      isError: false,
    };
    const html = render();
    expect(html).toContain("12 trips · 92%");
    // The retired read: `total_trips` and `total_distance` are both gone from
    // the payload, so the old expression rendered a plausible "0 trips · 0 km".
    expect(html).not.toContain("0 trips · 0 km");
    expect(html).not.toContain("undefined");
  });

  it("renders — for a driver with no measured trips rather than 0%", () => {
    state.queries["driver-performance"] = {
      data: {
        details: [driver({ name: "Ana Reyes", completed_trips: 3, measured_trips: 0, on_time_trips: 0, late_trips: 0, punctuality_rate: null })],
      },
      isLoading: false,
      isError: false,
    };
    const html = render();
    const panel = workloadPanelText(html);
    expect(panel).toContain("3 trips · —");
    // Scoped to the panel, not the whole document: the retired read printed a
    // real "0%" in this row, but the page's decorative widths and gradient
    // stops are not value renders and must not be mistaken for one.
    expect(panel).not.toContain("0%");
  });
});
