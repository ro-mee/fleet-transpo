import { loadEnvLocal } from './scripts/load-env.mjs';
loadEnvLocal();
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const tripTime = '2026-09-01 07:00:00+08:00';
  const startOfMonth = '2026-08-01T00:00:00.000Z';
  const endOfMonth = '2026-08-31T23:59:59.999Z';

  const { rows } = await pool.query(`
    SELECT 
      $1::timestamptz >= $2::timestamptz AND $1::timestamptz <= $3::timestamptz AS is_in_august_utc
  `, [tripTime, startOfMonth, endOfMonth]);
  
  console.log(rows[0]);
  process.exit(0);
}
run();
