import pg from "pg";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, v) => p.query(t, v);

const col = await q("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='vehiclemaintenance' AND column_name='source_incident_id'");
const fk = await q("SELECT conname FROM pg_constraint WHERE conrelid='vehiclemaintenance'::regclass AND contype='f' AND conname LIKE '%incident%'");
const idx = await q("SELECT indexname FROM pg_indexes WHERE tablename='vehiclemaintenance' AND indexname='idx_vehiclemaintenance_source_incident'");
console.log("column:", col.rows[0] || "MISSING", "| fk:", fk.rows[0]?.conname || "MISSING", "| idx:", idx.rows[0]?.indexname || "MISSING");

const linked = await q("SELECT maintenance_id, source_incident_id FROM vehiclemaintenance WHERE source_incident_id IS NOT NULL");
console.log("backfilled links:", JSON.stringify(linked.rows));

// Exercise the resolver-context queries against real data.
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
        AND a.old_values->>'reason' = $2
      ORDER BY a.resource_id, a.created_at DESC`,
    [id, `Incident #${id} grounded the vehicle.`]
  );
  console.log(`incident #${id} affected dispatches:`, aff.rows.length, JSON.stringify(aff.rows));
}
await p.end();
