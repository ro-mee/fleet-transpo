import pg from "pg";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t) => p.query(t);
const col = await q("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='driverincidents' AND column_name='client_submission_id'");
const idx = await q("SELECT indexname FROM pg_indexes WHERE tablename='driverincidents' AND indexname='uq_driverincidents_driver_submission'");
const con = await q("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='driverincidents'::regclass AND conname='chk_driverincidents_status'");
const st = await q("SELECT status, count(*)::int AS n FROM driverincidents GROUP BY status ORDER BY n DESC");
console.log(JSON.stringify({ column: col.rows, index: idx.rows, constraint: con.rows, statuses: st.rows }, null, 2));
await p.end();
