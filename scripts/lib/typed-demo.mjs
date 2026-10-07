// Explicitly supplied, isolated intake fixtures. No fleet identities or prices
// are created, and no compliance, capacity or odometer is changed.
export const DEMO_KEY = "seed:passenger-cargo-v1";
const SERVICES = {
  GUEST_TRANSPORT: ["PMS", "Passenger"], VIP_GUEST_TRANSPORT: ["PMS", "Passenger"],
  RESTAURANT_SUPPLY_PICKUP: ["POS", "Cargo"], RESTAURANT_FOOD_DELIVERY: ["POS", "Cargo"],
  HOTEL_SUPPLY_TRANSFER: ["POS", "Cargo"],
};
const numeric = value => ["number", "string"].includes(typeof value) && String(value).trim() !== "" && Number.isFinite(Number(value));
const COLUMNS = ["source_system", "external_request_id", "load_type", "passenger_count", "cargo_weight_kg", "cargo_description", "guest_name", "source_department", "pickup_location", "dropoff_location", "pickup_datetime"];

export function planTypedDemo(manifest) {
  if (manifest?.isolated !== true || !Array.isArray(manifest.requests) || !manifest.requests.length) {
    throw new Error("Supply an explicitly isolated manifest with requests.");
  }
  const identities = new Set();
  return manifest.requests.map(row => {
    const service = SERVICES[row.service_code];
    if (!service || row.source_system !== service[0] || row.load_type !== service[1]) throw new Error("Service, source and load type must match the canonical catalog.");
    for (const key of ["external_request_id", "pickup_location", "dropoff_location", "pickup_datetime"]) {
      if (typeof row[key] !== "string" || !row[key].trim()) throw new Error(`Missing ${key}.`);
    }
    const stamp = row.pickup_datetime;
    const calendar = new Date(`${stamp.slice(0, 10)}T00:00:00Z`);
    const [year, month, day] = stamp.slice(0, 10).split("-").map(Number);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(stamp)
      || !Number.isFinite(Date.parse(stamp)) || year < 1 || calendar.getUTCFullYear() !== year
      || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) throw new Error("Pickup needs a valid offset-qualified timestamp.");
    if (row.load_type === "Cargo") {
      if (!numeric(row.cargo_weight_kg) || Number(row.cargo_weight_kg) <= 0 || !row.cargo_description?.trim() || row.passenger_count != null || row.guest_name != null) throw new Error("Cargo needs declared weight/description and no passenger fields.");
    } else if (!numeric(row.passenger_count) || !Number.isInteger(Number(row.passenger_count)) || Number(row.passenger_count) <= 0 || row.cargo_weight_kg != null || row.cargo_description != null) {
      throw new Error("Passenger fixture needs a positive count and no cargo fields.");
    }
    const identity = JSON.stringify([row.source_system, row.external_request_id]);
    if (identities.has(identity)) throw new Error("Duplicate source identity.");
    identities.add(identity);
    return Object.fromEntries(["service_code", ...COLUMNS].filter(key => row[key] !== undefined).map(key => [key, row[key]]));
  });
}

export async function seedTypedDemo(db, manifest) {
  const requests = planTypedDemo(manifest);
  await db.query("BEGIN");
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [DEMO_KEY]);
    const existing = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = $1 FOR UPDATE", [DEMO_KEY]);
    if (existing.rows.length) throw new Error("Demo ledger exists; reverse it before another up.");
    const ids = [];
    for (const row of requests) {
      const { rows } = await db.query("SELECT service_type_id, service_code, default_load_type FROM service_types WHERE service_code = $1 AND status = 'Active' AND deleted_at IS NULL", [row.service_code]);
      if (rows.length !== 1 || rows[0].default_load_type !== row.load_type) throw new Error("Required migrated service catalog is missing or mismatched.");
      const values = [...COLUMNS.map(key => row[key] ?? null), rows[0].service_type_id, "Medium", DEMO_KEY];
      const result = await db.query(`INSERT INTO transportation_requests (${COLUMNS.join(",")}, service_type_id, priority, special_requests) VALUES (${values.map((_, index) => `$${index + 1}`).join(",")}) RETURNING request_id`, values);
      ids.push(result.rows[0].request_id);
    }
    const ledger = { version: 1, request_ids: ids };
    await db.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2::jsonb)", [DEMO_KEY, JSON.stringify(ledger)]);
    await db.query("COMMIT");
    return ledger;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

export async function removeTypedDemo(db) {
  await db.query("BEGIN");
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [DEMO_KEY]);
    const { rows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = $1 FOR UPDATE", [DEMO_KEY]);
    if (rows.length) {
      const ledger = rows[0].setting_value;
      if (ledger?.version !== 1 || !Array.isArray(ledger.request_ids) || !ledger.request_ids.every(id => Number.isSafeInteger(id) && id > 0)) throw new Error("Invalid demo ledger.");
      await db.query("SELECT request_id FROM transportation_requests WHERE request_id = ANY($1::int[]) FOR UPDATE", [ledger.request_ids]);
      const used = await db.query("SELECT dispatch_id FROM dispatchschedules WHERE request_id = ANY($1::int[])", [ledger.request_ids]);
      if (used.rows.length) throw new Error("A demo request has been used by dispatch; review its children before removal.");
      await db.query("DELETE FROM transportation_requests WHERE request_id = ANY($1::int[])", [ledger.request_ids]);
      await db.query("DELETE FROM system_settings WHERE setting_key = $1", [DEMO_KEY]);
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
