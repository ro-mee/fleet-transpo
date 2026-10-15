import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.stubGlobal("React", React);
const { EstimateRows, estimatesQueryString } = await import("./page");

vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({ authorized: true }) }));
const state = vi.hoisted(() => ({ data: null, isLoading: false, isError: false }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => state, useMutation: () => ({}), useQueryClient: () => ({}) }));
vi.mock("@/lib/api/client", () => ({ apiFetch: async () => state.data }));

const row = (over = {}) => ({
  trip_id: 7, end_time: "2026-10-03T10:00:00+08:00", actual_distance_km: "120.5",
  estimated_fuel_l: "13.400", estimated_fuel_cost: "1271.52", fuel_reference_price: "94.80",
  fuel_region: "NCR", fuel_estimate_reason: "priced", plate_number: "ABC1234",
  vehicle_name: "Van 1", fuel_type: "Diesel", source_url: "https://cdn.example/f/ncr.pdf", ...over,
});

describe("fuel estimates monitoring surface", () => {
  beforeEach(() => { state.data = null; state.isLoading = false; state.isError = false; });
  it("builds the estimates query string from filters", () => {
    expect(estimatesQueryString({ from: "2026-10-01", to: "2026-11-01", region: " NCR ", search: "" }))
      .toBe("/api/fuel/estimates?from=2026-10-01&to=2026-11-01&region=NCR");
    expect(estimatesQueryString({ from: "", to: "", region: "", search: "" })).toBe("/api/fuel/estimates");
  });
  it("lists estimates with trip links and falls back on missing prices", () => {
    const markup = renderToStaticMarkup(<EstimateRows rows={[row(), row({ trip_id: 8, estimated_fuel_cost: null, estimated_fuel_l: null, fuel_reference_price: null, fuel_estimate_reason: "no-price" })]} />);
    expect(markup).toContain('href="/trips/7"'); expect(markup).toContain("ABC1234");
    expect(markup).toContain("No estimate (no-price)");
  });
  it("shows the empty state when no estimates exist", () => {
    expect(renderToStaticMarkup(<EstimateRows rows={[]} />)).toContain("No estimates in range");
  });
});
