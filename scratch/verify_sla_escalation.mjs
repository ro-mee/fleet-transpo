// Read-mostly verification of escalateOverdueIncidents() idempotency against
// the live DB (qa_incidents_e2e.mjs precedent: seed a [QA] row, assert, clean up).
//
// 1. Seed one open, unacknowledged Critical incident with due_at an hour past.
// 2. Run the EXACT overseer query and INSERT...NOT EXISTS SQL from
//    src/lib/incidents/sla.js — twice.
// 3. Assert pass 1 inserts one notification per overseer and pass 2 inserts
//    none (the NOT EXISTS dedupe that makes dashboard reloads safe).
// 4. Delete the [QA] notifications and incident.
//
// sendPush is deliberately NOT invoked — no real devices are contacted.
import pg from "pg";
import { loadEnvLocal } from "../scripts/load-env.mjs";

loadEnvLocal();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TITLE = "Incident SLA Breached — Unacknowledged";
let incidentId = null;

try {
  const { rows: drivers } = await pool.query(
    `SELECT driver_id FROM drivers WHERE deleted_at IS NULL LIMIT 1`
  );
  if (!drivers.length) throw new Error("no driver rows found — cannot seed [QA] incident");
  const driverId = drivers[0].driver_id;

  const seeded = await pool.query(
    `INSERT INTO driverincidents
       (driver_id, incident_type, incident_date, description, severity, status, due_at)
     VALUES ($1, '[QA] SLA escalation idempotency test', NOW() - interval '2 hours',
             '[QA] seeded overdue incident — deleted by verify_sla_escalation.mjs',
             'Critical', 'Open', NOW() - interval '1 hour')
     RETURNING incident_id`,
    [driverId]
  );
  incidentId = seeded.rows[0].incident_id;
  console.log(`seeded [QA] incident #${incidentId} (Critical, Open, due 1h ago)`);

  // Exact queries from src/lib/incidents/sla.js.
  const overdueQuery = `
    SELECT incident_id, incident_type, severity, driver_id
      FROM driverincidents
     WHERE status = 'Open'
       AND acknowledged_at IS NULL
       AND due_at IS NOT NULL
       AND due_at < NOW()
       AND severity IN ('Critical', 'Major')
       AND deleted_at IS NULL`;
  const recipientsQuery = `
    SELECT e.employee_id
      FROM employees e
      JOIN roles r ON r.role_id = e.role_id
     WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`;
  const insertQuery = `
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT $1, $2::varchar, $3, $4, $5::varchar, $6
     WHERE NOT EXISTS (
       SELECT 1 FROM notifications
        WHERE employee_id = $1 AND title = $2::varchar
          AND reference_type = $5::varchar AND reference_id = $6
     )
    RETURNING employee_id`;

  // Pass 0: the seeded incident must be the only thing the overdue query sees
  // that lacks prior escalations (pre-existing overdue incidents, if any, may
  // already have theirs — the dedupe check below is per-incident regardless).
  const { rows: overdue } = await pool.query(overdueQuery);
  console.log(`overdue unacknowledged Critical/Major incidents now: ${overdue.map((i) => i.incident_id).join(", ") || "(none)"}`);
  if (!overdue.some((i) => i.incident_id === incidentId)) {
    throw new Error("seeded incident not selected by the sla.js overdue query");
  }

  const { rows: recipients } = await pool.query(recipientsQuery, [["system_admin", "fleet_manager", "admin"]]);
  console.log(`overseers: ${recipients.length}`);

  const message = `Incident #${incidentId} ([QA] SLA escalation idempotency test, Critical) has passed its response SLA with no acknowledgement. The reporting driver is still waiting.`;
  const runPass = async (label) => {
    let inserted = 0;
    for (const r of recipients) {
      const { rows } = await pool.query(insertQuery, [r.employee_id, TITLE, message, "Alert", "incident", incidentId]);
      inserted += rows.length;
    }
    console.log(`${label}: inserted ${inserted} notification(s)`);
    return inserted;
  };

  const pass1 = await runPass("pass 1");
  const pass2 = await runPass("pass 2 (reload simulation)");

  if (recipients.length > 0 && pass1 !== recipients.length) {
    throw new Error(`pass 1 expected ${recipients.length} inserts, got ${pass1} (pre-existing rows?)`);
  }
  if (pass2 !== 0) throw new Error(`IDEMPOTENCY FAILED: pass 2 inserted ${pass2} duplicate notification(s)`);

  console.log("PASS: one escalation per overseer, zero duplicates on reload.");
} finally {
  if (incidentId != null) {
    const delNotifs = await pool.query(
      `DELETE FROM notifications WHERE title = $1 AND reference_type = 'incident' AND reference_id = $2 RETURNING notification_id`,
      [TITLE, incidentId]
    );
    const delIncident = await pool.query(
      `DELETE FROM driverincidents WHERE incident_id = $1 AND incident_type LIKE '[QA]%' RETURNING incident_id`,
      [incidentId]
    );
    console.log(`cleanup: removed ${delNotifs.rowCount} notification(s), ${delIncident.rowCount} [QA] incident`);
  }
  await pool.end();
}
