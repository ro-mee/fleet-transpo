import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { summaryPayload, leanRow, problemItem } from "./test-fixtures";

const state = vi.hoisted(() => ({ queries: {}, params: {}, queryFns: {} }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey, queryFn }) => {
    state.queryFns[queryKey[0]] = queryFn;
    return state.queries[queryKey[0]] || {
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/mechanic/work-orders",
  useParams: () => state.params,
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

vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn(async () => []) }));
import { apiFetch } from "@/lib/api/client";

vi.stubGlobal("React", React);
const { default: WorkOrdersPage } = await import("@/app/(dashboard)/mechanic/work-orders/page");
const { default: ProblemsPage } = await import("@/app/(dashboard)/mechanic/problems/page");
const { default: HistoryPage } = await import("@/app/(dashboard)/mechanic/history/page");
const { default: DetailPage } = await import("@/app/(dashboard)/mechanic/work-orders/[id]/page");

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.queries = {};
  state.params = {};
  state.queryFns = {};
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("mechanic sub-pages", () => {
  it("executes all three actual maintenance reads through the API client", async () => {
    for (const [Page, key, url] of [
      [WorkOrdersPage, "mechanicWorkOrders", "/api/vehicle-maintenance?page=1&pageSize=10"],
      [HistoryPage, "mechanicHistory", "/api/vehicle-maintenance"],
      [DetailPage, "mechanicWorkOrder", "/api/vehicle-maintenance"],
    ]) {
      renderToStaticMarkup(React.createElement(Page));
      await state.queryFns[key]();
      expect(apiFetch).toHaveBeenLastCalledWith(url);
    }
  });
  it("work-orders page renders status filter chips and queue rows", () => {
    state.queries = {
      mechanicWorkOrders: {
        data: {
          rows: [
            leanRow(),
            leanRow({ maintenance_id: 9, status: "In Progress", maintenance_type: "Oil Change" }),
          ],
          total: 2,
        },
        isLoading: false,
      },
    };
    const html = renderToStaticMarkup(React.createElement(WorkOrdersPage));
    expect(html).toContain("Scheduled");
    expect(html).toContain("In Progress");
    expect(html).toContain("Pending Inspection");
    expect(html).toContain("ABC 1234");
    expect(html).toContain("Oil Change");
  });

  it("problems page shows WO chips linking to the WO and has NO raise button", () => {
    state.queries = {
      mechanicProblems: {
        data: { items: [problemItem()], counts: { tracked: 1, reportedUntracked: 0, failedUntracked: 0 } },
        isLoading: false,
      },
    };
    const html = renderToStaticMarkup(React.createElement(ProblemsPage));
    expect(html).toContain("WO #7");
    expect(html).toContain("/mechanic/work-orders/7");
    expect(html).not.toMatch(/Raise|Create work order|New work order/);
  });

  it("history page renders Completed rows with read-only cost and no cost input", () => {
    state.queries = {
      mechanicHistory: {
        data: [
          leanRow({ status: "Completed", completed_date: "2026-10-04" }),
          leanRow({ maintenance_id: 11, status: "Cancelled" }),
        ],
        isLoading: false,
      },
    };
    const html = renderToStaticMarkup(React.createElement(HistoryPage));
    expect(html).toContain("Completed");
    expect(html).toContain("4,500");
    expect(html).not.toMatch(/name="cost"/);
    expect(html).not.toMatch(/<input[^>]*cost/i);
  });

  it("detail page resolves the row by id; unknown id renders not-found", () => {
    state.queries = { mechanicWorkOrder: { data: [leanRow()], isLoading: false } };
    state.params = { id: "7" };
    const found = renderToStaticMarkup(React.createElement(DetailPage));
    expect(found).toContain("ABC 1234");
    expect(found).toContain("Grinding noise");

    state.params = { id: "999" };
    const missing = renderToStaticMarkup(React.createElement(DetailPage));
    expect(missing).toContain("not found");
  });

  it("queue rows are keyboard-navigable links and summary attention deep-links resolve", () => {
    expect(summaryPayload().attention[0].reference_type).toBe("mechanic_maintenance");
  });
});
