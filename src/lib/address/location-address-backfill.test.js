// Tests for the canonical-location → structured-address backfill's pure rules.
//
// The module under test is deliberately free of I/O, so everything that decides
// what the migration DOES — which locations are in scope, which get skipped, and
// which statements are refused in a dry run — is pinned here rather than only by
// pointing a script at the live database.
//
// The properties worth stating, because they are the ones a future edit is most
// likely to break silently:
//
//   * SCOPE. Exactly three locations, and no rule that could widen it.
//   * NO INVENTED DETAIL. Every target omits the house number, and the built
//     input omits coordinates entirely — absent, not null.
//   * THE GUARD REFUSES BY KIND, NOT BY ALLOWLIST. A statement nobody
//     anticipated is refused too.
//   * A SKIP IS DECIDED BEFORE ANYTHING IS WRITTEN. A row that is not the
//     location we think it is never reaches the write path.

import { describe, expect, it, vi } from "vitest";
import {
  ADDRESS_INSERT_COLUMNS,
  BACKFILL_TARGETS,
  UPDATE_ADDRESS_ID_SQL,
  WRITE_RE,
  buildStructuredInput,
  classifyTarget,
  createWriteGuard,
  describeInsertParams,
  geographyMismatches,
  oneLine,
  quote,
  renderRecordedInsert,
} from "../../../scripts/lib/location-address-backfill.mjs";

const target = (overrides = {}) => ({ ...BACKFILL_TARGETS[0], ...overrides });
const row = (overrides = {}) => ({
  location_id: 1,
  name: "CoCo Star Hotel",
  address: "CoCo Star Hotel, Manila, Philippines",
  latitude: "14.5159034",
  longitude: "120.9953405",
  address_id: null,
  is_active: true,
  ...overrides,
});

describe("BACKFILL_TARGETS — the scope, stated literally", () => {
  it("names exactly the three approved locations, and no others", () => {
    expect(BACKFILL_TARGETS.map((t) => t.locationId)).toEqual([1, 8, 10]);
  });

  it("expects each location by the name its row actually carries", () => {
    expect(BACKFILL_TARGETS.map((t) => t.expectedName)).toEqual([
      "CoCo Star Hotel",
      "NAIA Terminal 2 - Arrivals",
      "NAIA Terminal 3 - Arrivals (Bay 9)",
    ]);
  });

  it("makes every target operational, which is what permits the missing house number", () => {
    for (const t of BACKFILL_TARGETS) expect(t.type).toBe("operational");
  });

  it("carries NO house/building number on any target — the fabrication is absent, not blank", () => {
    for (const t of BACKFILL_TARGETS) {
      expect(t).not.toHaveProperty("houseBuildingNumber");
      expect(t).not.toHaveProperty("houseNumber");
    }
  });

  it("carries the barangay code as the only believed input, with the rest as expectations", () => {
    for (const t of BACKFILL_TARGETS) {
      expect(t.barangayCode).toMatch(/^\d{10}$/);
      expect(t.expectCityCode).toMatch(/^\d{10}$/);
      expect(t.expectBarangayName).toBeTruthy();
      expect(t.expectCityName).toBeTruthy();
    }
  });

  it("keeps the two Pasay terminals in the barangays that were decided for them", () => {
    const byId = Object.fromEntries(BACKFILL_TARGETS.map((t) => [t.locationId, t]));
    expect(byId[8].barangayCode).toBe("1381100197"); // Barangay 197 — Terminal 2
    expect(byId[10].barangayCode).toBe("1381100183"); // Barangay 183 — Terminal 3
  });

  it("puts the hotel in Parañaque, not the Manila text still stored on the location", () => {
    const hotel = BACKFILL_TARGETS[0];
    expect(hotel.expectCityName).toBe("City of Parañaque");
    expect(hotel.expectCityName).not.toMatch(/manila/i);
  });
});

describe("buildStructuredInput — what is handed to the real resolver", () => {
  it("omits latitude and longitude entirely rather than sending null", () => {
    const input = buildStructuredInput(BACKFILL_TARGETS[0]);
    expect(Object.keys(input)).not.toContain("latitude");
    expect(Object.keys(input)).not.toContain("longitude");
  });

  it("sends an empty house number, which is the absence the operational type allows", () => {
    expect(buildStructuredInput(BACKFILL_TARGETS[0]).houseBuildingNumber).toBe("");
  });

  it("sends the street and the ZIP, because neither is relaxed for an operational address", () => {
    const input = buildStructuredInput(BACKFILL_TARGETS[1]);
    expect(input.streetRoad).toBe("NAIA Road");
    expect(input.postalCode).toBe("1300");
  });

  it("passes the barangay code through as the choice the server resolves", () => {
    expect(buildStructuredInput(BACKFILL_TARGETS[2]).psgcBarangayCode).toBe("1381100183");
  });

  it("never claims verification or a provider", () => {
    const input = buildStructuredInput(BACKFILL_TARGETS[0]);
    expect(input).not.toHaveProperty("verified");
    expect(input).not.toHaveProperty("provider");
  });
});

describe("classifyTarget — a skip is decided before anything is written", () => {
  it("is ready when the row is the expected location, active and unlinked", () => {
    expect(classifyTarget({ target: target(), row: row() }).status).toBe("ready");
  });

  it("refuses a row whose name is not the location we asked for", () => {
    const result = classifyTarget({ target: target(), row: row({ name: "Some Other Hotel" }) });
    expect(result.status).toBe("name_mismatch");
    expect(result.detail).toContain("Some Other Hotel");
  });

  it("refuses a retired location rather than writing to one", () => {
    expect(classifyTarget({ target: target(), row: row({ is_active: false }) }).status).toBe("retired");
  });

  it("skips a location that already carries an address_id, so a re-run converges on zero", () => {
    const result = classifyTarget({ target: target(), row: row({ address_id: 42 }) });
    expect(result.status).toBe("already_linked");
    expect(result.detail).toContain("42");
  });

  it("treats address_id 0 as a real link rather than as absent", () => {
    expect(classifyTarget({ target: target(), row: row({ address_id: 0 }) }).status).toBe("already_linked");
  });

  it("reports a missing row instead of throwing", () => {
    expect(classifyTarget({ target: target(), row: null }).status).toBe("missing");
  });

  it("checks the name BEFORE the link, so a mis-numbered row is never quietly accepted", () => {
    const result = classifyTarget({ target: target(), row: row({ name: "Wrong", address_id: null }) });
    expect(result.status).toBe("name_mismatch");
  });
});

describe("geographyMismatches — the supplied value is asserted, never assumed", () => {
  const chain = {
    region: { code: "1300000000", name: "National Capital Region (NCR)" },
    province: null,
    city: { code: "1381000000", name: "City of Parañaque" },
    barangay: { code: "1381000006", name: "Tambo" },
  };

  it("reports nothing when the resolved chain matches the supplied expectations", () => {
    expect(geographyMismatches(BACKFILL_TARGETS[0], chain)).toEqual([]);
  });

  it("catches a barangay code that resolves somewhere other than the one requested", () => {
    const wrong = { ...chain, barangay: { code: "1381100197", name: "Barangay 197" } };
    const problems = geographyMismatches(BACKFILL_TARGETS[0], wrong);
    expect(problems.join(" ")).toContain("1381100197");
  });

  it("catches the hotel resolving to Manila when Parañaque was supplied", () => {
    const manila = { ...chain, city: { code: "1380600000", name: "City of Manila" } };
    const problems = geographyMismatches(BACKFILL_TARGETS[0], manila);
    expect(problems.join(" ")).toContain("City of Manila");
  });

  it("catches a barangay that resolves under the right city with the wrong name", () => {
    const renamed = { ...chain, barangay: { code: "1381000006", name: "Tambo West" } };
    expect(geographyMismatches(BACKFILL_TARGETS[0], renamed).join(" ")).toContain("Tambo West");
  });
});

describe("createWriteGuard — the dry run cannot write", () => {
  it("refuses an INSERT and records the statement and its parameters", async () => {
    const run = vi.fn();
    const guard = createWriteGuard(run, { apply: false });

    const result = await guard.query("INSERT INTO addresses (a) VALUES ($1)", ["x"]);

    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual({ rows: [], rowCount: 0 });
    expect(guard.refusedCount()).toBe(1);
    expect(guard.refusedWrites[0]).toEqual({ sql: "INSERT INTO addresses (a) VALUES ($1)", params: ["x"] });
  });

  it("refuses every kind of write, so a statement nobody anticipated is caught too", async () => {
    const guard = createWriteGuard(vi.fn(), { apply: false });
    for (const sql of [
      "UPDATE locations SET address_id = $1 WHERE location_id = $2",
      "DELETE FROM addresses WHERE address_id = 1",
      "TRUNCATE addresses",
      "ALTER TABLE addresses ADD COLUMN x int",
    ]) {
      await guard.query(sql);
    }
    expect(guard.refusedCount()).toBe(4);
  });

  it("lets reads through untouched", async () => {
    const run = vi.fn().mockResolvedValue({ rows: [{ n: 1 }], rowCount: 1 });
    const guard = createWriteGuard(run, { apply: false });

    const result = await guard.query("SELECT count(*)::int AS n FROM addresses");

    expect(run).toHaveBeenCalledWith("SELECT count(*)::int AS n FROM addresses", []);
    expect(result.rows).toEqual([{ n: 1 }]);
    expect(guard.refusedCount()).toBe(0);
  });

  it("lets a read that merely NAMES a write keyword through — this is not a substring filter", async () => {
    const run = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const guard = createWriteGuard(run, { apply: false });
    await guard.query("SELECT * FROM integration_log WHERE direction = 'updated'");
    expect(run).toHaveBeenCalled();
    expect(guard.refusedCount()).toBe(0);
  });

  it("writes nothing and RECORDS instead, which is what makes the preview the real statement", async () => {
    const guard = createWriteGuard(vi.fn().mockResolvedValue({ rows: [{ address_id: 9 }], rowCount: 1 }), { apply: false });
    await guard.query("INSERT INTO addresses (a) VALUES ($1)", ["v"]);
    // The guard returned empty rows, so saveAddress's `rows[0]?.address_id` is
    // undefined and it reports no id — the caller must not treat that as one.
    expect(guard.refusedWrites).toHaveLength(1);
  });

  it("passes writes through when apply is true", async () => {
    const run = vi.fn().mockResolvedValue({ rows: [{ address_id: 7 }], rowCount: 1 });
    const guard = createWriteGuard(run, { apply: true });
    const result = await guard.query("INSERT INTO addresses (a) VALUES ($1)", ["v"]);
    expect(run).toHaveBeenCalled();
    expect(result.rows).toEqual([{ address_id: 7 }]);
    expect(guard.refusedCount()).toBe(0);
  });
});

describe("WRITE_RE — refusal by kind, not by allowlist", () => {
  it("matches every statement that changes data", () => {
    for (const sql of ["INSERT INTO t", "UPDATE t SET a=1", "DELETE FROM t", "TRUNCATE t", "DROP TABLE t", "GRANT ALL"]) {
      expect(WRITE_RE.test(sql)).toBe(true);
    }
  });

  it("leads with optional whitespace, so a template literal's indentation does not hide a write", () => {
    expect(WRITE_RE.test("\n    UPDATE locations SET address_id = $1")).toBe(true);
  });

  it("does not match a read", () => {
    for (const sql of ["SELECT * FROM locations", "SELECT count(*) FROM addresses"]) {
      expect(WRITE_RE.test(sql)).toBe(false);
    }
  });
});

describe("the two statements, and how the report renders them", () => {
  it("is the only statement this migration runs against locations", () => {
    expect(oneLine(UPDATE_ADDRESS_ID_SQL)).toBe("UPDATE locations SET address_id = $1 WHERE location_id = $2");
  });

  it("names no coordinate and no legacy address column", () => {
    expect(UPDATE_ADDRESS_ID_SQL).not.toMatch(/latitude|longitude|address\s*=|name\s*=/i);
  });

  it("lists the 25 columns saveAddress binds, in its order", () => {
    expect(ADDRESS_INSERT_COLUMNS).toHaveLength(25);
    expect(ADDRESS_INSERT_COLUMNS[0]).toBe("raw_input");
    expect(ADDRESS_INSERT_COLUMNS[24]).toBe("psgc_barangay_code");
    expect(ADDRESS_INSERT_COLUMNS).toContain("provider");
    expect(ADDRESS_INSERT_COLUMNS).toContain("verified");
    expect(ADDRESS_INSERT_COLUMNS).toContain("postal_code_source");
  });

  it("inlines the parameters so the statement can be read rather than counted", () => {
    const rendered = renderRecordedInsert({
      sql: "INSERT INTO addresses (a, b, c) VALUES ($1, $2, $3)",
      params: ["Tambo", null, false],
    });
    expect(rendered).toBe("INSERT INTO addresses (a, b, c) VALUES ('Tambo', NULL, false)");
  });

  it("escapes a quote rather than producing a statement that reads as a different one", () => {
    expect(quote("O'Brien")).toBe("'O''Brien'");
  });

  it("pairs each parameter with its column, padding any that are absent", () => {
    const described = describeInsertParams({ sql: "INSERT", params: ["raw", "formatted"] });
    expect(described).toHaveLength(25);
    expect(described[0]).toEqual({ column: "raw_input", value: "raw" });
    expect(described[1]).toEqual({ column: "formatted_address", value: "formatted" });
    expect(described[24]).toEqual({ column: "psgc_barangay_code", value: null });
  });
});
