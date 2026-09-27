import { describe, expect, it } from "vitest";
import { assertPublicationCounts, normalizePublicationRows } from "../../../scripts/lib/psgc-publication.mjs";
import { assertFullSnapshot, assertNoReferencedRetirements, planSnapshotSync } from "../../../scripts/lib/psgc-snapshot.mjs";

const row = (rowNumber, code, name, level, cityClass = null) => ({ rowNumber, code, name, level, cityClass });

describe("normalizePublicationRows", () => {
  it("maps hierarchy by ordered levels and left-pads numeric PSGC values", () => {
    const result = normalizePublicationRows([
      row(2, 900000000, "Region IX", "Reg"),
      row(3, 990100000, "Province A", "Prov"),
      row(4, 990102000, "City A", "City", "CC"),
      row(5, 990102001, "Barangay A", "Bgy"),
      row(6, 990103000, "Manila District", "SubMun"),
      row(7, 990102002, { richText: [{ text: "Riz" }, { text: "al" }] }, "Bgy"),
    ]);

    expect(result.records).toMatchObject([
      { level: "region", psgc_code: "0900000000", name: "Region IX" },
      { level: "province", psgc_code: "0990100000", name: "Province A", region_code: "0900000000" },
      { level: "city", psgc_code: "0990102000", name: "City A", region_code: "0900000000", province_code: "0990100000", is_city: true },
      { level: "barangay", psgc_code: "0990102001", name: "Barangay A", city_code: "0990102000" },
      { level: "barangay", psgc_code: "0990102002", name: "Rizal", city_code: "0990102000" },
    ]);
    expect(result.skipped).toHaveLength(1);
  });

  it("keeps Isabela City and SGA cluster municipalities province-less", () => {
    const result = normalizePublicationRows([
      row(2, "0900000000", "Zamboanga Peninsula", "Reg"),
      row(3, "0990100000", "City of Isabela (Not a Province)", ""),
      row(4, "0990101000", "City of Isabela", "City", "CC"),
      row(5, "0990101001", "Isabela Barangay", "Bgy"),
      row(6, "1900000000", "BARMM", "Reg"),
      row(7, "1999900000", "Special Geographic Area", ""),
      row(8, "1999901000", "SGA Cluster 1", "Mun"),
      row(9, "1999901001", "SGA Barangay", "Bgy"),
    ]);

    expect(result.records.find((record) => record.psgc_code === "0990101000").province_code).toBeNull();
    expect(result.records.find((record) => record.psgc_code === "1999901000")).toMatchObject({
      region_code: "1900000000",
      province_code: null,
      is_city: false,
    });
    expect(result.records.find((record) => record.psgc_code === "1999901001").city_code).toBe("1999901000");
    expect(result.skipped).toHaveLength(2);
  });

  it("uses the PSA city-class column to keep HUCs outside their province section", () => {
    const result = normalizePublicationRows([
      row(2, "0300000000", "Central Luzon", "Reg"),
      row(3, "0307700000", "Pampanga", "Prov"),
      row(4, "0330100000", "City of Angeles", "City", "HUC"),
      row(5, "0330100001", "Barangay A", "Bgy"),
      row(6, "0330700000", "San Fernando", "City", "CC"),
    ]);

    expect(result.records.find((record) => record.psgc_code === "0330100000").province_code).toBeNull();
    expect(result.records.find((record) => record.psgc_code === "0330700000").province_code).toBe("0307700000");
  });

  it("refuses unknown levels and hierarchy rows without a parent", () => {
    expect(() => normalizePublicationRows([row(2, "0100000000", "Region I", "Reg"), row(3, "0100100000", "District", "Dist")])).toThrow(/unexpected geographic level/);
    expect(() => normalizePublicationRows([row(2, "0100100001", "Barangay", "Bgy")])).toThrow(/no preceding city/);
    expect(() => normalizePublicationRows([row(2, "0100000000", "Region I", "Reg"), row(3, "0100100000", "City A", "City")])).toThrow(/unsupported or missing City Class/);
    expect(() => normalizePublicationRows([row(2, "0100000000", "Region I", "Reg"), row(3, "0100100000", "City A", "City", "CC")])).toThrow(/no preceding province/);
  });
});

describe("assertPublicationCounts", () => {
  it("pins the reviewed 2Q 2026 record totals", () => {
    expect(() => assertPublicationCounts({ region: 18, province: 82, city: 1642, barangay: 42010 })).not.toThrow();
    expect(() => assertPublicationCounts({ region: 17, province: 82, city: 1642, barangay: 42010 })).toThrow(/region: expected 18/);
  });
});

describe("PSGC snapshot synchronization safeguards", () => {
  const fullRows = Array.from({ length: 41000 }, (_, index) => ({
    level: "barangay",
    code: String(index).padStart(10, "0"),
  }));

  it("rejects a partial hierarchy before any snapshot deletes can be planned", () => {
    expect(() => assertFullSnapshot([{ level: "region", code: "0100000000" }])).toThrow(/safety floor/);
    expect(assertFullSnapshot([
      ...fullRows,
      ...Array.from({ length: 17 }, (_, index) => ({ level: "region", code: `${String(index).padStart(2, "0")}00000000` })),
      ...Array.from({ length: 80 }, (_, index) => ({ level: "province", code: `10${String(index).padStart(8, "0")}` })),
      ...Array.from({ length: 1600 }, (_, index) => ({ level: "city", code: `20${String(index).padStart(8, "0")}` })),
    ])).toMatchObject({ region: 17, province: 80, city: 1600, barangay: 41000 });
  });

  it("plans retirements but blocks when an address still references one", () => {
    const records = [{ level: "barangay", code: "new-code" }];
    const existing = {
      region: new Set(), province: new Set(), city: new Set(), barangay: new Set(["old-code"]),
    };
    const plan = planSnapshotSync(records, existing, ["old-code"]);
    expect(plan.retire.barangay).toEqual(["old-code"]);
    expect(plan.add.barangay).toEqual(["new-code"]);
    expect(() => assertNoReferencedRetirements(plan)).toThrow(/saved address/);
    expect(() => assertNoReferencedRetirements(planSnapshotSync(records, existing))).not.toThrow();
  });
});
