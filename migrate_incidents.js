const { Client } = require('pg');
const fs = require('fs');

async function run() {
  const envFile = fs.readFileSync('.env.local', 'utf8');
  let dbUrl = '';
  envFile.split('\n').forEach(line => {
    if (line.startsWith('DATABASE_URL=')) dbUrl = line.split('=')[1].trim();
  });

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE driverincidents
      ADD COLUMN IF NOT EXISTS assistance_needed text[];
    `);
    await client.query('COMMIT');
    console.log("Migration successful.");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Migration failed", err);
  } finally {
    await client.end();
  }
}
run();
