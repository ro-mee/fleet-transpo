import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The queue's own render path is exercised with the query result as the only
// state it reads, matching the other dashboard page tests.
const state = vi.hoisted(() => ({ query: {} }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => state.query,
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
// HeroHeader reads the theme; the provider lives in the dashboard layout.
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
// The copilot panel is permission-gated and pulls in its own query/mutation
// surface; `recommend` is denied here so the queue's own markup is what renders.
vi.mock("@/hooks/use-role-access", () => ({
  useRoleAccess: () => ({ can: () => false }),
}));
vi.mock("@/hooks/use-dispatch-plan", () => ({
  useDispatchPlan: () => ({ getProposal: () => null, bucketProposal: () => null, setStale: vi.fn() }),
}));
vi.mock("@/components/reservations/dispatch-plan-panel", () => ({ DispatchPlanPanel: () => null }));
// The rows are asserted through their reservation numbers, so the card/table
// component (and its framer-motion dependency) is replaced with a marker.
vi.mock("@/components/reservations/reservation-queue-table", () => ({
  ReservationQueueTable: ({ requests }) =>
    React.createElement("div", null, requests.map((r) => r.reservation_number).join(",")),
  ReservationQueueTableSkeleton: () => React.createElement("div", null, "loading rows"),
}));
vi.mock("@/services/transport.service", () => ({
  getTransportRequests: vi.fn(),
  cancelRequest: vi.fn(),
  pullTransportRequests: vi.fn(),
}));

// Classic-runtime JSX reaches for a global React at import time (the toast
// module builds an icon map at module scope), so the global goes in first.
vi.stubGlobal("React", React);
const { default: UnifiedQueuePage } = await import("./page");
const { TooltipProvider } = await import("@/components/ui/tooltip");

const ROW = {
  request_id: 501,
  reservation_number: "RS-G07O",
  guest_name: "Alexander Wright",
  fleet_status: "Pending",
  pickup_location: "NAIA Terminal 2 - Arrivals",
  dropoff_location: "CoCo Star Hotel",
  pickup_datetime: "2026-09-15T16:00:00.000Z",
  passenger_count: 2,
};

// The tab buttons are the only elements carrying role="tab" before the
// list/grid switcher (which is aria-pressed, not a tablist). Attribute values
// come back HTML-escaped from the static render, so `&amp;` is decoded.
function tabs(html) {
  return [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((match) => ({
    label: (match[0].match(/aria-label="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&"),
    selected: /aria-selected="true"/.test(match[0]),
  }));
}

function renderTree() {
  return renderToStaticMarkup(
    React.createElement(TooltipProvider, null, React.createElement(UnifiedQueuePage))
  );
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.query = {
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: vi.fn(),
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("Unified queue — first load", () => {
  it("shows a loading count instead of 0 before the first response", () => {
    const html = renderTree();
    const rendered = tabs(html);
    expect(rendered).toHaveLength(6);
    // Every badge is the loading glyph; a single "(0)" would read as an empty
    // queue and is the reported symptom.
    expect(html).toContain("(…)");
    expect(html).not.toContain("(0)");
    for (const tab of rendered) expect(tab.label).toMatch(/— count loading$/);
  });

  it("highlights Today while Today is what is being fetched", () => {
    const rendered = tabs(renderTree());
    const selected = rendered.filter((tab) => tab.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0].label).toBe("Today — count loading");
  });
});

describe("Unified queue — loaded", () => {
  it("shows the short Today label while explaining its scope in the tooltip", () => {
    // QUEUE_TAB_PREDICATES.today is `pickup <= today (Asia/Manila)`, so the tab
    // still holds overdue work even with the short label.
    state.query = {
      data: {
        rows: [ROW],
        total: 1,
        counts: { tabs: { today: 6, upcoming: 0, assigned: 1, inProgress: 0, completed: 6, cancelled: 9 } },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    const html = renderTree();
    const rendered = tabs(html);
    expect(rendered.map((tab) => tab.label)).toContain("Today — 6 requests");
    expect(rendered.map((tab) => tab.label)).toContain("Cancelled — 9 requests");
    expect(html).toContain("Pickup today or already past");
  });

  it("keeps the highlight on the tab whose rows are on screen, not the tab with work", () => {
    // Counts say the work is Upcoming; the query fetched Today (that is the tab
    // in the query key this render). Highlighting Upcoming here is exactly the
    // mismatch that showed one tab selected over another tab's rows.
    state.query = {
      data: {
        rows: [ROW],
        total: 1,
        counts: { tabs: { today: 0, upcoming: 5, assigned: 0, inProgress: 0, completed: 0, cancelled: 0 } },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    const html = renderTree();
    expect(html).toContain("RS-G07O");
    const selected = tabs(html).filter((tab) => tab.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0].label).toBe("Today — 0 requests");
  });

  it("reports a genuine zero once the response has landed", () => {
    state.query = {
      data: {
        rows: [],
        total: 0,
        counts: { tabs: { today: 0, upcoming: 0, assigned: 0, inProgress: 0, completed: 0, cancelled: 0 } },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    const html = renderTree();
    expect(html).toContain("(0)");
    expect(html).not.toContain("(…)");
    expect(html).toContain("Nothing today");
  });
});
