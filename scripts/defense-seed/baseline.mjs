// Business tables whose pre-seed rows can alter defense rosters, availability,
// dashboards, reports, history, or recommendations. Reference and security
// tables are deliberately excluded from this gate and preserved by cleanup.
export const BUSINESS_TABLES = Object.freeze([
  "transportation_requests", "reservation_events", "dispatchschedules", "trips",
  "driverattendance", "vehicleinspection", "driver_leave_requests",
  "driver_leave_balances", "driver_work_schedules", "substitute_vehicle_schedules",
  "driver_vehicle_assignments", "fuelrequests", "fuelallocations", "fuelrecords",
  "vehiclemaintenance", "incident_comments", "driverincidents",
  "expense_receipt_scans", "expense_records", "company_card_assignments",
  "vehicledocuments", "drivers", "vehicles", "gpstracking",
  "trip_monitor_alerts", "uvvrp_violations",
]);

export async function readDefenseBaseline(db) {
  const { rows } = await db.query(`SELECT ${BUSINESS_TABLES.map((table) =>
    `(SELECT COUNT(*)::int FROM "${table}"${["drivers", "vehicles"].includes(table) ? " WHERE deleted_at IS NULL" : ""}) AS "${table}"`).join(", ")}`);
  const counts = rows[0];
  return {
    clean: Object.values(counts).every((count) => count === 0),
    counts,
    blockers: Object.entries(counts).filter(([, count]) => count > 0)
      .map(([table, count]) => `${table}: ${count} existing rows`),
  };
}
