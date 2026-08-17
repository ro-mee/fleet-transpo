const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const migrationFile = process.argv[2];
if (!migrationFile) { console.error('usage: node apply_migration.js <file.sql>'); process.exit(1); }
const sql = fs.readFileSync(path.join(__dirname, migrationFile), 'utf8');

const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
let dbUrl = '';
for (const line of envFile.split('\n')) if (line.startsWith('DATABASE_URL=')) dbUrl = line.replace('DATABASE_URL=', '').trim();

const pool = new Pool({ connectionString: dbUrl });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied:', migrationFile);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration FAILED, rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  const trip = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'chk_trip_status'`
  );
  const disp = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'chk_dispatch_status'`
  );
  console.log('chk_trip_status:', trip.rows[0]?.def);
  console.log('chk_dispatch_status:', disp.rows[0]?.def);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); });