import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { buildDriverWeeklySchedule } from "../../src/lib/work-shift-policy.js";

const DEFENSE_KEY = "seed:defense-2026-10";
const ROTATION_KEY = "seed:defense-schedule-rotation-2026-10";
const BACKUP_PATH = join(process.cwd(), "scratch", "defense-schedule-rotation-backup.json");
const policy = {
  shiftStart: "06:00", shiftEnd: "22:00", breakStart: "12:00", breakEnd: "13:00",
  workingDays: [1, 2, 3, 4, 5, 6], staggerBreaks: true, staggerRestDays: true,
  breakSlots: [
    { breakStart: "11:30", breakEnd: "12:30" },
    { breakStart: "12:00", breakEnd: "13:00" },
    { breakStart: "12:30", breakEnd: "13:30" },
    { breakStart: "13:00", breakEnd: "14:00" },
  ],
};
const quote = (value) => `"${value.replaceAll('"', '""')}"`;

async function readTargets(db) {
  const { rows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1", [DEFENSE_KEY]);
  const ledger = rows[0]?.setting_value;
  if (!ledger || ledger.state === "media_cleanup") throw new Error("Complete defense ledger required");
  const semantic = ledger.semantic ?? {};
  const drivers = Object.entries(semantic)
    .filter(([key]) => /^D\d{2}$/.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([driverKey, value], index) => ({ driverKey, driverId: Number(value.id), index }));
  if (drivers.length !== 10) throw new Error(`Expected 10 defense drivers, found ${drivers.length}`);
  return { ledger, drivers };
}

async function buildPlan(db) {
  const targets = await readTargets(db);
  const driverIds = targets.drivers.map((driver) => driver.driverId);
  const { rows } = await db.query(`
    SELECT schedule_id,driver_id,day_of_week,shift_start::text,shift_end::text,
           break_start::text,break_end::text,is_rest_day
      FROM driver_work_schedules
     WHERE driver_id=ANY($1::int[])
     ORDER BY driver_id,day_of_week`, [driverIds]);
  if (rows.length !== 70) throw new Error(`Expected 70 defense schedule rows, found ${rows.length}`);
  const byDriver = new Map(targets.drivers.map((driver) => [driver.driverId, driver]));
  const changes = rows.map((row) => {
    const driver = byDriver.get(row.driver_id);
    const desired = buildDriverWeeklySchedule(policy, driver.index)[row.day_of_week];
    return {
      schedule_id: row.schedule_id, driver_key: driver.driverKey, driver_id: row.driver_id,
      day_of_week: row.day_of_week,
      current: { shift_start: row.shift_start, shift_end: row.shift_end, break_start: row.break_start, break_end: row.break_end, is_rest_day: row.is_rest_day },
      desired: { shift_start: desired.shift_start, shift_end: desired.shift_end, break_start: desired.break_start, break_end: desired.break_end, is_rest_day: desired.is_rest_day },
    };
  });
  const digest = createHash("sha256").update(JSON.stringify({ rotationKey: ROTATION_KEY, changes })).digest("hex").slice(0, 16);
  const summary = targets.drivers.map((driver) => {
    const driverChanges = changes.filter((row) => row.driver_id === driver.driverId);
    const rest = driverChanges.find((row) => row.desired.is_rest_day);
    const lunch = driverChanges.find((row) => !row.desired.is_rest_day)?.desired;
    return { driver_key: driver.driverKey, driver_id: driver.driverId, rest_day: rest?.day_of_week, lunch: `${lunch?.break_start}-${lunch?.break_end}` };
  });
  return { readOnly: true, rotationKey: ROTATION_KEY, digest, summary, changes, ledger: targets.ledger };
}

loadEnvLocal();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const command = process.argv[2] ?? "plan";
if (!["plan", "apply"].includes(command)) throw new Error("Use plan or apply");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
try {
  await db.query(command === "plan" ? "BEGIN READ ONLY" : "BEGIN");
  if (command === "apply") await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ROTATION_KEY]);
  const plan = await buildPlan(db);
  if (command === "plan") {
    console.log(JSON.stringify({ readOnly: true, rotationKey: plan.rotationKey, digest: plan.digest, summary: plan.summary,
      changedRows: plan.changes.filter((row) => JSON.stringify(row.current) !== JSON.stringify(row.desired)).length,
      note: "All working days remain 06:00–22:00; rest days rotate across Sunday–Saturday and lunch slots rotate across four one-hour windows." }, null, 2));
    await db.query("ROLLBACK");
  } else {
    if (!process.argv.includes(`--apply=${plan.digest}`)) throw new Error(`Schedule rotation requires --apply=${plan.digest}`);
    const changed = plan.changes.filter((row) => JSON.stringify(row.current) !== JSON.stringify(row.desired));
    await mkdir(dirname(BACKUP_PATH), { recursive: true });
    await writeFile(BACKUP_PATH, JSON.stringify({ digest: plan.digest, changes: changed }, null, 2));
    for (const row of changed) {
      const result = await db.query(`UPDATE driver_work_schedules SET shift_start=$1,shift_end=$2,break_start=$3,break_end=$4,is_rest_day=$5,updated_at=NOW()
        WHERE schedule_id=$6 AND driver_id=$7 AND day_of_week=$8`, [row.desired.shift_start, row.desired.shift_end, row.desired.break_start, row.desired.break_end, row.desired.is_rest_day, row.schedule_id, row.driver_id, row.day_of_week]);
      if (result.rowCount !== 1) throw new Error(`Schedule row ${row.schedule_id} changed during apply`);
    }
    const { rows: defenseRows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1 FOR UPDATE", [DEFENSE_KEY]);
    const ledger = defenseRows[0]?.setting_value;
    const ids = ledger?.ids?.driver_work_schedules ?? [];
    const { rows: snapshots } = await db.query("SELECT schedule_id AS id,to_jsonb(t) AS snapshot FROM driver_work_schedules t WHERE schedule_id=ANY($1::int[])", [ids]);
    if (snapshots.length !== ids.length) throw new Error("Defense schedule ledger snapshot refresh is incomplete");
    ledger.snapshots.driver_work_schedules = Object.fromEntries(snapshots.map((row) => [String(row.id), row.snapshot]));
    ledger.scheduleRotation = { digest: plan.digest, recordedAt: new Date().toISOString(), driverIds: plan.summary.map((row) => row.driver_id) };
    await db.query("UPDATE system_settings SET setting_value=$2::jsonb WHERE setting_key=$1", [DEFENSE_KEY, JSON.stringify(ledger)]);
    await db.query("INSERT INTO system_settings(setting_key,setting_value) VALUES($1,$2::jsonb) ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value", [ROTATION_KEY, JSON.stringify({ version: 1, state: "applied", digest: plan.digest, summary: plan.summary, appliedAt: new Date().toISOString() })]);
    await db.query("COMMIT");
    console.log(JSON.stringify({ state: "schedule-rotation-applied", digest: plan.digest, changedRows: changed.length, backup: BACKUP_PATH, summary: plan.summary }, null, 2));
  }
} catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
finally { db.release(); await pool.end(); }
