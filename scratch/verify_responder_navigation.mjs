/**
 * Headless E2E rehearsal of the RESCUE-ON-THE-LIVE-MAP feed over the REAL API
 * (verify_responder_tracking.mjs precedent: [QA] rows on the shared dev DB,
 * cleanup in finally, nonzero exit on any failed assertion).
 *
 * Loop under test — GET /api/incidents/responders/active, the feed that puts
 * an active rescue on the web Live GPS Tracking map / dispatcher dashboard:
 *   1. GET active feed, no assignment yet      → empty
 *   2. POST assign responder + responder GPS   → feed row with both positions
 *   3. Responder drives to ≤200 m (Arrived)    → feed row status Arrived
 *   4. POST clear responder                    → feed empty again (manual mode)
 *   5. Driver token hitting the staff feed     → 403 (incidents/read required)
 *
 * Usage:  node --env-file=.env scratch/verify_responder_navigation.mjs   (server already running)
 * Env:    QA_BASE (default http://localhost:3000)
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { signAccessToken, hashToken } from "../src/lib/auth/mobile-token.js";

const BASE = process.env.QA_BASE || "http://localhost:3000";
const MARK = "[QA e2e]";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, v) => pool.query(t, v);

const results = [];
const record = (step, pass, detail) => {
  results.push({ step, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a DB scalar until it matches (or timeout) — the lazy evaluation hooks
 *  are fire-and-forget, so their effect lands a moment after the GET returns. */
async function waitForRow(label, sql, params, predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = (await q(sql, params)).rows[0] || null;
    if (last && predicate(last)) return last;
    await sleep(400);
  }
  record(label, false, `timeout — last=${JSON.stringify(last)}`);
  return null;
}

const DRIVER_POS = { latitude: 14.5995, longitude: 120.9842 }; // stranded driver
const FAR_POS = { latitude: 14.6268, longitude: 121.0052 }; // ~4 km away
const NEAR_POS = { latitude: 14.6000, longitude: 120.9843 }; // ~60 m away

const incidentIds = [];
let createdResponder = null;
const prePositions = new Map();

const QA_TOKEN_USER_AGENT = "[QA e2e] verify_responder_navigation";

/** Mint a Bearer token the API will actually accept (migrations 087/088):
 *  CURRENT auth_version in the claims + a familyId backed by a live
 *  mobile_refresh_tokens row. The QA family rows are deleted in cleanup. */
async function mintToken({ employeeId, role, driverId = null }) {
  const { rows } = await q(`SELECT auth_version FROM employees WHERE employee_id = $1`, [employeeId]);
  if (!rows[0]) throw new Error(`employee #${employeeId} not found`);
  const familyId = randomUUID();
  await q(
    `INSERT INTO mobile_refresh_tokens (employee_id, token_hash, expires_at, family_id, user_agent)
     VALUES ($1, $2, NOW() + interval '1 hour', $3, $4)`,
    [employeeId, hashToken(`qa-${Date.now()}-${Math.random()}`), familyId, QA_TOKEN_USER_AGENT]
  );
  return signAccessToken({ employeeId, role, driverId, authVersion: rows[0].auth_version, familyId });
}

async function pickTargets() {
  const reporter = (
    await q(`
      SELECT d.driver_id, d.employee_id
        FROM drivers d
        JOIN employees e ON e.employee_id = d.employee_id AND e.deleted_at IS NULL
       WHERE d.deleted_at IS NULL
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
  if (!reporter) throw new Error("no eligible reporting driver (zero device_tokens)");
  if (!staff) throw new Error("no eligible staff account (zero device_tokens)");

  const existingResponder = (
    await q(
      `SELECT d.driver_id, d.employee_id
         FROM drivers d
         JOIN employees e ON e.employee_id = d.employee_id AND e.deleted_at IS NULL AND e.status = 'Active'
        WHERE d.deleted_at IS NULL AND d.driver_status = 'Available'
          AND d.driver_id <> $1
          AND NOT EXISTS (SELECT 1 FROM device_tokens t WHERE t.employee_id = d.employee_id)
        ORDER BY d.driver_id LIMIT 1`,
      [reporter.driver_id]
    )
  ).rows[0];

  if (existingResponder) return { reporter, responder: existingResponder, staff };

  const role = (await q(`SELECT role_id FROM roles WHERE role_name = 'driver' LIMIT 1`)).rows[0];
  if (!role) throw new Error("no 'driver' role found to attach the QA responder to");
  const employee = (
    await q(
      `INSERT INTO employees (role_id, first_name, last_name, email, status)
       VALUES ($1, '[QA]', 'Responder', $2, 'Active') RETURNING employee_id`,
      [role.role_id, `qa-responder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@qa.local`]
    )
  ).rows[0];
  const driver = (
    await q(`INSERT INTO drivers (employee_id, driver_status) VALUES ($1, 'Available') RETURNING driver_id`, [
      employee.employee_id,
    ])
  ).rows[0];
  console.log(`no spare available driver — created QA responder driver#${driver.driver_id}`);
  return {
    reporter,
    responder: { driver_id: driver.driver_id, employee_id: employee.employee_id },
    staff,
    createdResponder: { driverId: driver.driver_id, employeeId: employee.employee_id },
  };
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

async function seedOpenIncident(driverId, description) {
  const { rows } = await q(
    `INSERT INTO driverincidents
       (driver_id, incident_type, incident_date, description, severity, status,
        latitude, longitude, assistance_needed, acknowledged_at, grounding_status,
        requires_vehicle_maintenance)
     VALUES ($1, '[QA] Vehicle breakdown', NOW(), $2, 'Major', 'Open',
             $3, $4, '{Tow Truck}', NOW(), 'Not Required', false)
     RETURNING incident_id`,
    [driverId, description, DRIVER_POS.latitude, DRIVER_POS.longitude]
  );
  return rows[0].incident_id;
}

async function setPosition(driverId, pos, { staleMinutes = 0 } = {}) {
  await q(
    `UPDATE drivers
        SET current_latitude = $1, current_longitude = $2,
            last_location_update = NOW() - ($3 || ' minutes')::interval
      WHERE driver_id = $4`,
    [pos.latitude, pos.longitude, staleMinutes, driverId]
  );
}

async function cleanup() {
  try {
    if (incidentIds.length) {
      await q(`DELETE FROM incident_comments WHERE incident_id = ANY($1::int[])`, [incidentIds]);
      await q(`DELETE FROM audit_logs WHERE resource = 'driverincidents' AND resource_id = ANY($1::int[])`, [incidentIds]);
      await q(`DELETE FROM notifications WHERE reference_type = 'incident' AND reference_id = ANY($1::int[])`, [incidentIds]);
      await q(`DELETE FROM driverincidents WHERE incident_id = ANY($1::int[])`, [incidentIds]);
    }
    for (const [driverId, pre] of prePositions.entries()) {
      await q(
        `UPDATE drivers SET current_latitude = $1, current_longitude = $2, last_location_update = $3
          WHERE driver_id = $4`,
        [pre.lat, pre.lng, pre.at, driverId]
      );
    }
    await q(`DELETE FROM mobile_refresh_tokens WHERE user_agent = $1`, [QA_TOKEN_USER_AGENT]);
    if (createdResponder) {
      await q(`DELETE FROM drivers WHERE driver_id = $1`, [createdResponder.driverId]);
      await q(`DELETE FROM employees WHERE employee_id = $1`, [createdResponder.employeeId]);
    }
    const left = await q(
      `SELECT count(*)::int AS n FROM driverincidents WHERE description ~ '^\\[QA e2e\\]' AND deleted_at IS NULL`,
      []
    );
    console.log(`CLEANUP incidents-left=${left.rows[0].n}`);
  } catch (e) {
    console.error("CLEANUP FAILED — inspect [QA] rows manually:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const roughly = (actual, expected, tol = 0.001) =>
  actual != null && Math.abs(Number(actual) - expected) <= tol;

async function main() {
  const ctx = await pickTargets();
  createdResponder = ctx.createdResponder || null;
  for (const d of [ctx.reporter, ctx.responder]) {
    const pre = (
      await q(`SELECT current_latitude, current_longitude, last_location_update FROM drivers WHERE driver_id = $1`, [
        d.driver_id,
      ])
    ).rows[0];
    prePositions.set(d.driver_id, { lat: pre.current_latitude, lng: pre.current_longitude, at: pre.last_location_update });
  }

  console.log(
    `targets: reporter driver#${ctx.reporter.driver_id} responder driver#${ctx.responder.driver_id} staff#${ctx.staff.employee_id}`
  );

  const responderToken = await mintToken({
    employeeId: ctx.responder.employee_id,
    role: "driver",
    driverId: ctx.responder.driver_id,
  });
  const staffToken = await mintToken({ employeeId: ctx.staff.employee_id, role: "admin" });

  const incidentId = await seedOpenIncident(ctx.reporter.driver_id, `${MARK} rescue navigation rehearsal`);
  incidentIds.push(incidentId);

  // Both parties start with a fresh live position: the stranded driver at the
  // incident, the responder ~4 km out.
  await setPosition(ctx.reporter.driver_id, DRIVER_POS);
  await setPosition(ctx.responder.driver_id, FAR_POS);

  // ── S1: feed is empty before anyone is dispatched ──
  const empty = await api("GET", "/api/incidents/responders/active", staffToken);
  const emptyRows = Array.isArray(empty.body) ? empty.body.filter((r) => r.incident_id === incidentId) : [];
  record("S1 empty feed before assignment", empty.status === 200 && emptyRows.length === 0, `status=${empty.status}`);

  // ── S2: assign + responder GPS → the mission appears with both positions ──
  const assigned = await api("POST", `/api/incidents/${incidentId}/responder`, staffToken, {
    driver_id: ctx.responder.driver_id,
  });
  record("S2 responder assigned", assigned.status === 200 && assigned.body?.responder_driver_id === ctx.responder.driver_id, `status=${assigned.status}`);

  const posted = await api("POST", "/api/driver/responder/location", responderToken, FAR_POS);
  record("S3 responder GPS accepted", posted.status === 200 && posted.body?.updated === true, `status=${posted.status}`);

  const enroute = await waitForRow(
    "S4 auto En Route (lazy evaluation)",
    `SELECT response_status FROM driverincidents WHERE incident_id = $1`,
    [incidentId],
    (row) => row.response_status === "En Route"
  );
  if (!enroute) throw new Error("incident never reached En Route — aborting");

  const feed = await api("GET", "/api/incidents/responders/active", staffToken);
  const mission = Array.isArray(feed.body) ? feed.body.find((r) => r.incident_id === incidentId) : null;
  record(
    "S5 feed exposes the mission with both live positions",
    Boolean(
      mission &&
        mission.responder?.driver_id === ctx.responder.driver_id &&
        roughly(mission.responder?.latitude, FAR_POS.latitude) &&
        roughly(mission.responder?.longitude, FAR_POS.longitude) &&
        roughly(mission.driver?.latitude, DRIVER_POS.latitude) &&
        roughly(mission.driver?.longitude, DRIVER_POS.longitude)
    ),
    mission ? `responder=(${mission.responder?.latitude},${mission.responder?.longitude}) driver=(${mission.driver?.latitude},${mission.driver?.longitude})` : "row missing"
  );
  record(
    "S6 feed carries status/ETA/context",
    Boolean(
      mission &&
        mission.response_status === "En Route" &&
        mission.response_eta != null &&
        mission.incident_type === "[QA] Vehicle breakdown" &&
        mission.severity === "Major"
    ),
    mission ? `status=${mission.response_status} eta=${mission.response_eta}` : "row missing"
  );
  const responderName = mission?.responder?.name;
  record(
    "S7 feed names both parties",
    typeof responderName === "string" && responderName.length > 0 && typeof mission?.driver?.name === "string",
    `responder="${responderName}" driver="${mission?.driver?.name}"`
  );

  // ── S8: arrival → status flips in the feed too ──
  await api("POST", "/api/driver/responder/location", responderToken, NEAR_POS);
  await waitForRow(
    "S9 auto Arrived (lazy evaluation)",
    `SELECT response_status FROM driverincidents WHERE incident_id = $1`,
    [incidentId],
    (row) => row.response_status === "Arrived"
  );
  const feedArrived = await api("GET", "/api/incidents/responders/active", staffToken);
  const missionArrived = Array.isArray(feedArrived.body)
    ? feedArrived.body.find((r) => r.incident_id === incidentId)
    : null;
  record(
    "S10 arrived mission stays visible while open",
    Boolean(missionArrived && missionArrived.response_status === "Arrived"),
    missionArrived ? `status=${missionArrived.response_status}` : "row missing"
  );

  // ── S11: clear the responder → back to manual mode, off the live map ──
  const cleared = await api("POST", `/api/incidents/${incidentId}/responder`, staffToken, { driver_id: null });
  record("S11 responder cleared", cleared.status === 200, `status=${cleared.status}`);
  const feedCleared = await api("GET", "/api/incidents/responders/active", staffToken);
  const stillListed = Array.isArray(feedCleared.body) ? feedCleared.body.find((r) => r.incident_id === incidentId) : null;
  record("S12 cleared mission leaves the feed", !stillListed, stillListed ? "still listed" : "gone");

  // ── S13: the staff feed is not driver-accessible ──
  const forbidden = await api("GET", "/api/incidents/responders/active", responderToken);
  record("S13 driver token rejected (403)", forbidden.status === 403, `status=${forbidden.status}`);

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${failed ? `${failed} FAILED` : "ALL PASS"} (${results.length} assertions)`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("HARNESS ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(cleanup);
