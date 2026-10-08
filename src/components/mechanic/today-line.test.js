import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { summaryPayload, emptySummary } from "./test-fixtures";

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
    state.queries = { mechanicSummary: { data: summaryPayload(), isLoading: false } };
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
    // Predictive whisper read-only fallback
    expect(html).toContain("No upcoming maintenance");
  });

  it("zero-jobs payload renders EmptyState, not empty cards", () => {
    state.queries = { mechanicSummary: { data: emptySummary(), isLoading: false } };
    const html = render();
    expect(html).toContain("The line is clear");
    expect(html).not.toContain("ABC 1234");
    expect(html).not.toContain("XYZ 9876");
  });
});
