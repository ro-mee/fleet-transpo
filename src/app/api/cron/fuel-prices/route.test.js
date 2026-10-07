import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { fetchReferencePrice } from "@/lib/fuel/providers/official-reference";

const fake = vi.hoisted(() => ({ rows: [], writes: 0 }));
vi.mock("@/lib/api/utils", () => ({ AuthError: class extends Error { constructor(message, status) { super(message); this.status = status; } }, ok: (body, status = 200) => Response.json(body, { status }), err: (error, status) => Response.json({ error }, { status }), handleError: (e) => Response.json({ error: e.message }, { status: e.status || 500 }) }));
vi.mock("@/lib/fuel/providers/official-reference", async (original) => ({ ...(await original()), fetchReferencePrice: vi.fn() }));
vi.mock("@/lib/db", () => {
  const query = async (sql, p) => {
    if (sql.includes("INSERT INTO fuel_price_snapshots")) {
      fake.writes++; const row = { snapshot_id: fake.writes, fuel_product: p[0], region: p[1], reference_price: p[2], effective_at: p[5], source_url: p[7], lifecycle: p[9], verification_method: p[8], source_hash: p[10] }; fake.rows.push(row); return { rows: [row] };
    }
    if (sql.includes("SELECT") && sql.includes("FROM fuel_price_snapshots")) return { rows: fake.rows.filter((r) => {
      if (sql.includes("effective_at =")) return new Date(r.effective_at).getTime() === new Date(p[2]).getTime();
      if (sql.includes("effective_at <")) return new Date(r.effective_at).getTime() < new Date(p[2]).getTime();
      return true;
    }).sort((a, b) => new Date(b.effective_at) - new Date(a.effective_at)) };
    return { rows: [] };
  };
  return { query, withTransaction: (fn) => fn({ query }) };
});
const payload = { fuel_product: "Diesel", region: "NCR", reference_price: 62.7, prior_price: 61.9, announced_at: "2029-09-28T09:00:00+08:00", effective_at: "2030-10-01T00:00:00+08:00", source_url: "https://official.example/doe/diesel-ncr" };
const call = (secret = "test-only-secret") => GET(new Request("https://local/api/cron/fuel-prices", { headers: { authorization: `Bearer ${secret}` } }));
const activate = () => {
  process.env.FUEL_PRICE_PROVIDER_ENABLED = "1"; process.env.FUEL_PRICE_SOURCE_VERIFIED = "1";
  process.env.FUEL_PRICE_SOURCE_ID = "fixture-only"; process.env.FUEL_PRICE_SOURCE_URL = "https://official.example/doe";
};
beforeEach(() => {
  vi.clearAllMocks(); fake.rows = []; fake.writes = 0; process.env.CRON_SECRET = "test-only-secret";
  for (const key of ["FUEL_PRICE_PROVIDER_ENABLED", "FUEL_PRICE_SOURCE_VERIFIED", "FUEL_PRICE_SOURCE_ID", "FUEL_PRICE_SOURCE_URL"]) delete process.env[key];
});
describe("protected provider cron through real auth and repository", () => {
  it("rejects a wrong or missing configured cron secret before external fetch", async () => {
    expect((await call("wrong")).status).toBe(401);
    delete process.env.CRON_SECRET; expect((await call()).status).toBe(503);
    expect(fetchReferencePrice).not.toHaveBeenCalled(); expect(fake.writes).toBe(0);
  });
  it("stays disabled until an approved official source is explicitly configured", async () => {
    expect((await call()).status).toBe(503);
    activate(); delete process.env.FUEL_PRICE_SOURCE_VERIFIED;
    expect((await call()).status).toBe(503); expect(fetchReferencePrice).not.toHaveBeenCalled();
  });
  it("persists a verified future announcement Pending exactly once", async () => {
    activate(); fetchReferencePrice.mockResolvedValue({ ok: true, data: payload });
    const response = await call(); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.persisted).toBe(true); expect(body.snapshot.lifecycle).toBe("Pending");
    expect((await (await call()).json()).outcome).toBe("duplicate"); expect(fake.writes).toBe(1);
  });
  it("retains the current price on relative jumps, format drift and provider failure", async () => {
    activate(); fake.rows = [{ ...payload, reference_price: 62, effective_at: "2029-10-01T00:00:00Z" }];
    for (const result of [{ ok: true, data: { ...payload, reference_price: 190 } }, { ok: true, data: { ...payload, unexpected: 1 } }, { ok: false, reason: "Provider unavailable" }]) {
      fetchReferencePrice.mockResolvedValue(result); const body = await (await call()).json(); expect(body.outcome).toBe("retained"); expect(body.persisted).toBe(false);
    }
    expect(fake.writes).toBe(0);
  });
  it("retains a newer verified Pending announcement when the provider sends an older unseen price", async () => {
    activate();
    fake.rows = [
      { ...payload, effective_at: "2030-10-01T00:00:00+08:00", verification_method: "Manual", verified_by: 3, lifecycle: "Pending" },
      { ...payload, effective_at: "2030-10-08T00:00:00+08:00", verification_method: "Automatic", source_hash: "verified-ingestion", lifecycle: "Pending" },
    ];
    fetchReferencePrice.mockResolvedValue({ ok: true, data: { ...payload, effective_at: "2030-10-05T00:00:00+08:00" } });
    expect(await (await call()).json()).toMatchObject({ outcome: "retained", persisted: false });
    expect(fake.writes).toBe(0); expect(fake.rows).toHaveLength(2);
  });
});
