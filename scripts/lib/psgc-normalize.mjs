// ─────────────────────────────────────────────────────────────────────────────
// Normalise a PSGC dataset into the shape `scripts/import-psgc.mjs` accepts.
// ─────────────────────────────────────────────────────────────────────────────
//
// The importer takes one flat file: `level,psgc_code,name,region_code,
// province_code,city_code,is_city`, with parentage STATED on every row rather
// than inferred from the code's digits. No public PSGC dataset is published in
// that shape — they arrive as one file per level, each with its own column
// names and its own idea of what a code looks like. This module is the seam
// between the two, and it is deliberately the ONLY place that knows either
// side's spelling.
//
// Everything here is a pure function of parsed rows. The CLI wrapper that reads
// files and writes the CSV is `scripts/psgc-normalize.mjs`; this half is under
// test from `src/lib/address/psgc-normalize.test.js`, because vitest only
// collects tests under `src/` and `mobile/lib/`.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CODES: what the source ships, and the one thing that cannot be salvaged
// ─────────────────────────────────────────────────────────────────────────────
//
// PSGC codes are published zero-padded to 10 digits. This source stores them as
// INTEGERS, so a leading zero is gone by the time we see it — and ONLY a leading
// zero, which is the saving grace. Measured across the four files:
//
//   Region I   raw 100000000  → 0100000000     Region X  raw 1000000000 → 1000000000
//     Ilocos Norte 102800000  → 0102800000       Bukidnon    1001300000 → 1001300000
//       Adams      102801000  → 0102801000         Baungon   1001301000 → 1001301000
//         Amuyong  102801001  → 0102801001           Balintad 1001301001 → 1001301001
//
//   NCR        raw 1300000000 → 1300000000
//     City of Caloocan  1380100000 → 1380100000
//       Barangay 1      1380100001 → 1380100001
//
// Every level is the level below it with its tail zeroed, in the 9-digit and the
// 10-digit raw forms alike. Left-padding to 10 recovers the published code
// exactly, in both cases, and the recovery is the identity for the two-digit
// regions. The field widths are therefore 2/3/2/3 — region, province,
// city-or-municipality, barangay — and that is measured, not assumed.
//
// WHICH END YOU PAD IS NOT A FREE CHOICE. The source hands us `100000000` for
// Region I, and this same file gives `1000000000` to Region X. Right-padding the
// first produces the second. Nothing raises. Every address in Ilocos is then
// filed under Northern Mindanao, in a table the cascade reads, with a code that
// validates, joins, and is wrong. `deriveCode` below is that rule and nothing
// else, so if PSA's publication ever contradicts it, it is one function to
// change and one import to re-run.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS STILL NOT SETTLED: which published form this is
// ─────────────────────────────────────────────────────────────────────────────
//
// A second dataset, jgngo/psgc-data (PSGC-DEC2017), packs the same information
// differently. Both agree on the province NUMBER — Cavite is 21, Laguna is 34 —
// but not on where its padding goes:
//
//   Cavite, Region IV-A   faker-ph (here)  0402100000   RR + 0PP + MM + BBB
//                         jgngo           0421000000   RR + PP  + MM + 0000
//
// Picking provinces from one scheme and cities from the other yields a hierarchy
// where NOTHING joins, so the choice is not cosmetic. Two things point at the
// form used here, and neither is proof:
//
//   * These codes are PREFIX-NESTED — `1380100001` extends `1380100000` extends
//     `1380100000`'s region at width 2. Roll-up by `LEFT(code, n)` works. The
//     jgngo form does not nest: `0421000000` and `0400000000` differ at digit 3,
//     so no truncation of one yields the other.
//   * `0100000000` etc. match the 17 regions migration 123 seeds, which is what
//     lets a province row resolve its parent at all.
//
// So this module emits the source's own digits, un-re-encoded, and CHECKS that
// they nest (`problems` below) rather than trusting them. The import is
// consequently self-consistent by construction: whatever PSA's publication
// eventually settles, the form is one function away, and because the importer
// upserts on `psgc_code` and never deletes, a corrected re-import converges.

/** PSGC codes are published 10 digits wide. See the header. */
export const CODE_WIDTH = 10;

/**
 * Where each level ends in a canonical code. Region 2 + province 3 + city 2 +
 * barangay 3 = 10, measured against the source rather than assumed — see the
 * worked examples in the header.
 *
 * These give an EXACT parentage check: a row sits under its parent when the two
 * agree over the parent's own width. Used that way, and never against a level
 * that is not actually its parent — a city under NCR has no province, so it is
 * compared to its region at width 2 and not at width 5, where NCR's district
 * codes would make the comparison meaningless.
 */
export const LEVEL_PREFIX_WIDTH = {
  region: 2,
  province: 5,
  city: 7,
  barangay: 10,
};

/**
 * THE RULE. A source code, re-widened to its published width.
 *
 * Left-pads, because the source drops leading zeros: `100000000` is Region I and
 * must become `0100000000`. Right-padding would make it `1000000000`, which is
 * Region X's code in this very file — a silent alias, not an error.
 *
 * Throws rather than guessing. A non-numeric or over-wide code means the file is
 * not what this was written against, and continuing would write a
 * plausible-looking wrong hierarchy into tables the address form reads.
 */
export function deriveCode(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`PSGC code is not numeric: ${JSON.stringify(raw)}`);
  }
  if (text.length > CODE_WIDTH) {
    throw new Error(`PSGC code ${text} is ${text.length} digits; the column holds ${CODE_WIDTH}`);
  }
  return text.padStart(CODE_WIDTH, "0");
}

/**
 * Does `child` sit under `parentCode` when `parentLevel` is the parent's level?
 *
 * Compares only the digits the parent's level actually occupies, so it is exact
 * in both directions rather than permissive.
 */
export function sitsUnder(child, parentCode, parentLevel) {
  const width = LEVEL_PREFIX_WIDTH[parentLevel];
  return String(child).slice(0, width) === String(parentCode).slice(0, width);
}

/** Trim, and collapse internal runs of whitespace so display copy is clean. */
export function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * The per-level source shape: which file holds a level, and which columns carry
 * its code, its name, and the discriminant saying the row really is that level.
 * The source's column names, kept here rather than at each call site.
 */
export const LEVEL_SOURCES = {
  region: { file: "psgc_regions.csv", code: "adm1_psgc", name: "adm1_en", geoLevels: ["Reg"] },
  province: { file: "psgc_provinces.csv", code: "adm2_psgc", name: "adm2_en", geoLevels: ["Prov"] },
  city: {
    file: "psgc_cities.csv",
    code: "adm3_psgc",
    name: "adm3_en",
    // SGU is BARMM's Special Geographic Area — the 63 barangays that joined the
    // region by plebiscite in 2019, grouped into clusters. They are not cities,
    // but this model has no level between region and barangay, so the cluster is
    // where a barangay under them has to attach. Dropping them orphans all 63.
    geoLevels: ["City", "Mun", "SGU"],
  },
  barangay: { file: "psgc_barangays.csv", code: "adm4_psgc", name: "adm4_en", geoLevels: ["Bgy"] },
};

export const LEVELS = ["region", "province", "city", "barangay"];

/**
 * Which source column carries the code of each ANCESTOR level. A row's own code
 * is in `LEVEL_SOURCES[level].code`; its parents are in these. Same idea: the
 * source's spelling, named once.
 */
export const ANCESTOR_COLUMNS = {
  region: "adm1_psgc",
  province: "adm2_psgc",
  city: "adm3_psgc",
};

/** The column naming a row's administrative level (Reg / Prov / City / Mun / Bgy). */
export const GEO_LEVEL_COLUMN = "geo_level";

/** The exact header `scripts/import-psgc.mjs` resolves against its alias table. */
export const OUTPUT_HEADER = [
  "level",
  "psgc_code",
  "name",
  "region_code",
  "province_code",
  "city_code",
  "is_city",
];

/** Minimal RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCsv(raw) {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Trailing blank lines are common in hand-edited exports and are not records.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Rows as objects keyed by the file's own header, so callers name columns. */
export function toRecords(table) {
  const [header, ...body] = table;
  if (!header) return [];
  return body.map((cells) => {
    const record = {};
    header.forEach((key, index) => {
      record[key.trim()] = cells[index] ?? "";
    });
    return record;
  });
}

/** Quote a CSV cell if it needs it — the source's district names carry commas. */
export function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialise records against `OUTPUT_HEADER`. */
export function toCsv(records) {
  const lines = [OUTPUT_HEADER.join(",")];
  for (const record of records) {
    lines.push(OUTPUT_HEADER.map((key) => csvCell(record[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** Record a contradiction against a level's code map, keeping the first name. */
function claim(problems, seen, level, code, name) {
  const previous = seen[level].get(code);
  if (previous !== undefined && previous !== name) {
    problems.push(`${level} ${code} is claimed by both "${previous}" and "${name}"`);
  }
  seen[level].set(code, name);
}

/**
 * Turn the four parsed source files into one flat record list, plus a report of
 * what was dropped and why, plus any hierarchy contradiction found.
 *
 * `dataset` is `{ region, province, city, barangay }`, each a parsed CSV table
 * (array of arrays) as returned by `parseCsv`.
 *
 * Returns `{ records, problems, report, regionRows }`. `regionRows` is returned
 * but never merged into `records` — see the note in the CLI.
 */
export function normalize(dataset) {
  const problems = [];
  const report = [];

  const rowsFor = (level) => {
    const spec = LEVEL_SOURCES[level];
    const kept = [];
    const skipped = new Map();

    for (const record of toRecords(dataset[level] ?? [])) {
      const geoLevel = cleanName(record[GEO_LEVEL_COLUMN]);
      if (!spec.geoLevels.includes(geoLevel)) {
        skipped.set(geoLevel, (skipped.get(geoLevel) ?? 0) + 1);
        continue;
      }
      kept.push(record);
    }

    // Named by level, not summarised as a count. A silent drop here is how the
    // first run of this converter turned 960 barangays into orphans — the rows
    // that went missing were the parents of rows that stayed.
    //
    // A BLANK level is reported as its own thing. "Dropped at level \"\"" reads
    // like a bug in this file, and it is not: it means the source row carries no
    // level at all, which is a different defect from a level this model has no
    // column for. Both are dropped, and neither should look like the other.
    for (const [geoLevel, count] of skipped) {
      const why = geoLevel
        ? `at level "${geoLevel}" — this model has ${spec.geoLevels.join(", ")}`
        : `with no ${GEO_LEVEL_COLUMN} at all — the source does not say what they are`;
      report.push(`${level}: dropped ${count} row(s) ${why}`);
    }
    return kept;
  };

  // ── Regions ────────────────────────────────────────────────────────────────
  // Parsed, checked against, and reported — but NOT emitted. Migration 123
  // already seeds all 17, in the display form the address spec asks for
  // ("CALABARZON (Region IV-A)", name first), and the importer's region upsert
  // is `name = EXCLUDED.name`. Emitting them would overwrite a deliberate naming
  // decision with a source's own ordering, silently.
  //
  // The seed is the authority on regions. Where the two disagree, that is a
  // defect in the seed and belongs in a migration, not in a data file.
  const regions = rowsFor("region").map((row) => ({
    code: deriveCode(row[LEVEL_SOURCES.region.code]),
    name: cleanName(row[LEVEL_SOURCES.region.name]),
  }));

  const regionCodes = new Set(regions.map((region) => region.code));

  // ── Provinces ──────────────────────────────────────────────────────────────
  const provinces = rowsFor("province").map((row) => ({
    code: deriveCode(row[LEVEL_SOURCES.province.code]),
    name: cleanName(row[LEVEL_SOURCES.province.name]),
    regionCode: deriveCode(row[ANCESTOR_COLUMNS.region]),
  }));

  const provinceCodes = new Set(provinces.map((province) => province.code));

  // ── Cities and municipalities ──────────────────────────────────────────────
  // A city's `adm2` is its province — EXCEPT in the National Capital Region,
  // where there are no provinces and the source repeats the city's own code in
  // that column, and except for the districts (`geo_level = Dist`) the provinces
  // file carries for NCR, which are not administrative units anyone types into
  // an address. Both resolve the same way: `adm2` is a province only if a real
  // province row claims that code. Otherwise the city hangs off its region,
  // which is what `ph_cities.province_code` being nullable is for.
  let provinceLessCities = 0;
  const cities = rowsFor("city").map((row) => {
    const adm2 = deriveCode(row[ANCESTOR_COLUMNS.province]);
    const provinceCode = provinceCodes.has(adm2) ? adm2 : "";
    if (!provinceCode) provinceLessCities += 1;

    return {
      code: deriveCode(row[LEVEL_SOURCES.city.code]),
      name: cleanName(row[LEVEL_SOURCES.city.name]),
      regionCode: deriveCode(row[ANCESTOR_COLUMNS.region]),
      provinceCode,
      isCity: cleanName(row[GEO_LEVEL_COLUMN]) === "City",
    };
  });

  if (provinceLessCities > 0) {
    report.push(`city: ${provinceLessCities} row(s) have no province and hang off their region`);
  }

  const cityCodes = new Set(cities.map((city) => city.code));

  // ── Barangays ──────────────────────────────────────────────────────────────
  // A barangay needs only its city, but its region and — where there is one —
  // its province are carried too: the importer resolves every stated parent, so
  // sending them turns a mislabelled row into a refusal rather than an orphan
  // the cascade silently cannot reach.
  //
  // Metro Manila interposes DISTRICTS between a city and its barangays — Tondo,
  // Sampaloc, Ermita — and those district codes are not rows at any level the
  // source publishes. Manila's 897 barangays name one, so taken literally they
  // all orphan. This model has four levels and no district, so the district is
  // COLLAPSED: the barangay attaches to the city that owns it, which is exactly
  // the address people actually write ("Barangay 1, Manila").
  //
  // The fallback is deliberately narrow. `adm2` is a city only in the
  // province-less case (NCR), where a city occupies the province slot; for a
  // barangay anywhere else `adm2` is genuinely a province and is never a city
  // row, so nothing is ever re-pointed at a province by accident.
  let provinceLessBarangays = 0;
  let collapsedDistricts = 0;
  const barangays = rowsFor("barangay").map((row) => {
    const adm2 = deriveCode(row[ANCESTOR_COLUMNS.province]);
    const adm3 = deriveCode(row[ANCESTOR_COLUMNS.city]);
    const provinceCode = provinceCodes.has(adm2) ? adm2 : "";
    if (!provinceCode) provinceLessBarangays += 1;

    const collapsed = !cityCodes.has(adm3) && cityCodes.has(adm2);
    if (collapsed) collapsedDistricts += 1;

    return {
      code: deriveCode(row[LEVEL_SOURCES.barangay.code]),
      name: cleanName(row[LEVEL_SOURCES.barangay.name]),
      regionCode: deriveCode(row[ANCESTOR_COLUMNS.region]),
      provinceCode,
      cityCode: collapsed ? adm2 : adm3,
      // What the digits actually nest under. Equal to `cityCode` everywhere
      // except a collapsed district, where it is the district we do not store.
      digitCityCode: adm3,
    };
  });

  if (provinceLessBarangays > 0) {
    report.push(
      `barangay: ${provinceLessBarangays} row(s) sit outside any province (NCR and the province-less cities)`
    );
  }

  if (collapsedDistricts > 0) {
    report.push(
      `barangay: ${collapsedDistricts} row(s) attach to their city directly, because the source interposes a district level this model does not have (Metro Manila)`
    );
  }

  // ── Contradictions ─────────────────────────────────────────────────────────
  // Duplicate codes collide on the primary key and mean the source is not the
  // uniform export it claims to be.
  const seen = Object.fromEntries(LEVELS.map((level) => [level, new Map()]));
  for (const { code, name } of regions) claim(problems, seen, "region", code, name);
  for (const { code, name } of provinces) claim(problems, seen, "province", code, name);
  for (const { code, name } of cities) claim(problems, seen, "city", code, name);
  for (const { code, name } of barangays) claim(problems, seen, "barangay", code, name);

  // Every stated parent must exist, and the code's own digits must agree. The
  // second is the check that would have caught a badly repacked code: the names
  // would still resolve, and only the digits would betray it.
  const check = (child, parentCode, parentLevel, label) => {
    if (!parentCode) return;
    if (!sitsUnder(child.code, parentCode, parentLevel)) {
      problems.push(
        `${label} ${child.code} (${child.name}) does not sit under ${parentLevel} ${parentCode} — its digits say it belongs elsewhere`
      );
    }
  };

  for (const province of provinces) {
    if (!regionCodes.has(province.regionCode)) {
      problems.push(
        `province ${province.code} names region ${province.regionCode}, which no region row claims`
      );
    }
    check(province, province.regionCode, "region", "province");
  }

  for (const city of cities) {
    if (!regionCodes.has(city.regionCode)) {
      problems.push(`city ${city.code} names region ${city.regionCode}, which no region row claims`);
    }
    check(city, city.regionCode, "region", "city");
    check(city, city.provinceCode, "province", "city");
  }

  for (const barangay of barangays) {
    if (!cityCodes.has(barangay.cityCode)) {
      problems.push(
        `barangay ${barangay.code} names city ${barangay.cityCode}, which no city row claims`
      );
    }
    // The digits are checked against the structure the source actually has. For
    // a collapsed district that is the district and not the city we store —
    // comparing against the city would flag all 897 of Manila's barangays for a
    // collapse that was deliberate.
    check(barangay, barangay.digitCityCode, "city", "barangay");
    check(barangay, barangay.provinceCode, "province", "barangay");
  }

  const records = [
    ...provinces.map((province) => ({
      level: "province",
      psgc_code: province.code,
      name: province.name,
      region_code: province.regionCode,
      province_code: "",
      city_code: "",
      is_city: "false",
    })),
    ...cities.map((city) => ({
      level: "city",
      psgc_code: city.code,
      name: city.name,
      region_code: city.regionCode,
      province_code: city.provinceCode,
      city_code: "",
      is_city: city.isCity ? "true" : "false",
    })),
    ...barangays.map((barangay) => ({
      level: "barangay",
      psgc_code: barangay.code,
      name: barangay.name,
      region_code: barangay.regionCode,
      province_code: barangay.provinceCode,
      city_code: barangay.cityCode,
      is_city: "false",
    })),
  ];

  return { records, problems, report, regionRows: regions };
}
