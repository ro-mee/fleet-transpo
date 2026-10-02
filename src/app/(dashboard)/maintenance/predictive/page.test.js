import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ query: {} }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => state.query }));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({ authorized: true }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children }) => children }));

vi.stubGlobal("React", React);
const { default: PredictiveMaintenancePage } = await import("./page");

describe("predictive maintenance request states", () => {
  it("does not present zero health counts before the vehicle query resolves", () => {
    state.query = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    const html = renderToStaticMarkup(React.createElement(PredictiveMaintenancePage));
    expect(html).toContain("Loading vehicle predictions");
    expect(html).not.toContain("No maintenance predictions match filter");
  });

  it("explains a genuinely empty eligible fleet separately from work orders", () => {
    state.query = {
      data: { predictions: [], summary: { total: 0, overdue: 0, critical: 0, high: 0, medium: 0, low: 0, unscheduled: 0 } },
      isLoading: false, isError: false, refetch: vi.fn(),
    };
    const html = renderToStaticMarkup(React.createElement(PredictiveMaintenancePage));
    expect(html).toContain("No eligible vehicles to assess");
    expect(html).toContain("Maintenance work orders are counted separately");
  });
});
