import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Task 6 (P1-10, P2-01, P2-02, P2-09, P2-10, P2-12): reflow by usable width,
// honest queue semantics, announced loading/failure, operator-grade targets.
//
// `queueHtml` below is the real rendered queue page (data/loading/error states
// are driven through the mocked query), not a hand-built string — so the three
// verbatim brief assertions prove the shipped markup, not the test's fixture.
const queryState = vi.hoisted(() => ({
  query: { data: undefined, isLoading: true, isError: false, error: null, refetch: () => {} },
  mutation: { mutate: () => {}, isPending: false },
}));
const planState = vi.hoisted(() => ({
  plan: {
    getProposal: () => null,
    bucketProposal: () => "Not evaluated",
    setStale: () => {},
    analyze: { mutateAsync: async () => {}, isPending: false },
    plan: null,
    validation: null,
    invalidReason: null,
    failure: null,
  },
}));
const panelState = vi.hoisted(() => ({ props: [] }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState.query,
  useMutation: () => queryState.mutation,
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {} }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("next/link", () => ({
  default: (props) => React.createElement("a", { href: props.href }, props.children),
}));
// HeroHeader reads the theme; the provider lives in the dashboard layout.
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: () => {}, toggleTheme: () => {} }),
}));
vi.mock("@/hooks/use-role-access", () => ({ useRoleAccess: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-dispatch-plan", () => ({ useDispatchPlan: () => planState.plan }));
vi.mock("@/services/transport.service", () => ({
  getTransportRequests: async () => ({}),
  cancelRequest: async () => ({}),
  pullTransportRequests: async () => ({}),
}));
vi.mock("@/components/ui/toast", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/components/reservations/dispatch-plan-panel", () => ({
  DispatchPlanPanel: (props) => {
    panelState.props.push(props);
    return null;
  },
}));

import UnifiedQueuePage from "@/app/(dashboard)/reservations/queue/page";
import {
  ReservationQueueTable,
  ReservationQueueTableSkeleton,
} from "./reservation-queue-table";
import { CopilotOptionFlow } from "./copilot-option-flow";
import { EvidenceFailureMessage } from "./evidence-drawer";
import { CopilotConversation } from "./copilot-conversation";
import {
  WORKSPACE_ASIDE_MIN_WIDTH,
  meetsAsideThreshold,
  useWorkspaceAside,
} from "@/hooks/use-workspace-aside";

// Browser-fixture rows: long guest/category/route strings that must survive the
// narrow queue column as wrapped two-line text with full accessible names —
// the 1280/1366/1920px split and 390px single-column cases from the brief.
const LONG_GUEST =
  "Alexandra Constantine Worthington-Smythe III with an exceptionally long family name";
const LONG_PICKUP =
  "Ninoy Aquino International Airport Terminal 3 Arrival Bay 7 Passenger Pickup Zone";
const LONG_DROPOFF =
  "Shangri-La at the Fort Bonifacio Global City Taguig Presidential Suite Lobby Entrance";
const LONG_CATEGORY = "Premium Executive Van for Large Group Airport Transfer Service";

const LONG_REQUEST = {
  request_id: 901,
  reservation_number: "RS-LONG1",
  guest_name: LONG_GUEST,
  passenger_count: 5,
  luggage_count: null,
  pickup_datetime: "2026-10-07T08:30:00+08:00",
  pickup_location: LONG_PICKUP,
  dropoff_location: LONG_DROPOFF,
  fleet_status: "Scheduled",
  requested_vehicle_type: LONG_CATEGORY,
};
const SHORT_REQUEST = {
  request_id: 902,
  reservation_number: "RS-SHORT2",
  guest_name: "Maria Clara",
  passenger_count: 2,
  luggage_count: 2,
  pickup_datetime: "2026-10-07T09:00:00+08:00",
  pickup_location: "Hotel Lobby",
  dropoff_location: "NAIA Terminal 1",
  fleet_status: "Scheduled",
  requested_vehicle_type: "Sedan",
};
const READY_COUNTS = {
  today: 2,
  upcoming: 0,
  assigned: 0,
  inProgress: 0,
  completed: 0,
  cancelled: 0,
};

function readyQuery(rows = [LONG_REQUEST, SHORT_REQUEST]) {
  queryState.query = {
    data: { rows, total: rows.length, counts: { tabs: READY_COUNTS } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  };
}
function loadingQuery() {
  queryState.query = { data: undefined, isLoading: true, isError: false, error: null, refetch: () => {} };
}
function errorQuery() {
  queryState.query = {
    data: undefined,
    isLoading: false,
    isError: true,
    error: new Error("Queue polling failed"),
    refetch: () => {},
  };
}

const renderPage = () => {
  panelState.props = [];
  return renderToStaticMarkup(React.createElement(UnifiedQueuePage));
};
const renderTable = (requests = [LONG_REQUEST, SHORT_REQUEST], props = {}) =>
  renderToStaticMarkup(
    React.createElement(ReservationQueueTable, {
      requests,
      selectedId: 901,
      onSelect: () => {},
      ...props,
    })
  );

beforeEach(() => {
  vi.stubGlobal("React", React);
  readyQuery();
});
afterEach(() => vi.unstubAllGlobals());

describe("Task 6 brief verbatim queue assertions", () => {
  it("names the queue list, drops false tab semantics, and keeps honest luggage copy", () => {
    const queueHtml = renderPage();
    expect(queueHtml).toContain('aria-label="Transportation requests"');
    expect(queueHtml).not.toContain('role="tablist"');
    expect(queueHtml).toContain("Bags not recorded");
  });
});

describe("measured workspace layout (P1-10)", () => {
  it("fixes the aside threshold at 1120 CSS px: 460 aside + 24 gap + 636 queue", () => {
    expect(WORKSPACE_ASIDE_MIN_WIDTH).toBe(1120);
    expect(meetsAsideThreshold(1119)).toBe(false);
    expect(meetsAsideThreshold(1120)).toBe(true);
    expect(meetsAsideThreshold(1920)).toBe(true);
    expect(meetsAsideThreshold(undefined)).toBe(false);
    expect(meetsAsideThreshold(Number.NaN)).toBe(false);
  });

  it("first render reports narrow so SSR and hydration agree (no measured width yet)", () => {
    expect(typeof useWorkspaceAside).toBe("function");
    renderPage();
    // renderToStaticMarkup never runs effects, exactly like the server: the
    // hook must report false until the ResizeObserver measures after mount.
    expect(panelState.props.length).toBeGreaterThan(0);
    for (const props of panelState.props) expect(props.isDesktop).toBe(false);
  });

  it("keys the workspace switch off measured content, not the 1280px viewport", () => {
    const queueHtml = renderPage();
    expect(queueHtml).not.toContain("min-width:1280px");
    expect(queueHtml).not.toContain("(min-width: 1280px)");
  });

  it("lets hero actions wrap as independent children instead of one overflowing flex item", () => {
    const queueHtml = renderPage();
    expect(queueHtml).toContain("flex flex-wrap items-center gap-2 min-w-0");
  });
});

describe("queue collection semantics (P2-12)", () => {
  it("renders rows as a named list of real selection buttons", () => {
    const html = renderTable();
    expect(html).toContain('aria-label="Transportation requests"');
    expect(html).toContain("<ul");
    expect(html.match(/<ul\b/g)).toHaveLength(1);
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html).not.toContain('role="button"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("renders the grid variant as the same named list without nested controls", () => {
    const html = renderTable([LONG_REQUEST, SHORT_REQUEST], { viewMode: "grid" });
    expect(html).toContain('aria-label="Transportation requests"');
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html).not.toContain('role="button"');
  });
});

describe("queue row reflow (P1-10, P2-01)", () => {
  it("wraps long guest/category/route identity over two lines with full names intact", () => {
    const html = renderTable();
    expect(html).toContain("line-clamp-2");
    // The full operational identifiers stay in the DOM for AT and tooltips.
    expect(html).toContain(LONG_GUEST);
    expect(html).toContain(LONG_PICKUP);
    expect(html).toContain(LONG_DROPOFF);
  });

  it("drops the fixed 220px segments and viewport-keyed row switch for a container query", () => {
    const html = renderTable();
    expect(html).not.toContain("min-w-[220px]");
    expect(html).not.toContain("min-w-[130px]");
    const listSection = html.slice(html.indexOf("<ul"), html.indexOf("</ul>"));
    // Space-prefixed so the container query "@md:flex-row" (space then "@")
    // cannot match: only a real viewport " md:flex-row" fails here.
    expect(listSection).not.toContain(" md:flex-row");
    expect(listSection).not.toContain(" md:items-center");
    expect(listSection).toContain("@md:flex-row");
  });

  it("marks the queue column as the container rows respond to", () => {
    const queueHtml = renderPage();
    expect(queueHtml).toContain("@container");
  });
});

describe("filter controls without false tabs (P2-09)", () => {
  it("presents a labelled filter-button group with aria-pressed", () => {
    const queueHtml = renderPage();
    expect(queueHtml).toContain('role="group"');
    expect(queueHtml).toContain('aria-label="Queue sections"');
    expect(queueHtml).toContain("aria-pressed");
    expect(queueHtml).not.toContain('role="tab"');
    expect(queueHtml).not.toContain("aria-selected");
  });
});

describe("announced loading and failure (P2-10)", () => {
  it("marks the queue busy with a hidden loading status and motion-safe skeleton", () => {
    loadingQuery();
    const queueHtml = renderPage();
    expect(queueHtml).toContain('aria-busy="true"');
    expect(queueHtml).toContain('role="status"');
    expect(queueHtml).toContain("Loading transportation requests");
    const skeleton = renderToStaticMarkup(
      React.createElement(ReservationQueueTableSkeleton, { viewMode: "list" })
    );
    expect(skeleton).toContain("motion-safe:animate-pulse");
    const pulses = skeleton.match(/animate-pulse/g) || [];
    const safe = skeleton.match(/motion-safe:animate-pulse/g) || [];
    expect(pulses.length).toBe(safe.length);
  });

  it("announces queue failure with an honest alert", () => {
    errorQuery();
    const queueHtml = renderPage();
    expect(queueHtml).toContain('role="alert"');
    expect(queueHtml).toContain("Could not load the queue");
  });
});

describe("operator touch targets (P2-02)", () => {
  it("sizes filter tabs and row selection to 44px without undeclared Button sizes", () => {
    const queueHtml = renderPage();
    expect(queueHtml).toContain("min-h-[44px]");
    const table = renderTable();
    expect(table).toContain("min-h-[44px]");
  });

  it("gives the option choice control a 44px target", () => {
    const pair = {
      vehicle_id: 3,
      driver_id: 4,
      vehicle: { plate_number: "ABC-1234", vehicle_name: "HiAce", seating_capacity: 7 },
      driver: { driver_name: "Maria Santos" },
      checks: [{ id: "capacity", label: "Capacity", status: "verified", message: "Fits" }],
      readiness: "VERIFIED",
      feasibility: { verdict: "SAFE" },
      temporalContext: { horizon: "FUTURE", pickupAt: "2026-10-07T08:00:00+08:00" },
    };
    const html = renderToStaticMarkup(
      React.createElement(CopilotOptionFlow, {
        options: [{ pair, recommended: true }],
        busy: false,
        onChoose: () => {},
        now: Date.parse("2026-10-02T00:00:00Z"),
      })
    );
    expect(html).toContain("min-h-[44px]");
  });

  it("gives evidence retry/close a 44px target", () => {
    const html = renderToStaticMarkup(
      React.createElement(EvidenceFailureMessage, {
        error: new Error("snapshot fetch failed"),
        onRetry: () => {},
        onClose: () => {},
      })
    );
    expect(html).toContain("min-h-[44px]");
  });

  it("gives the conversation send control a 44px target", () => {
    const html = renderToStaticMarkup(
      React.createElement(CopilotConversation, { requestId: 901, hasPair: false })
    );
    expect(html).toContain("Send message");
    expect(html).toContain("h-11 w-11");
  });
});
