// Verifies the End Duty "unreported day" path: the statement that names a past
// day still owing a report, the date-aware vehicle resolver, and the guards that
// stand between the real On Leave/Absent rows and a spurious prompt.
//
// Why this exists, in the words of the task that added it: EVERY statement below is
// executed by ZERO unit tests, because every test in
// `src/app/api/mobile/driver/duty/route.test.js` mocks `query`. A malformed
// statement, a wrong column or a `date` that does not parse would leave that suite
// fully green forever.
//
// The SQL is read OUT of the route and service sources and run as that text, never as
// a copy. A live check that evaluates its own copy of a statement tracks the copy, not
// the code, and cannot fail when the code regresses — the mistake
// verify-duty-autoclose.mjs documents at its lateness-boundary block. If the
// statements cannot be read, this fails loudly rather than testing nothing.
//
// Every expected day is fetched from SQL in Manila time, never computed from this
// machine's clock: this box is not guaranteed to be at +08:00.
//
// Everything runs in ONE transaction that ends in ROLLBACK, including on the error
// path. Nothing this script writes survives it.
//
// Run: npm run verify:unreported-duty
import { loadEnvLocal } from "./load-env.mjs";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { toCalendarDay } from "../src/lib/dates.js";

loadEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run via: npm run verify:unreported-duty");
  process.exit(1);
}

const routeSrc = readFileSync(new URL("../src/app/api/mobile/driver/duty/route.js", import.meta.url), "utf8");
// Two of the statements live in the SERVICE, not the route: the id-keyed recovery SELECT
// (round 4) and the no-vehicle close. They are read from here and run as this text.
const serviceSrc = readFileSync(new URL("../src/services/standby.service.js", import.meta.url), "utf8");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const failures = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

// Pull the template literal straight out of the named function, so this follows a
// refactor instead of drifting from it — and returns null (failing loudly below)
// rather than silently testing nothing.
//
// `src` is the file to read from, and `needle` locates WHICH statement inside it: the
// service holds several per function, and a function with more than one would otherwise
// always yield its first — silently running the wrong SQL, and passing. A needle must
// occur inside the statement and nowhere earlier in the function, comments included.
const sqlOf = (fn, src = routeSrc, needle = null) => {
  const start = src.indexOf(`async function ${fn}`);
  if (start < 0) return null;
  const from = needle ? src.indexOf(needle, start) : start;
  if (from < 0) return null;
  const open = needle
    ? src.lastIndexOf("`", from)
    : src.indexOf("`", src.indexOf("await query(", start));
  if (open < start) return null;
  const close = src.indexOf("`", open + 1);
  return close < 0 ? null : src.slice(open + 1, close);
};

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const MANILA_TODAY = "(NOW() AT TIME ZONE 'Asia/Manila')::date";
  // A clock past 04:00 Manila, for driving migration 126's sweep. It has to be TOMORROW's
  // 05:00 rather than today's, because the sweep closes what is older than `p_now`'s own
  // Manila day — today's 05:00 would exclude today. `naive timestamp AT TIME ZONE
  // 'Asia/Manila'` reads the naive value AS Manila time and yields a timestamptz, so this
  // does not depend on the session's zone; Asia/Manila is a fixed +08:00 with no DST.
  const PAST_0400 = `((${MANILA_TODAY} + 1 + TIME '05:00') AT TIME ZONE 'Asia/Manila')`;

  // ---- The source itself -------------------------------------------------
  const unreportedSql = sqlOf("unreportedDuty");
  const resolverSql = sqlOf("resolveReportVehicle");
  const closedSql = sqlOf("closedWithoutReport");
  // The two service statements: the ID-KEYED recovery SELECT (which decides whether a
  // conflicting submission id is a retry or a reuse) and the no-vehicle close. Both are
  // read out of `standby.service.js` through the source parameter above, and both fail
  // loudly if unreadable — a copy of either would track the copy, not the code.
  //
  // The recovery's needle is its column list, which also has to stay clear of the INSERT
  // earlier in the same function: that one names `vehicleinspection` too, so a needle of
  // the table name alone would read the INSERT and then run it as the recovery.
  const recoverySql = sqlOf("endDutyWithReport", serviceSrc, "SELECT inspection_id, inspection_date FROM vehicleinspection");
  const noVehicleSql = sqlOf("endDutyWithReport", serviceSrc, "end_duty_outcome='NoVehicle',");
  // Round 5's two statements, which nothing else reaches: the no-vehicle FIXED POINT
  // (id-keyed and day-keyed, one read, two arms) and `setDuty`'s reopen. The reopen's
  // needle is `ON CONFLICT (driver_id,date) DO UPDATE`, which occurs in that statement
  // and nowhere earlier in the function — my comment above it deliberately does not spell
  // the fragment out, because a needle that appears in a comment would extract the wrong
  // literal.
  const fixedPointSql = sqlOf("endDutyWithReport", serviceSrc, "SELECT end_duty_outcome FROM driverattendance");
  const setDutySql = sqlOf("setDuty", serviceSrc, "ON CONFLICT (driver_id,date) DO UPDATE");
  // The new column and the arbiter index migration 129 added, read from the live catalog
  // rather than assumed. A column carries no privileges of its own, so unlike migration
  // 115 there was nothing to revoke — but that is proven out of band, by `npm run
  // verify:anon` and `npm run db:contract` before and after the apply, which the report
  // records. `driverattendance` holds a TABLE-level grant (`relacl`), not a column-level
  // one (`cols_with_acl = 0`), which is exactly why a new column needs no grant of its own.
  const { rows: [newCol] } = await client.query(
    `SELECT is_nullable, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='driverattendance' AND column_name='end_duty_submission_id'`
  );
  const { rows: [arbiter] } = await client.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='driverattendance'
       AND indexname='uq_attendance_driver_end_duty_submission'`
  );
  const arbiterIsPartialUnique = /UNIQUE INDEX/i.test(arbiter?.indexdef ?? "")
    && /WHERE \(end_duty_submission_id IS NOT NULL\)/.test(arbiter?.indexdef ?? "");
  check("migration 129 added driverattendance.end_duty_submission_id as nullable text",
    [newCol?.is_nullable, newCol?.data_type], ["YES", "text"]);
  check("…and the partial unique index that arbitrates one id to one day", arbiterIsPartialUnique, true);
  check("unreportedDuty's SQL is readable from the route source", Boolean(unreportedSql), true);
  check("resolveReportVehicle's SQL is readable from the route source", Boolean(resolverSql), true);
  check("closedWithoutReport's SQL is readable from the route source", Boolean(closedSql), true);
  check("the id-keyed recovery SELECT is readable from the service source", Boolean(recoverySql), true);
  check("the no-vehicle close is readable from the service source", Boolean(noVehicleSql), true);
  check("the no-vehicle fixed point is readable from the service source", Boolean(fixedPointSql), true);
  check("setDuty's reopen is readable from the service source", Boolean(setDutySql), true);
  // The line the whole task turns on. If it reverts to String(...).slice(0,10) the
  // live checks below go red too, but this names the cause directly.
  check("the unreported day is normalised with toCalendarDay",
    /date:\s*toCalendarDay\(row\.date\)/.test(routeSrc), true);
  check("the resolver is invoked with the report's own day",
    /resolveReportVehicle\(session\.user\.driverId,\s*reportDate\)/.test(routeSrc), true);
  // `report_date` is checked as a CALENDAR day (round 4), not merely for shape: the regex
  // alone admits `2026-02-30`, which reaches a `$::date` in the guard's own queries and
  // makes Postgres raise where the route should have refused. The unit test drives
  // `2026-02-30` and `2026-13-45` through the route; this names the mechanism.
  check("report_date is validated as a real calendar day, not only a well-shaped string",
    /parsed\.getUTCFullYear\(\) === y/.test(routeSrc), true);
  // The type predicate is load-bearing and the DATE predicate is deliberately gone
  // (round 4). Each is proven by BEHAVIOUR further down rather than by this text: the type
  // predicate by the Pre-Shift row, the absence of a date predicate by the day -1 row being
  // recovered for a retry that resolves another day. This check names the cause, so a
  // regression fails here and not only as a confusing behavioural mismatch.
  check("the recovery is scoped to Post-Shift rows and carries no date predicate",
    /inspection_type='Post-Shift'/.test(recoverySql ?? "")
      && !/inspection_date\s*=/.test(recoverySql ?? ""), true);
  // The no-vehicle fixed point, one read with two arms (round 5). Neither subsumes the
  // other: the id arm catches the retry that resolved a DIFFERENT day (the midnight
  // crossing), the day arm catches a request for a day already closed this way arriving
  // under a different id. The day arm's `time_out IS NOT NULL` is what keeps it off a row
  // `setDuty` has reopened, and its loss is shown RED by the unit test in standby.test.js.
  check("the fixed point matches the submission id, day-blind",
    /end_duty_submission_id=\$2/.test(fixedPointSql ?? ""), true);
  check("…and still matches the resolved day, CLOSED",
    /\$3::date/.test(fixedPointSql ?? "") && /time_out IS NOT NULL/.test(fixedPointSql ?? ""), true);
  // The close keeps the FIRST id and appends its remark at most once. Both are load-bearing:
  // an overwriting `$3` would destroy the id the fixed point matches on, and without the
  // CASE a second id appends a second remark. `SET` expressions read the OLD row, so the
  // CASE tests the pre-update outcome.
  check("the no-vehicle close records the submission id without overwriting one",
    /COALESCE\(end_duty_submission_id,\$3\)/.test(noVehicleSql ?? ""), true);
  check("…and guards its remark with a CASE on the pre-update outcome",
    /CASE WHEN end_duty_outcome='NoVehicle' THEN remarks/.test(noVehicleSql ?? ""), true);
  // Defect 1: an open duty has no outcome, so the reopen clears the marker. Without it
  // migration 126's sweep can never reach the row again, and the fixed point reads it as a
  // close — both shown end to end further down rather than only here.
  check("setDuty's reopen clears the stale outcome",
    /end_duty_outcome=NULL/.test(setDutySql ?? ""), true);
  if (!unreportedSql || !resolverSql || !closedSql || !recoverySql || !noVehicleSql || !fixedPointSql || !setDutySql) {
    throw new Error("a statement could not be extracted from its source — fix the extractor.");
  }

  // ---- What could a fixture collide with? --------------------------------
  // Not assumed — read from the live catalog. driverattendance carries
  // idx_attendance_driver_date (driver_id, date), so a fixture insert for a driver
  // who already has a row on that date is a duplicate-key error. vehicleinspection's
  // only non-serial unique index is uq_vehicleinspection_driver_submission, over
  // (driver_id, client_submission_id) WHERE client_submission_id IS NOT NULL — and
  // the inserts below never set that column, so it cannot be hit. A NEW unique index
  // on either table invalidates the collision reasoning here, so it fails at setup
  // naming the index, rather than mid-run at some INSERT.
  //
  // `uq_attendance_driver_end_duty_submission` (migration 129) is the new one, and it is
  // deliberately on the list rather than worked around: the checks below SET
  // `end_duty_submission_id`, so one submission id reaching two rows for one driver is a
  // collision this script relies on being refused — the arbiter check asserts exactly that.
  const { rows: uniq } = await client.query(
    `SELECT t.relname AS tbl, i.relname AS idx
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='public' AND t.relname IN ('driverattendance','vehicleinspection')
        AND ix.indisunique
      ORDER BY t.relname, i.relname`
  );
  const UNIQUE_INDEXES = [
    "driverattendance|driverattendance_pkey",
    "driverattendance|idx_attendance_driver_date",
    "driverattendance|uq_attendance_driver_end_duty_submission",
    "vehicleinspection|uq_vehicleinspection_driver_submission",
    "vehicleinspection|vehicleinspection_pkey",
  ];
  check("the unique indexes these fixtures could collide with are the ones accounted for",
    uniq.map((u) => `${u.tbl}|${u.idx}`).join(", "), UNIQUE_INDEXES.join(", "));

  // ---- Fixtures ----------------------------------------------------------
  // Every date this script writes to. The fixture driver must have NO rows on any of
  // them, and that is what makes the plain INSERTs below safe. Two worse options, and
  // why: ON CONFLICT DO NOTHING would let a collision through as a check that passes
  // while measuring a row this script never created, and DO UPDATE would overwrite a
  // real attendance row inside a script whose whole contract is that it writes
  // nothing. With the window asserted clear, each insert either creates the fixture
  // or raises loudly — there is no quiet third outcome.
  const FIXTURE_WINDOW = `ARRAY[${MANILA_TODAY} - 9, ${MANILA_TODAY} - 8, ${MANILA_TODAY} - 6,
    ${MANILA_TODAY} - 5, ${MANILA_TODAY} - 4, ${MANILA_TODAY} - 3, ${MANILA_TODAY} - 2,
    ${MANILA_TODAY} - 1, ${MANILA_TODAY} + 1]::date[]`;
  const { rows: [driver] } = await client.query(
    `SELECT d.driver_id FROM drivers d
      WHERE d.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM driverattendance a
                         WHERE a.driver_id=d.driver_id AND a.date=ANY(${FIXTURE_WINDOW}))
      ORDER BY d.driver_id LIMIT 1`
  );
  check("a live driver has a clear fixture window to write into", Boolean(driver), true);
  if (!driver) {
    const { rows: busy } = await client.query(
      `SELECT d.driver_id, array_agg(to_char(a.date,'YYYY-MM-DD') ORDER BY a.date) AS days
         FROM drivers d JOIN driverattendance a ON a.driver_id=d.driver_id
        WHERE d.deleted_at IS NULL AND a.date=ANY(${FIXTURE_WINDOW})
        GROUP BY d.driver_id ORDER BY d.driver_id`
    );
    console.error("");
    console.error("NO FIXTURE DRIVER. Every live driver already has at least one attendance row");
    console.error("inside the fixture window (Manila today -9 .. +1), so seeding would collide:");
    for (const b of busy) console.error(`  driver ${b.driver_id}: ${b.days.join(", ")}`);
    console.error("Nothing was written. Clear one driver's window, or seed one more driver.");
    throw new Error("no driver has a clear fixture window");
  }
  const d = driver.driver_id;
  const { rows: [{ occupied }] } = await client.query(
    `SELECT count(*)::int AS occupied FROM driverattendance WHERE driver_id=$1 AND date=ANY(${FIXTURE_WINDOW})`,
    [d]
  );
  check("that driver's whole window is still clear immediately before the first insert", occupied, 0);
  console.log(`       (fixtures go to driver ${d}; the real-row measurement below excludes it)`);

  const { rows: vehicles } = await client.query(
    "SELECT vehicle_id, plate_number FROM vehicles WHERE deleted_at IS NULL ORDER BY vehicle_id LIMIT 2"
  );
  if (!driver || vehicles.length < 2) throw new Error("Need 2 vehicles — seed the database first.");
  const [vPast, vToday] = vehicles;

  // The submission ids the no-vehicle checks drive (round 5, migration 129). Plain
  // distinct strings: the column is `text` and carries no format constraint, and these
  // never reach the route's `/^[0-9a-z-]{16,64}$/i/` — the statement is run directly so
  // that a failure names the SQL rather than a validation rule.
  const NV_ID = "nv-close-0000-0001";         // the id the day -8 row is seeded with
  const NV_OTHER = "nv-close-0000-0002";      // a different id for the same driver
  const NV_REOPEN = "nv-reopen-0000-0003";    // today's close, for the reopen check
  const NV_SPARE = "nv-close-0000-0005";      // the write-once check's FIRST id
  const NV_SPARE2 = "nv-close-0000-0006";     // …and the second, which must not win

  // Two days this driver certainly has no attendance row on, found rather than assumed:
  // the fixture window above only guarantees the RELATIVE days it uses, and a real row on
  // a fixed `-15` would turn the fixtures below into a duplicate-key error mid-run. Ten
  // days out is far enough that `unreportedDuty`'s 7-day window cannot see them either, so
  // they cannot disturb any measurement above.
  const { rows: spareDays } = await client.query(
    `SELECT to_char(${MANILA_TODAY} - n, 'YYYY-MM-DD') AS day
       FROM generate_series(10, 60) AS n
      WHERE NOT EXISTS (SELECT 1 FROM driverattendance a WHERE a.driver_id=$1 AND a.date=${MANILA_TODAY} - n)
      ORDER BY n LIMIT 2`,
    [d]
  );
  check("two days beyond the window are clear for the fixture driver", spareDays.length, 2);
  if (spareDays.length < 2) throw new Error("the fixture driver has attendance rows across two months of history — pick another driver.");
  const [spareDay, spareDay2] = spareDays.map((r) => r.day);

  // Day -1: the shape the sweep leaves behind — AutoClosed, and the vehicle the
  // driver actually drove that day is recoverable from its Pre-Trip.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, time_out, status, check_in_method, end_duty_outcome)
     VALUES ($1, ${MANILA_TODAY} - 1, NOW() - INTERVAL '1 day', NOW() - INTERVAL '20 hours', 'Present', 'manual', 'AutoClosed')`,
    [d]
  );
  await client.query(
    `INSERT INTO vehicleinspection (vehicle_id, driver_id, inspection_type, inspection_date, status)
     VALUES ($1, $2, 'Pre-Trip', ${MANILA_TODAY} - 1, 'Passed')`,
    [vPast.vehicle_id, d]
  );
  // Day -2: a past row that was never worked — no time_in, and On Leave. This is
  // the live shape the guards exist for.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, status, check_in_method)
     VALUES ($1, ${MANILA_TODAY} - 2, 'On Leave', 'manual')`,
    [d]
  );
  // Days -3 and -8: already resolved, and nothing to report against. The -8 row is the
  // no-vehicle close, and since migration 129 it carries the submission id that closed it
  // — which is the only thing that identifies it now (round 5: `closedWithoutReport` is
  // keyed on the id, not the day).
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, time_out, status, check_in_method, end_duty_outcome, end_duty_submission_id)
     VALUES ($1, ${MANILA_TODAY} - 3, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', 'Present', 'manual', 'Reported', NULL),
            ($1, ${MANILA_TODAY} - 8, NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days', 'Present', 'manual', 'NoVehicle', $2)`,
    [d, NV_ID]
  );
  // Day -9: AutoClosed but outside the 7-day window, so it must not be named.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, time_out, status, check_in_method, end_duty_outcome)
     VALUES ($1, ${MANILA_TODAY} - 9, NOW() - INTERVAL '9 days', NOW() - INTERVAL '9 days', 'Present', 'manual', 'AutoClosed')`,
    [d]
  );
  // Day -4: still open (the sweep has not reached it) — the other shape.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, status, check_in_method)
     VALUES ($1, ${MANILA_TODAY} - 4, NOW() - INTERVAL '4 days', 'Present', 'manual')`,
    [d]
  );
  // Days -5 and -6 give EACH guard its own witness. The real On Leave/Absent rows
  // fail both guards at once, so they cannot show which one is load-bearing; these
  // fail exactly one each. -5 is rostered (Present) but never started (no time_in);
  // -6 started but was on approved leave.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, status, check_in_method)
     VALUES ($1, ${MANILA_TODAY} - 5, 'Present', 'manual')`,
    [d]
  );
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, status, check_in_method)
     VALUES ($1, ${MANILA_TODAY} - 6, NOW() - INTERVAL '6 days', 'On Leave', 'manual')`,
    [d]
  );

  const { rows: [{ d1, d2, d3, d4, d5, d6, d8, d9, next, today }] } = await client.query(
    `SELECT to_char(${MANILA_TODAY} - 1, 'YYYY-MM-DD') AS d1,
            to_char(${MANILA_TODAY} - 2, 'YYYY-MM-DD') AS d2,
            to_char(${MANILA_TODAY} - 3, 'YYYY-MM-DD') AS d3,
            to_char(${MANILA_TODAY} - 4, 'YYYY-MM-DD') AS d4,
            to_char(${MANILA_TODAY} - 5, 'YYYY-MM-DD') AS d5,
            to_char(${MANILA_TODAY} - 6, 'YYYY-MM-DD') AS d6,
            to_char(${MANILA_TODAY} - 8, 'YYYY-MM-DD') AS d8,
            to_char(${MANILA_TODAY} - 9, 'YYYY-MM-DD') AS d9,
            to_char(${MANILA_TODAY} + 1, 'YYYY-MM-DD') AS next,
            to_char(${MANILA_TODAY}, 'YYYY-MM-DD') AS today`
  );
  const raw = async () => (await client.query(unreportedSql, [d])).rows[0] ?? null;

  // ---- unreportedDuty, both shapes --------------------------------------
  const row = await raw();
  check("it names the auto-closed day", toCalendarDay(row?.date), d1);
  check("and the vehicle that day's Pre-Trip names", row?.vehicle_id, vPast.vehicle_id);
  check("and that vehicle's plate", row?.plate_number, vPast.plate_number);

  // The premise the toCalendarDay change rests on, checked against live rather than
  // assumed: `pg` really does hand `date` back as a JS Date (the unit tests mock a
  // string, which is why they cannot see this), and the naive slice really does
  // produce a value POST's own /^\d{4}-\d{2}-\d{2}$/ validation refuses.
  check("driverattendance.date arrives as a JS Date, as the fix assumes", row?.date instanceof Date, true);
  const naive = String(row?.date).slice(0, 10);
  console.log(`       (naive String(row.date).slice(0,10) yields ${JSON.stringify(naive)}, not ${d1})`);
  check("the naive slice does NOT yield the day", naive !== d1, true);
  check("…and is not a YYYY-MM-DD day at all", /^\d{4}-\d{2}-\d{2}$/.test(naive), false);
  check("…while the value the route emits is the day and nothing else", toCalendarDay(row?.date), d1);

  // ---- The guards --------------------------------------------------------
  const disjoint = async (sql) => (await client.query(sql, [d])).rows[0] ?? null;

  await client.query(`DELETE FROM driverattendance WHERE driver_id=$1 AND date=${MANILA_TODAY} - 1`, [d]);
  check("with the sweep's row gone it names the still-open day",
    toCalendarDay((await raw())?.date), d4);

  await client.query(`DELETE FROM driverattendance WHERE driver_id=$1 AND date=${MANILA_TODAY} - 4`, [d]);
  check("and reports nothing at all once every past duty is resolved", await raw(), null);
  const { rows: [{ n }] } = await client.query(
    `SELECT count(*)::int AS n FROM driverattendance WHERE driver_id=$1
       AND date IN (${MANILA_TODAY} - 2, ${MANILA_TODAY} - 3, ${MANILA_TODAY} - 5,
                    ${MANILA_TODAY} - 6, ${MANILA_TODAY} - 8, ${MANILA_TODAY} - 9)`,
    [d]
  );
  check("the rows it skipped were really there to be skipped", n, 6);

  // Each mutation removes exactly ONE guard, so a mutation that turns nothing red
  // means the witness for that guard is not exercising it.
  const noTimeIn = unreportedSql.replace("AND a.time_in IS NOT NULL", "");
  check("the time_in guard is in the SQL under test", noTimeIn !== unreportedSql, true);
  check("dropping it names the rostered-but-never-started day — so it is load-bearing",
    toCalendarDay((await disjoint(noTimeIn))?.date), d5);

  const noStatus = unreportedSql.replace("AND a.status IN ('Present','Late','Half-Day')", "");
  check("the status guard is in the SQL under test", noStatus !== unreportedSql, true);
  check("dropping it names the on-leave day — so it is load-bearing",
    toCalendarDay((await disjoint(noStatus))?.date), d6);

  const noWindow = unreportedSql.replace("AND a.date >= (NOW() AT TIME ZONE 'Asia/Manila')::date - 7", "");
  check("the 7-day window is in the SQL under test", noWindow !== unreportedSql, true);
  check("dropping the window names the older auto-closed day — so it is load-bearing",
    toCalendarDay((await disjoint(noWindow))?.date), d9);

  // ---- The same three guards, measured against the REAL rows -------------
  // The witnesses above are seeded, so they prove the guards work on rows shaped
  // the way the guards expect. This asks the other question: what do these guards do
  // to the rows already in the database?
  //
  // Measured per driver, not per row: the app asks this question once per driver, so
  // "did this driver's answer change" is the quantity that decides whether a real
  // person gets a spurious prompt.
  //
  // The fixture driver is EXCLUDED, because the rows seeded above are deliberately
  // built to fail exactly one guard each — counting them here would measure the
  // fixtures, not the data.
  //
  // Measured, the three single-guard deltas are 0 / 0 / non-zero, and the zeroes are
  // arithmetic rather than a finding: the 47 real non-duty rows have `time_in IS
  // NULL` AND a non-allowlisted status, so they fail BOTH guards at once and either
  // one alone still excludes them. A single-guard mutation against that population
  // therefore cannot show anything, and reading its zero as "decoration" would be the
  // false conclusion this section exists to prevent. What that population CAN show
  // is asserted below: with all three guards off they come through, so the guards are
  // what excludes them; per guard individually, the seeded witnesses above are the
  // evidence.
  const allGuardsOff = unreportedSql
    .replace("AND a.time_in IS NOT NULL", "")
    .replace("AND a.status IN ('Present','Late','Half-Day')", "")
    .replace("AND a.date >= (NOW() AT TIME ZONE 'Asia/Manila')::date - 7", "");
  check("all three guards are in the SQL under test", allGuardsOff !== unreportedSql, true);

  const realDrivers = (await client.query(
    "SELECT driver_id FROM drivers WHERE deleted_at IS NULL ORDER BY driver_id"
  )).rows.filter(({ driver_id: id }) => Number(id) !== Number(d));
  const dayOf = (r) => toCalendarDay(r?.date);
  const answerFor = async (sql, id) => (await client.query(sql, [id])).rows[0] ?? null;

  // A row that is not a worked duty: never clocked in, or a status that is not a
  // working one. These are the rows the two row-shape guards exist to exclude, and
  // being named on one is what a spurious prompt looks like.
  const isNonDuty = async (id, day) => {
    if (!day) return false;
    const { rows: [r] } = await client.query(
      `SELECT (time_in IS NULL OR status NOT IN ('Present','Late','Half-Day')) AS yes
         FROM driverattendance WHERE driver_id=$1 AND date=$2::date`,
      [id, day]
    );
    return r?.yes === true;
  };

  const intact = new Map();
  for (const { driver_id: id } of realDrivers) intact.set(Number(id), dayOf(await answerFor(unreportedSql, id)));
  const compare = async (sql) => {
    const changed = [];
    for (const { driver_id: id } of realDrivers) {
      const day = dayOf(await answerFor(sql, id));
      if (day !== intact.get(Number(id))) changed.push({ id: Number(id), day });
    }
    return changed;
  };

  console.log(`       (${realDrivers.length} real drivers measured, fixture driver #${d} excluded)`);
  for (const [label, sql] of [["time_in", noTimeIn], ["status", noStatus], ["window", noWindow]]) {
    console.log(`       (real-row delta, ${label} guard dropped alone: ${(await compare(sql)).length} driver(s) re-answered)`);
  }

  const intactNamed = [];
  for (const [id, day] of intact) if (await isNonDuty(id, day)) intactNamed.push(id);
  check("with every guard intact, no real driver is named on a non-duty row", intactNamed, []);

  // Opening the window is the one single-guard mutation that changes a real answer.
  // The interesting question then is whether the two SHAPE guards still hold with the
  // whole history in scope — that, not the window, is what decides whether a real
  // driver is asked to report a duty they never worked.
  const windowOpen = await compare(noWindow);
  const windowOpenNonDuty = [];
  for (const c of windowOpen) if (await isNonDuty(c.id, c.day)) windowOpenNonDuty.push(c.id);
  check("opening the 7-day window alone does reach real rows", windowOpen.length > 0, true);
  check("and every row it newly names is a worked duty, not a non-duty row", windowOpenNonDuty, []);

  // And the converse, or the two checks above could pass on a database that holds no
  // non-duty rows at all: remove the shape guards too and the non-duty rows do come
  // through, in numbers. That is what makes them the load-bearing pair.
  const allOffChanged = await compare(allGuardsOff);
  const allOffNonDuty = [];
  for (const c of allOffChanged) if (await isNonDuty(c.id, c.day)) allOffNonDuty.push(c.id);
  console.log(`       (unguarded: ${allOffChanged.length} real driver(s) newly named, ${allOffNonDuty.length} of them on non-duty rows)`);
  check("dropping all three guards newly names real drivers", allOffChanged.length > 0, true);
  check("and it is the shape guards holding those non-duty rows out, so they are load-bearing",
    allOffNonDuty.length > 0, true);

  // ---- Backwards only ----------------------------------------------------
  const { rows: [{ date: fwd }] } = await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, status, check_in_method, end_duty_outcome)
     VALUES ($1, ${MANILA_TODAY} + 1, NOW(), 'Present', 'manual', 'AutoClosed') RETURNING date`,
    [d]
  );
  check("the future-dated row really is tomorrow", toCalendarDay(fwd), next);
  check("and the query did not name it", await raw(), null);
  await client.query(`DELETE FROM driverattendance WHERE driver_id=$1 AND date=${MANILA_TODAY} + 1`, [d]);
  check("and it does not leak into the result", await raw(), null);

  // ---- resolveReportVehicle, date-aware ---------------------------------
  await client.query(
    `INSERT INTO vehicleinspection (vehicle_id, driver_id, inspection_type, inspection_date, status)
     VALUES ($1, $2, 'Pre-Shift', ${MANILA_TODAY}, 'Passed')`,
    [vToday.vehicle_id, d]
  );
  const resolve = async (onDate) => (await client.query(resolverSql, [d, onDate])).rows[0] ?? null;

  const forPast = await resolve(d1);
  check("a late report resolves the vehicle inspected on ITS day, not today",
    forPast?.vehicle_id, vPast.vehicle_id);
  check("the resolver's own plate join is real", forPast?.plate_number, vPast.plate_number);
  const forToday = await resolve(null);
  check("and with no day named it still resolves today's", forToday?.vehicle_id, vToday.vehicle_id);

  // ---- reportAlreadyFiled, the retry carve-out ---------------------------
  // A replayed report has to reach the service, not be refused at the route. The day
  // stops being owed the moment this submission pays it — the service flips the
  // outcome to 'Reported' — so the owed-day answer alone would 400 a report that WAS
  // recorded. This is the second question that separates a replay from a fresh claim.
  const filedSql = sqlOf("reportAlreadyFiled");
  check("reportAlreadyFiled's SQL is readable from the route source", Boolean(filedSql), true);
  if (!filedSql) throw new Error("reportAlreadyFiled SQL not extracted from the route.");

  // Exactly what the service writes on a late report, carrying the submission id —
  // which is what makes the row the durable proof that the submission landed. It is a
  // Post-Shift row, so it cannot disturb the resolver above (Pre-Shift/Pre-Trip) or
  // `unreportedDuty` (Pre-Trip), and it leaves the attendance row's own shape alone,
  // which is where `late` is computed.
  const SUBMISSION = "11111111-2222-3333-4444-555555555555";
  const OTHER_SUBMISSION = "99999999-9999-9999-9999-999999999999";
  await client.query(
    `INSERT INTO vehicleinspection (vehicle_id, driver_id, inspection_type, inspection_date, status, client_submission_id)
     VALUES ($1, $2, 'Post-Shift', ${MANILA_TODAY} - 1, 'Passed', $3)`,
    [vPast.vehicle_id, d, SUBMISSION]
  );
  const filed = async (submissionId, day) => (await client.query(filedSql, [d, submissionId, day])).rows[0] ?? null;
  check("a submission that did file that day is recognised", Boolean(await filed(SUBMISSION, d1)), true);
  check("one that filed a different day is not", await filed(SUBMISSION, d2), null);
  check("and neither is one that filed nothing", await filed(OTHER_SUBMISSION, d1), null);

  // A second live driver, chosen because they hold neither this submission id nor any
  // attendance row on the day the scope checks below use — so a `false` there cannot be
  // a coincidence of the data. Both scope questions ("is this the right driver?") are
  // answered by a query that would return OUR row if it ignored `driver_id`.
  const { rows: [other] } = await client.query(
    `SELECT d.driver_id FROM drivers d
      WHERE d.deleted_at IS NULL AND d.driver_id <> $1
        AND NOT EXISTS (SELECT 1 FROM vehicleinspection i WHERE i.driver_id=d.driver_id AND i.client_submission_id=$2)
        AND NOT EXISTS (SELECT 1 FROM driverattendance a WHERE a.driver_id=d.driver_id AND a.date=$3::date)
      ORDER BY d.driver_id LIMIT 1`,
    [d, SUBMISSION, d8]
  );
  check("a second live driver exists, clear of this submission and this day", Boolean(other), true);
  if (!other) throw new Error("no second live driver is clear of this submission and day — the scope checks below cannot mean anything.");
  const otherDriver = other.driver_id;

  // The TYPE predicate, and it matters for the same reason the scoped recovery does:
  // without it, `reportAlreadyFiled` answers true for any row carrying the id — so the
  // guard admits a replay on the strength of a row the service will then REFUSE, and the
  // driver is walked from a 200-shaped path into a 409.
  const ON_PRESHIFT = "77777777-7777-7777-7777-777777777777";
  await client.query(
    `INSERT INTO vehicleinspection (vehicle_id, driver_id, inspection_type, inspection_date, status, client_submission_id)
     VALUES ($1, $2, 'Pre-Shift', ${MANILA_TODAY} - 1, 'Passed', $3)`,
    [vPast.vehicle_id, d, ON_PRESHIFT]
  );
  check("a row carrying the submission id that is NOT a Post-Shift report is not a filing",
    await filed(ON_PRESHIFT, d1), null);
  check("and neither is another driver's row carrying it",
    (await client.query(filedSql, [otherDriver, SUBMISSION, d1])).rows[0] ?? null, null);

  // ---- closedWithoutReport, the third admission --------------------------
  // The no-vehicle branch writes no Post-Shift row, so neither the owed-day query nor
  // `reportAlreadyFiled` can see the day it closed, and the first attempt answered 200
  // with `recorded: false`. Day 8 was seeded as exactly that shape, carrying `NV_ID`.
  //
  // Keyed on the SUBMISSION ID and day-blind since round 5, for the same reason the
  // service's id arm is: the guard's job is to let a retry reach an answer the first
  // attempt already gave, and a retry can resolve a different day than the attempt it is
  // retrying. The id is the whole scope — the two `false`s are the load-bearing ones, and
  // they are what separates a replay from a fresh claim: a query that ignored the id would
  // admit any submission once any no-vehicle row existed, and one that ignored
  // `driver_id` would admit any driver's.
  const closed = async (driverId, submissionId) => (await client.query(closedSql, [driverId, submissionId])).rows[0] ?? null;
  check("the recorded submission id is recognised", Boolean(await closed(d, NV_ID)), true);
  check("a different id is not", await closed(d, NV_OTHER), null);
  check("and neither is the same id under another driver", await closed(otherDriver, NV_ID), null);
  // The `time_in IS NOT NULL` predicate, which no other check here measures: a row that
  // was never worked cannot have been closed by ending duty. Day -5 is the seeded witness
  // for exactly that shape (status 'Present', no `time_in`), and it is not read again after
  // this point, so it is repurposed here rather than adding a fixture outside the window —
  // where nothing guarantees the day is clear.
  await client.query(
    `UPDATE driverattendance SET end_duty_outcome='NoVehicle', end_duty_submission_id=$2
      WHERE driver_id=$1 AND date=$3::date`,
    [d, NV_OTHER, d5]
  );
  check("…and a row that was never worked is not a close either", await closed(d, NV_OTHER), null);

  // ---- The recovery SELECT, keyed on the id (round 4) --------------------
  // A conflict on `uq_vehicleinspection_driver_submission` is a RETRY only if the row the
  // index holds is a Post-Shift report belonging to this driver. The index's predicate is
  // `(driver_id, client_submission_id)`, so a client that reused one id across two
  // endpoints lands here as well, and recovering another kind of row would close this day
  // as 'Reported' with no record for it and hand the caller an inspection id whose
  // findings belong elsewhere.
  //
  // It is NOT keyed on a day, and that is the whole of round 4. The REFUSAL is no longer a
  // SQL predicate at all — it is a JS branch in the service, so it cannot be checked from
  // here; `standby.test.js` pins it (accepting a retry whose recorded row is dated another
  // day, refusing one whose client-named day contradicts it). What this section can check
  // is what the SELECT returns.
  const recovered = async (submissionId) => (await client.query(recoverySql, [d, submissionId])).rows[0] ?? null;
  check("the recovery finds the recorded Post-Shift report for this submission id",
    Boolean(await recovered(SUBMISSION)), true);
  // Without the type predicate the Pre-Shift row above is recovered as if it were the
  // report — a defect report would then raise a work order against a row that has none.
  check("it does NOT recover the same submission id off a non-Post-Shift row",
    await recovered(ON_PRESHIFT), null);
  // The `driver_id` predicate, which nothing above measures: another driver's Post-Shift
  // row carrying the same id must not be this driver's report.
  check("and another driver's row carrying the same id is not this driver's report",
    (await client.query(recoverySql, [otherDriver, SUBMISSION])).rows[0] ?? null, null);
  // The positive that round 3's day-scoping would have FAILED on, which is why the
  // predicate had to go: the row seeded above is dated day -1, and the retry it answers
  // resolves a LATER day — a shift closed at 00:05 on the 24th carries a row dated the
  // 23rd while the retry resolves the 24th. Round 3 refused that retry a report that WAS
  // recorded, and this is the check that would have caught it.
  const RETRY_RESOLVES = d2;
  check("the row under test is dated a day the retry does NOT resolve", d1 !== RETRY_RESOLVES, true);
  const crossed = await recovered(SUBMISSION);
  check("…and it is still recovered, carrying its OWN day and not the retry's",
    [Boolean(crossed), toCalendarDay(crossed?.inspection_date)], [true, d1]);

  // ---- The no-vehicle close, and write-once under TWO ids -----------------
  // Task 4's route ADMITS a replay of a day this branch closed — `closedWithoutReport` is
  // admitted by the submission id since round 5 — so the day must not be changed by a
  // second request. Write-once lives in two places and this section proves both:
  //
  //   - the SERVICE's early return, which is pinned where a branch can be seen
  //     (`standby.test.js`: a replay returns the recorded outcome and issues no
  //     `UPDATE driverattendance` at all). Without it a replayed day would take the
  //     REPORTED branch and file a Post-Shift row against a vehicle never driven that day.
  //   - the STATEMENT, which since round 5 owns two things it did not own before: it keeps
  //     the FIRST submission id (`COALESCE(end_duty_submission_id,$3)`) and appends its
  //     remark at most once (the `CASE`). Both are driven below under two different ids.
  //
  // The overwriting `$3` is the mutation this check exists to catch and it was shown RED
  // against `end_duty_submission_id=$3`: the second id then replaces the first, and a later
  // replay of the FIRST id no longer matches the fixed point — the midnight retry the id
  // arm exists for would take the reported branch.
  //
  // The row this drives is NOT the day -8 fixture: that one already carries 'NoVehicle', so
  // the `CASE` would correctly leave its remark alone and the "records the gap" check would
  // measure nothing. A fresh, open row is needed — `spareDay`, found clear above.
  // The row carries a `time_out` already and no outcome — the shape `setDuty(false)` leaves
  // (it ends the duty without one) — so the close's `COALESCE(time_out,NOW())` has an
  // earlier value to KEEP, which is the half of write-once the statement owns.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, time_out, status, check_in_method)
     VALUES ($1, $2::date, NOW() - INTERVAL '20 days', NOW() - INTERVAL '19 days', 'Present', 'manual')`,
    [d, spareDay]
  );
  // On the time_out half: `NOW()` is TRANSACTION time in Postgres, so two applications
  // inside this one transaction stamp the same instant and the replay comparison alone
  // cannot see a rewrite. The assertion that discriminates is the one against the value
  // captured BEFORE the first close — that is the row's own earlier time_out.
  const closeState = async (day) => (await client.query(
    `SELECT to_char(time_out,'YYYY-MM-DD HH24:MI:SS.US') AS t, remarks, end_duty_submission_id AS id
       FROM driverattendance WHERE driver_id=$1 AND date=$2::date`, [d, day]
  )).rows[0];
  const before = await closeState(spareDay);
  check("the row under test is unclosed before the close", [before?.t !== null, before?.id, before?.remarks], [true, null, null]);
  await client.query(noVehicleSql, [d, spareDay, NV_SPARE]);
  const first = await closeState(spareDay);
  check("the no-vehicle close records the gap in the remark",
    /no vehicle pairing/.test(first?.remarks ?? ""), true);
  check("…keeps the time_out the row already had rather than rewriting it", first?.t, before?.t);
  check("…and records the submission id that closed it", first?.id, NV_SPARE);
  // The second id, same day.
  await client.query(noVehicleSql, [d, spareDay, NV_SPARE2]);
  const replay = await closeState(spareDay);
  check("a second id leaves the remark byte-identical", replay?.remarks, first?.remarks);
  check("…appends no second remark — the CASE is what stops it",
    (replay?.remarks ?? "").split("no vehicle pairing").length - 1, 1);
  check("…leaves time_out byte-identical", replay?.t, first?.t);
  check("…and the recorded id is still the FIRST one", replay?.id, NV_SPARE);
  const { rows: [{ n: noVehicleRows }] } = await client.query(
    `SELECT count(*)::int AS n FROM driverattendance
      WHERE driver_id=$1 AND date=$2::date AND end_duty_outcome='NoVehicle'`, [d, spareDay]
  );
  check("and there is still exactly one closed-without-report row for that day", noVehicleRows, 1);

  // The arbiter migration 129 added, driven rather than read off `pg_indexes`: a second row
  // reusing one `(driver_id, id)` pair is REFUSED. Inside a savepoint, because a failed
  // statement aborts the whole transaction and every check after this one would fail with
  // "current transaction is aborted" rather than its own reason.
  await client.query("SAVEPOINT arbiter");
  let refused = null;
  try {
    await client.query(
      `INSERT INTO driverattendance (driver_id, date, time_in, status, check_in_method, end_duty_submission_id)
       VALUES ($1, $2::date, NOW() - INTERVAL '21 days', 'Present', 'manual', $3)`,
      [d, spareDay2, NV_SPARE]
    );
  } catch (error) { refused = error; }
  await client.query("ROLLBACK TO SAVEPOINT arbiter");
  check("a second row reusing one (driver, submission id) pair is refused",
    refused?.code ?? null, "23505");
  check("…by the index that arbitrates it, named in the error",
    /uq_attendance_driver_end_duty_submission/.test(refused?.constraint ?? ""), true);

  // ---- Defect 1, end to end: a reopened day is closeable again ------------
  // `setDuty`'s upsert targets TODAY — its date expression is the server's clock — so today
  // is the day this check has to drive. Running it FIRST is what makes today's row exist and
  // be open whatever the fixture driver's real state is: an insert when the day is new to
  // them, a reopen when it is not, and either way a row the close below can land on (the
  // close requires `time_in IS NOT NULL`).
  const todayState = async () => (await client.query(
    `SELECT end_duty_outcome, to_char(time_out,'YYYY-MM-DD HH24:MI:SS.US') AS t,
            end_duty_submission_id AS id
       FROM driverattendance WHERE driver_id=$1 AND date=$2::date`, [d, today]
  )).rows[0];
  await client.query(setDutySql, [d]);
  const opened = await todayState();
  check("setDuty's upsert leaves today's row open", [opened?.end_duty_outcome, opened?.t], [null, null]);
  await client.query(noVehicleSql, [d, today, NV_REOPEN]);
  const closedToday = await todayState();
  check("the day closes without a report", closedToday?.end_duty_outcome, "NoVehicle");
  check("…recording the id that closed it", closedToday?.id, NV_REOPEN);
  // The reopen, and the assertion this whole check exists for.
  await client.query(setDutySql, [d]);
  const reopened = await todayState();
  check("reopening the day clears the outcome", reopened?.end_duty_outcome, null);
  check("…and its time_out, so the day really is open again", reopened?.t, null);
  // And the consequence, which is what defect 1 cost the driver: migration 126's sweep
  // requires `end_duty_outcome IS NULL` and `time_out IS NULL`, so before this round the
  // reopened row could never be closed and the driver stayed shown on duty forever with
  // nothing to rescue them. `p_now` is driven past 04:00 Manila — tomorrow's 05:00, since
  // the sweep closes what is older than ITS OWN Manila day.
  const { rows: [{ closed: sweptCount }] } = await client.query(
    `SELECT public.auto_close_unreported_duties(${PAST_0400}) AS closed`
  );
  const swept = await todayState();
  check("…and the sweep past 04:00 Manila closes it, which is what the stale outcome blocked",
    swept?.end_duty_outcome, "AutoClosed");
  check("…with a time_out, so the duty is really ended", swept?.t !== null, true);
  console.log(`       (the sweep closed ${sweptCount} row(s) across the database on the way — all rolled back)`);
} catch (error) {
  console.error(`\nFAILED: ${error.message}`);
  failures.push(error.message);
} finally {
  // Rolled back unconditionally — including on the error path above, which is the
  // whole point of running this in a transaction.
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed. Nothing was written — the transaction rolled back.");
