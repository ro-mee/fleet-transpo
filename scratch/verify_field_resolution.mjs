/**
 * Headless E2E rehearsal of FIELD RESOLUTION over the REAL API
 * (verify_responder_navigation.mjs precedent: [QA] rows on the shared dev DB,
 * cleanup in finally, nonzero exit on any failed assertion).
 *
 * Loop under test — the reporting driver or the assigned fleet responder
 * closing an incident from the mobile app (POST /api/driver/incidents/[id]/resolve
 * and POST /api/driver/responder/resolve), with the overseers notified:
 *   1. Driver resolve on an unacknowledged incident     → 409
 *   2. Driver resolve (acknowledged)                    → 200, resolved, confirmed
 *   3. Audit trail: narrative actions_taken + RESOLVED comment + overseer page
 *   4. Double resolve / reopen-after-own-resolve        → 409 (final)
 *   5. Another driver's incident                        → 404
 *   6. Responder resolve before arrival                 → 409
 *   7. Responder resolve after arrival                  → 200, driver unconfirmed
 *   8. Soft close still works: reporter confirms after a responder resolve
 *   9. Resolved mission leaves the responder feed; no assignment → 404
 *
 * Usage:  node --env-file=.env scratch/verify_field_resolution.mjs   (server already running)
 * Env:    QA_BASE (default http://localhost:3000)
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { signAccessToken, hashToken } from "../src/lib/auth/mobile-token.js";

const BASE = process.env.QA_BASE || "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, v) => pool.query(t, v);

const results = [];
const record = (step, pass, detail) => {
  results.push({ step, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a DB row until it matches (or timeout) — the lazy evaluation hooks
 *  are fire-and-forget, so their effect lands a moment after the POST. */
async function waitForRow(label, sql, params, predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = (await q(sql, params)).rows[0] || null;
    if (last && predicate(last)) {
      record(label, true);
      return last;
    }
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

const QA_TOKEN_USER_AGENT = "[QA e2e] verify_field_resolution";

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

async function seedOpenIncident(driverId, description, { acknowledged = true } = {}) {
  const { rows } = await q(
    `INSERT INTO driverincidents
       (driver_id, incident_type, incident_date, description, severity, status,
        latitude, longitude, assistance_needed, acknowledged_at, grounding_status,
        requires_vehicle_maintenance)
     VALUES ($1, '[QA] Vehicle breakdown', NOW(), $2, 'Major', 'Open',
             $3, $4, '{Tow Truck}', $5, 'Not Required', false)
     RETURNING incident_id`,
    [driverId, description, DRIVER_POS.latitude, DRIVER_POS.longitude, acknowledged ? new Date() : null]
  );
  return rows[0].incident_id;
}

async function setPosition(driverId, pos) {
  await q(
    `UPDATE drivers
        SET current_latitude = $1, current_longitude = $2, last_location_update = NOW()
      WHERE driver_id = $3`,
    [pos.latitude, pos.longitude, driverId]
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

  const reporterToken = await mintToken({
    employeeId: ctx.reporter.employee_id,
    role: "driver",
    driverId: ctx.reporter.driver_id,
  });
  const responderToken = await mintToken({
    employeeId: ctx.responder.employee_id,
    role: "driver",
    driverId: ctx.responder.driver_id,
  });
  const staffToken = await mintToken({ employeeId: ctx.staff.employee_id, role: "admin" });

  // ══ Driver field-resolve path ══
  const unackedId = await seedOpenIncident(ctx.reporter.driver_id, "[QA e2e] field resolution — unacknowledged", {
    acknowledged: false,
  });
  incidentIds.push(unackedId);

  const tooEarly = await api("POST", `/api/driver/incidents/${unackedId}/resolve`, reporterToken, {});
  record(
    "S1 driver resolve rejected before acknowledgement (409)",
    tooEarly.status === 409,
    `status=${tooEarly.status}`
  );

  await q(`UPDATE driverincidents SET acknowledged_at = NOW() WHERE incident_id = $1`, [unackedId]);

  const resolved = await api("POST", `/api/driver/incidents/${unackedId}/resolve`, reporterToken, {
    note: "Changed the tire myself.",
  });
  record(
    "S2 driver resolve succeeds (200, resolved + self-confirmed)",
    resolved.status === 200 &&
      resolved.body?.status === "Resolved" &&
      resolved.body?.resolved_by === ctx.reporter.employee_id &&
      resolved.body?.driver_confirmed_at != null,
    `status=${resolved.status} resolved_by=${resolved.body?.resolved_by} confirmed=${resolved.body?.driver_confirmed_at != null}`
  );
  record(
    "S3 narrative is auditable",
    typeof resolved.body?.actions_taken === "string" &&
      resolved.body.actions_taken.includes("from the mobile app") &&
      resolved.body.actions_taken.includes("Changed the tire myself."),
    `actions_taken="${resolved.body?.actions_taken}"`
  );

  const trail = (
    await q(
      `SELECT
         (SELECT count(*)::int FROM incident_comments
           WHERE incident_id = $1 AND action_type = 'RESOLVED'
             AND comment_text LIKE '%from the mobile app%') AS comments,
         (SELECT count(*)::int FROM notifications
           WHERE reference_type = 'incident' AND reference_id = $1
             AND title = 'Incident Resolved by Driver') AS overseer_pages,
         (SELECT count(*)::int FROM audit_logs
           WHERE resource = 'driverincidents' AND resource_id = $1
             AND action = 'driver_field_resolve') AS audits`,
      [unackedId]
    )
  ).rows[0];
  record(
    "S4 audit trail: RESOLVED comment + overseer notification + audit row",
    trail.comments >= 1 && trail.overseer_pages >= 1 && trail.audits >= 1,
    `comments=${trail.comments} overseer_pages=${trail.overseer_pages} audits=${trail.audits}`
  );

  // No-body POST (how the mobile app actually calls it — JSON.stringify(undefined)
  // sends nothing) doubles as a regression check for the empty-request 400.
  const again = await api("POST", `/api/driver/incidents/${unackedId}/resolve`, reporterToken);
  record("S5 double resolve rejected, no-body request accepted (409)", again.status === 409, `status=${again.status}`);

  const reopenOwn = await api("POST", `/api/driver/incidents/${unackedId}/reopen`, reporterToken, {
    reason: "Actually still broken, needs a real tow.",
  });
  record(
    "S6 driver cannot dispute their own field resolution (409)",
    reopenOwn.status === 409,
    `status=${reopenOwn.status}`
  );

  const stranger = await seedOpenIncident(ctx.reporter.driver_id, "[QA e2e] field resolution — wrong caller");
  incidentIds.push(stranger);
  await q(`UPDATE driverincidents SET acknowledged_at = NOW() WHERE incident_id = $1`, [stranger]);
  const wrongDriver = await api("POST", `/api/driver/incidents/${stranger}/resolve`, responderToken, {});
  record(
    "S7 another driver cannot resolve it (404)",
    wrongDriver.status === 404,
    `status=${wrongDriver.status}`
  );

  // ══ Responder field-resolve path ══
  const missionId = await seedOpenIncident(ctx.reporter.driver_id, "[QA e2e] field resolution — responder path");
  incidentIds.push(missionId);
  await setPosition(ctx.reporter.driver_id, DRIVER_POS);
  await setPosition(ctx.responder.driver_id, FAR_POS);

  const assigned = await api("POST", `/api/incidents/${missionId}/responder`, staffToken, {
    driver_id: ctx.responder.driver_id,
  });
  record("S8 responder assigned", assigned.status === 200, `status=${assigned.status}`);

  const tooFar = await api("POST", "/api/driver/responder/resolve", responderToken, {});
  record(
    "S9 responder resolve rejected before arrival (409)",
    tooFar.status === 409,
    `status=${tooFar.status}`
  );

  await api("POST", "/api/driver/responder/location", responderToken, FAR_POS);
  await waitForRow(
    "S10 auto En Route (lazy evaluation)",
    `SELECT response_status FROM driverincidents WHERE incident_id = $1`,
    [missionId],
    (row) => row.response_status === "En Route"
  );
  await api("POST", "/api/driver/responder/location", responderToken, NEAR_POS);
  await waitForRow(
    "S11 auto Arrived (lazy evaluation)",
    `SELECT response_status FROM driverincidents WHERE incident_id = $1`,
    [missionId],
    (row) => row.response_status === "Arrived"
  );

  const missionResolved = await api("POST", "/api/driver/responder/resolve", responderToken, {
    note: "Jump-started the battery, driver is rolling.",
  });
  record(
    "S12 responder resolve succeeds (200, resolved, driver NOT auto-confirmed)",
    missionResolved.status === 200 &&
      missionResolved.body?.status === "Resolved" &&
      missionResolved.body?.resolved_by === ctx.responder.employee_id &&
      missionResolved.body?.driver_confirmed_at == null,
    `status=${missionResolved.status} resolved_by=${missionResolved.body?.resolved_by} confirmed=${missionResolved.body?.driver_confirmed_at != null}`
  );

  const missionTrail = (
    await q(
      `SELECT
         (SELECT count(*)::int FROM notifications
           WHERE reference_type = 'incident' AND reference_id = $1
             AND title = 'Incident Resolved by Responder') AS overseer_pages,
         (SELECT count(*)::int FROM notifications
           WHERE reference_type = 'incident' AND reference_id = $1
             AND title = 'Incident Report Resolved') AS reporter_pages,
         (SELECT count(*)::int FROM audit_logs
           WHERE resource = 'driverincidents' AND resource_id = $1
             AND action = 'responder_field_resolve') AS audits`,
      [missionId]
    )
  ).rows[0];
  record(
    "S13 overseers paged, reporter prompted, audit written",
    missionTrail.overseer_pages >= 1 && missionTrail.reporter_pages >= 1 && missionTrail.audits >= 1,
    `overseer_pages=${missionTrail.overseer_pages} reporter_pages=${missionTrail.reporter_pages} audits=${missionTrail.audits}`
  );

  const softClose = await api("POST", `/api/driver/incidents/${missionId}/confirm-resolution`, reporterToken);
  record(
    "S14 reporter still soft-closes after a responder resolve (200)",
    softClose.status === 200 && softClose.body?.driver_confirmed_at != null,
    `status=${softClose.status}`
  );

  const missionsAfter = await api("GET", "/api/driver/incidents?role=responder", responderToken);
  const stillListed = Array.isArray(missionsAfter.body)
    ? missionsAfter.body.find((m) => m.incident_id === missionId)
    : null;
  record("S15 resolved mission left the responder feed", !stillListed, stillListed ? "still listed" : "gone");

  const cleared = await api("POST", `/api/incidents/${stranger}/responder`, staffToken, { driver_id: null });
  const noMission = await api("POST", "/api/driver/responder/resolve", responderToken);
  record(
    "S16 responder with no assignment gets 404",
    cleared.status === 200 && noMission.status === 404,
    `clear=${cleared.status} resolve=${noMission.status}`
  );

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
