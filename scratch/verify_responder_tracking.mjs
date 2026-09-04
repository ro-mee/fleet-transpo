/**
 * Headless E2E rehearsal of the GPS-TRACKED FLEET RESPONDER loop over the REAL
 * API (verify_incident_response.mjs precedent: [QA] rows on the shared dev DB,
 * cleanup in finally, nonzero exit on any failed assertion).
 *
 * Loop under test — migration 102 + the responder tracking feature:
 *   1. GET  /api/incidents/:id/responder          staff picker list
 *   2. POST /api/incidents/:id/responder          assign fleet responder
 *   3. POST /api/driver/responder/location        responder GPS → auto ladder
 *   4. GET  /api/driver/incidents                 stranded driver poll → lazy evaluation
 *   5. POST /api/driver/responder/arrived         manual arrival fallback
 *   6. POST /api/incidents/:id/responder (null)   clear → manual mode restored
 *
 * Usage:  node --env-file=.env scratch/verify_responder_tracking.mjs   (server already running)
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

let incidentIds = [];
let manualIncidentId = null;
let targetCtx = null;
let createdResponder = null;
const prePositions = new Map();

const QA_TOKEN_USER_AGENT = "[QA e2e] verify_responder_tracking";

/**
 * Mint a Bearer token the API will actually accept. Since the auth hardening
 * (migrations 087/088), verifyAccessToken alone is not enough: the claims must
 * carry the employee's CURRENT auth_version, and a familyId backed by a live
 * mobile_refresh_tokens row. The QA family rows are deleted in cleanup.
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
  // The reporting driver just needs to exist (any status, no device tokens so
  // pushes never reach a real handset). The responder must be Available —
  // driver_status has no 'Active' value (CHECK: Available/On Trip/Off Duty/On
  // Leave/Suspended) and the picker route only offers Available drivers.
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
      `
      SELECT d.driver_id, d.employee_id
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

  // No spare available driver — mint one (role 'driver'), removed in cleanup.
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
  // Seeded directly so grounding/maintenance automation stays out of this
  // rehearsal — it tests the RESCUE LADDER, not report time. The incident
  // carries report-time coordinates and is pre-acknowledged.
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
    const ids = [...incidentIds, manualIncidentId].filter(Boolean);
    if (ids.length) {
      await q(`DELETE FROM incident_comments WHERE incident_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM audit_logs WHERE resource = 'driverincidents' AND resource_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM notifications WHERE reference_type = 'incident' AND reference_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM driverincidents WHERE incident_id = ANY($1::int[])`, [ids]);
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
      // Own incidents are gone above; the QA responder employee + driver rows
      // were minted by this run and can go.
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
  targetCtx = ctx;
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

  const incidentId = await seedOpenIncident(ctx.reporter.driver_id, `${MARK} responder tracking rehearsal`);
  incidentIds.push(incidentId);

  // Both parties start with a fresh live position: the stranded driver at the
  // incident, the responder-to-be ~4 km out.
  await setPosition(ctx.reporter.driver_id, DRIVER_POS);
  await setPosition(ctx.responder.driver_id, FAR_POS);

  // ── S1: picker list exposes active drivers, minus the reporter ──
  const picker = await api("GET", `/api/incidents/${incidentId}/responder`, staffToken);
  const candidates = Array.isArray(picker.body) ? picker.body : [];
  const responderEntry = candidates.find((c) => c.driver_id === ctx.responder.driver_id);
  const reporterListed = candidates.some((c) => c.driver_id === ctx.reporter.driver_id);
  record(
    "S1 picker lists responder with distance, excludes reporter",
    picker.status === 200 && !!responderEntry && responderEntry.distance_km != null && responderEntry.position_fresh === true && !reporterListed,
    `status=${picker.status} dist=${responderEntry?.distance_km}`
  );

  // ── S2: the reporting driver cannot be their own responder ──
  const selfAssign = await api("POST", `/api/incidents/${incidentId}/responder`, staffToken, {
    driver_id: ctx.reporter.driver_id,
  });
  record("S2 self-assign rejected -> 400", selfAssign.status === 400, `status=${selfAssign.status}`);

  // ── S3: assign the fleet responder ──
  const assign = await api("POST", `/api/incidents/${incidentId}/responder`, staffToken, {
    driver_id: ctx.responder.driver_id,
  });
  record(
    "S3 assign -> 200 Dispatched + Fleet Responder",
    assign.status === 200 && assign.body?.response_status === "Dispatched" && assign.body?.response_type === "Fleet Responder",
    `status=${assign.status}`
  );
  const assignedRow = (
    await q(
      `SELECT responder_driver_id, responder_assigned_at, responded_by FROM driverincidents WHERE incident_id = $1`,
      [incidentId]
    )
  ).rows[0];
  record(
    "S3 responder columns + responded_by staff",
    Number(assignedRow.responder_driver_id) === ctx.responder.driver_id &&
      !!assignedRow.responder_assigned_at &&
      Number(assignedRow.responded_by) === Number(ctx.staff.employee_id),
    `responder=${assignedRow.responder_driver_id}`
  );
  const responderNotif = (
    await q(
      `SELECT count(*)::int AS n FROM notifications
        WHERE reference_type = 'incident' AND reference_id = $1
          AND employee_id = $2 AND title = 'You Are the Responder'`,
      [incidentId, ctx.responder.employee_id]
    )
  ).rows[0].n;
  record("S3 responder notified", responderNotif >= 1, `notifs=${responderNotif}`);

  // ── S4: responder mission list via ?role=responder ──
  const missions = await api("GET", "/api/driver/incidents?role=responder", responderToken);
  const mission = Array.isArray(missions.body) ? missions.body.find((m) => m.incident_id === incidentId) : null;
  record(
    "S4 mission list exposes live driver position",
    missions.status === 200 && !!mission && Number(mission.driver_latitude) === DRIVER_POS.latitude,
    `status=${missions.status} lat=${mission?.driver_latitude}`
  );
  // The responder's own incidents list must NOT contain someone else's incident.
  const ownList = await api("GET", "/api/driver/incidents", responderToken);
  const ownHasIt = Array.isArray(ownList.body) ? ownList.body.some((i) => i.incident_id === incidentId) : true;
  record("S4 responder own-list excludes the mission", !ownHasIt, `present=${ownHasIt}`);

  // ── S5: responder posts 4 km out → auto En Route + ETA ──
  // (posted position is already fresh; the POST awaits evaluation)
  const postFar = await api("POST", "/api/driver/responder/location", responderToken, FAR_POS);
  record(
    "S5 responder post -> 200 + En Route",
    postFar.status === 200 && postFar.body?.response_status === "En Route",
    `status=${postFar.status} state=${postFar.body?.response_status}`
  );
  const enRouteRow = (
    await q(`SELECT response_status, response_eta FROM driverincidents WHERE incident_id = $1`, [incidentId])
  ).rows[0];
  record("S5 response_eta set automatically", !!enRouteRow.response_eta, `eta=${enRouteRow.response_eta}`);
  const autoComment = (
    await q(
      `SELECT count(*)::int AS n FROM incident_comments
        WHERE incident_id = $1 AND action_type = 'RESPONSE'
          AND comment_text LIKE '%(auto — responder GPS)%'`,
      [incidentId]
    )
  ).rows[0].n;
  record("S5 auto RESPONSE comment written", autoComment >= 1, `comments=${autoComment}`);
  const enRouteNotif = (
    await q(
      `SELECT count(*)::int AS n FROM notifications
        WHERE reference_type = 'incident' AND reference_id = $1
          AND employee_id = $2 AND message LIKE '%en route%'`,
      [incidentId, ctx.reporter.employee_id]
    )
  ).rows[0].n;
  record("S5 driver notified of En Route", enRouteNotif >= 1, `notifs=${enRouteNotif}`);

  // ── S6: stale responder position must not drive decisions ──
  const etaBeforeStale = enRouteRow.response_eta;
  await setPosition(ctx.responder.driver_id, NEAR_POS, { staleMinutes: 10 });
  const pollStale = await api("GET", "/api/driver/incidents", reporterToken);
  record("S6 stranded driver poll ok while position stale", pollStale.status === 200, `status=${pollStale.status}`);
  await sleep(1500); // lazy evaluation is fire-and-forget
  const staleRow = (
    await q(`SELECT response_status, response_eta FROM driverincidents WHERE incident_id = $1`, [incidentId])
  ).rows[0];
  record(
    "S6 stale position ignored (no Arrived, no ETA drift)",
    staleRow.response_status === "En Route" &&
      (staleRow.response_eta === null ? etaBeforeStale === null : new Date(staleRow.response_eta).getTime() === new Date(etaBeforeStale).getTime()),
    `status=${staleRow.response_status} eta_changed=${new Date(staleRow.response_eta).getTime() !== new Date(etaBeforeStale).getTime()}`
  );

  // ── S7: lazy evaluation — trip-GPS-style position write (no POST), advanced
  //      purely by the stranded driver's poll ──
  await setPosition(ctx.responder.driver_id, NEAR_POS); // fresh, ~60 m away
  await api("GET", "/api/driver/incidents", reporterToken);
  const arrivedRow = await waitForRow(
    "S7 lazy evaluation advances to Arrived",
    `SELECT response_status, response_eta FROM driverincidents WHERE incident_id = $1`,
    [incidentId],
    (r) => r.response_status === "Arrived"
  );
  if (arrivedRow) record("S7 lazy evaluation advances to Arrived", true, `status=${arrivedRow.response_status}`);
  const arrivalNotif = (
    await q(
      `SELECT count(*)::int AS n FROM notifications
        WHERE reference_type = 'incident' AND reference_id = $1
          AND employee_id = $2 AND message LIKE '%has arrived%'`,
      [incidentId, ctx.reporter.employee_id]
    )
  ).rows[0].n;
  record("S7 driver notified help arrived", arrivalNotif >= 1, `notifs=${arrivalNotif}`);
  const overseerNotif = (
    await q(
      `SELECT count(*)::int AS n FROM notifications
        WHERE reference_type = 'incident' AND reference_id = $1 AND title = 'Responder On Scene'`,
      [incidentId]
    )
  ).rows[0].n;
  record("S7 overseers paged on arrival", overseerNotif >= 1, `notifs=${overseerNotif}`);

  // ── S8: Arrived is final — a later far-away post must not downgrade ──
  await setPosition(ctx.responder.driver_id, FAR_POS);
  const postFarAgain = await api("POST", "/api/driver/responder/location", responderToken, FAR_POS);
  await sleep(500);
  const afterFarAgain = (
    await q(`SELECT response_status FROM driverincidents WHERE incident_id = $1`, [incidentId])
  ).rows[0];
  record(
    "S8 Arrived is final (no downgrade)",
    postFarAgain.status === 200 && afterFarAgain.response_status === "Arrived",
    `post=${postFarAgain.status} status=${afterFarAgain.response_status}`
  );

  // ── S9: manual response ladder stays forward-only ──
  const backwards = await api("POST", `/api/incidents/${incidentId}/response`, staffToken, {
    response_status: "En Route",
  });
  record("S9 manual backwards move -> 409", backwards.status === 409, `status=${backwards.status}`);

  // ── S10: GET surfaces expose the responder ──
  const detail = await api("GET", `/api/incidents/${incidentId}`, staffToken);
  record(
    "S10 resolver GET exposes responder object + position",
    detail.status === 200 &&
      detail.body?.responder?.driver_id === ctx.responder.driver_id &&
      Number(detail.body?.responder_latitude) === FAR_POS.latitude,
    `responder=${JSON.stringify(detail.body?.responder)} lat=${detail.body?.responder_latitude}`
  );
  const list = await api("GET", "/api/incidents?limit=500", staffToken);
  const listed = Array.isArray(list.body) ? list.body.find((i) => i.incident_id === incidentId) : null;
  record(
    "S10 staff list exposes responder_driver_id + responder",
    listed && Number(listed.responder_driver_id) === ctx.responder.driver_id && listed.responder?.driver_id === ctx.responder.driver_id,
    `id=${listed?.responder_driver_id}`
  );
  const reporterList = await api("GET", "/api/driver/incidents", reporterToken);
  const ownIncident = Array.isArray(reporterList.body) ? reporterList.body.find((i) => i.incident_id === incidentId) : null;
  record(
    "S10 driver list exposes responder name",
    ownIncident && ownIncident.responder_driver_id === ctx.responder.driver_id && !!ownIncident.responder_first_name,
    `name=${ownIncident?.responder_first_name}`
  );

  // ── S11: clear the responder → manual mode restored ──
  const clear = await api("POST", `/api/incidents/${incidentId}/responder`, staffToken, { driver_id: null });
  record("S11 clear responder -> 200", clear.status === 200, `status=${clear.status}`);
  const clearedRow = (
    await q(`SELECT responder_driver_id FROM driverincidents WHERE incident_id = $1`, [incidentId])
  ).rows[0];
  record("S11 responder_driver_id cleared", clearedRow.responder_driver_id === null, `id=${clearedRow.responder_driver_id}`);
  const missionsAfterClear = await api("GET", "/api/driver/incidents?role=responder", responderToken);
  const stillMission = Array.isArray(missionsAfterClear.body)
    ? missionsAfterClear.body.some((m) => m.incident_id === incidentId)
    : true;
  record("S11 mission list no longer returns it", !stillMission, `present=${stillMission}`);
  const manualResponse = await api("POST", `/api/incidents/${incidentId}/response`, staffToken, {
    response_status: "Arrived",
    response_type: "AC Medical Ambulance",
  });
  record("S11 manual response path works again", manualResponse.status === 200, `status=${manualResponse.status}`);

  // ── S12: resolve + confirm loop unaffected ──
  const resolve = await api("PATCH", `/api/incidents/${incidentId}`, staffToken, {
    status: "Resolved",
    actions_taken: `${MARK} responder delivered the driver and vehicle to the depot`,
  });
  record("S12 staff resolve -> 200", resolve.status === 200, `status=${resolve.status}`);
  const confirm = await api("POST", `/api/driver/incidents/${incidentId}/confirm-resolution`, reporterToken);
  record("S12 driver confirm -> 200", confirm.status === 200, `status=${confirm.status}`);

  // ── S13: manual arrival fallback on a second incident ──
  manualIncidentId = await seedOpenIncident(ctx.reporter.driver_id, `${MARK} manual arrival rehearsal`);
  await setPosition(ctx.reporter.driver_id, DRIVER_POS);
  await setPosition(ctx.responder.driver_id, FAR_POS);
  const assign2 = await api("POST", `/api/incidents/${manualIncidentId}/responder`, staffToken, {
    driver_id: ctx.responder.driver_id,
  });
  record("S13 assign for manual arrival -> 200", assign2.status === 200, `status=${assign2.status}`);
  const arrivedManual = await api("POST", "/api/driver/responder/arrived", responderToken);
  record(
    "S13 manual arrived -> 200 + Arrived",
    arrivedManual.status === 200 && arrivedManual.body?.response_status === "Arrived",
    `status=${arrivedManual.status} state=${arrivedManual.body?.response_status}`
  );
  const manualComment = (
    await q(
      `SELECT count(*)::int AS n FROM incident_comments
        WHERE incident_id = $1 AND action_type = 'RESPONSE'
          AND comment_text LIKE '%(manual — responder confirmed on device)%'`,
      [manualIncidentId]
    )
  ).rows[0].n;
  record("S13 manual RESPONSE comment written", manualComment === 1, `comments=${manualComment}`);
  const arrivedAgain = await api("POST", "/api/driver/responder/arrived", responderToken);
  record("S13 manual arrived idempotent -> 200", arrivedAgain.status === 200, `status=${arrivedAgain.status}`);
  const responderArrivedNotif = (
    await q(
      `SELECT count(*)::int AS n FROM notifications
        WHERE reference_type = 'incident' AND reference_id = $1
          AND employee_id = $2 AND message LIKE '%has arrived%'`,
      [manualIncidentId, ctx.reporter.employee_id]
    )
  ).rows[0].n;
  record("S13 driver notified of manual arrival", responderArrivedNotif >= 1, `notifs=${responderArrivedNotif}`);

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
