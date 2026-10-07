import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../../../supabase/migrations/153_vehicle_capabilities.sql", import.meta.url));
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

describe("prepared vehicle-capabilities migration", () => {
  it("is additive and nullable: no historical vehicle or document row is rewritten", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS fleet_asset_code/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS operational_use/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS cargo_capacity_kg/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS commissioning_status/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS verification_status/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS verified_by/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS verified_at/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.vehicles\s+SET/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.vehicledocuments\s+SET/i);
    expect(migration).not.toMatch(/DELETE FROM/i);
  });

  it("constrains operational use, cargo capacity and commissioning status", () => {
    expect(migration).toMatch(/operational_use[\s\S]*?IN\s*\(\s*'Passenger'\s*,\s*'Cargo'\s*\)/i);
    expect(migration).toMatch(/cargo_capacity_kg\s*>\s*0/i);
    expect(migration).toMatch(/cargo_capacity_kg\s*<>\s*'NaN'::numeric/i);
    expect(migration).toMatch(/commissioning_status[\s\S]*?IN\s*\(\s*'Pending'\s*,\s*'Ready'\s*\)/i);
    expect(migration).toMatch(/DEFAULT\s*'Pending'/i);
  });

  it("gives fleet asset codes a unique index and rejects a same-named wrong index", () => {
    // CREATE INDEX has no IF NOT EXISTS inside the guard: the DO block checks
    // NOT FOUND first, then creates; a same-named non-unique index raises.
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS vehicles_fleet_asset_code_uq/i);
    expect(migration).toMatch(/fleet_asset_code/i);
    expect(migration).toMatch(/indisunique/i);
    expect(migration).toMatch(/RAISE EXCEPTION/i);
  });

  it("adds document verification audit columns with a bounded status CHECK", () => {
    expect(migration).toMatch(/verification_status[\s\S]*?IN\s*\(\s*'Pending'\s*,\s*'Verified'\s*,\s*'Rejected'\s*\)/i);
  });

  it('scopes index and exact validated constraint checks to their intended relation', () => {
    expect(migration).toMatch(/i\.indpred IS NULL/);
    expect(migration).toMatch(/i\.indkey\[0\] = a\.attnum/);
    expect(migration).toMatch(/i\.indisready/);
    expect(migration).toMatch(/constraint_definition IS DISTINCT FROM expected_constraint_definition/);
    expect(migration).toMatch(/conrelid = 'public\.vehicles'::regclass/);
    expect(migration).toMatch(/conrelid = 'public\.vehicledocuments'::regclass/);
    expect(migration).toMatch(/ALTER COLUMN plate_number DROP NOT NULL/);
  });

  it("runs in an explicit transaction and never synthesizes plates or compliance evidence", () => {
    const uncommented = migration.replace(/^\s*--.*$/gm, "").trim();
    expect(uncommented).toMatch(/^BEGIN;/i);
    expect(uncommented).toMatch(/COMMIT;$/i);
    expect(migration).not.toMatch(/plate_number\s*=/i);
  });
});
