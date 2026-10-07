import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { readLedger } from "./ledger.mjs";

const OLD_ROOTS = Object.freeze({
  "face-captures": new Set(["21"]),
  "fuel-receipts": new Set(["19", "21"]),
  "incident-evidence": new Set(["19", "21"]),
  "vehicle-images": new Set(["18", "37", "38"]),
});
const MEDIA_COLUMNS = Object.freeze({
  driverattendance: ["attendance_id", "face_capture_url", null],
  driverincidents: ["incident_id", "photo_urls", "deleted_at"],
  drivers: ["driver_id", "face_image_url", "deleted_at"],
  employees: ["employee_id", "avatar_url", "deleted_at"],
  expense_receipt_scans: ["client_submission_id", "receipt_storage_key", null],
  expense_records: ["id", "receipt_storage_key", null],
  fuelrecords: ["fuel_record_id", "receipt_url", "deleted_at"],
  fuelrequests: ["fuel_request_id", "gauge_photo_url", null],
  vehiclecategories: ["category_id", "image_url", "deleted_at"],
  vehicledocuments: ["document_id", "file_url", "deleted_at"],
  vehicles: ["vehicle_id", "image_url", "deleted_at"],
});
const backupRoot = join(process.cwd(), "scratch", "defense-old-storage-backup");

function validOldKey(bucket, name) {
  const parts = name.split("/");
  return OLD_ROOTS[bucket]?.has(parts[0]) &&
    /^(?:\d+\/)(?:gauge\/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png)$/i.test(name);
}

async function buildPlan(db) {
  const ledger = await readLedger(db);
  if (!ledger || ledger.state === "media_cleanup") throw new Error("Applied defense ledger required");
  const owned = new Set((ledger.media ?? []).map(({ bucket, key }) => `${bucket}/${key}`));
  if (owned.size !== 86) throw new Error(`Expected 86 defense-owned media keys, found ${owned.size}`);
  const { rows: objects } = await db.query(`SELECT id,bucket_id,name,created_at,updated_at,metadata
    FROM storage.objects WHERE name IS NOT NULL ORDER BY bucket_id,name`);
  const present = new Set(objects.map((o) => `${o.bucket_id}/${o.name}`));
  const missingOwned = [...owned].filter((key) => !present.has(key));
  const old = objects.filter((o) => !owned.has(`${o.bucket_id}/${o.name}`));
  const blockers = [];
  if (missingOwned.length) blockers.push(`${missingOwned.length} defense-owned assets missing`);
  for (const object of old) if (!validOldKey(object.bucket_id, object.name))
    blockers.push(`Unrecognized non-defense object ${object.bucket_id}/${object.name}`);
  const { rows: oldDrivers } = await db.query("SELECT driver_id,deleted_at FROM drivers WHERE driver_id=ANY($1::int[])", [[19, 21]]);
  const { rows: oldVehicles } = await db.query("SELECT vehicle_id,deleted_at FROM vehicles WHERE vehicle_id=ANY($1::int[])", [[18, 37, 38]]);
  const { rows: activeDriverForAvatar } = await db.query(
    "SELECT 1 FROM drivers WHERE employee_id=41 AND deleted_at IS NULL LIMIT 1");
  if (oldDrivers.some((r) => !r.deleted_at) || oldVehicles.some((r) => !r.deleted_at))
    blockers.push("An old media namespace belongs to an active driver or vehicle");

  const refs = [];
  for (const [table, [pk, column, deleted]] of Object.entries(MEDIA_COLUMNS)) {
    const { rows } = await db.query(`SELECT ${pk} AS id,${column}::text AS value,${deleted ?? "NULL"} AS deleted_at
      FROM ${table} WHERE ${column} IS NOT NULL`);
    for (const row of rows) for (const object of old) {
      if (!row.value.includes(object.name)) continue;
      const clearable = (table === "drivers" && column === "face_image_url" && row.id === 21 && row.deleted_at) ||
        (table === "employees" && column === "avatar_url" && row.id === 41 && !activeDriverForAvatar.length) ||
        (table === "vehicles" && column === "image_url" && row.id === 37 && row.deleted_at);
      refs.push({ table, id: row.id, column, bucket: object.bucket_id, name: object.name,
        value: row.value, deleted_at: row.deleted_at, clearable: Boolean(clearable) });
      if (!clearable) blockers.push(`Old asset still referenced: ${table}.${column} id=${row.id}`);
    }
  }
  const digest = createHash("sha256").update(JSON.stringify({ old, refs, owned: [...owned].sort() })).digest("hex").slice(0, 16);
  return { readOnly: true, digest, objects: old.map(({ id, bucket_id, name, created_at, updated_at, metadata }) =>
    ({ id, bucket: bucket_id, key: name, created_at, updated_at, bytes: Number(metadata?.size ?? 0) })),
    references: refs, blockers, defenseMediaCount: owned.size };
}

loadEnvLocal();
const project = "dnxuphhxlzidvwtdqqkq";
const database = new URL(process.env.DATABASE_URL);
const storageUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (database.pathname !== "/postgres" || database.username.split(".").at(-1) !== project ||
    storageUrl.hostname !== `${project}.supabase.co`) throw new Error("Unexpected Supabase project");
const command = process.argv[2] ?? "plan";
if (!["plan", "apply"].includes(command)) throw new Error("Use plan or apply");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
try {
  await db.query("BEGIN READ ONLY");
  const plan = await buildPlan(db);
  await db.query("ROLLBACK");
  if (command === "plan") {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    if (!process.argv.includes(`--apply=${plan.digest}`)) throw new Error(`Storage cleanup requires current --apply=${plan.digest}`);
    if (plan.blockers.length) throw new Error(`Storage cleanup blocked: ${plan.blockers.join("; ")}`);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase service role required");
    const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }).storage;
    const saved = [];
    for (const object of plan.objects) {
      const { data, error } = await storage.from(object.bucket).download(object.key);
      if (error || !data) throw new Error(`Backup failed for ${object.bucket}/${object.key}: ${error?.message ?? "empty download"}`);
      const bytes = Buffer.from(await data.arrayBuffer());
      if (object.bytes && bytes.length !== object.bytes) throw new Error(`Backup size mismatch for ${object.bucket}/${object.key}`);
      const path = join(backupRoot, object.bucket, object.key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      saved.push({ bucket: object.bucket, key: object.key, bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    await mkdir(backupRoot, { recursive: true });
    await writeFile(join(backupRoot, "manifest.json"), JSON.stringify({ digest: plan.digest, files: saved }, null, 2));
    await db.query("BEGIN");
    try {
      const current = await buildPlan(db);
      if (current.digest !== plan.digest) throw new Error("Storage or database references changed after backup; rerun plan");
      for (const ref of current.references) {
        const pk = ref.table === "drivers" ? "driver_id" : ref.table === "employees" ? "employee_id" : "vehicle_id";
        const guard = ref.table === "employees"
          ? "AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.employee_id=employees.employee_id AND d.deleted_at IS NULL)"
          : "AND deleted_at IS NOT NULL";
        const result = await db.query(`UPDATE ${ref.table} SET ${ref.column}=NULL
          WHERE ${pk}=$1 AND ${ref.column}=$2 ${guard}`, [ref.id, ref.value]);
        if (result.rowCount !== 1) throw new Error(`Retired media reference changed: ${ref.table} ${ref.id}`);
      }
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    const failures = [];
    for (const object of plan.objects) {
      const { error } = await storage.from(object.bucket).remove([object.key]);
      if (error) failures.push(`${object.bucket}/${object.key}: ${error.message}`);
    }
    const after = await buildPlan(db);
    console.log(JSON.stringify({ state: after.objects.length ? "partial" : "old-storage-removed",
      backedUp: saved.length, removed: plan.objects.length - after.objects.length,
      remainingOld: after.objects.length, defenseMediaCount: after.defenseMediaCount,
      remainingReferences: after.references.length, failures }, null, 2));
    if (after.objects.length || failures.length) process.exitCode = 1;
  }
} finally { db.release(); await pool.end(); }
