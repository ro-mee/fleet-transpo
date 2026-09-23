#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Turn a per-level PSGC dataset into the one flat file `import-psgc.mjs` reads.
// ─────────────────────────────────────────────────────────────────────────────
//
//   node scripts/psgc-normalize.mjs [source-dir] [--out <file>] [--dry-run]
//
// `source-dir` defaults to the faker-ph clone under `scratch/` and must hold
// `psgc_regions.csv`, `psgc_provinces.csv`, `psgc_cities.csv` and
// `psgc_barangays.csv`. The output defaults to `scratch/psgc-normalized.csv`.
//
// Then:  node scripts/import-psgc.mjs <output> --dry-run
//        node scripts/import-psgc.mjs <output>
//
// This script touches no database and needs no credentials. It reads files,
// applies the rules in `scripts/lib/psgc-normalize.mjs` — where the one
// unresolved rule and its evidence live — and writes one CSV. If the rules are
// wrong, this is the only thing that has to be re-run before the import.
//
// ── WHY THE OUTPUT IS NOT COMMITTED ─────────────────────────────────────────
// It is ~42,000 rows of derived third-party data, and `scratch/` is gitignored
// by policy. The reproducible artifact is this script plus the lib's documented
// rules, not a snapshot of their output.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  LEVELS,
  LEVEL_SOURCES,
  normalize,
  parseCsv,
  toCsv,
} from "./lib/psgc-normalize.mjs";

const DEFAULT_SOURCE = "scratch/psgc-probe/faker-ph/src/faker_ph/data";
const DEFAULT_OUTPUT = "scratch/psgc-normalized.csv";

const USAGE = `Usage: node scripts/psgc-normalize.mjs [source-dir] [--out <file>] [--dry-run]

  source-dir   Directory holding psgc_regions.csv, psgc_provinces.csv,
               psgc_cities.csv and psgc_barangays.csv.
               Default: ${DEFAULT_SOURCE}
  --out, -o    Where to write the import file. Default: ${DEFAULT_OUTPUT}
  --dry-run    Validate and report, write nothing.`;

function parseArgs(argv) {
  const args = { source: null, out: DEFAULT_OUTPUT, dryRun: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--out" || arg === "-o") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) throw new Error("--out needs a file path.");
      args.out = value;
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}`);
    } else if (args.source === null) {
      args.source = arg;
    } else {
      throw new Error(`Unexpected argument ${arg} — only one source directory is read.`);
    }
  }

  return args;
}

function readDataset(sourceDir) {
  const dataset = {};

  for (const level of LEVELS) {
    const file = join(sourceDir, LEVEL_SOURCES[level].file);
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      throw new Error(
        `Cannot read ${file}.\nPass the directory that holds the four psgc_*.csv files, or see --help.`
      );
    }
    dataset[level] = parseCsv(raw);
  }

  return dataset;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const sourceDir = resolve(process.cwd(), args.source ?? DEFAULT_SOURCE);
  const dataset = readDataset(sourceDir);
  const { records, problems, report, regionRows } = normalize(dataset);

  console.log(`Source  ${sourceDir}`);
  for (const level of LEVELS) {
    // Minus the header row.
    console.log(`  ${level.padEnd(9)} ${String(dataset[level].length - 1).padStart(6)} source rows`);
  }

  console.log("\nTo import:");
  for (const level of LEVELS) {
    const count = records.filter((record) => record.level === level).length;
    console.log(`  ${level.padEnd(9)} ${String(count).padStart(6)}`);
  }
  console.log(`  ${"TOTAL".padEnd(9)} ${String(records.length).padStart(6)}`);

  if (report.length) {
    console.log("\nNotes:");
    for (const line of report) console.log(`  ${line}`);
  }

  console.log(`
Regions are NOT written. Migration 123 seeds all 17, in the display form the
address spec asks for ("CALABARZON (Region IV-A)", name first) — and the
importer's region upsert is \`name = EXCLUDED.name\`, so emitting these would
overwrite that decision silently. The seed is the authority on regions; where
the two disagree the seed is wrong, and that belongs in a migration.

Listed so a disagreement is visible BEFORE the import runs. The kind that
matters is a region CODE the seed does not have: the importer refuses any row
whose region it cannot resolve, so every province, city and barangay under it
would fail:

${regionRows.map((region) => `  ${region.code}  ${region.name}`).join("\n")}`);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s) — nothing written:`);
    for (const problem of problems.slice(0, 25)) console.error(`  ${problem}`);
    if (problems.length > 25) console.error(`  … and ${problems.length - 25} more`);
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log("\nDry run — hierarchy validated, nothing written.");
    return;
  }

  const out = resolve(process.cwd(), args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toCsv(records), "utf8");

  console.log(`\nWrote ${records.length} rows to ${out}`);
  console.log("Next:  node scripts/import-psgc.mjs " + args.out + " --dry-run");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
