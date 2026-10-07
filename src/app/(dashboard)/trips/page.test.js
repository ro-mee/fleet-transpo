import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: {} }));
vi.mock("@tanstack/react-query", () => ({ keepPreviousData: data => data, useQuery: ({ queryKey }) => ({ data: queryKey[0] === "trips" ? { rows: [state.row], total: 1, counts: { total: 1, active: 0, completed: 1 } } : [], isLoading: false }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({}) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("@/components/tables/data-table", () => ({ DataTable: ({ columns, data }) => React.createElement("table", null,
  React.createElement("thead", null, React.createElement("tr", null, columns.map(column => React.createElement("th", { key: column.id || column.accessorKey }, column.header)))),
  React.createElement("tbody", null, data.map(row => React.createElement("tr", { key: row.trip_id }, columns.map(column => React.createElement("td", { key: column.id || column.accessorKey }, column.cell({ row: { original: row }, getValue: () => column.accessorFn ? column.accessorFn(row) : row[column.accessorKey] }))))))
)}));
vi.mock("@/components/ui/status-badge", () => ({ StatusBadge: ({ status }) => React.createElement("span", null, status) }));
vi.mock("@/components/drivers/driver-avatar", () => ({ DriverAvatar: () => null }));
vi.stubGlobal("React", React);
const { default: TripsPage } = await import("./page");
describe("trip register report display", () => {
  it("renders cargo, planned/actual estimates, source and effective price from the server row", () => {
    state.row = { trip_id: 701, trip_status: "Passenger Onboard", transportation_requests: { service_name: "Supply pickup", service_code: "RESTAURANT_SUPPLY_PICKUP", load_type: "Cargo", cargo_description: "Vegetables", cargo_weight_kg: 650 },
      planned_distance_km: 32, actual_distance_km: 36, planned_estimated_fuel_l: 3.56, planned_estimated_fuel_cost: 223.21, estimated_fuel_l: 4, estimated_fuel_cost: 250.8,
      fuel_price_source_url: "https://example.gov/price", fuel_price_effective_at: "2026-10-01T00:00:00Z", fuel_reference_price: 62.7 };
    const html = renderToStaticMarkup(React.createElement(TripsPage));
    for (const label of ["Vegetables", "650 kg", "Cargo Loaded", "Planned estimated fuel (L)", "Actual estimated fuel (L)", "Price effective at", "Reference price (PHP/L)", "62.7", "https://example.gov/price"]) expect(html.includes(label)).toBe(true);
    expect(html.includes("Passenger Onboard")).toBe(false);
    expect((html.match(/<option/g) || []).length).toBe(6);
  });
  it("renders unknown estimates as unavailable", () => {
    state.row = { trip_id: 702, trip_status: "Completed" };
    const html = renderToStaticMarkup(React.createElement(TripsPage));
    expect(html).toContain("Unavailable"); expect(html).not.toContain("0 L");
  });
});
