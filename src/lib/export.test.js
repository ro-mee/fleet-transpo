import { describe, expect, it, vi } from "vitest";
import { collectPagedRows, exportToCSV } from "@/lib/export";

describe("exportToCSV", () => {
  const columns = [{ label: "Plate", key: "plate" }];

  it("refuses a paginated envelope and reports count 0", () => {
    // This is the root cause of the fuel export writing no file: the endpoint
    // answers `{ rows, total, counts }`, `data?.length` is undefined on an
    // object, and the caller's own success toast still fired.
    const envelope = { rows: [{ plate: "ABC-1234" }], total: 45, counts: { pending: 3 } };
    expect(exportToCSV(envelope, "fuel", columns)).toEqual({ count: 0, filename: "" });
  });

  it("refuses an empty list", () => {
    expect(exportToCSV([], "fuel", columns)).toEqual({ count: 0, filename: "" });
    expect(exportToCSV(undefined, "fuel", columns)).toEqual({ count: 0, filename: "" });
  });
});

describe("collectPagedRows", () => {
  const page = (from, count, total) => ({
    rows: Array.from({ length: count }, (_, i) => ({ id: from + i })),
    total,
    page: 1,
    pageSize: 100,
    counts: {},
  });

  it("walks every page the envelope's total promises", async () => {
    const fetchPage = vi.fn(async (p) => (p === 1 ? page(1, 100, 145) : page(101, 45, 145)));
    const rows = await collectPagedRows(fetchPage);
    expect(rows).toHaveLength(145);
    expect(rows[0].id).toBe(1);
    expect(rows[144].id).toBe(145);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("returns the rows of a single-page envelope without a second request", async () => {
    const fetchPage = vi.fn(async () => page(1, 3, 3));
    await expect(collectPagedRows(fetchPage)).resolves.toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("passes a bare array through unchanged (endpoints that do not paginate)", async () => {
    const list = [{ id: 1 }, { id: 2 }];
    await expect(collectPagedRows(async () => list)).resolves.toEqual(list);
  });

  it("stops on an empty page instead of trusting a wrong total", async () => {
    // A total that overstates the data must not spin forever.
    const fetchPage = vi.fn(async (p) => (p === 1 ? page(1, 2, 999) : { rows: [], total: 999 }));
    const rows = await collectPagedRows(fetchPage);
    expect(rows).toHaveLength(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("never exceeds maxPages", async () => {
    const fetchPage = vi.fn(async (p) => page((p - 1) * 2 + 1, 2, 1_000_000));
    const rows = await collectPagedRows(fetchPage, { pageSize: 2, maxPages: 3 });
    expect(rows).toHaveLength(6);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("handles a response with no rows key at all", async () => {
    await expect(collectPagedRows(async () => ({ total: 0 }))).resolves.toEqual([]);
  });
});
