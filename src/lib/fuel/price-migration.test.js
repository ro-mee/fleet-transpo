import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../../../supabase/migrations/154_fuel_price_snapshots.sql", import.meta.url));
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

describe("prepared fuel-price-snapshots migration", () => {
  it("creates the snapshots table once, additively, with no history rewrite", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.fuel_price_snapshots/i);
    expect(migration).not.toMatch(/UPDATE\s+public\./i);
    expect(migration).not.toMatch(/DELETE FROM/i);
  });

  it("stores provenance: product, region, PHP/L units, price history, tz-aware timestamps, source and verifier", () => {
    for (const column of [
      "fuel_product", "region", "currency", "unit", "reference_price", "prior_price",
      "announced_at", "effective_at", "fetched_at", "source_url",
      "verification_method", "lifecycle", "source_hash", "verified_by",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toMatch(/verification_method[\s\S]*?IN\s*\(\s*'Manual'\s*,\s*'Automatic'\s*\)/i);
    expect(migration).toMatch(/lifecycle[\s\S]*?IN\s*\(\s*'Pending'\s*,\s*'Active'\s*,\s*'Historical'\s*\)/i);
    expect(migration).toMatch(/reference_price[\s\S]*?>\s*0/i);
  });

  it("keys uniqueness on source/version/effectivity so duplicates are ignored", () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_price_snapshot_effectivity/i);
    expect(migration).toMatch(/fuel_product[\s\S]*?region[\s\S]*?effective_at/i);
  });

  it("enables RLS and revokes anon/authenticated grants including TRUNCATE", () => {
    // Enabling RLS alone is not sufficient: TRUNCATE bypasses row security,
    // so the revoke below is load-bearing rather than decorative.
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES[\s\S]*?FROM anon, authenticated/i);
  });

  it("runs in an explicit transaction", () => {
    const uncommented = migration.replace(/^\s*--.*$/gm, "").trim();
    expect(uncommented).toMatch(/^BEGIN;/i);
    expect(uncommented).toMatch(/COMMIT;$/i);
  });
});
