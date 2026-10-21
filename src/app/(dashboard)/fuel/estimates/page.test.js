import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.stubGlobal("React", React);
const { EstimateRows, estimatesQueryString, estimatePresets, describeRange, estimateExportRows, dailyChartData, receiptDelta, ESTIMATE_EXPORT_COLUMNS, default: FuelEstimatesPage } = await import("./page");

vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({ authorized: true }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
const state = vi.hoisted(() => ({ data: null, isLoading: false, isError: false }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => state, useMutation: () => ({}), useQueryClient: () => ({}) }));
vi.mock("@/lib/api/client", () => ({ apiFetch: async () => state.data }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }) => <div data-chart="container">{children}</div>,
  BarChart: ({ children }) => <div data-chart="bars">{children}</div>,
  Bar: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const row = (over = {}) => ({
  trip_id: 7, end_time: "2026-10-03T10:00:00+08:00", actual_distance_km: "120.5",
  estimated_fuel_l: "13.400", estimated_fuel_cost: "1271.52", fuel_reference_price: "94.80",
  fuel_region: "NCR", fuel_estimate_reason: "priced", fuel_estimate_captured_at: "2026-10-03T10:05:00+08:00",
  plate_number: "ABC1234", vehicle_name: "Van 1", fuel_type: "Diesel",
  source_url: "https://cdn.example/f/ncr.pdf", ...over,
});

describe("fuel estimates monitoring surface", () => {
  beforeEach(() => { state.data = null; state.isLoading = false; state.isError = false; });
  it("builds the estimates query string from filters", () => {
    expect(estimatesQueryString({ from: "2026-10-01", to: "2026-11-01", region: " NCR ", search: "" }))
      .toBe("/api/fuel/estimates?from=2026-10-01&to=2026-11-01&region=NCR");
    expect(estimatesQueryString({ from: "", to: "", region: "", search: "" })).toBe("/api/fuel/estimates");
  });
  it("lists estimates with trip links and names the missing price reason", () => {
    const markup = renderToStaticMarkup(<EstimateRows rows={[row(), row({ trip_id: 8, estimated_fuel_cost: null, estimated_fuel_l: null, fuel_reference_price: null, fuel_estimate_reason: "no-price" })]} />);
    expect(markup).toContain('href="/trips/7"'); expect(markup).toContain("ABC1234");
    expect(markup).toContain("No cost (no reference price)");
  });
  it("labels rows captured before estimates existed as not captured", () => {
    const markup = renderToStaticMarkup(<EstimateRows rows={[
      row({ trip_id: 9, estimated_fuel_l: null, estimated_fuel_cost: null, fuel_reference_price: null, fuel_estimate_reason: null, fuel_estimate_captured_at: null }),
    ]} />);
    expect(markup).toContain("No cost (Not captured)");
  });
  it("shows the empty state when no estimates exist", () => {
    expect(renderToStaticMarkup(<EstimateRows rows={[]} />)).toContain("No estimates in range");
  });
  it("summarises priced coverage and flags a truncated row page", () => {
    state.data = {
      rows: [row()],
      totals: { trips: 501, priced_trips: 480, estimated_cost: 61000, estimated_liters: 650.5 },
      truncated: true,
      from: "2026-10-01", to: "2026-10-31",
    };
    const markup = renderToStaticMarkup(<FuelEstimatesPage />);
    expect(markup).toContain("480 of 501");
    expect(markup).toContain("Showing the latest 500 of 501 completed trips");
  });
  it("keeps totals silent-looking markup off when nothing is loaded yet", () => {
    state.isLoading = true;
    const markup = renderToStaticMarkup(<FuelEstimatesPage />);
    expect(markup).toContain("Average cost per priced trip");
    expect(markup).not.toContain("Showing the latest 500");
  });
  it("walks pages for exports and names the applied range", () => {
    expect(estimatesQueryString({ from: "2026-10-01", to: "2026-10-31", page: 2 }))
      .toBe("/api/fuel/estimates?from=2026-10-01&to=2026-10-31&page=2");
    expect(describeRange("2026-10-01", "2026-10-31")).toBe("October 2026");
    expect(describeRange("2026-10-01", "2026-10-15")).toBe("Oct 1, 2026 – Oct 15, 2026");
  });
  it("derives preset ranges from the Manila calendar", () => {
    const presets = estimatePresets(new Date("2026-10-18T02:00:00Z"));
    expect(presets.map((preset) => preset.id)).toEqual(["this-month", "last-month", "last-30"]);
    expect(presets[0].range).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presets[1].range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presets[2].range).toEqual({ from: "2026-09-19", to: "2026-10-18" });
  });
  it("shows planned vs actual with a null-safe delta", () => {
    const markup = renderToStaticMarkup(<EstimateRows rows={[
      row({ planned_estimated_fuel_l: "13.111", planned_estimated_fuel_cost: "1241.15" }),
      row({ trip_id: 8, planned_estimated_fuel_l: null, planned_estimated_fuel_cost: null }),
    ]} />);
    expect(markup).toContain("Planned");
    expect(markup).toContain("Δ vs planned");
    expect(markup).toContain("13.111");
    expect(markup).toContain("₱1,241.15");
    expect(markup).toContain("0.29");
    expect(markup).toContain("₱30.37");
  });
  it("labels the distance provenance, price effectivity and source", () => {
    const markup = renderToStaticMarkup(<EstimateRows rows={[
      row({ distance_provenance: "odometer", effective_at: "2026-10-01T04:00:00Z", verification_method: "Manual" }),
    ]} />);
    expect(markup).toContain("Odometer");
    expect(markup).toContain("Effective");
    expect(markup).toContain("Manual");
    expect(markup).toContain('href="https://cdn.example/f/ncr.pdf"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });
  it("renders completion times on the Manila clock", () => {
    const markup = renderToStaticMarkup(<EstimateRows rows={[row({ end_time: "2026-10-31T22:00:00Z" })]} />);
    expect(markup).toContain("Nov 1, 2026");
    expect(markup).toContain("6:00");
  });
  it("flattens rows for export with the same honesty as the table", () => {
    const [priced, unpriced] = estimateExportRows([
      row({ planned_estimated_fuel_l: "13.111", planned_estimated_fuel_cost: "1241.15" }),
      row({ trip_id: 8, estimated_fuel_cost: null, estimated_fuel_l: null, fuel_reference_price: null, fuel_estimate_reason: "no-price" }),
    ]);
    expect(priced).toMatchObject({
      completed: expect.stringContaining("Oct 3, 2026"),
      status: "Priced",
      delta_fuel_l: 0.289,
      delta_cost: 30.37,
    });
    expect(unpriced.status).toBe("No cost (no reference price)");
  });
  it("shows coverage, cost per km and L/100km with their exact denominators", () => {
    state.data = {
      rows: [row()],
      totals: {
        trips: 10, priced_trips: 8, litered_trips: 9, estimated_cost: 9000, estimated_liters: 100,
        liters_distance_km: 1000, liters_with_distance: 100, priced_distance_km: 900, priced_cost_with_distance: 9000,
      },
      truncated: false, page: 1, total: 10, regions: ["NCR", "REGION III"],
      from: "2026-10-01", to: "2026-10-31",
    };
    const markup = renderToStaticMarkup(<FuelEstimatesPage />);
    expect(markup).toContain("80%");
    expect(markup).toContain("₱10.00");
    expect(markup).toContain("Fuel per 100 km");
    expect(markup).toContain("10.0 L");
    expect(markup).toContain("over 900 km");
    expect(markup).toContain("9 of 10");
    expect(markup).toContain("October 2026");
    expect(markup).toContain("This month");
    expect(markup).toContain("Last month");
    expect(markup).toContain("Last 30 days");
    expect(markup).toContain("Export CSV");
    expect(markup).toContain("All regions");
    expect(markup).toContain("From date");
    expect(markup).toContain("To date");
  });
  it("flags rows priced from a stale reference and warns above the table", () => {
    const staleRow = row({ price_age_days: 20, price_stale: true });
    const markup = renderToStaticMarkup(<EstimateRows rows={[staleRow, row({ trip_id: 8, price_age_days: 3, price_stale: false })]} />);
    expect(markup.match(/Stale reference/g)).toHaveLength(1);
    expect(markup).toContain("20 d old");

    state.data = {
      rows: [staleRow],
      totals: { trips: 1, priced_trips: 1, estimated_cost: 1271.52, estimated_liters: 13.4, stale_priced_trips: 3 },
      truncated: false, from: "2026-10-01", to: "2026-10-31",
    };
    const page = renderToStaticMarkup(<FuelEstimatesPage />);
    expect(page).toContain("3 priced trips used a reference older than 14 days");
    expect(page).toContain("Price basis");
  });
  it("shows receipt actuals and an estimate-vs-receipt delta, never a fabricated zero", () => {
    const markup = renderToStaticMarkup(<EstimateRows rows={[
      row({ actual_fuel_l: "12.900", actual_cost: "1200.00", actual_receipt_count: 1 }),
      row({ trip_id: 8, actual_fuel_l: null, actual_cost: null, actual_receipt_count: 0 }),
    ]} />);
    expect(markup).toContain("Receipt");
    expect(markup).toContain("Δ vs receipt");
    expect(markup).toContain("12.900");
    expect(markup).toContain("₱1,200.00");
    expect(markup).toContain("1 receipt");
    expect(markup).toContain("0.50");
    expect(markup).toContain("₱71.52");
    expect(receiptDelta("13.400", null)).toBeNull();
    expect(receiptDelta(null, "12.900")).toBeNull();
    expect(receiptDelta("13.400", "12.900")).toBeCloseTo(0.5);
  });
  it("charts the locked cost per completion day", () => {
    expect(dailyChartData([{ day: "2026-10-03", trips: "2", priced_trips: "1", estimated_cost: "500.00", estimated_liters: "55.00" }]))
      .toEqual([{ day: "2026-10-03", label: "Oct 3", cost: 500, liters: 55, trips: 2, pricedTrips: 1 }]);
    expect(dailyChartData()).toEqual([]);

    state.data = {
      rows: [row()],
      totals: { trips: 1, priced_trips: 1 },
      daily: [{ day: "2026-10-03", trips: 1, estimated_cost: 1271.52, estimated_liters: 13.4 }],
      measured: { efficiency_kmpl: null, liters: 0, distance_km: 0, min_distance_km: 50 },
      truncated: false, from: "2026-10-01", to: "2026-10-31",
    };
    const markup = renderToStaticMarkup(<FuelEstimatesPage />);
    expect(markup).toContain("Cost per day");
    expect(markup).toContain('data-chart="bars"');
  });
  it("keeps unavailable daily costs distinct from zero in the chart data", () => {
    expect(dailyChartData([
      { day: "2026-10-01", trips: 2, priced_trips: 0, estimated_cost: null, estimated_liters: null },
      { day: "2026-10-02", trips: 1, priced_trips: 1, estimated_cost: "0", estimated_liters: "0" },
    ])).toEqual([
      { day: "2026-10-01", label: "Oct 1", cost: null, liters: null, trips: 2, pricedTrips: 0 },
      { day: "2026-10-02", label: "Oct 2", cost: 0, liters: 0, trips: 1, pricedTrips: 1 },
    ]);
  });
  it("provides accessible daily cost and coverage data, including unpriced days", () => {
    state.data = {
      rows: [], totals: { trips: 3, priced_trips: 1 },
      daily: [
        { day: "2026-10-01", trips: 2, priced_trips: 0, estimated_cost: null },
        { day: "2026-10-02", trips: 1, priced_trips: 1, estimated_cost: 0 },
      ],
      from: "2026-10-01", to: "2026-10-31",
    };
    const markup = renderToStaticMarkup(<FuelEstimatesPage />);
    expect(markup).toContain("<caption>Daily estimated cost and priced coverage</caption>");
    expect(markup).toContain("0 of 2");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("₱0.00");
    expect(markup).toContain("1 day has no priced trips");
  });
  it("surfaces the measured efficiency read-out without replacing the estimates", () => {
    state.data = {
      rows: [row()],
      totals: { trips: 1, priced_trips: 1 },
      measured: { efficiency_kmpl: 8.4, liters: 1240, distance_km: 10400, min_distance_km: 50 },
      truncated: false, from: "2026-10-01", to: "2026-10-31",
    };
    const markup = renderToStaticMarkup(<FuelEstimatesPage />);
    expect(markup).toContain("Measured efficiency");
    expect(markup).toContain("8.4 km/L");
    expect(markup).toContain("1,240 L");
    expect(markup).toContain("Read-only reference");
    expect(markup).toContain("90-day measured basis");

    state.data = { ...state.data, measured: { efficiency_kmpl: null, liters: 0, distance_km: 0, min_distance_km: 50 } };
    const insufficient = renderToStaticMarkup(<FuelEstimatesPage />);
    expect(insufficient).toContain("insufficient data");
    expect(insufficient).toContain("50 km");
  });
  it("flattens receipt actuals and the stale flag into the export", () => {
    const [withReceipt, without] = estimateExportRows([
      row({ actual_fuel_l: "12.900", actual_cost: "1200.00", actual_receipt_count: 1, price_age_days: 20, price_stale: true }),
      row({ trip_id: 8 }),
    ]);
    expect(withReceipt).toMatchObject({
      receipt_fuel_l: 12.9,
      receipt_cost: 1200,
      delta_receipt_fuel_l: 0.5,
      delta_receipt_cost: 71.52,
      price_age_days: 20,
      stale_reference: "Yes",
    });
    expect(without).toMatchObject({
      receipt_fuel_l: "", receipt_cost: "", delta_receipt_fuel_l: "", delta_receipt_cost: "", stale_reference: "",
    });
    const keys = ESTIMATE_EXPORT_COLUMNS.map((column) => column.key);
    for (const key of ["receipt_fuel_l", "receipt_cost", "delta_receipt_fuel_l", "delta_receipt_cost", "price_age_days", "stale_reference"]) {
      expect(keys).toContain(key);
    }
  });
});
