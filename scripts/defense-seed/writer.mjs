import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { GUEST, MARK, SEED_KEY, VIP } from "./config.mjs";
import { captureSnapshots, remember, saveLedger } from "./ledger.mjs";
import { mediaById, publicMediaUrl, storedMediaRef } from "./media.mjs";

function accountsFromEnvironment(plan) {
  let values;
  try { values = JSON.parse(process.env.DEFENSE_DEMO_ACCOUNTS_JSON ?? "null"); }
  catch { throw new Error("DEFENSE_DEMO_ACCOUNTS_JSON is not valid JSON"); }
  if (!values || typeof values !== "object") throw new Error("Set DEFENSE_DEMO_ACCOUNTS_JSON to 10 controlled {email,password} entries before up");
  const addresses = [];
  for (const driver of plan.drivers) {
    const account = values[driver.key];
    if (!account || typeof account.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) ||
        typeof account.password !== "string" || account.password.length < 12) {
      throw new Error(`Controlled email and unique 12+ character password required for ${driver.key}`);
    }
    addresses.push(account.email.toLowerCase());
  }
  if (new Set(addresses).size !== addresses.length) throw new Error("Demo email addresses must be distinct");
  if (new Set(plan.drivers.map((d) => values[d.key].password)).size !== plan.drivers.length) throw new Error("Demo passwords must be distinct");
  return values;
}

async function insert(db, ledger, table, semanticKey, values) {
  const columns = Object.keys(values);
  const params = Object.values(values);
  const key = {
    vehiclecategories: "category_id", employees: "employee_id", drivers: "driver_id", vehicles: "vehicle_id",
    driver_vehicle_assignments: "assignment_id", driver_work_schedules: "schedule_id", driver_leave_balances: "balance_id",
    driver_leave_requests: "leave_request_id", locations: "location_id", routes: "route_id",
    transportation_requests: "request_id", dispatchschedules: "dispatch_id", trips: "trip_id",
    driverattendance: "attendance_id", vehicleinspection: "inspection_id", reservation_events: "event_id",
    vehicledocuments: "document_id", fuelallocations: "allocation_id", fuelrequests: "fuel_request_id",
    fuelrecords: "fuel_record_id", vehiclemaintenance: "maintenance_id", driverincidents: "incident_id",
    expense_receipt_scans: "client_submission_id", expense_records: "id", company_cards: "id",
  }[table];
  if (!key) throw new Error(`Unlisted insert table ${table}`);
  const holes = params.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await db.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${holes}) RETURNING ${key}`, params);
  const id = rows[0][key];
  remember(ledger, table, id, semanticKey);
  return id;
}

const localDate = (stamp) => stamp.slice(0, 10);
const at = (day, hour) => `${day}T${String(hour).padStart(2, "0")}:00:00+08:00`;
const before = (stamp, minutes) => new Date(Date.parse(stamp) - minutes * 60_000).toISOString();
const stableUuid = (key) => {
  const h = createHash("sha256").update(`${SEED_KEY}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export async function writeDefenseSeed(db, plan, assets) {
  const accounts = accountsFromEnvironment(plan);
  // PostgreSQL trigger defaults use transaction_timestamp(), which can precede
  // the JavaScript clock after BEGIN by a few milliseconds.
  const { rows: transactionRows } = await db.query("SELECT transaction_timestamp() AS started_at");
  const plantedAt = transactionRows[0].started_at;
  const media = mediaById(assets);
  const asset = (key) => { const value = media.get(key); if (!value) throw new Error(`Missing asset ${key}`); return value; };
  const ledger = {
    version: 1, seedKey: SEED_KEY, window: plan.window, plantedAt,
    ids: {}, semantic: {}, snapshots: {}, media: [],
    readiness: ["Replace sample license documents with authentic driver credentials, then staff verify the physical card or LTO Digital ID", "Drivers must accept privacy policy themselves"],
  };
  const ids = (key) => ledger.semantic[key]?.id;
  const { rows: roles } = await db.query("SELECT role_id FROM roles WHERE lower(role_name)='driver' ORDER BY role_id LIMIT 1");
  if (!roles.length) throw new Error("Existing Driver role not found");
  const { rows: duplicateEmployees } = await db.query("SELECT email FROM employees WHERE lower(email)=ANY($1::text[])", [plan.drivers.map((d) => accounts[d.key].email.toLowerCase())]);
  if (duplicateEmployees.length) throw new Error("One or more controlled demo emails already belong to an employee");
  const { rows: duplicatePlates } = await db.query("SELECT plate_number FROM vehicles WHERE plate_number=ANY($1::text[])", [plan.vehicles.map((v) => v.plate)]);
  if (duplicatePlates.length) throw new Error("One or more fictional demo plates already exist");

  for (const categoryName of [VIP, GUEST]) {
    const { rows } = await db.query("SELECT category_id,status,deleted_at FROM vehiclecategories WHERE category_name=$1 ORDER BY category_id", [categoryName]);
    if (rows.length > 1 || rows[0] && (rows[0].status !== "Active" || rows[0].deleted_at)) throw new Error(`Ambiguous or inactive category ${categoryName}`);
    if (rows.length) ledger.semantic[`C-${categoryName}`] = { table: "vehiclecategories", id: rows[0].category_id, reused: true };
    else await insert(db, ledger, "vehiclecategories", `C-${categoryName}`, {
      category_name: categoryName, description: `Synthetic defense category ${MARK}`,
      base_rate: categoryName === VIP ? 1800 : 1100, per_km_rate: categoryName === VIP ? 35 : 25,
      per_hour_rate: categoryName === VIP ? 500 : 350, status: "Active",
    });
  }
  for (const d of plan.drivers) {
    const account = accounts[d.key];
    const employeeId = await insert(db, ledger, "employees", `E-${d.key}`, {
      role_id: roles[0].role_id, first_name: d.firstName, last_name: d.lastName,
      position: "Demo Fleet Driver", email: account.email, status: "Active",
      password_hash: await bcrypt.hash(account.password, 12), must_change_password: false,
      avatar_url: storedMediaRef(asset(`${d.key}_PORTRAIT`)),
      created_at: at("2026-09-03", 6),
    });
    await insert(db, ledger, "drivers", d.key, {
      employee_id: employeeId, license_number: d.licenseNumber, license_expiry: d.licenseExpiry,
      license_type: d.licenseType, license_class: d.licenseClass,
      years_of_experience: d.years, driver_status: "Available", nationality: "Filipino",
      address: "Metro Manila, Philippines — DEMO ADDRESS", created_at: at("2026-09-03", 6),
      face_image_url: storedMediaRef(asset(`${d.key}_PORTRAIT`)),
      license_image_url: storedMediaRef(asset(`${d.key}_LICENSE_FRONT`)),
      license_back_image_url: storedMediaRef(asset(`${d.key}_LICENSE_BACK`)),
      // Only the real verification route can attest to a physical card or LTO digital ID.
      license_verified_at: null, license_verified_by: null, license_verification_method: null,
    });
  }
  for (const v of plan.vehicles) {
    await insert(db, ledger, "vehicles", v.key, {
      category_id: ids(`C-${v.category}`), plate_number: v.plate,
      vehicle_name: `${v.make} ${v.model} ${v.variant} ${MARK}`, model: v.model,
      manufacturer: v.make, year: v.year, color: v.color, fuel_type: v.fuel,
      seating_capacity: v.seats, mileage: v.initialOdometer, fuel_level: 75,
      insurance_expiry: v.insuranceExpiry, registration_expiry: v.registrationExpiry,
      vehicle_status: v.key === "V10" ? "Under Maintenance" : "Available",
      tank_capacity_l: v.tankLiters, fuel_efficiency_kmpl: v.kmPerLiter,
      required_license_class: v.seats >= 6 ? "B1" : "B", service_interval_km: 10000,
      next_service_mileage: v.initialOdometer + (v.key === "V06" ? 300 : 3000),
      next_service_date: v.key === "V06" ? "2026-10-25" : "2027-03-01",
      image_url: publicMediaUrl(asset(`${v.key}_PHOTO`)),
      created_at: at("2026-09-03", 6),
    });
    await insert(db, ledger, "vehicledocuments", `${v.key}-ORCR`, {
      vehicle_id: ids(v.key), document_type: "OR_CR", document_number: `DEMO-ORCR-${v.key}`,
      file_url: publicMediaUrl(asset(`${v.key}_ORCR`)), expiry_date: v.registrationExpiry, status: "Active",
    });
    await insert(db, ledger, "vehicledocuments", `${v.key}-INSURANCE`, {
      vehicle_id: ids(v.key), document_type: "Insurance", document_number: `HTA-${v.key}-2026`,
      file_url: publicMediaUrl(asset(`${v.key}_INSURANCE`)), expiry_date: v.insuranceExpiry, status: "Active",
    });
  }
  for (const v of plan.vehicles) for (const month of ["2026-09-01", "2026-10-01"]) await insert(db, ledger, "fuelallocations", `${v.key}-${month}`, {
    vehicle_id: ids(v.key), allocation_month: month, allocated_liters: v.seats >= 6 ? 180 : 140,
  });
  for (const a of plan.assignments) await insert(db, ledger, "driver_vehicle_assignments", `AS-${a.key}`, {
    driver_id: ids(a.driver), vehicle_id: ids(a.vehicle), assigned_from: "2026-09-03",
    notes: `Synthetic custodial assignment ${MARK}`, created_at: at("2026-09-03", 6),
  });
  for (const s of plan.schedules) await insert(db, ledger, "driver_work_schedules", s.key, {
    driver_id: ids(s.driver), day_of_week: s.weekday, shift_start: s.start, shift_end: s.end,
    break_start: s.breakStart, break_end: s.breakEnd, is_rest_day: s.rest,
  });
  for (const b of plan.leaveBalances) await insert(db, ledger, "driver_leave_balances", b.key, {
    driver_id: ids(b.driver), leave_type: b.type, allocated_days: b.allocated, used_days: b.used,
  });
  for (const l of plan.leaveRequests) await insert(db, ledger, "driver_leave_requests", l.key, {
    driver_id: ids(l.driver), start_date: l.day, end_date: l.endDay, leave_type: l.type,
    reason: `${l.reason} ${MARK}`, status: l.status,
    requested_at: at(l.day > "2026-10-02" ? "2026-10-02" : l.day, 7),
    review_notes: l.status === "Pending" ? null : `Historical synthetic decision ${MARK}`,
  });

  for (const loc of plan.locations) {
    const { rows } = await db.query("SELECT location_id FROM locations WHERE name=$1 AND is_active=true AND abs(latitude-$2::numeric)<0.001 AND abs(longitude-$3::numeric)<0.001 ORDER BY location_id", [loc.name, loc.lat, loc.lng]);
    if (rows.length > 1) throw new Error(`Ambiguous existing location ${loc.name}`);
    if (rows.length) ledger.semantic[loc.key] = { table: "locations", id: rows[0].location_id, reused: true };
    else await insert(db, ledger, "locations", loc.key, { name: loc.name, latitude: loc.lat, longitude: loc.lng,
      address: `${loc.name}, Metro Manila, Philippines`, is_active: true });
  }
  for (const route of plan.routes) {
    const { rows } = await db.query(
      "SELECT route_id FROM routes WHERE origin_location_id=$1 AND destination_location_id=$2 AND status='Active' AND deleted_at IS NULL",
      [ids(route.origin), ids(route.destination)],
    );
    if (rows.length > 1) throw new Error(`Ambiguous existing route ${route.key}`);
    if (rows.length) ledger.semantic[route.key] = { table: "routes", id: rows[0].route_id, reused: true };
    else await insert(db, ledger, "routes", route.key, {
      route_name: `${route.origin} to ${route.destination} ${MARK}`,
      origin: plan.locations.find((l) => l.key === route.origin).name,
      destination: plan.locations.find((l) => l.key === route.destination).name,
      origin_location_id: ids(route.origin), destination_location_id: ids(route.destination),
      estimated_distance: route.km, estimated_duration: route.minutes,
      estimate_source: "Manual", status: "Active",
    });
  }

  for (const request of plan.requests) {
    const route = plan.routes.find((r) => r.origin === request.origin && r.destination === request.destination);
    await insert(db, ledger, "transportation_requests", request.key, {
      external_booking_id: `FO-2026-10-${request.key}`,
      source_system: "MANUAL", booking_reference: `HOTEL-2026-${request.key}`,
      reservation_number: `RS-2026-${request.key}`, guest_name: request.guestName,
      pickup_location: plan.locations.find((l) => l.key === request.origin).name,
      dropoff_location: plan.locations.find((l) => l.key === request.destination).name,
      pickup_location_id: ids(request.origin), dropoff_location_id: ids(request.destination),
      pickup_datetime: request.pickup, passenger_count: request.passengers,
      special_requests: `Guest mobile: ${request.guestPhone}. Please confirm pickup point with the concierge.`, priority: request.category === VIP ? "High" : "Medium",
      booking_status: request.status === "Cancelled" ? "Cancelled" : "Approved",
      fleet_status: request.status, requested_category_id: ids(`C-${request.category}`),
      estimated_distance: route.km, estimated_duration: route.minutes,
      is_vip: request.category === VIP, created_at: request.created,
    });
    await insert(db, ledger, "reservation_events", `EV-${request.key}-CREATED`, {
      request_id: ids(request.key), event_type: "created", to_status: "Pending",
      actor_role: "system", description: "Reservation received by the concierge",
      occurred_at: request.created,
    });
  }
  const distanceByVehicle = new Map(plan.vehicles.map((v) => [v.key, v.initialOdometer]));
  for (const trip of [...plan.trips].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const completed = trip.status === "Completed";
    const dispatchId = await insert(db, ledger, "dispatchschedules", trip.dispatch, {
      vehicle_id: ids(trip.vehicle), driver_id: ids(trip.driver), route_id: ids(trip.route),
      dispatch_number: `DEFENSE-${trip.dispatch}`, request_id: ids(trip.request),
      scheduled_departure: trip.start, scheduled_arrival: trip.end,
      actual_departure: completed ? trip.start : null, actual_arrival: completed ? trip.end : null,
      status: completed ? "Completed" : "Scheduled", priority: "Normal",
      notes: `Synthetic defense dispatch ${MARK}`, created_at: before(trip.start, 120),
    });
    const startOdometer = distanceByVehicle.get(trip.vehicle);
    const endOdometer = completed ? startOdometer + trip.distanceKm : null;
    await insert(db, ledger, "trips", trip.key, {
      vehicle_id: ids(trip.vehicle), driver_id: ids(trip.driver), dispatch_id: dispatchId, route_id: ids(trip.route),
      start_time: completed ? trip.start : null, end_time: completed ? trip.end : null,
      distance: completed ? trip.distanceKm : 0, actual_duration: completed ? trip.durationMinutes : null,
      trip_status: trip.status, start_odometer: completed ? startOdometer : null,
      end_odometer: endOdometer, fuel_consumed: completed ? Number((trip.distanceKm / plan.vehicles.find((v) => v.key === trip.vehicle).kmPerLiter).toFixed(2)) : null,
      at_pickup_at: completed ? before(trip.start, 3) : null,
      notes: `Synthetic defense trip ${MARK}`, created_at: before(trip.start, 110),
    });
    if (completed) distanceByVehicle.set(trip.vehicle, endOdometer);
    await db.query("UPDATE transportation_requests SET vehicle_id=$1,driver_id=$2 WHERE request_id=$3", [ids(trip.vehicle), ids(trip.driver), ids(trip.request)]);
    for (const [eventType, minuteOffset, fromStatus, toStatus] of [
      ["vehicle_assigned", 110, "Pending", "Scheduled"],
      ["driver_assigned", 105, "Scheduled", "Assigned"],
      ["dispatch_created", 100, "Assigned", "Assigned"],
      ...(completed ? [["trip_started", 0, "Assigned", "In Progress"], ["trip_completed", -trip.durationMinutes, "In Progress", "Completed"]] : []),
    ]) await insert(db, ledger, "reservation_events", `EV-${trip.request}-${eventType}`, {
      request_id: ids(trip.request), event_type: eventType, from_status: fromStatus,
      to_status: toStatus, actor_role: "system", description: `Synthetic defense lifecycle ${MARK}`,
      occurred_at: before(trip.start, minuteOffset),
    });
  }
  for (const v of plan.vehicles) await db.query("UPDATE vehicles SET mileage=$1 WHERE vehicle_id=$2", [distanceByVehicle.get(v.key), ids(v.key)]);
  for (const a of plan.attendance) await insert(db, ledger, "driverattendance", a.key, {
    driver_id: ids(a.driver), date: a.day, time_in: at(a.day, 7), time_out: at(a.day, 19),
    check_in_method: "manual", status: "Present", remarks: `Synthetic historical attendance ${MARK}`,
    end_duty_outcome: "Reported", created_at: at(a.day, 7),
  });
  for (const i of plan.inspections) await insert(db, ledger, "vehicleinspection", i.key, {
    vehicle_id: ids(i.vehicle), driver_id: ids(i.driver), trip_id: i.trip ? ids(i.trip) : null, inspection_type: i.type,
    inspection_date: i.day, checklist: i.type === "Post-Shift" ? null : JSON.stringify(
      (i.type === "Pre-Shift" ? ["sounds", "lights", "dashboard", "steering", "brakes_tires"] :
        ["brakes_tires", "passenger_items", "cabin_ready"]).map((item_id) => ({ item_id, label: item_id.replaceAll("_", " "), status: "PASS", remarks: "" }))
    ),
    status: i.result, findings: null, severity: i.type === "Post-Shift" ? "None" : null,
    created_at: at(i.day, i.type === "Post-Shift" ? 19 : 7),
  });
  for (const f of plan.fuelRequests) await insert(db, ledger, "fuelrequests", f.key, {
    vehicle_id: ids(f.vehicle), driver_id: ids(f.driver), requested_liters: f.liters,
    approved_liters: ["Approved", "Fulfilled"].includes(f.status) ? f.liters : null,
    purpose: `Synthetic fuel request ${MARK}`, status: f.status,
    approved_at: ["Approved", "Fulfilled"].includes(f.status) ? at(f.day, 12) : null,
    fulfilled_at: f.status === "Fulfilled" ? at(f.day, 16) : null,
    current_fuel_level_percent: 25 + Number(f.key.slice(-2)) * 10,
    allocation_month: `${f.day.slice(0, 7)}-01`, gauge_photo_url: storedMediaRef(asset(f.gauge)),
    created_at: at(f.day, 8),
  });
  for (const f of plan.fuelRecords) {
    const { rows } = await db.query("SELECT end_odometer FROM trips WHERE trip_id=$1", [ids(f.trip)]);
    const linked = plan.fuelRequests.find((q) => q.status === "Fulfilled" && q.driver === f.driver && q.vehicle === f.vehicle && q.day === f.day);
    await insert(db, ledger, "fuelrecords", f.key, {
      vehicle_id: ids(f.vehicle), driver_id: ids(f.driver), trip_id: ids(f.trip),
      fuel_request_id: linked ? ids(linked.key) : null,
      liters: f.liters, price_per_liter: f.pricePerLiter, amount: f.liters * f.pricePerLiter,
      odometer: rows[0]?.end_odometer ?? null, fuel_type: plan.vehicles.find((v) => v.key === f.vehicle).fuel,
      fuel_date: f.day, receipt_url: storedMediaRef(asset(f.receipt)), status: "Approved",
      station_name: "Demo Fuel Station — Metro Manila", receipt_transaction_id: `DEMO-FUEL-${f.key}`,
      payment_method: "Cash", approved_at: at(f.day, 17), created_at: at(f.day, 15),
    });
  }
  for (const i of plan.incidents) await insert(db, ledger, "driverincidents", i.key, {
    driver_id: ids(i.driver), vehicle_id: ids(i.vehicle), trip_id: i.trip ? ids(i.trip) : null,
    incident_type: i.key === "I03" ? "Mechanical Fault" : "Minor Collision",
    incident_date: at(i.day, 17), description: `${i.description} ${MARK}`,
    location: "CoCo Star Hotel / Metro Manila", severity: i.severity,
    status: i.status, actions_taken: i.status === "Resolved" ? "Fleet supervisor inspected; synthetic historical case" : "Vehicle held for repair",
    photo_urls: [storedMediaRef(asset(`${i.key}_PHOTO`))],
    resolved_at: i.status === "Resolved" ? at(i.day, 19) : null,
    grounding_status: i.key === "I03" ? "Pending" : "Not Required",
    requires_vehicle_maintenance: i.key === "I03", created_at: at(i.day, 17),
  });
  for (const m of plan.maintenance) await insert(db, ledger, "vehiclemaintenance", m.key, {
    vehicle_id: ids(m.vehicle), maintenance_type: m.type,
    description: `Synthetic ${m.type.toLowerCase()} work ${MARK}`,
    maintenance_date: m.day, completed_date: m.status === "Completed" ? m.day : null,
    cost: m.cost, service_provider: "Harbor Training Workshop (fictional)",
    status: m.status, priority: m.status === "In Progress" ? "High" : "Normal",
    source_incident_id: m.vehicle === "V10" ? ids("I03") : null,
    completed_at: m.status === "Completed" ? at(m.day, 16) : null,
    created_at: at(m.day > "2026-10-02" ? "2026-10-02" : m.day, 8),
  });
  for (const [index, expense] of plan.expenses.entries()) {
    const submission = stableUuid(expense.key);
    const receipt = asset(expense.receipt);
    const ref = storedMediaRef(receipt);
    const ocr = { source: "synthetic_fixture", merchant_name: "Demo Parking / Toll Vendor", amount: expense.amount,
      currency: "PHP", date: expense.day, reference: `EXP-DEMO-${String(index + 1).padStart(2, "0")}` };
    await insert(db, ledger, "expense_receipt_scans", `SCAN-${expense.key}`, {
      client_submission_id: submission, driver_id: ids(expense.driver), receipt_storage_key: ref,
      receipt_sha256: receipt.sha256, ocr_snapshot: JSON.stringify(ocr), is_submitted: true,
      created_at: at(expense.day, 18),
    });
    await insert(db, ledger, "expense_records", expense.key, {
      client_submission_id: submission, driver_id: ids(expense.driver), trip_id: ids(expense.trip),
      vehicle_id: ids(expense.vehicle), category: expense.category,
      merchant_name: "Demo Parking / Toll Vendor", amount: expense.amount, currency: "PHP",
      expense_date: at(expense.day, 16), submitted_at: at(expense.day, 18),
      payment_method: "Cash", receipt_storage_key: ref, receipt_sha256: receipt.sha256,
      receipt_uploaded_at: at(expense.day, 17), ocr_snapshot: JSON.stringify(ocr),
      status: expense.status, created_at: at(expense.day, 18),
    });
  }
  for (const [index, label] of ["Hotel Operations Demo Card", "Airport Transfer Demo Card"].entries()) await insert(db, ledger, "company_cards", `CARD-${index + 1}`, {
    card_label: `${label} ${MARK}`, card_last_four: `00${index + 1}1`,
    provider: "Fictional training issuer", status: "Active", monthly_limit: 50000,
  });
  // Historical fixture inserts fire the same live notification triggers as a
  // current dispatch. Suppress only rows produced for our new historical IDs
  // before commit, so the demo inbox and push worker do not announce old trips.
  const historicalDispatches = plan.trips.filter((t) => t.status === "Completed").map((t) => ids(t.dispatch));
  const historicalTrips = plan.trips.filter((t) => t.status === "Completed").map((t) => ids(t.key));
  const nonDemoLeaveRequests = plan.leaveRequests.filter((l) => l.key !== "L01").map((l) => ids(l.key));
  await db.query("DELETE FROM push_outbox WHERE reference_type='dispatch' AND reference_id=ANY($1::int[]) AND created_at >= $2::timestamptz", [historicalDispatches, ledger.plantedAt]);
  for (const [type, referenceIds] of [
    ["dispatch", historicalDispatches], ["trip", historicalTrips],
    ["leave_request", nonDemoLeaveRequests], ["maintenance", ledger.ids.vehiclemaintenance ?? []],
  ]) await db.query("DELETE FROM notifications WHERE reference_type=$1 AND reference_id=ANY($2::int[]) AND created_at >= $3::timestamptz", [type, referenceIds, ledger.plantedAt]);
  // Dispatch triggers may create notifications. Own only those exact IDs created
  // during this transaction; do not remove later app-created notifications.
  const refs = [
    ["dispatch", ledger.ids.dispatchschedules ?? []], ["trip", ledger.ids.trips ?? []],
    ["maintenance", ledger.ids.vehiclemaintenance ?? []], ["leave_request", ledger.ids.driver_leave_requests ?? []],
    ["vehicle", ledger.ids.vehicles ?? []], ["document", ledger.ids.vehicledocuments ?? []],
  ];
  for (const [referenceType, referenceIds] of refs) {
    if (!referenceIds.length) continue;
    const { rows } = await db.query(
      "SELECT notification_id FROM notifications WHERE reference_type=$1 AND reference_id=ANY($2::int[]) AND created_at >= $3::timestamptz",
      [referenceType, referenceIds, ledger.plantedAt]
    );
    for (const row of rows) remember(ledger, "notifications", row.notification_id, `N-${row.notification_id}`);
  }
  if (ledger.ids.dispatchschedules?.length) {
    const { rows } = await db.query("SELECT id FROM push_outbox WHERE reference_type='dispatch' AND reference_id=ANY($1::int[]) AND created_at >= $2::timestamptz", [ledger.ids.dispatchschedules, ledger.plantedAt]);
    for (const row of rows) remember(ledger, "push_outbox", row.id, `P-${row.id}`);
  }
  await captureSnapshots(db, ledger);
  await saveLedger(db, ledger);
  return ledger;
}
