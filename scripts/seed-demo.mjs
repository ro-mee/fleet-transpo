// Reversible demo-data seeder.
//
// Most of this fleet's tables have never held more than a handful of rows, so
// every report and aggregate in the app has only ever been exercised against
// empty or near-empty input. That is not a neutral gap: an aggregate over zero
// rows returns a plausible-looking zero, so a broken sum and an empty table are
// indistinguishable from the UI. Seeding is the only way to tell them apart.
// (The first thing it found: pg returns numeric columns as strings, so four
// routes were concatenating money instead of adding it.)
//
// Commands:
//   node scripts/seed-demo.mjs status   live counts + what the ledger claims
//   node scripts/seed-demo.mjs plan     generate + validate, write nothing
//   node scripts/seed-demo.mjs up       insert the seed set
//   node scripts/seed-demo.mjs down     delete exactly what `up` inserted
//
// Two properties this script is built around:
//
// 1. REVERSIBLE. Every inserted primary key is recorded in a ledger row in
//    `system_settings` under SEED_KEY, along with the pre-seed odometer of every
//    vehicle it touches. `down` reads that ledger and deletes by id in FK order,
//    then restores the odometers. Nothing is matched by heuristic or date range,
//    so `down` cannot take a row it did not create. It also sweeps the
//    notifications the database triggers wrote in response to the inserts.
//
// 2. DETERMINISTIC. All variation comes from a seeded PRNG, never Math.random,
//    and the date window is a hardcoded constant. Two `up` runs produce byte-
//    identical data, which is what makes hand-computing an expected report total
//    and comparing it to the API meaningful. A seed that shuffles every run can
//    only be eyeballed.
import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";

loadEnvLocal();

const SEED_KEY = "seed:phase4";
const MARK = "[seed:phase4]";

// Hardcoded, not derived from today, so the generated set is reproducible.
// 90 days ending the day before the roadmap date this was written against.
const WINDOW_START = "2026-05-13";
const WINDOW_DAYS = 90;
const TRIP_TARGET = 200;

// Fixed PRNG seed. Changing it changes every generated value, which invalidates
// any total hand-computed against a previous run.
const SEED_RNG = 0xf1ee7;

// Manila. The routes in this database are NAIA terminal transfers, so pickup
// times only read correctly against +08:00.
const TZ = "+08:00";

// Costing inputs. Philippine pesos. Kept here rather than inline so the numbers
// a verification pass hand-computes have one visible source.
const PESO_PER_LITER = 65.0;
const DRIVER_PESO_PER_HOUR = 120.0;
const MAINT_PESO_PER_KM = 2.0;

// ---------------------------------------------------------------- primitives

// mulberry32: small, fast, and reproducible across Node versions. The exact
// generator does not matter; that it is not Math.random does.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const between = (rng, lo, hi) => lo + rng() * (hi - lo);
const intBetween = (rng, lo, hi) => Math.floor(between(rng, lo, hi + 1));
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

const START_MS = Date.UTC(2026, 4, 13); // WINDOW_START, as UTC midnight
const DAY_MS = 86400000;

/** Calendar date `offset` days after WINDOW_START, as YYYY-MM-DD. */
function dayStr(offset) {
  return new Date(START_MS + offset * DAY_MS).toISOString().slice(0, 10);
}
/** 0 = Sunday. */
function dayOfWeek(offset) {
  return new Date(START_MS + offset * DAY_MS).getUTCDay();
}
/**
 * A local-time timestamp on the given day, as an offset-qualified ISO string.
 *
 * Minutes are carried into hours rather than clamped. Callers reach 60 by
 * rounding a fractional hour — `Math.round((8.999 % 1) * 60)` is 60, which
 * Postgres rejects outright ("date/time field value out of range: 08:60"),
 * and a day boundary carries into the next day rather than producing 24:xx.
 */
function stamp(offset, hour, minute) {
  const total = Math.floor(hour) * 60 + Math.floor(minute);
  const dayCarry = Math.floor(total / 1440);
  const within = total - dayCarry * 1440;
  const h = String(Math.floor(within / 60)).padStart(2, "0");
  const m = String(within % 60).padStart(2, "0");
  return `${dayStr(offset + dayCarry)}T${h}:${m}:00${TZ}`;
}

/**
 * Multi-row INSERT in batches.
 *
 * ~1,100 rows one statement at a time is ~1,100 network round trips to a hosted
 * database, which turns a two-second seed into a two-minute one. Batched at 150
 * rows it is a handful. The 65535-parameter ceiling is the reason for a cap at
 * all: 150 rows of 30 columns is 4,500 parameters, comfortably inside it.
 */
async function insertMany(tx, table, columns, rows, returning = null) {
  if (!rows.length) return [];
  const out = [];
  const BATCH = 150;
  for (let start = 0; start < rows.length; start += BATCH) {
    const slice = rows.slice(start, start + BATCH);
    const params = [];
    const tuples = slice.map((row) => {
      const holes = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${holes.join(",")})`;
    });
    const sql =
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")}` +
      (returning ? ` RETURNING ${returning}` : "");
    const res = await tx.query(sql, params);
    if (returning) out.push(...res.rows.map((r) => r[returning]));
  }
  return out;
}

// ------------------------------------------------------------------ planning

/**
 * Trips per day across the window, summing to exactly TRIP_TARGET.
 *
 * Weekends carry more than weekdays because this is hotel airport-transfer
 * work. The adjust loops at the end are what make the total exact — a purely
 * weighted distribution lands near the target, not on it, and "about 200 trips"
 * is not a number you can hand-verify a report against.
 */
function planPerDay(rng) {
  const counts = [];
  for (let d = 0; d < WINDOW_DAYS; d++) {
    const dow = dayOfWeek(d);
    const busy = dow === 0 || dow === 5 || dow === 6; // Sun, Fri, Sat
    counts.push(busy ? 3 : 2);
  }
  let total = counts.reduce((a, b) => a + b, 0);
  while (total > TRIP_TARGET) {
    const i = Math.floor(rng() * WINDOW_DAYS);
    if (counts[i] > 1) { counts[i]--; total--; }
  }
  while (total < TRIP_TARGET) {
    const i = Math.floor(rng() * WINDOW_DAYS);
    counts[i]++; total++;
  }
  return counts;
}

const GUESTS = [
  "Maria Santos", "Liam O'Connor", "Aiko Tanaka", "Rafael Mendoza",
  "Chen Wei", "Priya Nair", "James Whitfield", "Nadia Rahman",
  "Carlos Villanueva", "Sofia Bernardo", "Henrik Lund", "Grace Lim",
  "Tomas Delgado", "Yuki Nakamura", "Anna Kowalski", "Miguel Reyes",
];

// Every enumerated value below is taken from src/lib/constants.js or from the
// route that writes the column — not invented. This matters more than realism:
// /api/notifications/preferences rejects an event_key that is not in
// NOTIFICATION_EVENTS, so a seed with a plausible-looking `dispatch.created`
// would write rows the application itself considers invalid, and the screen
// reading them would show state no user could ever have produced.
const SEED_SERVICE_TYPES = [
  ["Airport Transfer", "Terminal pickup and drop-off for arriving and departing guests", 1],
  ["Hotel Shuttle", "Scheduled shuttle runs on the hotel loop", 2],
  ["City Tour", "Half-day sightseeing charter", 3],
  ["Point-to-Point", "Single-leg transfer to a named address", 4],
  ["Staff Transport", "Shift transport for hotel staff", 5],
];

// src/lib/constants.js NOTIFICATION_EVENTS keys, with that file's own channel
// defaults, so a seeded preference row is indistinguishable from one the
// preferences screen would have written.
const SEED_PREFERENCES = [
  ["dispatch_created", { in_app: true, email: true }],
  ["trip_completed", { in_app: true, email: false }],
  ["maintenance_due", { in_app: true, email: true }],
  ["reservation_approved", { in_app: true, email: true }],
];

// BOOKING_CHANNELS names paired with INTEGRATION_SOURCES systems.
const SEED_CHANNELS = [
  ["Front Desk", "PMS", "Walk-up and in-house guest requests"],
  ["Concierge", "PMS", "Requests raised by the concierge desk"],
  ["Online Booking", "Web", "Requests raised from the public site"],
];

// MAINTENANCE_TYPE. 'Routine' is load-bearing beyond labelling:
// api/integration/transport-requests/[id]/recommendation counts anything
// DISTINCT FROM 'Routine' as corrective work when it scores a vehicle.
const MAINT_KINDS = [
  ["Routine", "Scheduled preventive service — oil, filters, fluids", 3500, 7500],
  ["Inspection", "Periodic safety and roadworthiness inspection", 900, 1600],
  ["Repair", "Brake pads and hydraulic fluid replacement", 4200, 9000],
  ["Routine", "Tyre rotation and wheel balancing", 1800, 3200],
];

// ["Minor", "Moderate", "Major", "Critical"] per api/driver/incidents. Kept to
// the lower two on purpose: lib/driver/grounding.js grounds a vehicle on
// Major/Critical, and a seed should not silently take vehicles out of service.
const INCIDENT_KINDS = [
  ["Flat tire", "Minor", false],
  ["Minor collision", "Moderate", true],
  ["Guest complaint", "Minor", false],
  ["Engine warning light", "Moderate", false],
];

// UVVRP_PRESETS.Manila from src/lib/uvvrp/policy.js. Duplicated rather than
// imported because that module lives under src/ and this script runs as a plain
// node ESM entry with no bundler path aliases.
const MANILA_CODING = {
  Monday: [1, 2], Tuesday: [3, 4], Wednesday: [5, 6],
  Thursday: [7, 8], Friday: [9, 0],
};
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Mirrors plateLastDigit() in src/lib/uvvrp/policy.js. */
function plateLastDigit(plate) {
  if (plate == null) return null;
  const m = String(plate).toUpperCase().replace(/[^0-9A-Z]/g, "").match(/(\d)(?!.*\d)/);
  return m ? Number(m[1]) : null;
}

/**
 * Build the entire seed set in memory before touching the database.
 *
 * Planning first is what lets the odometer walk forward per vehicle and the
 * fuel records reference the trip that burned the fuel — both need to see the
 * whole sequence, not one row at a time.
 */
function buildPlan(rng, ref) {
  const { vehicles, drivers, routes, categories, employees } = ref;
  const perDay = planPerDay(rng);

  // Odometers continue from each vehicle's current recorded mileage, so seeded
  // history is monotonic and ends where the live row already sits. Anything
  // else would either walk mileage backwards or leave a gap.
  const odo = new Map(vehicles.map((v) => [v.vehicle_id, Number(v.mileage) || 0]));
  // Per-vehicle refuel cadence in days, staggered so all six do not fill on the
  // same date and the monthly fuel trend has something to show.
  const fuelLastFillDay = new Map();
  const fuelCadence = new Map(vehicles.map((v, i) => [v.vehicle_id, 11 + (i % 5)]));

  const requests = [];
  const dispatches = [];
  const trips = [];
  const fuel = [];
  const incidents = [];

  let n = 0;
  for (let d = 0; d < WINDOW_DAYS; d++) {
    // Spread the day's trips across the service window rather than clustering
    // them, and keep each vehicle to one trip per slot.
    const slots = [];
    for (let s = 0; s < perDay[d]; s++) slots.push(intBetween(rng, 5, 21));
    slots.sort((a, b) => a - b);

    const usedVehicles = new Set();
    for (const hour of slots) {
      n += 1;
      const seq = String(n).padStart(4, "0");

      const available = vehicles.filter((v) => !usedVehicles.has(v.vehicle_id));
      const vehicle = pick(rng, available.length ? available : vehicles);
      usedVehicles.add(vehicle.vehicle_id);
      const driver = drivers[(n + d) % drivers.length];
      const route = pick(rng, routes);
      const category = categories.find((c) => c.category_id === vehicle.category_id) ?? categories[0];

      // Route 6 carries no estimate in this database; fall back to a distance
      // in the same band as the four that do rather than inventing a long haul.
      const baseKm = Number(route.estimated_distance) || 4.5;
      const baseMin = Number(route.estimated_duration) || 14;
      const distance = round2(baseKm * between(rng, 0.9, 1.25));
      const minute = intBetween(rng, 0, 11) * 5;

      // Airport traffic: most runs land close to the estimate, some badly late.
      const late = rng() < 0.18;
      const actualMin = Math.max(5, Math.round(baseMin * (late ? between(rng, 1.4, 2.2) : between(rng, 0.85, 1.2))));
      const variance = actualMin - baseMin;

      const depart = stamp(d, hour, minute);
      const schedArrive = stamp(d, hour + Math.floor((minute + baseMin) / 60), (minute + baseMin) % 60);
      const endTotal = minute + actualMin;
      const actualArrive = stamp(d, hour + Math.floor(endTotal / 60), endTotal % 60);

      const startOdo = odo.get(vehicle.vehicle_id);
      const endOdo = round2(startOdo + distance);
      odo.set(vehicle.vehicle_id, endOdo);

      const efficiency = round2(between(rng, 7.5, 11.5)); // km per litre
      const litersBurned = distance / efficiency;
      const fuelCost = round2(litersBurned * PESO_PER_LITER);
      const tollFees = rng() < 0.45 ? round2(between(rng, 45, 75)) : 0;
      const parkingFees = rng() < 0.35 ? round2(between(rng, 30, 60)) : 0;
      const driverCost = round2((actualMin / 60) * DRIVER_PESO_PER_HOUR);
      const maintCost = round2(distance * MAINT_PESO_PER_KM);
      const miscCost = rng() < 0.1 ? round2(between(rng, 20, 120)) : 0;
      const totalCost = round2(fuelCost + tollFees + parkingFees + driverCost + maintCost + miscCost);

      const isVip = category.category_name === "VIP Guest";
      const guest = pick(rng, GUESTS);

      requests.push({
        external_booking_id: `SEED4-${seq}`,
        reservation_number: `RS-S4${seq}`,
        guest_name: guest,
        pickup_location: route.origin,
        dropoff_location: route.destination,
        pickup_datetime: depart,
        passenger_count: intBetween(rng, 1, Math.max(1, Math.min(6, category.seating_capacity || 4))),
        priority: isVip ? "High" : pick(rng, ["Medium", "Medium", "Low"]),
        is_vip: isVip,
        estimated_distance: baseKm,
        estimated_duration: baseMin,
        requested_category_id: category.category_id,
        vehicle_id: vehicle.vehicle_id,
        driver_id: driver.driver_id,
        reviewed_by: employees.dispatcher,
        approved_by: employees.manager,
        reviewed_at: stamp(d, Math.max(1, hour - 3), 15),
        approved_at: stamp(d, Math.max(1, hour - 2), 30),
        service_slot: n % SEED_SERVICE_TYPES.length,
      });

      dispatches.push({
        dispatch_number: `DSP-S4-${seq}`,
        vehicle_id: vehicle.vehicle_id,
        driver_id: driver.driver_id,
        route_id: route.route_id,
        scheduled_departure: depart,
        scheduled_arrival: schedArrive,
        actual_departure: depart,
        actual_arrival: actualArrive,
        created_by: employees.dispatcher,
        // Not columns — carried so the coding pass below can re-derive the
        // weekday and plate digit from the same inputs the app would use.
        dayOffset: d,
        plate_number: vehicle.plate_number,
      });

      trips.push({
        vehicle_id: vehicle.vehicle_id,
        driver_id: driver.driver_id,
        route_id: route.route_id,
        start_time: depart,
        end_time: actualArrive,
        distance,
        actual_duration: actualMin,
        start_odometer: startOdo,
        end_odometer: endOdo,
        fuel_consumed: round2(litersBurned),
        avg_speed: round2((distance / actualMin) * 60),
        max_speed: round2(between(rng, 45, 88)),
        idle_time: intBetween(rng, 1, 14),
        fuel_cost: fuelCost,
        toll_fees: tollFees,
        parking_fees: parkingFees,
        driver_cost: driverCost,
        maintenance_cost: maintCost,
        miscellaneous_cost: miscCost,
        total_cost: totalCost,
        cost_per_km: round2(totalCost / distance),
        on_time_completion: !late,
        time_variance: variance,
        fuel_efficiency: efficiency,
        // numeric(3,2) tops out at 9.99 and numeric(2,1) at 9.9, so these two
        // scales cannot be widened past 10 and 5 without a schema change.
        smooth_driving_score: round2(late ? between(rng, 5.5, 7.8) : between(rng, 7.4, 9.7)),
        customer_rating: Math.round(between(rng, late ? 3.0 : 4.0, 5.0) * 10) / 10,
      });

      // Fuel records are tank fills on an operational cadence — roughly every
      // two weeks per vehicle — not "refuel when the trip log says the tank ran
      // dry". Modelling it the other way produced two records for the whole
      // quarter, because these routes are 4-6 km airport transfers: a trip burns
      // about half a litre, so 33 trips per vehicle never empties a tank.
      //
      // A consequence worth knowing before hand-checking a report: litres
      // purchased will exceed litres attributable to logged trips, so any
      // km-per-litre figure derived from trips.distance ÷ fuelrecords.liters
      // reads low. That gap is a property of the data, not a bug in the report —
      // real fleets buy fuel for running that never becomes a dispatched trip.
      const lastFill = fuelLastFillDay.get(vehicle.vehicle_id);
      if (lastFill == null || d - lastFill >= fuelCadence.get(vehicle.vehicle_id)) {
        const liters = round2(between(rng, 28, 46));
        const ppl = round2(PESO_PER_LITER * between(rng, 0.94, 1.07));
        fuel.push({
          // Attributed to the trip that had just finished — trip_id is a real FK
          // and a fuel record with no trip cannot be reconciled against anything.
          tripIndex: trips.length - 1,
          vehicle_id: vehicle.vehicle_id,
          driver_id: driver.driver_id,
          liters,
          amount: round2(liters * ppl),
          price_per_liter: ppl,
          odometer: endOdo,
          fuel_type: vehicle.fuel_type || "Gasoline",
          fuel_date: dayStr(d),
          station_name: pick(rng, ["Shell NAIA Road", "Petron Roxas Blvd", "Caltex Airport Rd", "Seaoil Baclaran"]),
          approved_by: employees.manager,
        });
        fuelLastFillDay.set(vehicle.vehicle_id, d);
        fuelCadence.set(vehicle.vehicle_id, intBetween(rng, 11, 16));
      }

      // A few incidents tied to real trips. driver-performance reports an
      // incident count of literal 0 without querying this table; these rows are
      // what make that visible instead of arguable.
      if (rng() < 0.05) {
        const [kind, severity, atFault] = pick(rng, INCIDENT_KINDS);
        incidents.push({
          tripIndex: trips.length - 1,
          driver_id: driver.driver_id,
          vehicle_id: vehicle.vehicle_id,
          incident_type: kind,
          incident_date: actualArrive,
          severity,
          is_at_fault: atFault,
          location: route.destination,
          expense_amount: severity === "Moderate" ? round2(between(rng, 800, 4500)) : 0,
        });
      }
    }
  }

  // ---- attendance: one row per driver per working day (UNIQUE driver_id,date)
  const attendance = [];
  for (const driver of drivers) {
    for (let d = 0; d < WINDOW_DAYS; d++) {
      const dow = dayOfWeek(d);
      if (dow === 1) continue; // rest day
      const roll = rng();
      let status = "Present";
      if (roll > 0.97) status = "On Leave";
      else if (roll > 0.94) status = "Absent";
      else if (roll > 0.82) status = "Late";

      const present = status === "Present" || status === "Late";
      const inHour = status === "Late" ? between(rng, 7.6, 9.2) : between(rng, 5.7, 6.9);
      const faceMethod = rng() < 0.6;
      attendance.push({
        driver_id: driver.driver_id,
        date: dayStr(d),
        time_in: present ? stamp(d, Math.floor(inHour), Math.round((inHour % 1) * 60)) : null,
        time_out: present ? stamp(d, intBetween(rng, 16, 19), intBetween(rng, 0, 59)) : null,
        check_in_method: present && faceMethod ? "face_recognition" : "manual",
        // numeric(5,4): a confidence must stay below 10.0000.
        face_confidence: present && faceMethod ? round4(between(rng, 0.82, 0.99)) : null,
        face_verified: present && faceMethod,
        status,
      });
    }
  }

  // ---- maintenance and inspections, spaced per vehicle across the window
  const maintenance = [];
  const inspections = [];
  for (const v of vehicles) {
    for (let k = 0; k < 3; k++) {
      const d = intBetween(rng, k * 28, k * 28 + 25);
      if (d >= WINDOW_DAYS) continue;
      const [type, desc, lo, hi] = pick(rng, MAINT_KINDS);
      maintenance.push({
        vehicle_id: v.vehicle_id,
        maintenance_type: type,
        description: desc,
        maintenance_date: dayStr(d),
        completed_date: dayStr(Math.min(WINDOW_DAYS - 1, d + intBetween(rng, 0, 2))),
        cost: round2(between(rng, lo, hi)),
        mileage_at_service: round2(odo.get(v.vehicle_id) * between(rng, 0.8, 0.99)),
        service_provider: pick(rng, ["Toyota Otis", "Autohub Pasay", "Fleet Care Manila"]),
        created_by: employees.manager,
      });
    }
    for (let k = 0; k < 3; k++) {
      const d = intBetween(rng, k * 30, k * 30 + 27);
      if (d >= WINDOW_DAYS) continue;
      const clean = rng() < 0.75;
      inspections.push({
        vehicle_id: v.vehicle_id,
        driver_id: pick(rng, drivers).driver_id,
        inspection_type: pick(rng, ["Pre-Trip", "Post-Trip", "Monthly"]),
        inspection_date: dayStr(d),
        checklist: JSON.stringify({
          tires: clean ? "ok" : "worn",
          lights: "ok",
          brakes: clean ? "ok" : "soft",
          fluids: "ok",
          body: "ok",
        }),
        findings: clean ? "No defects found." : "Front tires near wear bar; brake pedal soft.",
        // Same four-level scale as incidents (api/driver/incidents). There is no
        // writer route for vehicleinspection at all — only a driver-scoped GET —
        // so no existing rows and no app code pin this column's vocabulary.
        severity: clean ? "Minor" : "Moderate",
        status: clean ? "Passed" : "Needs Attention",
      });
    }
  }

  // ---- coding (UVVRP) violations, derived from the schedule above
  //
  // Not fabricated: these are the dispatches in the generated schedule whose
  // vehicle's real plate digit is actually restricted on that departure's
  // weekday under the Manila preset. A violation row invented independently of
  // the schedule would contradict what evaluateCoding() computes when the board
  // re-derives it from the same plate and date.
  const codingCandidates = [];
  dispatches.forEach((disp, i) => {
    const weekday = WEEKDAY_NAMES[dayOfWeek(disp.dayOffset)];
    const digit = plateLastDigit(disp.plate_number);
    if (digit == null) return;
    if ((MANILA_CODING[weekday] ?? []).includes(digit)) {
      codingCandidates.push({ dispatchIndex: i, weekday, digit, vehicle_id: disp.vehicle_id, departure: disp.scheduled_departure });
    }
  });

  // The five actions recordViolation/decideViolation actually write. One
  // 'approved' row is deliberate: getExemptVehicleIds() treats an approved
  // violation as a blanket, non-date-scoped exemption, so it is the only value
  // here that changes live behaviour while the seed is planted.
  const ACTIONS = ["blocked", "blocked", "warned", "pending_approval", "blocked", "warned", "pending_approval", "approved"];
  const coding = codingCandidates.slice(0, ACTIONS.length).map((c, i) => ({ ...c, action: ACTIONS[i] }));

  return { requests, dispatches, trips, fuel, incidents, attendance, maintenance, inspections, coding };
}

// ------------------------------------------------------------------ commands

const TABLES = [
  "transportation_requests", "dispatchschedules", "trips", "fuelrecords",
  "driverattendance", "vehiclemaintenance", "vehicleinspection", "driverincidents",
  "service_types", "booking_channels", "notification_preferences",
  "ai_insights", "ai_recommendations", "uvvrp_violations", "notifications",
];

async function readLedger(pool) {
  const { rows } = await pool.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = $1`, [SEED_KEY]
  );
  return rows[0]?.setting_value ?? null;
}

async function cmdStatus(pool) {
  const ledger = await readLedger(pool);
  console.log(`\nLive row counts\n`);
  for (const t of TABLES) {
    const { rows } = await pool.query(`SELECT count(*)::int n FROM ${t}`);
    console.log(`  ${String(rows[0].n).padStart(6)}  ${t}`);
  }
  if (!ledger) {
    console.log(`\nNo seed ledger (${SEED_KEY}). Nothing has been seeded by this script.\n`);
    return;
  }
  console.log(`\nSeed ledger ${SEED_KEY} — planted ${ledger.planted_at}\n`);
  for (const [k, v] of Object.entries(ledger.ids ?? {})) {
    if (Array.isArray(v) && v.length) console.log(`  ${String(v.length).padStart(6)}  ${k}`);
  }
  console.log(`\n  window ${ledger.window?.start} .. ${ledger.window?.end}`);
  console.log(`  odometers to restore: ${Object.keys(ledger.odometers ?? {}).length}`);
  console.log(`\nRun \`node scripts/seed-demo.mjs down\` to remove exactly these rows.\n`);
}

/**
 * Read the rows the seed hangs off. Never invented: a seed that makes up its own
 * vehicles and drivers tests nothing about this database.
 */
async function readReference(pool) {
  const ref = {};
  ref.vehicles = (await pool.query(
    `SELECT vehicle_id, plate_number, category_id, fuel_type, mileage FROM vehicles WHERE deleted_at IS NULL ORDER BY vehicle_id`
  )).rows;
  ref.drivers = (await pool.query(
    `SELECT driver_id FROM drivers WHERE deleted_at IS NULL ORDER BY driver_id`
  )).rows;
  ref.routes = (await pool.query(
    `SELECT route_id, origin, destination, estimated_distance, estimated_duration
       FROM routes WHERE deleted_at IS NULL ORDER BY route_id`
  )).rows;
  ref.categories = (await pool.query(
    `SELECT category_id, category_name, seating_capacity FROM vehiclecategories WHERE deleted_at IS NULL ORDER BY category_id`
  )).rows;

  if (!ref.vehicles.length || !ref.drivers.length || !ref.routes.length) {
    throw new Error("Need at least one vehicle, driver and route to seed against.");
  }

  const emp = (await pool.query(
    `SELECT e.employee_id, r.role_name FROM employees e
       JOIN roles r ON r.role_id = e.role_id
      WHERE e.deleted_at IS NULL ORDER BY e.employee_id`
  )).rows;
  const byRole = (name) => emp.find((e) => e.role_name === name)?.employee_id ?? null;
  ref.employees = {
    dispatcher: byRole("dispatcher"),
    manager: byRole("fleet_manager"),
    admin: byRole("system_admin"),
    staff: emp.filter((e) => e.role_name !== "driver").map((e) => e.employee_id).slice(0, 4),
  };
  return ref;
}

/**
 * Column ceilings that the generated values have to fit inside. These are the
 * ones a plausible-looking value can silently exceed: a driving score of 10.0 on
 * a 0-10 scale does not fit numeric(3,2), and a customer rating of 5.0 barely
 * fits numeric(2,1). Checking here rather than letting the INSERT fail keeps the
 * error pointing at the generator instead of at row 147 of a batch.
 */
const CAPS = {
  trips: {
    distance: 99999999.99, avg_speed: 999.99, max_speed: 999.99,
    smooth_driving_score: 9.99, customer_rating: 9.9, cost_per_km: 999999.99,
    fuel_efficiency: 999999.99, total_cost: 999999999999.99,
    start_odometer: 9999999999.99, end_odometer: 9999999999.99,
    fuel_consumed: 99999999.99, toll_fees: 99999999.99, parking_fees: 99999999.99,
  },
  fuel: { liters: 99999999.99, amount: 9999999999.99, price_per_liter: 99999999.99, odometer: 9999999999.99 },
  attendance: { face_confidence: 9.9999 },
  maintenance: { cost: 9999999999.99, mileage_at_service: 9999999999.99 },
};

function validatePlan(plan) {
  const problems = [];
  for (const [group, caps] of Object.entries(CAPS)) {
    (plan[group] ?? []).forEach((row, i) => {
      for (const [col, max] of Object.entries(caps)) {
        const v = row[col];
        if (v == null) continue;
        if (!Number.isFinite(v)) problems.push(`${group}[${i}].${col} is ${v}`);
        else if (Math.abs(v) > max) problems.push(`${group}[${i}].${col} = ${v} exceeds ${max}`);
      }
    });
  }
  // Odometers must not walk backwards per vehicle: lib/vehicles/odometer.js
  // rejects a reading below the vehicle's current mileage.
  const last = new Map();
  plan.trips.forEach((t, i) => {
    if (t.end_odometer < t.start_odometer) problems.push(`trips[${i}] odometer goes backwards`);
    const prev = last.get(t.vehicle_id);
    if (prev != null && t.start_odometer < prev) {
      problems.push(`trips[${i}] vehicle ${t.vehicle_id} starts at ${t.start_odometer} below previous end ${prev}`);
    }
    last.set(t.vehicle_id, t.end_odometer);
  });
  // The UNIQUE index idx_attendance_driver_date would reject a duplicate.
  const seen = new Set();
  plan.attendance.forEach((a, i) => {
    const k = `${a.driver_id}|${a.date}`;
    if (seen.has(k)) problems.push(`attendance[${i}] duplicates ${k}`);
    seen.add(k);
  });
  return problems;
}

function summarize(plan) {
  const rows = {
    transportation_requests: plan.requests.length,
    dispatchschedules: plan.dispatches.length,
    trips: plan.trips.length,
    fuelrecords: plan.fuel.length,
    driverincidents: plan.incidents.length,
    driverattendance: plan.attendance.length,
    vehiclemaintenance: plan.maintenance.length,
    vehicleinspection: plan.inspections.length,
    uvvrp_violations: plan.coding.length,
  };
  for (const [k, v] of Object.entries(rows)) console.log(`  ${String(v).padStart(6)}  ${k}`);
  const totalCost = plan.trips.reduce((s, t) => s + t.total_cost, 0);
  const totalDist = plan.trips.reduce((s, t) => s + t.distance, 0);
  const fuelAmount = plan.fuel.reduce((s, f) => s + f.amount, 0);
  const fuelLiters = plan.fuel.reduce((s, f) => s + f.liters, 0);
  const maintCost = plan.maintenance.reduce((s, m) => s + m.cost, 0);
  console.log(`\nHand-computable totals for the window (${WINDOW_START} .. ${dayStr(WINDOW_DAYS - 1)}):`);
  console.log(`  trips.distance      ${round2(totalDist)} km`);
  console.log(`  trips.total_cost    ${round2(totalCost)}`);
  console.log(`  fuelrecords.amount  ${round2(fuelAmount)}`);
  console.log(`  fuelrecords.liters  ${round2(fuelLiters)}`);
  console.log(`  maintenance.cost    ${round2(maintCost)}`);
  console.log(`  financial costPerKm ${round2((fuelAmount + maintCost) / totalDist)}  (fuel+maint / distance)`);
  const late = plan.trips.filter((t) => !t.on_time_completion).length;
  console.log(`  on-time             ${plan.trips.length - late}/${plan.trips.length}`);
  const att = {};
  for (const a of plan.attendance) att[a.status] = (att[a.status] ?? 0) + 1;
  console.log(`  attendance          ${Object.entries(att).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  coding actions      ${plan.coding.map((c) => c.action).join(", ") || "(no conflicts in schedule)"}`);
}

/** Generate and validate the seed set without writing anything. */
async function cmdPlan(pool) {
  const ref = await readReference(pool);
  console.log(
    `\nWould seed against ${ref.vehicles.length} vehicles, ${ref.drivers.length} drivers, ` +
    `${ref.routes.length} routes\nWindow ${WINDOW_START} + ${WINDOW_DAYS} days, ${TRIP_TARGET} trips\n`
  );
  const plan = buildPlan(makeRng(SEED_RNG), ref);
  summarize(plan);
  const problems = validatePlan(plan);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s) — the generator, not the database:`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll generated values fit their column types. Nothing written.\n`);
  }
}

async function cmdUp(pool) {
  if (await readLedger(pool)) {
    console.error(`\nAlready seeded — ledger ${SEED_KEY} exists.`);
    console.error(`Run \`down\` first if you want to re-seed.\n`);
    process.exitCode = 1;
    return;
  }

  const ref = await readReference(pool);

  console.log(
    `\nSeeding against ${ref.vehicles.length} vehicles, ${ref.drivers.length} drivers, ` +
    `${ref.routes.length} routes\nWindow ${WINDOW_START} + ${WINDOW_DAYS} days, ${TRIP_TARGET} trips\n`
  );

  const plan = buildPlan(makeRng(SEED_RNG), ref);
  const problems = validatePlan(plan);
  if (problems.length) {
    console.error(`Refusing to seed — ${problems.length} generated value(s) do not fit their columns:`);
    for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  const ids = {};
  const odometers = {};
  for (const v of ref.vehicles) odometers[v.vehicle_id] = Number(v.mileage) || 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = { query: (t, p) => client.query(t, p) };

    // -- reference tables --------------------------------------------------
    ids.service_types = await insertMany(
      tx, "service_types",
      ["service_name", "description", "sort_order", "default_category_id", "status"],
      SEED_SERVICE_TYPES.map(([name, desc, order], i) => [
        name, `${desc} ${MARK}`, order,
        ref.categories[i % ref.categories.length].category_id, "Active",
      ]),
      "service_type_id"
    );

    ids.booking_channels = await insertMany(
      tx, "booking_channels",
      ["channel_name", "source_system", "description", "status"],
      SEED_CHANNELS.map(([name, system, desc]) => [name, system, `${desc} ${MARK}`, "Active"]),
      "channel_id"
    );

    // Composite-PK table: the ledger stores the whole key, not an id.
    const prefRows = [];
    for (const employee_id of ref.employees.staff) {
      for (const [event_key, defaults] of SEED_PREFERENCES) {
        for (const [channel, enabled] of Object.entries(defaults)) {
          prefRows.push([employee_id, event_key, channel, enabled]);
        }
      }
    }
    await insertMany(
      tx, "notification_preferences",
      ["employee_id", "event_key", "channel", "enabled"], prefRows
    );
    ids.notification_preferences = prefRows.map(([e, k, c]) => [e, k, c]);

    // -- the request -> dispatch -> trip chain ------------------------------
    ids.transportation_requests = await insertMany(
      tx, "transportation_requests",
      ["external_booking_id", "source_system", "booking_reference", "guest_name",
       "pickup_location", "dropoff_location", "pickup_datetime", "passenger_count",
       "special_requests", "service_type_id", "priority", "booking_status",
       "fleet_status", "reservation_number", "requested_category_id",
       "estimated_distance", "estimated_duration", "vehicle_id", "driver_id",
       "reviewed_by", "reviewed_at", "approved_by", "approved_at", "is_vip",
       "created_at"],
      plan.requests.map((r) => [
        r.external_booking_id, "PMS", `BK-${r.external_booking_id}`, r.guest_name,
        r.pickup_location, r.dropoff_location, r.pickup_datetime, r.passenger_count,
        MARK, ids.service_types[r.service_slot], r.priority, "Approved",
        "Completed", r.reservation_number, r.requested_category_id,
        r.estimated_distance, r.estimated_duration, r.vehicle_id, r.driver_id,
        r.reviewed_by, r.reviewed_at, r.approved_by, r.approved_at, r.is_vip,
        r.reviewed_at,
      ]),
      "request_id"
    );

    // Status 'Completed' matters beyond realism: trg_dispatch_overlap only scans
    // Scheduled/In Progress rows, so a historical backfill cannot trip the
    // double-booking guard on vehicles that are legitimately reused all quarter.
    ids.dispatchschedules = await insertMany(
      tx, "dispatchschedules",
      ["dispatch_number", "vehicle_id", "driver_id", "route_id", "request_id",
       "scheduled_departure", "scheduled_arrival", "actual_departure",
       "actual_arrival", "status", "priority", "notes", "created_by", "created_at"],
      plan.dispatches.map((d, i) => [
        d.dispatch_number, d.vehicle_id, d.driver_id, d.route_id,
        ids.transportation_requests[i], d.scheduled_departure, d.scheduled_arrival,
        d.actual_departure, d.actual_arrival, "Completed", "Normal", MARK,
        d.created_by, d.scheduled_departure,
      ]),
      "dispatch_id"
    );

    ids.trips = await insertMany(
      tx, "trips",
      ["vehicle_id", "driver_id", "dispatch_id", "route_id", "start_time",
       "end_time", "distance", "actual_duration", "trip_status", "start_odometer",
       "end_odometer", "fuel_consumed", "avg_speed", "max_speed", "idle_time",
       "notes", "fuel_cost", "toll_fees", "parking_fees", "driver_cost",
       "maintenance_cost", "miscellaneous_cost", "total_cost", "cost_per_km",
       "on_time_completion", "time_variance", "fuel_efficiency",
       "smooth_driving_score", "customer_rating", "created_by", "created_at"],
      plan.trips.map((t, i) => [
        t.vehicle_id, t.driver_id, ids.dispatchschedules[i], t.route_id,
        t.start_time, t.end_time, t.distance, t.actual_duration, "Completed",
        t.start_odometer, t.end_odometer, t.fuel_consumed, t.avg_speed, t.max_speed,
        t.idle_time, MARK, t.fuel_cost, t.toll_fees, t.parking_fees, t.driver_cost,
        t.maintenance_cost, t.miscellaneous_cost, t.total_cost, t.cost_per_km,
        t.on_time_completion, t.time_variance, t.fuel_efficiency,
        t.smooth_driving_score, t.customer_rating, ref.employees.dispatcher,
        t.start_time,
      ]),
      "trip_id"
    );

    ids.fuelrecords = await insertMany(
      tx, "fuelrecords",
      ["vehicle_id", "driver_id", "trip_id", "liters", "amount", "price_per_liter",
       "odometer", "fuel_type", "fuel_date", "station_name", "status",
       "approved_by", "approved_at", "created_by", "created_at"],
      plan.fuel.map((f) => [
        f.vehicle_id, f.driver_id, ids.trips[f.tripIndex], f.liters, f.amount,
        f.price_per_liter, f.odometer, f.fuel_type, f.fuel_date, f.station_name,
        "Approved", f.approved_by, `${f.fuel_date}T18:00:00${TZ}`,
        ref.employees.dispatcher, `${f.fuel_date}T18:00:00${TZ}`,
      ]),
      "fuel_record_id"
    );

    ids.driverincidents = await insertMany(
      tx, "driverincidents",
      ["driver_id", "vehicle_id", "trip_id", "incident_type", "incident_date",
       "description", "location", "severity", "is_at_fault", "status",
       "expense_amount"],
      plan.incidents.map((c) => [
        c.driver_id, c.vehicle_id, ids.trips[c.tripIndex], c.incident_type,
        c.incident_date, `${c.incident_type} during a transfer. ${MARK}`,
        c.location, c.severity, c.is_at_fault, "Resolved", c.expense_amount,
      ]),
      "incident_id"
    );

    // -- independent tables -------------------------------------------------
    ids.driverattendance = await insertMany(
      tx, "driverattendance",
      ["driver_id", "date", "time_in", "time_out", "check_in_method",
       "face_confidence", "face_verified", "status", "remarks"],
      plan.attendance.map((a) => [
        a.driver_id, a.date, a.time_in, a.time_out, a.check_in_method,
        a.face_confidence, a.face_verified, a.status, MARK,
      ]),
      "attendance_id"
    );

    ids.vehiclemaintenance = await insertMany(
      tx, "vehiclemaintenance",
      ["vehicle_id", "maintenance_type", "description", "maintenance_date",
       "completed_date", "cost", "mileage_at_service", "service_provider",
       "status", "priority", "remarks", "created_by"],
      plan.maintenance.map((m) => [
        m.vehicle_id, m.maintenance_type, m.description, m.maintenance_date,
        m.completed_date, m.cost, m.mileage_at_service, m.service_provider,
        "Completed", "Normal", MARK, m.created_by,
      ]),
      "maintenance_id"
    );

    ids.vehicleinspection = await insertMany(
      tx, "vehicleinspection",
      ["vehicle_id", "driver_id", "inspection_type", "inspection_date",
       "checklist", "findings", "severity", "status"],
      plan.inspections.map((s) => [
        s.vehicle_id, s.driver_id, s.inspection_type, s.inspection_date,
        s.checklist, `${s.findings} ${MARK}`, s.severity, s.status,
      ]),
      "inspection_id"
    );

    // Coding violations for the dispatches that genuinely conflict — see the
    // derivation in buildPlan. 'approved'/'denied' rows also carry a decision,
    // because decideViolation() sets those three columns together and a row with
    // action='approved' but no decided_by is a state the app cannot produce.
    ids.uvvrp_violations = await insertMany(
      tx, "uvvrp_violations",
      ["vehicle_id", "dispatch_id", "scheduled_departure", "weekday",
       "plate_digit", "action", "reason", "created_by", "decided_by",
       "decided_at", "decision_reason"],
      plan.coding.map((c) => {
        const decided = c.action === "approved" || c.action === "denied";
        return [
          c.vehicle_id, ids.dispatchschedules[c.dispatchIndex], c.departure,
          c.weekday, c.digit, c.action,
          `Vehicle is number-coding restricted (ends ${c.digit}) on ${c.weekday}. ${MARK}`,
          ref.employees.dispatcher,
          decided ? ref.employees.manager : null,
          decided ? c.departure : null,
          decided ? `Guest transfer could not be rescheduled. ${MARK}` : null,
        ];
      }),
      "violation_id"
    );

    // ai_insights has exactly one route touching it — a dismiss-by-id PUT. There
    // is no route that creates an insight and none that lists them, so 'Active'
    // is the only status value not pinned by app code ('Dismissed' is what the
    // dismiss route writes). Rows here make the dismiss path reachable at all;
    // they cannot make the table reachable from the UI.
    ids.ai_insights = await insertMany(
      tx, "ai_insights",
      ["insight_type", "title", "description", "impact", "category",
       "confidence_score", "status"],
      [
        ["utilization", "Two vehicles carry most of the airport work",
         `Trip volume is concentrated on a minority of the fleet over the seeded quarter. ${MARK}`,
         "Medium", "Fleet", 0.78, "Active"],
        ["cost", "Cost per kilometer is highest on the shortest route",
         `Fixed per-trip costs dominate on transfers under 5 km. ${MARK}`,
         "High", "Finance", 0.83, "Active"],
        ["punctuality", "Late departures cluster in the evening peak",
         `On-time completion drops for departures after 17:00. ${MARK}`,
         "Medium", "Operations", 0.71, "Active"],
      ],
      "insight_id"
    );

    // No route reads or writes ai_recommendations anywhere in src/. Every column
    // vocabulary below is this script's own invention, because there is no app
    // code to take it from. Seeding it proves the table accepts rows and nothing
    // more.
    ids.ai_recommendations = await insertMany(
      tx, "ai_recommendations",
      ["recommendation_type", "reference_type", "reference_id",
       "recommendation_data", "confidence_score", "explanation", "user_id"],
      [
        ["maintenance_window", "vehicle", ref.vehicles[0].vehicle_id,
         JSON.stringify({ suggest: "advance next service", basis: "km since last service" }),
         0.74, `Distance accumulated faster than the interval assumes. ${MARK}`,
         ref.employees.manager],
        ["shift_balance", "driver", ref.drivers[0].driver_id,
         JSON.stringify({ suggest: "rebalance evening shifts", basis: "late-departure rate" }),
         0.69, `Evening assignments concentrate on a few drivers. ${MARK}`,
         ref.employees.manager],
      ],
      "recommendation_id"
    );

    // -- odometers ----------------------------------------------------------
    // GREATEST, not a bare assignment: the live row may already sit above the
    // seeded walk, and maintenance-schedule.service.js treats mileage as
    // forward-only. The pre-seed value is in the ledger either way.
    for (const v of ref.vehicles) {
      const { rows } = await tx.query(
        `SELECT COALESCE(MAX(end_odometer), 0) AS m FROM trips
          WHERE vehicle_id = $1 AND trip_id = ANY($2::int[])`,
        [v.vehicle_id, ids.trips]
      );
      const reached = Number(rows[0].m) || 0;
      if (reached > 0) {
        await tx.query(
          `UPDATE vehicles SET mileage = GREATEST(mileage, $1) WHERE vehicle_id = $2`,
          [reached, v.vehicle_id]
        );
      }
    }

    // -- ledger -------------------------------------------------------------
    // Written inside the same transaction as the data. A ledger committed
    // separately could describe rows that were rolled back, or miss rows that
    // were not — either way `down` would be operating on fiction.
    const ledger = {
      planted_at: new Date().toISOString(),
      window: { start: WINDOW_START, days: WINDOW_DAYS, end: dayStr(WINDOW_DAYS - 1) },
      trips_planned: TRIP_TARGET,
      marker: MARK,
      ids,
      odometers,
    };
    await tx.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
      [SEED_KEY, JSON.stringify(ledger)]
    );

    await client.query("COMMIT");

    console.log("Inserted:");
    for (const [k, v] of Object.entries(ids)) {
      if (Array.isArray(v) && v.length) console.log(`  ${String(v.length).padStart(6)}  ${k}`);
    }
    console.log(`\nLedger written to system_settings['${SEED_KEY}'].`);
    console.log(`Reverse with: node scripts/seed-demo.mjs down\n`);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function cmdDown(pool) {
  const ledger = await readLedger(pool);
  if (!ledger) {
    console.log(`\nNo seed ledger (${SEED_KEY}) — nothing to remove.\n`);
    return;
  }
  const ids = ledger.ids ?? {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const del = async (label, sql, params) => {
      const res = await client.query(sql, params);
      if (res.rowCount) console.log(`  ${String(res.rowCount).padStart(6)}  ${label}`);
    };

    // Notifications the triggers wrote in response to the inserts. These have no
    // ledger ids of their own — trg_notify_dispatch_created and
    // trg_notify_maintenance_due fired inside the seeding transaction — so they
    // are matched on the reference they point at, which is still exact.
    if (ids.dispatchschedules?.length) {
      await del("notifications (dispatch)",
        `DELETE FROM notifications WHERE reference_type = 'dispatch' AND reference_id = ANY($1::int[])`,
        [ids.dispatchschedules]);
    }
    if (ids.vehiclemaintenance?.length) {
      await del("notifications (maintenance)",
        `DELETE FROM notifications WHERE reference_type = 'maintenance' AND reference_id = ANY($1::int[])`,
        [ids.vehiclemaintenance]);
    }
    if (ids.trips?.length) {
      await del("notifications (trip)",
        `DELETE FROM notifications WHERE reference_type = 'trip' AND reference_id = ANY($1::int[])`,
        [ids.trips]);
    }

    // FK order: children before parents. gpstracking is swept by trip id even
    // though this script does not create any, so a later addition cannot leave
    // an orphan blocking the trip delete.
    const order = [
      ["gpstracking", "trip_id", ids.trips],
      ["fuelrecords", "fuel_record_id", ids.fuelrecords],
      ["driverincidents", "incident_id", ids.driverincidents],
      ["uvvrp_violations", "violation_id", ids.uvvrp_violations],
      ["trips", "trip_id", ids.trips],
      ["dispatchschedules", "dispatch_id", ids.dispatchschedules],
      ["transportation_requests", "request_id", ids.transportation_requests],
      ["driverattendance", "attendance_id", ids.driverattendance],
      ["vehiclemaintenance", "maintenance_id", ids.vehiclemaintenance],
      ["vehicleinspection", "inspection_id", ids.vehicleinspection],
      ["ai_insights", "insight_id", ids.ai_insights],
      ["ai_recommendations", "recommendation_id", ids.ai_recommendations],
      ["service_types", "service_type_id", ids.service_types],
      ["booking_channels", "channel_id", ids.booking_channels],
    ];
    for (const [table, key, list] of order) {
      if (!list?.length) continue;
      await del(table, `DELETE FROM ${table} WHERE ${key} = ANY($1::int[])`, [list]);
    }

    for (const [employee_id, event_key, channel] of ids.notification_preferences ?? []) {
      await client.query(
        `DELETE FROM notification_preferences
          WHERE employee_id = $1 AND event_key = $2 AND channel = $3`,
        [employee_id, event_key, channel]
      );
    }

    for (const [vehicle_id, mileage] of Object.entries(ledger.odometers ?? {})) {
      await client.query(`UPDATE vehicles SET mileage = $1 WHERE vehicle_id = $2`,
        [mileage, Number(vehicle_id)]);
    }
    console.log(`  ${String(Object.keys(ledger.odometers ?? {}).length).padStart(6)}  odometers restored`);

    await client.query(`DELETE FROM system_settings WHERE setting_key = $1`, [SEED_KEY]);
    await client.query("COMMIT");
    console.log(`\nLedger ${SEED_KEY} removed. The seed is fully reversed.\n`);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

const COMMANDS = { status: cmdStatus, plan: cmdPlan, up: cmdUp, down: cmdDown };

const cmd = process.argv[2] ?? "status";
if (!COMMANDS[cmd]) {
  console.error(`Unknown command "${cmd}". Use: status | plan | up | down`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local or .env).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await COMMANDS[cmd](pool);
} catch (e) {
  console.error(`\n${cmd} failed: ${e.message}\n`);
  if (e.detail) console.error(`  detail: ${e.detail}`);
  if (e.constraint) console.error(`  constraint: ${e.constraint}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
