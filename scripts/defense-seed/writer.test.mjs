import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDefensePlan } from "./plan.mjs";
import { loadMediaManifest } from "./media.mjs";
import { writeDefenseSeed } from "./writer.mjs";

const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");
const columns = new Map([...schema.matchAll(/CREATE TABLE ([a-z_]+) \(([\s\S]*?)\n\);/g)].map((match) => [
  match[1], new Set([...match[2].matchAll(/^\s{2}([a-z0-9_]+)\s+/gm)].map((column) => column[1])),
]));

describe("defense seed SQL mapping", () => {
  it("only inserts real live-schema columns and connects all owned records", async () => {
    const priorAccounts = process.env.DEFENSE_DEMO_ACCOUNTS_JSON;
    const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const plan = buildDefensePlan();
    process.env.DEFENSE_DEMO_ACCOUNTS_JSON = JSON.stringify(Object.fromEntries(plan.drivers.map((d, i) => [d.key,
      { email: `demo+${d.key.toLowerCase()}@example.test`, password: `test-only-strong-password-${i}` }])));
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    try {
      const assets = await loadMediaManifest();
      const inserted = new Map();
      const counters = new Map();
      let reusedRoute = false;
      const transactionStartedAt = new Date("2026-10-03T00:00:00.000Z");
      const cleanupQueries = [];
      const db = { async query(sql, params = []) {
        if (sql.startsWith("SELECT transaction_timestamp()")) return { rows: [{ started_at: transactionStartedAt }] };
        if (sql.startsWith("SELECT role_id FROM roles")) return { rows: [{ role_id: 2 }] };
        if (sql.startsWith("SELECT email FROM employees") || sql.startsWith("SELECT plate_number FROM vehicles") ||
            sql.startsWith("SELECT category_id,status") || sql.startsWith("SELECT location_id FROM locations")) return { rows: [] };
        if (sql.startsWith("SELECT route_id FROM routes")) {
          if (!reusedRoute) { reusedRoute = true; return { rows: [{ route_id: 999 }] }; }
          return { rows: [] };
        }
        if (sql.startsWith("SELECT end_odometer FROM trips")) return { rows: [{ end_odometer: 19000 }] };
        if (sql.startsWith("SELECT notification_id FROM notifications") || sql.startsWith("SELECT id FROM push_outbox")) return { rows: [] };
        if (sql.startsWith("SELECT ") && sql.includes("to_jsonb(t) AS snapshot")) {
          const table = sql.match(/FROM ([a-z_]+) t/)[1];
          const rows = (inserted.get(table) ?? []).filter((r) => params[0].includes(String(r.id)))
            .map((r) => ({ id: r.id, snapshot: r.values }));
          return { rows };
        }
        if (sql.startsWith("INSERT INTO system_settings")) return { rowCount: 1, rows: [] };
        if (sql.startsWith("DELETE FROM notifications") || sql.startsWith("DELETE FROM push_outbox")) {
          cleanupQueries.push({ sql, params });
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith("UPDATE ")) return { rowCount: 1, rows: [] };
        const match = /^INSERT INTO ([a-z_]+) \(([^)]+)\) VALUES \([^)]+\) RETURNING ([a-z_]+)/.exec(sql);
        if (!match) throw new Error(`Unexpected query: ${sql}`);
        const [, table, names, pk] = match;
        const fields = names.split(",");
        expect(columns.has(table), `${table} missing from schema`).toBe(true);
        for (const field of fields) expect(columns.get(table).has(field), `${table}.${field} missing from schema`).toBe(true);
        for (const [i, value] of params.entries()) expect(value, `${table}.${fields[i]} undefined`).not.toBeUndefined();
        const id = fields.includes(pk) ? params[fields.indexOf(pk)] : (counters.get(table) ?? 0) + 1;
        counters.set(table, (counters.get(table) ?? 0) + 1);
        inserted.set(table, [...(inserted.get(table) ?? []), { id, values: Object.fromEntries(fields.map((field, i) => [field, params[i]])) }]);
        return { rows: [{ [pk]: id }], rowCount: 1 };
      } };
      const ledger = await writeDefenseSeed(db, plan, assets);
      expect(ledger.ids.employees).toHaveLength(10);
      expect(ledger.ids.vehicles).toHaveLength(10);
      expect(ledger.ids.routes).toHaveLength(plan.routes.length - 1);
      expect(ledger.semantic[plan.routes[0].key]).toMatchObject({ table: "routes", id: 999, reused: true });
      expect(ledger.ids.transportation_requests).toHaveLength(45);
      expect(ledger.ids.dispatchschedules).toHaveLength(37);
      expect(ledger.ids.trips).toHaveLength(37);
      expect(ledger.ids.vehicleinspection).toHaveLength(88);
      expect(ledger.ids.fuelrecords).toHaveLength(12);
      expect(ledger.ids.expense_records).toHaveLength(6);
      expect(ledger.ids.reservation_events).toHaveLength(216);
      expect(ledger.plantedAt).toEqual(transactionStartedAt);
      expect(cleanupQueries).toHaveLength(5);
      expect(cleanupQueries.every(({ params }) => params.at(-1) === transactionStartedAt)).toBe(true);
      expect(cleanupQueries.some(({ params }) => params[0] === "maintenance" && params[1].length === 10)).toBe(true);
    } finally {
      if (priorAccounts === undefined) delete process.env.DEFENSE_DEMO_ACCOUNTS_JSON;
      else process.env.DEFENSE_DEMO_ACCOUNTS_JSON = priorAccounts;
      if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
    }
  }, 15000);
});
