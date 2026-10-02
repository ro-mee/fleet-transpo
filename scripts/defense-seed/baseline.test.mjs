import { describe, expect, it } from "vitest";
import { BUSINESS_TABLES, readDefenseBaseline } from "./baseline.mjs";

describe("defense baseline gate", () => {
  it("checks every operational table and rejects any preexisting row", async () => {
    let sql;
    const db = { query: async (statement) => {
      sql = statement;
      return { rows: [Object.fromEntries(BUSINESS_TABLES.map((table) =>
        [table, table === "transportation_requests" ? 1 : 0]))] };
    } };
    const baseline = await readDefenseBaseline(db);
    expect(BUSINESS_TABLES.every((table) => sql.includes(`FROM "${table}"`))).toBe(true);
    expect(baseline.clean).toBe(false);
    expect(baseline.blockers).toEqual(["transportation_requests: 1 existing rows"]);
  });
});
