/**
 * Headless E2E rehearsal of the incident flow over the REAL API.
 * Plan: .opencode/plans/qa-e2e-incidents-rehearsal.md
 *
 * Creates [QA]-marked rows on the shared dev DB and cleans them up in a
 * finally block. Never touches pre-existing incidents. Exits nonzero on any
 * failed assertion.
 *
 * Usage:  node --env-file=.env scratch/qa_incidents_e2e.mjs   (server already running)
 * Env:    QA_BASE (default http://localhost:3100)
 */
import pg from "pg";
import { signAccessToken } from "../src/lib/auth/mobile-token.js";

const BASE = process.env.QA_BASE || "http://localhost:3100";
const MARK = "[QA e2e]";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, v) => pool.query(t, v);

const results = [];
const record = (step, pass, detail) => {
  results.push({ step, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};
const eq = (a, b) => a === b;

let ctx; // targets + tokens
let qaIncidentIds = [];
let repairId = null;
let seededDispatchId = null;
let vehiclePreStatus = null;
let vehicleId = null;

async function pickTargets() {
  const driver = (
    await q(`
      SELECT d.driver_id, d.employee_id, dva.vehicle_id
        FROM drivers d
        JOIN employees e ON e.employee_id = d.employee_id AND e.deleted_at IS NULL
        JOIN driver_vehicle_assignments dva ON dva.driver_id = d.driver_id AND dva.assigned_until IS NULL
       WHERE d.deleted_at IS NULL AND d.driver_status <> 'On Leave'
         AND NOT EXISTS (SELECT 1 FROM device_tokens t WHERE t.employee_id = d.employee_id)
       ORDER BY d.driver_id LIMIT 1`)
  ).rows[0];
  const staff = (
    await q(`
      SELECT e.employee_id FROM employees e
        JOIN roles r ON r.role_id = e.role_id AND r.role_name IN ('admin','system_admin')
       WHERE e.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM device_tokens t WHERE t.employee_id = e.employee_id)
       ORDER BY e.employee_id LIMIT 1`)
  ).rows[0];
  if (!driver) throw new Error("no eligible driver (zero device_tokens + active assignment)");
  if (!staff) throw new Error("no eligible staff account (zero device_tokens)");
  const vehicle = (
    await q(
      `SELECT vehicle_id, plate_number, vehicle_status FROM vehicles
        WHERE vehicle_id = $1 AND deleted_at IS NULL
          AND vehicle_status NOT IN ('Under Maintenance','Decommissioned','Registration Expired')
          AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = $1 AND t.trip_status NOT IN ('Completed','Cancelled') AND t.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM vehiclemaintenance m WHERE m.vehicle_id = $1 AND m.status IN ('Scheduled','In Progress') AND m.deleted_at IS NULL)`,
      [driver.vehicle_id]
    )
  ).rows[0];
  if (!vehicle) throw new Error("assigned vehicle is not clean for QA");
  return { driver, staff, vehicle };
}

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : undefined,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

async function countNotifs(referenceType, referenceId, titleLike) {
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM notifications
      WHERE reference_type = $1 AND reference_id = $2 AND ($3::text IS NULL OR title ILIKE '%' || $3 || '%')`,
    [referenceType, referenceId, titleLike ?? null]
  );
  return rows[0].n;
}

async function cleanup() {
  try {
    if (repairId) await q(`UPDATE vehiclemaintenance SET deleted_at = NOW() WHERE maintenance_id = $1`, [repairId]);
    if (qaIncidentIds.length) {
      await q(`UPDATE vehiclemaintenance SET deleted_at = NOW() WHERE source_incident_id = ANY($1::int[])`, [qaIncidentIds]);
      await q(`UPDATE driverincidents SET deleted_at = NOW(), updated_at = NOW() WHERE incident_id = ANY($1::int[])`, [qaIncidentIds]);
      await q(`DELETE FROM notifications WHERE reference_type = 'incident' AND reference_id = ANY($1::int[])`, [qaIncidentIds]);
    }
    if (seededDispatchId) {
      await q(`DELETE FROM notifications WHERE reference_type = 'dispatch' AND reference_id = $1`, [seededDispatchId]);
      await q(`DELETE FROM audit_logs WHERE resource = 'dispatchschedules' AND resource_id = $1`, [seededDispatchId]);
      await q(`DELETE FROM dispatchschedules WHERE dispatch_id = $1`, [seededDispatchId]);
    }
    if (vehicleId && vehiclePreStatus) {
      await q(`UPDATE vehicles SET vehicle_status = $1, updated_at = NOW() WHERE vehicle_id = $2`, [vehiclePreStatus, vehicleId]);
    }
    // Prove cleanup landed. Use regex — SQL LIKE treats [ as a wildcard class.
    const left = await q(
      `SELECT
         (SELECT count(*)::int FROM driverincidents WHERE deleted_at IS NULL AND description ~ '^\\[QA e2e\\]') AS incidents,
         (SELECT count(*)::int FROM notifications WHERE message ~ '\\[QA' OR title ~ '\\[QA') AS notifs`,
      []
    );
    console.log(`CLEANUP incidents-left=${left.rows[0].incidents} qa-notifs-left=${left.rows[0].notifs} dispatch-deleted=${seededDispatchId ? "yes" : "n/a"}`);
  } catch (e) {
    console.error("CLEANUP FAILED — inspect [QA] rows manually:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function main() {
  ctx = await pickTargets();
  vehicleId = ctx.vehicle.vehicle_id;
  vehiclePreStatus = ctx.vehicle.vehicle_status;
  console.log(`targets: driver#${ctx.driver.driver_id} staff#${ctx.staff.employee_id} vehicle#${vehicleId} (${ctx.vehicle.plate_number}, was ${vehiclePreStatus})`);

  const driverToken = await signAccessToken({ employeeId: ctx.driver.employee_id, role: "driver", driverId: ctx.driver.driver_id });
  const staffToken = await signAccessToken({ employeeId: ctx.staff.employee_id, role: "admin" });

  // ── Seed one temp dispatch inside the Minor-breakdown safety window ──
  const dep = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  seededDispatchId = (
    await q(
      `INSERT INTO dispatchschedules (dispatch_number, vehicle_id, driver_id, status, scheduled_departure, notes)
       VALUES ($1, $2, $3, 'Scheduled', $4, '[QA seed] rehearsed dispatch')
       RETURNING dispatch_id`,
      [`QA-${Date.now()}`, vehicleId, ctx.driver.driver_id, dep]
    )
  ).rows[0].dispatch_id;
  console.log(`seeded dispatch #${seededDispatchId}`);

  const subA = `${Date.now()}-a-${Math.random().toString(36).slice(2, 8)}`;
  const payloadA = {
    incident_type: "breakdown",
    description: `${MARK} rehearsed breakdown`,
    severity: "Minor",
    location: `${MARK} test site`,
    assistance_needed: ["Tow Truck"],
    expense_amount: 1500,
    incident_date: new Date().toISOString(),
    client_submission_id: subA,
  };

  // ── Step 1: idempotent report ──
  const first = await api("POST", "/api/driver/incidents", driverToken, payloadA);
  record("S1 first report accepted", first.status === 201 && !!first.body?.incident_id, `status=${first.status}`);
  const idA = first.body?.incident_id;
  qaIncidentIds.push(idA);
  const replay = await api("POST", "/api/driver/incidents", driverToken, payloadA);
  record(
    "S1 offline replay returns SAME incident",
    replay.status === 200 && eq(replay.body?.incident_id, idA),
    `status=${replay.status} id=${replay.body?.incident_id}`
  );

  // ── Step 2: grounding automation ──
  const veh = await q(`SELECT vehicle_status FROM vehicles WHERE vehicle_id = $1`, [vehicleId]);
  record("S2 vehicle grounded Under Maintenance", veh.rows[0]?.vehicle_status === "Under Maintenance", veh.rows[0]?.vehicle_status);
  const disp = await q(`SELECT status FROM dispatchschedules WHERE dispatch_id = $1`, [seededDispatchId]);
  record("S2 dispatch -> Pending Reassignment", disp.rows[0]?.status === "Pending Reassignment", disp.rows[0]?.status);
  const audit = await q(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE resource='dispatchschedules' AND resource_id=$1 AND old_values->>'reason' = $2`,
    [seededDispatchId, `Incident #${idA} grounded the vehicle.`]
  );
  record("S2 exact grounding audit reason", audit.rows[0].n >= 1, `entries=${audit.rows[0].n}`);
  record("S2 driver ack notification", (await countNotifs("incident", idA, "Under Review")) >= 1);

  // ── Step 3: resolver context ──
  const detail = await api("GET", `/api/incidents/${idA}`, staffToken);
  record(
    "S3 GET lists interrupted dispatch",
    detail.status === 200 &&
      Array.isArray(detail.body?.affected_dispatches) &&
      detail.body.affected_dispatches.some((d) => d.dispatch_id === seededDispatchId && d.dispatch_status === "Pending Reassignment"),
    JSON.stringify(detail.body?.affected_dispatches?.map((d) => d.dispatch_status))
  );
  record("S3 linked_maintenance empty before repair", Array.isArray(detail.body?.linked_maintenance) && detail.body.linked_maintenance.length === 0);

  // ── Step 4: resolve loop ──
  const noActions = await api("PATCH", `/api/incidents/${idA}`, staffToken, { status: "Resolved" });
  record("S4 resolve without narrative -> 400", noActions.status === 400, `status=${noActions.status}`);
  const resolved = await api("PATCH", `/api/incidents/${idA}`, staffToken, { status: "Resolved", actions_taken: `${MARK} tow dispatched; resolved in rehearsal` });
  record("S4 resolve with narrative -> 200", resolved.status === 200, `status=${resolved.status}`);
  const again = await api("PATCH", `/api/incidents/${idA}`, staffToken, { status: "Resolved", actions_taken: "dup" });
  record("S4 re-resolve -> 409", again.status === 409, `status=${again.status}`);
  const vehAfter = await q(`SELECT vehicle_status FROM vehicles WHERE vehicle_id = $1`, [vehicleId]);
  record("S4 vehicle restored to Available", vehAfter.rows[0]?.vehicle_status === "Available", vehAfter.rows[0]?.vehicle_status);
  record("S4 driver resolution notification", (await countNotifs("incident", idA, "Resolved")) >= 1);

  // ── Step 5: atomic maintenance + replay guard (Critical incident grounds regardless of type) ──
  const second = await api("POST", "/api/driver/incidents", driverToken, {
    ...payloadA,
    incident_type: "accident",
    severity: "Critical",
    description: `${MARK} rehearsed collision`,
    client_submission_id: `${Date.now()}-b-${Math.random().toString(36).slice(2, 8)}`,
    assistance_needed: ["Police"],
  });
  record("S5 critical incident accepted", second.status === 201, `status=${second.status}`);
  const idB = second.body.incident_id;
  qaIncidentIds.push(idB);
  const maint = await api("POST", `/api/incidents/${idB}/maintenance`, staffToken);
  record("S5 send-to-maintenance -> 201", maint.status === 201, `status=${maint.status}`);
  repairId = maint.body?.maintenance?.maintenance_id;
  const row = (await q(`SELECT cost, remarks, source_incident_id, status, priority FROM vehiclemaintenance WHERE maintenance_id=$1`, [repairId])).rows[0];
  record(
    "S5 repair: cost=0, unverified claim in remarks, FK set",
    Number(row.cost) === 0 &&
      /unverified/.test(row.remarks || "") &&
      /1,500/.test(row.remarks || "") &&
      Number(row.source_incident_id) === Number(idB) &&
      row.status === "In Progress" && row.priority === "High",
    JSON.stringify({ cost: row.cost, src: row.source_incident_id })
  );
  const maintReplay = await api("POST", `/api/incidents/${idB}/maintenance`, staffToken);
  record("S5 maintenance replay -> 409", maintReplay.status === 409, `status=${maintReplay.status}`);

  // ── Step 6: completion loop ──
  const today = new Date().toISOString().slice(0, 10);
  const done = await api("PUT", `/api/vehicle-maintenance/${repairId}`, staffToken, { status: "Completed", completed_date: today });
  record("S6 complete repair -> 200", done.status === 200, `status=${done.status}`);
  record("S6 reporter completion notification", (await countNotifs("incident", idB, "Repair Completed")) >= 1);
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
