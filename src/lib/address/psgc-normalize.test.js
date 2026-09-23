import { describe, expect, it } from "vitest";
import {
  ANCESTOR_COLUMNS,
  CODE_WIDTH,
  deriveCode,
  LEVEL_PREFIX_WIDTH,
  normalize,
  parseCsv,
  sitsUnder,
  toCsv,
  toRecords,
} from "../../../scripts/lib/psgc-normalize.mjs";

// The fixtures are written here rather than read from the clone under `scratch/`
// — that directory is gitignored, so a test that read it would pass on the
// machine that cloned it and fail everywhere else.
//
// Their raw codes are copied from the real source, including the property that
// makes them worth testing: region I's subtree is 9 digits because its leading
// zero was dropped on export, while region X's is already 10.

const LEVEL_HEADER = "level,psgc_code,name,region_code,province_code,city_code,is_city";

const REGIONS = `adm1_psgc,adm1_en,geo_level
100000000,Region I (Ilocos Region),Reg
1000000000,Region X (Northern Mindanao),Reg
1300000000,National Capital Region (NCR),Reg
1900000000,Bangsamoro Autonomous Region In Muslim Mindanao (BARMM),Reg
`;

const PROVINCES = `adm1_psgc,adm2_psgc,adm2_en,geo_level
100000000,102800000,Ilocos Norte,Prov
1000000000,1001300000,Bukidnon,Prov
1300000000,1380100000,"NCR, First District (Not a Province)",Dist
`;

const CITIES = `adm1_psgc,adm2_psgc,adm3_psgc,adm3_en,geo_level
100000000,102800000,102801000,Adams,Mun
1000000000,1001300000,1001301000,Baungon,Mun
1300000000,1380100000,1380100000,City of Caloocan,City
`;

const BARANGAYS = `adm1_psgc,adm2_psgc,adm3_psgc,adm4_psgc,adm4_en,geo_level
100000000,102800000,102801000,102801001,Amuyong,Bgy
1000000000,1001300000,1001301000,1001301001,Balintad,Bgy
1300000000,1380100000,1380100000,1380100001,Barangay 1,Bgy
`;

function dataset(overrides = {}) {
  const source = {
    region: REGIONS,
    province: PROVINCES,
    city: CITIES,
    barangay: BARANGAYS,
    ...overrides,
  };

  return Object.fromEntries(Object.entries(source).map(([level, csv]) => [level, parseCsv(csv)]));
}

const byCode = (records, code) => records.find((record) => record.psgc_code === code);

describe("deriveCode", () => {
  it("recovers the published width by left-padding", () => {
    // Region I ships as the integer 100000000; the published code is 0100000000.
    expect(deriveCode("100000000")).toBe("0100000000");
    expect(deriveCode("102800000")).toBe("0102800000");
    expect(deriveCode("102801001")).toBe("0102801001");
  });

  it("leaves a code that already fills the column alone", () => {
    expect(deriveCode("1000000000")).toBe("1000000000");
    expect(deriveCode("1380100001")).toBe("1380100001");
  });

  it("does not pad on the right, which would alias Region I onto Region X", () => {
    // This is the whole reason the padding direction is stated rather than
    // obvious: right-padding Region I's raw code produces, exactly, the code
    // this same source gives Region X.
    expect("100000000".padEnd(CODE_WIDTH, "0")).toBe("1000000000");
    expect(deriveCode("100000000")).not.toBe(deriveCode("1000000000"));
  });

  it("refuses a code it cannot re-widen", () => {
    expect(() => deriveCode("")).toThrow(/not numeric/);
    expect(() => deriveCode("12a4000000")).toThrow(/not numeric/);
    expect(() => deriveCode("12345678901")).toThrow(/column holds 10/);
  });
});

describe("sitsUnder", () => {
  it("compares only the digits the parent's level occupies", () => {
    // Bukidnon is region X (`10`), not region I (`01`).
    expect(sitsUnder("1001300000", "1000000000", "region")).toBe(true);
    expect(sitsUnder("1001300000", "0100000000", "region")).toBe(false);

    expect(sitsUnder("0102801000", "0102800000", "province")).toBe(true);
    expect(sitsUnder("0102801001", "0102801000", "city")).toBe(true);
  });

  it("holds for a city with no province, compared against its region", () => {
    expect(sitsUnder("1380100000", "1300000000", "region")).toBe(true);
    // And the comparison would be meaningless at province width, where NCR's
    // district codes live — which is why it is never made.
    expect(sitsUnder("1380100000", "1300000000", "province")).toBe(false);
  });
});

describe("normalize", () => {
  it("re-widens every level of a 9-digit subtree", () => {
    const { records, problems } = normalize(dataset());
    expect(problems).toEqual([]);

    const adam = byCode(records, "0102801000");
    expect(adam).toMatchObject({
      level: "city",
      name: "Adams",
      region_code: "0100000000",
      province_code: "0102800000",
      is_city: "false",
    });

    expect(byCode(records, "0102801001")).toMatchObject({
      level: "barangay",
      name: "Amuyong",
      region_code: "0100000000",
      province_code: "0102800000",
      city_code: "0102801000",
    });
  });

  it("leaves a 10-digit subtree untouched", () => {
    const { records } = normalize(dataset());

    expect(byCode(records, "1001300000")).toMatchObject({
      level: "province",
      name: "Bukidnon",
      region_code: "1000000000",
    });
    expect(byCode(records, "1001301001")).toMatchObject({
      level: "barangay",
      name: "Balintad",
      city_code: "1001301000",
    });
  });

  it("gives a province-less city no province rather than a fabricated one", () => {
    const { records, report } = normalize(dataset());

    // Caloocan's adm2 repeats its own code, and NCR's district rows are not
    // provinces, so there is nothing legitimate to put here.
    expect(byCode(records, "1380100000")).toMatchObject({
      level: "city",
      name: "City of Caloocan",
      region_code: "1300000000",
      province_code: "",
      is_city: "true",
    });
    expect(byCode(records, "1380100001")).toMatchObject({
      level: "barangay",
      province_code: "",
      city_code: "1380100000",
    });
    expect(report.join("\n")).toMatch(/city: 1 row\(s\) have no province/);
  });

  it("drops the district pseudo-provinces and says so", () => {
    const { records, report } = normalize(dataset());

    expect(records.some((record) => record.name.startsWith("NCR, First District"))).toBe(false);
    expect(report.join("\n")).toMatch(/province: dropped 1 row\(s\)/);
  });

  it("carries is_city from the source's own level, not from its name", () => {
    const { records } = normalize(dataset());
    const cities = records.filter((record) => record.level === "city");

    expect(cities.map((city) => [city.name, city.is_city])).toEqual([
      ["Adams", "false"],
      ["Baungon", "false"],
      ["City of Caloocan", "true"],
    ]);
  });

  it("does not emit region rows", () => {
    const { records, regionRows } = normalize(dataset());

    expect(records.some((record) => record.level === "region")).toBe(false);
    // Still parsed and reported, so a disagreement with the migration-123 seed
    // is visible before the import rather than as a failed foreign key.
    expect(regionRows).toEqual([
      { code: "0100000000", name: "Region I (Ilocos Region)" },
      { code: "1000000000", name: "Region X (Northern Mindanao)" },
      { code: "1300000000", name: "National Capital Region (NCR)" },
      {
        code: "1900000000",
        name: "Bangsamoro Autonomous Region In Muslim Mindanao (BARMM)",
      },
    ]);
  });

  it("catches a code whose digits put it in another region", () => {
    // The failure this exists for: every NAME still resolves, the row imports,
    // and only the digits are wrong — so the check is on the digits.
    const mismatched = `adm1_psgc,adm2_psgc,adm3_psgc,adm3_en,geo_level
100000000,102800000,1001301000,Baungon,Mun
`;

    const { problems } = normalize(dataset({ city: mismatched }));

    // Two: the digits contradict both parents the row names.
    expect(problems).toContainEqual(
      expect.stringContaining("city 1001301000 (Baungon) does not sit under region 0100000000")
    );
    expect(problems).toContainEqual(
      expect.stringContaining("city 1001301000 (Baungon) does not sit under province 0102800000")
    );
  });

  it("catches a parent that no row claims", () => {
    // A barangay in a municipality the cities file does not have. Its own digits
    // are perfectly well formed; only the lookup can refuse it.
    const orphan = `adm1_psgc,adm2_psgc,adm3_psgc,adm4_psgc,adm4_en,geo_level
100000000,102800000,102800500,102800501,Ghost,Bgy
`;

    const { problems } = normalize(dataset({ barangay: orphan }));

    expect(problems).toEqual([
      "barangay 0102800501 names city 0102800500, which no city row claims",
    ]);
  });

  it("catches one code claimed by two different names", () => {
    const duplicated = `adm1_psgc,adm2_psgc,adm2_en,geo_level
100000000,102800000,Ilocos Norte,Prov
100000000,102800000,Ilocos Sur,Prov
`;

    const { problems } = normalize(dataset({ province: duplicated }));

    expect(problems.join("\n")).toMatch(/province 0102800000 is claimed by both/);
  });

  it("collapses a district the source interposes between city and barangay", () => {
    // Metro Manila's real shape: the barangay names a district code that is not a
    // row at any level, while adm2 carries the city it actually belongs to. The
    // address people write has no district in it, so neither does this.
    const withDistrict = `adm1_psgc,adm2_psgc,adm3_psgc,adm4_psgc,adm4_en,geo_level
1300000000,1380100000,1380101000,1380101001,Tondo,Bgy
`;

    const { records, problems, report } = normalize(dataset({ barangay: withDistrict }));

    expect(problems).toEqual([]);
    expect(byCode(records, "1380101001")).toMatchObject({
      level: "barangay",
      name: "Tondo",
      city_code: "1380100000",
      region_code: "1300000000",
      province_code: "",
    });
    expect(report.join("\n")).toMatch(/barangay: 1 row\(s\) attach to their city directly/);
  });

  it("keeps a Special Geographic Area cluster, which has no level of its own", () => {
    // BARMM's 63 captured barangays sit under clusters, not cities. Dropping the
    // cluster orphans every one of them.
    const clusters = `adm1_psgc,adm2_psgc,adm3_psgc,adm3_en,geo_level
1900000000,1999900000,1999901000,Carmen Cluster,SGU
`;
    const clustered = `adm1_psgc,adm2_psgc,adm3_psgc,adm4_psgc,adm4_en,geo_level
1900000000,1999900000,1999901000,1999901001,Carmen,Bgy
`;

    const { records, problems } = normalize(dataset({ city: clusters, barangay: clustered }));

    expect(problems).toEqual([]);
    expect(byCode(records, "1999901000")).toMatchObject({
      level: "city",
      name: "Carmen Cluster",
      // Not a city, but the only slot this model has for it.
      is_city: "false",
      province_code: "",
    });
    expect(byCode(records, "1999901001")).toMatchObject({
      level: "barangay",
      name: "Carmen",
      city_code: "1999901000",
    });
  });

  it("names the level it dropped rather than only counting it", () => {
    // The first run of this converter dropped 16 rows silently and orphaned 960
    // barangays, and the count alone gave no way to tell which level was gone.
    const withOddLevel = `adm1_psgc,adm2_psgc,adm3_psgc,adm4_psgc,adm4_en,geo_level
100000000,102800000,102801000,102801001,Amuyong,Bgy
100000000,102800000,102801000,102801002,Tondo,SubMun
`;

    const { report, problems } = normalize(dataset({ barangay: withOddLevel }));

    expect(problems).toEqual([]);
    expect(report.join("\n")).toMatch(/barangay: dropped 1 row\(s\) at level "SubMun"/);
  });

  it("distinguishes a missing level from a level this model lacks", () => {
    // The real source has four of these — two pseudo-provinces and two Manila
    // First District barangays whose names are missing too. `dropped ... at level
    // ""` reads like a bug in this converter; the source, not the converter, is
    // the one that failed to say what these are.
    const noLevel = `adm1_psgc,adm2_psgc,adm3_psgc,adm4_psgc,adm4_en,geo_level
100000000,102800000,102801000,102801001,Amuyong,Bgy
100000000,102800000,102801000,102801002,Unnamed,
`;

    const { report, problems } = normalize(dataset({ barangay: noLevel }));

    expect(problems).toEqual([]);
    expect(report.join("\n")).toMatch(/barangay: dropped 1 row\(s\) with no geo_level at all/);
  });
});

describe("csv", () => {
  it("reads a quoted field containing a comma", () => {
    // The real source's NCR district names are comma-delimited inside quotes.
    const [record] = toRecords(
      parseCsv('adm1_psgc,adm2_en\n1300000000,"NCR, First District (Not a Province)"\n')
    );

    expect(record.adm2_en).toBe("NCR, First District (Not a Province)");
  });

  it("quotes on the way out, and emits the header the importer resolves", () => {
    const csv = toCsv([
      {
        level: "city",
        psgc_code: "1380100000",
        name: 'District "A", City of Caloocan',
        region_code: "1300000000",
        province_code: "",
        city_code: "",
        is_city: "true",
      },
    ]);

    const [header, row] = csv.trim().split("\n");
    expect(header).toBe(LEVEL_HEADER);
    expect(row).toBe('city,1380100000,"District ""A"", City of Caloocan",1300000000,,,true');
  });

  it("trims a name that carries a trailing space", () => {
    const [record] = toRecords(parseCsv("adm4_en\nBarangay I \n"));
    expect(record.adm4_en).toBe("Barangay I ");
    // `cleanName` is what the records carry; raw parsing is untouched.
    expect(normalize(dataset()).records.every((r) => r.name === r.name.trim())).toBe(true);
  });
});

describe("level shape", () => {
  it("names every ancestor column the source actually has", () => {
    expect(Object.keys(ANCESTOR_COLUMNS)).toEqual(["region", "province", "city"]);
    expect(LEVEL_PREFIX_WIDTH).toEqual({ region: 2, province: 5, city: 7, barangay: 10 });
  });
});
