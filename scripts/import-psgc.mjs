#!/usr/bin/env node
// Import the Philippine Standard Geographic Code hierarchy into the ph_* tables.
//
//   node scripts/import-psgc.mjs <export-file> [--dry-run]
//   node scripts/import-psgc.mjs <full-snapshot> --dry-run --sync-snapshot
//   node scripts/import-psgc.mjs <full-snapshot> --sync-snapshot --backup <new-file>
//
// The address form's cascade cannot work without this data. Migrations seed the
// curated regions; provinces, cities and barangays are NOT seeded, because
// writing tens of thousands of barangays from memory would assert places that
// may not exist. This script is where they actually come from.
//
// ─────────────────────────────────────────────────────────────────────────────
// INPUT FORMAT — PARENTAGE IS STATED, NOT INFERRED
// ─────────────────────────────────────────────────────────────────────────────
// The file must give each row its level and its parent codes EXPLICITLY:
//
//   level,psgc_code,name,region_code,province_code,city_code,is_city
//   region,0400000000,CALABARZON (Region IV-A),,,,
//   province,0434000000,Laguna,0400000000,,
//   city,0434040000,Santa Rosa City,0400000000,0434000000,,true
//   barangay,043404001,Balabago,0400000000,0434000000,0434040000,
//
// JSON is accepted too: an array of objects with the same keys.
//
// WHY THE PARENT IS NOT DERIVED FROM THE CODE. PSGC codes are hierarchical in
// principle — a barangay's code begins with its city's — so it is tempting to
// mask the last N digits and call that the parent. This script deliberately does
// NOT do that. The digit layout is not uniform across all cases (the province
// segment is meaningless for the province-less cities of Metro Manila, and the
// block widths have changed between PSGC revisions), and a mask that is wrong
// for even one class of code files those addresses under the wrong parent —
// silently, and in exactly the way this feature exists to prevent. So the parent
// is read from the file and then VALIDATED: every region_code, province_code and
// city_code named here must resolve to a row that is also being imported (or
// already present). A file that gets the hierarchy wrong is rejected before
// anything is written.
//
// For the PSA 2Q 2026 workbook, first use scripts/psgc-publication-import.mjs
// to produce explicit parent-code rows. That adapter applies workbook ordering
// and city-class rules; this importer still validates the resulting hierarchy.
//
// ─────────────────────────────────────────────────────────────────────────────
// SAFETY
// ─────────────────────────────────────────────────────────────────────────────
//   * `--dry-run` validates and reports WITHOUT writing. Use it first.
//   * Everything imports in ONE transaction, so a failure half way through
//     leaves the tables exactly as they were rather than half-populated.
//   * Re-runnable and idempotent: rows are upserted on `psgc_code`, so a
//     corrected export converges the tables onto it. This matters because PSGC
//     churn is real — barangays are created and renamed by plebiscite — and
//     and region display names remain migration-owned.
//   * The default mode never DELETES. A code absent from a partial file stays in
//     the table, because
//     deleting a barangay would null out `addresses.psgc_barangay_code` for
//     every address pointing at it. Removing retired geography is a deliberate,
//     explicit snapshot-only act. `--sync-snapshot` requires a full hierarchy,
//     all parent rows in the file, an unused rollback-backup path, and zero
//     address references to absent barangay codes. It locks address/geography
//     writes, then upserts and retires leaf-to-parent in one transaction.
//     Region rows are never pruned or used to overwrite curated labels.
//   * Credentials come from .env via load-env.mjs — never a literal here.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { loadEnvLocal } from "./load-env.mjs";
import { assertFullSnapshot, assertNoReferencedRetirements, planSnapshotSync } from "./lib/psgc-snapshot.mjs";

const LEVELS = ["region", "province", "city", "barangay"];
const BATCH_SIZE = 500;

// Spelled out rather than derived: `ph_${level}s` produces `ph_citys`, and the
// three places that need a table name must not each get to guess.
const TABLE = {
  region: "ph_regions",
  province: "ph_provinces",
  city: "ph_cities",
  barangay: "ph_barangays",
};

/** The table name for a level, or a clear failure. */
const tableFor = (level) => {
  const table = TABLE[level];
  if (!table) throw new Error(`Unknown level "${level}".`);
  return table;
};

// Column aliases, so a hand-made export does not have to match this script's
// preferred spelling exactly. Compared case-insensitively after stripping
// spaces, underscores and hyphens.
const ALIASES = {
  level: ["level", "geographiclevel", "geolevel"],
  psgc_code: ["psgccode", "code", "psgc", "10digitpsgc", "tendigitpsgc"],
  name: ["name", "psgcname", "geographicname"],
  region_code: ["regioncode", "regionpsgc"],
  province_code: ["provincecode", "provincepsgc"],
  city_code: ["citycode", "citymunicipalitycode", "citypsgc", "municipalitycode"],
  is_city: ["iscity", "city"],
};

const normaliseKey = (key) => String(key).toLowerCase().replace(/[\s_-]/g, "");

/** Map a raw header set onto this script's canonical keys. */
function resolveHeaders(rawKeys) {
  const mapping = {};
  const lookup = new Map(rawKeys.map((key) => [normaliseKey(key), key]));

  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const found = lookup.get(alias);
      if (found !== undefined) {
        mapping[canonical] = found;
        break;
      }
    }
  }
  return mapping;
}

/** Minimal RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF. */
function parseCsv(raw) {
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
  return rows;
}

function loadRows(file) {
  const raw = readFileSync(file, "utf8");

  if (file.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.records || parsed.data;
    if (!Array.isArray(list)) {
      throw new Error("JSON input must be an array, or { records: [...] }.");
    }
    return { rows: list, headers: resolveHeaders(Object.keys(list[0] ?? {})), source: parsed.source ?? null };
  }

  const table = parseCsv(raw).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (table.length < 2) throw new Error("CSV input has no data rows.");
  const [header, ...body] = table;
  const mapping = resolveHeaders(header);

  const rows = body.map((cells) => {
    const record = {};
    for (const [canonical, source] of Object.entries(mapping)) {
      record[canonical] = cells[header.indexOf(source)];
    }
    return record;
  });
  return { rows, headers: mapping, source: null };
}

/** Trim a cell, treating an empty string as absent rather than as a value. */
const cell = (value) => {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
};

const truthy = (value) => ["true", "1", "yes", "y", "city"].includes(
  String(value ?? "").trim().toLowerCase()
);

/** Normalise a parsed file into typed, validated records. */
function shapeRows(rows, headers) {
  const missing = ["level", "psgc_code", "name"].filter((key) => !headers[key]);
  if (missing.length) {
    throw new Error(
      `Could not find column(s) ${missing.join(", ")} in the input. ` +
        `Expected headers like: level,psgc_code,name,region_code,province_code,city_code,is_city`
    );
  }

  const problems = [];
  const records = [];

  rows.forEach((row, index) => {
    const line = index + 2; // Header is line 1; CSV line numbers for the report.
    const level = String(cell(row[headers.level]) ?? "").toLowerCase();
    const code = cell(row[headers.psgc_code]);
    const name = cell(row[headers.name]);

    if (!LEVELS.includes(level)) {
      problems.push(`line ${line}: unknown level "${level}"`);
      return;
    }
    if (!code) {
      problems.push(`line ${line}: missing psgc_code`);
      return;
    }
    // The column is varchar(10); a longer code would be silently truncated by
    // Postgres, which would then collide with a different row.
    if (code.length > 10) {
      problems.push(`line ${line}: psgc_code "${code}" is ${code.length} chars (max 10)`);
      return;
    }
    if (!name) {
      problems.push(`line ${line}: missing name for ${code}`);
      return;
    }

    records.push({
      level,
      code,
      name,
      regionCode: headers.region_code ? cell(row[headers.region_code]) : null,
      provinceCode: headers.province_code ? cell(row[headers.province_code]) : null,
      cityCode: headers.city_code ? cell(row[headers.city_code]) : null,
      isCity: truthy(headers.is_city ? row[headers.is_city] : null),
      line,
    });
  });

  return { records, problems };
}

/**
 * Check the hierarchy is internally consistent before writing anything.
 *
 * This is the step that makes "the parent is stated, not inferred" safe: a file
 * that says a barangay belongs to a city which is not in the file (and not
 * already in the table) is rejected, rather than producing an orphan the cascade
 * silently cannot reach.
 */
function validateHierarchy(records, existing, strictSnapshot = false) {
  const problems = [];
  const byLevel = Object.fromEntries(LEVELS.map((level) => [level, new Map()]));

  for (const record of records) {
    if (byLevel[record.level].has(record.code)) {
      problems.push(
        `duplicate ${record.level} code ${record.code} (lines ${byLevel[record.level].get(record.code).line} and ${record.line})`
      );
    }
    byLevel[record.level].set(record.code, record);
  }

  /** A parent is resolvable if the file supplies it or the table already has it. */
  const known = (level, code) =>
    byLevel[level].has(code) || (!strictSnapshot && existing[level].has(code));

  for (const record of records) {
    if (record.level === "province" && !record.regionCode) {
      problems.push(`line ${record.line}: province ${record.code} has no region_code`);
    }
    if (record.level === "city" && !record.regionCode) {
      problems.push(`line ${record.line}: city ${record.code} has no region_code`);
    }
    if (record.level === "barangay" && !record.cityCode) {
      problems.push(`line ${record.line}: barangay ${record.code} has no city_code`);
    }

    // A province-less city is legitimate (Metro Manila), so only check a
    // province_code that is actually present.
    if (record.provinceCode && !known("province", record.provinceCode)) {
      problems.push(
        `line ${record.line}: ${record.level} ${record.code} names province ${record.provinceCode}, which is not in this file or the table`
      );
    }
    if (record.regionCode && !known("region", record.regionCode)) {
      problems.push(
        `line ${record.line}: ${record.level} ${record.code} names region ${record.regionCode}, which is not in this file or the table`
      );
    }
    if (record.cityCode && !known("city", record.cityCode)) {
      problems.push(
        `line ${record.line}: barangay ${record.code} names city ${record.cityCode}, which is not in this file or the table`
      );
    }
  }

  return problems;
}

/** Insert one level, upserting on psgc_code so a re-import converges. */
async function upsert(client, level, rows, columns, conflictUpdates) {
  if (rows.length === 0) return 0;

  let written = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const values = [];
    const tuples = batch.map((row, rowIndex) => {
      const placeholders = columns.map((column, columnIndex) => {
        values.push(row[column]);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(", ")})`;
    });

    const conflict = conflictUpdates === "DO NOTHING"
      ? "DO NOTHING"
      : `DO UPDATE SET ${conflictUpdates}`;
    await client.query(
      `INSERT INTO public.${level} (${columns.join(", ")})
       VALUES ${tuples.join(", ")}
       ON CONFLICT (psgc_code) ${conflict}`,
      values
    );
    written += batch.length;
  }
  return written;
}

async function writeRollbackBackup(client, file, source) {
  const records = [];
  const queries = [
    ["ph_regions", "SELECT psgc_code, name FROM public.ph_regions ORDER BY psgc_code", (row) => ({ level: "region", psgc_code: row.psgc_code, name: row.name })],
    ["ph_provinces", "SELECT psgc_code, name, region_code FROM public.ph_provinces ORDER BY psgc_code", (row) => ({ level: "province", psgc_code: row.psgc_code, name: row.name, region_code: row.region_code })],
    ["ph_cities", "SELECT psgc_code, name, region_code, province_code, is_city FROM public.ph_cities ORDER BY psgc_code", (row) => ({ level: "city", psgc_code: row.psgc_code, name: row.name, region_code: row.region_code, province_code: row.province_code, is_city: row.is_city })],
    ["ph_barangays", "SELECT psgc_code, name, city_code FROM public.ph_barangays ORDER BY psgc_code", (row) => ({ level: "barangay", psgc_code: row.psgc_code, name: row.name, city_code: row.city_code })],
  ];
  for (const [, sql, mapRow] of queries) {
    const { rows } = await client.query(sql);
    records.push(...rows.map(mapRow));
  }

  const output = resolve(process.cwd(), file);
  if (existsSync(output)) throw new Error(`Rollback backup already exists: ${output}`);
  mkdirSync(dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.tmp`;
  try {
    const payload = { source: { kind: "pre-sync database backup", importedSource: source, createdAt: new Date().toISOString() }, records };
    writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
    renameSync(temp, output);
  } catch (error) {
    try { unlinkSync(temp); } catch {}
    throw error;
  }
  console.log(`Rollback snapshot saved: ${output} (${records.length} records)`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const syncSnapshot = args.includes("--sync-snapshot");
  const backupIndex = args.indexOf("--backup");
  const backupFile = backupIndex >= 0 ? args[backupIndex + 1] : null;
  const file = args.find((arg) => !arg.startsWith("--"));

  if (!file) {
    console.error("Usage: node scripts/import-psgc.mjs <export-file> [--dry-run] [--sync-snapshot [--backup <file>]]");
    process.exit(1);
  }
  if (backupIndex >= 0 && (!backupFile || backupFile.startsWith("--"))) {
    throw new Error("--backup needs a new file path.");
  }
  if (backupFile && !syncSnapshot) throw new Error("--backup is only valid with --sync-snapshot.");
  if (syncSnapshot && !dryRun && !backupFile) {
    throw new Error("A real --sync-snapshot run requires --backup <new-file> so the current rows can be restored.");
  }

  const { rows, headers, source } = loadRows(resolve(process.cwd(), file));
  const { records, problems: shapeProblems } = shapeRows(rows, headers);

  if (records.length === 0) {
    console.error("No usable rows found.");
    for (const problem of shapeProblems.slice(0, 20)) console.error(`  ${problem}`);
    process.exit(1);
  }

  loadEnvLocal();
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — check .env.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    // A clear message beats `relation "public.ph_regions" does not exist`, which
    // is what the first query below would otherwise throw.
    const { rows: [ready] } = await client.query(
      "SELECT to_regclass('public.ph_barangays') IS NOT NULL AS ready"
    );
    if (!ready.ready) {
      throw new Error("The ph_* tables do not exist yet — apply migration 123 first (npm run db:up).");
    }

    if (syncSnapshot && !dryRun) {
      await client.query("BEGIN");
      transactionOpen = true;
      // Block address writes while checking their PSGC references and retiring
      // rows. Reads remain available throughout this short import transaction.
      await client.query(
        "LOCK TABLE public.addresses, public.ph_regions, public.ph_provinces, public.ph_cities, public.ph_barangays IN SHARE ROW EXCLUSIVE MODE"
      );
    }

    // What the tables already hold, so a partial re-import validates against it.
    const existing = {};
    const existingRows = {};
    const SELECT_EXISTING = {
      region: "SELECT psgc_code, name FROM public.ph_regions",
      province: "SELECT psgc_code, name, region_code FROM public.ph_provinces",
      city: "SELECT psgc_code, name, region_code, province_code, is_city FROM public.ph_cities",
      barangay: "SELECT psgc_code, name, city_code FROM public.ph_barangays",
    };
    for (const level of LEVELS) {
      const { rows: found } = await client.query(SELECT_EXISTING[level]);
      existing[level] = new Set(found.map((r) => r.psgc_code));
      existingRows[level] = new Map(found.map((row) => [row.psgc_code, row]));
    }

    const hierarchyProblems = validateHierarchy(records, existing, syncSnapshot);
    const problems = [...shapeProblems, ...hierarchyProblems];

    const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
    for (const record of records) counts[record.level] += 1;

    console.log(`Read ${records.length} rows from ${file}`);
    if (source?.publisher) console.log(`Source: ${source.publisher}; ${source.title}; ${source.publicationDate}.`);
    for (const level of LEVELS) {
      console.log(`  ${level.padEnd(9)} ${counts[level]}`);
    }

    let snapshotPlan = null;
    if (syncSnapshot) {
      assertFullSnapshot(records);
      const { rows: references } = await client.query(
        "SELECT DISTINCT psgc_barangay_code FROM public.addresses WHERE psgc_barangay_code IS NOT NULL"
      );
      snapshotPlan = planSnapshotSync(records, existing, references.map((row) => row.psgc_barangay_code), existingRows);
      assertNoReferencedRetirements(snapshotPlan);
      console.log("\nSnapshot reconciliation plan:");
      for (const level of LEVELS) {
        console.log(`  ${level.padEnd(9)} add ${snapshotPlan.add[level].length}; update ${snapshotPlan.update[level]}; retire ${snapshotPlan.retire[level].length}`);
      }
      console.log("  saved address references to retired barangays: 0");
    }

    if (problems.length) {
      // Report and stop. A partial hierarchy is worse than none: the cascade
      // would show a city with no barangays and read as "the data is missing"
      // rather than "the import was wrong".
      console.error(`\n${problems.length} problem(s) — nothing written:`);
      for (const problem of problems.slice(0, 25)) console.error(`  ${problem}`);
      if (problems.length > 25) console.error(`  … and ${problems.length - 25} more`);
      if (transactionOpen) {
        await client.query("ROLLBACK");
        transactionOpen = false;
      }
      process.exitCode = 1;
      return;
    }

    if (dryRun) {
      console.log("\nDry run — hierarchy validated, nothing written.");
      return;
    }

    if (!transactionOpen) {
      await client.query("BEGIN");
      transactionOpen = true;
    }
    if (syncSnapshot) await writeRollbackBackup(client, backupFile, source);

    const written = {};
    written.region = await upsert(
      client, "ph_regions", records.filter((r) => r.level === "region").map((r) => ({
        psgc_code: r.code, name: r.name,
      })),
      ["psgc_code", "name"], syncSnapshot ? "DO NOTHING" : "name = EXCLUDED.name"
    );
    written.province = await upsert(
      client, "ph_provinces", records.filter((r) => r.level === "province").map((r) => ({
        psgc_code: r.code, name: r.name, region_code: r.regionCode,
      })),
      ["psgc_code", "region_code", "name"], "name = EXCLUDED.name, region_code = EXCLUDED.region_code"
    );
    written.city = await upsert(
      client, "ph_cities", records.filter((r) => r.level === "city").map((r) => ({
        psgc_code: r.code, name: r.name, region_code: r.regionCode,
        province_code: r.provinceCode, is_city: r.isCity,
      })),
      ["psgc_code", "region_code", "province_code", "name", "is_city"],
      "name = EXCLUDED.name, region_code = EXCLUDED.region_code, province_code = EXCLUDED.province_code, is_city = EXCLUDED.is_city"
    );
    written.barangay = await upsert(
      client, "ph_barangays", records.filter((r) => r.level === "barangay").map((r) => ({
        psgc_code: r.code, name: r.name, city_code: r.cityCode,
      })),
      ["psgc_code", "city_code", "name"], "name = EXCLUDED.name, city_code = EXCLUDED.city_code"
    );

    const retired = {};
    if (syncSnapshot) {
      for (const [level, table] of [
        ["barangay", "ph_barangays"],
        ["city", "ph_cities"],
        ["province", "ph_provinces"],
      ]) {
        const codes = records.filter((record) => record.level === level).map((record) => record.code);
        const { rowCount } = await client.query(
          `DELETE FROM public.${table} WHERE NOT (psgc_code = ANY($1::varchar[]))`,
          [codes]
        );
        retired[level] = rowCount;
      }
      retired.region = 0; // Region labels and lifecycle remain migration-owned.
    }

    // One transaction, one commit: a failure above leaves the tables untouched
    // rather than half-populated.
    await client.query("COMMIT");
    transactionOpen = false;

    console.log("\nImported:");
    for (const level of LEVELS) console.log(`  ${level.padEnd(9)} ${written[level]}`);
    if (syncSnapshot) {
      console.log("Retired absent codes:");
      for (const level of LEVELS) console.log(`  ${level.padEnd(9)} ${retired[level]}`);
    }

    // Row counts AFTER the write, so the reported number is the table's actual
    // size rather than what this run happened to carry.
    for (const level of LEVELS) {
      const table = tableFor(level);
      const { rows: [row] } = await client.query(`SELECT count(*)::int AS n FROM public.${table}`);
      console.log(`  ${table.padEnd(14)} now holds ${row.n}`);
    }
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
