import { afterEach, describe, expect, it, vi } from "vitest";
import * as service from "./expenses.service";

afterEach(() => vi.unstubAllGlobals());

describe("expense CSV collection", () => {
  it("collects every filtered page in the selected order", async () => {
    const fetch = vi.fn(async (url) => {
      const sp = new URL(url, "https://fleet.test").searchParams;
      const page = Number(sp.get("page"));
      return Response.json({ rows: page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }], total: 101 });
    });
    vi.stubGlobal("fetch", fetch);
    expect(typeof service.getAllExpenseRecords).toBe("function");
    const rows = await service.getAllExpenseRecords({ status: "Approved", search: "van", sort: "amount", sortDir: "desc" });
    expect(rows).toHaveLength(101);
    expect(rows[100].id).toBe(100);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of fetch.mock.calls) {
      const sp = new URL(url, "https://fleet.test").searchParams;
      expect(Object.fromEntries(sp)).toMatchObject({ status: "Approved", search: "van", sort: "amount", sortDir: "desc", pageSize: "100" });
    }
  });

  it("fails the export if a later page cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ rows: [{ id: 1 }], total: 2 }))
      .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 500 })));
    expect(typeof service.getAllExpenseRecords).toBe("function");
    await expect(service.getAllExpenseRecords({})).rejects.toThrow("Unavailable");
  });
});
