import { describe, expect, it, vi } from "vitest";
import { FUEL_EXPORT_VIEWS, fuelExportTarget } from "@/lib/fuel/export-targets";

function service(overrides = {}) {
  return {
    getFuelRecords: vi.fn(),
    getFuelRequests: vi.fn(),
    getFuelAllocations: vi.fn(),
    ...overrides,
  };
}

describe("fuelExportTarget", () => {
  it("covers every view the console can show, with a distinct entity", () => {
    const entities = FUEL_EXPORT_VIEWS.map((view) => fuelExportTarget(view, service()).entity);
    expect(entities).toEqual(["receipt claims", "monthly budget rows", "fuel permits"]);
    expect(new Set(entities).size).toBe(FUEL_EXPORT_VIEWS.length);
  });

  it("names the exported entity on the button, so the label cannot lie", () => {
    // The button text must name the dataset the view is showing. Without this
    // the Permits view offered a button reading "Export CSV" that produced
    // receipt claims.
    const keyword = { registry: "receipt claims", budget: "monthly budget", permits: "permits" };
    for (const view of FUEL_EXPORT_VIEWS) {
      const target = fuelExportTarget(view, service());
      expect(target.label.toLowerCase()).toContain(keyword[view]);
      expect(target.entity.toLowerCase()).toContain(keyword[view]);
    }
  });

  it("exports PERMITS from the permits view — the 45-permit list, not the claims", async () => {
    // The reported symptom: 45 permits on screen, and the export count matched
    // neither list because it exported (an envelope of) receipt claims.
    const permits = Array.from({ length: 45 }, (_, i) => ({ fuel_request_id: i + 1 }));
    const svc = service({ getFuelRequests: vi.fn(async () => ({ rows: permits, counts: { pending: 45 } })) });
    const target = fuelExportTarget("permits", svc);

    const rows = await target.collect();
    expect(rows).toHaveLength(45);
    expect(rows[0]).toHaveProperty("fuel_request_id");
    expect(svc.getFuelRecords).not.toHaveBeenCalled();
    expect(target.filename).toBe("fuel-permits");
    expect(target.columns.map((c) => c.label)).toContain("Permit ID");
  });

  it("exports the monthly budget from the budget view", async () => {
    const allocations = [{ plate_number: "ABC-1234", allocated_liters: 300 }];
    const svc = service({ getFuelAllocations: vi.fn(async () => ({ month: "2026-10", rows: allocations })) });
    const target = fuelExportTarget("budget", svc);
    await expect(target.collect()).resolves.toEqual(allocations);
    expect(svc.getFuelRecords).not.toHaveBeenCalled();
    expect(target.columns.map((c) => c.label)).toContain("Allocated (L)");
  });

  it("unwraps the registry envelope instead of passing it to exportToCSV", async () => {
    const svc = service({
      getFuelRecords: vi.fn(async () => ({ rows: [{ fuel_record_id: 7 }], total: 1, counts: { total: 1 } })),
    });
    const rows = await fuelExportTarget("registry", svc).collect();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toEqual([{ fuel_record_id: 7 }]);
  });

  it("walks every page of the registry so the export is the whole filtered set", async () => {
    const getFuelRecords = vi.fn(async ({ page, pageSize }) =>
      page === 1
        ? { rows: Array.from({ length: pageSize }, (_, i) => ({ fuel_record_id: i + 1 })), total: 130 }
        : { rows: Array.from({ length: 30 }, (_, i) => ({ fuel_record_id: 100 + i })), total: 130 }
    );
    const target = fuelExportTarget("registry", service({ getFuelRecords }), { status: "Pending", search: "abc" });

    await expect(target.collect()).resolves.toHaveLength(130);
    // The active filter travels with every page, so the export matches the table.
    for (const [filters] of getFuelRecords.mock.calls) {
      expect(filters).toMatchObject({ status: "Pending", search: "abc" });
    }
    expect(getFuelRecords.mock.calls.map(([f]) => f.page)).toEqual([1, 2]);
  });

  it("falls back to the registry for an unknown view rather than exporting nothing", async () => {
    const svc = service({ getFuelRecords: vi.fn(async () => ({ rows: [{ fuel_record_id: 1 }], total: 1 })) });
    const target = fuelExportTarget("nonsense", svc);
    expect(target.entity).toBe("receipt claims");
    await expect(target.collect()).resolves.toEqual([{ fuel_record_id: 1 }]);
  });
});
