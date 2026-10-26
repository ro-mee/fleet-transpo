import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const engine = "src/lib/ai/predictive-maintenance.test.js";
export const DEMO_CASES = [
  { label: "Overdue without trips", file: engine, test: "reports exceeded mileage even with no trips or calendar date" },
  { label: "Supported future forecast", file: engine, test: "escalates on mileage before the calendar date arrives" },
  { label: "Missing inputs", file: engine, test: "keeps unknown mileage null when a mileage threshold is configured" },
  { label: "Repeated inspection finding", file: "src/lib/maintenance/inspection-signals.test.js", test: "counts distinct inspections by canonical key in a 30 Manila-calendar-day window without splitting brakes/tires" },
  { label: "Active-order reuse", file: "src/services/maintenance-outlook.service.postgres.test.js", test: "uses real review SQL, current server evidence, same-vehicle FK and live active-index predicate" },
  { label: "Isolated service completion", file: "src/app/api/vehicle-maintenance/atomic-completion.postgres.test.js", test: "completes only the linked brake task, audits its cycle, and freezes completion retries" },
];

export function verifyDemoReport(report) {
  if (report.success !== true) throw new Error("The scenario test run did not succeed.");
  return DEMO_CASES.map(scenario => {
    const matches = (report.testResults ?? [])
      .filter(file => {
        const name = file.name.replaceAll("\\", "/");
        return name === scenario.file || name.endsWith("/" + scenario.file);
      })
      .flatMap(file => file.assertionResults ?? [])
      .filter(test => test.title === scenario.test);
    if (matches.length !== 1 || matches[0].status !== "passed") {
      throw new Error(scenario.label + ": the required case is missing, skipped, ambiguous or failed.");
    }
    return scenario.label;
  });
}

async function main() {
  console.log("SYNTHETIC maintenance demonstration: real engine/service tests; PostgreSQL TEMP tables and rollback only.");
  console.log("No live fleet records are created. This does not demonstrate authenticated UI or real multi-connection concurrency.");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "fleetops-maintenance-demo-"));
  const outputFile = join(directory, "report.json");
  try {
    const pattern = DEMO_CASES.map(scenario => scenario.test.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")).join("|");
    const result = spawnSync(process.execPath, [
      join(root, "node_modules/vitest/vitest.mjs"), "run",
      ...new Set(DEMO_CASES.map(scenario => scenario.file)),
      "--testNamePattern", pattern, "--reporter=json", "--outputFile", outputFile,
    ], {
      cwd: root, env: { ...process.env, MAINTENANCE_FIXTURE_DB_TEST: "1", NO_COLOR: "1" },
      encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error("Scenario runner failed. " + (result.error?.message ?? "") + "\n" + result.stdout + result.stderr);
    }
    const labels = verifyDemoReport(JSON.parse(await readFile(outputFile, "utf8")));
    labels.forEach(label => console.log("PASS: " + label));
    console.log("All " + labels.length + " required scenarios passed.");
  } finally {
    await unlink(outputFile).catch(error => { if (error.code !== "ENOENT") throw error; });
    await rmdir(directory);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
