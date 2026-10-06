import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/145_load_types_and_services.sql", import.meta.url)), "utf8");

describe("prepared typed-load migration", () => {
  it("checks historical passenger counts before enforcing the new positive-count constraint", () => {
    expect(migration).toMatch(/IF EXISTS\s*\(\s*SELECT 1 FROM public\.transportation_requests[\s\S]*?passenger_count\s*<=\s*0/i);
    expect(migration).toMatch(/RAISE EXCEPTION/i);
    expect(migration).toMatch(/CHECK\s*\([\s\S]*?passenger_count\s*>\s*0/i);
    expect(migration).toMatch(/DROP DEFAULT/i);
    expect(migration).toMatch(/DROP NOT NULL/i);
  });
  it("enforces cargo weight and description with nullable passenger count", () => {
    expect(migration).toMatch(/load_type\s*=\s*'Cargo'[\s\S]*?passenger_count IS NULL[\s\S]*?cargo_weight_kg\s*>\s*0[\s\S]*?btrim\(cargo_description\)/i);
    // PostgreSQL NUMERIC NaN compares greater than every ordinary number.
    expect(migration).toMatch(/cargo_weight_kg\s*<>\s*'NaN'::numeric/i);
  });
  it("provides five durable codes, retires only explicit rows and never deletes their historical FK targets", () => {
    for (const code of ["GUEST_TRANSPORT", "VIP_GUEST_TRANSPORT", "RESTAURANT_SUPPLY_PICKUP", "RESTAURANT_FOOD_DELIVERY", "HOTEL_SUPPLY_TRANSFER"]) expect(migration).toContain(code);
    expect(migration).toMatch(/CREATE UNIQUE INDEX[\s\S]*?service_code/i);
    expect(migration).toMatch(/service_name IN \('Staff Transport', 'Employee Transport', 'Hotel Shuttle', 'Guest Shuttle'\)/);
    expect(migration).toMatch(/RAISE EXCEPTION 'Canonical service code conflict/i);
    expect(migration).not.toMatch(/DELETE FROM public\.service_types/i);
  });
});
