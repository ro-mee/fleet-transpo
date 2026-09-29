#!/usr/bin/env node
// Convert the PSA quarterly publication workbook into the PSGC import format.
// The workbook is source data; its cells are never executed as instructions.

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import ExcelJS from "exceljs";
import { assertPublicationCounts, normalizePublicationRows } from "./lib/psgc-publication.mjs";

const HEADER = ["10-digit PSGC", "Name", "Geographic Level"];
const DEFAULT_OUTPUT = "scratch/psgc-2q-2026-import.json";

function valueText(value) {
  if (value && typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? "").join("").trim();
    if ("text" in value) return String(value.text).trim();
    if ("result" in value) return valueText(value.result);
  }
  return String(value ?? "").trim();
}

function argsFrom(argv) {
  const args = { dryRun: false, input: null, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--out") {
      args.output = argv[index + 1];
      if (!args.output) throw new Error("--out needs a file path.");
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else if (args.input) {
      throw new Error("Supply one workbook path.");
    } else args.input = arg;
  }
  if (!args.input) {
    throw new Error(`Usage: node scripts/psgc-publication-import.mjs <PSA-workbook.xlsx> [--out <file>] [--dry-run]`);
  }
  return args;
}

function metadata(workbook) {
  const sheet = workbook.getWorksheet("Metadata");
  if (!sheet) throw new Error('Workbook is missing the "Metadata" worksheet.');
  const fields = new Map();
  sheet.eachRow((row) => {
    const label = valueText(row.getCell(1).value).replace(/:$/, "").toLowerCase();
    if (label) fields.set(label, valueText(row.getCell(2).value));
  });
  const publisher = fields.get("originator");
  const title = fields.get("title");
  const publicationDate = fields.get("publication date");
  const useConstraints = fields.get("use constraints");
  if (!publisher?.includes("Philippine Statistics Authority") || !title?.includes("PSGC") || !publicationDate) {
    throw new Error("Workbook metadata does not identify a dated Philippine Statistics Authority PSGC publication.");
  }
  if (!useConstraints?.includes("Acknowledgement of the Philippine Statistics Authority")) {
    throw new Error("PSA attribution requirement is missing from the workbook metadata.");
  }
  return { publisher, title, publicationDate, useConstraints };
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  const input = resolve(process.cwd(), args.input);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(input);

  const info = metadata(workbook);
  const sheet = workbook.getWorksheet("PSGC");
  if (!sheet) throw new Error('Workbook is missing the "PSGC" worksheet.');
  const header = [sheet.getRow(1).getCell(1).value, sheet.getRow(1).getCell(2).value, sheet.getRow(1).getCell(4).value]
    .map(valueText);
  if (header.some((value, index) => value !== HEADER[index])) {
    throw new Error(`Unexpected PSGC sheet columns: ${header.join(" | ")}.`);
  }
  if (valueText(sheet.getRow(1).getCell(6).value) !== "City Class") {
    throw new Error('Unexpected PSGC sheet: column F must be "City Class" for HUC/ICC parent mapping.');
  }

  const sourceRows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = row.getCell(1).value;
    const name = row.getCell(2).value;
    const level = row.getCell(4).value;
    const cityClass = row.getCell(6).value;
    if ([code, name, level].some((value) => value !== null && value !== undefined && value !== "")) {
      sourceRows.push({ rowNumber, code, name, level, cityClass });
    }
  });

  const { records, skipped, counts } = normalizePublicationRows(sourceRows);
  assertPublicationCounts(counts);

  const output = {
    source: { ...info, file: basename(input) },
    records,
    skipped,
  };
  console.log(`${info.publisher} — ${info.title}, ${info.publicationDate}`);
  console.log("PSA attribution: required; retained in the generated import file and documentation.");
  for (const [level, count] of Object.entries(counts)) console.log(`  ${level.padEnd(9)} ${count}`);
  console.log(`  skipped   ${skipped.length} (14 Manila sub-municipalities; 2 non-selectable parent labels)`);

  if (args.dryRun) {
    console.log("Dry run — workbook validated; no output file written.");
    return;
  }

  const outputPath = resolve(process.cwd(), args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
    renameSync(tempPath, outputPath);
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }
  console.log(`Wrote ${outputPath}`);
  console.log(`Next: node scripts/import-psgc.mjs "${args.output}" --dry-run`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
