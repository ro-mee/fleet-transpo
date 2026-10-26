import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ queries: {}, role: "admin" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }) => state.queries[queryKey[0]] }));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({ authorized: true, role: state.role }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("next/link", () => ({ default: ({ href, children }) => React.createElement("a", { href }, children) }));
vi.stubGlobal("React", React);
const { default: AiDashboardPage } = await import("./page");
const query = (data, extra = {}) => ({ data, isLoading: false, isError: false, refetch: vi.fn(), ...extra });
const render = () => renderToStaticMarkup(React.createElement(AiDashboardPage));

beforeEach(() => {
  state.role = "admin";
  state.queries = {
    "ai-insights": query({ insights: [] }),
    "ai-recommendations": query({ recommendations: [] }),
    "predictive-maintenance": query({ predictions: [], summary: { overdue: 0, critical: 0, high: 0 } }),
  };
});

describe("AI dashboard query honesty", () => {
  it("shows an insight request error with retry instead of an empty result", () => {
    state.queries["ai-insights"] = query(undefined, { isError: true, error: new Error("Unavailable") });
    const html = render();
    expect(html).toContain("Insights unavailable");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No active insights yet");
  });
  it("separates failed maintenance predictions from an empty eligible fleet", () => {
    state.queries["predictive-maintenance"] = query(undefined, { isError: true });
    const html = render();
    expect(html).toContain("Service outlook unavailable");
    expect(html).not.toContain("No eligible vehicles to assess");
    expect(html).not.toContain("No vehicles registered in telemetry");
  });
  it("names a recommendation failure even though it has no list panel", () => {
    state.queries["ai-recommendations"] = query(undefined, { isError: true });
    expect(render()).toContain("Recommendations unavailable");
  });
  it("does not show fabricated zero metrics during initial loading", () => {
    for (const key of Object.keys(state.queries)) state.queries[key] = query(undefined, { isLoading: true });
    const html = render();
    expect(html).toContain("Loading insights");
    expect(html).not.toContain("No active insights yet");
    expect(html).not.toMatch(/>0<\/span>/);
  });
  it("preserves a genuine successful empty response", () => {
    const html = render();
    expect(html).toContain("No active insights yet");
    expect(html).toContain("No eligible vehicles to assess");
    expect(html).not.toContain("unavailable");
  });
  it("does not offer management a maintenance route outside its permissions", () => {
    state.role = "management";
    const html = render();
    expect(html).not.toContain('href="/maintenance/predictive"');
    expect(html).toContain("Service outlook is available to fleet maintenance roles");
  });
});
