// Verifies the duty auto-close sweep: what it closes, what it leaves alone, and
// that the anon key cannot call it.
//
// Everything runs in ONE transaction that ends in ROLLBACK. Nothing this script
// writes survives it. That is not tidiness: an earlier verification script
// abandoned 17 fixture rows on the live database because it cleaned up in an
// application-level finally, and a crash between the write and the cleanup left
// them there. A rollback cannot be skipped by a crash.
//
// Run: npm run verify:duty-autoclose
import { loadEnvLocal } from "./load-env.mjs";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

loadEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run via: npm run verify:duty-autoclose");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const failures = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}`);
};

const client = await pool.connect();
try {
  await client.query("BEGIN");

  // A driver to hang the fixtures off. Reused across every case so the row count
  // stays readable, and rolled back with everything else.
  const MANILA_TODAY = "(NOW() AT TIME ZONE 'Asia/Manila')::date";
  const FIXTURE_WINDOW = `ARRAY[${MANILA_TODAY} - 5, ${MANILA_TODAY} - 4, ${MANILA_TODAY} - 3, ${MANILA_TODAY} - 2, ${MANILA_TODAY} - 1, ${MANILA_TODAY}]::date[]`;
  const { rows: [driver] } = await client.query(
    `SELECT d.driver_id FROM drivers d
      WHERE d.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM driverattendance a
                         WHERE a.driver_id=d.driver_id AND a.date=ANY(${FIXTURE_WINDOW}))
      ORDER BY d.driver_id LIMIT 1`
  );
  if (!driver) throw new Error("No driver row with clear fixture window — seed the database first.");

  const d = driver.driver_id;
  // Two clocks to drive the sweep's gate with: one inside its window, one before
  // it opens. `naive_timestamp AT TIME ZONE 'Asia/Manila'` reads the naive value
  // AS Manila time and yields a timestamptz, so neither depends on the session's
  // zone. Asia/Manila is a fixed +08:00 with no DST, so this arithmetic is exact.
  const IN_WINDOW = `((${MANILA_TODAY} + TIME '05:00') AT TIME ZONE 'Asia/Manila')`;
  const BEFORE_OPEN = `((${MANILA_TODAY} + TIME '03:00') AT TIME ZONE 'Asia/Manila')`;

  // Case 1: yesterday, never ended, no report. MUST be closed.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, status, check_in_method)
     VALUES ($1, ${MANILA_TODAY} - 1, NOW() - INTERVAL '1 day', 'Present', 'manual')`,
    [d]
  );
  // Case 2: yesterday, already ended with a report. MUST be left alone.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, time_out, status, check_in_method, end_duty_outcome)
     VALUES ($1, ${MANILA_TODAY} - 2, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', 'Present', 'manual', 'Reported')`,
    [d]
  );
  // Case 3: yesterday, ended with no vehicle pairing. MUST be left alone — there
  // is nothing to report against, so it must never become promptable.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, time_out, status, check_in_method, end_duty_outcome)
     VALUES ($1, ${MANILA_TODAY} - 3, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', 'Present', 'manual', 'NoVehicle')`,
    [d]
  );
  // Case 4: TODAY, still open. MUST be left alone — the driver is on shift.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, status, check_in_method)
     VALUES ($1, ${MANILA_TODAY}, NOW(), 'Present', 'manual')`,
    [d]
  );

  // Drive the sweep's clock rather than the session's, and drive it in BOTH
  // directions: a gate that always returns 0 would pass a test that only ever
  // watched it do nothing.
  const { rows: [blocked] } = await client.query(
    `SELECT public.auto_close_unreported_duties(${BEFORE_OPEN}) AS closed`
  );
  check("before 04:00 Manila the gate closes nothing", blocked.closed, 0);

  const { rows: [stillOpen] } = await client.query(
    `SELECT count(*)::int AS n FROM driverattendance
      WHERE driver_id = $1 AND date = ${MANILA_TODAY} - 1 AND end_duty_outcome IS NULL`,
    [d]
  );
  check("and yesterday's unended row is still open", stillOpen.n, 1);

  const { rows: [swept] } = await client.query(
    `SELECT public.auto_close_unreported_duties(${IN_WINDOW}) AS closed`
  );
  // NOT asserted as exactly 1: the sweep is global, so on the live database it
  // also reaches any real unattended duty the cron job has not closed yet. The
  // fixture is always among them, so the floor is 1 — the per-case assertions
  // below are what pin the boundaries.
  check("the sweep reaches the fixture row", swept.closed >= 1, true);
  console.log(`       (closed ${swept.closed} row(s) in total)`);

  const { rows: [again] } = await client.query(
    `SELECT public.auto_close_unreported_duties(${IN_WINDOW}) AS closed`
  );
  check("re-running it closes nothing further", again.closed, 0);

  const { rows: after } = await client.query(
    `SELECT date, end_duty_outcome, time_out, remarks
       FROM driverattendance
      WHERE driver_id = $1 AND date >= ${MANILA_TODAY} - 3
      ORDER BY date`,
    [d]
  );
  const byOutcome = Object.fromEntries(after.map((r) => [String(r.date).slice(0, 10), r]));

  const case1 = after.find((r) => r.end_duty_outcome === "AutoClosed");
  check("case 1 (yesterday, unended) is auto-closed", Boolean(case1), true);
  check("case 1 got a time_out", case1?.time_out != null, true);
  check(
    "case 1 remark says it was the sweep",
    /Auto-closed 04:00: no End Duty report submitted/.test(case1?.remarks ?? ""),
    true
  );
  check(
    "case 2 (already reported) is untouched",
    after.filter((r) => r.end_duty_outcome === "Reported").length,
    1
  );
  check(
    "case 3 (no vehicle) is untouched and never promptable",
    after.filter((r) => r.end_duty_outcome === "NoVehicle").length,
    1
  );
  check(
    "case 4 (today, still open) is untouched",
    after.filter((r) => r.end_duty_outcome === null).length,
    1
  );

  // The grant, which db:contract does not inspect.
  const { rows: [anonCan] } = await client.query(
    "SELECT has_function_privilege('anon', 'public.auto_close_unreported_duties(timestamptz)', 'EXECUTE') AS yes"
  );
  check("anon cannot execute the sweep", anonCan.yes, false);

  // The service binds a 'YYYY-MM-DD' STRING to $2 and the statement casts it with
  // ::date, so fetch that string from SQL rather than binding the SQL expression
  // itself — a parameter holding the text "to_char(...)" fails the ::date cast.
  const { rows: [{ day4, day5 }] } = await client.query(
    `SELECT to_char((NOW() AT TIME ZONE 'Asia/Manila')::date - 4, 'YYYY-MM-DD') AS day4,
            to_char((NOW() AT TIME ZONE 'Asia/Manila')::date - 5, 'YYYY-MM-DD') AS day5`
  );

  // (a) A past duty still open. The service's close statement, run against real
  // columns inside the rollback: the unit tests assert its text, only this proves
  // the SQL parses and the column types line up.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, status, check_in_method)
     VALUES ($1, ${MANILA_TODAY} - 4, NOW() - INTERVAL '4 days', 'Present', 'manual')`,
    [d]
  );
  await client.query(
    `UPDATE driverattendance
        SET time_out=COALESCE(time_out,NOW()), end_duty_outcome='Reported',
            remarks=CASE WHEN $3::boolean
              THEN COALESCE(remarks||' | ','')||'Late End Duty report received '||to_char(NOW() AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI')
              ELSE remarks END
      WHERE driver_id=$1 AND date=$2::date AND time_in IS NOT NULL`,
    [d, day4, true]
  );
  const { rows: [amended] } = await client.query(
    `SELECT end_duty_outcome, remarks FROM driverattendance WHERE driver_id=$1 AND date=$2::date`,
    [d, day4]
  );
  check("a late report flips the outcome", amended?.end_duty_outcome, "Reported");
  check("the late-report remark is written", /Late End Duty report received/.test(amended?.remarks ?? ""), true);

  // (b) The path that matters most, and the one the design note is written about:
  // a row the sweep ALREADY auto-closed, reported late the next morning. The
  // outcome must become 'Reported', the sweep's own time_out must survive
  // COALESCE, and the auto-close remark must be KEPT rather than overwritten —
  // erasing it would erase the evidence that the duty was ever abandoned, which
  // is the only reason the auto-close is recorded at all. Asserting the CASE in
  // SQL text cannot prove any of that; this does.
  await client.query(
    `INSERT INTO driverattendance (driver_id, date, time_in, time_out, status, check_in_method, end_duty_outcome, remarks)
     VALUES ($1, ${MANILA_TODAY} - 5, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '9 hours',
             'Present', 'manual', 'AutoClosed', 'Auto-closed 04:00: no End Duty report submitted')`,
    [d]
  );
  const { rows: [{ time_out: sweptTimeOut }] } = await client.query(
    `SELECT time_out FROM driverattendance WHERE driver_id=$1 AND date=$2::date`,
    [d, day5]
  );
  await client.query(
    `UPDATE driverattendance
        SET time_out=COALESCE(time_out,NOW()), end_duty_outcome='Reported',
            remarks=CASE WHEN $3::boolean
              THEN COALESCE(remarks||' | ','')||'Late End Duty report received '||to_char(NOW() AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI')
              ELSE remarks END
      WHERE driver_id=$1 AND date=$2::date AND time_in IS NOT NULL`,
    [d, day5, true]
  );
  const { rows: [recovered] } = await client.query(
    `SELECT time_out, end_duty_outcome, remarks FROM driverattendance WHERE driver_id=$1 AND date=$2::date`,
    [d, day5]
  );
  check("a late report on an auto-closed row flips the outcome", recovered?.end_duty_outcome, "Reported");
  check("the sweep's own time_out is preserved, not overwritten",
    new Date(recovered?.time_out).toISOString(), new Date(sweptTimeOut).toISOString());
  check("both facts survive in the remark",
    /Auto-closed 04:00/.test(recovered?.remarks ?? "") && /Late End Duty report received/.test(recovered?.remarks ?? ""), true);

  // (c) The lateness boundary, pinned to the SERVICE'S OWN expression.
  //
  // `late` reaches the service FROM SQL, so no unit test can pin it — every one of
  // Task 3's tests answers that query from a mock and would pass under any definition.
  // That is exactly how a comparison against midnight, instead of against the 04:00
  // grace Decision 1 already uses, survived a fully green suite while writing a
  // permanent "late report" remark onto duties that were reported on time.
  //
  // The first attempt at this block evaluated a COPY of the expression inline, and so
  // could not fail on the bug it guarded: restoring the midnight comparison at
  // standby.service.js only made the copy keep evaluating itself, all 20 checks green.
  // A live check that restates production text tracks the restatement, not the code.
  // So read the expression out of the service source and run THAT.
  //
  // The service hardcodes NOW(), which cannot be driven to a boundary instant, so the
  // clock is injected — and only the clock: exactly one NOW() must be present, and it
  // becomes $2. The comparison, the interval, the timezone and the strictness all come
  // from the service's own text. If the clock source ever changes (CURRENT_TIMESTAMP,
  // clock_timestamp(), anything), the count below reads 0 and this fails loudly rather
  // than quietly testing nothing.
  const src = readFileSync(new URL("../src/services/standby.service.js", import.meta.url), "utf8");
  const lateMatch = src.match(/"SELECT \(\$1::date <[\s\S]*?\) AS yes"/);
  check("the lateness expression is readable from the service source", Boolean(lateMatch), true);

  const clockCount = (lateMatch?.[0].match(/\bNOW\(\)/g) ?? []).length;
  check("the lateness expression takes its clock from exactly one NOW()", clockCount, 1);

  if (lateMatch && clockCount === 1) {
    const lateSql = lateMatch[0].slice(1, -1).replace("NOW()", "$2::timestamptz");
    // Duty day D, filed at D+1 04:00 exactly, is the half-open boundary: the grace
    // period runs to 04:00, so 04:00 itself is past it and the sweep closes D.
    const boundary = [
      ["a crossing shift reported on time",    "2026-09-23", "2026-09-24T00:30:00+08:00", false],
      ["a report inside the grace window",     "2026-09-23", "2026-09-24T03:59:00+08:00", false],
      ["a report at exactly 04:00",            "2026-09-23", "2026-09-24T04:00:00+08:00", true],
      ["a report one minute past the grace",   "2026-09-23", "2026-09-24T04:01:00+08:00", true],
      ["a genuinely late next-morning report", "2026-09-23", "2026-09-24T09:00:00+08:00", true],
      ["a two-days-late report before 04:00",  "2026-09-22", "2026-09-24T03:00:00+08:00", true],
    ];
    for (const [label, dutyDay, filedAt, expected] of boundary) {
      const { rows } = await client.query(lateSql, [dutyDay, filedAt]);
      check(`lateness boundary — ${label}`, rows[0].yes, expected);
    }
  }
} catch (error) {
  console.error(`\nFAILED: ${error.message}`);
  failures.push(error.message);
} finally {
  // Rolled back unconditionally — including on the error path above, which is
  // the whole point of running this in a transaction.
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed. Nothing was written — the transaction rolled back.");
