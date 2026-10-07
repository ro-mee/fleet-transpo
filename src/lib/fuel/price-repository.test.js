import { describe, expect, it } from "vitest";
import { createPriceRepository } from "./price-repository";

const snapshot = { snapshot_id: 4, fuel_product: "Diesel", region: "NCR", currency: "PHP", unit: "L", reference_price: "62.70", effective_at: "2026-10-01T00:00:00+08:00", lifecycle: "Active", verification_method: "Manual", verified_by: 3, source_url: "https://official.example/prices" };
function adapter(rows = []) {
  const calls = [];
  let transitions = 0;
  const db = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("WITH due AS")) {
      const due = rows.filter((r) => new Date(r.effective_at).getTime() <= values[0].getTime()).sort((a, b) => new Date(b.effective_at) - new Date(a.effective_at));
      due.forEach((r, index) => { const next = index === 0 ? "Active" : "Historical"; if (r.lifecycle !== next) { r.lifecycle = next; transitions++; } });
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO fuel_price_snapshots")) { const row = { ...snapshot, reference_price: values[2], effective_at: values[5], lifecycle: values[9] }; rows.push(row); return { rows: [row] }; }
    if (sql.includes("SELECT") && sql.includes("fuel_price_snapshots")) return { rows: rows.filter((r) => !sql.includes("effective_at =") || new Date(r.effective_at).getTime() === new Date(values[2]).getTime()) };
    return { rows: [] };
  }, withTransaction: async (fn) => fn({ query: db.query }) };
  return { db, calls, rows, transitions: () => transitions };
}
describe("real fuel price repository with an offline DB adapter", () => {
  it("resolves verified price, history and missing policy context", async () => {
    const { db } = adapter([snapshot]); const repo = createPriceRepository(db);
    expect((await repo.applicable({ fuelType: "Diesel", region: "NCR", at: "2026-10-05T00:00:00Z" })).reference_price).toBe("62.70");
    expect(await repo.applicable({ fuelType: "Diesel", region: null, at: "2026-10-05T00:00:00Z" })).toBeNull();
  });
  it("writes a future manual snapshot Pending, never trusts submitted lifecycle/verifier", async () => {
    const { db, calls } = adapter(); const repo = createPriceRepository(db);
    const result = await repo.record({ ...snapshot, effective_at: "2030-10-01T00:00:00Z", lifecycle: "Active", verified_by: 999 }, { verifierId: 3, at: new Date("2026-10-05T00:00:00Z") });
    expect(result.snapshot.lifecycle).toBe("Pending");
    expect(calls.find((c) => c.sql.includes("INSERT INTO")).values[11]).toBe(3);
  });
  it("ignores exact repeats, rejects a conflicting correction and extreme consecutive change", async () => {
    const { db } = adapter([snapshot]); const repo = createPriceRepository(db);
    expect((await repo.record(snapshot, { verifierId: 3 })).duplicate).toBe(true);
    await expect(repo.record({ ...snapshot, reference_price: 70 }, { verifierId: 3 })).rejects.toMatchObject({ status: 409 });
    await expect(repo.record({ ...snapshot, reference_price: 190, effective_at: "2026-11-01T00:00:00Z" }, { verifierId: 3 })).rejects.toMatchObject({ status: 409 });
  });
  it("reports an unapplied migration clearly", async () => {
    const repo = createPriceRepository({ query: async () => { const e = new Error("relation absent"); e.code = "42P01"; throw e; } });
    await expect(repo.list()).rejects.toMatchObject({ status: 503 });
  });
  it("activates a pending announcement at effectivity once without rewriting history prices", async () => {
    const old = { ...snapshot, snapshot_id: 3, reference_price: "61.90", lifecycle: "Active" };
    const next = { ...snapshot, snapshot_id: 4, effective_at: "2030-10-01T00:00:00Z", lifecycle: "Pending" };
    const fake = adapter([old, next]); const repo = createPriceRepository(fake.db);
    await repo.activateDue(new Date("2030-09-30T23:59:59Z")); expect(next.lifecycle).toBe("Pending");
    await repo.activateDue(new Date("2030-10-01T00:00:00Z")); expect(next.lifecycle).toBe("Active"); expect(old.lifecycle).toBe("Historical");
    expect(fake.transitions()).toBe(2);
    await repo.activateDue(new Date("2030-10-01T00:00:00Z")); expect(fake.transitions()).toBe(2);
    expect(old.reference_price).toBe("61.90"); expect(next.reference_price).toBe("62.70");
  });
});
