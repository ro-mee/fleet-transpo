import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/144_transport_source_identity.sql", import.meta.url)), "utf8");

describe("prepared source-identity migration safety", () => {
  it("wraps every migration statement in an explicit transaction", () => {
    const uncommented = migration.replace(/^\s*--.*$/gm, "").trim();
    expect(uncommented).toMatch(/^BEGIN;/i);
    expect(uncommented).toMatch(/COMMIT;$/i);
  });

  it("fails rather than accepting a wrong same-named or partial source identity index", () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS transportation_requests_source_request_uq/i);
    expect(migration).toMatch(/pg_index/i);
    expect(migration).toMatch(/indisunique/i);
    expect(migration).toMatch(/indpred IS NULL/i);
    expect(migration).toMatch(/indexprs IS NULL/i);
    expect(migration).toMatch(/indkey\[0\].*indkey\[1\]/is);
    expect(migration).toMatch(/RAISE EXCEPTION/i);
  });
  it("fails if another global external_booking_id uniqueness constraint survives", () => {
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS transportation_requests_external_booking_id_key/i);
    expect(migration).toMatch(/indisunique/i);
    expect(migration).toMatch(/external_booking_id/i);
    expect(migration).toMatch(/global booking ID uniqueness/i);
  });
});
