/**
 * One-off janitor for stale [QA e2e] rows: earlier harness runs
 * (verify_incident_response / verify_responder_tracking /
 * verify_responder_navigation) each clean up their own rows, but a run
 * interrupted before cleanup (Ctrl+C, crash) leaves its seeded incident
 * behind — where it shows up in the staff incidents registry as
 * "[QA] Vehicle breakdown". This lists what it finds, then removes every
 * incident whose description starts with "[QA e2e]" plus the full linked
 * chain: incident comments, audit rows, notifications, and the automatic
 * maintenance work orders (vehiclemaintenance rows linked via
 * source_incident_id / maintenance_id — the FK is circular, so the
 * incident's maintenance_id is nulled first). Runs in one transaction:
 * either the whole chain goes or nothing does.
 *
 * Usage:  node --env-file=.env scratch/cleanup_qa_incidents.mjs
 */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  const stale = await pool.query(
    `SELECT incident_id, incident_type, severity, status, description, incident_date
       FROM driverincidents
      WHERE description ~ '^\\[QA e2e\\]'
      ORDER BY incident_id`
  );

  if (stale.rows.length === 0) {
    console.log("No [QA e2e] incidents found — nothing to clean.");
  } else {
    console.log(`Found ${stale.rows.length} stale [QA e2e] incident(s):`);
    for (const row of stale.rows) {
      console.log(
        `  #${row.incident_id}  ${row.incident_date.toISOString().slice(0, 16).replace("T", " ")}  ` +
          `${row.severity}/${row.status}  ${row.description}`
      );
    }

    const ids = stale.rows.map((row) => row.incident_id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Work orders linked to these incidents (either direction of the
      // circular FK), plus the vehicles they grounded — captured before
      // deletion so stuck vehicles can be reported afterwards.
      const orders = await client.query(
        `SELECT vm.maintenance_id, vm.vehicle_id
           FROM vehiclemaintenance vm
          WHERE vm.source_incident_id = ANY($1::int[])
          UNION
         SELECT vm.maintenance_id, vm.vehicle_id
           FROM vehiclemaintenance vm
           JOIN driverincidents i ON i.maintenance_id = vm.maintenance_id
          WHERE i.incident_id = ANY($1::int[])`,
        [ids]
      );
      const orderIds = orders.rows.map((row) => row.maintenance_id);
      const vehicleIds = [...new Set(orders.rows.map((row) => row.vehicle_id).filter((id) => id != null))];

      // Break the circular FK, then remove the work orders (with their own
      // audit rows and notifications) before the incidents themselves.
      await client.query(`UPDATE driverincidents SET maintenance_id = NULL WHERE incident_id = ANY($1::int[])`, [ids]);
      let deletedOrders = 0;
      let deletedOrderAudit = 0;
      let deletedOrderNotifications = 0;
      if (orderIds.length > 0) {
        deletedOrderAudit = (
          await client.query(`DELETE FROM audit_logs WHERE resource = 'vehiclemaintenance' AND resource_id = ANY($1::int[])`, [orderIds])
        ).rowCount;
        deletedOrderNotifications = (
          await client.query(`DELETE FROM notifications WHERE reference_type = 'maintenance' AND reference_id = ANY($1::int[])`, [orderIds])
        ).rowCount;
        deletedOrders = (
          await client.query(
            `DELETE FROM vehiclemaintenance WHERE maintenance_id = ANY($1::int[]) OR source_incident_id = ANY($2::int[])`,
            [orderIds, ids]
          )
        ).rowCount;
      }

      const comments = await client.query(`DELETE FROM incident_comments WHERE incident_id = ANY($1::int[])`, [ids]);
      const audit = await client.query(
        `DELETE FROM audit_logs WHERE resource = 'driverincidents' AND resource_id = ANY($1::int[])`,
        [ids]
      );
      const notifications = await client.query(
        `DELETE FROM notifications WHERE reference_type = 'incident' AND reference_id = ANY($1::int[])`,
        [ids]
      );
      const incidents = await client.query(`DELETE FROM driverincidents WHERE incident_id = ANY($1::int[])`, [ids]);

      // A grounded vehicle whose QA work order is now gone and whose incident
      // is resolved should not stay Under Maintenance — report any that do.
      let stuck = [];
      if (vehicleIds.length > 0) {
        stuck = (
          await client.query(
            `SELECT vehicle_id, plate_number, vehicle_status FROM vehicles WHERE vehicle_id = ANY($1::int[]) AND vehicle_status = 'Under Maintenance'`,
            [vehicleIds]
          )
        ).rows;
      }

      await client.query("COMMIT");

      console.log(
        `Deleted: ${incidents.rowCount} incident(s), ${comments.rowCount} comment(s), ` +
          `${audit.rowCount + deletedOrderAudit} audit row(s), ` +
          `${notifications.rowCount + deletedOrderNotifications} notification(s), ` +
          `${deletedOrders} maintenance work order(s).`
      );
      if (stuck.length > 0) {
        console.log(
          `WARNING: ${stuck.length} vehicle(s) grounded by these QA runs are still Under Maintenance ` +
            `(their release depended on the deleted work orders):`
        );
        for (const vehicle of stuck) {
          console.log(`  vehicle #${vehicle.vehicle_id} (${vehicle.plate_number}) — needs manual status review`);
        }
      }
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  const left = await pool.query(`SELECT count(*)::int AS n FROM driverincidents WHERE description ~ '^\\[QA e2e\\]'`);
  console.log(`incidents-left=${left.rows[0].n}`);
} catch (e) {
  console.error("CLEANUP FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
