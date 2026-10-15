import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { summaryPayload, emptySummary, predictivePayload } from "./test-fixtures";

const state = vi.hoisted(() => ({ queries: {} }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }) =>
    state.queries[queryKey[0]] || {
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/mechanic",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: ({ children }) => children }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    employee: { first_name: "Ramon", roles: { role_name: "mechanic" } },
    user: { firstName: "Ramon" },
    loading: false,
  }),
}));
vi.mock("@/lib/auth/role-guard", () => ({
  useRequireRole: () => ({ authorized: true, role: "mechanic", loading: false, missingRole: false }),
}));
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => ({ children }) => children }),
  MotionConfig: ({ children }) => children,
  AnimatePresence: ({ children }) => children,
  animate: () => ({ stop: () => {} }),
}));

vi.stubGlobal("React", React);
const { default: MechanicPage } = await import("@/app/(dashboard)/mechanic/page");
const { SideRail } = await import("./side-rail");
const { isActionablePrediction } = await import("./mechanic-actions");

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.queries = {};
});
afterEach(() => vi.unstubAllGlobals());

function render() {
  return renderToStaticMarkup(React.createElement(MechanicPage));
}

describe("Today's Line dashboard", () => {
  it("renders ShiftStrip + HeroJobCard + JobQueue + SideRail from the canned summary", () => {
    state.queries = {
      mechanicSummary: { data: summaryPayload(), isLoading: false },
      mechanicPredictive: { data: { predictions: [] }, isLoading: false },
    };
    const html = render();
    // HeroHeader shift line
    expect(html).toContain("3 assigned");
    expect(html).toContain("1 urgent");
    // Hero job (upNext plate, lead)
    expect(html).toContain("ABC 1234");
    // Queue second row
    expect(html).toContain("XYZ 9876");
    // Attention feed title
    expect(html).toContain("Work order assigned");
    // Source chips are display-only badges, never staff-route links.
    expect(html).toContain("Inspection #31");
    expect(html).toContain("Incident #18");
    expect(html).not.toContain("/incidents");
    // Empty predictive read keeps the whisper fallback.
    expect(html).toContain("No upcoming maintenance");
  });

  it("empty predictive envelope keeps the whisper fallback (summary upcoming stays [])", () => {
    state.queries = {
      mechanicSummary: { data: summaryPayload(), isLoading: false },
      mechanicPredictive: { data: predictivePayload({ predictions: [] }), isLoading: false },
    };
    const html = render();
    expect(html).toContain("No upcoming maintenance");
  });

  it("populated predictive rows render actionable items and drop the rest", () => {
    state.queries = {
      mechanicSummary: { data: summaryPayload(), isLoading: false },
      mechanicPredictive: { data: predictivePayload(), isLoading: false },
    };
    const html = render();
    // Actionable rows surface with their due labels…
    expect(html).toContain("GHI 8901");
    expect(html).toContain("overdue by 3 days");
    expect(html).toContain("DEF 4567");
    expect(html).toContain("due in 3 days");
    // …while far-out (60d) and unscheduled (null basis) rows are filtered out…
    expect(html).not.toContain("JKL 2345");
    expect(html).not.toContain("MNO 6789");
    // …so the empty-state fallback is gone.
    expect(html).not.toContain("No upcoming maintenance");
  });

  it("zero-jobs payload renders EmptyState, not empty cards", () => {
    state.queries = { mechanicSummary: { data: emptySummary(), isLoading: false } };
    const html = render();
    expect(html).toContain("The line is clear");
    expect(html).not.toContain("ABC 1234");
    expect(html).not.toContain("XYZ 9876");
  });

  it("shows predictive loading instead of an empty maintenance claim", () => {
    state.queries = {
      mechanicSummary: { data: summaryPayload(), isLoading: false },
      mechanicPredictive: { isLoading: true },
    };
    expect(render()).toContain("Loading upcoming maintenance");
    expect(render()).not.toContain("No upcoming maintenance");
  });

  it("shows predictive failure even when no actionable jobs remain", () => {
    state.queries = {
      mechanicSummary: { data: emptySummary(), isLoading: false },
      mechanicPredictive: { isError: true, error: new Error("offline") },
    };
    // Empty line wins at page level: the SideRail (which owns the predictive
    // strip) only mounts when a job is selected.
    expect(render()).toContain("The line is clear");
    // The error state itself is pinned on the SideRail in isolation.
    const rail = renderToStaticMarkup(
      React.createElement(SideRail, { job: null, upcoming: [], upcomingError: true })
    );
    expect(rail).toContain("Upcoming maintenance unavailable");
  });

  it("keeps predictive items visible when the actionable line is clear", () => {
    state.queries = {
      mechanicSummary: { data: emptySummary(), isLoading: false },
      mechanicPredictive: { data: predictivePayload(), isLoading: false },
    };
    expect(render()).toContain("The line is clear");
    // Predictive rows stay renderable in the rail even with a clear line.
    const rows = predictivePayload().predictions.filter((p) => isActionablePrediction(p));
    const rail = renderToStaticMarkup(
      React.createElement(SideRail, { job: null, upcoming: rows })
    );
    expect(rail).toContain("overdue by 3 days");
  });
});
