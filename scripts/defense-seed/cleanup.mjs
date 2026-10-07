import { createHash } from "node:crypto";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { BUSINESS_TABLES, readDefenseBaseline } from "./baseline.mjs";

// Only these old phase4 ledger entities are operational data. Its service
// types, channels, preferences, and odometer values are shared configuration.
const PHASE4_TABLES = {
  driverattendance: "attendance_id", vehicleinspection: "inspection_id",
  vehiclemaintenance: "maintenance_id", ai_insights: "insight_id",
  ai_recommendations: "recommendation_id", fuelrecords: "fuel_record_id",
  driverincidents: "incident_id", uvvrp_violations: "violation_id",
  trips: "trip_id", dispatchschedules: "dispatch_id",
  transportation_requests: "request_id",
};
const KEYS = {
  ...PHASE4_TABLES, reservation_events: "event_id", recommendation_snapshots: "snapshot_id",
  gpstracking: "tracking_id", trip_monitor_alerts: "alert_id",
  fuelrequests: "fuel_request_id", expense_records: "id",
  incident_comments: "comment_id", notifications: "notification_id", push_outbox: "id",
  driver_leave_requests: "leave_request_id", driver_leave_balances: "balance_id",
  driver_work_schedules: "schedule_id", substitute_vehicle_schedules: "substitute_id",
  driver_vehicle_assignments: "assignment_id", fuelallocations: "allocation_id",
  expense_receipt_scans: "client_submission_id", company_card_assignments: "id",
  vehicledocuments: "document_id", drivers: "driver_id", vehicles: "vehicle_id",
};
const QA_CHILDREN = new Set([
  "reservation_events", "recommendation_snapshots", "dispatchschedules", "trips",
  "gpstracking", "trip_monitor_alerts", "uvvrp_violations", "fuelrecords",
  "fuelrequests", "vehicleinspection", "driverincidents", "incident_comments",
  "vehiclemaintenance", "expense_records",
]);
const REPORT_TABLES = [
  "transportation_requests", "dispatchschedules", "trips", "driverattendance",
  "vehicleinspection", "fuelrecords", "fuelrequests", "vehiclemaintenance",
  "driverincidents", "expense_records", "gpstracking", "trip_monitor_alerts",
];
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const idsOf = (sets, table) => [...(sets.get(table) ?? new Set())].sort((a, b) => Number(a) - Number(b));
const add = (sets, table, ids) => {
  if (!KEYS[table]) throw new Error(`Unlisted cleanup table ${table}`);
  const set = sets.get(table) ?? new Set();
  const before = set.size;
  for (const id of ids) set.add(String(id));
  sets.set(table, set);
  return set.size !== before;
};

async function catalog(db) {
  const { rows } = await db.query(`
    SELECT child.relname AS child_table, parent.relname AS parent_table,
           child_col.attname AS child_column, parent_col.attname AS parent_column,
           child_pk_col.attname AS child_pk
      FROM pg_constraint fk
      JOIN pg_class child ON child.oid=fk.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=fk.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
      JOIN pg_attribute child_col ON child_col.attrelid=child.oid AND child_col.attnum=fk.conkey[1]
      JOIN pg_attribute parent_col ON parent_col.attrelid=parent.oid AND parent_col.attnum=fk.confkey[1]
      LEFT JOIN pg_index child_pk ON child_pk.indrelid=child.oid AND child_pk.indisprimary
      LEFT JOIN pg_attribute child_pk_col ON child_pk_col.attrelid=child.oid AND
           child_pk_col.attnum=child_pk.indkey[0] AND array_length(child_pk.indkey,1)=1
     WHERE fk.contype='f' AND array_length(fk.conkey,1)=1 AND array_length(fk.confkey,1)=1
       AND child_ns.nspname='public' AND parent_ns.nspname='public'
     ORDER BY parent.relname,child.relname,child_col.attname`);
  return rows;
}

async function buildPlan(db) {
  const { rows: defense } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key='seed:defense-2026-10'");
  const defenseOwned = new Map(Object.entries(defense[0]?.setting_value?.ids ?? {})
    .map(([table, ids]) => [table, new Set(ids.map(String))]));
  const { rows: phase4Rows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key='seed:phase4'");
  const ledger = phase4Rows[0]?.setting_value;
  const sets = new Map();
  const provenance = {};
  const note = (table, reason, ids) => {
    if (!ids.length) return;
    add(sets, table, ids);
    provenance[table] ??= {};
    provenance[table][reason] = ids.map(String).sort((a, b) => Number(a) - Number(b));
  };
  for (const [table, key] of Object.entries(PHASE4_TABLES)) {
    const ids = ledger?.ids?.[table] ?? [];
    if (!ids.length) continue;
    const { rows } = await db.query(`SELECT ${quote(key)} AS id FROM ${quote(table)} WHERE ${quote(key)}::text=ANY($1::text[])`, [ids.map(String)]);
    note(table, "seed:phase4 ledger", rows.map((r) => r.id));
  }
  const { rows: qaRequests } = await db.query(`
    SELECT request_id FROM transportation_requests
     WHERE external_booking_id LIKE 'QA-%' OR external_booking_id LIKE 'BK-QA-%'
        OR reservation_number IN ('RS-DEMO-RESTO','RS-DEMO-PR4')
     ORDER BY request_id`);
  const qaRoot = new Map();
  note("transportation_requests", "explicit QA or temporary-seed booking marker", qaRequests.map((r) => r.request_id));
  qaRoot.set("transportation_requests", new Set(qaRequests.map((r) => String(r.request_id))));
  // Explicit user approval covers all pre-defense business rows. Privacy
  // consents and UVVRP exemptions are protected evidence/configuration, so
  // their driver/vehicle parents are retired (soft-deleted) instead.
  const { rows: consentDrivers } = await db.query("SELECT DISTINCT driver_id AS id FROM driver_consents ORDER BY driver_id");
  const { rows: exemptVehicles } = await db.query("SELECT DISTINCT vehicle_id AS id FROM uvvrp_exemptions ORDER BY vehicle_id");
  const { rows: linkedVehicles } = await db.query("SELECT DISTINCT location_vehicle_id AS id FROM drivers WHERE driver_id::text=ANY($1::text[]) AND location_vehicle_id IS NOT NULL ORDER BY location_vehicle_id", [consentDrivers.map((r) => String(r.id))]);
  const retained = {
    drivers: new Set(consentDrivers.map((r) => String(r.id))),
    vehicles: new Set([...exemptVehicles, ...linkedVehicles].map((r) => String(r.id))),
  };
  const softDeleteIds = {};
  for (const table of BUSINESS_TABLES) {
    const key = KEYS[table];
    const deletedColumn = ["drivers", "vehicles"].includes(table) ? ",deleted_at" : "";
    const { rows } = await db.query(`SELECT ${quote(key)} AS id${deletedColumn} FROM ${quote(table)} ORDER BY ${quote(key)}`);
    const protectedIds = retained[table] ?? new Set();
    note(table, "user-approved pre-defense business reset", rows.map((r) => r.id).filter((id) =>
      !protectedIds.has(String(id)) && !defenseOwned.get(table)?.has(String(id))));
    if (protectedIds.size) softDeleteIds[table] = rows.filter((r) =>
      protectedIds.has(String(r.id)) && !defenseOwned.get(table)?.has(String(r.id)) && !r.deleted_at).map((r) => String(r.id));
  }
  const fks = await catalog(db);
  const detachedFk = (fk) => fk.child_table === "vehiclemaintenance" &&
    ["source_incident_id", "source_inspection_id"].includes(fk.child_column);
  // Follow only exact FK descendants of explicitly marked QA bookings.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const fk of fks) {
      if (!QA_CHILDREN.has(fk.child_table) || !KEYS[fk.child_table] || !qaRoot.get(fk.parent_table)?.size) continue;
      const parentIds = [...qaRoot.get(fk.parent_table)];
      const { rows } = await db.query(`SELECT ${quote(KEYS[fk.child_table])} AS id FROM ${quote(fk.child_table)} WHERE ${quote(fk.child_column)}::text=ANY($1::text[])`, [parentIds]);
      const childIds = rows.map((r) => r.id);
      if (childIds.length) {
        note(fk.child_table, `FK ${fk.child_column} to marked QA ${fk.parent_table}`, childIds);
        if (add(qaRoot, fk.child_table, childIds)) expanded = true;
      }
    }
  }
  for (const [type, table] of [["dispatch", "dispatchschedules"], ["trip", "trips"], ["maintenance", "vehiclemaintenance"]]) {
    const ids = idsOf(sets, table);
    if (!ids.length) continue;
    const { rows } = await db.query("SELECT notification_id AS id FROM notifications WHERE reference_type=$1 AND reference_id::text=ANY($2::text[])", [type, ids]);
    note("notifications", `typed ${type} reference to owned ID`, rows.map((r) => r.id));
    if (type === "dispatch") {
      const { rows: pushes } = await db.query("SELECT id FROM push_outbox WHERE reference_type='dispatch' AND reference_id::text=ANY($1::text[])", [ids]);
      note("push_outbox", "typed dispatch reference to owned ID", pushes.map((r) => r.id));
    }
  }
  const blockers = [];
  if (defense.length) blockers.push("Defense ledger still exists; roll it back first");
  for (const fk of fks) {
    const parentIds = idsOf(sets, fk.parent_table);
    if (!parentIds.length) continue;
    if (detachedFk(fk)) continue;
    if (!fk.child_pk) { blockers.push(`${fk.child_table} has no single-column PK for FK review`); continue; }
    const { rows } = await db.query(`SELECT ${quote(fk.child_pk)} AS id FROM ${quote(fk.child_table)} WHERE ${quote(fk.child_column)}::text=ANY($1::text[])`, [parentIds]);
    const childSet = sets.get(fk.child_table) ?? new Set();
    const outside = rows.map((r) => String(r.id)).filter((id) => !childSet.has(id));
    if (outside.length) blockers.push(`${fk.child_table}.${fk.child_column} references owned ${fk.parent_table}: ${outside.join(",")}`);
  }
  const tables = [...sets.keys()].filter((table) => idsOf(sets, table).length).sort();
  const order = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter((table) => !fks.some((fk) =>
      !detachedFk(fk) && fk.parent_table === table && remaining.has(fk.child_table) && fk.child_table !== table)).sort();
    if (!ready.length) { blockers.push(`FK cycle among cleanup tables: ${[...remaining].join(",")}`); break; }
    for (const table of ready) { order.push(table); remaining.delete(table); }
  }
  const snapshots = {};
  for (const table of tables) {
    const key = KEYS[table];
    const { rows } = await db.query(`SELECT ${quote(key)} AS id,to_jsonb(t) AS snapshot FROM ${quote(table)} t WHERE ${quote(key)}::text=ANY($1::text[]) ORDER BY ${quote(key)}`, [idsOf(sets, table)]);
    if (rows.length !== idsOf(sets, table).length) blockers.push(`${table} candidate disappeared during plan`);
    snapshots[table] = rows;
  }
  const deleteIds = Object.fromEntries(tables.map((table) => [table, idsOf(sets, table)]));
  const softDeleteSnapshots = {};
  for (const [table, ids] of Object.entries(softDeleteIds)) {
    const { rows } = await db.query(`SELECT ${quote(KEYS[table])} AS id,to_jsonb(t) AS snapshot FROM ${quote(table)} t WHERE ${quote(KEYS[table])}::text=ANY($1::text[]) ORDER BY ${quote(KEYS[table])}`, [ids]);
    softDeleteSnapshots[table] = rows;
  }
  const digest = createHash("sha256").update(JSON.stringify({ deleteIds, snapshots, softDeleteIds, softDeleteSnapshots,
    detachBeforeDelete: ["vehiclemaintenance.source_incident_id", "vehiclemaintenance.source_inspection_id"], fks, order })).digest("hex").slice(0, 16);
  const remainingOperational = {};
  for (const table of REPORT_TABLES) {
    const key = KEYS[table];
    const { rows } = await db.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE ${quote(key)}::text<>ALL($1::text[]))::int AS outside_plan FROM ${quote(table)}`, [idsOf(sets, table)]);
    remainingOperational[table] = rows[0];
  }
  const baseline = await readDefenseBaseline(db);
  const afterProvableCleanup = Object.fromEntries(Object.entries(baseline.counts)
    .map(([table, count]) => [table, ["drivers", "vehicles"].includes(table) ?
      count - (softDeleteIds[table]?.length ?? 0) - idsOf(sets, table).filter((id) =>
        snapshots[table]?.some((r) => String(r.id) === id && !r.snapshot.deleted_at)).length :
      count - idsOf(sets, table).length]));
  const protectedCounts = {};
  for (const [name, sql] of Object.entries({
    roles: "SELECT COUNT(*)::int AS n FROM roles",
    superAdmins: "SELECT COUNT(*)::int AS n FROM employees e JOIN roles r ON r.role_id=e.role_id WHERE r.role_name='super_admin' AND e.deleted_at IS NULL",
    systemSettings: "SELECT COUNT(*)::int AS n FROM system_settings",
    regions: "SELECT COUNT(*)::int AS n FROM ph_regions",
    provinces: "SELECT COUNT(*)::int AS n FROM ph_provinces",
    cities: "SELECT COUNT(*)::int AS n FROM ph_cities",
    barangays: "SELECT COUNT(*)::int AS n FROM ph_barangays",
    postalCodes: "SELECT COUNT(*)::int AS n FROM phlpost_postal_codes",
    aiProviders: "SELECT COUNT(*)::int AS n FROM aiproviders",
    migrations: "SELECT COUNT(*)::int AS n FROM schema_migrations",
  })) protectedCounts[name] = (await db.query(sql)).rows[0].n;
  const { rows: storageRows } = await db.query("SELECT bucket_id,COUNT(*)::int AS objects FROM storage.objects GROUP BY bucket_id ORDER BY bucket_id");
  return { readOnly: true, digest, deleteIds, softDeleteIds, provenance, fkDeleteOrder: order,
    detachBeforeDelete: { vehiclemaintenance: ["source_incident_id", "source_inspection_id"] },
    blockers, remainingOperational,
    baseline: { current: baseline.counts, afterProvableCleanup,
      cleanAfterProvableCleanup: Object.values(afterProvableCleanup).every((count) => count === 0) },
    protectedCounts, storage: { deleteKeys: [], existing: storageRows,
      note: "No old seed-owned Storage manifest or explicit object-key marker was found; preserve all existing objects." } };
}

loadEnvLocal();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const project = "dnxuphhxlzidvwtdqqkq";
const database = new URL(process.env.DATABASE_URL);
const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (database.pathname !== "/postgres" || database.username.split(".").at(-1) !== project ||
    storage.hostname !== `${project}.supabase.co`) throw new Error("Cleanup target is not the configured FleetOps Supabase project");
const command = process.argv[2] ?? "plan";
if (!["plan", "apply"].includes(command)) throw new Error("Use plan or apply");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await db.connect();
try {
  await client.query(command === "plan" ? "BEGIN READ ONLY" : "BEGIN");
  if (command === "apply") await client.query("SELECT pg_advisory_xact_lock(hashtext('seed:defense-cleanup'))");
  const plan = await buildPlan(client);
  if (command === "plan") {
    console.log(JSON.stringify(plan, null, 2));
    await client.query("ROLLBACK");
  } else {
    if (!process.argv.includes(`--apply=${plan.digest}`)) throw new Error(`Cleanup requires current --apply=${plan.digest}`);
    if (plan.blockers.length) throw new Error(`Cleanup blocked: ${plan.blockers.join("; ")}`);
    if (plan.deleteIds.vehiclemaintenance?.length) {
      await client.query("UPDATE vehiclemaintenance SET source_incident_id=NULL,source_inspection_id=NULL WHERE maintenance_id::text=ANY($1::text[])", [plan.deleteIds.vehiclemaintenance]);
    }
    const deleted = {};
    for (const table of plan.fkDeleteOrder) {
      const ids = plan.deleteIds[table];
      const result = await client.query(`DELETE FROM ${quote(table)} WHERE ${quote(KEYS[table])}::text=ANY($1::text[])`, [ids]);
      if (result.rowCount !== ids.length) throw new Error(`${table} deletion count changed`);
      deleted[table] = result.rowCount;
    }
    const retired = {};
    for (const [table, ids] of Object.entries(plan.softDeleteIds)) {
      if (!ids.length) continue;
      const result = await client.query(`UPDATE ${quote(table)} SET deleted_at=NOW() WHERE ${quote(KEYS[table])}::text=ANY($1::text[]) AND deleted_at IS NULL`, [ids]);
      if (result.rowCount !== ids.length) throw new Error(`${table} retirement count changed`);
      retired[table] = result.rowCount;
    }
    const baselineAfter = await readDefenseBaseline(client);
    if (!baselineAfter.clean) throw new Error(`Cleanup did not yield a clean business baseline: ${baselineAfter.blockers.join("; ")}`);
    await client.query("COMMIT");
    console.log(JSON.stringify({ state: "cleaned-old-business-rows", digest: plan.digest, deleted, retired,
      unresolvedOutsidePlan: plan.remainingOperational, protectedBefore: plan.protectedCounts }, null, 2));
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await db.end();
}
