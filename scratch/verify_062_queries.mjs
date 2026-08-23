import pg from "pg";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, v) => p.query(t, v);

// 1. Admin registry query (src/app/api/incidents/route.js) unchanged shape.
const admin = await q(`SELECT i.incident_id,
       COALESCE(i.vehicle_id, a.vehicle_id) as vehicle_id,
       i.trip_id, i.incident_type, i.incident_date,
       i.description, i.location, i.latitude, i.longitude, i.severity, i.status,
       i.actions_taken, i.created_at, i.assistance_needed, i.expense_amount
  FROM driverincidents i
  LEFT JOIN driver_vehicle_assignments a ON a.driver_id = i.driver_id AND a.assigned_until IS NULL
 WHERE i.deleted_at IS NULL LIMIT 3`);
console.log("admin GET ok:", admin.rows.length, "rows");

// 2. Mobile submissions query incl. new actions_taken column.
const sub = await q(`SELECT i.incident_id as id, i.incident_type as type, i.incident_date as date,
       i.status, i.severity, i.description, i.actions_taken, i.created_at, v.plate_number
  FROM driverincidents i LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
 WHERE i.driver_id = (SELECT driver_id FROM driverincidents LIMIT 1)
 ORDER BY i.incident_date DESC LIMIT 5`);
console.log("mobile submissions ok:", sub.rows.length, "rows, actions_taken selected:", "actions_taken" in (sub.rows[0] || {}));

// 3. Idempotent insert path: same client_submission_id twice must yield ONE row.
await q("BEGIN");
try {
  const drv = await q("SELECT driver_id FROM driverincidents WHERE deleted_at IS NULL ORDER BY incident_id DESC LIMIT 1");
  const ref = `${Date.now()}-rehearsal0000000`;
  const ins = `INSERT INTO driverincidents
     (driver_id, incident_type, description, severity, status, client_submission_id)
   VALUES ($1, 'breakdown', 'rehearsal', 'Minor', 'Open', $2)
   ON CONFLICT (driver_id, client_submission_id) WHERE deleted_at IS NULL AND client_submission_id IS NOT NULL
   DO NOTHING RETURNING incident_id`;
  const first = await q(ins, [drv.rows[0].driver_id, ref]);
  const second = await q(ins, [drv.rows[0].driver_id, ref]);
  const dupes = await q("SELECT count(*)::int AS n FROM driverincidents WHERE client_submission_id = $1", [ref]);
  console.log("insert#1 returned:", first.rows.length, "| insert#2 (replay) returned:", second.rows.length, "| rows stored:", dupes.rows[0].n);
} finally {
  await q("ROLLBACK");
}
console.log("rolled back — nothing persisted");

// 4. Constraint rejects out-of-vocabulary statuses.
try {
  await q("BEGIN");
  await q("INSERT INTO driverincidents (driver_id, incident_type, status) SELECT driver_id, 'x', 'Pending' FROM driverincidents LIMIT 1");
  console.log("constraint NOT enforced (BAD)");
  await q("ROLLBACK");
} catch (e) {
  await q("ROLLBACK").catch(() => {});
  console.log("constraint rejects stray status:", e.message.slice(0, 60));
}

await p.end();
