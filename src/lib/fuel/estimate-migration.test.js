import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../../../supabase/migrations/155_trip_fuel_estimate.sql", import.meta.url));
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

describe("prepared trip-fuel-estimate migration", () => {
  // The header comment names fuel_consumed to document the invariant; the
  // assertions below run against executable SQL only.
  const executable = migration.replace(/^\s*--.*$/gm, "");

  it("adds estimate columns to trips without touching fuel_consumed", () => {
    for (const column of [
      "planned_distance_km",
      "actual_distance_km",
      "distance_provenance",
      "estimated_fuel_l",
      "estimated_fuel_cost",
      "fuel_reference_price",
      "fuel_price_snapshot_id",
      "fuel_region",
    ]) {
      expect(migration).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`, "i"));
    }
    expect(executable).not.toMatch(/fuel_consumed/i);
    expect(executable).not.toMatch(/UPDATE\s+public\.trips/i);
    expect(executable).not.toMatch(/DELETE FROM/i);
  });

  it("links the snapshot FK after the snapshots table, idempotently", () => {
    expect(migration).toMatch(/fk_trips_fuel_price_snapshot/i);
    expect(migration).toMatch(/REFERENCES public\.fuel_price_snapshots\s*\(\s*snapshot_id\s*\)/i);
    expect(migration).toMatch(/IF NOT EXISTS[\s\S]*?fk_trips_fuel_price_snapshot|fk_trips_fuel_price_snapshot[\s\S]*?IF NOT EXISTS/i);
  });

  it("runs in an explicit transaction", () => {
    const uncommented = migration.replace(/^\s*--.*$/gm, "").trim();
    expect(uncommented).toMatch(/^BEGIN;/i);
    expect(uncommented).toMatch(/COMMIT;$/i);
  });
});
