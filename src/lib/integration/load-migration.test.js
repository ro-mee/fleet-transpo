import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../../../supabase/migrations/151_load_types_and_services.sql", import.meta.url));
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

describe("prepared typed-load migration", () => {
  it("checks historical passenger counts before enforcing the new positive-count constraint", () => {
    expect(migration).toMatch(/IF EXISTS\s*\(\s*SELECT 1 FROM public\.transportation_requests[\s\S]*?passenger_count\s*<=\s*0/i);
    expect(migration).toMatch(/RAISE EXCEPTION/i);
    expect(migration).toMatch(/CHECK\s*\([\s\S]*?passenger_count\s*>\s*0/i);
    expect(migration).toMatch(/DROP DEFAULT/i);
    expect(migration).toMatch(/DROP NOT NULL/i);
  });
  it("preflights passenger rows without rejecting valid cargo on rerun", () => {
    const preflight = migration.match(/DO \$\$[\s\S]*?passenger_count IS NULL OR passenger_count <= 0[\s\S]*?END \$\$;/i)?.[0] ?? "";

    expect(preflight).not.toBe("");
    expect(preflight).toMatch(/RAISE EXCEPTION 'Existing passenger_count requires explicit historical review before typed-load CHECK'/i);
    expect(preflight).toMatch(/load_type IS NULL OR load_type = 'Passenger'/);
    expect(migration.indexOf('ADD COLUMN IF NOT EXISTS load_type')).toBeLessThan(migration.indexOf(preflight));
  });

  it('leaves historical load types null and requires explicit typing from new intake', () => {
    expect(migration).not.toMatch(/load_type varchar\(20\) DEFAULT 'Passenger'/);
    expect(migration).toMatch(/ALTER COLUMN load_type DROP DEFAULT/);
    expect(migration).toMatch(/ALTER COLUMN load_type DROP NOT NULL/);
    expect(migration).toMatch(/load_type IS NULL AND passenger_count/);
  });

  it("uses the explicit ASCII whitespace set in both cargo CHECK expressions", () => {
    const cargoTrim = "btrim(cargo_description, E' \\t\\n\\r\\f' || chr(11))";

    expect(migration.split(cargoTrim)).toHaveLength(3);
  });

  it("requires a ready service-code index and explicit transaction boundaries", () => {
    expect(migration).toMatch(/i\.indisready/i);

    const uncommented = migration.replace(/^\s*--.*$/gm, "").trim();
    expect(uncommented).toMatch(/^BEGIN;/i);
    expect(uncommented).toMatch(/COMMIT;$/i);
  });

  it("enforces cargo weight and description with nullable passenger count", () => {
    expect(migration).toMatch(/load_type\s*=\s*'Cargo'[\s\S]*?passenger_count IS NULL[\s\S]*?cargo_weight_kg\s*>\s*0[\s\S]*?btrim\(cargo_description,/i);
    // PostgreSQL NUMERIC NaN compares greater than every ordinary number.
    expect(migration).toMatch(/cargo_weight_kg\s*<>\s*'NaN'::numeric/i);
  });
  it.each([
    ["chk_service_default_load_type", "service_types", "_expected_service_default_load_type"],
    ["chk_transport_typed_load", "transportation_requests", "_expected_transport_typed_load"],
  ])("accepts only the exact validated %s definition and adds it only when absent", (constraintName, tableName, expectedTable) => {
    const blocks = migration.match(/DO \$\$[\s\S]*?END \$\$;/gi) ?? [];
    const guard = blocks.find((block) => block.includes(constraintName)) ?? "";

    expect(guard).not.toBe("");
    expect(guard).toMatch(new RegExp(`CREATE TEMP TABLE ${expectedTable}\\b`, "i"));
    expect(guard).toMatch(/pg_get_constraintdef[\s\S]*?expected_constraint_definition/i);
    expect(guard).toMatch(/pg_constraint[\s\S]*?convalidated/i);
    expect(guard).toMatch(/constraint_definition IS DISTINCT FROM expected_constraint_definition[\s\S]*?constraint_is_valid IS DISTINCT FROM TRUE/i);
    expect(guard).toMatch(new RegExp(`IF constraint_definition IS NULL[\\s\\S]*?ALTER TABLE public\\.${tableName}\\s+ADD CONSTRAINT`, "i"));
    expect(guard).toMatch(/RAISE EXCEPTION/i);
    expect(migration).not.toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS ${constraintName}`, "i"));
  });

  it("provides five durable codes, retires only explicit rows and never deletes their historical FK targets", () => {
    for (const code of ["GUEST_TRANSPORT", "VIP_GUEST_TRANSPORT", "RESTAURANT_SUPPLY_PICKUP", "RESTAURANT_FOOD_DELIVERY", "HOTEL_SUPPLY_TRANSFER"]) expect(migration).toContain(code);
    expect(migration).toMatch(/CREATE UNIQUE INDEX[\s\S]*?service_code/i);
    expect(migration).toMatch(/service_name IN \('Staff Transport', 'Employee Transport', 'Hotel Shuttle', 'Guest Shuttle'\)/);
    expect(migration).toMatch(/RAISE EXCEPTION 'Canonical service code conflict/i);
    expect(migration).not.toMatch(/DELETE FROM public\.service_types/i);
  });
});
