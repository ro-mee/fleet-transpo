/**
 * E2E rehearsal: compliance suspension inverse (plan .opencode/plans/driver-suspension-inverse.md)
 * Runs against the REAL API on your dev server (:3000 default).
 *
 * S1  renewal lifts a license_expired suspension        (PUT returns reinstated:true)
 * S2  manual suspensions survive renewal                (reinstated:false)
 * S3  reinstate writes ops notifications
 * Cleanup restores the driver's original row exactly and purges QA notifications.
 *
 * Usage: node --env-file=.env scratch/qa_suspension_e2e.mjs     (QA_BASE defaults to :3000)
 */
import pg from "pg";
import { signAccessToken } from "../src/lib/auth/mobile-token.js";

const BASE = process.env.QA_BASE || "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, v) => pool.query(t, v);
const results = [];
const record = (step, pass, detail) => {
  results.push({ step, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};

let driverId = null;
let original = null;
let staffToken = null;

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

async function cleanup() {
  try {
    if (driverId && original) {
      await q(
        `UPDATE drivers SET driver_status=$1, license_expiry=$2, suspension_reason=$3, updated_at=NOW()
          WHERE driver_id=$4`,
        [original.driver_status, original.license_expiry, original.suspension_reason, driverId]
      );
      await q(`DELETE FROM notifications WHERE reference_type='driver' AND reference_id=$1 AND title IN ('Driver Reinstated','Driver Auto-Suspended')`, [driverId]);
    }
    console.log("CLEANUP driver restored to original availability row");
  } catch (e) {
    console.error("CLEANUP FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function main() {
  // Target: a real driver, not On Leave, preferably currently Available.
  const drv = (
    await q(`
      SELECT d.driver_id, d.driver_status, d.license_expiry, d.suspension_reason
        FROM drivers d JOIN employees e ON e.employee_id = d.employee_id AND e.deleted_at IS NULL
       WHERE d.deleted_at IS NULL AND d.driver_status <> 'On Leave'
       ORDER BY (d.driver_status = 'Available') DESC, d.driver_id LIMIT 1`)
  ).rows[0];
  if (!drv) throw new Error("no eligible driver");
  driverId = drv.driver_id;
  original = { driver_status: drv.driver_status, license_expiry: drv.license_expiry, suspension_reason: drv.suspension_reason };
  console.log(`target: driver#${driverId} (was ${drv.driver_status}, expiry ${drv.license_expiry || "—"})`);

  const staff = (
    await q(`
      SELECT e.employee_id FROM employees e
        JOIN roles r ON r.role_id = e.role_id AND r.role_name IN ('admin','system_admin')
       WHERE e.deleted_at IS NULL ORDER BY e.employee_id LIMIT 1`)
  ).rows[0];
  staffToken = await signAccessToken({ employeeId: staff.employee_id, role: "admin" });

  const past = "2020-01-01";
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // ── S1: renewal lifts a license_expired suspension ──
  await q(
    `UPDATE drivers SET driver_status='Suspended', suspension_reason='license_expired', license_expiry=$1, updated_at=NOW() WHERE driver_id=$2`,
    [past, driverId]
  );
  const renew = await api("PUT", `/api/drivers/${driverId}`, { license_expiry: future });
  record("S1 renewal PUT -> 200", renew.status === 200, `status=${renew.status}`);
  record(
    "S1 auto-reinstated: Available + reason cleared + flag",
    renew.body?.driver_status === "Available" &&
      renew.body?.suspension_reason === null &&
      renew.body?.reinstated === true,
    JSON.stringify({ status: renew.body?.driver_status, reason: renew.body?.suspension_reason, reinstated: renew.body?.reinstated })
  );
  record("S3 reinstatement notified ops", (
    await q(`SELECT count(*)::int AS n FROM notifications WHERE reference_type='driver' AND reference_id=$1 AND title='Driver Reinstated'`, [driverId])
  ).rows[0].n >= 1);

  // ── S2: manual suspensions survive renewal ──
  await q(
    `UPDATE drivers SET driver_status='Suspended', suspension_reason='manual', license_expiry=$1, updated_at=NOW() WHERE driver_id=$2`,
    [past, driverId]
  );
  const renew2 = await api("PUT", `/api/drivers/${driverId}`, { license_expiry: future });
  record(
    "S2 manual suspension survives renewal",
    renew2.status === 200 && renew2.body?.driver_status === "Suspended" && !renew2.body?.reinstated,
    JSON.stringify({ status: renew2.body?.driver_status, reinstated: renew2.body?.reinstated })
  );

  // ── S3b: explicit admin status choice wins over auto-restore ──
  await q(
    `UPDATE drivers SET driver_status='Suspended', suspension_reason='license_expired', license_expiry=$1, updated_at=NOW() WHERE driver_id=$2`,
    [past, driverId]
  );
  const explicit = await api("PUT", `/api/drivers/${driverId}`, { license_expiry: future, driver_status: "Off Duty" });
  record(
    "S3b explicit driver_status wins (Off Duty kept)",
    explicit.status === 200 && explicit.body?.driver_status === "Off Duty",
    JSON.stringify({ status: explicit.body?.driver_status })
  );

  // ── S4: syncDriverStatus safety net — expired again + dispatch-touch style sync ──
  // Directly re-run what the sync would decide, via the pure helper contract:
  // set Available+expired, then confirm a fresh PUT with unchanged license does nothing harmful.
  await q(
    `UPDATE drivers SET driver_status='Available', suspension_reason=NULL, license_expiry=$1, updated_at=NOW() WHERE driver_id=$2`,
    [past, driverId]
  );
  const noop = await api("PUT", `/api/drivers/${driverId}`, { license_expiry: past });
  record(
    "S4 saving an EXPIRED date never reinstates",
    noop.status === 200 && noop.body?.driver_status === "Available" && !noop.body?.reinstated,
    JSON.stringify({ status: noop.body?.driver_status, reinstated: noop.body?.reinstated })
  );
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) process.exitCode = 1;
  })
  .catch((e) => {
    console.error("HARNESS ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(cleanup);
