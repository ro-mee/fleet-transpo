// Does the predictive maintenance feature hold up against the live database?
//
// The unit tests prove the engine is correct for the rows they hand it. They
// cannot prove the rows the database actually produces look anything like those
// fixtures. That gap is what this script closes:
//
//   1. Migration 018 landed: vehicles.service_interval_km / _days exist as
//      nullable INT, and no row carries 0 — NULL means "this axis does not
//      predict", 0 would mean "due immediately, forever".
//   2. The endpoint's FLEET_SQL runs against the real schema and returns the
//      column names the engine reads. A renamed or mistyped column would show
//      up here as every vehicle silently scoring 50.
//   3. The engine's own invariants hold on live rows: predictions sort by
//      urgency with unscheduled vehicles last, and summary counts reconcile
//      against a recount of the array.
//   4. A vehicle resolves on the mileage axis — the whole point of the feature.
//      Live data may not contain a qualifying vehicle (it needs a service
//      mileage, five completed trips in the window, and a mileage projection
//      sooner than its calendar date); when it does not, that is reported as
//      NOT EXERCISED, not as a pass, and a synthetic row proves the axis works.
//   5. A vehicle with no trips in the window falls back to calendar only:
//      confidence "low", never basis "mileage", and a recommendation that says
//      so instead of presenting a guess as a projection.
//   6. Dates survive the trip through the engine. pg hands DATE columns back as
//      Dates pinned to LOCAL midnight; reading UTC components off one shifts
//      the day backward at UTC+8. Every prediction's next_service_date is
//      compared against the same date formatted by PostgreSQL itself.
//
// Read-only probe (SELECT only, no writes). Safe to run against a shared dev
// database — it inserts nothing, updates nothing, and deletes nothing.
//
// Credentials are never hardcoded — DATABASE_URL is read from .env.local at
// runtime, the same variable src/lib/db.js uses.
//
// Run: node --import ./scripts/alias-loader.mjs scripts/verify-predictive-maintenance.mjs
import pg from "pg";
import { loadEnvLocal } from "./load-env.mjs";

// Imported through the alias loader rather than reimplemented, so this checks
// the code the endpoint runs. A copy here would pass while the real engine broke.
const {
  predictFleet,
  predictVehicle,
  USAGE_WINDOW_DAYS,
  MIN_TRIPS_FOR_CONFIDENCE,
} = await import("@/lib/ai/predictive-maintenance");

// Copied verbatim from src/app/api/ai/predictive-maintenance/route.js. Kept in
// step by hand: importing the route would drag in next/server and the auth
// stack for no gain, and the point of this check is that THIS text runs.
const FLEET_SQL = `
  WITH usage AS (
    SELECT vehicle_id,
           SUM(distance)                    AS km_90d,
           COUNT(*)                         AS trip_count,
           COUNT(DISTINCT DATE(end_time))   AS active_days
      FROM trips
     WHERE trip_status = 'Completed'
       AND deleted_at IS NULL
       AND end_time > NOW() - ($1 || ' days')::INTERVAL
     GROUP BY vehicle_id
  ),
  history AS (
    SELECT vehicle_id,
           COUNT(*) FILTER (WHERE maintenance_type <> 'Routine') AS corrective_count,
           COUNT(*)                                             AS total_count
      FROM vehiclemaintenance
     WHERE deleted_at IS NULL
       AND status = 'Completed'
       AND maintenance_date > NOW() - INTERVAL '365 days'
     GROUP BY vehicle_id
  )
  SELECT v.vehicle_id, v.plate_number, v.vehicle_name, v.mileage,
         v.next_service_date, v.next_service_mileage, v.last_service_date,
         v.service_interval_km, v.service_interval_days, v.vehicle_status,
         u.km_90d, u.trip_count, u.active_days,
         h.corrective_count, h.total_count
    FROM vehicles v
    LEFT JOIN usage   u ON u.vehicle_id = v.vehicle_id
    LEFT JOIN history h ON h.vehicle_id = v.vehicle_id
   WHERE v.deleted_at IS NULL
     AND v.vehicle_status <> 'Decommissioned'
`;

/** Every column predictVehicle or computeUsageRate reads off a row. */
const REQUIRED_COLUMNS = [
  "vehicle_id", "plate_number", "vehicle_name", "mileage",
  "next_service_date", "next_service_mileage", "last_service_date",
  "km_90d", "trip_count", "active_days", "corrective_count", "total_count",
];

let pass = 0;
const failures = [];
const notes = [];

function check(label, condition, detail) {
  if (condition) pass++;
  else failures.push(detail ? `${label}\n      ${detail}` : label);
}

/** Something true of the data, not of the code. Reported, never counted. */
function note(text) {
  notes.push(text);
}

loadEnvLocal();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  // Supabase terminates TLS with a cert this client won't have in its trust
  // store; the app's pool relies on the sslmode in the URL for the same reason.
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  // --- 1. Migration 018 columns exist, nullable, and never 0 ----------------
  const { rows: intervalCols } = await client.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'vehicles'
        AND column_name IN ('service_interval_km', 'service_interval_days')`
  );
  const byName = Object.fromEntries(intervalCols.map((c) => [c.column_name, c]));
  for (const col of ["service_interval_km", "service_interval_days"]) {
    check(
      `vehicles.${col} exists as a nullable integer`,
      byName[col]?.data_type === "integer" && byName[col]?.is_nullable === "YES",
      byName[col]
        ? `got ${byName[col].data_type}, nullable=${byName[col].is_nullable}`
        : "column missing — migration 018 has not been applied"
    );
  }

  const { rows: zeroIntervals } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE service_interval_km = 0)::int   AS zero_km,
            COUNT(*) FILTER (WHERE service_interval_days = 0)::int AS zero_days,
            COUNT(*) FILTER (WHERE service_interval_km < 0
                          OR service_interval_days < 0)::int       AS negative
       FROM vehicles
      WHERE deleted_at IS NULL`
  );
  const { zero_km, zero_days, negative } = zeroIntervals[0];
  check(
    "no vehicle carries a zero service interval",
    zero_km === 0 && zero_days === 0,
    // A 0 interval is not inert: deriveNextSchedule adds it to the completion
    // date and odometer, so the vehicle is due the instant it is serviced and
    // permanently overdue after that. The API now rejects 0 (min: 1), but a
    // row predating that guard would still be in the table.
    `${zero_km} with km = 0, ${zero_days} with days = 0`
  );
  check("no vehicle carries a negative service interval", negative === 0, `${negative} rows`);

  // --- 2. FLEET_SQL runs and yields the columns the engine reads -------------
  const { rows } = await client.query(FLEET_SQL, [String(USAGE_WINDOW_DAYS)]);
  check("FLEET_SQL returns at least one vehicle", rows.length > 0, `${rows.length} rows`);

  if (rows.length === 0) {
    throw new Error(
      "No active vehicles — nothing to verify. Seed the fleet and re-run."
    );
  }

  const returned = new Set(Object.keys(rows[0]));
  const missing = REQUIRED_COLUMNS.filter((c) => !returned.has(c));
  check(
    "FLEET_SQL returns every column the engine reads",
    missing.length === 0,
    `missing: ${missing.join(", ")}`
  );

  // --- 3. Engine invariants on live rows ------------------------------------
  // One clock for the whole fleet, exactly as the endpoint does it — otherwise
  // a run crossing midnight would rank two vehicles against different todays.
  const now = new Date();
  const { predictions, summary } = predictFleet(rows, now);

  check(
    "every row produced a prediction",
    predictions.length === rows.length,
    `${predictions.length} predictions from ${rows.length} rows`
  );

  const scheduled = predictions.filter((p) => p.effectiveDays !== null);
  const unscheduled = predictions.filter((p) => p.effectiveDays === null);
  const firstUnscheduledAt = predictions.findIndex((p) => p.effectiveDays === null);
  check(
    "unscheduled vehicles sort last",
    firstUnscheduledAt === -1 || firstUnscheduledAt === scheduled.length,
    `first unscheduled at index ${firstUnscheduledAt}, ${scheduled.length} scheduled`
  );

  const outOfOrder = scheduled.findIndex(
    (p, i) => i > 0 && p.effectiveDays < scheduled[i - 1].effectiveDays
  );
  check(
    "scheduled vehicles sort by urgency, soonest first",
    outOfOrder === -1,
    outOfOrder === -1
      ? ""
      : `${scheduled[outOfOrder].plate_number} (${scheduled[outOfOrder].effectiveDays}d) after ` +
        `${scheduled[outOfOrder - 1].plate_number} (${scheduled[outOfOrder - 1].effectiveDays}d)`
  );

  const recount = { overdue: 0, critical: 0, high: 0, medium: 0, low: 0 };
  for (const p of predictions) recount[p.risk] += 1;
  for (const band of Object.keys(recount)) {
    check(
      `summary.${band} matches a recount of the predictions`,
      summary[band] === recount[band],
      `summary says ${summary[band]}, recount says ${recount[band]}`
    );
  }
  check(
    "the five bands sum to summary.total",
    Object.values(recount).reduce((a, b) => a + b, 0) === summary.total,
    `bands sum to ${Object.values(recount).reduce((a, b) => a + b, 0)}, total is ${summary.total}`
  );
  check(
    "summary.unscheduled matches the count with no basis",
    summary.unscheduled === unscheduled.length,
    `summary says ${summary.unscheduled}, recount says ${unscheduled.length}`
  );

  const badScore = predictions.find(
    (p) => !Number.isInteger(p.score) || p.score < 0 || p.score > 100
  );
  check(
    "every health score is an integer in 0-100",
    badScore === undefined,
    badScore ? `${badScore.plate_number} scored ${badScore.score}` : ""
  );

  const emptyRecommendation = predictions.find(
    (p) => typeof p.recommendation !== "string" || p.recommendation.trim() === ""
  );
  check(
    "every prediction carries a recommendation",
    emptyRecommendation === undefined,
    emptyRecommendation ? `${emptyRecommendation.plate_number} has none` : ""
  );

  // --- 4. A vehicle resolves on the mileage axis -----------------------------
  const mileageBased = predictions.filter((p) => p.basis === "mileage");
  if (mileageBased.length > 0) {
    const m = mileageBased[0];
    check(
      "a mileage-based prediction carries the rate that produced it",
      m.kmPerDay > 0 && m.confidence === "high" && m.projectedDaysToService !== null,
      `${m.plate_number}: kmPerDay=${m.kmPerDay}, confidence=${m.confidence}, projected=${m.projectedDaysToService}`
    );
    check(
      "a mileage-based recommendation names km and the burn rate",
      /km/.test(m.recommendation) && /km\/day/.test(m.recommendation),
      `${m.plate_number}: ${m.recommendation}`
    );
    // Mileage only wins when it is the sooner of the two axes.
    check(
      "the mileage projection is the sooner of the two axes",
      m.daysToService === null || m.projectedDaysToService <= m.daysToService,
      `${m.plate_number}: projected ${m.projectedDaysToService}d vs calendar ${m.daysToService}d`
    );
    note(
      `${mileageBased.length} of ${predictions.length} vehicles predict on mileage; ` +
        `example ${mileageBased[0].plate_number} at ~${Math.round(mileageBased[0].kmPerDay)} km/day`
    );
  } else {
    note(
      "NOT EXERCISED by live data: no vehicle currently predicts on mileage. " +
        `A vehicle needs next_service_mileage set, ${MIN_TRIPS_FOR_CONFIDENCE}+ completed trips ` +
        `with distance in the last ${USAGE_WINDOW_DAYS} days, and a mileage projection sooner ` +
        "than its calendar date. The synthetic check below proves the axis itself works."
    );
    // Proves the code path, not the data. A row shaped like the live ones: 4,500
    // km remaining at 90 km/day is 50 days, well inside a 200-day calendar date.
    const synthetic = predictVehicle(
      {
        vehicle_id: 0,
        plate_number: "SYNTHETIC",
        mileage: "50500.00",
        next_service_mileage: "55000.00",
        next_service_date: new Date(now.getTime() + 200 * 86400000),
        km_90d: "8100",
        trip_count: "30",
        active_days: "45",
      },
      now
    );
    check(
      "the mileage axis wins on a synthetic row that should trigger it",
      synthetic.basis === "mileage" && synthetic.effectiveDays === 50,
      `got basis=${synthetic.basis}, effectiveDays=${synthetic.effectiveDays}`
    );
  }

  // --- 5. No trips in the window means calendar only ------------------------
  const noTrips = predictions.filter((p) => {
    const row = rows.find((r) => r.vehicle_id === p.vehicle_id);
    return row && (row.trip_count === null || Number(row.trip_count) === 0);
  });
  if (noTrips.length > 0) {
    const thin = noTrips.find((p) => p.basis !== null) ?? noTrips[0];
    check(
      "a vehicle with no trips reports low confidence",
      noTrips.every((p) => p.confidence === "low"),
      noTrips
        .filter((p) => p.confidence !== "low")
        .map((p) => `${p.plate_number}=${p.confidence}`)
        .join(", ")
    );
    check(
      "a vehicle with no trips never predicts on mileage",
      noTrips.every((p) => p.basis !== "mileage"),
      noTrips
        .filter((p) => p.basis === "mileage")
        .map((p) => p.plate_number)
        .join(", ")
    );
    check(
      "a vehicle with no trips has zero km/day",
      noTrips.every((p) => p.kmPerDay === 0),
      noTrips
        .filter((p) => p.kmPerDay !== 0)
        .map((p) => `${p.plate_number}=${p.kmPerDay}`)
        .join(", ")
    );
    if (thin.basis === "time") {
      check(
        "a calendar-only recommendation says so rather than implying a projection",
        /calendar only/i.test(thin.recommendation),
        `${thin.plate_number}: ${thin.recommendation}`
      );
    } else {
      note(
        `Every tripless vehicle also lacks a schedule, so the "calendar only" wording ` +
          "was not exercised; the low-confidence and zero-rate checks above still ran."
      );
    }
    note(`${noTrips.length} of ${predictions.length} vehicles logged no completed trips in the window.`);
  } else {
    note(
      `NOT EXERCISED by live data: every vehicle has completed trips in the last ` +
        `${USAGE_WINDOW_DAYS} days, so the tripless fallback was not reached.`
    );
  }

  // --- 6. Dates survive the engine at this machine's UTC offset --------------
  // PostgreSQL formats the same column, so the comparison is against the
  // database's own idea of the calendar day, not against a second JS conversion.
  const { rows: dbDays } = await client.query(
    `SELECT vehicle_id,
            to_char(next_service_date, 'YYYY-MM-DD') AS next_day,
            to_char(last_service_date, 'YYYY-MM-DD') AS last_day
       FROM vehicles
      WHERE deleted_at IS NULL
        AND vehicle_status <> 'Decommissioned'`
  );
  const dayById = Object.fromEntries(dbDays.map((r) => [r.vehicle_id, r]));
  const dateMismatches = predictions.filter((p) => {
    const expected = dayById[p.vehicle_id];
    if (!expected) return false;
    return (
      p.next_service_date !== (expected.next_day ?? null) ||
      p.last_service_date !== (expected.last_day ?? null)
    );
  });
  check(
    "predicted service dates match the days PostgreSQL formats",
    dateMismatches.length === 0,
    dateMismatches
      .slice(0, 5)
      .map(
        (p) =>
          `${p.plate_number}: engine ${p.next_service_date}/${p.last_service_date} ` +
          `vs db ${dayById[p.vehicle_id].next_day}/${dayById[p.vehicle_id].last_day}`
      )
      .join("; ")
  );
  note(
    `Local UTC offset during this run: ${-new Date().getTimezoneOffset() / 60} hours. ` +
      "The day-shift bug this guards is invisible at UTC+0."
  );

  // --- Report ---------------------------------------------------------------
  console.log(`\npredictive maintenance: ${pass} passed, ${failures.length} failed`);

  const bands = ["overdue", "critical", "high", "medium", "low"]
    .map((b) => `${b}=${summary[b]}`)
    .join(", ");
  console.log(`\nfleet: ${summary.total} vehicles — ${bands}`);
  console.log(`unscheduled (no date and no mileage): ${summary.unscheduled}`);
  console.log(
    `basis: mileage=${predictions.filter((p) => p.basis === "mileage").length}, ` +
      `time=${predictions.filter((p) => p.basis === "time").length}, ` +
      `none=${predictions.filter((p) => p.basis === null).length}`
  );
  console.log(
    `confidence: high=${predictions.filter((p) => p.confidence === "high").length}, ` +
      `low=${predictions.filter((p) => p.confidence === "low").length}`
  );

  console.log("\nmost urgent five:");
  for (const p of predictions.slice(0, 5)) {
    console.log(
      `  ${String(p.plate_number ?? "—").padEnd(12)} ${String(p.risk).padEnd(9)} ` +
        `score=${String(p.score).padStart(3)} basis=${p.basis ?? "none"} — ${p.recommendation}`
    );
  }

  if (notes.length > 0) {
    console.log("\nnotes:");
    for (const n of notes) console.log(`  • ${n}`);
  }

  if (failures.length > 0) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log("\n✓ predictive maintenance verified against the live database");
  }
} finally {
  await client.end();
}
