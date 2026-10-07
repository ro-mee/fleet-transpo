// Staged-rollout fleet inventory (Release B Task 7).
//
// READ-ONLY BY CONSTRUCTION: every statement below is a SELECT. The script
// never inserts, updates, deletes, or alters — committed trips and legacy
// completed rows are preserved for review, never rewritten. A static test
// (readiness-inventory.test.js "audit script stays read-only") fails the suite
// if a write statement ever appears in this file.
//
// What it does: loads vehicles, their documents, and active custodial
// pairings, then prints the pure summarizer report as JSON: passenger/cargo
// cohorts, every missing-evidence class by vehicle id, blocked-reason counts,
// and the live gates the inventory transparently defers to dispatch time.
//
// Staged enablement (see Capstone/07 - Development/FleetOps Cargo Rollout
// Runbook.md): audit → staff verify categories/classes/docs → enable the
// passenger gate on the validated cohort → cargo source + vehicles only when
// verified. Rollback is enablement rollback (stop routing new bookings to the
// cohort), never a compliance weakening and never a committed-trip mutation.
//
// Run: node scripts/audit-fleet-readiness.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";

loadEnvLocal();

const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, "..");
const { summarizeFleetInventory } = await import(
  resolvePath(root, "src", "lib", "vehicles", "readiness-inventory.js")
);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (scripts/load-env.mjs reads .env.local then .env).");
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  // SELECT * keeps the audit version-tolerant: it runs identically before and
  // after migration 153, with absent capability columns reading as unevidenced.
  const [{ rows: vehicles }, { rows: documents }, { rows: assignments }] = await Promise.all([
    pool.query(`SELECT * FROM vehicles WHERE deleted_at IS NULL ORDER BY vehicle_id`),
    pool.query(`SELECT * FROM vehicledocuments WHERE deleted_at IS NULL ORDER BY vehicle_id, document_id`),
    pool.query(`SELECT vehicle_id, driver_id, assigned_until FROM driver_vehicle_assignments WHERE assigned_until IS NULL`),
  ]);
  const docsByVehicle = new Map();
  for (const d of documents) {
    if (!docsByVehicle.has(d.vehicle_id)) docsByVehicle.set(d.vehicle_id, []);
    docsByVehicle.get(d.vehicle_id).push(d);
  }
  const report = summarizeFleetInventory({
    rows: vehicles.map((v) => ({ vehicle: v, documents: docsByVehicle.get(v.vehicle_id) ?? [] })),
    assignments,
    now: new Date(),
  });
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), ...report }, null, 2));
} finally {
  await pool.end();
}
