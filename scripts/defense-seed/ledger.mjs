import { SEED_KEY } from "./config.mjs";

// Table names and key columns are source-controlled identifiers, never user input.
export const KEYS = Object.freeze({
  vehiclecategories: "category_id", employees: "employee_id", drivers: "driver_id",
  vehicles: "vehicle_id", driver_vehicle_assignments: "assignment_id",
  driver_work_schedules: "schedule_id", driver_leave_balances: "balance_id",
  driver_leave_requests: "leave_request_id", locations: "location_id", routes: "route_id",
  transportation_requests: "request_id", dispatchschedules: "dispatch_id", trips: "trip_id",
  driverattendance: "attendance_id", vehicleinspection: "inspection_id",
  reservation_events: "event_id", notifications: "notification_id", push_outbox: "id",
  vehicledocuments: "document_id", fuelallocations: "allocation_id", fuelrequests: "fuel_request_id",
  fuelrecords: "fuel_record_id", vehiclemaintenance: "maintenance_id", driverincidents: "incident_id",
  expense_receipt_scans: "client_submission_id", expense_records: "id", company_cards: "id",
});

export const DELETE_ORDER = [
  "push_outbox", "notifications", "reservation_events", "expense_records", "expense_receipt_scans",
  "fuelrecords", "fuelrequests", "vehiclemaintenance", "driverincidents", "vehicleinspection",
  "driverattendance", "trips",
  "dispatchschedules", "transportation_requests", "driver_leave_requests", "driver_leave_balances",
  "driver_work_schedules", "driver_vehicle_assignments", "fuelallocations", "vehicledocuments",
  "routes", "locations", "vehicles", "company_cards",
  "drivers", "employees", "vehiclecategories",
];

export async function readLedger(db) {
  const { rows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1", [SEED_KEY]);
  return rows[0]?.setting_value ?? null;
}

export function remember(ledger, table, id, semanticKey) {
  if (!Object.hasOwn(KEYS, table)) throw new Error(`Untracked table ${table}`);
  ledger.ids[table] ??= [];
  ledger.ids[table].push(id);
  ledger.semantic[semanticKey] = { table, id };
}

export async function captureSnapshots(db, ledger) {
  ledger.snapshots = {};
  for (const [table, ids] of Object.entries(ledger.ids)) {
    if (!ids.length) continue;
    const key = KEYS[table];
    const { rows } = await db.query(`SELECT ${key} AS id, to_jsonb(t) AS snapshot FROM ${table} t WHERE ${key}::text=ANY($1::text[]) ORDER BY ${key}`, [ids.map(String)]);
    if (rows.length !== ids.length) throw new Error(`Snapshot incomplete: ${table}`);
    ledger.snapshots[table] = Object.fromEntries(rows.map((r) => [String(r.id), r.snapshot]));
  }
}

export async function checkSnapshots(db, ledger, { ignoreRuntimeTimestamps = false } = {}) {
  const problems = [];
  const normalized = (table, snapshot) => {
    if (!snapshot) return snapshot;
    if (!ignoreRuntimeTimestamps || !["drivers", "vehicles", "transportation_requests"].includes(table)) return snapshot;
    const stable = { ...snapshot };
    delete stable.updated_at;
    if (table === "transportation_requests") delete stable.derived_priority;
    return stable;
  };
  for (const [table, ids] of Object.entries(ledger.ids ?? {})) {
    if (!ids.length) continue;
    const key = KEYS[table];
    if (!key) { problems.push(`Unknown ledger table ${table}`); continue; }
    const { rows } = await db.query(`SELECT ${key} AS id, to_jsonb(t) AS snapshot FROM ${table} t WHERE ${key}::text=ANY($1::text[])`, [ids.map(String)]);
    const current = new Map(rows.map((r) => [String(r.id), JSON.stringify(normalized(table, r.snapshot))]));
    for (const id of ids) {
      if (!current.has(String(id))) problems.push(`${table} ${id} missing`);
      else if (current.get(String(id)) !== JSON.stringify(normalized(table, ledger.snapshots?.[table]?.[String(id)]))) problems.push(`${table} ${id} changed since seed`);
    }
  }
  return problems;
}

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

const RUNTIME_EVIDENCE_CHILDREN = new Set([
  "auth_rate_limits", "email_otp_challenges", "employee_mfa", "mfa_recovery_codes",
  "password_reset_tokens", "mobile_refresh_tokens", "web_sessions", "trusted_web_devices",
  "device_tokens", "notification_preferences",
]);

export async function checkExternalReferences(db, ledger) {
  const problems = [];
  const { rows: fks } = await db.query(`
    SELECT child.relname AS child_table, parent.relname AS parent_table,
           child_column.attname AS child_column, child_pk.attname AS child_pk
      FROM pg_constraint fk
      JOIN pg_class child ON child.oid=fk.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=fk.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
      JOIN pg_attribute child_column ON child_column.attrelid=child.oid AND child_column.attnum=fk.conkey[1]
      LEFT JOIN pg_index pk ON pk.indrelid=child.oid AND pk.indisprimary
      LEFT JOIN pg_attribute child_pk ON child_pk.attrelid=child.oid AND child_pk.attnum=pk.indkey[0]
     WHERE fk.contype='f' AND array_length(fk.conkey,1)=1 AND array_length(fk.confkey,1)=1
       AND child_ns.nspname='public' AND parent_ns.nspname='public'`);
  for (const fk of fks) {
    const parents = ledger.ids?.[fk.parent_table];
    if (!parents?.length) continue;
    if (fk.parent_table === "employees" && RUNTIME_EVIDENCE_CHILDREN.has(fk.child_table)) continue;
    const children = ledger.ids?.[fk.child_table] ?? [];
    const exclusion = children.length && fk.child_pk
      ? ` AND ${quote(fk.child_pk)}::text<>ALL($2::text[])` : "";
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM ${quote(fk.child_table)} WHERE ${quote(fk.child_column)}::text=ANY($1::text[])${exclusion}`,
      exclusion ? [parents.map(String), children.map(String)] : [parents.map(String)]
    );
    if (rows[0].count) problems.push(`${fk.child_table}.${fk.child_column} has ${rows[0].count} external references to owned ${fk.parent_table}`);
  }
  return problems;
}

export async function saveLedger(db, ledger) {
  await db.query("INSERT INTO system_settings (setting_key,setting_value) VALUES ($1,$2::jsonb)", [SEED_KEY, JSON.stringify(ledger)]);
}

export async function removeOwnedRows(db, ledger) {
  for (const table of DELETE_ORDER) {
    const ids = ledger.ids?.[table];
    if (!ids?.length) continue;
    const key = KEYS[table];
    const result = await db.query(`DELETE FROM ${table} WHERE ${key}::text=ANY($1::text[])`, [ids.map(String)]);
    if (result.rowCount !== ids.length) throw new Error(`Deletion count mismatch for ${table}`);
  }
  ledger.state = "media_cleanup";
  await db.query("UPDATE system_settings SET setting_value=$2::jsonb WHERE setting_key=$1", [SEED_KEY, JSON.stringify(ledger)]);
}
