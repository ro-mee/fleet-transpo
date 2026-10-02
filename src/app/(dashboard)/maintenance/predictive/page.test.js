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
    expect(html).toContain("Loading service outlook");
    expect(html).not.toContain("No maintenance predictions match filter");
  });

  it("explains a genuinely empty eligible fleet separately from work orders", () => {
    state.query = {
      data: { predictions: [], summary: { total: 0, overdue: 0, critical: 0, high: 0, medium: 0, low: 0, unscheduled: 0 } },
      isLoading: false, isError: false, refetch: vi.fn(),
    };
    const html = renderToStaticMarkup(React.createElement(PredictiveMaintenancePage));
    expect(html).toContain("Service Schedule Outlook");
    expect(html).toContain("No eligible vehicles to assess");
    expect(html).toContain("Maintenance work orders are counted separately");
    expect(html).toContain("do not measure physical vehicle condition");
  });

  it("states when the score is calendar-only or has enough 90-day trip history", () => {
    state.query = {
      data: {
        predictions: [
          {
            vehicle_id: 1,
            plate_number: "ABC-1234",
            vehicle_name: "Van",
            risk: "low",
            score: 25,
            basis: "time",
            confidence: "high",
            effectiveDays: 120,
            mileage: 42000,
            next_service_date: "2027-01-01",
            next_service_mileage: null,
            kmToService: null,
            recommendation: "Service is not due soon.",
          },
          {
            vehicle_id: 2,
            plate_number: "XYZ-9876",
            vehicle_name: "Van",
            risk: "medium",
            score: 45,
            basis: "time",
            confidence: "low",
            effectiveDays: 60,
            mileage: 18000,
            next_service_date: "2026-12-01",
            next_service_mileage: null,
            kmToService: null,
            recommendation: "Plan the next service.",
          },
        ],
        summary: { total: 2, overdue: 0, critical: 0, high: 0, medium: 1, low: 1, unscheduled: 0 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };

    const html = renderToStaticMarkup(React.createElement(PredictiveMaintenancePage));

    expect(html).toContain("90-day trip sample supports mileage estimates");
    expect(html).toContain("Calendar only — limited trip telemetry");
    expect(html).not.toContain("Health Rating");
  });
});
