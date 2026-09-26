# Missed End Duty Report & Vehicle Problem Queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three silent gaps in the duty/inspection record — a duty that was never ended, a vehicle problem nobody is tracking, and a driver who never finds out until the morning — without ever fabricating an observation.

**Architecture:** Three independently shippable parts. **Part A** gives a forgotten End Duty report two safety nets: a nightly `pg_cron` sweep that closes the abandoned attendance row with an explicit marker, and a next-morning driver prompt that lets them file the report late (which amends that same row). **Part B** gives the office a worklist of failed inspections and reported Post-Shift defects, with resolution derived from whether a maintenance work order exists, and a raise action so every row on it can actually be closed. **Part C** reminds the driver on their phone while the report is still timely — two stages, quiet then loud, delivered to the OS with the app killed, so the 04:00 sweep is a backstop rather than the mechanism. Part A is server + mobile; Part B is web only; Part C is server + mobile + a scheduler. **Any part can be deferred** — they share no code, only the concept of an exception. Part C is the one whose value depends on something outside the repo (a running scheduler), so read its trigger section before committing to it.

**Tech Stack:** Next.js (app router) API routes, Supabase Postgres with `pg_cron`, Expo/React Native mobile app with Expo Push (FCM/APNs), GitHub Actions as the cron caller, Vitest.

## Global Constraints

- **Migration numbering starts at 125.** `113`, `114`, `115`, `122`, `123`, `124` are spent but have no file on disk. Run `npm run db:status` before inventing a number; it lists them under "in the ledger but missing from disk".
- **Never edit an applied migration.** `scripts/migrate.mjs` refuses to run when an applied file's checksum changes. Two migrations are used here (125, 126) precisely so Task 1 can be committed and verified before Task 2 adds more SQL.
- **Every migration is idempotent** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`). The live DB is ahead of the files in places, so a migration must be a safe no-op there.
- **Every migration is wrapped in `BEGIN; ... COMMIT;`** — `scripts/apply-sql.mjs` refuses an unwrapped file.
- **`schema.sql` is generated.** Apply with `npm run db:up`, then `npm run db:dump`, and commit the diff. Never hand-edit it.
- **`schema.sql` shows no RLS and no GRANTs.** It cannot tell you whether an exposure changed. `npm run db:contract` is the gate that sees RLS and table grants; it does **not** see function privileges, which is why Task 2 verifies its own `REVOKE` explicitly.
- **A new function in `public` is executable by `anon` by default** (PostgreSQL grants `EXECUTE` to `PUBLIC`). That is a live hole, not a theoretical one: without the `REVOKE` in Task 2, anyone holding the public anon key could close every open duty in the system through PostgREST RPC.
- **Do not run a one-off script to touch the DB.** Use `scripts/migrate.mjs` via `npm run db:*`. Where a bespoke check is needed it is committed as `scripts/verify-*.mjs` and registered in `package.json`, matching `verify:anon` / `db:contract`.
- **Verification scripts must not leak fixtures.** This has already happened once — an earlier script abandoned 17 employee rows on the live database. Every check in this plan runs inside a transaction that ends in `ROLLBACK`.
- **`mobile/AGENTS.md` requires reading the Expo v57 docs** (`https://docs.expo.dev/versions/v57.0.0/`) before writing mobile code. Tasks 6, 7 and 18 must do this. Where this plan shows a mobile pattern, it is copied from an existing screen in this repo — prefer extending that pattern over inventing a new Expo API.
- **`CLAUDE.md` requires reading `node_modules/next/dist/docs/`** before writing Next.js code. Tasks 8 and 19 must do this.
- **Part C's notification delivery is already built; its trigger is not.** Expo Push to a killed app works today (`src/services/push.service.js`, verified 2026-08-19). What does not exist is anything that calls `/api/cron/sync` — the vault records no scheduler configured and `cron_sync_last_ok` stale since 2026-09-06, so the start-window producer is correct and silent too. Task 17 ships that caller. Do not treat Task 17 as boilerplate: without it, Part C is code that never runs, and no test in this plan will tell you.
- Tests are Vitest. Server tests live beside the source as `*.test.js`; mobile pure-logic tests live in `mobile/lib/*.test.js`.
- **`npm run lint` must be clean** and **`npm run test:run` must pass** before any task is called done.
- Commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Decisions taken

These were open in `Capstone/07 - Development/Missed End Duty Report Design Note.md`. Each is a default, not a finding — override any of them and the affected task changes.

1. **Grace period is 04:00 Asia/Manila.** Any duty day not closed by 04:00 the following morning is closed by the sweep. Anchored on the local hour, not the shift end, because a late finish is legitimate and the roster cannot express an overnight span.
2. **The row is amended, not replaced.** The existing contract is one attendance row per local day (`standby.service.js:52`), so a late report resolves the same row and the `remarks` column carries both facts.
3. **`time_out` IS written by the sweep**, set to the sweep's runtime, with `end_duty_outcome = 'AutoClosed'` making it unmistakable. Leaving `time_out` NULL would keep the row open in the literal sense the original bug was about.
4. **Auto-close is a backstop, the prompt is the normal path.** Because the sweep runs at 04:00 and drivers report in the morning, the amend path (Decision 2) is the common case, not the exception.
5. **A day ended with no vehicle pairing is never prompted.** Nothing can be reported against a vehicle the driver never had; `endDutyWithReport` already records that gap deliberately.

---

## Part A — Missed End Duty Report

**Outcome:** a driver who forgets is prompted the next morning and can fix it; if they never do, the row is closed with a marker that says so. No fabricated observation, and no relying on a string match to tell states apart.

### Task 1: Migration 125 — the `end_duty_outcome` vocabulary column

The whole design rests on being able to ask "does this duty still owe a report?" as a **fact**, not as a `remarks LIKE '%no End Duty report%'` text match. `validatePostShift` already rejected exactly that approach for the report text:

> A sentinel string inside `findings` ("N/A", "wala") would have made that a matter of text matching — and a driver typing the same words by hand would have been silently read as "nothing to report"
> — `src/lib/inspections/checklists.js`

The same argument applies to attendance, so the state gets a column.

**Files:**
- Create: `supabase/migrations/125_end_duty_outcome.sql`
- Modify: `schema.sql` (generated — via `npm run db:dump`)

**Interfaces:**
- Produces: `driverattendance.end_duty_outcome` — `text`, NULL-able, constrained to `NULL | 'Reported' | 'NoVehicle' | 'AutoClosed'`. NULL means an open duty or a row written before this migration. Tasks 2, 3 and 4 read and write it.

- [ ] **Step 1: Confirm the number is free**

```bash
npm run db:status
```

Expected: `pending 0`, and `125` absent from both the applied list and the "in the ledger but missing from disk" list. If 125 appears in the missing-from-disk list, use 127 instead and update every reference in this plan.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/125_end_duty_outcome.sql`:

```sql
BEGIN;

-- How a duty ended, as a fact rather than a string match on remarks.
--
-- The design note rested on being able to ask "does this duty still owe an End
-- Duty report?". Answering that with `remarks LIKE '%no End Duty report%'` would
-- repeat the mistake validatePostShift already refused for the report text: a
-- sentinel string is indistinguishable from a driver who typed the same words.
--
--   NULL         duty still open, or a row written before this migration.
--                The in-progress state; nothing sets it back to NULL.
--   'Reported'   ended with an End Duty report on file.
--   'NoVehicle'  ended with no vehicle pairing, so no report was possible.
--                The gap endDutyWithReport already records on purpose. Never
--                prompted: there is nothing to report against.
--   'AutoClosed' closed by the nightly sweep because no report arrived. The one
--                state a driver can still resolve by reporting late, which flips
--                it to 'Reported' and leaves both facts in remarks.

ALTER TABLE driverattendance
  ADD COLUMN IF NOT EXISTS end_duty_outcome text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'driverattendance_end_duty_outcome_check'
       AND conrelid = 'driverattendance'::regclass
  ) THEN
    ALTER TABLE driverattendance
      ADD CONSTRAINT driverattendance_end_duty_outcome_check
      CHECK (end_duty_outcome IS NULL OR end_duty_outcome IN ('Reported','NoVehicle','AutoClosed'));
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 3: Apply it**

```bash
npm run db:up
```

Expected: the runner reports 1 applied migration, inside its own transaction.

- [ ] **Step 4: Refresh the generated schema and commit the diff**

```bash
npm run db:dump
git diff --stat schema.sql
```

Expected: `schema.sql` gains the `end_duty_outcome text` line on `driverattendance`. **This diff is the review artifact for the column.** It will show nothing about grants or RLS, which is expected and is why Step 5 exists.

- [ ] **Step 5: Confirm the exposure did not change**

```bash
npm run db:contract
```

Expected: PASS, with `driverattendance` still classified as private with RLS enabled. Adding a column to an existing table does not change its grants, so no new exposure is introduced — this step proves that rather than assuming it. If `driverattendance` shows as unclassified or RLS-disabled, **stop**: that is a pre-existing hole (the class of `SEC-DB-003`) and needs its own migration before this work continues.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/125_end_duty_outcome.sql schema.sql
git commit -m "feat(duty): record how a duty ended as a column, not a string match

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Migration 126 — the auto-close sweep

A `pg_cron` job, following the shape `099_pg_cron_sla.sql` already established: `CREATE EXTENSION IF NOT EXISTS pg_cron`, then an idempotent `DO` block that unschedules-then-schedules.

The schedule is **hourly and timezone-agnostic**, and the function does the gating. `099` already uses this shape (a `* * * * *` schedule whose function decides what matters), and it avoids a real trap: `pg_cron` schedules in the *database's* timezone, which is not necessarily `Asia/Manila`. Encoding "04:00 Manila" as a cron expression would be wrong on any server whose timezone differs. Gating inside the function on `(NOW() AT TIME ZONE 'Asia/Manila')` — the same expression every other query in this repo uses — is correct regardless.

The function takes its clock as a **defaulted parameter** rather than reading `NOW()` directly. That is not decoration: the gate is otherwise untestable, because `NOW()` is an absolute instant and setting the session's `TimeZone` changes only how a `timestamptz` is *rendered*, never what the clock reads. A test run before 04:00 Manila would watch the sweep correctly do nothing and could not distinguish that from the sweep being broken. With the clock as a parameter, `scripts/verify-duty-autoclose.mjs` drives the gate in both directions at any hour, and production still calls it with no argument.

**Files:**
- Create: `supabase/migrations/126_duty_autoclose.sql`
- Create: `scripts/verify-duty-autoclose.mjs`
- Modify: `package.json` (add the `verify:duty-autoclose` script)
- Modify: `schema.sql` (generated)

**Interfaces:**
- Consumes: `driverattendance.end_duty_outcome` from Task 1.
- Produces: `public.auto_close_unreported_duties(p_now timestamptz DEFAULT NOW()) RETURNS integer` — closes every attendance row dated before today whose duty was never ended, and returns the number of rows closed. Not executable by `anon` or `authenticated`. The clock is a parameter so the gate is testable; production always calls it with no argument.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/126_duty_autoclose.sql`:

```sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- The backstop for a duty nobody ended.
--
-- Runs hourly and gates itself on the local hour rather than encoding a time in
-- the schedule: pg_cron schedules in the DATABASE's timezone, so '0 4 * * *'
-- would mean 04:00 somewhere else on a server that is not on Asia/Manila. The
-- same `AT TIME ZONE 'Asia/Manila'` expression every other query in this repo
-- uses is correct whatever the server's zone is.
--
-- Before 04:00 local it does nothing: a driver still on a late shift is not
-- cut off. From 04:00 onward it closes anything older than today, and because
-- the predicate requires time_out IS NULL and end_duty_outcome IS NULL it is
-- idempotent — a missed hour self-heals on the next one.
--
-- The clock is a PARAMETER, defaulted to NOW() so the cron command and every
-- other caller stay argument-free. It exists because the gate cannot otherwise
-- be tested: NOW() is an absolute instant, so setting the session's TimeZone
-- changes how a timestamptz is RENDERED, not what the clock reads. A test that
-- ran before 04:00 Manila would see the sweep correctly do nothing and could not
-- tell that apart from the sweep being broken. scripts/verify-duty-autoclose.mjs
-- drives this parameter instead.
CREATE OR REPLACE FUNCTION public.auto_close_unreported_duties(p_now timestamptz DEFAULT NOW())
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  closed integer;
BEGIN
  IF (p_now AT TIME ZONE 'Asia/Manila')::time < TIME '04:00' THEN
    RETURN 0;
  END IF;

  UPDATE driverattendance
     SET time_out          = NOW(),
         end_duty_outcome  = 'AutoClosed',
         remarks           = COALESCE(remarks || ' | ', '')
                             || 'Auto-closed 04:00: no End Duty report submitted'
   WHERE date < (p_now AT TIME ZONE 'Asia/Manila')::date
     AND time_in IS NOT NULL
     AND time_out IS NULL
     AND end_duty_outcome IS NULL
     AND status IN ('Present','Late','Half-Day');

  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed;
END $$;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, and `anon`
-- inherits it. PostgREST exposes public functions at /rest/v1/rpc/, so without
-- this anyone holding the anon key — which ships in the browser bundle by
-- design — could close every open duty in the system with one call.
-- db:contract does not inspect function privileges, so this is the only gate
-- that sees it; Task 2 Step 4 verifies it directly.
--
-- The signature must name the parameter's TYPE. A zero-argument signature for a
-- function that takes one raises no error at migration time — it simply revokes
-- nothing, leaving anon able to call it.
REVOKE ALL ON FUNCTION public.auto_close_unreported_duties(timestamptz) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'duty-autoclose-sweep') THEN
    PERFORM cron.unschedule('duty-autoclose-sweep');
  END IF;

  PERFORM cron.schedule('duty-autoclose-sweep', '0 * * * *', 'SELECT public.auto_close_unreported_duties();');
END $$;

COMMIT;
```

- [ ] **Step 2: Write the verification script**

This runs entirely inside a transaction that ends in `ROLLBACK`, so it leaves no fixture rows behind — the failure mode that already leaked 17 employee rows once.

Create `scripts/verify-duty-autoclose.mjs`:

```javascript
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
  const { rows: [driver] } = await client.query(
    "SELECT driver_id FROM drivers WHERE deleted_at IS NULL ORDER BY driver_id LIMIT 1"
  );
  if (!driver) throw new Error("No driver row to build fixtures on — seed the database first.");

  const d = driver.driver_id;
  const MANILA_TODAY = "(NOW() AT TIME ZONE 'Asia/Manila')::date";
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
```

- [ ] **Step 3: Register the script**

In `package.json`, add to `scripts`, after `"db:erd"`:

```json
    "verify:duty-autoclose": "node scripts/verify-duty-autoclose.mjs",
```

- [ ] **Step 4: Apply the migration and run the check**

```bash
npm run db:up
npm run verify:duty-autoclose
```

Expected: every line `ok`, ending "All checks passed. Nothing was written". If "anon cannot execute the sweep" fails, the `REVOKE` did not take — check that the argument list in the `REVOKE` matches the definition exactly. This function takes one parameter, so it is `public.auto_close_unreported_duties(timestamptz)`, **not** `()`. A `REVOKE` naming a signature that does not exist raises no error, revokes nothing, and leaves `anon` able to close every open duty in the system.

- [ ] **Step 5: Confirm the job is registered**

```bash
node -e "import('./scripts/load-env.mjs').then(async (m)=>{m.loadEnvLocal();const {Pool}=await import('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});const r=await p.query(\"SELECT jobname, schedule, command FROM cron.job WHERE jobname='duty-autoclose-sweep'\");console.log(r.rows);await p.end()})"
```

`scripts/load-env.mjs` is an ES module, so `require()`-ing it fails on Node below 22.12 — hence the dynamic `import()` above. If the relative specifier does not resolve from `-e` on this Node version, build an absolute URL instead:

```bash
node -e "import(require('node:url').pathToFileURL(process.cwd()+'/scripts/load-env.mjs').href).then(async (m)=>{m.loadEnvLocal();const {Pool}=await import('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});const r=await p.query(\"SELECT jobname, schedule, command FROM cron.job WHERE jobname='duty-autoclose-sweep'\");console.log(r.rows);await p.end()})"
```

Report which form worked — it is worth knowing for the rest of this plan.

Expected: one row, `schedule` `0 * * * *`, command `SELECT public.auto_close_unreported_duties();`.

- [ ] **Step 6: Refresh schema.sql and commit**

```bash
npm run db:dump
git add supabase/migrations/126_duty_autoclose.sql scripts/verify-duty-autoclose.mjs package.json schema.sql
git commit -m "feat(duty): close duties nobody ended, on a schedule, without anon access

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: `endDutyWithReport` — date awareness, the outcome, and the late-report amend

Two behaviour changes, both required by the tasks that follow:

1. **The close becomes date-scoped.** Today the update is `WHERE driver_id=$1 AND time_in IS NOT NULL AND time_out IS NULL` (`src/services/standby.service.js:125`) — no date filter, so ending duty tonight silently closes *every* open row, including a stale one from last week. That was harmless while nothing could be stale; now that a stale row carries its own outcome and its own prompt, sweeping it as a side effect would mark it `'Reported'` when the report belongs to a different day. **The date is derived from the newest open row**, not from "today", so a shift that crosses midnight still closes the row it actually opened.

2. **A `dutyDate` may be passed explicitly**, which is the late-report path: the same row, resolved on its own date, amended rather than duplicated.

**Files:**
- Modify: `src/services/standby.service.js` (`endDutyWithReport`, ~lines 82–129)
- Test: `src/services/standby.test.js`

**Interfaces:**
- Consumes: `driverattendance.end_duty_outcome` (Task 1).
- Produces: `endDutyWithReport({ driverId, vehicleId, report, clientSubmissionId, dutyDate? })` → `Promise<{ checkedIn: false, inspectionId: number|null, reported: boolean, recorded: boolean, late: boolean }>`. `dutyDate` is an `'YYYY-MM-DD'` string; omitted it resolves to the newest open row's date, falling back to today. `late` is true when the report is filed **after the same 04:00 Manila grace boundary the sweep uses** — not merely "on a later date than the duty's". Measuring it against midnight mislabels a crossing-midnight shift reported on time, and a report filed at 03:59 inside the grace window, both of which Decision 1 treats as on time; the remark it writes is permanent, so the two cannot be told apart afterwards.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/standby.test.js`, after the existing "ends duty with no report when the driver has no vehicle" test:

```javascript
it('closes the row the report belongs to, not every open row',async()=>{
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    // The resolved date is compared against today's Manila date in SQL. The mock
    // answers that query rather than reimplementing the comparison in JS.
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('e')});
  const [sql,values]=query.mock.calls.find(([sql])=>sql.includes('end_duty_outcome'));
  // Date-scoped, and the outcome is written by the same statement that closes
  // the row — a second statement could land without the first.
  expect(sql).toContain('date=$2::date');
  expect(sql).toContain("end_duty_outcome='Reported'");
  expect(values[1]).toBe('2026-09-23');
});

it('files the inspection on the duty date, not on today',async()=>{
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('f')});
  const [sql,values]=query.mock.calls.find(([sql])=>sql.includes('INSERT INTO vehicleinspection'));
  expect(sql).toContain('$7::date');
  expect(values[6]).toBe('2026-09-23');
});

it('marks a report as late and says so on the row it amends',async()=>{
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    // The lateness comparison lives in SQL, so the mock supplies its answer. This
    // test covers the plumbing: `late` reaches the remark, and the resolved date
    // is the one passed in rather than the open row's.
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  const result=await endDutyWithReport({
    driverId:7,vehicleId:2,report:{findings:'sira ang preno'},clientSubmissionId:submission('g'),dutyDate:'2026-09-23',
  });
  expect(result).toMatchObject({late:true,reported:true});
  const [sql]=query.mock.calls.find(([sql])=>sql.includes('end_duty_outcome'));
  // Both facts survive: the sweep's close AND the late report. Overwriting the
  // remark would erase the evidence that this duty was ever abandoned.
  expect(sql).toContain('Late End Duty report received');
});

it('records the no-vehicle outcome rather than leaving the duty open',async()=>{
  // No vehicle skips the report path, but the day still has to resolve and the
  // lateness still has to be computed — so both queries need answers here too.
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    return {rows:[]};
  });
  await endDutyWithReport({driverId:7,vehicleId:null,report:{nothing_unusual:true},clientSubmissionId:submission('h')});
  const [sql]=query.mock.calls.find(([sql])=>sql.includes('end_duty_outcome'));
  expect(sql).toContain("end_duty_outcome='NoVehicle'");
});

it('resolves the day from a real Date, which is what pg actually returns',async()=>{
  // The other tests mock `date` as a 'YYYY-MM-DD' string, so they pass whether or
  // not the service can handle the value production really gets. `driverattendance.date`
  // is a Postgres `date`, and pg's default parser (OID 1082) hands back a JS Date
  // built at local midnight — never a string. A `String(v).slice(0,10)` on that
  // yields "Wed Sep 23" and the ::date cast below throws, so every real End Duty
  // call 500s while the whole suite stays green. This test is the one that fails.
  // `new Date(2026, 8, 23)` reproduces pg's value exactly: month is 0-indexed.
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:new Date(2026,8,23)}]};
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('i')});
  const [,values]=query.mock.calls.find(([sql])=>sql.includes('end_duty_outcome'));
  expect(values[1]).toBe('2026-09-23');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/services/standby.test.js
```

Expected: 5 failures. `end_duty_outcome` is never written, `$7::date` / `date=$2::date` do not exist, `late` is undefined, and the real-`Date` test resolves the day to `"Tue Sep 23"` instead of `'2026-09-23'`.

- [ ] **Step 3: Implement**

In `src/services/standby.service.js`, replace the body of `endDutyWithReport` from the `withTransaction` call down. Keep the JSDoc above it and extend it. Add one import at the top of the file:

```javascript
import { toCalendarDay } from '@/lib/dates';
```

```javascript
/**
 * ... (existing JSDoc, plus:)
 * @param {string} [input.dutyDate]  'YYYY-MM-DD'. The day the duty belongs to.
 *   Omitted, it resolves to the newest still-open row so a shift that crosses
 *   midnight closes the row it actually opened. Passed explicitly by the late
 *   report path, where the row is a past day's and may already be auto-closed.
 * @returns {Promise<{ checkedIn: boolean, inspectionId: number|null, reported: boolean, recorded: boolean, late: boolean }>}
 */
export async function endDutyWithReport({ driverId, vehicleId, report, clientSubmissionId, dutyDate = null }) {
  const check = validatePostShift(report ?? {});
  if (!check.ok) throw new AuthError(check.error, 400, 'REPORT_INVALID');

  return withTransaction(async (tx) => {
    await tx.query('SELECT driver_id FROM drivers WHERE driver_id=$1 FOR UPDATE', [driverId]);

    // The day this report belongs to. Derived from the open row rather than from
    // "today" so a shift that started before midnight closes the row it opened,
    // and passed in by the late-report path whose row is a past day's.
    //
    // `toCalendarDay` and not `String(v).slice(0, 10)`: `driverattendance.date` is
    // a Postgres `date`, and `pg`'s default parser (OID 1082) hands back a JS Date
    // pinned to LOCAL midnight. `String()` on one renders as "Mon Sep 21 2026
    // 00:00:00 GMT+0800", so a bare `String(v).slice(0,10)` yields "Mon Sep 21" and
    // the `$1::date` below throws `invalid input syntax for type date` — every End
    // Duty call 500s. `src/lib/dates.js:25` exists for exactly this, documents both
    // traps as having already bitten this codebase, and reads Date objects by their
    // local components (never `toISOString()`, which re-reads local midnight in UTC
    // and shifts a Manila date back a day). This repo's convention is that all date
    // normalization goes through it; do not hand-roll a second copy.
    const { rows: openRows } = await tx.query(
      `SELECT date FROM driverattendance
        WHERE driver_id=$1 AND time_in IS NOT NULL AND time_out IS NULL
        ORDER BY date DESC LIMIT 1`,
      [driverId]
    );
    const resolvedDate =
      dutyDate ?? (openRows[0]?.date ? toCalendarDay(openRows[0].date) : null)
      ?? (await tx.query("SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date AS d")).rows[0].d;
    const day = toCalendarDay(resolvedDate);
    // Lateness is measured against the SAME 04:00 boundary the sweep uses, not
    // against midnight. Under Decision 1 a duty day is not abandoned until 04:00
    // the next morning, so "the resolved day is not today" is the wrong question:
    // it marks a crossing-midnight shift reported at 00:30 as late, and a report
    // filed at 03:59 as late, when Decision 1 calls both on time. The remark this
    // writes is permanent, so a mislabelled row cannot be told from a real one
    // afterwards. Subtracting the grace first asks the question that matters:
    // had the deadline for that day passed when this report arrived?
    const late = (await tx.query(
      "SELECT ($1::date < ((NOW() AT TIME ZONE 'Asia/Manila') - INTERVAL '4 hours')::date) AS yes",
      [day]
    )).rows[0].yes === true;

    // Ruling (Task 4's fix round 4). The prior outcome is read BEFORE the vehicle test,
    // and a day already closed 'NoVehicle' returns its recorded outcome without a vehicle
    // ever being consulted.
    //
    // Why the order is load-bearing, and why round 3's justification was wrong: `vehicleId`
    // arrives ALREADY RESOLVED (Task 4's route computes it), and `resolveReportVehicle`
    // falls back to `effectiveStandbyVehicle(driverId)` when the day carries no Pre-Shift or
    // Pre-Trip — a date-blind answer to "the pairing you have NOW". So round 3's claim that
    // "nothing about the day can change by admitting a replay" was false. The moment the
    // driver's pairing becomes resolvable again, a replay of a NoVehicle day is handed a
    // non-null `vehicleId`, takes the REPORTED branch below, inserts a Post-Shift row,
    // flips `end_duty_outcome` from 'NoVehicle' to 'Reported', and can raise a work order —
    // against a vehicle that was never driven that day, for a day the server had already
    // closed. Returning the recorded outcome here is what makes the admission in Task 4's
    // guard safe for the reason it claims.
    //
    // A plain read, not `FOR UPDATE`, and that is sufficient rather than optimistic: the
    // transaction's first statement is
    // `SELECT driver_id FROM drivers WHERE driver_id=$1 FOR UPDATE` (line 92), and the
    // attendance row is keyed on `(driver_id, date)`. Every End Duty call for one driver
    // therefore serializes on that driver row, so a concurrent replay cannot be sitting
    // between this read and the UPDATE below — it blocks at line 92 and, when it resumes,
    // reads the committed 'NoVehicle' and returns here too. (Verified against live: a second
    // transaction attempting the same driver lock stays blocked until the first rolls back.)
    //
    // Fail closed on the read being surprising: `end_duty_outcome` is compared for equality
    // with 'NoVehicle', so a day closed 'Reported' or 'AutoClosed' falls through, and only
    // the exact recorded outcome short-circuits.
    const { rows: priorRows } = await tx.query(
      `SELECT end_duty_outcome FROM driverattendance
        WHERE driver_id=$1 AND date=$2::date AND time_in IS NOT NULL`,
      [driverId, day]
    );
    if (priorRows[0]?.end_duty_outcome === 'NoVehicle') {
      // The recorded outcome, and nothing else: the first attempt answered exactly this, so
      // a replay answering it again is the fixed point the guard's admission assumes.
      return { checkedIn: false, inspectionId: null, reported: false, recorded: false, late };
    }

    // No pairing means there is nothing to inspect, and vehicleinspection.vehicle_id
    // is NOT NULL — so no report can be filed. Ending duty still has to work:
    // a driver with no eligible pairing is exactly the one who most needs to get
    // out of the app. The gap is recorded on the attendance row rather than
    // faked into an inspection against a vehicle they never had.
    if (!vehicleId) {
      // The remark is written UNCONDITIONALLY now, because the early return above
      // guarantees this statement runs at most once per day: it is reached only when the
      // prior outcome is not 'NoVehicle', and the day's outcome becomes 'NoVehicle' before
      // the transaction commits. Round 3's `firstNoVehicleClose` parameter and its
      // `CASE WHEN $3::boolean` are therefore GONE — they guarded a race that the driver
      // row lock had already excluded, and a guard that can never be false is worse than no
      // guard, because it reads as the enforcement. Write-once is asserted by the unit test
      // (no `UPDATE driverattendance` on the replay path), not by the statement's shape.
      //
      // `time_out` is COALESCEd rather than set because the 04:00 sweep may have
      // auto-closed the row first, and that close time is the one the record should keep.
      // Dropping the `$3` parameter desyncs nothing: the copies in
      // `scripts/verify-duty-autoclose.mjs` are of the REPORTED close, not this one.
      await tx.query(`UPDATE driverattendance
          SET time_out=COALESCE(time_out,NOW()), end_duty_outcome='NoVehicle',
              remarks=COALESCE(remarks||' | ','')||'Ended duty with no vehicle pairing; no End Duty report recorded'
        WHERE driver_id=$1 AND date=$2::date AND time_in IS NOT NULL`, [driverId, day]);
      await tx.query('UPDATE drivers SET standby_tracking_enabled=false, standby_session_family=NULL WHERE driver_id=$1', [driverId]);
      return { checkedIn: false, inspectionId: null, reported: false, recorded: false, late };
    }

    // severity is NULL for a reported defect rather than a guessed level: the
    // driver answered one question, so no severity was assessed and inventing
    // one would put a judgement in the record that nobody made. "None" is the
    // driver's own assertion that they found nothing.
    const { rows } = await tx.query(
      `INSERT INTO vehicleinspection
         (vehicle_id, driver_id, inspection_type, inspection_date, checklist, findings, severity, status, client_submission_id)
       VALUES ($1,$2,'Post-Shift',$7::date,NULL,$3,$4,$5,$6)
       ON CONFLICT (driver_id, client_submission_id) WHERE client_submission_id IS NOT NULL DO NOTHING
       RETURNING inspection_id`,
      [vehicleId, driverId, check.findings, check.reported ? null : 'None', check.reported ? 'Reported' : 'Passed', clientSubmissionId, day]
    );
    let inspectionId = rows[0]?.inspection_id ?? null;
    if (!inspectionId) {
      // The unique index already holds this submission id. That is a retry ONLY if the
      // row it holds is THIS report. The index's predicate is
      // `(driver_id, client_submission_id) WHERE client_submission_id IS NOT NULL` —
      // type-blind and date-blind — so a client that reused one id across two days, or
      // across two endpoints, lands here as well. Recovering an unrelated row would close
      // this day as 'Reported' with no Post-Shift record for it, and would hand the
      // caller an inspection id whose findings belong to another day — so a `findings`
      // payload would raise a work order against a row that has none, and the defect
      // report would vanish with no trace.
      //
      // Ruling (Task 4's fix round 4). The recovery is keyed on the ID and the TYPE, NOT
      // on the day — and the day it recovers is the day that WINS. Round 3 scoped it with
      // `inspection_date=$3::date`, which broke the retry the branch exists to serve: on
      // the ordinary path the caller sends no `report_date`, so `day` is re-resolved per
      // request — from the open row on the first attempt, from Manila today on every later
      // one. A shift closed at 00:05 on the 24th writes its Post-Shift row dated the 23rd;
      // the retry at 00:06 resolves day = the 24th, matched nothing, and answered a REFUSAL
      // for a report that WAS recorded. Pre-round-3's date-blind recovery answered 200
      // there, so the day-scoping was a regression, and the fix is to stop asking the
      // question that has no stable answer.
      //
      // The only day this request may be refused for is one the CLIENT named and that
      // contradicts the record: `dutyDate` is null on the ordinary path and set on the late
      // path, where the client pinned a day itself. A day the server resolved cannot
      // contradict itself, so it is never a reason to refuse.
      const { rows: existing } = await tx.query(
        `SELECT inspection_id, inspection_date FROM vehicleinspection
          WHERE driver_id=$1 AND client_submission_id=$2
            AND inspection_type='Post-Shift'`,
        [driverId, clientSubmissionId]
      );
      const recorded = existing[0] ?? null;
      const claimedDay = dutyDate === null ? null : day;
      const recordedDay = recorded ? toCalendarDay(recorded.inspection_date) : null;
      if (recorded && (claimedDay === null || claimedDay === recordedDay)) {
        inspectionId = recorded.inspection_id;
      } else {
        // Refuse — and refuse WITHOUT WRITING. The INSERT was a DO NOTHING conflict and the
        // recovery found nothing admissible, so the day is left exactly as it was: still
        // owed, still open, still advertised by `unreportedDuty`. Task 4's route turns
        // `reason` into a 409, and must keep it distinguishable from the no-vehicle branch,
        // which also returns `recorded: false` and must keep answering 200.
        //
        // `reported: false` rather than `check.reported`: nothing was recorded, so the
        // request's own claim about a defect is not something this return can assert.
        //
        // The reason names the ID, not the day, because the conflict is not always another
        // day: a Pre-Shift or Pre-Trip row carrying the same id lands here too, and calling
        // that "used for another day" would be a wrong diagnosis with the right remedy. One
        // reason for both cases, because the caller's action is the same either way — the id
        // is spent, mint a new one.
        return { checkedIn: false, inspectionId: null, reported: false, recorded: false,
                 reason: 'submission_id_already_used', late };
      }
    }

    // COALESCE keeps a sweep's time_out if the row was already auto-closed; the
    // outcome flips to 'Reported' because that is now the row's final state. The
    // remark carries both facts — overwriting it would erase the evidence that
    // the duty was ever abandoned, which is the record the design note asked for.
    //
    // A RETRY must not append it twice. `rows[0]` is absent exactly when the INSERT
    // hit the unique index and the recovery branch above took over — the signal that
    // this transaction did NOT create the Post-Shift record, i.e. the report was
    // already filed. The remark records when the report was FIRST received, so a
    // driver retrying on a lost response would otherwise accumulate one line per
    // retry, each stamped with a later time, until the row read as a history of its
    // own retries. Task 4's guard now ACCEPTS a retry, so this path is reachable.
    //
    // The decision is made here rather than inside the CASE, deliberately. `late`
    // reaches the service FROM SQL and so cannot be pinned by a unit test (Task 3's
    // Step 5 block (c) exists for exactly that reason); this one is JS, so the tests
    // can see it. Leaving the statement's text unchanged also keeps the copy of it in
    // `scripts/verify-duty-autoclose.mjs` faithful to the service.
    const appendLateRemark = late && Boolean(rows[0]?.inspection_id);
    await tx.query(`UPDATE driverattendance
        SET time_out=COALESCE(time_out,NOW()), end_duty_outcome='Reported',
            remarks=CASE WHEN $3::boolean
              THEN COALESCE(remarks||' | ','')||'Late End Duty report received '||to_char(NOW() AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI')
              ELSE remarks END
      WHERE driver_id=$1 AND date=$2::date AND time_in IS NOT NULL`, [driverId, day, appendLateRemark]);
    await tx.query('UPDATE drivers SET standby_tracking_enabled=false, standby_session_family=NULL WHERE driver_id=$1', [driverId]);
    return { checkedIn: false, inspectionId, reported: check.reported, recorded: true, late };
  });
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/services/standby.test.js
```

**Amended during Task 4's fix round — a retried submission must not append the remark twice.** `appendLateRemark` is new, and it exists because Task 4's guard was amended to accept a replayed submission, which is what makes the replay reach this UPDATE at all. Add a case to this file: file a late report twice with the **same** `clientSubmissionId`, where the second call's INSERT returns no row (the unique index already holds it) so the recovery branch recovers the id. Assert that the close statement is bound with the remark **disabled**, and that `late` still comes back **`true`**. Assert the bound parameter, and say in a comment that you are doing so because the decision is JS — `late` itself stays pinned against live SQL by `verify-duty-autoclose.mjs` block (c), and it must remain true on the retry regardless of the remark: the client is told the report was late either way.

**Amended during Task 4's fix round 3 — three more assertions, each pinning a decision the gate set could not otherwise see.** The previous round moved two decisions into JavaScript so a unit test could reach them, and then asserted only the *retry* direction; the reciprocal direction stayed silent. Add all three, and show each RED before leaving it green:

1. **The `late` conjunct.** Every lateness mock in `standby.test.js` answers `{ yes: true }` (nine of them), so `late` is never false on the reported path. `appendLateRemark = Boolean(rows[0]?.inspection_id)` — dropping `late &&` — therefore passes lint, the whole 2516-test suite and both live scripts, while stamping `'Late End Duty report received <now>'` onto every ON-TIME report, permanently. That is precisely the mislabelling the neighbouring comment invokes ("a mislabelled row cannot be told from a real one afterwards"). One case closes it: lateness mock `{ yes: false }`, the INSERT returns a row, assert the close statement is bound with the remark parameter `false` — and that `late` is still returned `false`.
2. **The no-vehicle fixed point, and the vehicle that must not be consulted (round 4).** The replay must return the recorded outcome **without touching the attendance row at all**. Assert that on the replay — prior outcome mocked `'NoVehicle'` — no `UPDATE driverattendance` is issued, `recorded: false`, and the return carries the recorded shape. This is now the whole enforcement: round 3's `$3` flag is gone from the statement, so the ONLY thing standing between a replay and a second remark is the early return, and a test that does not assert the absence of the write leaves that unpinned. **Then pin the F1 half, which no existing test can see:** `standby.test.js` always passes `vehicleId: null` on this path, and the replay this branch must survive is one where the route handed over a **non-null** `vehicleId` — resolved from current state by `resolveReportVehicle`'s date-blind `effectiveStandbyVehicle` fallback. So drive the case with `vehicleId: 7` (a number, not null) and prior outcome `'NoVehicle'`, and assert it still returns the recorded `recorded: false` result with no `INSERT INTO vehicleinspection` and no `UPDATE driverattendance`. Without that case, a replay can file a Post-Shift row against today's pairing vehicle and flip the outcome from `NoVehicle` to `Reported` while the suite stays green.
3. **The refusal writes nothing.** Mock the INSERT returning no row and the recovery returning no admissible row; assert `recorded: false`, `reason: 'submission_id_already_used'` and — the load-bearing half — that **no `UPDATE driverattendance` was issued at all**. An assertion on the return value alone would pass against a refusal that closed the day first.
4. **A retry whose day moved must still be accepted (round 4).** This is the regression round 4 exists to fix, and it is invisible to every other test because they all pass the same day in and out. Mock the recovery to return a Post-Shift row whose `inspection_date` is **the day before** the one this call resolves — the midnight-crossing shift — and pass **no** `dutyDate`. Assert the call returns `recorded: true` with the recorded `inspectionId`, and does **not** take the refusal. Then the reciprocal, which is the protection the ruling actually wanted: the same recovery row, but with `dutyDate` **set** to the resolved day so it contradicts the record, must refuse. One case without `dutyDate` and one with it — the pair is what distinguishes "the server's day moved" from "the client named a different day".
5. **Two assertions in this file are dead, and one of them is a tautology — repair both (round 4).** They are pre-existing, they pass, and they assert nothing:
   - `standby.test.js:316-317`: `find(([sql])=>sql.includes("end_duty_outcome='NoVehicle'"))` followed by `expect(sql).toContain("end_duty_outcome='NoVehicle'")` — the needle **is** the asserted substring, so the second line cannot fail. Re-aim it at a fact the statement really carries: the remark text, or `time_out=COALESCE(time_out,NOW())`, or `UPDATE driverattendance` as the needle with the outcome as the assertion. Effective red-ability survives either way (a missing statement makes `find` return `undefined` and throw), which is exactly why it has gone unnoticed — but the line as written is information-free.
   - `standby.test.js:236`: `expect(query.mock.calls.some(([sql])=>sql.includes('time_out=NOW()'))).toBe(false)`, under a test commented "before writing anything". `'time_out=COALESCE(time_out,NOW())'.includes('time_out=NOW()')` is **false**, and the only statement still containing that substring is `setDuty`'s (`standby.service.js:61`), which this test never calls — so the assertion is vacuously true for every possible implementation of the code under test. Repoint it to the statement this path would actually write (`UPDATE driverattendance`, or the INSERT) so it can fail again.

Expected: all pass — but only after **two pre-existing assertions are repointed**, which is a deliberate part of this step.

Those tests find their statements with `sql.includes('INSERT INTO vehicleinspection')` (still matches) and `sql.includes('time_out=NOW()')`. The second one **stops matching on the reported path**: `COALESCE(time_out,NOW())` does not contain the substring `time_out=NOW()`, because the comma replaces the equals. So `standby.test.js:82` and `standby.test.js:100` — the two reported-path assertions — must be repointed at the statement the reported path now writes:

```javascript
  // The close records how the duty ended as well as its time_out, so match on the
  // outcome. `time_out=NOW()` is no longer a substring of it: the statement now
  // writes COALESCE(time_out,NOW()) so an already-auto-closed row keeps the
  // time_out the sweep gave it.
  const [closeSql]=query.mock.calls.find(([sql])=>sql.includes("end_duty_outcome='Reported'"));
  expect(closeSql).toContain('time_out=COALESCE(time_out,NOW())');
```

**Two other `time_out=NOW()` assertions must NOT be touched**, and knowing why is the point of this note:
- `standby.test.js:41` exercises `setDuty(7,false)`, whose `UPDATE driverattendance SET time_out=NOW()` this task does not change.
- `standby.test.js:121` exercises the no-vehicle branch, which this task also leaves writing `SET time_out=NOW()`.

If you find yourself editing either of those, stop — you have changed behaviour the task did not ask you to change. The bare substring `time_out=NOW()` still matches both.

- [ ] **Step 5: Verify the SQL against live, inside a rolled-back transaction**

The unit tests assert the SQL text; they cannot prove the SQL runs. Append a second block to `scripts/verify-duty-autoclose.mjs` that, still inside its transaction, inserts **two** past duties for a driver with a vehicle and runs the service's close statement against each. The first is still open, which proves the statement parses and the column types line up. The second was already auto-closed, which is the case the design actually turns on: a late report flips the outcome while keeping both the sweep's `time_out` and the auto-close remark it wrote. The unit tests can only assert the SQL text; this is what proves the behaviour.

```javascript
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
```

The instants carry an explicit `+08:00` offset, so the bound value is an unambiguous moment rather than something the session timezone gets to interpret. Add `import { readFileSync } from "node:fs";` beside the existing `pg` import at the top of the file — the block above reads the service source, and that import is what makes it possible.

Place this block **after** the existing sweep assertions and before the final `ROLLBACK`. The first fixture is an *open* past duty, so inserting it earlier would hand the sweep's idempotency check a row to close and break that assertion. Both fixture dates are computed in SQL from the Manila clock, so the block does not depend on the session's zone.

- [ ] **Step 6: Run both suites and lint**

```bash
npm run verify:duty-autoclose
npx vitest run src/services/standby.test.js
npm run lint
```

Expected: all checks pass, all tests pass, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/services/standby.service.js src/services/standby.test.js scripts/verify-duty-autoclose.mjs
git commit -m "feat(duty): scope the close to the duty's own day and record how it ended

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: The duty endpoint — report an unreported day, and accept a late report

`GET` gains `unreported`, which is what the mobile prompt reads. `POST` gains an optional `report_date`. `resolveReportVehicle` becomes date-aware — **this is the load-bearing change**: without it a late report files a Post-Shift maintenance record against *today's* vehicle instead of the one the driver actually drove.

**Files:**
- Modify: `src/app/api/mobile/driver/duty/route.js`
- Test: `src/app/api/mobile/driver/duty/route.test.js`

**Interfaces:**
- Consumes: `endDutyWithReport({...dutyDate})` from Task 3.
- Produces: `GET` response gains `unreported: { date: 'YYYY-MM-DD', vehicleId: number|null, plateNumber: string|null } | null`. `POST` accepts `report_date?: 'YYYY-MM-DD'`, and the days it accepts are exactly two sets: **the single day `unreported.date` names**, and **a day this same `client_submission_id` has already filed** (a retry). Anything else is a 400, and that 400 body deliberately does not name the day to use instead. A `client_submission_id` the service finds already spent on something that is not this filing — a **client-named** day that contradicts the recorded one, or a non-Post-Shift row carrying the id — is refused with a 409 (`submission_id_already_used`), not a 400. Note what is *not* in that list: a retry whose **server-resolved** day has moved. When the client names no day, the day is the server's to resolve and the recorded row's `inspection_date` wins, so a shift closed just after midnight is still replayable — the reverse would 409 a report that was already recorded.
- **The client contract this creates, stated here because it is a contract and not an implementation detail.** A driver owing more than one day must file **newest-first**, one at a time, because only the newest owed day is ever offered; a report naming the older day is a hard 400 until the newer one is filed. So a client must (a) offer the day the API named, (b) refresh to the next owed day after a filing, (c) never cache a day across a filing, and (d) **never reuse a submission id for a different filing attempt.** The id identifies one attempt, not one driver or one app session: it must stay stable across retries of that attempt — that is what makes a dropped response recoverable — and it must never be minted once and carried onto another day. A 409 (`submission_id_already_used`) means the id is spent, and it is not a 400: a 400 means "ask again with the day the API named", while a 409 means the attempt needs a new id. Conflating them is destructive in both directions — retrying a 409 with the same id loops forever, and regenerating the id *without* correcting the day files a second report for a day that already has one. **One asymmetry to hold onto:** (d) is about the id the *client* carries, and Task 4's route sends no `report_date` on the ordinary path — there the server owns the day, and the recorded day wins, so a retry that crosses midnight still replays to a 200. The rule is "one id per attempt", not "one id per calendar day": scoping it by day is what broke the retry this exemption exists to serve. Task 6's Home card owns (a)–(d).

- [ ] **Step 1: Write the failing tests**

Add to `src/app/api/mobile/driver/duty/route.test.js`:

```javascript
describe("unreported past duties", () => {
  it("names a day left owing a report, and the vehicle it was driven on", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes('end_duty_outcome')) {
        return { rows: [{ date: "2026-09-23", vehicle_id: 5, plate_number: "ABC-1234" }] };
      }
      return { rows: [] };
    });
    const payload = await body(await get());
    expect(payload.unreported).toEqual({ date: "2026-09-23", vehicleId: 5, plateNumber: "ABC-1234" });
  });

  it("reports nothing when every past duty was resolved", async () => {
    expect((await body(await get())).unreported).toBeNull();
  });

  // The day arrives from Postgres as a `Date`, not a string — `pg` parses a `date`
  // column (OID 1082) into one. Every other test here mocks a string, so they all
  // pass under either implementation and cannot tell them apart. This test mocks
  // what production actually returns, and must be shown FAILING before the
  // `toCalendarDay` change — with the old code it reads "Wed Sep 23".
  it("normalises the day Postgres actually returns, not just a mocked string", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes('end_duty_outcome')) {
        return { rows: [{ date: new Date(2026, 8, 23), vehicle_id: 5, plate_number: "ABC-1234" }] };
      }
      return { rows: [] };
    });
    const payload = await body(await get());
    expect(payload.unreported.date).toBe("2026-09-23");
  });

  it("files a late report against the day it names, and its vehicle", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { findings: "sira ang preno" },
      client_submission_id: CID, report_date: "2026-09-23",
    });
    query.mockImplementation(async (sql) => {
      // POST is gated on the owed-day query, so this mock must answer it or the
      // guard 400s before anything is resolved. Keyed on `end_duty_outcome`, which
      // appears only in `unreportedDuty`.
      if (sql.includes('end_duty_outcome')) {
        return { rows: [{ date: "2026-09-23", vehicle_id: 5, plate_number: "ABC-1234" }] };
      }
      // Keyed on a substring the resolver's SQL keeps before AND after this task's
      // change. Do not key it on `inspection_date=$2::date`: once the COALESCE is in
      // place that text no longer appears, the mock silently stops matching, and the
      // assertion below then compares 5 against undefined.
      if (sql.includes('FROM vehicleinspection i')) return { rows: [{ vehicle_id: 5 }] };
      return { rows: [] };
    });
    await post();
    expect(endDutyWithReport).toHaveBeenCalledWith(expect.objectContaining({
      dutyDate: "2026-09-23", vehicleId: 5,
    }));
  });

  // A retry, not a new claim. The day stops being owed the moment this submission
  // pays it — the service flips the outcome to 'Reported' — so on a replayed request
  // the owed-day guard names a different day, or none at all. Answering 400 there
  // would report failure for a report that WAS recorded, to a driver whose connection
  // already lost the first response. Both the submission id and the day must match
  // what the Post-Shift row already carries.
  it("accepts a retry of a report this same submission already filed", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "2026-09-23",
    });
    query.mockImplementation(async (sql) => {
      if (sql.includes('end_duty_outcome')) return { rows: [] }; // nothing owed any more
      if (sql.includes("inspection_type='Post-Shift'")) return { rows: [{ inspection_id: 88 }] };
      return { rows: [{ vehicle_id: 5 }] };
    });
    expect((await post()).status).toBe(200);
    expect(endDutyWithReport).toHaveBeenCalledWith(expect.objectContaining({
      dutyDate: "2026-09-23",
    }));
  });

  it("refuses a report_date that is not a plain calendar day", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "yesterday",
    });
    expect((await post()).status).toBe(400);
    expect(endDutyWithReport).not.toHaveBeenCalled();
  });

  it("refuses a day the driver does not owe, rather than filing it anyway", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "2020-01-01",
    });
    // The mock must let the resolver succeed, or this test would pass merely
    // because no vehicle was found. It has to fail *because of the guard*: with
    // the guard removed, the flow below reaches `endDutyWithReport` and files a
    // Post-Shift inspection against today's standby vehicle.
    //
    // It must also answer the RETRY query with nothing, and that is load-bearing
    // rather than tidiness. A blanket `{ rows: [{ vehicle_id: 5 }] }` for everything
    // else now lands on `reportAlreadyFiled` as a truthy row, the carve-out accepts,
    // and this test breaks for the opposite reason — a 2020 date counted as "already
    // filed". Keying on the retry statement's own text keeps the two apart.
    query.mockImplementation(async (sql) => {
      if (sql.includes('end_duty_outcome')) return { rows: [] };
      if (sql.includes("inspection_type='Post-Shift'")) return { rows: [] };
      return { rows: [{ vehicle_id: 5 }] };
    });
    expect((await post()).status).toBe(400);
    expect(endDutyWithReport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/api/mobile/driver/duty/route.test.js
```

Expected: `unreported` is undefined on the GET payload; the late-report test fails because `dutyDate` is never passed.

- [ ] **Step 3: Implement**

In `src/app/api/mobile/driver/duty/route.js`:

Make the vehicle resolver date-aware, and add the lookup the prompt needs:

```javascript
/**
 * The vehicle an End Duty report is about: the one the driver last inspected on
 * `onDate`. Pre-Trip rows are per-trip, so the newest one is the vehicle they
 * have just finished with. Falls back to the standby pairing for a driver who
 * never inspected anything (a pure-standby day).
 *
 * `onDate` is the duty's own day, NOT today. A late report has to name the
 * vehicle the driver actually drove: resolving against today would file a
 * Post-Shift maintenance record against the wrong vehicle, which is worse than
 * the missing report it was meant to fix.
 *
 * Either can be absent, and that is not an error — see endDutyWithReport, which
 * ends duty and records the gap rather than filing a report against a vehicle
 * the driver never had.
 */
async function resolveReportVehicle(driverId, onDate = null) {
  const { rows } = await query(
    `SELECT i.vehicle_id, v.plate_number
       FROM vehicleinspection i
       JOIN vehicles v ON v.vehicle_id = i.vehicle_id
      WHERE i.driver_id=$1
        AND i.inspection_date=COALESCE($2::date,(NOW() AT TIME ZONE 'Asia/Manila')::date)
        AND i.inspection_type IN ('Pre-Shift','Pre-Trip')
      ORDER BY i.inspection_id DESC LIMIT 1`,
    [driverId, onDate]
  );
  if (rows[0]) return rows[0];
  const fallback = await effectiveStandbyVehicle(driverId);
  return fallback ? { vehicle_id: fallback, plate_number: null } : null;
}

/**
 * The most recent past duty day that still owes an End Duty report, if any.
 *
 * Two shapes count, and both are needed: a row the sweep has already closed
 * ('AutoClosed' — now the common case, because the sweep runs at 04:00 and
 * drivers report later in the morning), and a row still open because the sweep
 * has not reached it yet. 'NoVehicle' is deliberately absent: there was nothing
 * to report against, so prompting for one would be asking for the impossible.
 */
async function unreportedDuty(driverId) {
  const { rows } = await query(
    `SELECT a.date, i.vehicle_id, v.plate_number
       FROM driverattendance a
       LEFT JOIN LATERAL (
         SELECT vi.vehicle_id FROM vehicleinspection vi
          WHERE vi.driver_id=a.driver_id AND vi.inspection_type IN ('Pre-Shift','Pre-Trip')
            AND vi.inspection_date=a.date
          ORDER BY vi.inspection_id DESC LIMIT 1
       ) i ON TRUE
       LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
      WHERE a.driver_id=$1
        AND a.date < (NOW() AT TIME ZONE 'Asia/Manila')::date
        AND a.date >= (NOW() AT TIME ZONE 'Asia/Manila')::date - 7
        AND a.time_in IS NOT NULL
        AND a.status IN ('Present','Late','Half-Day')
        AND (a.end_duty_outcome='AutoClosed'
             OR (a.end_duty_outcome IS NULL AND a.time_out IS NULL))
      ORDER BY a.date DESC LIMIT 1`,
    [driverId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    date: toCalendarDay(row.date),
    vehicleId: row.vehicle_id ?? null,
    plateNumber: row.plate_number ?? null,
  };
}
```

`toCalendarDay` comes from `@/lib/dates` — add `import { toCalendarDay } from '@/lib/dates';` to this file's imports. It is not decoration, and this is the second task in a row where the tests cannot see why.

`driverattendance.date` is a Postgres `date`, and `pg`'s default parser (OID 1082) hands back a JS `Date`. `String()` on one renders as `"Mon Sep 21 2026 00:00:00 GMT+0800"`, so a bare `String(row.date).slice(0, 10)` yields `"Mon Sep 21"`. That value leaves here as `unreported.date`, reaches the driver as the day to report on, and comes back as `report_date` — where this task's own `/^\d{4}-\d{2}-\d{2}$/` validation rejects it and the driver's late report fails with a 400. Task 3 had this exact defect in `endDutyWithReport`; `src/lib/dates.js:25` documents it as having "bitten this codebase" before.

**The reason it survives a green suite is the mocks.** Every test below returns `date` as a `'YYYY-MM-DD'` *string*, while production returns a `Date` — so both implementations pass every assertion, and the suite cannot tell them apart. Step 1 therefore includes a test whose mock returns a real `Date`. Run it before the implementation change and watch it fail; a test that only ever mocks strings proves nothing about this line.

In `GET`, add `unreported` to the payload:

```javascript
    const [state, ctx, unreported] = await Promise.all([
      standbyState(user.driverId),
      loadDriverScheduleContext([user.driverId]),
      unreportedDuty(user.driverId),
    ]);
```

```javascript
      preshiftRequired: !blocked && state?.preshift_baseline !== true,
      unreported,
```

Add both of these beside `unreportedDuty` — together they are the two doors a replay comes through, and the first is the complement of the owed-day query:

```javascript
/**
 * Whether this exact submission already filed a report for this day.
 *
 * The complement of `unreportedDuty`: a day stops being owed the moment its report
 * lands, because the service flips `end_duty_outcome` to 'Reported'. So on a retry
 * the owed-day guard is asking the wrong question — the day is no longer owed
 * PRECISELY because this submission already paid it.
 *
 * The Post-Shift row the service writes carries `client_submission_id`, which makes
 * it the durable proof that this submission landed for this day. Day-scoped and
 * submission-scoped deliberately — and this is the ONE place the day-scoping is
 * right, because this predicate only ever runs when the CLIENT named a day
 * (`report_date`) and is therefore answering "did this submission file the day the
 * caller asked about". A submission id reused for a different day matches nothing
 * here, so a fresh claim still 400s.
 *
 * The service's recovery is deliberately NOT day-scoped (round 4). It cannot be:
 * on the ordinary path the client names no day, so the service resolves one per
 * request, and a retry after midnight resolves a different day than the attempt it
 * is retrying. There the recovered row's own `inspection_date` is authoritative. Do
 * not "make these agree" — they answer different questions, and the asymmetry is
 * the fix.
 *
 * The `ps` alias is distinct from the resolver's `i` and `unreportedDuty`'s `vi`, and
 * `inspection_type='Post-Shift'` appears nowhere else in this file — so a test mock
 * can key on either without catching another statement. Verify that with a grep
 * before relying on it, and move the mock keys if a later change adds a second
 * Post-Shift statement.
 */
async function reportAlreadyFiled(driverId, clientSubmissionId, reportDate) {
  const { rows } = await query(
    `SELECT ps.inspection_id
       FROM vehicleinspection ps
      WHERE ps.driver_id=$1
        AND ps.client_submission_id=$2
        AND ps.inspection_type='Post-Shift'
        AND ps.inspection_date=$3::date
      LIMIT 1`,
    [driverId, clientSubmissionId, reportDate]
  );
  return Boolean(rows[0]);
}
```

```javascript
/**
 * Whether this day has already been closed without a report.
 *
 * The no-vehicle branch closes the day with `end_duty_outcome='NoVehicle'` and writes
 * no Post-Shift row — there is no vehicle to inspect, and `vehicleinspection.vehicle_id`
 * is NOT NULL, so it cannot. That leaves `reportAlreadyFiled` with nothing to find and
 * `unreportedDuty` excluding the day, so a replayed submission for it would be refused
 * even though the first attempt answered 200. The human partner ruled that a replay must
 * reach the service and return the recorded result, so the day is admitted here.
 *
 * Admitted BY DAY rather than by submission id, because that branch has nowhere to record
 * an id: no inspection row exists, and the attendance row has no column for one. That is
 * safe because the service now returns the recorded outcome BEFORE consulting a vehicle
 * (round 4): a request for a day already closed 'NoVehicle' short-circuits to
 * `{ recorded: false, reported: false }` and writes nothing, so admitting a replayed — or
 * even a spurious — request for such a day cannot change it.
 *
 * Round 3 justified this with "the branch is a fixed point", which was true of the branch
 * and false of the request: `vehicleId` arrives already resolved, and the route's
 * `resolveReportVehicle` falls back to the date-blind `effectiveStandbyVehicle`, so the
 * moment the driver's pairing became resolvable a replay took the REPORTED branch instead
 * — filing a Post-Shift row against a vehicle never driven that day and flipping the
 * outcome to 'Reported'. If that early return is ever removed, this predicate must become
 * submission-scoped or be deleted; it is not safe on the strength of the no-vehicle
 * statement alone.
 *
 * The `da` alias is distinct from the resolver's `i`, `unreportedDuty`'s `vi` and
 * `reportAlreadyFiled`'s `ps`, and `end_duty_outcome='NoVehicle'` appears nowhere else in
 * this file — so a mock can key on either. Verify that with a grep before relying on it.
 */
async function closedWithoutReport(driverId, day) {
  const { rows } = await query(
    `SELECT da.end_duty_outcome
       FROM driverattendance da
      WHERE da.driver_id=$1
        AND da.date=$2::date
        AND da.time_in IS NOT NULL
        AND da.end_duty_outcome='NoVehicle'
      LIMIT 1`,
    [driverId, day]
  );
  return Boolean(rows[0]);
}
```

In `POST`, validate and pass the date:

```javascript
    const clientSubmissionId = body?.client_submission_id;
    if (typeof clientSubmissionId !== 'string' || !CLIENT_SUBMISSION_ID_RE.test(clientSubmissionId)) {
      return err('client_submission_id is required', 400);
    }
    // A late report names its own day. Strictly validated rather than passed
    // through: it decides which attendance row is closed AND which vehicle the
    // report is filed against, so an unparseable value must not reach the
    // service where it would silently mean "today".
    //
    // The regex is not the check, and on its own it is a 500 waiting for a client
    // typo: `2026-02-30` and `2026-13-45` both match it and both make Postgres
    // raise `date/time field value out of range` at the first `$::date` — in the
    // guard's own queries, before the service is reached. A calendar day has to be
    // checked as a calendar day: build the date from the components and require the
    // round trip, which is exactly what a day that does not exist fails.
    const reportDate = body?.report_date ?? null;
    if (reportDate !== null) {
      const raw = String(reportDate);
      const [y, m, d] = raw.split('-').map(Number);
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(Date.UTC(y, m - 1, d)) : null;
      const real = parsed !== null
        && parsed.getUTCFullYear() === y
        && parsed.getUTCMonth() === m - 1
        && parsed.getUTCDate() === d;
      if (!real) return err('report_date must be a real YYYY-MM-DD date', 400);
    }
    // Format is not enough, and this guard is the difference between a bad date
    // being rejected and it being silently misfiled. A well-formed date the driver
    // does not owe reaches resolveReportVehicle, which finds no inspection for that
    // day and falls through to the current standby pairing — filing a Post-Shift
    // inspection against a vehicle that was never driven on that date, while the day
    // the driver actually owes stays open. (The service then closes nothing, because
    // its close statement is date-scoped, so the caller gets `recorded: false` and
    // an inspection that should not exist.)
    //
    // So the write path accepts exactly the days the read path advertises: it is
    // gated on `unreportedDuty`, the same query that built `unreported`. If a driver
    // owes more than one day, they file them one at a time as each is offered.
    //
    // One exception, and it is not a hole: a RETRY of a report that already landed.
    // The day stops being owed the moment this submission pays it — the service flips
    // the outcome to 'Reported' — so on a replayed request the guard above names a
    // different day, or none at all, and a 400 there would report failure for a report
    // that WAS recorded, to a driver whose connection already lost the first response.
    // `reportAlreadyFiled` separates that from a driver naming a day they never owed:
    // it demands the SAME submission id on a Post-Shift row for the SAME day, so a
    // retry passes and a fresh claim still 400s.
    //
    // There is a second exception, for the same reason: a submission replayed after the
    // NO-VEHICLE path closed its day. That branch writes no Post-Shift row, so
    // `reportAlreadyFiled` has nothing to find and `unreportedDuty` excludes the day; the
    // first attempt answered 200 with `recorded: false`, so refusing the replay would
    // report failure for a shift the server had already closed. `closedWithoutReport`
    // admits it — and only because the service returns the recorded no-vehicle outcome
    // before it consults a vehicle (round 4), so the admitted request cannot take the
    // reported branch and cannot change the day. The guard's job is to let the retry
    // through to an answer the first attempt already gave; it is not itself the thing that
    // makes the answer safe.
    //
    // Reuse of a submission id across two DIFFERENT days is a third case, and it is NOT
    // admitted here: the service refuses it in its recovery branch and this route turns
    // that into a 409. Neither carve-out above can be steered onto such a day, because
    // neither predicate is satisfiable by a day that was never resolved this way.
    //
    // The `&&` short-circuits, so the ordinary path — the day IS owed — costs no extra
    // query.
    if (reportDate !== null) {
      const owed = await unreportedDuty(session.user.driverId);
      if (reportDate !== owed?.date
          && !(await reportAlreadyFiled(session.user.driverId, clientSubmissionId, reportDate))
          && !(await closedWithoutReport(session.user.driverId, reportDate))) {
        return err('report_date does not name an unreported duty day', 400);
      }
    }
    const vehicle = await resolveReportVehicle(session.user.driverId, reportDate);
    const result = await endDutyWithReport({
      driverId: session.user.driverId,
      vehicleId: vehicle?.vehicle_id ?? null,
      report: body?.report,
      clientSubmissionId,
      dutyDate: reportDate,
    });
```

**A `vehicleId` is now an object, not a number.** Audit every caller of `resolveReportVehicle`: the existing test asserts `endDutyWithReport.mock.calls[0][0].vehicleId === 3`, which must become `vehicle?.vehicle_id ?? null`. Update those assertions in the same commit rather than loosening them.

**The route must map the service's refusal to a 409.** `endDutyWithReport` can now return
`reason: 'submission_id_already_used'` (Task 3's recovery branch) when this submission id is already
bound to something that is not this filing — a different day the **client** named, or a non-Post-Shift
row. Nothing was written in that case and the day named in the request is left exactly as it was —
still owed, still advertised — so the answer is 409, not 500 and not the guard's 400:

```javascript
    if (result.reason === 'submission_id_already_used') {
      return err('client_submission_id was already used', 409);
    }
```

Place it immediately after the `endDutyWithReport` call and before the existing
`if (result.recorded && result.reported && result.inspectionId)` work-order block, so nothing else runs
on a refusal. The test is on `reason` and **not** on `recorded`: the no-vehicle branch also returns
`recorded: false` and must keep answering 200. 409 rather than 400 because the guard's 400 means "you do
not owe this day" while this means "your submission id is already spent" — a client debugging from a log
line needs to tell those apart. The body deliberately does not name the day or the offending row: the
caller's action is the same either way, and naming a day would invite the client to file against it.

- [ ] **Step 3b: Prove the new date test discriminates, before you trust it**

The `unreported` day has two plausible implementations and every *other* test passes under both. So do not write the correct one first and declare victory — write the naive one, watch the test catch it, then fix it:

1. In `unreportedDuty`, write `date: String(row.date).slice(0, 10),` and run Step 4's command.
   Expected: the new test fails with `expected 'Wed Sep 23' to be '2026-09-23'`, and every other test still passes. If the new test *passes* here, your mock is handing back a string and the test is worthless — fix the mock, not the test.
2. Change that line to `date: toCalendarDay(row.date),`, add the `@/lib/dates` import, and re-run.
   Expected: all pass.

- [ ] **Step 3c: Write the tests for the two new refusals and the third admission**

  Four tests. Show each RED before leaving it green; for the ones asserting an ABSENCE, "red" means the mutation that removes the behaviour.

1. `answers 409 when the submission id is already spent` — mock `endDutyWithReport` to
   resolve `{ recorded: false, reason: 'submission_id_already_used' }`, assert `status === 409`
   and that the work-order path was not reached. Mutate the mapping to a plain `reply(result)` and
   watch it go red. Assert on `reason` and not `recorded`, since the no-vehicle branch shares
   `recorded: false` and must stay a 200.
2. `accepts a replay of a day the no-vehicle path already closed` — owed query returns `null`,
   `reportAlreadyFiled` returns nothing, `closedWithoutReport` returns a row, the service resolves
   `{ recorded: false, reported: false }` → assert `200`, not 400.
3. `still refuses a day that is neither owed nor resolved` — extend the existing refusal test's mock to
   answer `closedWithoutReport` with nothing, so it fails for the guard's reason instead of passing
   through a new door. **This one is load-bearing**: a blanket fallthrough row now lands on the third
   predicate too, so a predicate that ignored its arguments would pass the whole step.
4. **Pin the guard's call sites and the short-circuit.** The mocks in this file key on SQL text and
   ignore arguments entirely, so nothing today goes red if an argument is swapped, dropped or
   reordered — and a swap 500s in production on `$3::date`. Assert the arguments on the mocked `query`
   (or key this one mock on them). Also assert the ordinary owed path issues **no** `Post-Shift`
   query: that is the `&&` short-circuit, which the round's requirements call binding and nothing
   currently pins. **And the same for the third predicate specifically (round 4):** the round-3 test
   asserts no `Post-Shift` query, which pins only the *second* predicate's short-circuit — hoisting
   `closedWithoutReport` out of the `&&`, so it runs on every request, stays green. Add an assertion
   that the ordinary owed path issues no query answering `closedWithoutReport` either (the
   `end_duty_outcome='NoVehicle'` text), so each of the two `&&` steps is pinned on its own.
5. **The NoVehicle replay survives a non-null `vehicleId` (round 4).** The guard admits a day already
   closed `NoVehicle`, and the route has by then resolved a `vehicleId` from *current* state —
   `resolveReportVehicle`'s date-blind `effectiveStandbyVehicle` fallback. Mock the service to resolve
   the recorded no-vehicle shape (`{ recorded: false, reported: false, inspectionId: null }`), let the
   vehicle resolution return a **real** vehicle, and assert `200` with no work-order path. This is the
   route half of the service test in Step 4 item 2; together they cover a defect neither half can see
   alone — the service test proves the early return, the route test proves the route still hands over a
   vehicle on that path, which is what made the round-3 justification false.
6. **A malformed-but-well-shaped `report_date` is a 400, not a 500 (round 4).** The route's
   `/^\d{4}-\d{2}-\d{2}$/` accepts `2026-02-30` and `2026-13-45`; both reach `$3::date` in the guard's
   `closedWithoutReport`/`reportAlreadyFiled` calls and in the service, where Postgres raises
   `date/time field value out of range` — a 500 for a client typo, on a path that writes nothing. Add
   the calendar check the regex cannot express: parse the three components and require the round trip
   (`new Date(Date.UTC(y, m-1, d))` yielding back `y`, `m-1`, `d`) before accepting it. Test
   `2026-02-30` and `2026-13-45` → 400, and keep a real date → 200 in the same test so the check cannot
   pass by rejecting everything.

Record both outputs in your report. This two-line demonstration is the only evidence that the check can fail on the bug it guards; without it the fix is unverified however green the suite looks.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/api/mobile/driver/duty/route.test.js
```

Expected: all pass, including the pre-existing vehicle-resolution tests (with the `vehicle_id` unwrap applied).

- [ ] **Step 5: Promote the live probe to a registered script**

Both of this task's new SQL statements — `unreportedDuty` and the date-aware `resolveReportVehicle` — are executed by **zero** tests, because every test in `route.test.js` mocks `query`. A malformed statement would stay green forever. So the probe belongs in `scripts/`, registered and durable, not in scratch:

- Create `scripts/verify-unreported-duty.mjs`.
- Register it in `package.json` as `"verify:unreported-duty": "node scripts/verify-unreported-duty.mjs"`, beside `verify:duty-autoclose`.
- **It must read the SQL out of `src/app/api/mobile/driver/duty/route.js` and run that text**, not a copy of it — the same rule as Task 3's Step 5 block (c). A live check that evaluates its own copy of a statement tracks the copy, not the code, and cannot fail when the code regresses. Fail loudly if the statement cannot be read.
- **`reportAlreadyFiled` is a third statement, executed by zero tests, and it is the one that decides whether a retry is accepted or refused.** Add it to the extractor (`sqlOf('reportAlreadyFiled')`, failing loudly if unreadable) and run it against live inside the same rollback: insert a Post-Shift fixture for the fixture driver on day −1 carrying a known `client_submission_id`, then assert it answers **true** for that exact (driver, submission id, day), **false** for a different submission id, **false** for a different day, and **false** before the row exists. The two `false`s are the ones that matter — they are what separates a retry from a fresh claim, and a query that ignored its parameters would pass every `true` check.
- **`closedWithoutReport` is a fourth statement, and the two service statements round 3's rulings turn on are a fifth and a sixth — none of them reachable through a `sqlOf` that reads only `route.js`.** Give `sqlOf` a source parameter (`const sqlOf = (fn, src = routeSrc) => …`) and read `standby.service.js` for the two service statements, failing loudly when either cannot be read, exactly as the other four do. Then, all inside the same rollback:
  - `closedWithoutReport(driver, day)` answers **true** for a day carrying an `end_duty_outcome='NoVehicle'` row, **false** for a different day, and **false** for a different driver. The two `false`s are the load-bearing ones for the same reason as above: a query that ignored `day` would admit a report for *any* day once any NoVehicle row existed for that driver, and one that ignored `driver_id` would admit any driver's.
  - **The recovery `SELECT` in `endDutyWithReport` carries `inspection_type='Post-Shift'` and NOT a date predicate (round 4), and the type predicate is load-bearing.** Seed a row with the known `client_submission_id` for a day that is *not* Post-Shift — `inspection.js`'s checklist types are the realistic ones — and assert the recovery finds nothing; without the type predicate a Pre-Shift row carrying a submission id is recovered as if it were the report, and the caller is handed an inspection id whose findings belong to another kind of record. Then assert the positive the round-3 scoping would have *failed*: seed the id on a Post-Shift row dated a day **other than** the one the caller resolves, and assert the recovery **returns that row** with its `inspection_date` — because that is the midnight-crossing retry (a shift closed at 00:05 on the 24th carries a row dated the 23rd, and the retry resolves the 24th). This is the check that would have caught the round-3 regression, so it must be shown RED against the round-3 text (`AND inspection_date=$3::date`) before it is left green. The refusal is no longer a SQL predicate, so it cannot be checked here — it is a JS branch, pinned by Step 4 items 3 and 4.
  - `reportAlreadyFiled` answers **false** for a row carrying the submission id that is not Post-Shift, for the same reason: otherwise the guard admits a replay on the strength of a row the service will then refuse, and the driver gets a 200-shaped path into a 409.
  - **The no-vehicle close is idempotent for `time_out`, and the reason it never runs twice is now structural (round 4).** The `$3` flag is gone, so this check no longer drives a parameter. Run the statement once and capture `time_out`; run it a second time and assert `time_out` is byte-identical — that is `COALESCE(time_out,NOW())` doing its job, and it is the only part of write-once the *statement* owns. Read it out of the service through the new source parameter; a copy here would track the copy, not the code. Be explicit in the check's label about what is NOT covered: write-once for the **remark** is now enforced by the service's early return (`if (priorRows[0]?.end_duty_outcome === 'NoVehicle')`), which no statement-level check can reach, so its pin is Step 4 item 2's assertion that a replay issues no `UPDATE driverattendance` at all. Do not let a green `time_out` check imply the remark is covered — round 3 made exactly that mistake by pinning the guard instead of the enforcement.
- **The fixture driver must be chosen by a clear window, and the script must fail loudly rather than quietly.** The pre-fix version took `ORDER BY driver_id LIMIT 1` and plain-`INSERT`ed eight relative dates; `idx_attendance_driver_date (driver_id, date)` turns that into a duplicate-key error the moment that driver works a shift on any of those days. So the fix selects the lowest `driver_id` with **no** `driverattendance` row anywhere in the fixture window, and prints every busy driver's occupied days when none is clear. `ON CONFLICT DO NOTHING` is wrong here — it converts a collision into a check that passes while measuring a row the script never created — and `DO UPDATE` is wrong because it overwrites a real attendance row inside a script whose contract is that it writes nothing. Discover the unique indexes from the live catalog rather than assuming them, and pin the expected set so a newly added index fails at setup naming the index. **The collision is real, and was demonstrated against live data rather than a manufactured row:** driver 19's genuine `AutoClosed` row on `2026-09-16` (day −8, inside the window) makes the pre-fix insert raise `duplicate key value violates unique constraint "idx_attendance_driver_date"` (SQLSTATE 23505) inside a rollback that left the table at 696 rows.
- Every check runs inside one transaction that ends in `ROLLBACK`, including on the error path.
- It must show the guards are **load-bearing, not merely present** — but the obvious form of that test is **not achievable here, and a zero must not be read as "decoration".** Measure the three diffs per driver against the 47 real `On Leave`/`Absent` rows and they come out **0 / 0 / 1**: those rows fail the `time_in` guard *and* the status allowlist *at the same time*, so removing either one alone still excludes every one of them. No single-guard mutation against that population can be non-zero, and concluding "the guard does nothing" from the zero is the exact false inference this step exists to prevent. Assert what *is* demonstrable:

  - a seeded single-guard witness for each guard — a row that fails only that guard, and is excluded because of it;
  - with every guard intact, no real driver is named on a non-duty row;
  - opening the 7-day window alone does reach real rows, but only ever *worked* duties — the window is a retention policy, not a false-prompt guard, and the check must say so rather than implying it prevents one;
  - dropping the shape guards as well newly names 6 real drivers, 5 of them on non-duty rows — that is what makes the check non-vacuous rather than a restatement of the code.

```bash
npm run verify:unreported-duty
```

Expected: all `ok`. Report the three measured diffs as they are — **0 / 0 / 1** — and do not present the zeros as a failure or invent a non-zero to satisfy an expectation. The population makes 0 / 0 / 1 the correct and only honest result; what the step requires is that the check be demonstrably non-vacuous, per the four assertions above.

- [ ] **Step 6: Confirm the Task 3 check still holds**

```bash
npm run verify:duty-autoclose
```

Expected: still all `ok`. Nothing in this task touches the sweep, so a failure here means something outside the task's two files moved.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/mobile/driver/duty/route.js src/app/api/mobile/driver/duty/route.test.js scripts/verify-unreported-duty.mjs package.json
git commit -m "feat(duty): name the day that owes a report, and accept a late one

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

---

## Amendment 11 (Task 4, fix round 5) — the no-vehicle close records its submission id, and a reopened duty stops carrying a stale outcome

Two defects found in the round-4 re-review, both rooted in amendment 9's text, both ruled on by the
human. **This block supersedes amendment 9's no-vehicle fixed point in Task 3's Step 3** (the
`firstNoVehicleClose` design was deleted in round 4; the day-anchored early return that replaced it is
what defect 2 is about). Everything else in Task 3 and Task 4 stands.

**Defect 1 — a reopened duty keeps its outcome.** `setDuty`'s `ON CONFLICT (driver_id,date) DO UPDATE`
sets `time_in=NOW(), time_out=NULL, status='Present'` and never clears `end_duty_outcome`. Three
consequences, and the second is the worst:

1. The no-vehicle fixed point reads that marker, so a driver who reopens the day and later files a real
   report has it **silently dropped** — a 200 with `recorded: false`, no Post-Shift row, no work order,
   and `time_out` never set.
2. Migration 126's sweep requires `end_duty_outcome IS NULL`, so that row **can never be auto-closed**:
   the driver is shown on duty forever and nothing rescues them. This needs no new code path — a day
   closed `'Reported'` (or `'AutoClosed'`) that the driver reopens has the same stale marker.
3. A no-vehicle close can flip a `'Reported'` row to `'NoVehicle'` while the report still stands, so the
   column then misrepresents the day.

**Ruling: clear it on reopen.** An open duty has no outcome — the column describes how a *closed* duty
ended. In `src/services/standby.service.js`, `setDuty`'s upsert becomes:

```js
      await tx.query(`INSERT INTO driverattendance (driver_id,date,time_in,status,check_in_method)
        VALUES ($1,(NOW() AT TIME ZONE 'Asia/Manila')::date,NOW(),'Present','manual')
        ON CONFLICT (driver_id,date) DO UPDATE SET time_in=NOW(), time_out=NULL, status='Present',
          end_duty_outcome=NULL
        WHERE driverattendance.time_out IS NOT NULL OR driverattendance.time_in IS NULL`, [driverId]);
```

The `WHERE` clause already distinguishes "reopen a closed row" from "do nothing to a live one", so
clearing the marker cannot affect a duty that was never closed.

**Defect 2 — the no-vehicle fixed point is day-anchored, so the midnight retry escapes it.** The early
return asks "is *this day* already closed `NoVehicle`?", but a retry asks "did *this submission* already
close a day?", and the two differ exactly when a retry resolves a different day than the attempt it is
retrying. A shift closed at 00:05 on the 24th closes the 23rd; the retry at 00:10 resolves the 24th,
finds no marker there, and takes the reported branch: a fresh Post-Shift row dated the 24th against a
vehicle that was never driven that day, a work order that can ground the wrong vehicle, and a 200
`recorded: true` that stops the client retrying. This is the case the "Make NoVehicle replayable" ruling
exists for — amendment 9 deviated from recording the id because the branch has nowhere in
`vehicleinspection` to put it (`vehicle_id` is `NOT NULL` and there is no vehicle).

**Ruling: record the id.** Migration **129** (128 are applied; 129 is free — `npm run db:status` first,
and treat every version it lists as taken). `supabase/migrations/129_end_duty_submission_id.sql`:

```sql
BEGIN;

-- The id a no-vehicle close came from, so its retry can be recognised idempotently.
ALTER TABLE public.driverattendance
  ADD COLUMN IF NOT EXISTS end_duty_submission_id text;

-- The arbiter: one submission id closes at most one day for one driver. Partial,
-- because every reported close and every pre-existing row leaves it NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_driver_end_duty_submission
  ON public.driverattendance (driver_id, end_duty_submission_id)
  WHERE end_duty_submission_id IS NOT NULL;

COMMIT;
```

Apply with `npm run db:up`, then `npm run db:dump` and leave the `schema.sql` diff in the tree. A column
carries no privileges of its own, so unlike migration 115 there is nothing to revoke — but **prove that
rather than assume it**: run `npm run verify:anon` and `npm run db:contract` before and after and record
that `driverattendance`'s rows, grants and RLS state are unchanged. A table-level grant covers every
column; a *column-level* grant list would not cover a new one, and the contract read is what tells the
two apart.

Then, in `endDutyWithReport`, the fixed point becomes **id-keyed and day-blind, with the day-keyed arm
kept** — neither subsumes the other: the id arm catches the midnight crossing, the day arm catches a
client that minted a fresh id after losing the first response:

```js
    // One read, two arms, because the two questions have the same answer:
    //   - `end_duty_submission_id=$2` — did THIS SUBMISSION already close a day? Day-blind,
    //     which is the whole point: a retry can resolve a different day than the attempt it
    //     is retrying (see Step 3's recovery note), and only the id spans both.
    //   - the resolved day, closed — a request for a day already closed this way arriving
    //     under a DIFFERENT id. `time_out IS NOT NULL` states the intent (this day is
    //     CLOSED) and keeps the branch off a row `setDuty` has reopened.
    const { rows: closedRows } = await tx.query(
      `SELECT end_duty_outcome FROM driverattendance
        WHERE driver_id=$1
          AND (end_duty_submission_id=$2
               OR (date=$3::date AND time_in IS NOT NULL AND time_out IS NOT NULL))`,
      [driverId, clientSubmissionId, day]
    );
    if (closedRows[0]?.end_duty_outcome === 'NoVehicle') {
      return { checkedIn: false, inspectionId: null, reported: false, recorded: false, late };
    }
```

and the close writes the id, keeping the first one and appending the remark at most once. All `SET`
expressions read the **old** row, so the `CASE` tests the pre-update outcome:

```js
      await tx.query(`UPDATE driverattendance
          SET time_out=COALESCE(time_out,NOW()), end_duty_outcome='NoVehicle',
              end_duty_submission_id=COALESCE(end_duty_submission_id,$3),
              remarks=CASE WHEN end_duty_outcome='NoVehicle' THEN remarks
                           ELSE COALESCE(remarks||' | ','')||'Ended duty with no vehicle pairing; no End Duty report recorded' END
        WHERE driver_id=$1 AND date=$2::date AND time_in IS NOT NULL`, [driverId, day, clientSubmissionId]);
```

`COALESCE(end_duty_submission_id,$3)` is load-bearing, not tidiness: if a second id could overwrite the
first, a later replay of the *first* id would no longer match the id arm, and the fixed point would have
been traded away to record a close that had already happened.

In `route.js`, `closedWithoutReport` becomes **id-keyed** — `closedWithoutReport(driverId,
clientSubmissionId)`, `da.end_duty_submission_id=$2` with `da.end_duty_outcome='NoVehicle'`, and the call
site passes `clientSubmissionId`. It stays a *day-independent* question for the same reason the service's
id arm is: the guard's job is to let a retry reach an answer the first attempt already gave. This is
consistent with `reportAlreadyFiled`, which likewise demands the same id — one id per attempt, reused
across its retries.

**Tests this amendment mandates** (Task 4's Step 4 and Step 3c):
1. `setDuty`'s reopen carries `end_duty_outcome=NULL` — assert on the extracted statement, and show it
   RED by deleting the fragment.
2. The **id arm** is what recognises a midnight retry: the prior read returns a `NoVehicle` row while the
   resolved day is a *different* day, and the request issues **no** `UPDATE driverattendance` and returns
   `recorded: false`. Mutation: make the read day-only and this must go red.
3. The **day arm** does not fire on a reopened row: `time_out` NULL must let the reported branch run (an
   `INSERT INTO vehicleinspection` is issued). Mutation: drop `time_out IS NOT NULL` — red.
4. **Repair the tautology round 4 introduced** at `standby.test.js:349`: `find(sql =>
   sql.includes("end_duty_outcome='Reported'"))` followed by `toContain("end_duty_outcome='Reported'")` —
   the needle *is* the asserted substring, so the line cannot fail, and round 3's looser needle at that
   spot was live. Find the statement by something else it alone contains (the late-remark text) and
   assert the outcome on it.
5. `closedWithoutReport` answers true for the recorded id, and **false** for a different id and for a
   different driver.

**Live checks this amendment mandates** (Task 4's Step 5), all inside the one `ROLLBACK` transaction:
- `information_schema.columns` shows `driverattendance.end_duty_submission_id` as nullable `text`;
- `pg_indexes` shows the partial unique index, and a second row reusing one `(driver_id, id)` pair is
  refused — the arbiter is real, not decorative;
- the extracted no-vehicle fixed point carries **both** arms, and the day arm carries `time_out IS NOT
  NULL`;
- the extracted no-vehicle `UPDATE` carries `COALESCE(end_duty_submission_id,` and its remark `CASE`;
- **write-once under two different ids**: run the close for a day, then run it again for the same day
  under a *second* id, and assert the remark is byte-identical and the recorded id is still the first.
  This is the check that would have caught an overwriting `$3`, so show it RED against `=$3`;
- **the reopened row is closeable again** — the check that proves defect 1 is fixed end-to-end: close a
  day as `NoVehicle`, run `setDuty`'s extracted upsert for it (asserting the outcome becomes NULL), then
  call `public.auto_close_unreported_duties(p_now)` with a `p_now` past 04:00 Manila and assert the row
  closes. Task 2 built that parameter for exactly this kind of drive.

**Task 6's carry gains one line:** the client reuses one submission id for the whole attempt, because the
server now recognises a no-vehicle replay by that id — a response lost just after midnight is answered
from the record instead of filing against the next day.

---

## Amendment 12 (Task 4, fix round 6) — the fixed point must not depend on which row comes back first

**Authorised by the human on 2026-09-25 as a sixth fix round**, on the round-5 scoped re-review's
verdict of **DO NOT APPROVE**. Round 5 was the plan's final permitted round; this block is the
authorisation, and it supersedes amendment 11's own snippet wherever they disagree — amendment 11 wrote
the fixed point as `priorRows[0]?.end_duty_outcome === 'NoVehicle'`, which is the defect.

### The defect

`endDutyWithReport`'s fixed-point read is one statement with two OR arms:

```sql
SELECT end_duty_outcome FROM driverattendance
 WHERE driver_id=$1
   AND (end_duty_submission_id=$2
        OR (date=$3::date AND time_in IS NOT NULL AND time_out IS NOT NULL))
```

- the **id arm** is day-blind — `end_duty_submission_id` matches a row on *any* day;
- the **day arm** carries no outcome predicate — it matches *any* closed day;
- the statement has **no `ORDER BY`**.

So the two arms can match **two different rows** in a single read: the id spent on a `NoVehicle` close of
day A, and the named/resolved day P already closed for some other reason. The decision then reads only
`priorRows[0]`. Nothing orders the result, and nothing forces the `NoVehicle` row to be first — `EXPLAIN`
of this exact statement returns an index scan on `idx_attendance_driver` with the OR demoted to a
*Filter*, and a two-day probe returns the **older day first** regardless of predicate order; a row
*updated* at close time also moves to the end of the heap.

When the `NoVehicle` row is not first, the early return is skipped and the request falls through to the
reported branch: `resolveReportVehicle(P)` resolves P's own vehicle, a Post-Shift row dated P is inserted
under id X, `appendLateRemark` stamps a late-report remark onto an already-reported day, `recorded: true`,
and the route may raise a work order against the wrong vehicle. The no-vehicle variant instead reaches
`COALESCE(NULL, X)` on a row that already has X elsewhere → unique violation → **500**.

Reachability, stated honestly: it needs a client that reuses a submission id spent on a no-vehicle close
with an **older** `report_date` — precisely the client error the id-keyed `closedWithoutReport` admission
(`route.js`) exists to absorb. The route comment claiming *"Neither path can misfile a report"* is
therefore false as written.

### Mandates for round 6

1. **Make the decision order-independent.** The early return must fire if **any** row matched by the read
   carries `end_duty_outcome === 'NoVehicle'`:

   ```javascript
   if (priorRows.some(r => r?.end_duty_outcome === 'NoVehicle')) {
     return { checkedIn: false, inspectionId: null, reported: false, recorded: false, late };
   }
   ```

   `.some()` is specified over an `ORDER BY` deliberately: ordering makes the answer depend on a plan the
   application does not control, while `.some()` makes it a property of the data. Do not adopt `ORDER BY`
   as the fix.
2. **Do not change the read's SQL.** Both arms and the parameter list stay exactly as they are — the fix
   is in the decision, not the query. The existing text checks in `scripts/verify-unreported-duty.mjs`
   that pin the statement must stay green untouched.
3. **Add the test that does not exist yet:** a unit test whose mock answers that statement with **two**
   rows, ordered so the `NoVehicle` row is **second**, and which asserts the early return still fires (no
   UPDATE, `recorded: false`). Also cover the symmetric case — two rows, neither `NoVehicle` — asserting
   the early return does **not** fire. Every existing mock answers with 0 or 1 row, which is why the
   suite stayed green with the defect in place; that coverage gap is half the finding.
4. **Amend the route comment at `route.js`** ("Neither path can misfile a report: a day is only ever
   closed by the filing that names it"). State the truth instead: the no-vehicle replay is answered from
   the record by matching the submission id across days, and the fixed point fires on *any* such row, so
   the admission is order-independent. Do not leave a safety claim in the tree that the code does not
   establish.
5. **Not in scope for round 6 — do not "improve" it:** `setDuty`'s reopen clears `end_duty_outcome` but
   retains `end_duty_submission_id`, which can surface as a 500 (`COALESCE` collision) in a
   reopen → sweep-re-close → different-day-reuse sequence. It is real but it is a **separate Minor**,
   changing it would alter what the id arm recognises on a reopened row, and amendment 11 only mandated
   clearing the outcome. Parked for the final whole-branch review; record it, do not fix it here.

### What round 6 must prove

- the two-row test is **RED against `priorRows[0]`** and green against `.some()` — show both;
- every test amendment 11 mandated still passes, unchanged;
- `npm run lint`, `npm run test:run`, `npm run verify:unreported-duty`, `npm run verify:duty-autoclose`
  all green, with real output;
- the route comment now says what the code establishes.

---

### Task 5: `mobile/lib/missed-report.js` — the copy and the route

Pure logic, no Expo imports, so it is testable without a device. The prompt's *decision* is already made by the server (a non-null `unreported` means a day owes a report); this module only turns that into words and a destination.

**Files:**
- Create: `mobile/lib/missed-report.js`
- Test: `mobile/lib/missed-report.test.js`

**Interfaces:**
- Produces: `missedReportCopy(unreported)` → `{ title, body, ctaLabel } | null`; `lateReportHref(date)` → `string`; `plateLabel(plateNumber)` → `string`.

- [ ] **Step 1: Write the failing tests**

Create `mobile/lib/missed-report.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { missedReportCopy, lateReportHref, plateLabel } from "./missed-report";

const day = { date: "2026-09-23", vehicleId: 5, plateNumber: "ABC-1234" };

describe("missed report copy", () => {
  it("says nothing when there is nothing to report", () => {
    expect(missedReportCopy(null)).toBeNull();
  });

  it("names the day in the title, so the driver knows which shift is owed", () => {
    expect(missedReportCopy(day).title).toMatch(/September 23/);
  });

  it("does not ask the driver to 'end duty' — the shift is already closed", () => {
    // The duty may already be closed by the sweep. Telling a driver to end a
    // shift that has ended would be false, and the copy is the only thing
    // standing between the two.
    const copy = missedReportCopy(day);
    expect(copy.body).not.toMatch(/end your (shift|duty)/i);
    expect(copy.body).toMatch(/closed/i);
  });

  it("names the vehicle only when the server resolved one", () => {
    expect(missedReportCopy(day).body).toMatch(/ABC-1234/);
    expect(missedReportCopy({ ...day, plateNumber: null }).body).not.toMatch(/ABC-1234/);
  });
});

describe("late report route", () => {
  it("carries the day, because the screen must file against that day and not today", () => {
    expect(lateReportHref("2026-09-23")).toBe("/end-duty?reportFor=2026-09-23");
  });
});

describe("plate label", () => {
  it("shows the plate when there is one, and refuses to invent one when there is not", () => {
    expect(plateLabel("ABC-1234")).toBe("ABC-1234");
    expect(plateLabel(null)).toBe("the vehicle on that day's check");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd mobile && npx vitest run lib/missed-report.test.js
```

Expected: the module cannot be resolved.

- [ ] **Step 3: Implement**

Create `mobile/lib/missed-report.js`:

```javascript
// The prompt for a duty day that still owes an End Duty report.
//
// The server decides WHETHER (it returns `unreported`, non-null only for a past
// day that owes one). This module only decides how to say it. Two pieces of copy
// are load-bearing:
//
//   - The title names the day. "You forgot to report" without a date is a
//     question the driver cannot answer, because they do not know which shift
//     is being asked about.
//   - The body never says "end your shift". By the time most drivers see this
//     the sweep has already closed the row, so the shift IS ended. An action
//     label that contradicts the record is exactly the kind of small lie the
//     End Duty screen was built to avoid.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 'YYYY-MM-DD' → 'September 23'. Parsed by hand, not by Date: `new Date('2026-09-23')`
 *  is UTC midnight, which is the previous day west of Greenwich, and a prompt
 *  naming the wrong day is worse than no prompt. */
function longDay(date) {
  const [, month, day] = String(date).split("-").map(Number);
  if (!month || !day) return String(date);
  return `${MONTHS[month - 1]} ${day}`;
}

export function plateLabel(plateNumber) {
  return plateNumber || "the vehicle on that day's check";
}

export function missedReportCopy(unreported) {
  if (!unreported?.date) return null;
  const when = longDay(unreported.date);
  return {
    title: `You didn't file a report for ${when}`,
    body: `Your shift for ${when} was closed without one. You drove ${plateLabel(unreported.plateNumber)} that day — if you noticed anything wrong with it, say so now and it goes to the maintenance team. Answering "nothing unusual" is fine too.`,
    ctaLabel: "File that report",
  };
}

export function lateReportHref(date) {
  return `/end-duty?reportFor=${date}`;
}
```

- [ ] **Step 4: Run the tests**

```bash
cd mobile && npx vitest run lib/missed-report.test.js && npm run lint
```

Expected: all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/missed-report.js mobile/lib/missed-report.test.js
git commit -m "feat(mobile): copy for a duty day that still owes a report

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: `useDuty` carries it, and Home shows it

**This task must read the Expo v57 docs first** — see Global Constraints. The pattern below is copied from the cards already in `mobile/app/(app)/(tabs)/index.js`; extend that, do not invent an Expo API.

The prompt is a **card at the top of Home**, not a modal. That is what makes "never blocks the Pre-Shift" structural rather than a promise: nothing on Home can stop the Pre-Shift POST, and the driver's work is never gated on yesterday's paperwork.

**Files:**
- Modify: `mobile/lib/use-duty.js`
- Modify: `mobile/app/(app)/(tabs)/index.js`

**Interfaces:**
- Consumes: `unreported` from Task 4's `GET`; `missedReportCopy`, `lateReportHref` from Task 5.
- Produces: `useDuty()` gains `unreported`.
- **Consumes a contract, from Task 4's fix round 2 — read this before writing the card.** The `POST`
  accepts exactly two sets of `report_date`: the single day `unreported.date` names, and a day the same
  `client_submission_id` has already filed (a retry, so a lost response is not reported as a failure).
  Three obligations follow, and none is optional:
  1. **File newest-first.** Only one day is ever offered. A driver owing 22 and 23 September must file
     the 23rd first; posting the 22nd while the 23rd is owed is a hard 400 with nothing actionable in
     it. So the card offers the day the API named and, after a successful filing, re-reads `unreported`
     and offers the next — which is how a driver owing two days clears both.
  2. **One submission id per report attempt, stable across retries of that attempt.** The retry
     carve-out matches on `client_submission_id`. An id minted per app-launch, or per screen mount,
     turns the driver's *second* report of the day into a 400 — the same failure the carve-out exists to
     prevent, moved one step along. Mint it when the driver commits to filing that day, and reuse it for
     every retry of that filing.
  3. **Do not rely on the 400 body to name the day.** It reads `report_date does not name an unreported
     duty day` and deliberately does not say which day to use. The card knows the day from `unreported`.
  4. **Never carry that id onto another day, and do not read a 409 as a 400.** The id identifies one
     filing attempt. Reusing one the service has already spent is refused with `409
     submission_id_already_used` — a different answer from the 400, and the difference is actionable: a
     400 means re-post with the day the API named and the *same* id, a 409 means this id is spent and the
     attempt needs a new one. Retrying a 409 with the same id loops forever, and minting a new id while
     still naming the wrong day files a report against a day that is not owed.
     **Two things this does NOT mean.** The 409 does not tell the card which of the two conflicts it hit
     (a contradicting named day, or a non-Post-Shift row holding the id), so it must not guess in the
     copy it shows — "we could not file this with that reference, retrying" is honest, a specific
     diagnosis is not. And a 409 is never the right response to a *dropped response*: on the ordinary
     path the card sends no `report_date` at all, the server resolves the day, and a retry of the same
     attempt replays to a 200 — retaining the id is what makes that work, so the id must survive a
     timeout, an app background, and a reload within the attempt.

- [ ] **Step 1: Extend `useDuty`**

In `mobile/lib/use-duty.js`, forward the field. The hook's contract is that it is one call for one question — this adds no request:

```javascript
    if (alive) {
      setState({
        loaded: true,
        blocked: data?.today?.blocked === true,
        reason: data?.today?.reason ?? null,
        duty: data?.today?.duty ?? null,
        checkedIn: data?.checkedIn === true,
        busy: data?.busy === true,
        preshiftRequired: data?.preshiftRequired === true,
        // A past day still owing an End Duty report. Non-null only when the
        // server found one within its lookback — see the route's unreportedDuty.
        unreported: data?.unreported ?? null,
      });
    }
```

and add `unreported: null` to the `value` returned before load, so the shape never changes under the caller.

- [ ] **Step 2: Render the card**

In `mobile/app/(app)/(tabs)/index.js`, add the imports and the derived value beside the existing duty consts:

```javascript
import { missedReportCopy, lateReportHref } from "../../../lib/missed-report";
```

```javascript
  // Above every other card on purpose: it is the one thing on this screen that
  // is already late. It never gates anything — it is a card, and the Pre-Shift
  // banner below it stays reachable whether or not this is ever answered.
  const missedReport = missedReportCopy(duty.unreported);
```

Then render it **immediately after the header block and above the Pre-Shift banner**, matching the surrounding card markup:

```jsx
        {missedReport ? (
          <ClayCard style={{ borderColor: colors.error, borderWidth: 1 }}>
            <View style={styles.cardHeader}>
              <ClayTile icon="document-text-outline" size={48} />
              <View style={styles.cardCopy}>
                <Text style={[type.labelLg, { color: colors.onSurface }]}>{missedReport.title}</Text>
                <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{missedReport.body}</Text>
              </View>
            </View>
            <ClayButton
              label={missedReport.ctaLabel}
              variant="primary"
              icon="arrow-forward"
              iconPosition="right"
              onPress={() => router.push(lateReportHref(duty.unreported.date))}
              style={{ alignSelf: "stretch", marginTop: moderateScale(14) }}
            />
          </ClayCard>
        ) : null}
```

Reuse the file's existing `styles.cardHeader` / `styles.cardCopy` if they exist; if the End Duty card uses inline style objects instead, match whichever the neighbouring card does so the two do not diverge.

- [ ] **Step 3: Verify by running the app**

```bash
cd mobile && npm start
```

With a driver who has an `AutoClosed` row dated yesterday, confirm: the card appears at the top of Home, the Pre-Shift banner is still tappable, and tapping the card navigates to `/end-duty?reportFor=…`. With a driver who has none, confirm the card is absent and nothing else changed.

- [ ] **Step 4: Lint and test**

```bash
npm run lint && npm run test:run
```

Expected: clean; `use-duty.test.js` may need `unreported: null` added to its expected state objects — update the assertions rather than loosening them.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/use-duty.js mobile/app/\(app\)/\(tabs\)/index.js
git commit -m "feat(mobile): prompt on Home for a past duty that owes a report

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**Execution notes (2026-09-25) — two snippets above are stale; the intent was followed, not the text.**
Recorded in full in the ledger (`## Task 6 — DONE (with three plan divergences and one coverage gap)`).
The short version, because a future implementer reading this section would otherwise re-derive it:

1. **Step 1's snippet does not match `mobile/lib/use-duty.js`.** That file has no `alive`, no `blocked`,
   no `reason` and no top-level `duty`; it sets `{loaded, checkedIn, busy, preshiftRequired, today}`, and
   the route nests `blocked`/`reason`/`duty` **inside** `today`. The field was forwarded into the shape
   that exists, plus `unreported: null` on the `EMPTY` constant — this file's "before load" value.
2. **Step 2's JSX uses `styles.cardHeader` / `styles.cardCopy`, which exist in `end-duty.js:278-279` and
   NOT in `index.js`.** The clause directly below the snippet was applied instead: the card was built
   like the two cards beside it (`ClayCard variant="standard"` + `type.cardTitle` + `type.supporting` +
   `ClayButton`), keeping the error border and the above-the-banner placement. `ClayTile` was not used —
   it would have required inventing two style entries no neighbouring card has.
3. **Step 4 names `use-duty.test.js`, which does not exist**, and the repo has no hook-test
   infrastructure (no `@testing-library/react-native`; `renderHook` appears nowhere). Task 6 therefore
   has **no unit test**, and Step 3 (run the app) was not executed for want of a device or emulator.
4. **`/end-duty?reportFor=…` is inert until Task 7**: `mobile/app/(app)/end-duty.js` reads no route
   params today, so the CTA lands on the End Duty screen for *today*. This is the plan's sequencing, not
   a defect — but the Task 6 card is not by itself a working late-report flow.

---

### Task 7: End Duty files a late report

**Read the Expo v57 docs first.** This extends the screen as it stands; the only new surface is a fourth outcome.

**Files:**
- Modify: `mobile/app/(app)/end-duty.js`

**Interfaces:**
- Consumes: `reportFor` route param; `report_date` accepted by Task 4's `POST`.

- [ ] **Step 1: Read the param and send it**

Add to the imports: `import { useLocalSearchParams } from "expo-router";`

```javascript
  const { reportFor } = useLocalSearchParams();
  // 'YYYY-MM-DD' or undefined. A late report names its day; the server files the
  // report against THAT date and its vehicle, so this is passed through, never
  // re-derived here.
  const lateFor = typeof reportFor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(reportFor) ? reportFor : null;
```

In `endDuty`, extend the body:

```javascript
        { active: false, client_submission_id: clientSubmissionId, report, ...(lateFor ? { report_date: lateFor } : {}) },
```

- [ ] **Step 2: Adjust the copy for a late report**

The heading and the outcome screen both currently assume "today". Choose a **fourth** outcome rather than reusing the clean/`reported` copy — a report filed against a shift that was already closed is not the same event:

```jsx
          <Text style={[type.headlineLg, { color: colors.onBackground }]}>
            {lateFor ? "Report for an earlier shift" : "End Duty"}
          </Text>
```

In the `result` block, add the branch **before** the existing three:

```javascript
    const late = result.late === true;
```

```jsx
            {late
              ? "Thank you — your report has been added to that day's record. The shift itself was already closed, so nothing else is needed."
              : noVehicle
              ? "Your shift is closed. No vehicle was paired with you today, so there was nothing to file a report against — that gap was recorded on your attendance instead."
              : reported
                ? "Your report was sent to the maintenance team, who will review the vehicle before it goes out again."
                : "Nothing unusual was noted for this shift."}
```

Replace the "Today's vehicle" card when a late report is in play — the plate is **displayed from the route param the server produced**, never re-resolved on the client. The existing comment above that card is the reason to be careful here:

> The server resolves which vehicle this report belongs to … re-deriving that here would be a second answer to a question the server already owns, and a wrong plate on this screen is worse than no plate

```jsx
        {lateFor ? (
          <ClayCard style={styles.card}>
            <View style={styles.cardHeader}>
              <ClayTile icon="car-outline" size={48} />
              <View style={styles.cardCopy}>
                <Text style={[type.labelLg, { color: colors.onSurface }]}>Report for {lateFor}</Text>
                <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>
                  This goes on the vehicle you drove that day, not today&apos;s.
                </Text>
              </View>
            </View>
          </ClayCard>
        ) : (
          /* ...the existing "Today's vehicle" card, unchanged... */
        )}
```

If the resolver returned no vehicle for that day, the server ends the report path with `recorded: false` exactly as it does today, and the existing `noVehicle` copy already covers it — do not add a fifth branch for it.

- [ ] **Step 3: Verify by running the app**

```bash
cd mobile && npm start
```

With a driver owing a report: tap the Home card, confirm the heading reads "Report for an earlier shift", submit "Nothing unusual", and confirm the outcome reads as the late-report copy. Then check the record:

```bash
npm run verify:duty-autoclose
```

and confirm via the driver's own `/driver/attendance` page that the previous day now shows a clock-out and a late-report remark.

- [ ] **Step 4: Lint, test, and the full suite**

```bash
npm run lint && npm run test:run
```

Expected: clean; repo-wide 203 files passing (plus this plan's new files).

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(app\)/end-duty.js
git commit -m "feat(mobile): file an End Duty report against an earlier shift

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Amendment 13 (Task 7, fix round 1) — `noVehicle` answers before `late`

**Authorised by the human on 2026-09-25 as a fix round**, on round 1's **DO NOT APPROVE**.

Round 1 implemented Step 2 literally — `late` before the existing three — and that ordering is wrong. Step 2
*also* says that for a day the resolver found no vehicle for, "the existing `noVehicle` copy already covers
it — do not add a fifth branch", and `noVehicle` is `result.recorded === false`. The two instructions
contradict: whenever `late` is true the `noVehicle` arm becomes unreachable, so the screen says *"Thank you
— your report has been added to that day's record"* in exactly the state where the server deliberately adds
nothing.

That state is real. `src/services/standby.test.js:255-278` already pins `{checkedIn:false, recorded:false,
reported:false, inspectionId:null, late:true}` **and** that no `vehicleinspection` INSERT and no
`driverattendance` UPDATE were issued. Task 6's Home card offers `?reportFor=<day>` to any day that owes a
report, and a no-vehicle day is exactly such a day — so this plan's own flow reaches it.

**This amendment supersedes Step 2's sentence "add the branch before the existing three" and the Step 2
snippet.** The `result` block is:

```jsx
{noVehicle
  ? "Your shift is closed. No vehicle was paired with you today, so there was nothing to file a report against — that gap was recorded on your attendance instead."
  : late
    ? "Thank you — your report has been added to that day's record. The shift itself was already closed, so nothing else is needed."
    : reported
      ? "Your report was sent to the maintenance team, who will review the vehicle before it goes out again."
      : "Nothing unusual was noted for this shift."}
```

This is the order the screen had **before** Task 7: round 1's diff moved `noVehicle` down one position, and
the fix puts it back.

Rules for round 2:

1. **Reorder only.** Every string stays byte-identical; `const noVehicle = result.recorded === false`,
   `const late = result.late === true`, the heading keyed on `lateFor`, and the icon keyed on `noVehicle`
   all stay exactly as they are. No fifth branch.
2. **Accepted consequence of (1):** on a late no-vehicle day the heading reads "Report for an earlier shift"
   while the body copy says "today". It is truthful and complete; a fifth branch is forbidden by Step 2 and
   wording changes were not authorised.
3. **No test is added by this round** — the human chose the reorder alone. The absence of any render
   assertion for this screen stands as a recorded coverage gap for the final whole-branch review.
4. **Gates:** `npm run lint` and `npm run test:run` under `mobile/`, both unchanged from round 1
   (209 files / 2565 tests). No migrations, no commits.

---

### Task 8: Record Part A in the vault

`AGENTS.md` requires the `Capstone/` notes to be updated after a behaviour or workflow change, and `.agents/AGENTS.md:16` requires **UPDATE System.md**.

**Files:**
- Modify: `Capstone/07 - Development/Missed End Duty Report Design Note.md` (`status: proposed` → `implemented`, and correct it against what was actually built)
- Modify: `Capstone/01 - System/System Overview.md` (changelog entry, append at the end)
- Modify: `SYSTEM.md` — **required by `.agents/AGENTS.md` rule 3.** Four sections, and skipping any of them leaves the architecture record wrong about data that now exists
- Modify: `Capstone/02 - Features/Driver In-App Guide.md` if the Home card changes the tour or the Home layout in a way `§3.1c`/`§3.1d` describe

- [ ] **Step 1: Correct the design note against reality**

The note was written before the implementation and contains at least one claim that the implementation changes: it says the sweep writes `time_out`, which is now deliberate and carries an outcome column. Update the note's decisions section to match, and set `status: implemented`. Keep the alternatives table — it records why the other routes were not taken.

- [ ] **Step 2: Append the changelog entry**

In `Capstone/01 - System/System Overview.md`, append to the existing 2026-09-24 entry (or add a second one if the first is already committed): what the two nets are, the `end_duty_outcome` vocabulary, that the sweep is a `pg_cron` job gated on the local hour rather than a cron expression, that the anon `EXECUTE` revoke is load-bearing, and the test counts. Link `[[Driver In-App Guide]]`.

- [ ] **Step 3: Update `SYSTEM.md`**

`.agents/AGENTS.md` rule 3 is mandatory and unqualified: **UPDATE System.md.** Three places, each of which is wrong about existing data until you do it:

1. **§5.1 Migration timeline** — the table around line 1192 with rows shaped `| 099 | \`pg_cron_sla.sql\` | pg_cron schedule running the SLA-breach check every minute |`. Add a row for `125` (the `end_duty_outcome` column) and one for `126` (the sweep function and its hourly job). Name the job `duty-autoclose-sweep` so a reader can find it in `cron.job`.
2. **§5.3 DB-enforced integrity** — the section opens by counting CHECKs from `schema.sql` per table ("vehicle (5 …), driver (5 …)"). This migration adds a table CHECK that did not exist, so the `driverattendance` vocabulary must appear there with its exact three values, listed the way the neighbouring entries list theirs. If the section's own count is enumerated rather than summarised, extend it rather than leaving a stale total.
3. **The dated changelog at the end of the file** — match the existing entries' style (a bolded title with the date, the change, the verification). The last entries are `**Map tutorial eligibility simplification (2026-09-21):**` and `**Dashboard query errors removal (2026-09-23):**`; follow that shape.

Do not restate the plan's reasoning in `SYSTEM.md`. It is a record of what the system *is*, not of why it was chosen — the design note and `System Overview.md` carry that.

- [ ] **Step 4: Commit**

```bash
git add "Capstone/07 - Development/Missed End Duty Report Design Note.md" "Capstone/01 - System/System Overview.md" SYSTEM.md
git commit -m "docs: record the missed End Duty report nets

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Part B — Vehicle Problem Queue

The manager-facing worklist: failed inspections and reported End Duty defects, with a page under `/maintenance` and an exception count on the role dashboard's existing attention strip. It shares no code with Part A and can ship before, after, or without it.

### What Part B is actually closing

The system already *surfaces* a bad inspection — `inspections/route.js:194-207` notifies the office the moment a Pre-Shift or Pre-Trip fails, and an End Duty report raises a work order through `src/lib/inspections/maintenance.js`. What it does not do is *track* what happens next, and it does not surface the one case where the work order was never raised. Two facts from the existing code decide this part's shape, and both were verified before writing any task:

1. **`vehiclemaintenance.source_inspection_id` is only ever written by the driver's own End Duty submission.** `raiseEndDutyWorkOrder` has exactly one caller — `src/app/api/mobile/driver/duty/route.js:80`. The office-side create route cannot set the link at all: `FIELD_TO_COLUMN` in `src/app/api/vehicle-maintenance/route.js:22-41` has no `source_inspection_id` key, so a work order raised by hand from `/maintenance` can never resolve an inspection. **So the office already does this work today — they just lose the link while doing it.** A read-only list would have been a worklist with no action; Task 12 gives the queue the same raise the register already performs, with the link preserved.

2. **A failed Pre-Shift or Pre-Trip raises no work order automatically.** `src/lib/inspections/maintenance.js:53-55` returns `notRequired` for anything that is not `Post-Shift`, with the reasoning in the comment: *"those failures are recorded and escalate to nobody (a known residual, noted in the vault)."* That decision is about the **automatic** wiring, and this part does not overturn it — nothing a driver does will raise a ticket for a failed checklist. What changes is that a **person** can, deliberately, one row at a time, by pressing a button. That is the office doing the work they already do by hand, minus the lost link.

Three buckets, and the distinction that matters is which of them the dashboard counts:

| Bucket | Predicate | Meaning | Counted? |
|---|---|---|---|
| `reported_untracked` | `inspection_type='Post-Shift' AND status='Reported' AND` no work order | The driver reported a defect and no repair ticket exists — the `raiseEndDutyWorkOrder` failure path, which is best-effort and currently silent to the office | **Yes** |
| `failed_untracked` | `status='Failed' AND` no work order | A failed Pre-Shift / Pre-Trip. Shown and closable, but the office may legitimately decide no repair is warranted | No |
| `tracked` | a work order exists | Resolved, shown with its ticket status | No |

**Why only the first is counted, now that both are closable.** A count is a claim that someone must answer for this row. The Post-Shift one is unanswered by anybody — the driver reported a fault and the automatic raise failed silently, so no person has ever seen it. A failed Pre-Shift was already answered: the office was notified the moment it happened (`inspections/route.js:194-207`) and exercised judgement. Counting it would demand a ticket for every weak aircon, and an exception you can only clear by creating a ticket you don't want is a false obligation — and a badge that sits red for reasons like that is one people stop reading.

**And the raise never grounds a vehicle.** `buildInspectionMaintenancePayload` sets `status: grounded ? "In Progress" : "Scheduled"`, and `"In Progress"` is the lever that actually removes a vehicle from dispatch (`/api/vehicles/available` excludes it — `report.js:26-28`). A raise from this queue always files as `Scheduled`, so dispatch eligibility is untouched and the office keeps deciding grounding exactly as they do today. There is a second reason this is not merely caution: a Pre-Trip's four items **are** the critical set (`CRITICAL_ITEM_IDS = [...PRE_TRIP_ITEMS]`, `checklists.js:43-48`), so every failed Pre-Trip is `High` by construction — and a Pre-Trip runs per trip. Auto-grounding would take a vehicle out of service on a mis-tap, several times a day, which is precisely how drivers learn to pass things.

**A note on authorization, because a comment in the codebase argues against what Task 11 does.** `notifyMaintenanceTeam` (`src/lib/inspections/maintenance.js:122-128`) refuses to add an `inspections` resource to the RBAC matrix, on the grounds that *"who MAY act is not who NEEDS to know."* That argument is about notification recipients and it is correct. Task 11 does not contradict it: it needs an authorization decision for a page that genuinely exists, and it **reuses `maintenance:read` / `maintenance:create` rather than adding a resource**. `rolesFor()` (`src/lib/auth/permissions.js:340-345`) resolves that to `super_admin` (blanket bypass, `:333`) + `admin` + `fleet_manager` — the exact three roles `NAV_ROLES["/maintenance"]` already gates, so **no change to `permissions.js` is required by this part at all.**

### Non-goals — deliberate, and each one is a decision already made in the code

- **Do not let a driver's inspection raise a work order automatically.** The `notRequired` branch stays the default for every automated path. Only Task 12's office route passes the flag that allows a checklist type through, and it does so for one inspection at a time on a human's instruction. Widening the automatic path is the separate design conversation that `maintenance.js:53-55` defers.
- **Do not ground a vehicle from a raise made in this queue.** No exceptions. See above — a Pre-Trip failure is `High` every time, so an automatic grounding rule here would be a rule that fires on every Pre-Trip failure.
- **Do not add an `inspections` resource to the RBAC matrix.** See above.
- **Do not add a `resolved_at` column or an acknowledge button.** Resolution is a real work order — an artifact that already exists, is already unique per inspection (`uq_vehiclemaintenance_source_inspection`, migration 121), and already has a workflow behind it. That the raise is now available for a failed checklist does not create a need for a flag: the row is closed by acting, not by acknowledging. A second, parallel notion of "handled" is exactly the fabricated record Part A goes out of its way to avoid.

---

### Task 9: Migration 128 — the queue's partial index

**Files:**
- Create: `supabase/migrations/128_vehicleinspection_problem_queue_index.sql`
- Modify: `schema.sql` (generated — via `npm run db:dump` only)

**Interfaces:**
- Consumes: nothing.
- Produces: `idx_vehicleinspection_problem_queue`, which Tasks 10 and 13's queries rely on. Nothing else in this part changes the schema.

Why an index at all: the dashboard attention strip (Task 13) runs the `countProblemCounts()` predicate on **every dashboard load for two roles**, and the existing indexes on this table are `trip_id`- and `vehicle_id`-keyed (`schema.sql:1386-1387`) — neither can serve a filter on `status` / `inspection_type`. This is one partial index on the exact predicate, not speculative indexing.

- [ ] **Step 1: Confirm the number is still free — do not skip this**

Run: `npm run db:status`

Expected: `128` does not appear as applied, pending, or "in the ledger but missing from disk". If it does, take the next free number and use it consistently for the rest of this task.

This step is not ceremonial. When this plan was written, `127` was free for this task; on 2026-09-24 a **concurrent workstream** created `127_notifications_soft_delete_retention.sql` and spent it, so this task was renumbered to `128`. Another workstream is still writing this working tree, so `128` may itself be gone by the time you run this — which is exactly why the check comes before the file exists, not after. `ls supabase/migrations/` is not sufficient to decide this: the ledger records migrations whose files are gone, so a version can be spent without appearing on disk. Only `db:status` sees both.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/128_vehicleinspection_problem_queue_index.sql`:

```sql
-- The Vehicle Problem Queue's access path.
--
-- The queue's predicate is `status = 'Failed' OR (inspection_type = 'Post-Shift'
-- AND status = 'Reported')`, and the role dashboard runs its COUNT form on every
-- dashboard load for admin and fleet_manager. The two indexes that already exist
-- on vehicleinspection are keyed on (trip_id, ...) and (vehicle_id, ...), so
-- neither can serve a filter on status / inspection_type: this would be a
-- sequential scan over the whole table on the hottest page in the app.
--
-- Partial, because the queue only ever reads the flagged rows — a passed
-- inspection is invisible to it by construction, so pay for the flagged ones
-- only. Mirrors the shape of uq_vehicleinspection_driver_submission (migration
-- 121), the table's other partial index.
--
-- No RLS or GRANT work belongs here: an index is not a table, a view or a
-- function, so none of the exposures CLAUDE.md warns about apply to it.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_vehicleinspection_problem_queue
  ON public.vehicleinspection (inspection_date DESC, inspection_id DESC)
  WHERE status = 'Failed'
     OR (inspection_type = 'Post-Shift' AND status = 'Reported');

COMMIT;
```

- [ ] **Step 3: Apply it**

Run: `npm run db:up`

Expected: `128_vehicleinspection_problem_queue_index.sql` applied; every other file reported as already applied or unchanged. A checksum refusal here means an applied file was edited — stop and report it, do not work around it.

- [ ] **Step 4: Verify it exists in the live catalog**

Run:

```bash
node -e "import('./scripts/load-env.mjs').then(async () => { const { query } = await import('./src/lib/db.js'); const { rows } = await query(\"SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'vehicleinspection' AND indexname = 'idx_vehicleinspection_problem_queue'\"); console.log(rows); process.exit(rows.length === 1 ? 0 : 1); })"
```

Expected: exactly one row, whose `indexdef` contains `WHERE`. Zero rows means it did not land — the apply in Step 3 was against a different database, which is the failure this repo has already been burned by.

- [ ] **Step 5: Refresh and commit the dump**

Run: `npm run db:dump`

Then `git diff schema.sql` — expected: one added `CREATE INDEX` line. If the diff is empty, the index is missing (a clean diff is not proof of success; see `Bugs.md` SEC-DB-004 for the last time that assumption cost something).

```bash
git add supabase/migrations/128_vehicleinspection_problem_queue_index.sql schema.sql
git commit -m "feat(db): index the vehicleinspection problem-queue predicate"
```

---

### Task 10: `src/lib/inspections/problem-queue.js` — the read model

**Files:**
- Modify: `src/lib/inspections/checklists.js` (add `failedItemsFrom`, the one derivation of a failed item's label and remark)
- Modify: `src/lib/inspections/checklists.test.js` (exists — extend it)
- Create: `src/lib/inspections/problem-queue.js`
- Test: `src/lib/inspections/problem-queue.test.js`

**Interfaces:**
- Consumes: `query` from `@/lib/db`; `isChecklistType` from `@/lib/inspections/checklists` (exported at `checklists.js:35`).
- Produces:
  - `failedItemsFrom(checklist)` → `{ label, remarks }[]`, added to `@/lib/inspections/checklists` and consumed **both** by this module and by Task 12, which needs the same derivation to describe a work order. It lives in `checklists.js` because that file is already the one server-side definition of the item shape; two implementations would drift the first time the stored shape changed.
  - `listVehicleProblems({ limit = 100, offset = 0 })` → `Promise<{ items: Problem[], counts: Counts }>`
  - `countProblemCounts()` → `Promise<Counts>` where `Counts = { reportedUntracked: number, failedUntracked: number, tracked: number }`
  - `driverReport(row)` → `{ kind: "checklist", items: { label, remarks }[] } | { kind: "free_text", text: string }`
  - `severityLabel(severity)` → `string`
  - `bucketFor(row)` → `"reported_untracked" | "failed_untracked" | "tracked"`
  - `Problem = { inspectionId, vehicleId, plateNumber, vehicleName, driverName, inspectionType, inspectionDate, status, severity, severityLabel, report, workOrderId, workOrderStatus, bucket }`

Three traps this module exists to absorb, all verified against the writers rather than assumed:

- **`findings` is `text` holding two different shapes.** `schema.sql:1025` is `findings text`, not `jsonb`. For Pre-Shift / Pre-Trip the inspections route writes `JSON.stringify(failures)` into it (`inspections/route.js:153`); for Post-Shift `standby.service.js:112` writes plain prose from the driver's keyboard. Never sniff the string to decide which — branch on `inspection_type`, which is what `isChecklistType` is for.
- **For the checklist types, read `checklist`, not `findings`.** The route builds `checklist` as `{ item_id, label, status, remarks }` with `label` explicitly defaulted (`inspections/route.js:130-135`), so it is guaranteed to carry a human label and the driver's remark for every item. The `findings` array is `items.filter(FAIL)` — the *submitted* objects, which are not guaranteed to carry `label` at all. `checklist` is the authoritative shape; `findings` is a redundant copy that happens to be what the maintenance bridge reads (`maintenance.js:60-61`), which is fine there because it only needs the free text.
- **`severity IS NULL` means "reported, not assessed", and it must never render as blank.** `standby.service.js:102-112` sets it to `NULL` for a reported defect on purpose: *"the driver answered one question, so no severity was assessed and inventing one would put a judgement in the record that nobody made."* `'None'` is a different value and means the driver asserted they found nothing. A blank cell in a manager's queue reads as "no problem recorded", which is the exact inversion of the truth.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/inspections/problem-queue.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import {
  listVehicleProblems,
  countProblemCounts,
  driverReport,
  severityLabel,
  bucketFor,
} from "./problem-queue";

// Refuse-by-default, matching the fake in maintenance.test.js: a stub that
// answered anything unmatched would let every test here pass without ever
// exercising the statement under test.
function stubQuery(handlers) {
  query.mockImplementation(async (sql, params) => {
    for (const [match, reply] of handlers) {
      if (String(sql).includes(match)) return typeof reply === "function" ? reply(sql, params) : reply;
    }
    throw new Error(`unexpected SQL: ${String(sql).replace(/\s+/g, " ").slice(0, 80)}`);
  });
}

const row = (over = {}) => ({
  inspection_id: 42,
  vehicle_id: 7,
  inspection_type: "Post-Shift",
  inspection_date: "2026-09-23",
  status: "Reported",
  severity: null,
  checklist: null,
  findings: "sira ang preno",
  driver_id: 3,
  plate_number: "ABC 1234",
  vehicle_name: "HiAce",
  first_name: "Juan",
  last_name: "Dela Cruz",
  maintenance_id: null,
  work_order_status: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("severityLabel", () => {
  it("names an ungraded report instead of leaving it blank", () => {
    expect(severityLabel(null)).toBe("Not assessed");
    expect(severityLabel("")).toBe("Not assessed");
    expect(severityLabel("   ")).toBe("Not assessed");
  });

  it("passes a real grade through, including the driver's own 'None'", () => {
    expect(severityLabel("High")).toBe("High");
    // 'None' is the driver asserting they found nothing — NOT the same value as
    // NULL, and collapsing the two is the bug this function exists to prevent.
    expect(severityLabel("None")).toBe("None");
  });
});

describe("driverReport", () => {
  it("returns the failing items from checklist, with the driver's own remarks", () => {
    const report = driverReport(row({
      inspection_type: "Pre-Shift",
      status: "Failed",
      checklist: [
        { item_id: "cabin", label: "Cabin", status: "PASS", remarks: "" },
        { item_id: "brakes", label: "Brakes", status: "FAIL", remarks: "malambot ang preno" },
        { item_id: "tires", label: "Tires", status: "FAIL", remarks: "  kupas ang gulong  " },
      ],
    }));
    expect(report.kind).toBe("checklist");
    expect(report.items).toEqual([
      { label: "Brakes", remarks: "malambot ang preno" },
      { label: "Tires", remarks: "kupas ang gulong" },
    ]);
  });

  it("falls back to item_id when a stored item carries no label", () => {
    const report = driverReport(row({
      inspection_type: "Pre-Trip",
      status: "Failed",
      checklist: [{ item_id: "dashboard", status: "FAIL", remarks: "warning light" }],
    }));
    expect(report.items).toEqual([{ label: "dashboard", remarks: "warning light" }]);
  });

  it("does not fall over on a checklist that is null or not an array", () => {
    expect(driverReport(row({ inspection_type: "Pre-Shift", checklist: null })).items).toEqual([]);
    expect(driverReport(row({ inspection_type: "Pre-Shift", checklist: "oops" })).items).toEqual([]);
  });

  it("returns free text for Post-Shift, whose checklist is always NULL", () => {
    const report = driverReport(row({ findings: "  maingay ang aircon  " }));
    expect(report).toEqual({ kind: "free_text", text: "maingay ang aircon" });
  });
});

describe("bucketFor", () => {
  it("calls a reported defect with no work order reported_untracked", () => {
    expect(bucketFor(row({ status: "Reported", maintenance_id: null }))).toBe("reported_untracked");
  });

  it("calls a reported defect with a work order tracked", () => {
    expect(bucketFor(row({ status: "Reported", maintenance_id: 99 }))).toBe("tracked");
  });

  it("calls a failed checklist inspection failed_untracked — closable, but raised by hand", () => {
    expect(bucketFor(row({ inspection_type: "Pre-Shift", status: "Failed", maintenance_id: null }))).toBe("failed_untracked");
  });

  it("calls a failed checklist inspection with a work order tracked too", () => {
    expect(bucketFor(row({ inspection_type: "Pre-Trip", status: "Failed", maintenance_id: 99 }))).toBe("tracked");
  });
});

describe("listVehicleProblems", () => {
  it("maps a row into the shape the page renders", async () => {
    stubQuery([["FROM vehicleinspection i", { rows: [row()] }]]);
    const { items } = await listVehicleProblems();
    expect(items).toEqual([
      {
        inspectionId: 42,
        vehicleId: 7,
        plateNumber: "ABC 1234",
        vehicleName: "HiAce",
        driverName: "Juan Dela Cruz",
        inspectionType: "Post-Shift",
        inspectionDate: "2026-09-23",
        status: "Reported",
        severity: null,
        severityLabel: "Not assessed",
        report: { kind: "free_text", text: "sira ang preno" },
        workOrderId: null,
        workOrderStatus: null,
        bucket: "reported_untracked",
      },
    ]);
  });

  it("survives an inspection with no driver — driver_id is nullable", async () => {
    stubQuery([["FROM vehicleinspection i", {
      rows: [row({ driver_id: null, first_name: null, last_name: null })],
    }]]);
    const { items } = await listVehicleProblems();
    expect(items[0].driverName).toBeNull();
  });

  it("tallies each bucket over the page it returned", async () => {
    stubQuery([["FROM vehicleinspection i", {
      rows: [
        row({ inspection_id: 1, status: "Reported", maintenance_id: null }),
        row({ inspection_id: 2, status: "Reported", maintenance_id: 99, work_order_status: "In Progress" }),
        row({ inspection_id: 3, inspection_type: "Pre-Trip", status: "Failed", checklist: [] }),
      ],
    }]]);
    const { counts } = await listVehicleProblems();
    expect(counts).toEqual({ reportedUntracked: 1, failedUntracked: 1, tracked: 1 });
  });

  it("passes the page window through as bound parameters", async () => {
    stubQuery([["FROM vehicleinspection i", { rows: [] }]]);
    await listVehicleProblems({ limit: 25, offset: 50 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1 OFFSET $2"), [25, 50]);
  });
});

describe("countProblemCounts", () => {
  it("returns the aggregate row, not a page-scoped tally", async () => {
    stubQuery([["COUNT(*)", { rows: [{ reported_untracked: 4, failed_untracked: 9, tracked: 11 }] }]]);
    await expect(countProblemCounts()).resolves.toEqual({ reportedUntracked: 4, failedUntracked: 9, tracked: 11 });
  });

  it("reads as all-zero rather than undefined when the aggregate returns nothing", async () => {
    stubQuery([["COUNT(*)", { rows: [] }]]);
    await expect(countProblemCounts()).resolves.toEqual({ reportedUntracked: 0, failedUntracked: 0, tracked: 0 });
  });
});
```

And append to the existing `src/lib/inspections/checklists.test.js` — add `failedItemsFrom` to its import from `"./checklists"` (the file already imports the item constants), then:

```js
describe("failedItemsFrom", () => {
  it("keeps only the FAIL items, with the driver's remark trimmed", () => {
    expect(failedItemsFrom([
      { item_id: "cabin", label: "Cabin", status: "PASS", remarks: "" },
      { item_id: "brakes", label: "Brakes", status: "FAIL", remarks: "  malambot ang preno  " },
      { item_id: "tires", label: "Tires", status: "FAIL", remarks: "kupas ang gulong" },
    ])).toEqual([
      { label: "Brakes", remarks: "malambot ang preno" },
      { label: "Tires", remarks: "kupas ang gulong" },
    ]);
  });

  it("falls back to item_id when a stored item carries no label", () => {
    expect(failedItemsFrom([{ item_id: "dashboard", status: "FAIL", remarks: "warning light" }]))
      .toEqual([{ label: "dashboard", remarks: "warning light" }]);
  });

  it("returns an empty list for null, a non-array, or a remark-less item", () => {
    // Post-Shift stores checklist as NULL by construction, so this is the
    // ordinary case for one of the three types, not an edge case.
    expect(failedItemsFrom(null)).toEqual([]);
    expect(failedItemsFrom("oops")).toEqual([]);
    expect(failedItemsFrom([{ item_id: "brakes", label: "Brakes", status: "FAIL" }]))
      .toEqual([{ label: "Brakes", remarks: "" }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/inspections/problem-queue.test.js src/lib/inspections/checklists.test.js`

Expected: FAIL — `Failed to resolve import "./problem-queue"`, and `failedItemsFrom is not a function` in the checklists suite.

- [ ] **Step 3: Write the shared derivation, then the module**

Add to `src/lib/inspections/checklists.js`, beside `itemsForType` — same concern (what an item is):

```js
/**
 * The failed items of a stored checklist, as { label, remarks }.
 *
 * The stored entry is { item_id, label, status, remarks } — the inspections
 * route defaults `label` to item_id (route.js:130-135), so a human label is
 * normally present, and the fallback is here for rows written before that
 * default rather than to paper over a missing field.
 *
 * Returns [] for a checklist that is null or not an array. That is the ORDINARY
 * case for Post-Shift, which stores NULL by construction (standby.service.js:109)
 * — not an error, and not something every caller should have to guard for.
 */
export function failedItemsFrom(checklist) {
  const items = Array.isArray(checklist) ? checklist : [];
  return items
    .filter((item) => item?.status === "FAIL")
    .map((item) => ({
      label: item.label || item.item_id,
      remarks: String(item.remarks ?? "").trim(),
    }));
}
```

Then create `src/lib/inspections/problem-queue.js`:

```js
import { query } from "@/lib/db";
import { isChecklistType, failedItemsFrom } from "@/lib/inspections/checklists";

// The office's worklist of vehicle problems: inspections the driver flagged, and
// End Duty reports that named a defect.
//
// Read-only, and deliberately thin. Resolution is NOT modelled here — it is the
// existence of a vehiclemaintenance row linked by source_inspection_id, which is
// a real artifact with a real workflow behind it rather than a flag this module
// invents. uq_vehiclemaintenance_source_inspection (migration 121) is UNIQUE on
// that column, which is what lets the LEFT JOIN below be a join rather than a
// fan-out: at most one work order can ever match, so a row cannot multiply.
//
// The three buckets. Both *_untracked ones are closable from the queue; only
// reported_untracked is COUNTED as an exception, because a failed Pre-Shift was
// already answered by the notification the office received when it happened,
// while a reported defect whose automatic raise failed is answered by nobody.
// See the plan, and src/lib/inspections/maintenance.js:53-55 for the automatic
// path this deliberately leaves alone.

export const PROBLEM_QUEUE_LIMIT = 100;

const QUEUE_SQL = `
  SELECT i.inspection_id, i.vehicle_id, i.inspection_type, i.inspection_date,
         i.status, i.severity, i.checklist, i.findings, i.driver_id,
         v.plate_number, v.vehicle_name,
         e.first_name, e.last_name,
         wo.maintenance_id, wo.status AS work_order_status
    FROM vehicleinspection i
    LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
    LEFT JOIN drivers d ON d.driver_id = i.driver_id
    LEFT JOIN employees e ON e.employee_id = d.employee_id
    LEFT JOIN vehiclemaintenance wo ON wo.source_inspection_id = i.inspection_id
   WHERE i.status = 'Failed'
      OR (i.inspection_type = 'Post-Shift' AND i.status = 'Reported')
   ORDER BY i.inspection_date DESC, i.inspection_id DESC
   LIMIT $1 OFFSET $2
`;

// The strip's count, deliberately NOT derived from the query above: that one is
// capped by LIMIT, so a tally over its rows would silently stop counting at the
// page size and read as "under control" on the day it matters most.
const COUNT_SQL = `
  SELECT
    COUNT(*) FILTER (
      WHERE i.inspection_type = 'Post-Shift' AND i.status = 'Reported'
        AND wo.maintenance_id IS NULL
    )::int AS reported_untracked,
    COUNT(*) FILTER (
      WHERE i.status = 'Failed' AND wo.maintenance_id IS NULL
    )::int AS failed_untracked,
    COUNT(*) FILTER (WHERE wo.maintenance_id IS NOT NULL)::int AS tracked
    FROM vehicleinspection i
    LEFT JOIN vehiclemaintenance wo ON wo.source_inspection_id = i.inspection_id
   WHERE i.status = 'Failed'
      OR (i.inspection_type = 'Post-Shift' AND i.status = 'Reported')
`;

/**
 * A reported defect is "untracked" only while no repair ticket exists.
 *
 * Which is the whole point of the queue: raising the work order is best-effort
 * by design (raiseEndDutyWorkOrder explains why), so the failure case is a
 * vehicle with a driver-reported fault and nothing tracking it — visible to
 * nobody today.
 *
 * A failed Pre-Shift / Pre-Trip gets its own bucket rather than sharing this
 * one, because the two are counted differently on the dashboard even though both
 * can be closed from the queue. The split is by inspection_type, not by status
 * alone: 'Failed' happens to imply a checklist type today, but that is a
 * coincidence of the current writers rather than a rule, and depending on it
 * would break quietly the first time a Post-Shift fails.
 */
export function bucketFor(row) {
  if (row.maintenance_id) return "tracked";
  if (row.inspection_type === "Post-Shift") return "reported_untracked";
  return "failed_untracked";
}

/**
 * NULL is not "no severity" — it is "reported, and nobody assessed it".
 * standby.service.js:102-112 sets it that way on purpose. 'None' is a different
 * value: the driver's own assertion that they found nothing.
 */
export function severityLabel(severity) {
  const value = String(severity ?? "").trim();
  return value || "Not assessed";
}

/**
 * The driver's own words, in the shape the two record types actually store.
 *
 * Both branches end at `failedItemsFrom` for the checklist case — the
 * derivation of label and remark lives in checklists.js so this module and
 * Task 12's work-order description cannot disagree about what "the failed
 * items" are.
 *
 * Post-Shift is the other way round: `checklist` is NULL by construction
 * (standby.service.js:109) and `findings` is the driver's free text.
 */
export function driverReport(row) {
  if (isChecklistType(row.inspection_type)) {
    return { kind: "checklist", items: failedItemsFrom(row.checklist) };
  }
  return { kind: "free_text", text: String(row.findings ?? "").trim() };
}

function shape(row) {
  return {
    inspectionId: row.inspection_id,
    vehicleId: row.vehicle_id,
    plateNumber: row.plate_number ?? null,
    vehicleName: row.vehicle_name ?? null,
    // driver_id is nullable on this table, so first_name/last_name can both be
    // null — join them rather than assuming a reporter exists.
    driverName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
    inspectionType: row.inspection_type,
    inspectionDate: row.inspection_date,
    status: row.status,
    severity: row.severity ?? null,
    severityLabel: severityLabel(row.severity),
    report: driverReport(row),
    workOrderId: row.maintenance_id ?? null,
    workOrderStatus: row.work_order_status ?? null,
    bucket: bucketFor(row),
  };
}

export async function listVehicleProblems({ limit = PROBLEM_QUEUE_LIMIT, offset = 0 } = {}) {
  const { rows } = await query(QUEUE_SQL, [limit, offset]);
  const items = rows.map(shape);
  return {
    items,
    counts: {
      reportedUntracked: items.filter((i) => i.bucket === "reported_untracked").length,
      failedUntracked: items.filter((i) => i.bucket === "failed_untracked").length,
      tracked: items.filter((i) => i.bucket === "tracked").length,
    },
  };
}

export async function countProblemCounts() {
  const { rows } = await query(COUNT_SQL);
  const row = rows[0] ?? {};
  return {
    reportedUntracked: row.reported_untracked ?? 0,
    failedUntracked: row.failed_untracked ?? 0,
    tracked: row.tracked ?? 0,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/inspections/problem-queue.test.js src/lib/inspections/checklists.test.js`

Expected: PASS — 16 tests in `problem-queue.test.js`, and the checklists suite green with its 3 new ones.

- [ ] **Step 5: Run the full suite — this file is imported by Tasks 11-13 later**

Run: `npm run test:run`

Expected: all green. If `npm test` fails on the schema contract, it is unrelated to this task — the contract is checked in `scripts/lib/schema-contract.mjs` and this task adds no table or view.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inspections/problem-queue.js src/lib/inspections/problem-queue.test.js
git commit -m "feat(inspections): add the vehicle problem queue read model"
```

---

## Amendment 14 (Task 10) — the work-order join must exclude archived tickets

**NOT authorised by a fix round.** Made unilaterally while executing Task 10's Step 1/3, under this plan's own
standing rule that every trap is "verified against the writers rather than assumed". Recorded here because it
deviates from the SQL printed above, it is one line, and it is trivially revertible if the human disagrees.

**What changed.** Both `QUEUE_SQL` and `COUNT_SQL` now join as:

```sql
LEFT JOIN vehiclemaintenance wo
       ON wo.source_inspection_id = i.inspection_id
      AND wo.deleted_at IS NULL
```

The plan's SQL omits `AND wo.deleted_at IS NULL`.

**Why the omission is wrong, from four places that already know:**

1. `vehicle.service.js:75` `archiveVehicleMaintenance(id)` PUTs `{ deleted_at }` to
   `/api/vehicle-maintenance/<id>` — archiving is a real, reachable button, not a dormant column.
2. `[id]/route.js:37` maps `deleted_at: "deleted_at"` into the allowlist, `:66` validates it, and the
   route's own reads at `:77` and `:159` both filter `deleted_at IS NULL` (with a comment at `:95-98`
   explaining why an archived row must not be editable).
3. **The decisive one:** `src/app/api/incidents/route.js:92` answers the *identical* question — "is this
   driver's report tracked by a work order" — and joins it as
   `LEFT JOIN vehiclemaintenance m ON m.source_incident_id = i.incident_id AND m.deleted_at IS NULL`.
   A queue that disagreed with its own sibling would give two answers to one question.
4. `vehicle-maintenance/route.js:76` lists with `WHERE vm.deleted_at IS NULL`.

**The failure it prevents:** with the plan's SQL, archiving the work order would flip an inspection back to
`reported_untracked` in *form* but the row would still carry `wo.maintenance_id`, so `bucketFor` returns
`tracked` and the fault leaves the queue while nothing tracks it — the precise condition this page exists to
make visible, produced by the ordinary act of archiving a ticket.

**Nothing else moves.** No schema change, no new column, no RLS, no change to `bucketFor`'s semantics or to
any bucket's counting rule. It is a join predicate only.

**Two extra tests** were added (18 in `problem-queue.test.js`, not the 16 Step 4 predicted), because the DB
is mocked at unit level: the predicate *is* the behaviour, so the only honest assertion is on the statement.
One for the list, one for the count, both pinning `AND wo.deleted_at IS NULL` — the count one matters
because a strip that disagreed with the list beneath it would be the same bug one layer down.

**Gates for Task 10:** `npm run lint` 0 · `npm run test:run` **210 files / 2586 tests** (was 209 / 2565) ·
targeted run 36/36. Step 6 commit skipped per the standing instruction "subagent-driven but dont commit
anything".

---

### Task 11: `GET /api/vehicle-inspections/problems`

**Files:**
- Create: `src/app/api/vehicle-inspections/problems/route.js`
- Test: `src/app/api/vehicle-inspections/problems/route.test.js`

**Interfaces:**
- Consumes: `listVehicleProblems`, `countProblemCounts` from Task 10.
- Produces: `GET /api/vehicle-inspections/problems` → `{ items, counts }`; `GET /api/vehicle-inspections/problems?scope=count` → `{ counts }`. Consumed by Task 13.

Before writing the handler, read the relevant guide in `node_modules/next/dist/docs/` — `CLAUDE.md` makes this mandatory for Next.js code, and this version's route-handler conventions may differ from what you expect. Also read `src/app/api/vehicle-maintenance/route.js:105-130` and follow it: `requirePermission` → work → `ok(...)`, with `handleError` wrapping the whole body.

Authorization is `maintenance:read`. **Do not add a resource to the matrix** — `rolesFor("maintenance", "read")` already resolves to super_admin + admin + fleet_manager, which is the same set `NAV_ROLES["/maintenance"]` gates the page with (see the note at the top of Part B).

- [ ] **Step 1: Write the failing test**

Create `src/app/api/vehicle-inspections/problems/route.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});
vi.mock("@/lib/inspections/problem-queue", () => ({
  listVehicleProblems: vi.fn(),
  countProblemCounts: vi.fn(),
}));

import { requirePermission } from "@/lib/api/utils";
import { listVehicleProblems, countProblemCounts } from "@/lib/inspections/problem-queue";
import { GET } from "./route";

const req = (url = "http://test/api/vehicle-inspections/problems") => new Request(url);

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { employeeId: 1 } });
});

describe("GET /api/vehicle-inspections/problems", () => {
  it("requires the maintenance read capability", async () => {
    listVehicleProblems.mockResolvedValue({ items: [], counts: { reportedUntracked: 0, failedUntracked: 0, tracked: 0 } });
    await GET(req());
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "maintenance", "read");
  });

  it("returns the queue page", async () => {
    listVehicleProblems.mockResolvedValue({ items: [{ inspectionId: 42 }], counts: { reportedUntracked: 1, failedUntracked: 0, tracked: 0 } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [{ inspectionId: 42 }], counts: { reportedUntracked: 1, failedUntracked: 0, tracked: 0 } });
  });

  it("answers scope=count with the exact count and no rows", async () => {
    countProblemCounts.mockResolvedValue({ reportedUntracked: 4, failedUntracked: 9, tracked: 11 });
    const res = await GET(req("http://test/api/vehicle-inspections/problems?scope=count"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ counts: { reportedUntracked: 4, failedUntracked: 9, tracked: 11 } });
    // The strip must not pull the page: that is the whole reason this branch exists.
    expect(listVehicleProblems).not.toHaveBeenCalled();
  });

  it("bounds the page window and refuses a nonsense one", async () => {
    listVehicleProblems.mockResolvedValue({ items: [], counts: { reportedUntracked: 0, failedUntracked: 0, tracked: 0 } });
    await GET(req("http://test/api/vehicle-inspections/problems?limit=100000&offset=-5"));
    expect(listVehicleProblems).toHaveBeenCalledWith({ limit: 100, offset: 0 });
  });

  it("refuses an unauthenticated caller without querying", async () => {
    requirePermission.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }));
    const res = await GET(req());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(listVehicleProblems).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/vehicle-inspections/problems/route.test.js`

Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Write the route**

Create `src/app/api/vehicle-inspections/problems/route.js`:

```js
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { listVehicleProblems, countProblemCounts, PROBLEM_QUEUE_LIMIT } from "@/lib/inspections/problem-queue";

// The office's vehicle problem queue. Read-only; resolving a row is
// POST /api/vehicle-inspections/[inspectionId]/work-order.
//
// Authorized as maintenance:read rather than as a new `inspections` resource —
// rolesFor("maintenance", "read") is already super_admin + admin +
// fleet_manager, the same three roles NAV_ROLES already gates /maintenance with,
// so this needs no change to permissions.js.
//
// scope=count exists so the role dashboard's attention strip can show an exact
// figure without pulling a page of rows on every dashboard load.

const MAX_LIMIT = PROBLEM_QUEUE_LIMIT;

function boundedInt(raw, fallback, { min = 0, max } = {}) {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
}

export async function GET(req) {
  try {
    await requirePermission(req, "maintenance", "read");

    const params = new URL(req.url).searchParams;
    if (params.get("scope") === "count") {
      return ok({ counts: await countProblemCounts() });
    }

    const limit = boundedInt(params.get("limit"), MAX_LIMIT, { min: 1, max: MAX_LIMIT });
    const offset = boundedInt(params.get("offset"), 0, { min: 0 });
    return ok(await listVehicleProblems({ limit, offset }));
  } catch (error) {
    return handleError(error);
  }
}
```

The helper signatures below are confirmed against `src/lib/api/utils.js:278-322`: `ok(data, status = 200)`, `err(message, status = 400)`, `handleError(error)`. `handleError` maps an `AuthError` to its own status and logs the rest, so an auth rejection propagates correctly without a branch here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/api/vehicle-inspections/problems/route.test.js`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/vehicle-inspections/problems/route.js src/app/api/vehicle-inspections/problems/route.test.js
git commit -m "feat(api): expose the vehicle problem queue to the office"
```

---

### Task 12: The office raise — an explicit path through the two shared modules, then the route

**Files:**
- Modify: `src/lib/inspections/report.js` (add `buildChecklistMaintenancePayload`)
- Modify: `src/lib/inspections/report.test.js` (exists — extend it)
- Modify: `src/lib/inspections/maintenance.js` (`ensureInspectionMaintenance` gains `allowChecklistType`, and its source SELECT gains the two columns the checklist payload needs)
- Modify: `src/lib/inspections/maintenance.test.js` (exists — extend it)
- Create: `src/app/api/vehicle-inspections/[inspectionId]/work-order/route.js`
- Test: `src/app/api/vehicle-inspections/[inspectionId]/work-order/route.test.js`

**Interfaces:**
- Consumes: `ensureInspectionMaintenance`, `notifyMaintenanceTeam` from `@/lib/inspections/maintenance`; `failedItemsFrom` from Task 10.
- Produces:
  - `buildChecklistMaintenancePayload({ inspectionId, vehicleId, plateNumber, inspectionType, severity, failedItems })` → a `vehiclemaintenance` insert payload whose `status` is **always** `"Scheduled"`.
  - `ensureInspectionMaintenance({ inspectionId, session, allowChecklistType = false })` — the existing call shape still works unchanged.
  - `POST` → `201 { workOrder, created: true }` when raised, `200 { workOrder, created: false }` when one already existed. Consumed by Task 13.

**This is the task without which Part B is unusable** (see fact 1 at the top of Part B). `FIELD_TO_COLUMN` cannot set `source_inspection_id`, so the only existing writers are the driver's phone and this route.

Reuse `ensureInspectionMaintenance` rather than writing a second insert. It already does the things that are hard to get right: the `FOR UPDATE OF i` row lock, the `ON CONFLICT DO NOTHING` plus re-select recovery, and the idempotency that a unique `source_inspection_id` buys. Writing a parallel implementation here would duplicate all of it and drift.

**Two properties must hold, and they are the whole point of the amendment.**

`allowChecklistType` **defaults to `false`, and only this route passes `true`.** Every automatic path therefore keeps raising nothing for a failed checklist, which is what leaves the decision at `maintenance.js:53-55` deferred rather than quietly reversed. `maintenance.test.js:91-95` already pins that refusal. **It must still pass, unmodified, after this task** — if it does not, the change has gone wider than intended, and the fix is to narrow the change rather than to update the test.

**A checklist raise files as `Scheduled`, never `In Progress`.** `status` is the grounding lever, not a label (`report.js:26-28`). The new builder therefore takes no `grounded` argument at all — there is no branch to get wrong — and it never calls `shouldGroundReportedDefect`, which is a keyword test over free prose and meaningless run against a JSON array of failed items.

One deliberate difference from the driver path: **this one does not swallow failures.** `raiseEndDutyWorkOrder` never throws, because it is called from the path that ends a driver's shift and a maintenance failure must not strand them. A manager who clicked a button is owed the truth instead — so call `ensureInspectionMaintenance` directly, and let a notification failure become a 500 rather than a silent `{ failed: true }`. The work order still exists at that point, so say which half failed.

- [ ] **Step 1: Write the failing module tests**

Append to `src/lib/inspections/report.test.js` — add `buildChecklistMaintenancePayload` to its existing import from `"./report"` (the file already imports `buildInspectionMaintenancePayload` and `toCalendarDay`):

```js
describe("buildChecklistMaintenancePayload", () => {
  const failedItems = [
    { label: "Brakes", remarks: "malambot ang preno" },
    { label: "Tires", remarks: "kupas ang gulong" },
  ];
  const base = {
    inspectionId: 42,
    vehicleId: 7,
    plateNumber: "ABC 1234",
    inspectionType: "Pre-Shift",
    severity: "High",
    failedItems,
  };

  it("never grounds — Scheduled/Normal even at High severity", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.status).toBe("Scheduled");
    expect(payload.priority).toBe("Normal");
  });

  it("names the inspection type and every failed item with the driver's remark", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.description).toContain("Pre-Shift");
    expect(payload.description).toContain("Brakes: malambot ang preno");
    expect(payload.description).toContain("Tires: kupas ang gulong");
  });

  it("does not claim an End Duty report — nobody ended a shift", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.description).not.toContain("end of shift");
    expect(payload.remarks).not.toContain("End Duty");
  });

  it("states the severity and that no automatic grounding applied", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.remarks).toContain("High");
    expect(payload.remarks).toMatch(/raised by the office/i);
  });

  it("names an ungraded severity rather than leaving it blank", () => {
    // The same NULL-vs-'None' distinction the queue renders: a checklist
    // failure always carries a computed severity, so NULL here means the row
    // was written outside the inspections route.
    const payload = buildChecklistMaintenancePayload({ ...base, severity: null });
    expect(payload.remarks).toContain("Not assessed");
  });

  it("still describes the work when a failed item has no remark", () => {
    const payload = buildChecklistMaintenancePayload({
      ...base,
      failedItems: [{ label: "Brakes", remarks: "" }],
    });
    expect(payload.description).toContain("Brakes");
  });

  it("files at zero cost with today's date", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.cost).toBe(0);
    expect(payload.maintenance_date).toBe(toCalendarDay(new Date()));
  });
});
```

Then append to `src/lib/inspections/maintenance.test.js`, inside its existing top-level `describe` (the file already has `inspectionRow`, `workOrderRow`, `call`, and `paramsOf` helpers):

```js
  it("raises a work order for a failed Pre-Shift only when the office asks", async () => {
    const tx = call([
      ["FOR UPDATE OF i", {
        rows: [inspectionRow({
          inspection_type: "Pre-Shift",
          severity: "High",
          checklist: [{ item_id: "brakes", label: "Brakes", status: "FAIL", remarks: "malambot" }],
        })],
      }],
      ["WHERE source_inspection_id = $1", { rows: [] }],
      ["INSERT INTO vehiclemaintenance", { rows: [workOrderRow()] }],
    ]);
    const result = await ensureInspectionMaintenance({ inspectionId: 42, allowChecklistType: true });
    expect(result).toMatchObject({ created: true });
    // Scheduled, not In Progress: a raise from the queue must never ground.
    expect(paramsOf(tx, "INSERT INTO vehiclemaintenance")).toContain("Scheduled");
  });

  it("still refuses a failed Pre-Shift when the flag is not passed", async () => {
    // The automatic path. This is the same assertion the pre-existing test makes,
    // restated for the option's default so a future refactor cannot widen it.
    call([["FOR UPDATE OF i", { rows: [inspectionRow({ inspection_type: "Pre-Shift" })] }]]);
    await expect(ensureInspectionMaintenance({ inspectionId: 42 })).resolves.toMatchObject({ notRequired: true });
  });

  it("does not describe an office raise as an end-of-shift report", async () => {
    await notifyMaintenanceTeam({ maintenance_id: 99, vehicle_id: 7, status: "Scheduled" }, 42, {
      source: "failed Pre-Shift inspection",
    });
    const [, params] = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO notifications"));
    expect(params[2]).toContain("failed Pre-Shift inspection");
    expect(params[2]).not.toContain("end-of-shift");
  });
```

- [ ] **Step 2: Run the module tests to verify they fail**

Run: `npx vitest run src/lib/inspections/report.test.js src/lib/inspections/maintenance.test.js`

Expected: FAIL — `buildChecklistMaintenancePayload is not a function`, and the notification assertion fails because the default wording still says "end-of-shift".

- [ ] **Step 3: Add the builder to `src/lib/inspections/report.js`**

```js
/**
 * Build the work order for a failed checklist inspection, raised by the office.
 *
 * Deliberately not the function above with different arguments — the
 * differences are load-bearing:
 *
 *  - There is no `grounded` parameter, so there is no branch: status is always
 *    SCHEDULED_STATUS. That is not caution, it is arithmetic. A Pre-Trip's four
 *    items ARE the critical set (CRITICAL_ITEM_IDS = [...PRE_TRIP_ITEMS]), so
 *    every failed Pre-Trip is 'High' by construction, and a Pre-Trip runs per
 *    trip. Ground-on-High here would take a vehicle out of service on a mis-tap
 *    several times a day, which is how drivers learn to pass things.
 *  - It does not call shouldGroundReportedDefect, which keyword-matches free
 *    prose. `findings` for a checklist type is a JSON array of items, so that
 *    test would be run against the wrong input entirely.
 *  - The wording names the inspection type. The End Duty sentence ("reported by
 *    driver at end of shift") would be false: nobody ended a shift.
 */
export function buildChecklistMaintenancePayload({
  inspectionId, vehicleId, plateNumber, inspectionType, severity, failedItems,
}) {
  const vehicle = plateNumber ? `vehicle #${vehicleId} / ${plateNumber}` : `vehicle #${vehicleId}`;
  const items = Array.isArray(failedItems) ? failedItems : [];
  const described = items
    .map((item) => (item.remarks ? `${item.label}: ${item.remarks}` : item.label))
    .join("; ");

  return {
    maintenance_date: toCalendarDay(new Date()),
    maintenance_type: DEFECT_TYPE,
    description: `${inspectionType} inspection failed (inspection #${inspectionId}, ${vehicle}): ${described}`,
    cost: 0,
    status: SCHEDULED_STATUS,
    priority: SCHEDULED_PRIORITY,
    remarks:
      `Raised by the office from a failed ${inspectionType} inspection | Severity ${severity || "Not assessed"} | ` +
      "Filed for triage, not grounded — a failed checklist does not remove a vehicle from dispatch; the office decides that.",
  };
}
```

- [ ] **Step 4: Add the option to `src/lib/inspections/maintenance.js`**

Add `import { failedItemsFrom } from "@/lib/inspections/checklists";`, add `buildChecklistMaintenancePayload` to the existing `@/lib/inspections/report` import, then change `ensureInspectionMaintenance` to:

```js
export async function ensureInspectionMaintenance({ inspectionId, session, allowChecklistType = false }) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      // FOR UPDATE OF i: a bare FOR UPDATE cannot lock the nullable side of a
      // LEFT JOIN, and the lock is what serialises two retries of the same
      // submission racing each other.
      //
      // severity and checklist are read for the office path only; the End Duty
      // path ignores both.
      `SELECT i.inspection_id, i.vehicle_id, i.inspection_type, i.findings,
              i.severity, i.checklist, v.plate_number
         FROM vehicleinspection i
         LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
        WHERE i.inspection_id = $1
        FOR UPDATE OF i`,
      [inspectionId]
    );
    const inspection = rows[0];
    if (!inspection) return { notFound: true };

    // Only End Duty reports raise work orders automatically. A failed Pre-Shift
    // or Pre-Trip is a different workflow and deliberately not wired here —
    // those failures are recorded and escalate to nobody (a known residual,
    // noted in the vault).
    //
    // allowChecklistType is the ONE way past this, and only the office route
    // sets it: a person, looking at one specific failed inspection, deciding to
    // raise a ticket for it. Nothing a driver does reaches it.
    const isChecklistType = inspection.inspection_type !== "Post-Shift";
    if (isChecklistType && !allowChecklistType) {
      return { notRequired: true, inspection };
    }

    // "Nothing unusual" is a real answer and raises nothing. Only a reported
    // observation becomes a work order, which is the entire point of the
    // two-way flag on the request.
    const findings = String(inspection.findings ?? "").trim();
    if (!isChecklistType && !findings) return { notReported: true, inspection };

    // A 'Failed' checklist row always carries at least one FAIL — the route
    // cannot write one otherwise. This guards a row written outside that route;
    // it is not a case the app produces.
    const failedItems = isChecklistType ? failedItemsFrom(inspection.checklist) : [];
    if (isChecklistType && !failedItems.length) return { notReported: true, inspection };

    const { rows: existingRows } = await tx.query(SELECT_WORK_ORDER, [inspection.inspection_id]);
    if (existingRows[0]) return { workOrder: existingRows[0], created: false, inspection };

    const payload = isChecklistType
      ? buildChecklistMaintenancePayload({
          inspectionId: inspection.inspection_id,
          vehicleId: inspection.vehicle_id,
          plateNumber: inspection.plate_number,
          inspectionType: inspection.inspection_type,
          severity: inspection.severity,
          failedItems,
        })
      : buildInspectionMaintenancePayload({
          inspectionId: inspection.inspection_id,
          vehicleId: inspection.vehicle_id,
          plateNumber: inspection.plate_number,
          findings,
          // Derived from the stored row rather than trusted from the caller: the
          // decision that takes a vehicle out of dispatch should not depend on
          // the route having passed the right boolean.
          grounded: shouldGroundReportedDefect(findings),
        });
```

Leave the INSERT and its recovery path exactly as they are. Then change `notifyMaintenanceTeam`'s signature and message so an office raise does not claim to be a driver's report:

```js
export async function notifyMaintenanceTeam(workOrder, inspectionId, { source = "end-of-shift report" } = {}) {
  ...
  const title = "End Duty Report Filed a Vehicle Repair";
  const grounded = workOrder.status === "In Progress";
  const message =
    `Work order #${workOrder.maintenance_id} was created from a ${source} ` +
    `(inspection #${inspectionId}) for vehicle #${workOrder.vehicle_id}. ` +
    ...unchanged...;
```

The title still reads "End Duty Report Filed a Vehicle Repair" for both. That is a small lie for an office raise and it is worth one line to fix: make it `source === "end-of-shift report" ? "End Duty Report Filed a Vehicle Repair" : "Failed Inspection Filed a Vehicle Repair"`. The default caller (`raiseEndDutyWorkOrder`) passes no third argument, so the driver path's title and message are byte-identical to today.

- [ ] **Step 5: Run the module tests to verify they pass**

Run: `npx vitest run src/lib/inspections/report.test.js src/lib/inspections/maintenance.test.js`

Expected: PASS — 7 new tests in `report.test.js`, 3 in `maintenance.test.js`, and **every pre-existing test in `maintenance.test.js` still green**, including the `notRequired` one at `:91-95`. If that one fails, the flag leaked into the automatic path: narrow the change, do not edit the test.

- [ ] **Step 6: Write the failing route test**

Create `src/app/api/vehicle-inspections/[inspectionId]/work-order/route.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});
vi.mock("@/lib/inspections/maintenance", () => ({
  ensureInspectionMaintenance: vi.fn(),
  notifyMaintenanceTeam: vi.fn(),
}));

import { requirePermission } from "@/lib/api/utils";
import { ensureInspectionMaintenance, notifyMaintenanceTeam } from "@/lib/inspections/maintenance";
import { POST } from "./route";

const ctx = (inspectionId = "42") => ({ params: Promise.resolve({ inspectionId }) });
const req = () => new Request("http://test/x", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { employeeId: 1 } });
  notifyMaintenanceTeam.mockResolvedValue(undefined);
});

describe("POST work-order", () => {
  it("requires the maintenance create capability", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ notFound: true });
    await POST(req(), ctx());
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "maintenance", "create");
  });

  it("raises the work order and announces it, returning 201", async () => {
    const workOrder = { maintenance_id: 99, status: "Scheduled" };
    ensureInspectionMaintenance.mockResolvedValue({
      workOrder, created: true, inspection: { inspection_id: 42, inspection_type: "Pre-Shift" },
    });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(201);
    // The flag is what lets a checklist type through. Passing it is this route's
    // entire reason to exist; omitting it would turn the button into a 400.
    expect(ensureInspectionMaintenance).toHaveBeenCalledWith({
      inspectionId: 42,
      session: expect.objectContaining({ user: expect.anything() }),
      allowChecklistType: true,
    });
    // The source is derived from the record, so the announcement cannot call a
    // Pre-Shift an end-of-shift report.
    expect(notifyMaintenanceTeam).toHaveBeenCalledWith(workOrder, 42, { source: "failed Pre-Shift inspection" });
  });

  it("calls it an end-of-shift report when it actually was one", async () => {
    const workOrder = { maintenance_id: 99, status: "Scheduled" };
    ensureInspectionMaintenance.mockResolvedValue({
      workOrder, created: true, inspection: { inspection_id: 42, inspection_type: "Post-Shift" },
    });
    await POST(req(), ctx());
    expect(notifyMaintenanceTeam).toHaveBeenCalledWith(workOrder, 42, { source: "end-of-shift report" });
  });

  it("is idempotent — an existing work order is 200 and is not re-announced", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ workOrder: { maintenance_id: 99 }, created: false });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(notifyMaintenanceTeam).not.toHaveBeenCalled();
  });

  it("treats an unexpected refusal as a server error, not a user error", async () => {
    // Unreachable while this route passes allowChecklistType — the module only
    // refuses a checklist type when the flag is false. Kept because a future
    // refusal reason must not read as success, and a 500 is easier to find in
    // the logs than a created:false nobody looks at.
    ensureInspectionMaintenance.mockResolvedValue({ notRequired: true, inspection: { inspection_type: "Pre-Shift" } });
    expect((await POST(req(), ctx())).status).toBe(500);
  });

  it("refuses an End Duty report that recorded nothing unusual", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ notReported: true });
    expect((await POST(req(), ctx())).status).toBe(400);
  });

  it("is a 404 for an inspection that does not exist", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ notFound: true });
    expect((await POST(req(), ctx())).status).toBe(404);
  });

  it("rejects a non-numeric inspection id before touching the database", async () => {
    const res = await POST(req(), ctx("abc"));
    expect(res.status).toBe(400);
    expect(ensureInspectionMaintenance).not.toHaveBeenCalled();
  });

  it("reports a notification failure as a 500 that names which half failed", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ workOrder: { maintenance_id: 99 }, created: true });
    notifyMaintenanceTeam.mockRejectedValue(new Error("push down"));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(500);
    // The row exists, so a bare "could not create" would be a lie.
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("99") });
  });
});
```

- [ ] **Step 7: Run the route test to verify it fails**

Run: `npx vitest run "src/app/api/vehicle-inspections/[inspectionId]/work-order/route.test.js"`

Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 8: Write the route**

Create `src/app/api/vehicle-inspections/[inspectionId]/work-order/route.js`:

```js
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { ensureInspectionMaintenance, notifyMaintenanceTeam } from "@/lib/inspections/maintenance";

// Raise the repair ticket for a problem-queue row.
//
// This is the office-side half of the inspect -> maintenance bridge. Until it
// existed, source_inspection_id could only ever be written by the driver's own
// End Duty submission (raiseEndDutyWorkOrder in lib/inspections/maintenance.js),
// so a report whose best-effort raise failed was unresolvable from any UI — the
// queue could show it and never clear it.
//
// Authorization is maintenance:create, matching the /maintenance page that hosts
// this action. No new RBAC resource (see the note in lib/inspections/maintenance.js
// about recipients vs. authorization — that one is about notifications, and this
// is about an action, so it is not the same decision).
//
// Unlike the driver path this THROWS on failure instead of swallowing: a manager
// who clicked a button is owed the truth, and the failure to swallow is the
// notification, not the work order.

export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "maintenance", "create");

    const { inspectionId: raw } = await params;
    const inspectionId = Number.parseInt(raw, 10);
    if (!Number.isInteger(inspectionId) || inspectionId <= 0) {
      return err("inspectionId must be a positive integer", 400);
    }

    // allowChecklistType is the flag that lets a failed Pre-Shift / Pre-Trip
    // through — it is what makes the earlier "only an End Duty report raises a
    // work order" boundary true of the automatic path and false of a person's
    // request. This route is the only caller that sets it.
    const result = await ensureInspectionMaintenance({ inspectionId, session, allowChecklistType: true });

    if (result.notFound) return err("Inspection not found", 404);
    if (result.notRequired) {
      // Unreachable while the flag above is passed — the module refuses a
      // checklist type only when it is false. Kept so a future refusal reason
      // cannot be reported to the user as success.
      return err("The work-order flow refused this inspection — this should not happen from the office queue", 500);
    }
    if (result.notReported) {
      return err("That inspection records no defect to raise", 400);
    }

    if (result.created) {
      // Derived from the record rather than assumed: this route raises work
      // orders for a failed checklist as well as for an End Duty report, and
      // the announcement must not call one the other.
      const source = result.inspection?.inspection_type === "Post-Shift"
        ? "end-of-shift report"
        : `failed ${result.inspection?.inspection_type ?? "checklist"} inspection`;
      try {
        await notifyMaintenanceTeam(result.workOrder, inspectionId, { source });
      } catch (error) {
        // The work order exists. Saying "could not create the work order" here
        // would be false, so name the real half. Note that a checklist raise
        // leaves the vehicle dispatchable, so this is not a grounding failure.
        return err(`Work order #${result.workOrder.maintenance_id} was created, but notifying the maintenance team failed`, 500);
      }
    }

    return ok({ workOrder: result.workOrder, created: result.created }, result.created ? 201 : 200);
  } catch (error) {
    return handleError(error);
  }
}
```

`ok` takes a status second argument (`src/lib/api/utils.js:278`), so the `201` / `200` above works as written.

- [ ] **Step 9: Run the route test to verify it passes**

Run: `npx vitest run "src/app/api/vehicle-inspections/[inspectionId]/work-order/route.test.js"`

Expected: PASS, 9 tests.

- [ ] **Step 10: Verify it against the live database by hand**

This is the step that catches what tests cannot: the real query against real columns. It cannot use the `/maintenance/problems` page — that page is Task 13 and does not exist yet — so drive the route directly with an authenticated request from the browser devtools console while signed in as admin:

```js
await fetch("/api/vehicle-inspections/problems?scope=count").then(r => r.json())
// pick an inspectionId from the rows, then:
await fetch("/api/vehicle-inspections/42/work-order", { method: "POST" }).then(async r => [r.status, await r.json()])
```

Expected: `201` with a work order, then a second call returning `200` with `created: false` and no second row. Confirm in the database:

```bash
node -e "import('./scripts/load-env.mjs').then(async () => { const { query } = await import('./src/lib/db.js'); const { rows } = await query('SELECT maintenance_id, vehicle_id, status, source_inspection_id FROM vehiclemaintenance WHERE source_inspection_id IS NOT NULL ORDER BY maintenance_id DESC LIMIT 5'); console.log(rows); process.exit(0); })"
```

Expected: the row you just raised, with `source_inspection_id` set. **If you raised it from a failed Pre-Shift, `status` must read `Scheduled`** — an `In Progress` here means the grounding branch leaked into the office path, and the vehicle is out of dispatch when it should not be. Check that against `/api/vehicles/available` before moving on.

- [ ] **Step 11: Run the full suite, because this task changed two shared modules**

Run: `npm run test:run`

Expected: green. This task is the only one in Part B that modifies code the driver path already depends on (`report.js` and `maintenance.js`), so a failure anywhere in the inspections or standby suites is this task's, not pre-existing. Investigate rather than assume otherwise.

- [ ] **Step 12: Commit**

```bash
git add src/lib/inspections/report.js src/lib/inspections/report.test.js src/lib/inspections/maintenance.js src/lib/inspections/maintenance.test.js "src/app/api/vehicle-inspections/[inspectionId]/work-order/route.js" "src/app/api/vehicle-inspections/[inspectionId]/work-order/route.test.js"
git commit -m "feat(inspections): let the office raise a work order, without grounding"
```

---

## Amendment 15 (Task 12) — `Scheduled` + today is still a grounding combination

**Authorised by the human on 2026-09-26**, choosing option 1 of four when this plan's own Step 10 check
failed. This amendment exists because Task 12 Step 10 says *"Check that against `/api/vehicles/available`
before moving on"* — and the check does not pass as written.

**The contradiction.** This plan states repeatedly that a checklist raise does not ground: *"status is the
grounding lever, not a label"*, the payload remark *"Filed for triage, not grounded — a failed checklist
does not remove a vehicle from dispatch"*, and Task 13 Step 2's mandated on-screen sentence. But
`src/app/api/vehicles/available/route.js:73-84` excludes a vehicle when:

```sql
vm.status IN ('In Progress', 'Pending Inspection')
OR (vm.status = 'Scheduled' AND vm.maintenance_date <= CURRENT_DATE)
```

Both builders set `maintenance_date: toCalendarDay(new Date())` — today — so `Scheduled` satisfies the
second arm and the vehicle IS hidden until tomorrow. The date is half of the predicate; it is not
decoration. The comment at `report.js:26-28` names only the two statuses and is silently wrong about the
`Scheduled` arm.

**This is pre-existing.** `buildInspectionMaintenancePayload` does the same, so a mild End Duty report has
always hidden its vehicle while claiming otherwise. Task 12 inherited it.

**The change.** `buildChecklistMaintenancePayload` now writes `maintenance_date` as **tomorrow** via a new
`nextCalendarDay()` helper in `report.js`, and its docblock records the predicate it is dodging. Nothing
else moves: still `Scheduled`, still `Normal`, still dated inside a normal scheduling window rather than
parked months out.

**`buildInspectionMaintenancePayload` is deliberately untouched** — it belongs to Part A, which is already
APPROVED, and its remaining lie is recorded for the final whole-branch review rather than fixed here.

**Test change.** Step 1's `files at zero cost with today's date` becomes *"files at zero cost, dated
tomorrow so a Scheduled row does not ground the vehicle"*, asserting `maintenance_date` equals tomorrow
**and** is strictly greater than today — the second half being the actual condition
`/api/vehicles/available` tests, so a future refactor that moves the date back fails here rather than in
production.

**Rejected alternative worth keeping:** changing the availability predicate itself. It is an
explicitly-commented safety invariant guarding dispatch, and it is not this feature's to widen.

---

### Task 13: The `/maintenance/problems` page, and the dashboard count

**Files:**
- Create: `src/app/(dashboard)/maintenance/problems/page.js`
- Modify: `src/services/vehicle.service.js` (add two client helpers beside `getVehicleMaintenance` at `:43-53`)
- Modify: `src/components/dashboard/dashboard-configs.js:13,19` (add `"vehicleProblems"` to `queries` for `admin` and `fleet_manager`)
- Modify: `src/components/dashboard/role-dashboard.jsx` (add the `useQuery` beside `:1065`, and one item in the `attention` array at `:589-595`)
- Test: `src/components/dashboard/dashboard-configs.test.js` (exists — extend it, do not add a second harness)

**Interfaces:**
- Consumes: `GET /api/vehicle-inspections/problems` and `?scope=count` (Task 11), `POST .../[inspectionId]/work-order` (Task 12).
- Produces: the route `/maintenance/problems`, and one new key in the dashboard's attention strip.

**The page already has its role gate.** `getRequiredRolesForPath` prefix-matches (`permissions.js:43-47` documents this for `/dispatch`), so `NAV_ROLES["/maintenance"]` — admin, super_admin, fleet_manager — already covers `/maintenance/problems`. Add `useRequireRole` on the page anyway, matching `src/app/(dashboard)/maintenance/page.js:35`.

**The strip's item must count `counts.reportedUntracked` only — not `failedUntracked`.** Both are now closable, so the reason is no longer "one of them can never be cleared". It is that a count is a claim somebody must answer for this row: the reported defect is unanswered by any person (the driver reported a fault and the automatic raise failed silently), while a failed Pre-Shift was already answered by the notification the office received when it happened. Counting failed inspections would demand a ticket for every weak aircon. `role-dashboard.jsx:596-601` treats any `value > 0` as `danger` and `"—"` as unknown, so a count that is usually positive for reasons nobody acts on is one the office learns to ignore — and then the strip fails at the row that does matter.

**The count has to be rendered twice, because the two roles see different dashboards.** This is the trap in this task and it is not obvious from the config file alone:

- **`admin`** has `layout: ["attention", ...]` (`dashboard-configs.js:14`), so the operational attention strip at `role-dashboard.jsx:589-601` renders for them. The new cell goes there.
- **`fleet_manager`** has `layout: ["readiness", "pair-coverage", "maintenance", "compliance"]` (`:20`) — **no `attention` section at all.** Adding only the strip item would fetch a count that fleet_manager never renders, and put the number in front of the role whose job the repairs actually are, never. Their surface is the maintenance section, whose Panel is "Maintenance pressure" at `:786`.
- **`super_admin`** has the system-console config (`:4-9`) with no operational layout, so they get no cell on either surface. They reach `/maintenance/problems` directly, which is fine — `can()` gives them a blanket bypass (`permissions.js:333`).

So Task 13 modifies **two** render sites, and one shared `useQuery` feeds both.

- [ ] **Step 1: Add the client helpers**

In `src/services/vehicle.service.js`, beside `getVehicleMaintenance` (`:43-53`):

```js
// The vehicle problem queue. `scope=count` is the dashboard strip's path: it
// must not pull a page of rows on every dashboard load.
export async function getVehicleProblems(filters = {}) {
  return apiFetch(`/api/vehicle-inspections/problems${buildQuery(filters)}`);
}

export async function getVehicleProblemCount() {
  return apiFetch("/api/vehicle-inspections/problems?scope=count");
}

export async function createInspectionWorkOrder(inspectionId) {
  return apiFetch(`/api/vehicle-inspections/${inspectionId}/work-order`, { method: "POST" });
}
```

Match the existing `buildQuery` and `apiFetch` usage in that file — read `:1-45` before editing.

- [ ] **Step 2: Write the page**

Create `src/app/(dashboard)/maintenance/problems/page.js`.

Build it from the parts the maintenance page already uses — `HeroHeader`, `Card`, `StatGrid`/`StatCard`, `Badge`, `StatusBadge`, `EmptyState`, `toast`, `useRequireRole`, and a `@tanstack/react-query` `useQuery` + `useMutation` with `queryClient.invalidateQueries`. Do not invent new UI primitives.

The page must render, for each row:

1. **Vehicle** — `plateNumber` and `vehicleName`, plus `inspectionType` and `formatDate(inspectionDate)`.
2. **The driver's own words.** This is the requirement, not decoration — the manager is being shown *what the driver said*, not a summarised verdict. Render `report.kind`:
   - `"checklist"`: one line per item — `label`, then `remarks` in full. The remarks are required by the server for every failed item (`checklists.js:94-96`), so an empty string here means the record predates that rule, and the row should say so rather than render blank.
   - `"free_text"`: the text as written, preserving it verbatim.
3. **`severityLabel`, not `severity`.** `null` renders as **"Not assessed"** — never an empty cell. `'None'` renders as the driver's own "None", which is a different statement (`standby.service.js:102-105`).
4. **The action, by bucket:**
   - `reported_untracked` and `failed_untracked` → the same primary "Raise work order" button calling `createInspectionWorkOrder(inspectionId)`, then invalidating both the queue and count queries. One button for both, because the action is identical; what differs is only whether the result is counted on the dashboard.
   - `tracked` → the ticket's `workOrderStatus` and a link to `/maintenance` (the register is filtered there; do not build a second detail view).

   Label the button's effect honestly on the failed rows: raising a ticket from a failed inspection files it as `Scheduled` and **does not** take the vehicle out of service. Say so next to the button, or the office will assume the click grounded it and skip telling dispatch.

Group the three buckets as sections with counts in their headings, in that order: **Reported defects with no work order**, **Failed inspections with no work order**, **With a repair ticket**. The first section is the one the dashboard counts and the only one that gets the danger treatment; the second is a working list, not an alarm — render it plainly, and do not let its heading carry the same red weight as the first.

- [ ] **Step 3: Run the app and look at it**

Run: `npm run dev`, then open `/maintenance/problems` as admin.

Expected: the page renders with real rows. Confirm by eye — (a) at least one row shows a driver's remarks verbatim; (b) no severity cell is blank; (c) a failed-inspection row offers the button and states that raising it will not ground the vehicle; (d) after clicking it, the row moves to the "With a repair ticket" section and the dashboard count does **not** change (that row was never counted). If there are no `Failed` or `Reported` rows in the live database, insert one inspection through the mobile flow rather than loosening the query.

- [ ] **Step 4: Add the count to the dashboard — both surfaces**

In `src/components/dashboard/dashboard-configs.js`, add `"vehicleProblems"` to the `queries` array for `admin` (`:13`) and `fleet_manager` (`:19`). The dashboard's `enabled()` is `config.queries.includes(name)` (`role-dashboard.jsx:1043`), so a name absent from the array is never fetched — and a name present in `queries` but absent from `layout` is fetched and never shown, which is the mistake this step avoids.

In `src/components/dashboard/role-dashboard.jsx`, add the query beside the others (`:1065`):

```js
const vehicleProblems = useQuery({
  queryKey: ["vehicle-problem-count"],
  queryFn: getVehicleProblemCount,
  enabled: enabled("vehicleProblems"),
});
```

Add it to the `queries` object literal (`:1074`) and import `getVehicleProblemCount` from `@/services/vehicle.service`. `Wrench` is already imported at `:27`.

**4a — admin, the attention strip.** Add one item to the `attention` array (`:589-595`), **before** the `.sort()` call, following that array's exact item shape:

```js
    {
      label: "Reported defects with no work order",
      value: vehicleProblems.isLoading || vehicleProblems.isError ? "—" : Number(vehicleProblems.data?.counts?.reportedUntracked || 0),
      sortValue: Number(vehicleProblems.data?.counts?.reportedUntracked || 0),
      href: "/maintenance/problems",
      icon: Wrench,
    },
```

The `"—"` on loading or error is not cosmetic: `:596-601` distinguishes an unknown count from a real zero, and defaulting an unresolved feed to `0` would report "all clear" on exactly the load where the answer is unknown.

**4b — fleet_manager, the maintenance section.** Add a `StatGrid` with one `StatCard` immediately before the "Maintenance pressure" Panel at `:786`, matching the idiom of the readiness grid at `:724-729`:

```jsx
      <StatGrid cols={4}>
        <StatCard icon={Wrench} label="Defects without a work order" value={vehicleProblems.isLoading || vehicleProblems.isError ? "—" : Number(vehicleProblems.data?.counts?.reportedUntracked || 0)} trend="Driver-reported problems with no repair ticket raised" tone="danger" />
      </StatGrid>
```

A `StatGrid cols={4}` holding a single card matches how the file already uses it (feeds that may render fewer cells), and `tone="danger"` is the same signal the strip gives admin — but only while the count is real. If `StatCard` turns out not to accept an href, do not add one: the maintenance section already carries a "Maintenance register" link at `:786`, and a second link to a different page from the same section is worse than none.

**4c — pin the two-surface decision with a test.** Append to `src/components/dashboard/dashboard-configs.test.js`, whose existing test already guards a similar invariant (that every role's layout is distinct):

```js
  it("ships the vehicle problem count to the two roles that render it", () => {
    expect(DASHBOARD_CONFIGS.admin.queries).toContain("vehicleProblems");
    expect(DASHBOARD_CONFIGS.fleet_manager.queries).toContain("vehicleProblems");
    // The reason the count is rendered in two places rather than one: admin has
    // the operational attention strip, fleet_manager does not. If this ever
    // becomes false, the fleet_manager StatCard is redundant — and if it becomes
    // true without a second look, the strip item alone was enough.
    expect(DASHBOARD_CONFIGS.admin.layout).toContain("attention");
    expect(DASHBOARD_CONFIGS.fleet_manager.layout).not.toContain("attention");
    // Neither role is missing the query its own layout depends on.
    for (const role of ["admin", "fleet_manager"]) {
      expect(DASHBOARD_CONFIGS[role].queries).toContain("maintenance");
    }
  });
```

- [ ] **Step 5: Verify both surfaces end-to-end**

Run `npm run dev`. As **admin**, open `/dashboard`: the new cell appears in the operational attention strip, sorted among the others by `sortValue`. As **fleet_manager**, open `/dashboard`: the cell does **not** appear in any strip (they have none) — it appears as the "Defects without a work order" card in the maintenance section, above "Maintenance pressure".

Then check the distinction the count is built on, because a count that quietly includes the wrong bucket still renders:

1. Raise a work order for a **driver-reported** row (`reported_untracked`) and reload — both the strip and the card must fall by one, and reach `0` once every such row is raised.
2. Raise a work order for a **failed inspection** row (`failed_untracked`) and reload — **neither number may move.** That row was never counted. If it moves, the query is counting the wrong predicate.
3. Clear every counted row and confirm admin's strip drops its danger treatment for that cell (`attentionIssues` at `:599`).

- [ ] **Step 6: Confirm the unknown state and the absent state, rather than assuming either**

As **dispatcher** — who is in neither `queries` array — open `/dashboard`: no cell on any surface, and the network tab shows no request to `/api/vehicle-inspections/problems`. Then make the feed fail rather than merely be disabled: point `apiFetch` at a bad path for one load (or block the request in the browser's network panel) and reload as admin. Expected: `—` and no danger treatment, not `0`. A `0` in either case is the bug this step exists to catch — it reports "all clear" on a load where the answer is unknown.

- [ ] **Step 7: Run lint and the full suite**

Run: `npm run lint` then `npm run test:run`

Expected: both clean. `npm test` includes the schema-contract gate, which validates that every table and view is classified — this task adds no table or view, so a failure there is pre-existing and should be reported, not absorbed.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/maintenance/problems/page.js" src/services/vehicle.service.js src/components/dashboard/dashboard-configs.js src/components/dashboard/role-dashboard.jsx
git commit -m "feat(dashboard): surface reported vehicle defects without a work order"
```

---

### Task 14: Record Part B in the vault

**Files:**
- Modify: `Capstone/02 - Features/Maintenance.md`
- Modify: `Capstone/07 - Development/Technical Debt.md`
- Modify: `Capstone/01 - System/System Overview.md` (changelog)
- Modify: `Capstone/07 - Development/Missed End Duty Report Design Note.md` (status)

`AGENTS.md` requires the relevant `Capstone/` notes to be updated after a behaviour, architecture, data or workflow change. This part changes all four.

- [ ] **Step 1: Document the queue in the Maintenance feature note**

Add a section to `Capstone/02 - Features/Maintenance.md` covering: the `/maintenance/problems` surface; the three buckets and what each one means; that resolution is the existence of a `vehiclemaintenance.source_inspection_id` link rather than a separate flag; that only an End Duty report raises a work order **automatically**, while the office can raise one by hand for any flagged inspection — and that a hand-raised one for a failed checklist files as `Scheduled`, so it never removes a vehicle from dispatch and the office keeps deciding grounding; and the new office-side raise action. Record the authorization choice explicitly — the queue is gated on `maintenance:read` / `maintenance:create`, reusing the existing resource rather than adding an `inspections` one, and note *why* that is not in conflict with the reasoning in `notifyMaintenanceTeam`.

Also record the residual that this part leaves standing, since it is now narrower than it was: a failed Pre-Shift / Pre-Trip still raises nothing on its own and still escalates to nobody automatically. What changed is that it is now visible in one place and closable by a person. Whether the automatic path should widen is the separate conversation `maintenance.js:53-55` defers, and it stays deferred.

- [ ] **Step 2: Record the two findings as technical debt**

Add rows to `Capstone/07 - Development/Technical Debt.md`:

1. **Failed Pre-Shift / Pre-Trip raise no work order.** Surfaced by this work, not introduced by it: `src/lib/inspections/maintenance.js:53-55` returns `notRequired` for anything that is not Post-Shift, on purpose. The consequences are real — the office is notified the moment a Pre-Shift fails (`inspections/route.js:194-207`) and then nothing tracks it, the vehicle is not grounded, and the problem queue shows the row with no action available. Cross-reference the existing residual already noted for the same decision.
2. **`FIELD_TO_COLUMN` in `src/app/api/vehicle-maintenance/route.js:22-41` cannot set `source_inspection_id`.** A work order created by hand from `/maintenance` can therefore never link back to the inspection that prompted it; only the driver's phone and the new `work-order` route can. Task 12 closes the practical gap for the queue, but the register's own create form still cannot express the link.

- [ ] **Step 3: Add the changelog entry**

Add one entry to `Capstone/01 - System/System Overview.md`, dated, in the existing style, matching the Part A entry written in Task 8 — the office worklist, the raise action, and the attention-strip count.

- [ ] **Step 4: Close out the design note**

Update the status line in `Capstone/07 - Development/Missed End Duty Report Design Note.md` to reflect that both halves are planned, and add the bucket table from the top of this part so the note and the plan cannot drift. Leave `status` as `planned` rather than `implemented` — nothing is implemented until the tasks run.

- [ ] **Step 5: Update `SYSTEM.md`**

The same mandatory rule as Task 8 Step 3 (`.agents/AGENTS.md` rule 3). Four places:

1. **§5.1 Migration timeline** — add a row for `127` (the queue's partial index). Match the existing row shape.
2. **§5.3 DB-enforced integrity** — the section lists partial indexes as prose ("`idx_trips_end_time` partial index for the 90-day maintenance window"). Add the new queue index beside them and say what predicate it serves, since an index whose purpose is not written down gets dropped by someone tidying later.
3. **§6 API Surface** — the heading itself reads `## 6. API Surface (`src/app/api/` — 162 route files)`. Tasks 11 and 12 each add one file, so **that number becomes 164**; update the heading, not just the body. Then add the two routes to the **"Vehicles, maintenance, fuel"** group, which is where `/api/vehicle-inspections/*` belongs next to `/api/vehicle-maintenance`. Note that the `work-order` route is the only office-side path that can set `source_inspection_id`.
4. **§7.3 Incident reporting & vehicle grounding** — this section owns vehicle grounding, and Part B makes a decision a future reader will look for here: **a raise from the queue never grounds.** Record that the checklist raise files as `Scheduled` so it stays out of the dispatch-eligibility query, and that grounding is still the office's call. Add the dated changelog entry at the end of the file in the existing style.

- [ ] **Step 6: Commit**

```bash
git add "Capstone/02 - Features/Maintenance.md" "Capstone/07 - Development/Technical Debt.md" "Capstone/01 - System/System Overview.md" "Capstone/07 - Development/Missed End Duty Report Design Note.md" SYSTEM.md
git commit -m "docs: record the vehicle problem queue and its two residuals"
```

---

### Part B acceptance criteria

1. `/maintenance/problems` shows every `status='Failed'` inspection and every Post-Shift `status='Reported'` row, cross-driver, newest first.
2. Each row shows the driver's own words — per-item remarks for a checklist failure, the verbatim text for an End Duty report.
3. No row renders a blank severity: `NULL` reads "Not assessed", `'None'` reads "None".
4. Any flagged row with no work order — a driver-reported defect or a failed inspection — can be raised from the page in one click, and the click is idempotent.
5. A raise from a failed Pre-Shift / Pre-Trip files as `Scheduled`, and the vehicle stays dispatchable: run the availability query against live before and after the click and confirm the vehicle is still in the result.
6. The count renders on both dashboards that have a surface for it — admin's attention strip and fleet_manager's maintenance section — and on no other role's. It counts driver-reported defects with no work order only, never failed inspections, and shows `—` rather than `0` while its feed is unresolved.
7. The queue is not reachable by a role outside `NAV_ROLES["/maintenance"]`, and the API refuses one independently of the page.
8. Nothing in `src/lib/auth/permissions.js` changed.
9. Nothing a driver does raises a work order for a Pre-Shift or Pre-Trip: `ensureInspectionMaintenance` called without `allowChecklistType` still returns `notRequired`, and the pre-existing test at `maintenance.test.js:91-95` passes **unmodified** — if it needed editing, the default was not preserved.
10. The notification raised for a checklist failure does not claim a driver filed an end-of-shift report, and the End Duty notification still does.

---

## Part C — the reminder push that survives a killed app

**Goal:** when a driver's shift has ended and the report is still owed, tell them **on the phone's lock screen**, with the app closed, so the report gets filed the same day and Part A's 04:00 sweep never has to run.

### What already ships, and what does not

Almost all of it. Stating this precisely matters, because the obvious reading of "push that works with the app killed" is that it is new infrastructure, and it is not:

- **OS delivery with the app killed already works.** `sendPush` (`src/services/push.service.js:86`) reads the target employees' active tokens and POSTs to Expo Push Service, which delivers through FCM/APNs to the OS. The vault records it verified end-to-end on 2026-08-19, including the fix (`175075b`) that a missing Android channel made remote pushes arrive "delivered" and vanish.
- **Token registration already works.** `mobile/lib/notifications/push.js` mints the Expo token via `getExpoPushTokenAsync`; `POST /api/device-tokens` stores it; `device_tokens` (migration 058) keys it on `employee_id` with an `active` flag, and `sendPush` deactivates tokens Expo reports as `DeviceNotRegistered`.
- **The enqueue path for a producer exists.** `push_outbox` (migration 059) plus `flushOutbox` is the documented pattern for notifications created outside the API routes.
- **Time-driven producers exist.** `syncStartWindowNotifications` (`src/services/start-window-notifications.service.js`) is the precedent: a pure threshold module, a service that check-then-inserts under an advisory lock, preference honouring, an isolated `/api/cron/sync` step, and observability counters.
- **The copy module exists**, with tone rules that are enforced by tests.

**What does not exist is a trigger that fires.** That is the whole of the risk here, and it is not a code risk.

### The timing ladder, and why it is two stages

| Stage | Fires when | Type → channel | Copy |
|---|---|---|---|
| `reminder` | shift end + **30 min**, still checked in, no out-time | `Warning` → quiet `heads-up`, **no sound** | "Your shift ended at 5:00 PM and today's report is still open" |
| `overdue` | shift end + **2 hours**, still open | `Alert` → loud `default`, sound | "still not filed … the duty is closed automatically in the morning with no report on it" |

Two stages rather than one, mirroring the start-window ladder (`earliest_start` quiet, `recommended_departure` and `latest_start` loud). The reason is the same one that makes the first stage quiet: a driver's shift ending is not an emergency, and a phone that shouts at 5:30 PM while they are driving home is a phone they silence — which costs the loud stage its only reason to exist. By two hours past, the report is genuinely late and the next thing due to touch the row is the 04:00 sweep, so saying so is information rather than nagging.

**Catch-up is structural, not a walk.** `crossedEndDutyThreshold` returns `"overdue"` directly when both are crossed, so a scan that slept through the 30-minute mark goes straight to the loud stage and never sends the quiet one late. That is the vault's catch-up rule, achieved by ordering two comparisons instead of iterating a ladder.

**The 30-minute grace is not the same 30 minutes as the mobile nudge.** `mobile/lib/end-duty.js` opens the End Duty window 30 minutes *before* the shift ends, so a driver can finish on time. This grace starts *after* the shift ends, so a driver who is still working — or still driving back — is not told they have forgotten something they have not. Two 30s, two different questions; the plan keeps them in named constants for exactly that reason.

### The dedupe trap — the one that would make this quietly wrong

Titles are stable event names and the title **is** the dedupe key (`copy.js` rule; `sla.js`/`maintenance.js` key on it). So per-day uniqueness cannot come from the title. It must come from `reference_id`.

**`reference_id` is therefore the duty date as an integer — `YYYYMMDD`, not a constant and not the driver id.** A constant here produces a producer that notifies a driver exactly once, ever, and then silently suppresses every later day: the first forgotten shift works, the second does not, and nothing errors. This is the highest-value line in Part C and it is pinned by two tests (Task 16).

### The trigger is the real decision

`/api/cron/sync` is the precedented home for this. It also has a header comment (`:26-30`) saying it **does nothing by itself** — an external scheduler must hit it with `CRON_SECRET`. The vault records the consequence: as of 2026-09-09 **no scheduler is configured**, and `cron_sync_last_ok` has been stale since 2026-09-06. So the start-window notifications are, today, also correct and silent. Part C does not introduce this gap; it inherits one that is already documented and unfinished.

`pg_cron` — which genuinely runs here (migration 099 schedules an incident SLA every minute) — **cannot** close it: Expo delivery is an HTTP call, and `pg_net` is not installed (no `CREATE EXTENSION pg_net` exists in any migration or in `schema.sql`).

So Task 17 ships the step *and* the caller. The recommendation is a scheduled GitHub Actions workflow in the repo: free, reviewable, in version control, and it fixes the same gap for the start-window producer at the same time. Its honest limits are stated in the task rather than discovered later: GitHub's `schedule` is queued rather than punctual (minutes late under load), it only runs on the default branch, and it is disabled after 60 days without repository activity. That is acceptable for a capstone and is not what a production deployment should use.

### Task 15: The copy and the event key

**Files:**
- Modify: `src/lib/notifications/copy.js` (append two driver-facing entries)
- Modify: `src/lib/constants.js:215` (`NOTIFICATION_EVENTS` — one new key)
- Test: `src/lib/notifications/copy.test.js` (extend — 119 cases already exist)

**Interfaces:**
- Produces: `endDutyReminder({ shiftEnd })` and `endDutyStillNotReported({ shiftEnd })`, each → `{ title, message, pushBody }`. Consumed by Task 16.
- Produces: `NOTIFICATION_EVENTS.end_duty_reminder` → `{ label, defaults: { in_app: true, email: false, push: true } }`. Consumed by Task 16 (`channelEnabled`) and read by the preferences page automatically, which renders one row per key — so the toggle appears with no UI work.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/notifications/copy.test.js`:

```js
describe("end duty reminders", () => {
  const SHIFT_END = "17:00:00";

  it("keeps both titles stable — no date, number, or name to drift the dedupe key", () => {
    for (const copy of [endDutyReminder({ shiftEnd: SHIFT_END }), endDutyStillNotReported({ shiftEnd: SHIFT_END })]) {
      expect(copy.title).not.toMatch(/\d/);
      expect(copy.title).not.toMatch(/2026|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
    }
  });

  it("gives the two stages different titles, so one does not dedupe away the other", () => {
    const a = endDutyReminder({ shiftEnd: SHIFT_END }).title;
    const b = endDutyStillNotReported({ shiftEnd: SHIFT_END }).title;
    expect(a).not.toBe(b);
  });

  it("renders the shift end in Asia/Manila, never the server's zone", () => {
    // 17:00 Manila on an arbitrary UTC day. A pod running in UTC must still
    // say 5:00 PM.
    expect(endDutyReminder({ shiftEnd: "17:00:00" }).message).toContain("5:00 PM");
  });

  it("falls back rather than emitting a dangling preposition when the shift end is unusable", () => {
    const copy = endDutyReminder({ shiftEnd: null });
    expect(copy.message).not.toMatch(/at\s*\./);
    expect(copy.message).toContain("the scheduled time");
  });

  it("keeps pushBody to one short sentence", () => {
    for (const copy of [endDutyReminder({ shiftEnd: SHIFT_END }), endDutyStillNotReported({ shiftEnd: SHIFT_END })]) {
      expect(copy.pushBody.length).toBeLessThanOrEqual(120);
      expect(copy.pushBody.match(/[.!?](\s|$)/g) || []).toHaveLength(1);
    }
  });

  it("never puts an ISO date or an ID in driver copy", () => {
    for (const copy of [endDutyReminder({ shiftEnd: SHIFT_END }), endDutyStillNotReported({ shiftEnd: SHIFT_END })]) {
      expect(copy.message).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(copy.message).not.toMatch(/#\d/);
    }
  });

  it("tells the overdue driver what happens next, without promising a deadline it does not control", () => {
    expect(endDutyStillNotReported({ shiftEnd: SHIFT_END }).message).toMatch(/closed automatically in the morning/);
  });
});
```

Add `endDutyReminder, endDutyStillNotReported` to that file's existing import from `"./copy"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/notifications/copy.test.js`

Expected: FAIL — `endDutyReminder is not a function`.

- [ ] **Step 3: Implement the two copy entries**

Append to `src/lib/notifications/copy.js`:

```js
// ---- End Duty reminders (time-driven; end-duty-reminder.service.js) ---------
//
// The only driver copy whose subject is the driver's own unfinished paperwork.
// Everything else here tells a driver about an event that happened to them.

/**
 * Stage 1 — the shift has ended and the report is still owed.
 *
 * Naming the out-time is the one place the tone rules allow a time in driver
 * copy, and it is the point: "your shift ended" is only checkable if the driver
 * can read it against the shift they actually worked. manilaTime() renders it
 * in the fleet's operating zone, so the sentence reads the same regardless of
 * where the API pod runs, and it already falls back to "the scheduled time"
 * rather than degrading into "at .".
 */
export function endDutyReminder({ shiftEnd }) {
  return {
    title: "End Duty Reminder",
    message:
      `Your shift ended at ${manilaTime(shiftEnd)} and today's report is still open. ` +
      `End duty in the app to file it — you can still report late.`,
    pushBody: "Your shift has ended. End duty and file your report.",
  };
}

/**
 * Stage 2 — the report is hours late and the automatic close is the next thing
 * due to touch the row. Saying so is not a threat; it is the fact the driver
 * needs to decide whether to bother tonight.
 */
export function endDutyStillNotReported({ shiftEnd }) {
  return {
    title: "End Duty Still Not Reported",
    message:
      `Today's report has still not been filed since your shift ended at ${manilaTime(shiftEnd)}. ` +
      `End duty in the app tonight, or the duty is closed automatically in the morning with no report on it.`,
    pushBody: "Today's report is still missing. End duty in the app.",
  };
}
```

- [ ] **Step 4: Add the event key**

In `src/lib/constants.js`, inside `NOTIFICATION_EVENTS` (append after the `trip_start_overdue` entry, keeping the file's ordering convention):

```js
  // Time-driven End Duty reminder producer (end-duty-reminder.service, driven by
  // /api/cron/sync). Both stages share ONE key on purpose: the mobile Push
  // toggle is a master switch over the channel, so a driver cannot silence
  // stage 2 while keeping stage 1. The asymmetry is the safe direction — stage 2
  // only fires once the report is hours late and the automatic close is next.
  end_duty_reminder: {
    label: "End Duty Reminder",
    defaults: { in_app: true, email: false, push: true },
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/notifications/copy.test.js src/lib/constants.test.js`

Expected: PASS — 7 new copy tests, and the constants suite green (it asserts every key has a `label` and a complete `defaults` object).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/copy.js src/lib/notifications/copy.test.js src/lib/constants.js
git commit -m "feat(notifications): add the two-stage End Duty reminder copy

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 16: The threshold module and the producer service

**Files:**
- Create: `src/lib/scheduling/end-duty-thresholds.js` (pure — no DB, no clock)
- Test: `src/lib/scheduling/end-duty-thresholds.test.js`
- Create: `src/services/end-duty-reminder.service.js`
- Test: `src/services/end-duty-reminder.service.test.js`

**Interfaces:**
- Consumes: `endDutyReminder` / `endDutyStillNotReported` and `NOTIFICATION_EVENTS.end_duty_reminder` from Task 15.
- Consumes: `query`, `withTransaction` from `@/lib/db`; `loadPreferenceRows`, `channelEnabled` from `@/lib/notifications/preferences`; `flushOutbox`, `CHANNEL` from `@/services/push.service`; `loadDriverScheduleContext` from `@/services/driver-schedule.service`; `driverDayEligibility` from `@/lib/scheduling/day-eligibility`.
- Produces: `crossedEndDutyThreshold({ dutyDate, shiftEnd, now })` → `"reminder" | "overdue" | null`
- Produces: `minutesPastShiftEnd({ dutyDate, shiftEnd, now })` → `number | null`
- Produces: `dutyDayKey(dutyDate)` → `number` (`YYYYMMDD`)
- Produces: `syncEndDutyReminders({ now })` → `Promise<{ created, pushes_attempted, scanned, skipped, errors }>`. Consumed by Task 17.

**Do not re-derive the shift end.** `loadDriverScheduleContext` + `driverDayEligibility` is the same pair `GET /api/mobile/driver/duty` answers from, and `mobile/lib/end-duty.js:9-13` explains why that matters: `setDuty` enforces the window server-side, so a second computation of the same out-time is a second answer that can drift from the gate. Read the roster through the existing helper.

**Confirm three symbols before writing Step 7.** They are named here from the vault notes and the producer precedent, not from the source, so check each rather than discovering a mismatch at runtime:

```bash
# 1. The roster helper's real return shape. The plan destructures { blocked, duty }
#    and reads duty.end. Confirm the field names, and whether `blocked` is a
#    boolean or a reason object.
grep -n -A 25 "export function driverDayEligibility" src/lib/scheduling/day-eligibility.js

# 2. The channel ids. The plan uses CHANNEL.HEADS_UP.id for the quiet stage and
#    CHANNEL.PUSH.id for the loud one, and the vault records their ids as
#    "heads-up" and "default". Confirm both names exist and the ids match —
#    a wrong id silently routes a loud reminder to the quiet channel.
grep -n -B 2 -A 30 "export const CHANNEL" src/services/push.service.js

# 3. Whether notifications.type accepts 'Warning'. The plan writes 'Warning' for
#    stage 1 and 'Alert' for stage 2. If a CHECK constraint allows only a smaller
#    set, pick the nearest legal quiet value rather than dropping the type.
grep -n "notifications_type_check\|CHECK (type" supabase/migrations/*.sql schema.sql
```

Adjust the three call sites to whatever those return. Everything else in the task follows from the interfaces above.

- [ ] **Step 1: Write the failing threshold tests**

Create `src/lib/scheduling/end-duty-thresholds.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  crossedEndDutyThreshold,
  minutesPastShiftEnd,
  dutyDayKey,
  END_DUTY_GRACE_MINUTES,
  END_DUTY_OVERDUE_MINUTES,
} from "./end-duty-thresholds";

/** A Manila instant, written as UTC so the test does not depend on the runner's zone. */
const manila = (day, hhmm) => new Date(`${day}T${hhmm}:00+08:00`);

describe("minutesPastShiftEnd", () => {
  it("measures from the duty's own shift end, not from midnight", () => {
    // Shift ended 17:00 on the 24th; it is now 18:30 on the 24th.
    expect(minutesPastShiftEnd({
      dutyDate: "2026-09-24",
      shiftEnd: "17:00:00",
      now: manila("2026-09-24", "18:30"),
    })).toBe(90);
  });

  it("goes negative before the shift ends — the caller's null comes from the threshold, not from here", () => {
    expect(minutesPastShiftEnd({
      dutyDate: "2026-09-24",
      shiftEnd: "17:00:00",
      now: manila("2026-09-24", "16:00"),
    })).toBe(-60);
  });

  it("carries across midnight, so a late shift is still measured from its own day", () => {
    // Shift ended 23:00 on the 24th; it is 00:15 on the 25th. This is the case a
    // minutes-since-midnight implementation gets wrong, and the reason the duty
    // date is an argument rather than inferred from `now`.
    expect(minutesPastShiftEnd({
      dutyDate: "2026-09-24",
      shiftEnd: "23:00:00",
      now: manila("2026-09-25", "00:15"),
    })).toBe(75);
  });

  it("returns null for an unusable roster time rather than inventing a deadline", () => {
    for (const shiftEnd of [null, "", "not-a-time", "25:00", "17:70"]) {
      expect(minutesPastShiftEnd({
        dutyDate: "2026-09-24", shiftEnd, now: manila("2026-09-24", "18:00"),
      })).toBeNull();
    }
  });

  it("returns null for an unusable duty date", () => {
    expect(minutesPastShiftEnd({
      dutyDate: "nonsense", shiftEnd: "17:00:00", now: manila("2026-09-24", "18:00"),
    })).toBeNull();
  });
});

describe("crossedEndDutyThreshold", () => {
  const args = (hhmm) => ({
    dutyDate: "2026-09-24", shiftEnd: "17:00:00", now: manila("2026-09-24", hhmm),
  });

  it("says nothing while the shift is still running — including exactly at the end", () => {
    expect(crossedEndDutyThreshold(args("16:59"))).toBeNull();
    expect(crossedEndDutyThreshold(args("17:00"))).toBeNull();
  });

  it("stays quiet through the grace period — a driver still driving home has not forgotten", () => {
    expect(crossedEndDutyThreshold(args("17:29"))).toBeNull();
  });

  it("fires the quiet stage exactly at the grace boundary", () => {
    expect(END_DUTY_GRACE_MINUTES).toBe(30);
    expect(crossedEndDutyThreshold(args("17:30"))).toBe("reminder");
  });

  it("fires the loud stage exactly at the overdue boundary", () => {
    expect(END_DUTY_OVERDUE_MINUTES).toBe(120);
    expect(crossedEndDutyThreshold(args("19:00"))).toBe("overdue");
  });

  it("jumps straight to overdue — a scan that slept through the grace mark never sends it late", () => {
    expect(crossedEndDutyThreshold(args("21:45"))).toBe("overdue");
  });

  it("treats the two boundaries as distinct events, not as one already-passed state", () => {
    const quiet = crossedEndDutyThreshold(args("18:00"));
    const loud = crossedEndDutyThreshold(args("19:30"));
    expect(quiet).toBe("reminder");
    expect(loud).toBe("overdue");
  });

  it("fails quiet on an unusable roster time", () => {
    expect(crossedEndDutyThreshold({
      dutyDate: "2026-09-24", shiftEnd: null, now: manila("2026-09-24", "20:00"),
    })).toBeNull();
  });
});

describe("dutyDayKey", () => {
  it("is the duty date as YYYYMMDD — the per-day half of the dedupe key", () => {
    expect(dutyDayKey("2026-09-24")).toBe(20260924);
  });

  it("gives consecutive days different keys", () => {
    // The whole reason reference_id is not a constant: a stable reference_id
    // would dedupe every day after the first into silence.
    expect(dutyDayKey("2026-09-24")).not.toBe(dutyDayKey("2026-09-25"));
  });

  it("reads a Date in Manila terms, not the runner's zone", () => {
    expect(dutyDayKey(new Date("2026-09-24T16:00:00Z"))).toBe(20260925); // 00:00 on the 25th in Manila
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/scheduling/end-duty-thresholds.test.js`

Expected: FAIL — `Failed to resolve import "./end-duty-thresholds"`.

- [ ] **Step 3: Implement the threshold module**

Create `src/lib/scheduling/end-duty-thresholds.js`:

```js
// When a driver owes an End Duty report and when to say so — pure, so the
// boundaries are testable without a database or a clock.
//
// This is the server half of a pair that mobile/lib/end-duty.js starts. That
// module answers "may the driver end duty yet?" and opens its window 30 minutes
// BEFORE the shift ends. This one answers a different question — "when do we
// stop waiting quietly and tell them?" — and its grace starts AFTER the shift
// ends. The two 30s are different numbers that happen to be equal; they are
// named constants here so that stays visible.
//
// Same clock discipline as mobile/lib/end-duty.js: an unusable roster time is
// null, not a guess. With no shift end there is no basis for telling a driver
// they are late, so this fails quiet rather than inventing a deadline.

const MINUTE_MS = 60_000;

// Asia/Manila has no DST — a fixed offset, not a zone. Pinned as a constant so
// the arithmetic below is exact rather than dependent on the runner's ICU data.
const MANILA_OFFSET = "+08:00";

/** After the shift ends, wait this long before the first reminder. */
export const END_DUTY_GRACE_MINUTES = 30;

/** After the shift ends, by this point the report is genuinely late. */
export const END_DUTY_OVERDUE_MINUTES = 120;

/** "HH:MM" / "HH:MM:SS" → minutes since midnight; null when it is not a clock time. */
function clockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** "YYYY-MM-DD" for a `date` column value or a Date, in Manila terms. */
function manilaDateString(value) {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(value);
  }
  return String(value ?? "").slice(0, 10);
}

/**
 * Minutes elapsed since the duty's own shift end.
 *
 * Takes the duty date rather than inferring it from `now`: a shift ending at
 * 23:00 is measured from its own calendar day, and inferring the day from the
 * current time would report a driver 90 minutes past a shift that ended
 * yesterday evening as 23 hours * before* it.
 *
 * @returns {number|null} null when the roster time or the duty date is unusable.
 */
export function minutesPastShiftEnd({ dutyDate, shiftEnd, now = new Date() } = {}) {
  const end = clockMinutes(shiftEnd);
  if (end == null) return null;

  const day = manilaDateString(dutyDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const hh = String(Math.floor(end / 60)).padStart(2, "0");
  const mm = String(end % 60).padStart(2, "0");
  const endAt = new Date(`${day}T${hh}:${mm}:00${MANILA_OFFSET}`);
  if (Number.isNaN(endAt.getTime())) return null;

  return Math.floor((now.getTime() - endAt.getTime()) / MINUTE_MS);
}

/**
 * Which reminder stage this duty has reached, if any.
 *
 * Catch-up is structural rather than a ladder walk: `overdue` is tested first
 * and returned on its own, so a scan that slept through the grace boundary
 * jumps straight to the loud stage and never sends the quiet one late. Same
 * rule as crossedStartWindowThreshold, by ordering rather than iteration.
 *
 * @returns {"reminder"|"overdue"|null}
 */
export function crossedEndDutyThreshold({ dutyDate, shiftEnd, now = new Date() } = {}) {
  const elapsed = minutesPastShiftEnd({ dutyDate, shiftEnd, now });
  if (elapsed == null) return null;
  if (elapsed >= END_DUTY_OVERDUE_MINUTES) return "overdue";
  if (elapsed >= END_DUTY_GRACE_MINUTES) return "reminder";
  return null;
}

/**
 * The per-day half of the reminder's dedupe key: the duty date as YYYYMMDD.
 *
 * This exists because titles are stable event names and the title IS the dedupe
 * key (copy.js rule), so nothing varying may enter the title. Per-day
 * uniqueness therefore has to live in `reference_id`. A constant there would
 * notify a driver once ever and silently suppress every later day.
 */
export function dutyDayKey(dutyDate) {
  const day = manilaDateString(dutyDate);
  const digits = day.replace(/-/g, "");
  const value = Number(digits);
  return Number.isInteger(value) && digits.length === 8 ? value : null;
}
```

- [ ] **Step 4: Run the threshold tests to verify they pass**

Run: `npx vitest run src/lib/scheduling/end-duty-thresholds.test.js`

Expected: PASS — 15 tests.

- [ ] **Step 5: Write the failing service tests**

Create `src/services/end-duty-reminder.service.test.js`. Follow the mocking idiom in `src/services/start-window-notifications.service.test.js` — `vi.mock` for `@/lib/db`, `@/services/push.service`, `@/lib/notifications/preferences` and `@/services/driver-schedule.service`, and a `withTransaction` stub whose `tx.query` returns canned rows by SQL substring.

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/services/push.service", () => ({
  flushOutbox: vi.fn().mockResolvedValue([]),
  CHANNEL: { PUSH: { id: "default" }, HEADS_UP: { id: "heads-up" } },
}));
vi.mock("@/lib/notifications/preferences", () => ({
  loadPreferenceRows: vi.fn().mockResolvedValue([]),
  channelEnabled: vi.fn().mockReturnValue(true),
}));
vi.mock("@/services/driver-schedule.service", () => ({ loadDriverScheduleContext: vi.fn() }));

import { query, withTransaction } from "@/lib/db";
import { flushOutbox } from "@/services/push.service";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";
import { syncEndDutyReminders } from "./end-duty-reminder.service";

/** A Manila instant as UTC, so the suite does not depend on the runner's zone. */
const manila = (day, hhmm) => new Date(`${day}T${hhmm}:00+08:00`);

/** One open attendance row, joined to the driver's employee id. */
const openRow = (over = {}) => ({
  attendance_id: 501, driver_id: 7, employee_id: 21,
  date: "2026-09-24", time_in: "2026-09-24T08:05:00+08:00", time_out: null,
  ...over,
});

/** A schedule context whose named drivers all work a 08:00–17:00 shift. */
const scheduleCtx = (shiftEnd = "17:00:00", driverIds = [7]) => ({
  schedules: new Map(driverIds.map((driverId) => [driverId, new Map([[4, {
    day_of_week: 4, shift_start: "08:00:00", shift_end: shiftEnd, is_rest_day: false,
  }]])])),
  leave: new Map(),
});

/**
 * Wire the transaction stub: every tx.query resolves rows by SQL substring, and
 * the dedupe lookup ("FROM notifications") answers `existing` so a test can
 * decide whether this is a first notification or a repeat.
 */
function stubTx({ existing = false, inserted = [] } = {}) {
  withTransaction.mockImplementation(async (fn) => fn({
    query: vi.fn(async (sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM notifications")) return { rows: existing ? [{ notification_id: 1 }] : [] };
      if (sql.includes("INSERT INTO")) return { rows: [{ notification_id: 900 }] };
      return { rows: [] };
    }),
  }));
  return inserted;
}

describe("syncEndDutyReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [openRow()] });
    loadDriverScheduleContext.mockResolvedValue(scheduleCtx());
  });

  it("stays silent while the shift is still running", async () => {
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "16:45") });
    expect(result).toMatchObject({ created: 0, skipped: 1 });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("stays silent through the grace period", async () => {
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:15") });
    expect(result.created).toBe(0);
  });

  it("notifies the quiet stage once the grace has passed", async () => {
    stubTx();
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ created: 2, pushes_attempted: 1, scanned: 1 });
    expect(flushOutbox).toHaveBeenCalledWith({ employeeIds: [21] });
  });

  it("uses the quiet heads-up channel for stage 1 and the loud one for stage 2", async () => {
    const seen = [];
    withTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn(async (sql, params) => {
        if (sql.includes("INSERT INTO push_outbox")) seen.push(params[3]);
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM notifications")) return { rows: [] };
        return { rows: [] };
      }),
    }));

    await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    await syncEndDutyReminders({ now: manila("2026-09-24", "19:30") });

    expect(seen).toEqual(["heads-up", "default"]);
  });

  it("keys the reference on the duty day, so consecutive forgotten days both notify", async () => {
    const refs = [];
    withTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn(async (sql, params) => {
        if (sql.includes("INSERT INTO notifications")) refs.push(params[5]);
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM notifications")) return { rows: [] };
        return { rows: [] };
      }),
    }));

    query.mockResolvedValue({ rows: [openRow({ date: "2026-09-24" })] });
    await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    query.mockResolvedValue({ rows: [openRow({ date: "2026-09-25", attendance_id: 502 })] });
    await syncEndDutyReminders({ now: manila("2026-09-25", "17:45") });

    expect(refs).toEqual([20260924, 20260925]);
  });

  it("sends nothing when this stage was already delivered for this day", async () => {
    stubTx({ existing: true });
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result.created).toBe(0);
    expect(flushOutbox).not.toHaveBeenCalled();
  });

  it("selects only rows that are open — checked in with no out-time", async () => {
    stubTx();
    await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("time_in IS NOT NULL");
    expect(sql).toContain("time_out IS NULL");
  });

  it("skips a driver with no usable roster time instead of guessing a deadline", async () => {
    loadDriverScheduleContext.mockResolvedValue({ schedules: new Map(), leave: new Map() });
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ created: 0, skipped: 1, errors: 0 });
  });

  it("skips a rest day", async () => {
    loadDriverScheduleContext.mockResolvedValue({
      schedules: new Map([[7, new Map([[4, { day_of_week: 4, shift_start: "08:00:00", shift_end: "17:00:00", is_rest_day: true }]])]]),
      leave: new Map(),
    });
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result.created).toBe(0);
  });

  it("honours a disabled push preference — the in-app row still lands, the outbox row does not", async () => {
    const { channelEnabled } = await import("@/lib/notifications/preferences");
    channelEnabled.mockImplementation(({ channel }) => channel !== "push");
    stubTx();
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ created: 1, pushes_attempted: 0 });
  });

  it("honours both channels being off — nothing written at all", async () => {
    const { channelEnabled } = await import("@/lib/notifications/preferences");
    channelEnabled.mockReturnValue(false);
    stubTx();
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ created: 0, pushes_attempted: 0 });
  });

  it("never throws — a producer failure must not fail the cron run", async () => {
    query.mockRejectedValue(new Error("db down"));
    await expect(syncEndDutyReminders({ now: manila("2026-09-24", "17:45") }))
      .resolves.toMatchObject({ errors: 1 });
  });

  it("isolates one driver's failure from the rest of the scan", async () => {
    query.mockResolvedValue({ rows: [openRow(), openRow({ attendance_id: 502, driver_id: 8, employee_id: 22 })] });
    loadDriverScheduleContext.mockResolvedValue(scheduleCtx("17:00:00", [7, 8]));
    withTransaction
      .mockRejectedValueOnce(new Error("lock timeout"))
      .mockImplementationOnce(async (fn) => fn({
        query: vi.fn(async (sql) => {
          if (sql.includes("FROM notifications")) return { rows: [] };
          if (sql.includes("INSERT INTO")) return { rows: [{ notification_id: 901 }] };
          return { rows: [] };
        }),
      }));
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ scanned: 2, created: 2, errors: 1 });
  });
});
```

- [ ] **Step 6: Run the service tests to verify they fail**

Run: `npx vitest run src/services/end-duty-reminder.service.test.js`

Expected: FAIL — `Failed to resolve import "./end-duty-reminder.service"`.

- [ ] **Step 7: Implement the service**

Create `src/services/end-duty-reminder.service.js`:

```js
// Time-driven End Duty reminders — the first producer whose subject is a
// driver's OWN unfinished paperwork rather than an event that happened to them.
//
// Every other producer here notifies about something that occurred (a dispatch,
// a trip window, an incident, a sign-in). This one notifies about something
// that has NOT occurred yet, which is why it needs two rules the others do not:
//
//   - It must not fire while the driver can still legitimately be at work. The
//     mobile nudge window opens 30 minutes BEFORE the shift ends; this grace
//     starts AFTER it. A driver still driving home has not forgotten anything.
//   - Its dedupe key must roll over every day. Titles are stable event names
//     and the title IS the dedupe key (copy.js rule), so the per-day half lives
//     in reference_id = the duty date as YYYYMMDD. A constant there would notify
//     a driver once ever and silently swallow every later day — the failure mode
//     this module is most likely to grow, and the one two tests pin.
//
// Ladder (mirrors the start-window producer):
//   shift end + 30 min → "End Duty Reminder"           quiet heads-up, no sound
//   shift end + 2 h    → "End Duty Still Not Reported" loud default, sound
//   catch-up           → only the MOST ADVANCED crossed stage fires
//
// Dedupe: per (employee, title, reference_id) under a per-attendance advisory
// lock, then check-then-insert — the migration 029 convention, so two
// overlapping scans cannot double-notify.
//
// Preferences are honoured exactly as the start-window producer honours them: a
// disabled in_app suppresses the notifications row, a disabled push suppresses
// the outbox row.
//
// Best-effort per driver: one driver's failure never stops the scan, and the
// whole run never throws — a producer failure must not fail the cron sync.
//
// HONEST LIMIT: a driver with no active `device_tokens` row receives nothing.
// `flushOutbox` reports that as `error` rather than silence, and the sync
// counters below surface it, but nothing here can fix it — the app must have
// been signed in on a real device build at least once.

import { query, withTransaction } from "@/lib/db";
import { flushOutbox, CHANNEL } from "@/services/push.service";
import { loadPreferenceRows, channelEnabled } from "@/lib/notifications/preferences";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";
import { driverDayEligibility } from "@/lib/scheduling/day-eligibility";
import { crossedEndDutyThreshold, dutyDayKey } from "@/lib/scheduling/end-duty-thresholds";
import { endDutyReminder, endDutyStillNotReported } from "@/lib/notifications/copy";

export const END_DUTY_EVENT = "end_duty_reminder";
export const END_DUTY_REFERENCE_TYPE = "duty";

/** Stable titles ARE the dedupe key. Never interpolate anything into these. */
const STAGE = {
  reminder: {
    title: "End Duty Reminder",
    channelId: CHANNEL.HEADS_UP.id,
    build: endDutyReminder,
  },
  overdue: {
    title: "End Duty Still Not Reported",
    channelId: CHANNEL.PUSH.id,
    build: endDutyStillNotReported,
  },
};

/**
 * Open attendance rows — checked in, never checked out.
 *
 * Deliberately not scoped to today: a shift ending at 23:00 is still owed after
 * midnight, and Part A's 04:00 sweep is what ends that window by writing a
 * `time_out`. Until it does, the row is open and the driver still owes a report,
 * so the row's own date decides the threshold and this query does not guess.
 */
const OPEN_DUTIES_SQL = `
  SELECT a.attendance_id, a.driver_id, a.date, a.time_in, a.time_out,
         d.employee_id
    FROM driverattendance a
    JOIN drivers d ON d.driver_id = a.driver_id
   WHERE a.time_in IS NOT NULL
     AND a.time_out IS NULL
     AND d.employee_id IS NOT NULL
   ORDER BY a.date, a.driver_id
`;

async function alreadyNotified(tx, employeeId, title, referenceId) {
  const { rows } = await tx.query(
    `SELECT notification_id FROM notifications
      WHERE employee_id = $1 AND title = $2 AND reference_type = $3 AND reference_id = $4
      LIMIT 1`,
    [employeeId, title, END_DUTY_REFERENCE_TYPE, referenceId]
  );
  return rows.length > 0;
}

/**
 * Insert the reminder for one open duty, under its own advisory lock.
 *
 * @returns {Promise<{created:number, pushRecipients:number[]}>}
 */
async function notifyOne({ duty, stage, copy, preferenceRows }) {
  const referenceId = dutyDayKey(duty.date);
  if (referenceId == null) return { created: 0, pushRecipients: [] };

  const inApp = channelEnabled({
    preferenceRows, employeeId: duty.employee_id, eventKey: END_DUTY_EVENT, channel: "in_app",
  });
  const push = channelEnabled({
    preferenceRows, employeeId: duty.employee_id, eventKey: END_DUTY_EVENT, channel: "push",
  });
  if (!inApp && !push) return { created: 0, pushRecipients: [] };

  let created = 0;
  const pushRecipients = [];

  await withTransaction(async (tx) => {
    // Serialize per attendance row: a concurrent scan holding this lock has
    // already decided this run's stage for this duty (or is mid-insert); after
    // it commits, the dedupe re-check below sees its rows.
    await tx.query(
      `SELECT pg_advisory_xact_lock(hashtext('end_duty_reminder_' || $1))`,
      [duty.attendance_id]
    );

    if (await alreadyNotified(tx, duty.employee_id, copy.title, referenceId)) return;

    if (inApp) {
      await tx.query(
        `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [duty.employee_id, copy.title, copy.message, stage === "overdue" ? "Alert" : "Warning",
         END_DUTY_REFERENCE_TYPE, referenceId]
      );
      created += 1;
    }
    if (push) {
      await tx.query(
        `INSERT INTO push_outbox (employee_id, title, body, channel_id, reference_type, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [duty.employee_id, copy.title, copy.pushBody, STAGE[stage].channelId,
         END_DUTY_REFERENCE_TYPE, referenceId]
      );
      created += 1;
      pushRecipients.push(duty.employee_id);
    }
  });

  return { created, pushRecipients };
}

/**
 * Scan every open duty and remind the driver when its stage has been crossed.
 *
 * Best-effort per driver; never throws (a producer failure must not fail the
 * cron sync).
 *
 * @param {object} [opts]
 * @param {Date} [opts.now]  injectable clock (tests)
 * @returns {Promise<{created:number, pushes_attempted:number, scanned:number, skipped:number, errors:number}>}
 */
export async function syncEndDutyReminders({ now = new Date() } = {}) {
  const counters = { created: 0, pushes_attempted: 0, scanned: 0, skipped: 0, errors: 0 };

  try {
    const { rows: duties } = await query(OPEN_DUTIES_SQL);
    if (!duties.length) return counters;

    const preferenceRows = await loadPreferenceRows();
    const ctx = await loadDriverScheduleContext(duties.map((d) => d.driver_id));
    const pushRecipients = [];

    for (const duty of duties) {
      counters.scanned += 1;
      try {
        // The roster out-time, read through the same helper pair the duty
        // endpoint answers from — never re-derived here, or the reminder and
        // the setDuty gate would be two computations that can drift.
        const { blocked, duty: window } = driverDayEligibility({
          driverId: duty.driver_id,
          date: duty.date,
          ctx,
        });
        if (blocked || !window?.end) {
          counters.skipped += 1;
          continue;
        }

        const stage = crossedEndDutyThreshold({
          dutyDate: duty.date,
          shiftEnd: window.end,
          now,
        });
        if (!stage) {
          counters.skipped += 1;
          continue;
        }

        const copy = STAGE[stage].build({ shiftEnd: window.end });
        const { created, pushRecipients: targets } = await notifyOne({
          duty, stage, copy, preferenceRows,
        });
        counters.created += created;
        pushRecipients.push(...targets);
      } catch (e) {
        counters.errors += 1;
        console.warn(`end duty reminder failed for attendance ${duty.attendance_id}:`, e?.message || e);
      }
    }

    if (pushRecipients.length) {
      const unique = [...new Set(pushRecipients)];
      counters.pushes_attempted = unique.length;
      // Targeted flush, never global: the start-window producer established
      // this so a scan cannot accidentally deliver another producer's backlog.
      await flushOutbox({ employeeIds: unique });
    }
  } catch (e) {
    counters.errors += 1;
    console.warn("syncEndDutyReminders failed:", e?.message || e);
  }

  return counters;
}
```

- [ ] **Step 8: Run the service tests to verify they pass**

Run: `npx vitest run src/services/end-duty-reminder.service.test.js`

Expected: PASS — 13 tests.

- [ ] **Step 9: Run the nearby suites to prove nothing regressed**

Run: `npx vitest run src/services/ src/lib/scheduling/ src/lib/notifications/`

Expected: PASS. `end-duty-thresholds.test.js` and the two new suites are additive; nothing existing imports either new module.

- [ ] **Step 10: Commit**

```bash
git add src/lib/scheduling/end-duty-thresholds.js src/lib/scheduling/end-duty-thresholds.test.js src/services/end-duty-reminder.service.js src/services/end-duty-reminder.service.test.js
git commit -m "feat(notifications): add the two-stage End Duty reminder producer

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 17: The trigger — the cron step, and the scheduler that actually fires it

**Files:**
- Modify: `src/app/api/cron/sync/route.js` (one isolated best-effort step + counters)
- Test: `src/app/api/cron/sync/route.test.js` (extend — it exists and already tests step isolation)
- Create: `.github/workflows/cron-sync.yml`

**Interfaces:**
- Consumes: `syncEndDutyReminders` from Task 16.
- Produces: response fields `end_duty_reminders_created`, `end_duty_pushes_attempted`, `end_duty_skipped`.

**This task is not optional and the failure it prevents is silent.** `/api/cron/sync` runs nothing on its own (its header, `:26-30`), and the vault records that no scheduler is configured and `cron_sync_last_ok` has been stale since 2026-09-06. A producer wired there without a caller is correct code that never executes — the same class of mistake as Part B's worklist with no action. Step 5 ships the caller.

- [ ] **Step 1: Write the failing route tests**

Append to `src/app/api/cron/sync/route.test.js`, following that file's existing mocking idiom for the service modules:

```js
  it("reports the End Duty reminder counters", async () => {
    syncEndDutyReminders.mockResolvedValue({
      created: 4, pushes_attempted: 2, scanned: 6, skipped: 2, errors: 0,
    });
    const res = await POST(authorizedRequest());
    const body = await res.json();
    expect(body).toMatchObject({
      end_duty_reminders_created: 4,
      end_duty_pushes_attempted: 2,
      end_duty_skipped: 2,
    });
  });

  it("does not fail the sync when the reminder producer throws", async () => {
    syncEndDutyReminders.mockRejectedValue(new Error("producer exploded"));
    const res = await POST(authorizedRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Zeroed, not missing: the step failed, and an absent field would read as
    // "did not run" rather than "ran and failed".
    expect(body.end_duty_reminders_created).toBe(0);
  });
```

Add `syncEndDutyReminders: vi.fn()` to the file's existing `@/services/end-duty-reminder.service` mock (creating the mock if the file does not already mock that path).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/cron/sync/route.test.js`

Expected: FAIL — the two new assertions, because the route does not call the producer.

- [ ] **Step 3: Add the step**

In `src/app/api/cron/sync/route.js`, add the import:

```js
import { syncEndDutyReminders } from "@/services/end-duty-reminder.service";
```

Add to the destructured `Promise.all` array (after `assignedTripResult`), matching the isolated best-effort shape of the neighbours:

```js
    // Time-driven End Duty reminders. Isolated best-effort by the same rule as
    // the two steps above: reminding a driver about an unfinished report must
    // never fail — or be failed by — the status and compliance sync. The
    // service itself never throws; this guard is defense in depth.
    (async () => {
      try {
        return await syncEndDutyReminders();
      } catch {
        return { created: 0, pushes_attempted: 0, scanned: 0, skipped: 0, errors: 1 };
      }
    })(),
```

Add `endDutyResult` to the destructuring, then to the response object:

```js
    end_duty_reminders_created: endDutyResult.created,
    end_duty_pushes_attempted: endDutyResult.pushes_attempted,
    end_duty_skipped: endDutyResult.skipped,
```

And extend the `message` string with `, ${endDutyResult.created} end-duty reminders`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/cron/sync/route.test.js`

Expected: PASS, including the pre-existing step-isolation tests.

- [ ] **Step 5: Ship the caller**

**Without this step the feature never runs.** Create `.github/workflows/cron-sync.yml`:

```yaml
# Drives /api/cron/sync, which is not a scheduler and does nothing on its own.
#
# The route's own header records this as an outstanding deploy check, and the
# vault records that as of 2026-09-09 no scheduler was configured — so the
# time-driven producers (trip start-window, End Duty reminders) were correct and
# silent. This workflow is that caller.
#
# Honest limits, all accepted for a capstone and none acceptable in production:
#   - GitHub's schedule is queued, not punctual — under load a run can start
#     minutes late, and it can be skipped entirely on a busy minute.
#   - It only runs on the default branch.
#   - GitHub disables scheduled workflows after 60 days without repository
#     activity, so a quiet repo stops reminding anyone.
# A production deployment wants a real cron (platform cron, systemd timer, or a
# hosted scheduler) with the same secret and URL.
name: cron-sync

on:
  schedule:
    # The target cadence is ~once a minute; GitHub's floor is 5. The reminder's
    # boundaries are 30 minutes and 2 hours, so a 5-minute tick is well inside
    # the tolerance that matters here.
    - cron: "*/5 * * * *"
  workflow_dispatch: {}

concurrency:
  # A slow run must not overlap the next tick — the producers dedupe, but there
  # is no reason to make them prove it every five minutes.
  group: cron-sync
  cancel-in-progress: false

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Hit /api/cron/sync
        env:
          APP_BASE_URL: ${{ secrets.APP_BASE_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          if [ -z "$APP_BASE_URL" ] || [ -z "$CRON_SECRET" ]; then
            echo "APP_BASE_URL and CRON_SECRET repository secrets must both be set." >&2
            exit 1
          fi
          # GET is accepted by the route for schedulers that cannot set headers;
          # POST with the bearer is used here because it can.
          code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$APP_BASE_URL/api/cron/sync" \
            -H "Authorization: Bearer $CRON_SECRET")
          echo "HTTP $code"
          # 5xx and 401 fail the run so a broken deployment is visible in the
          # Actions tab rather than in a green check nobody reads.
          case "$code" in
            200) exit 0 ;;
            *) echo "cron sync responded $code" >&2; exit 1 ;;
          esac
```

Then set the two repository secrets (`APP_BASE_URL`, `CRON_SECRET`) and confirm a manual run: Actions → cron-sync → Run workflow → the run is green and the JSON body carries `end_duty_reminders_created`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/sync/route.js src/app/api/cron/sync/route.test.js .github/workflows/cron-sync.yml
git commit -m "feat(cron): run the End Duty reminder producer, and ship the scheduler that fires it

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 18: The deep link — tapping the reminder opens End Duty

**Files:**
- Modify: `mobile/lib/notifications/navigation.js` (one `case`)
- Test: `mobile/lib/notifications/navigation.test.js` (extend, if it exists — check first; if not, create it)
- Modify: `src/lib/notifications/target.js:27` (`DRIVER_ROUTES` gains `duty`)
- Test: `src/lib/notifications/target.test.js` (extend)

**Read the Expo v57 docs before touching this task.** `mobile/AGENTS.md` requires it: `https://docs.expo.dev/versions/v57.0.0/`. The change itself is one line, and the docs are required regardless — the notification-response listener that consumes it is Expo API surface.

**`reference_id` must stay non-null.** `target.js:42` returns `null` when the id is missing, and a null href means the tap silently only marks the row read — the driver taps "you forgot to report" and nothing opens. Task 16 always sets it to the `YYYYMMDD` key, so this holds, but a future edit that "simplifies" it to a constant must not set it to null.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/lib/notifications/navigation.test.js`:

```js
  it("sends an End Duty reminder to the End Duty screen, not the Home tab", () => {
    // The whole value of the reminder is that the report can be filed from the
    // tap. Landing on Home leaves the driver to find the card themselves — one
    // more step on the night they already forgot once.
    expect(mobileNotificationTarget({ reference_type: "duty", reference_id: 20260924 }))
      .toBe("/end-duty");
  });
```

Append to `src/lib/notifications/target.test.js`:

```js
  it("gives a driver a destination for a duty reminder", () => {
    expect(getNotificationHref({ reference_type: "duty", reference_id: 20260924 }, "driver"))
      .toBe("/driver");
  });

  it("leaves staff without a duty destination — the reminder is driver-only", () => {
    // A staff role has no duty of their own to end, so this must resolve to
    // null and the tap must fall through to marking read.
    expect(getNotificationHref({ reference_type: "duty", reference_id: 20260924 }, "admin"))
      .toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run mobile/lib/notifications/navigation.test.js src/lib/notifications/target.test.js`

Expected: FAIL — `undefined` / `null` where a route was expected.

- [ ] **Step 3: Add the two mappings**

In `mobile/lib/notifications/navigation.js`, add to the `switch`:

```js
    case "duty":
      // The driver's own unfinished report. Deep-links to the screen they file
      // it from, so the tap is the whole recovery — see end-duty-reminder.service.js.
      return "/end-duty";
```

In `src/lib/notifications/target.js`, add to `DRIVER_ROUTES`:

```js
  // End Duty reminders (end-duty-reminder.service.js). Web has no equivalent of
  // the mobile End Duty screen, so this lands on the driver area rather than a
  // page that would have to grow a second implementation of the same flow. Only
  // DRIVER_ROUTES carries it: a staff role has no duty to end, so STAFF_ROUTES
  // deliberately omits it and a staff tap resolves to null (mark-read).
  duty: () => "/driver",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run mobile/lib/notifications/navigation.test.js src/lib/notifications/target.test.js`

Expected: PASS — 1 new mobile test, 2 new server tests, and every pre-existing case in both files green.

- [ ] **Step 5: Verify the route exists and is reachable**

Run: `grep -rn "end-duty" mobile/app/`

Expected: `mobile/app/(app)/end-duty.js` exists and the Home card already pushes `/end-duty` (`mobile/app/(app)/(tabs)/index.js:460`). If the path in the new `case` does not match that push exactly, the deep link opens nothing — compare the two strings character by character rather than trusting this plan.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/notifications/navigation.js mobile/lib/notifications/navigation.test.js src/lib/notifications/target.js src/lib/notifications/target.test.js
git commit -m "feat(notifications): deep-link an End Duty reminder straight to the End Duty screen

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 19: Record Part C in the vault

**Files:**
- Modify: `Capstone/02 - Features/Notifications.md` (`status: working` — a new dated section)
- Modify: `Capstone/02 - Features/Driver In-App Guide.md` (the reminder is a driver-facing surface)
- Modify: `Capstone/01 - System/System Overview.md` (changelog entry)
- Modify: `SYSTEM.md` (`.agents/AGENTS.md` rule 3 requires it)
- Modify: `Capstone/07 - Development/Missed End Duty Report Design Note.md` (the Part C decision, and that the scheduler gap is now closed)

- [ ] **Step 1: Read the docs before writing the Next.js-facing parts**

`CLAUDE.md` requires reading the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code. This task's code landed in Tasks 16–17; re-check the app-router route-handler guide against what Task 17 actually added before documenting it.

- [ ] **Step 2: Write the Notifications section**

Add a dated section to `Capstone/02 - Features/Notifications.md` covering: the two stages and their boundaries; that the grace starts *after* the shift ends while the mobile nudge window opens *before* it; that the dedupe's per-day half lives in `reference_id = YYYYMMDD` and why a constant there fails silently; that the roster out-time is read through `loadDriverScheduleContext` + `driverDayEligibility` rather than re-derived; that both stages share one `NOTIFICATION_EVENTS` key; and the honest limit that a driver with no active `device_tokens` row receives nothing.

Then record the trigger, which is the part future readers most need: **`/api/cron/sync` had no caller** — no scheduler configured, `cron_sync_last_ok` stale since 2026-09-06 — so the time-driven producers were correct and silent. State that `.github/workflows/cron-sync.yml` is now that caller, that it also unblocks the start-window producer, and name its limits (queued not punctual, default branch only, disabled after 60 days of inactivity). Cross-reference the pre-existing "DEPLOY CHECK" note in the cron route header rather than duplicating it.

- [ ] **Step 3: Update the design note and System Overview**

In `Capstone/07 - Development/Missed End Duty Report Design Note.md`, add Part C as a decided scope item with the two-stage ladder and the dedupe-key decision, and update `status` if the note's own convention requires it. In `Capstone/01 - System/System Overview.md`, append to the existing 2026-09-24 entry: the reminder producer, the new event key, the scheduler that now exists, and the test counts. Add the same in `SYSTEM.md` per the repository rule — and it is not a one-liner there, because Part C changes three things that file records:

1. **§5.1 Migration timeline** — a row for `128` (the `end_duty_reminder` preference default).
2. **§6 API Surface**, the **"Push notifications & device tokens ★"** group — it documents the producers, so record that `/api/cron/sync` now drives one more, name the event key, and state the two-stage ladder. **Also correct whatever that section says about the scheduler being absent**: it is the reason the start-window producer was silently dead, and after Task 17 it is no longer true. Leaving a stale "no scheduler is configured" line there would be worse than saying nothing, because the next reader would trust it.
3. **The dated changelog at the end of the file** — the entry for this work, in the existing style, noting that the same caller also revives the start-window notifications.

- [ ] **Step 4: Commit**

```bash
git add "Capstone/02 - Features/Notifications.md" "Capstone/02 - Features/Driver In-App Guide.md" "Capstone/01 - System/System Overview.md" "Capstone/07 - Development/Missed End Duty Report Design Note.md" SYSTEM.md
git commit -m "docs: record the End Duty reminder push and the scheduler that drives the cron sync

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Part C acceptance criteria

1. With the app **killed** on a real device build, a driver whose shift ended more than 30 minutes ago and who has no out-time tonight receives an OS notification. Verified on a dev build (`expo run:android`), **not** Expo Go — Expo Go cannot receive remote pushes for this app's package.
2. The stage-1 notification is **silent** (no sound) and the stage-2 one is **loud**. If stage 1 makes noise, the channel id is wrong, not the preference.
3. Tapping either notification opens the End Duty screen directly. A tap that lands on Home, or that only marks the row read, fails this criterion.
4. A driver who has already ended duty receives nothing, and neither does one whose row is closed by Part A's sweep.
5. A driver on approved leave, on a rest day, or with no roster row receives nothing, and the run reports it in `end_duty_skipped` rather than in `errors`.
6. **The dedupe rolls over daily.** Two consecutive forgotten days produce two notifications, not one. This is the criterion most likely to fail silently: it passes trivially on the first day and only shows up on the second.
7. With the push preference off, the in-app `notifications` row still lands and no OS push is sent. With the in-app channel off too, nothing is written and `end_duty_reminders_created` is `0`.
8. A driver with **no active `device_tokens` row** produces a `push_outbox` row that `flushOutbox` reports as an error — visible in the response, never a thrown failure. The reminder is not retried for that driver.
9. `end_duty_reminders_created`, `end_duty_pushes_attempted` and `end_duty_skipped` appear in the `/api/cron/sync` response, and a throwing producer leaves them at `0` with the sync still returning `200`.
10. The GitHub Actions workflow runs green on a manual dispatch, and the run's output shows the HTTP code from the endpoint.
