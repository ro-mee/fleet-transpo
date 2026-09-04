/**
 * Headless E2E rehearsal of the incident PHYSICAL-response loop over the REAL
 * API (qa_incidents_e2e.mjs precedent: [QA] rows on the shared dev DB, cleanup
 * in finally, nonzero exit on any failed assertion).
 *
 * Loop under test — migration 100 + the four new endpoints:
 *   1. POST /api/incidents/:id/response            staff log the rescue
 *   2. POST /api/driver/incidents/:id/location     driver live position
 *   3. POST /api/driver/incidents/:id/confirm-resolution
 *   4. POST /api/driver/incidents/:id/reopen       driver disputes
 *
 * Usage:  node --env-file=.env scratch/verify_incident_response.mjs   (server already running)
 * Env:    QA_BASE (default http://localhost:3100)
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { signAccessToken, hashToken } from "../src/lib/auth/mobile-token.js";

const BASE = process.env.QA_BASE || "http://localhost:3100";
const MARK = "[QA e2e]";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, v) => pool.query(t, v);

const results = [];
const record = (step, pass, detail) => {
  results.push({ step, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};

let incidentId = null;
let medicalIncidentId = null;
let driverCtx = null;
let staffEmployeeId = null;
let driverPrePosition = null;

const QA_TOKEN_USER_AGENT = "[QA e2e] verify_incident_response";

/**
 * Mint a Bearer token the API will actually accept. Since the auth hardening
 * (migrations 087/088), verifyAccessToken alone is not enough: the claims must
 * carry the employee's CURRENT auth_version, and a familyId backed by a live
 * mobile_refresh_tokens row (revocation takes effect on the next request).
 * The QA family rows are deleted in cleanup.
 */
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
  const driver = (
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
  if (!driver) throw new Error("no eligible driver (zero device_tokens)");
  if (!staff) throw new Error("no eligible staff account (zero device_tokens)");
  return { driver, staff };
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
  // Seeded directly (not via POST /api/driver/incidents) so the grounding
  // automation, maintenance auto-create, and vehicle status changes stay out
  // of this rehearsal — it tests the RESPONSE loop, not report time.
  const { rows } = await q(
    `INSERT INTO driverincidents
       (driver_id, incident_type, incident_date, description, severity, status,
        assistance_needed, acknowledged_at, grounding_status, requires_vehicle_maintenance)
     VALUES ($1, '[QA] Medical assistance', NOW(), $2, 'Critical', 'Open',
             '{Medical Assistance}', NOW(), 'Not Required', false)
     RETURNING incident_id`,
    [driverId, description]
  );
  return rows[0].incident_id;
}

async function cleanup() {
  try {
    const ids = [incidentId, medicalIncidentId].filter(Boolean);
    if (ids.length) {
      await q(`DELETE FROM incident_comments WHERE incident_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM audit_logs WHERE resource = 'driverincidents' AND resource_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM notifications WHERE reference_type = 'incident' AND reference_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM driverincidents WHERE incident_id = ANY($1::int[])`, [ids]);
    }
    if (driverPrePosition && driverCtx) {
      await q(
        `UPDATE drivers SET current_latitude = $1, current_longitude = $2, last_location_update = $3
          WHERE driver_id = $4`,
        [driverPrePosition.lat, driverPrePosition.lng, driverPrePosition.at, driverCtx.driver_id]
      );
    }
    await q(`DELETE FROM mobile_refresh_tokens WHERE user_agent = $1`, [QA_TOKEN_USER_AGENT]);
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

async function main() {
  const ctx = await pickTargets();
  driverCtx = ctx.driver;
  staffEmployeeId = ctx.staff.employee_id;
  const pre = (
    await q(`SELECT current_latitude, current_longitude, last_location_update FROM drivers WHERE driver_id = $1`, [
      ctx.driver.driver_id,
    ])
  ).rows[0];
  driverPrePosition = { lat: pre.current_latitude, lng: pre.current_longitude, at: pre.last_location_update };

  console.log(`targets: driver#${ctx.driver.driver_id} staff#${staffEmployeeId}`);

  const driverToken = await mintToken({
    employeeId: ctx.driver.employee_id,
    role: "driver",
    driverId: ctx.driver.driver_id,
  });
  const staffToken = await mintToken({ employeeId: staffEmployeeId, role: "admin" });

  incidentId = await seedOpenIncident(ctx.driver.driver_id, `${MARK} medical response rehearsal`);

  // ── S1: first response log requires a type ──
  const noType = await api("POST", `/api/incidents/${incidentId}/response`, staffToken, { response_status: "Dispatched" });
  record("S1 first log without type -> 400", noType.status === 400, `status=${noType.status}`);

  // ── S2: dispatch with type + ETA ──
  const dispatch = await api("POST", `/api/incidents/${incidentId}/response`, staffToken, {
    response_status: "Dispatched",
    response_type: "Ambulance",
    response_details: `${MARK} AC Medical`,
    eta_minutes: 20,
  });
  record(
    "S2 dispatch -> 200 + columns",
    dispatch.status === 200 &&
      dispatch.body?.response_status === "Dispatched" &&
      dispatch.body?.response_type === "Ambulance" &&
      !!dispatch.body?.response_eta,
    `status=${dispatch.status}`
  );
  const row2 = (
    await q(
      `SELECT response_status, response_type, response_eta, responded_at, responded_by
         FROM driverincidents WHERE incident_id = $1`,
      [incidentId]
    )
  ).rows[0];
  const etaDeltaMin = row2.response_eta ? (new Date(row2.response_eta) - Date.now()) / 60000 : -1;
  record(
    "S2 ETA ~20min out, responded_by staff",
    etaDeltaMin > 15 && etaDeltaMin < 25 && Number(row2.responded_by) === Number(staffEmployeeId),
    `eta_in=${etaDeltaMin.toFixed(1)}min by=${row2.responded_by}`
  );
  const comment2 = (
    await q(
      `SELECT count(*)::int AS n FROM incident_comments
        WHERE incident_id = $1 AND action_type = 'RESPONSE' AND comment_text LIKE 'Dispatched — Ambulance%'`,
      [incidentId]
    )
  ).rows[0].n;
  record("S2 RESPONSE comment written", comment2 === 1, `comments=${comment2}`);
  const notif2 = (
    await q(
      `SELECT count(*)::int AS n FROM notifications
        WHERE reference_type = 'incident' AND reference_id = $1 AND title = 'Help Update'`,
      [incidentId]
    )
  ).rows[0].n;
  record("S2 driver notified of dispatch", notif2 >= 1, `notifs=${notif2}`);

  // ── S3: advance En Route (type inherited) ──
  const enRoute = await api("POST", `/api/incidents/${incidentId}/response`, staffToken, {
    response_status: "En Route",
    eta_minutes: 10,
  });
  record(
    "S3 advance En Route (type inherited) -> 200",
    enRoute.status === 200 && enRoute.body?.response_type === "Ambulance",
    `status=${enRoute.status} type=${enRoute.body?.response_type}`
  );

  // ── S4: arrive ──
  const arrived = await api("POST", `/api/incidents/${incidentId}/response`, staffToken, {
    response_status: "Arrived",
  });
  record("S4 arrive -> 200", arrived.status === 200 && arrived.body?.response_status === "Arrived", `status=${arrived.status}`);

  // ── S5: ladder is forward-only ──
  const backwards = await api("POST", `/api/incidents/${incidentId}/response`, staffToken, {
    response_status: "En Route",
  });
  record("S5 backwards move -> 409", backwards.status === 409, `status=${backwards.status}`);

  // ── S6: driver live location while open ──
  const loc = await api("POST", `/api/driver/incidents/${incidentId}/location`, driverToken, {
    latitude: 14.5995,
    longitude: 120.9842,
  });
  record("S6 driver location post -> 200", loc.status === 200, `status=${loc.status}`);
  const driverRow = (
    await q(`SELECT current_latitude, current_longitude, last_location_update FROM drivers WHERE driver_id = $1`, [
      ctx.driver.driver_id,
    ])
  ).rows[0];
  record(
    "S6 drivers.current_* updated",
    Number(driverRow.current_latitude) === 14.5995 && Number(driverRow.current_longitude) === 120.9842,
    `lat=${driverRow.current_latitude} lng=${driverRow.current_longitude}`
  );
  const incidentCoords = (
    await q(`SELECT latitude, longitude FROM driverincidents WHERE incident_id = $1`, [incidentId])
  ).rows[0];
  record(
    "S6 report-time coordinates untouched",
    incidentCoords.latitude === null && incidentCoords.longitude === null,
    `lat=${incidentCoords.latitude}`
  );

  // ── S7: confirm/reopen only after a resolution exists ──
  const earlyConfirm = await api("POST", `/api/driver/incidents/${incidentId}/confirm-resolution`, driverToken);
  const earlyReopen = await api("POST", `/api/driver/incidents/${incidentId}/reopen`, driverToken, { reason: "Not resolved yet at all" });
  record(
    "S7 confirm/reopen rejected while Open",
    earlyConfirm.status === 409 && earlyReopen.status === 409,
    `confirm=${earlyConfirm.status} reopen=${earlyReopen.status}`
  );

  // ── S8: resolve (state machine: acknowledged already seeded) ──
  const resolve = await api("PATCH", `/api/incidents/${incidentId}`, staffToken, {
    status: "Resolved",
    actions_taken: `${MARK} ambulance arrived; driver checked by medics`,
  });
  record("S8 staff resolve -> 200", resolve.status === 200, `status=${resolve.status}`);
  const locAfterResolve = await api("POST", `/api/driver/incidents/${incidentId}/location`, driverToken, {
    latitude: 15.0,
    longitude: 121.0,
  });
  record("S8 location post rejected once Resolved", locAfterResolve.status === 404, `status=${locAfterResolve.status}`);

  // ── S9: driver disputes — reopen ──
  // (min length is 10; "still hurt" is exactly 10 and therefore VALID — keep
  // the invalid sample strictly shorter)
  const badReason = await api("POST", `/api/driver/incidents/${incidentId}/reopen`, driverToken, { reason: "help" });
  record("S9 reopen with short reason -> 400", badReason.status === 400, `status=${badReason.status}`);
  const reopen = await api("POST", `/api/driver/incidents/${incidentId}/reopen`, driverToken, {
    reason: `${MARK} Driver disputes: still experiencing dizziness, needs a second medical check.`,
  });
  record("S9 driver reopen -> 200", reopen.status === 200, `status=${reopen.status}`);
  const reopenedRow = (
    await q(
      `SELECT status, resolved_at, reopened_at FROM driverincidents WHERE incident_id = $1`,
      [incidentId]
    )
  ).rows[0];
  record(
    "S9 incident back to Open, reopened_at set",
    reopenedRow.status === "Open" && reopenedRow.resolved_at === null && !!reopenedRow.reopened_at,
    `status=${reopenedRow.status}`
  );
  const reopenedComment = (
    await q(
      `SELECT count(*)::int AS n FROM incident_comments
        WHERE incident_id = $1 AND action_type = 'REOPENED'`,
      [incidentId]
    )
  ).rows[0].n;
  record("S9 REOPENED comment written", reopenedComment === 1, `comments=${reopenedComment}`);
  const overseerNotif = (
    await q(
      `SELECT count(*)::int AS n FROM notifications
        WHERE reference_type = 'incident' AND reference_id = $1 AND title = 'Incident Reopened by Driver'`,
      [incidentId]
    )
  ).rows[0].n;
  record("S9 overseers alerted", overseerNotif >= 1, `notifs=${overseerNotif}`);

  // ── S10: re-resolve, then driver confirms — final ──
  const reResolve = await api("PATCH", `/api/incidents/${incidentId}`, staffToken, {
    status: "Resolved",
    actions_taken: `${MARK} second medical check completed; driver cleared`,
  });
  record("S10 re-resolve after reopen -> 200", reResolve.status === 200, `status=${reResolve.status}`);
  const confirm = await api("POST", `/api/driver/incidents/${incidentId}/confirm-resolution`, driverToken);
  record("S10 driver confirm -> 200", confirm.status === 200, `status=${confirm.status}`);
  const confirmedRow = (
    await q(`SELECT driver_confirmed_at FROM driverincidents WHERE incident_id = $1`, [incidentId])
  ).rows[0];
  record("S10 driver_confirmed_at set", !!confirmedRow.driver_confirmed_at, `at=${confirmedRow.driver_confirmed_at}`);
  const confirmedComment = (
    await q(
      `SELECT count(*)::int AS n FROM incident_comments
        WHERE incident_id = $1 AND action_type = 'DRIVER_CONFIRMED'`,
      [incidentId]
    )
  ).rows[0].n;
  record("S10 DRIVER_CONFIRMED comment written", confirmedComment === 1, `comments=${confirmedComment}`);

  // ── S11: confirmation is final (confirm itself is idempotent) ──
  const reopenAfterConfirm = await api("POST", `/api/driver/incidents/${incidentId}/reopen`, driverToken, {
    reason: `${MARK} changed my mind, this should not reopen anymore`,
  });
  const confirmAgain = await api("POST", `/api/driver/incidents/${incidentId}/confirm-resolution`, driverToken);
  record(
    "S11 reopen after confirmation -> 409; re-confirm idempotent -> 200",
    reopenAfterConfirm.status === 409 && confirmAgain.status === 200,
    `reopen=${reopenAfterConfirm.status} confirm=${confirmAgain.status}`
  );

  // ── S12: POST report with Medical Assistance sets the structured flag ──
  const medical = await api("POST", "/api/driver/incidents", driverToken, {
    incident_type: "Medical Concern",
    description: `${MARK} medical flag wiring rehearsal`,
    severity: "Minor",
    incident_date: new Date().toISOString(),
    client_submission_id: `${Date.now()}-med-${Math.random().toString(36).slice(2, 8)}`,
    assistance_needed: ["Medical Assistance"],
  });
  medicalIncidentId = medical.body?.incident_id || null;
  record(
    "S12 report with Medical Assistance -> 201 + medical_assistance_required",
    medical.status === 201 && medical.body?.medical_assistance_required === true,
    `status=${medical.status} flag=${medical.body?.medical_assistance_required}`
  );

  // ── S13: staff list + resolver GET expose the new state ──
  const list = await api("GET", "/api/incidents?limit=500", staffToken);
  const listed = Array.isArray(list.body) ? list.body.find((i) => i.incident_id === incidentId) : null;
  record(
    "S13 staff list exposes response_status / driver_confirmed_at / reopened_at",
    listed && listed.response_status === "Arrived" && !!listed.driver_confirmed_at && !!listed.reopened_at,
    `response_status=${listed?.response_status}`
  );
  const detail = await api("GET", `/api/incidents/${incidentId}`, staffToken);
  record(
    "S13 resolver GET exposes response card + reopen reason + driver position",
    detail.status === 200 &&
      detail.body?.response_type === "Ambulance" &&
      !!detail.body?.reopen_reason &&
      Number(detail.body?.driver_latitude) === 14.5995,
    `reopen_reason=${detail.body?.reopen_reason ? "present" : "missing"} lat=${detail.body?.driver_latitude}`
  );
  const driverList = await api("GET", "/api/driver/incidents", driverToken);
  const own = Array.isArray(driverList.body) ? driverList.body.find((i) => i.incident_id === incidentId) : null;
  record(
    "S13 driver list exposes response columns",
    own && own.response_status === "Arrived" && own.response_type === "Ambulance" && !!own.driver_confirmed_at,
    `response_status=${own?.response_status}`
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${failed === 0 ? "ALL PASS" : failed + " FAILED"} (${results.length} assertions)`);
  if (failed > 0) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  console.error("HARNESS ERROR:", e);
  process.exitCode = 1;
} finally {
  await cleanup();
}
