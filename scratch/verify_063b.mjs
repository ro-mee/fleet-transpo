import pg from "pg";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, v) => p.query(t, v);
const inc = await q("SELECT incident_id FROM driverincidents WHERE deleted_at IS NULL ORDER BY incident_id DESC LIMIT 1");
if (inc.rows[0]) {
  const id = inc.rows[0].incident_id;
  const aff = await q(
    `SELECT DISTINCT ON (a.resource_id)
            a.resource_id AS dispatch_id, ds.dispatch_number, ds.status AS dispatch_status,
            r.guest_name, a.created_at AS interrupted_at
       FROM audit_logs a
       JOIN dispatchschedules ds ON ds.dispatch_id = a.resource_id AND ds.deleted_at IS NULL
       LEFT JOIN transportation_requests r ON r.request_id = ds.request_id
      WHERE a.resource = 'dispatchschedules'
        AND a.old_values->>'reason' = $1
      ORDER BY a.resource_id, a.created_at DESC`,
    [`Incident #${id} grounded the vehicle.`]
  );
  console.log(`incident #${id} affected dispatches:`, aff.rows.length);
}
// Any historical grounding reasons at all? (shows the matcher will hit real data)
const hist = await q(`SELECT resource_id, old_values->>'reason' AS reason FROM audit_logs WHERE resource='dispatchschedules' AND old_values->>'reason' LIKE 'Incident #%grounded%' ORDER BY created_at DESC LIMIT 5`);
console.log("historical grounding entries:", JSON.stringify(hist.rows));
await p.end();
