import { Client } from 'pg';
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
const dbUrl = envFile.match(/DATABASE_URL=(.*)/)[1];

const client = new Client({ connectionString: dbUrl });

async function run() {
  await client.connect();

  console.log("--- 5. Test Automatic SLA Breach ---");
  // Create an incident that is overdue
  const res1 = await client.query(`
    INSERT INTO driverincidents (driver_id, incident_type, status, due_at, client_submission_id)
    VALUES (1, 'Test', 'Open', NOW() - interval '1 hour', 'test-auto-sla-1')
    RETURNING incident_id, due_at, overdue_at
  `);
  const incidentId = res1.rows[0].incident_id;
  console.log("Created incident:", res1.rows[0]);

  // Run the processor manually for immediate testing
  await client.query('SELECT update_incident_sla_breaches();');

  const res2 = await client.query(`SELECT overdue_at FROM driverincidents WHERE incident_id = $1`, [incidentId]);
  console.log("After processing, overdue_at:", res2.rows[0].overdue_at);
  const firstOverdueAt = res2.rows[0].overdue_at;

  // Run the processor again to prove idempotency
  await client.query(`SELECT pg_sleep(1)`);
  await client.query('SELECT update_incident_sla_breaches();');
  const res3 = await client.query(`SELECT overdue_at FROM driverincidents WHERE incident_id = $1`, [incidentId]);
  console.log("After second processing, overdue_at:", res3.rows[0].overdue_at);
  console.log("Idempotent:", firstOverdueAt.getTime() === res3.rows[0].overdue_at.getTime());

  console.log("--- 6. Test Completed Incidents ---");
  // Create an incident that is Resolved but expired
  const res4 = await client.query(`
    INSERT INTO driverincidents (driver_id, incident_type, status, due_at, client_submission_id)
    VALUES (1, 'Test', 'Resolved', NOW() - interval '1 hour', 'test-auto-sla-2')
    RETURNING incident_id, due_at, overdue_at
  `);
  const incidentId2 = res4.rows[0].incident_id;
  console.log("Created resolved incident:", res4.rows[0]);

  await client.query('SELECT update_incident_sla_breaches();');
  const res5 = await client.query(`SELECT overdue_at FROM driverincidents WHERE incident_id = $1`, [incidentId2]);
  console.log("After processing resolved incident, overdue_at:", res5.rows[0].overdue_at);

  await client.end();
}
run().catch(console.error);
