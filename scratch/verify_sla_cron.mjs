// Read-only verification of the incident SLA machinery on the live DB:
//   1. Is the migration-099 pg_cron job actually scheduled and active?
//   2. Has it been running (job_run_details), and succeeding?
//   3. Do overdue_at stamps track due_at on currently-overdue incidents?
// No writes anywhere. Same env-loader channel as the migration runner.
import pg from "pg";
import { loadEnvLocal } from "../scripts/load-env.mjs";

loadEnvLocal();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  const jobs = await pool.query(
    `SELECT jobid, jobname, schedule, active, command
       FROM cron.job
      WHERE command ILIKE '%incident%'`
  );
  if (!jobs.rows.length) {
    console.log("cron.job: NO incident job scheduled — migration 099's schedule is not live.");
  } else {
    for (const j of jobs.rows) {
      console.log(`cron.job #${j.jobid} "${j.jobname}" schedule=${j.schedule} active=${j.active}`);
      const runs = await pool.query(
        `SELECT status, return_message, start_time
           FROM cron.job_run_details
          WHERE jobid = $1
          ORDER BY runid DESC
          LIMIT 5`,
        [j.jobid]
      );
      if (!runs.rows.length) console.log("  runs: none recorded yet");
      for (const r of runs.rows) {
        console.log(`  ${r.start_time?.toISOString?.() || r.start_time} ${r.status} ${r.return_message || ""}`);
      }
    }
  }

  const overdue = await pool.query(
    `SELECT incident_id, severity, acknowledged_at, due_at, overdue_at
       FROM driverincidents
      WHERE status = 'Open' AND due_at IS NOT NULL AND due_at < NOW() AND deleted_at IS NULL
      ORDER BY due_at
      LIMIT 10`
  );
  if (!overdue.rows.length) {
    console.log("overdue: no currently-overdue open incidents (nothing to cross-check).");
  } else {
    for (const i of overdue.rows) {
      const stamped = i.overdue_at ? "stamped" : "NOT stamped";
      console.log(
        `incident #${i.incident_id} sev=${i.severity} ack=${i.acknowledged_at ? "yes" : "NO"} ` +
        `due=${i.due_at?.toISOString?.() || i.due_at} overdue_at=${stamped}`
      );
    }
  }
} finally {
  await pool.end();
}
