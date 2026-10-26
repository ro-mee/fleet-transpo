import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ query: {} }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => state.query, useQueryClient:()=>({invalidateQueries:vi.fn()}) }));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({ authorized: true }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children }) => children }));

vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({employee:{roles:{role_name:"fleet_manager"}}})}));
vi.mock("@/components/ui/toast",()=>({toast:{success:vi.fn(),error:vi.fn()}}));
vi.stubGlobal("React", React);
const { default: PredictiveMaintenancePage } = await import("./page");

describe("predictive maintenance route", () => {
  it("labels loading before evidence resolves", () => {
    state.query={isLoading:true};
    expect(renderToStaticMarkup(React.createElement(PredictiveMaintenancePage))).toContain("Loading service outlook");
  });
  it("keeps empty eligible fleet separate from completed work and physical condition", () => {
    state.query={data:{predictions:[],summary:{total:0}},isLoading:false};
    const html=renderToStaticMarkup(React.createElement(PredictiveMaintenancePage));
    expect(html).toContain("No eligible vehicles to assess");expect(html).toContain("Maintenance work orders are counted separately");expect(html).toContain("does not establish vehicle availability or completed work");
  });
});
