---
type: reference
title: Migrations
tags: [database, migrations]
source:
  - supabase/migrations
  - AGENTS.md
last_verified: 2026-09-18
---

# Migrations

**118** files in `supabase/migrations/`, contiguous `001`–`115` except for a
missing `090`, with exactly four duplicated numbers (`036`, `037`, `059`,
`060` — two files each, applied in filename order; this set is frozen by
`npm run db:check`), backed by a ledger and a checked-in `schema.sql`.

> Counted with `ls supabase/migrations/*.sql | wc -l`. This vault said "38 files"
> for the pre-backfill state; the real number was 39. If a count here matters to
> you, re-run the command rather than trusting the note.

## How to apply one — CONFIRMED PROCEDURE

```bash
npm run db:status       # applied / pending / changed-since-applied
npm run db:up           # apply pending, in filename order, each in a transaction
npm run db:rebaseline   # (rare) re-record applied-but-edited files after an audit
npm run db:dump         # regenerate schema.sql from live
npm run db:contract     # live schema/RLS/grant contract — see "What 024 teaches"
npm run verify:anon     # probe every table AND view with the public anon key alone
```

`scripts/migrate.mjs` connects with `pg` + the real `DATABASE_URL` — the
`supabase` CLI, `psql` and `docker` are all unusable here, and the Supabase
SQL editor was found to silently target the wrong project. → [[ADR-008 Manual Migration Procedure]]

Writing a new one:

1. `npm run db:status` first — **do not reuse a number** (see below).
   `ls supabase/migrations/` is *not* enough: the ledger holds migrations whose
   files are gone, so a version can be spent without ever appearing on disk —
   which is exactly how a second 113 came to be written (origin's
   `113_session_idle_timeout_5min.sql` vs the local maintenance/RLS set). The
   local set was renumbered on the 2026-09-19 merge to
   `114_maintenance_repairer_identity.sql`, `115_app_errors_rls.sql` and
   `116_rls_gap_tables.sql`; the ledger rows under the old names still read as
   missing-from-disk, and the renamed files apply as safe no-ops (every
   statement is `IF NOT EXISTS` / idempotent).
2. Make it idempotent: `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   `DROP ... IF EXISTS`. The live DB is ahead of the files in places, so a
   migration must be a safe no-op there.
3. `npm run db:up`, then `npm run db:dump` and commit the `schema.sql` diff.
   **That diff is the review artifact** — it is what makes drift visible.

`schema.sql` is generated. Never edit it by hand. Never hardcode credentials
in a script — `scripts/load-env.mjs` reads `.env`, and the one script that
ignored this leaked the production password into git history
([[SEC Database Password In Git History]]).

**The ledger keys on filename, not version number**, precisely because the
numbers are not unique — `019_admin_role.sql` and
`019_service_interval_guards.sql` are two distinct rows. It also stores a
checksum per file and **refuses to run if an already-applied file was edited**,
since an edited applied migration no longer describes the database.

## Rebuilding a database from scratch — do NOT use `db:up`

`db:up` replays migration **files**. Those files cannot reproduce this database:
several were written against a schema that has since moved, and most are not
idempotent. Against an empty ledger, `up` would try to replay all 73 in filename
order and fail partway.

The path that works:

1. Run `schema.sql` against the empty database — it is executable DDL
   (216 `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` statements), structure
   only, no data or grants.
2. `node scripts/migrate.mjs baseline` — records every file as applied without
   running any of it, so the new database starts in step with the ledger.

**UNVERIFIED:** this has never actually been executed against an empty database.
It is what the two scripts are built to do, not something observed working. The
first person to try it should expect ordering problems with sequences and
`REFERENCES` and should fix `dump-schema.mjs` rather than hand-patch the output.

## Numbering — renumbered, then frozen — CONFIRMED 2026-08-26

The numbering described below (missing `008`, `019` ×3) was **renumbered away**:
files are now contiguous `001`–`069`. The only remaining ambiguity is four
duplicated numbers, each with exactly two files:

| Number | Copies |
|---|---|
| 036 (`dispatch_cancel_reason` / `trip_lifecycle_status`) | ×2 |
| 037 (`notification_preferences` / `remove_review_statuses`) | ×2 |
| 059 (`dispatch_push_outbox` / `fuel_submission_idempotency`) | ×2 |
| 060 (`inspection_submission_idempotency` / `remove_anon_employee_access`) | ×2 |

This exact set is **frozen by `npm run db:check`** — the ledger keys on full
filename precisely so the duplicates stay unambiguous. One ledger orphan exists
as of 2026-08-26: `070_driver_licenses_bucket.sql` is recorded in
`schema_migrations` but its file was deleted from disk; do not "fix" it by
creating a different file under that name.

## The migrations worth reading — CONFIRMED

| Migration | Why it's worth your time |
|---|---|
| `002_rls_policies.sql` | Header: *"⚠️ INERT AT RUNTIME — NOT THE SECURITY BOUNDARY."* Honest self-documentation. → [[Why RLS Is Not A Boundary]] |
| `012_status_constraints.sql` | All the status CHECKs in one place: `chk_dispatch_status` (4 values at the time), `chk_trip_status`. The live constraint had **5** values — widened by hand, never in a file; now declared by `042`. → [[BUG Pending Reassignment Not In State Machine]] |
| `042`–`046` | The reconciliation set: dispatch status value, undeclared tables (`ai_report_narratives`, `system_settings`, …), undeclared column. Written to be no-ops against live |
| `013_drop_branches.sql` | Removed branch scoping — single-org decision. → [[ADR-001 Single Organization]] |
| `018_reservation_module.sql` | The vocabulary migration: retires the earlier status list, back-fills, adds `reservation_number`, normalises priority (the review statuses went again in `037_remove_review_statuses`) |
| `028_remove_front_desk_roles.sql` | Removed role ids 5/6/8 → the 6 live roles. (This vault previously cited it as `022_role_system.sql`; no such file exists.) → [[DOC rbac-model Says 9 Roles]] |
| **`029_dispatch_overlap_guard.sql`** | **The best file in the repo.** Advisory locks + a reasoned explanation of why not `EXCLUDE USING gist`. → [[TOCTOU And Advisory Locks]] |
| `030_driverincidents.sql` | Recreates a table `005` dropped: *"The driver portal and /api/driver/incidents still reference it, so it was missing at runtime and incident reporting was broken."* |
| **`049_driver_work_schedule_and_leave.sql`** (2026-08-15) | Weekly schedules + leave. RLS write policies are `system_admin`+`fleet_manager` only (admin excluded). Applied **directly via pg**, see below. → [[Driver Management]] |

## 2026-08-15 — `db:up` is blocked; 049 was applied directly — RESOLVED 2026-08-20

`npm run db:status` reports **51** files: 33 applied, 3 pending
(`036_trip_lifecycle_status.sql`, `037_remove_review_statuses.sql`, `049`), and
**15 "changed since applied"** files (001, 003, 004, 006, 012, 013, 016, 019,
021, 024, 037_notification_preferences, 042, 043, 046, 047). The runner refuses
to run at all while any applied file's checksum changed — so `db:up` cannot apply
`049` (or `036`/`037`, which remain pending in the ledger while the live DB already
reflects them).

`049` was therefore applied by a **one-off direct `pg` connection** (advisory lock
`947112003`, then a `schema_migrations` insert with the sha256[0:16] checksum
`895dfea7f81ed725`), followed by `npm run db:dump` (40 tables, 1 view, 83 FKs,
89 indexes, 11 functions, 16 triggers). **Do not** "reconcile" the 15 changed
files by editing them — that is risk on top of unknown drift. It is the pre-existing
blocker documented in [[DEBT Schema Drift From Migrations]].

**RESOLVED 2026-08-20.** Root cause was **line-ending churn, not SQL drift**:
of the 26 "changed" files, 25 were proven to differ from the applied checksum only
by LF↔CRLF (each applied checksum matched the LF or CRLF form of the identical
content); the 26th (`057`) predates the current blob, but its file replays against
live as a clean no-op. `db:dump` showed no drift throughout. Two fixes landed in
`scripts/migrate.mjs`:

1. `sha()` now hashes **LF-normalized** content, so EOL flapping can never trip
   the runner again (verified: forcing a file to CRLF leaves `db:status` at
   0 changed).
2. `rebaseline` command (`npm run db:rebaseline`) re-records applied-but-edited
   files to their current checksum — the sanctioned "re-baseline deliberately"
   path, now safe to use precisely because of (1).

Ledger now: **63 applied, 0 changed, 0 pending**; `db:up` runs again.
`060` and `061` (anon-`employees` removal + seeded-hash invalidation) are in the
ledger. → [[DEBT Schema Drift From Migrations]]

## 2026-08-26 — ledger state

`npm run db:status`: **73 files, 73 applied, 0 pending, 0 changed**. Live
schema per the dump: **45 tables, 1 view, 95 FKs, 110 indexes,
14 functions, 19 triggers**.

## 2026-08-31 — Migrations 070–080 & Canonical Routes

`npm run db:status`: **84 files, 84 applied, 0 pending, 0 changed**. Contiguous `001`–`080` (with the four frozen duplicates `036`, `037`, `059`, `060`).

| Migration | Name | Purpose |
|---|---|---|
| 070 | `driver_licenses_bucket.sql` | Storage bucket creation and access policies for driver license card uploads |
| 071 | `fuel_receipt_integrity.sql` | Enforces fuel receipt constraints and verification flags |
| 072 | `cleanup_fuel_test_data.sql` | Cleans up test / dummy fuel entries from development |
| 073 | `fuel_review_remarks.sql` | Adds review remarks and audit columns for staff fuel audits |
| 074 | `vehiclemaintenance_completion_audit.sql` | Completion audit hooks for maintenance records |
| 075 | `vehiclemaintenance_completed_at.sql` | Adds `completed_at` timestamp on `vehiclemaintenance` |
| 076 | `routes_integrity.sql` | Enforces canonical location foreign keys (`origin_location_id`, `destination_location_id` $\rightarrow$ `locations`), uniqueness, active/retired lifecycle, and coordinate integrity |
| 077 | `routes_direction_labels.sql` | Adds directional labels and formatting helpers |
| 078 | `validate_routes_integrity.sql` | Validation checks on route coordinates and endpoint linkage |
| 079 | `normalize_route_arrows.sql` | Normalizes route direction arrows (replaces `↔` with `→`) |
| 080 | `backfill_hotel_location_identity.sql` | Backfills canonical hotel location identity so renames preserve `location_id` while moves retire legacy geography |

## 2026-09-16 — Migrations 081–113

`npm run db:status`: **116 files, 116 applied, 0 pending, 0 changed**. The
070–080 table above was the last one written, so the rows below cover the gap
between it and the current head. → [[Maintenance]] for 113.

| Migration | Name | Purpose |
|---|---|---|
| 081 | `incident_triage_integrity.sql` | Keeps the Open/Resolved lifecycle while making triage, accountability and grounding failures observable; unresolved vehicle incidents become retriable, resolved rows treated as complete |
| 082 | `incident_grounding_no_vehicle.sql` | Incidents with no vehicle cannot trigger grounding automation — corrects the 081 backfill for severe reports resolved before a vehicle was attached |
| 083 | `incident_maintenance_unique.sql` | One maintenance work order per incident, archived rows included (nullable `source_incident_id` leaves ordinary records untouched) |
| 084 | `incident_maintenance_state.sql` | Persists the rule decision and the direct incident → work-order link; backfills one work order per open vehicle incident |
| 085 | `incident_maintenance_grounding.sql` | Holds legacy open vehicle incidents in the safety queue until their grounding/maintenance workflow completes |
| 086 | `incident_maintenance_grounding_backfill.sql` | Marks the 084 backfill's work orders complete so they are not stranded in a retry-only state |
| 087 | `auth_security_lifecycle.sql` | Credential/session versioning to invalidate stateless tokens after password/email/role/status changes, plus shared auth throttle buckets |
| 088 | `auth_sessions_mfa.sql` | Server-backed web sessions, encrypted employee MFA, recovery codes |
| 089 | `session_idle_timeout.sql` | Configurable `web_sessions.idle_timeout_seconds` (default 3600) |
| 091 | `company_cards_and_assignments.sql` | `company_cards` + `company_card_assignments` (fleet fuel payment cards) |
| 092 | `expense_records.sql` | `expense_records` (driver expenses, idempotent via `client_submission_id`) |
| 093 | `fuelrecords_payment_method.sql` | `fuelrecords.payment_method` + `company_card_id` + consistency CHECK |
| 094 | `expense_receipt_scans.sql` | Receipt storage key + sha + OCR snapshot |
| 095 | `expense_receipts_rls_fix.sql` | Locks `expense-receipts` storage to backend-signed URLs only |
| 096 | `company_card_unique_assignment.sql` | One active assignment per card (partial UNIQUE) |
| 097 | `incident_production_remediation.sql` | Incident remediation fields (confidentiality, injury, police/insurance refs, SLA dates). **Also added `vehiclemaintenance.inspection_required` — the gate that deadlocked every completion; see [[Maintenance]]** |
| 098 | `incident_overdue.sql` | `update_incident_sla_breaches()` helper for SLA-breach marking |
| 099 | `pg_cron_sla.sql` | pg_cron schedule running the SLA-breach check every minute |
| 100 | `enable_rls_all.sql` | Enables RLS across tables (still inert at runtime) |
| 101 | `incident_response_tracking.sql` | Physical-rescue columns on incidents (response status/type/ETA, history via `incident_comments`) |
| 102 | `incident_responder_tracking.sql` | Links an incident to a GPS-tracked fleet responder driver; auto-advances Dispatched → En Route → Arrived |
| 103 | `app_errors.sql` | `app_errors` — centralized log for unexpected platform failures |
| 104 | `push_review.sql` | `push_outbox` acknowledge flow for permanently-undeliverable pushes |
| 105 | `ai_review.sql` | Same acknowledge flow for non-actionable AI failures |
| 106 | `ai_prompt_templates.sql` | DB-backed prompt overrides (the runtime filesystem is ephemeral) |
| 107 | `notification_transport_assigned.sql` | Notification key `reservation_approved` → `transport_assigned` |
| 108 | `location_geofence_radii.sql` | Per-location arrival geofence radii + persisted GPS trail distance |
| 109 | `trip_monitor_alerts.sql` | Durable live-monitoring alerts |
| 110 | `notification_copy_triggers.sql` | Driver notification microcopy for the two plpgsql trigger producers |
| 111 | `dispatch_standby_presence.sql` | Latest standby observation metadata, separate from the location trail |
| 112 | `backfill_registration_expiry.sql` | Backfills NULL LTO registration expiries from the per-plate renewal window |
| **113** | `maintenance_repairer_identity.sql` | `vehiclemaintenance.repair_completed_by` (FK → `employees`) so the completion guard compares against the real repairer; also flips `inspection_required` to `DEFAULT FALSE`. **No backfill** — see [[Maintenance]] |

Migration `090` does not exist; the numbering skips it. Nothing depends on that
gap, but it is worth knowing before you `ls` and assume a file was deleted.

## 2026-09-17 — the security remediation added no migration

The approved remediation plan called for one: `114_licence_bucket_private.sql`,
an idempotent `UPDATE storage.buckets SET public = false WHERE id = 'driver-licenses'`.
It was **not written**, because the change it belongs to was stopped as unsafe
(see below). `db:check` still reports **116 files valid**, unchanged.

- **Why it was stopped.** Flipping `driver-licenses` private 403s every URL
  already stored in `employees.license_image_url` — the defensive migration would
  have made a live *read* unnecessary while breaking the live *reads that already
  exist*. The same reasoning killed the companion change (turning
  `license-scan/route.js`'s `getPublicUrl` into a 1-hour `createSignedUrl`): the
  public URL is persisted into a durable column and re-rendered by long-lived UI.
  The correct remedy is the pattern `expense-receipts` already uses — **store the
  object key and re-sign per read** — which needs a migration, re-signing readers,
  and a compatibility story for the URL the mobile client is handed at upload and
  echoes back. That is separate work, and it is the next migration this table
  should get.
- **The same deferral applies to the fuel-receipt and face-photo TTLs**
  (`60*60*24*365*10`), which are also persisted URLs. An in-suite `OPEN`
  regression test records the reasoning so the TTL is not "fixed" by shortening
  it. See [[Fuel]] and [[Bugs]].

## 2026-09-18 — `115_app_errors_rls.sql` (written as 114, renumbered on the 09-19 merge)

`npm run db:status`: **117 files, 117 applied, 0 pending, 0 changed**. Note the
`114` slot: the 2026-09-17 entry below says the security plan called for
`114_licence_bucket_private.sql` and that it was **never written** — so `114`
was free and is now taken by this migration (file since renumbered to
`115_app_errors_rls.sql` after a parallel origin 113 forced the shift). A future licence-bucket migration
must take a higher number.

| Migration | Name | Purpose |
|---|---|---|
| **115** | `app_errors_rls.sql` | `ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY` — closes SEC-DB-003 for `app_errors`. Idempotent, deliberately **no policies** and **no `FORCE`**. |

**Why it was needed.** Migration `103` created `app_errors` with the comment
*"No RLS changes either (RLS is inert by design)"* — a premise migration `100`
had already invalidated three files earlier. `npm run verify:anon` then read a
live row, including the `stack` column, with nothing but the public anon key.
See [[Bugs]] — SEC-DB-003, confirmed by measurement.

**Why it is safe.** RLS with no policies is deny-all for roles *subject* to
RLS (PostgREST `anon` / `authenticated`). The app connects as the table owner
(`postgres` via the pg Pool in `src/lib/db.js`), and the owner is not subject
to RLS unless `FORCE` is set. `FORCE` is deliberately **not** set — it would
subject the owner to deny-all and break `src/lib/app-errors.js` and
`/api/errors`. Same mechanism as migration `100`.

**The `schema.sql` diff is EMPTY — and that is SEC-DB-004, not a mistake.**
`db:dump` produced no change for this migration, because `dump-schema.mjs`
emits structure only and never queries `pg_class.relrowsecurity` or
`information_schema.role_table_grants`. Measured after the apply: `schema.sql`
contains **0** `ROW LEVEL SECURITY` and **0** `GRANT` statements. So for *this*
migration there is no review artifact at all — which is precisely why SEC-DB-004
is filed as its own finding, and why the database contract is a gate rather
than a note. (The same dump *did* show migration `114`'s structural changes,
which had not been re-dumped since it was applied.)

**Still open.** `ai_prompt_templates` (`106`) and `trip_monitor_alerts` (`109`)
carry the same omission and are **not** covered by `115`. Both return `200 []`
to the anon probe — unproven, not safe. → [[Bugs]] SEC-DB-003. (Closed the same
day by `116`, below.)

## 2026-09-18 (later) — `116_rls_gap_tables.sql` (written as 115, renumbered on the 09-19 merge)

`npm run db:status`: **118 files, 117 applied, 1 pending, 0 changed** → applied.

| Migration | Name | Purpose |
|---|---|---|
| **116** | `rls_gap_tables.sql` | Closes the rest of SEC-DB-003 (`ai_prompt_templates`, `trip_monitor_alerts`) and all of SEC-DB-006 (`driver_stats`). RLS on the two tables, `security_invoker = true` on the view, and `REVOKE ALL PRIVILEGES … FROM anon, authenticated` on all three. Idempotent, deliberately **no policies** and **no `FORCE`**. |

**This one is not RLS-only, and the reason is the interesting part.** Both tables
granted `anon` the TRUNCATE privilege, and **row security does not apply to
TRUNCATE**. Enabling RLS without revoking would have stopped reads and writes
while leaving anyone holding the public anon key able to *empty both tables*.
The grant list had to be read to see that; it is invisible from the RLS state
alone.

**Rehearsed against live before it was applied.** The DDL *and* the
application's real twelve read/write queries were run against production inside
a single transaction that was then rolled back — 12 of 12 queries identical, and
a role-switch probe inside that transaction went from `driver_stats: 40 rows
visible` to `42501` on all three objects. Worth recording: the **first** harness
applied the DDL, rolled it back, then ran the suite in a fresh transaction
without the changes. It compared baseline to baseline and printed a clean 12/12.
A rehearsal that cannot fail is not a rehearsal; the phase order was the tell.

**Why it is safe for the application — measured, not argued.** The app connects
as `postgres` via `DATABASE_URL`, and live reports `rolbypassrls = true` for that
role. A BYPASSRLS role never has row security evaluated against it, so RLS
cannot change what the app sees; `security_invoker` only changes *whose*
permissions the view is checked against, and the caller is still that role. No
table is in the `supabase_realtime` publication (it exists, with zero tables),
so there is no Realtime subscription to break.

**The `schema.sql` diff is again EMPTY** — it contains only unrelated
pre-existing drift from migration `113`. SEC-DB-004 unchanged, and now
demonstrated twice.

**Verified after applying:** `verify:anon` EXPOSED **0** / PASS 10 /
INCONCLUSIVE 49; all three objects return `HTTP 401 (42501) — refused`;
`db:contract` **0 violations**; 11/11 application queries still correct; security
suite 325; full suite 1859; route-auth 275; `db:check` 118; build green.
→ [[Bugs]] has the full table.

## What `024` teaches — **the gap is now closed, 2026-09-18**

A migration dropped a table that live code still referenced. Nothing caught it until incident reporting broke in production use.

**This note used to end "there is still no check that the schema satisfies the code — that gap is unchanged."** It is no longer true. As of 2026-09-18 the check exists, in the two layers this note itself said would be needed (*"typed queries or a test that runs the app's SQL against the live schema"* — it is the second):

| Layer | Command | Runs |
|---|---|---|
| Offline | `src/security-assessment/schema-contract.security.test.js` | every `npm test` |
| Live | `npm run db:contract` | manually / CI, needs `DATABASE_URL` |

Both read one shared contract, `scripts/lib/schema-contract.mjs` — every object in `public` with an explicit `private`/`public` classification and a reason — and one shared SQL extractor, `scripts/lib/sql-references.mjs`.

**Offline gates (12).** Every `CREATE TABLE` and `CREATE VIEW` in `schema.sql` must carry a classification; the contract may not describe objects the schema lacks; every object the application's SQL names must be declared; no migration may `DROP TABLE` or `RENAME` a declared object unless a later migration recreates it.

**Live gates (`db:contract`).** A live table with no classification; a `private` table without RLS; a `private` table with an anon-permissive policy or `FORCE ROW LEVEL SECURITY`; a view running as its owner with an `anon` SELECT grant; a contract entry with no live object; code naming an object the schema does not have. It also **resolves `verify:anon`'s INCONCLUSIVE verdicts** — a `200 []` cannot distinguish deny-all from empty, and the catalog can.

What changed on 2026-08-11 is narrower still and worth keeping straight: drift is **visible** (a `schema.sql` diff in every PR) *and* now **gated**. Visibility still depends on a human reading the diff, and — see SEC-DB-004 — the diff cannot show RLS or grants at all.

### What the first live run found — 2026-09-18

Recorded in full in [[Bugs]]. Summary, because it is a statement about the schema:

- **56 of 59 relations** are RLS-enabled with no anon policy → PROTECTED, proven regardless of row count. This resolved **49** of the 51 tables the anon probe could not settle; `gpstracking` — never in migration `100`'s list — is among them and is **not** a gap.
- **`ai_prompt_templates` and `trip_monitor_alerts`: RLS disabled, anon holds SELECT** → readable. Empty today, which is the only reason the probe saw nothing. (SEC-DB-003, open.)
- **`driver_stats`: a view, owned by `postgres`, no `security_invoker`, anon holds SELECT** → it reads through the base tables' RLS. Confirmed by probe: 1 live row. (SEC-DB-006, open. Views were never probed before this run — the probe matched `CREATE TABLE` only.)

**No migration was written for any of these.** They are reported findings awaiting a remediation decision.

INFERRED: this is the same class of failure as [[DEBT Schema Drift From Migrations]] — schema and code evolve independently. Both directions are now observable, and the destructive direction is gated.

## 2026-09-22 — `119_email_otp_challenges.sql`

`npm run db:status`: **no pending, no changed** → applied. `db:dump` produced a
**19-line** `schema.sql` diff, all of it the new table plus its index.

| Version | File | Purpose |
|---|---|---|
| **119** | `email_otp_challenges.sql` | `email_otp_challenges` — hashed single-use emailed login codes bound to `auth_version`, with `purpose` (`login` \| `break_glass`), `attempts`/`max_attempts`, `consumed_at` and `expires_at`. Idempotent, **no policies**, **no `FORCE`**. |

This is the table behind email OTP replacing TOTP — see [[Authentication]] and the
Decision Log.

**The two things `schema.sql` cannot show, and how they were verified.** As usual the
diff is blind to both, so neither was taken on faith:

- `ENABLE ROW LEVEL SECURITY` — migration `100` was a one-time list of 20 tables and
  new tables do not inherit it. Confirmed against the live catalog
  (`relrowsecurity = true`, `pg_policies` empty).
- `REVOKE ALL PRIVILEGES … FROM anon, authenticated` — RLS does **not** cover
  `TRUNCATE`, so a table with RLS on and an anon grant is still one statement from
  empty. Confirmed: zero `anon`/`authenticated` grants on the new table.

`npm run verify:anon` returns **PASS with an explicit refusal (HTTP 401, SQLSTATE
42501)** — a refusal, not `200 []`. That distinction is the whole point: `200 []` would
have been INCONCLUSIVE, and INCONCLUSIVE has already been resolved against this project
once (SEC-DB-003). `npm run db:contract` agrees, and the table is registered in
`scripts/lib/schema-contract.mjs` so the offline gate covers it too.

**`employee_mfa` was not dropped.** Its contract entry stays and its `reason` now records
that it is retained but unread. Dropping it would trip the destructive-DDL gate in
`schema-contract.security.test.js`, which requires the contract entry *and* every caller
to move in one change — and the encrypted secrets it holds are irreversible to recreate.
A follow-up migration can remove it once rollback is no longer wanted.

**Also found while verifying, not fixed:** 56 of 60 tables grant `TRUNCATE` to
`anon`/`authenticated`. Migration `116` fixed three; the rest are latent rather than
live-exploitable (PostgREST cannot issue `TRUNCATE`; it needs a raw Postgres connection
as `anon`) and belong in their own migration. Recorded in [[Bugs]].

## 2026-09-23 — `123_psgc_geography.sql`

`npm run db:status` before: **125 files, applied 124, pending 1, changed 0** → `123` was free,
now applied. It was written in a session where command execution was refused, so the number
sat unconfirmed until the gates could run; `db:status` is what confirmed it, and
`ls supabase/migrations/` could not have — the ledger-but-missing set is
`113_maintenance_repairer_identity`, `114_app_errors_rls`, `115_rls_gap_tables` and
**`121_end_duty_maintenance_source`**, so `121` is spent without a file on disk.

`npm run db:contract` after applying: **66 relations, 0 unclassified, 0 violations**, and all
four `ph_*` tables read `RLS on; anon has no SELECT; no anon policy (deny-all for anon)`.
`npm run verify:anon` then scored all four **PASS — `HTTP 401 (42501)`, explicitly refused**,
not `200 []`. `npm run db:dump` wrote **65 tables, 1 view, 133 FKs, 163 standalone indexes,
15 functions, 24 triggers**; against the pre-123 figures (61 / 1 / 128 / 158 / 15 / 20) every
delta is exactly accounted for — +4 tables, +5 FKs, +5 indexes, +4 triggers — so nothing
came along that this migration did not write.

> **A contract exit code worth reading correctly.** Before the dump, `db:contract` exited `1`
> while printing *0 violations*. That was the `phantom` count — entries the contract
> classifies that `schema.sql` does not contain — which is deliberately not one of the
> summary lines. The four `ph_*` entries were exactly that until the dump landed, and the
> moment `db:dump` ran the same command exited **0** with the same clean summary. The gate was
> working, not broken; a non-zero exit with no visible cause is the one to chase rather than
> wave through.

| Version | File | Purpose |
|---|---|---|
| **123** | `psgc_geography.sql` | Four reference tables — `ph_regions`, `ph_provinces`, `ph_cities`, `ph_barangays` — keyed on `psgc_code`, plus `address_type`, `landmark`, `additional_details` and `psgc_barangay_code` on `addresses`. Regions seeded (17); everything below them is imported. RLS **and** a full revoke on all four, no policies. |

**The column that carries the design: `ph_cities.province_code` is NULLABLE.** Metro Manila
has no provinces and several highly urbanised cities sit outside one. A `NOT NULL` province
would force those into a fabricated province — the "do not force every Philippine address
into an incorrect standardized format" rule — so nullability here is *meaningful data*, not
missing data, and the cascading form reads it to decide whether Province is required. A
cascade that assumes four levels everywhere makes every NCR address unsaveable. See
[[Geography Tables]].

**Only regions are seeded, deliberately.** Provinces, cities and barangays number in the
thousands and tens of thousands; writing them from memory would assert specific barangays
that may not exist. They come from `scripts/import-psgc.mjs` and the official PSA export,
and they are the reason the form renders an empty state below Region until someone runs it.

**RLS is enabled explicitly and all privileges are revoked from `anon`/`authenticated`.**
Migration `100` was a one-time list of 20 tables, not a standing rule, so tables created
after it do not inherit RLS (SEC-DB-003) — and the revoke is load-bearing rather than
decorative, because row security does not apply to `TRUNCATE`. There is no sequence to
revoke: the primary key is the natural `psgc_code`.

**A security claim in this migration's contract entry had to be corrected mid-write.** The
`ph_barangays` note in `scripts/lib/schema-contract.mjs` originally asserted that "the
2026-09-23 probe returned a refusal, not `200 []`". No probe had been run and the migration
is not applied — fabricated evidence inside the file whose whole purpose is to prevent it.
It now says NOT YET VERIFIED. When the probe does run, `200 []` would be **INCONCLUSIVE,
not a pass**: the tables are empty until the import runs, and an empty table is
indistinguishable from a policy-denied one from outside.

## 2026-09-24 — `124_barmm_region_code.sql` — written, NOT yet applied

Corrects the one wrong row in `123`'s region seed: BARMM is `1900000000`, not
`1500000000`. `15` was **ARMM**, which the Bangsamoro Organic Law abolished in 2019; the
current source publishes BARMM at `19` and has no region `15` at all, and the 2017
`jgngo/psgc-data` export agrees by still listing `15` as ARMM with no BARMM anywhere.

**This one row blocks the entire import, not just the BARMM rows.** `import-psgc.mjs`
resolves every stated parent and rejects the file as a unit before writing anything — so
every BARMM province, city and barangay fails on a region the table does not hold, and the
other sixteen regions' rows are refused along with them. The importer is behaving correctly;
the seed is what is wrong.

**It is a migration rather than a converter change on purpose.** `psgc-normalize.mjs`
deliberately does not emit region rows, because the importer's region upsert is
`name = EXCLUDED.name` and a data file would silently overwrite the display naming the
address spec asks for. Special-casing the one bad row would put two authorities for regions
in the same table, so the authority that is wrong — the seed — is the one corrected.

**Renumbering a primary key, and the guard that makes the failure legible.**
`ph_provinces.region_code` and `ph_cities.region_code` are the only foreign keys into
`ph_regions` (confirmed against `schema.sql`), and neither is `DEFERRABLE`. An `UPDATE` of
the parent key with children still pointing at it therefore dies mid-statement on
`ph_provinces_region_code_fkey`, in a message that never mentions BARMM or ARMM. The `DO`
block counts those children first and raises with the reason and the count instead. In the
state this meets, that count is **0** — the four tables are empty below Region, because the
import has never succeeded.

| Version | File | Purpose |
|---|---|---|
| **124** | `barmm_region_code.sql` | `UPDATE ph_regions SET psgc_code = '1900000000' WHERE psgc_code = '1500000000'`, guarded. Idempotent: a no-op once 19 is present, and it deletes a leftover 15 only when no province or city references it. Touches no other table and no name. |

**Applied 2026-09-24.** `db:status` showed it as the only pending file, so `124` was free and
`121` remains the only ledger-only version above `123`. `npm run db:up` reported
`124_barmm_region_code.sql ... ok`. `db:dump` then wrote **65 tables, 1 view, 133 FKs, 163
standalone indexes, 15 functions, 24 triggers** — the same figures `123` produced, because a
row rewrite is data rather than structure. **Migration `124` contributed nothing to
`schema.sql`, and that is the correct result**, not a blind spot: the empty contribution is
the claim being checked, and the numbers confirm it.

### The `schema.sql` diff that was not empty, and what it uncovered

The dump was expected to leave `schema.sql` unchanged. It did not — the diff was **106
insertions spanning three migrations**, none of them `124`:

| In the diff | From |
|---|---|
| `CREATE TABLE addresses`, `drivers_*_address_id_fkey`, `locations_address_id_fkey`, `transportation_requests_*_location_id_fkey`, `idx_addresses_verified`, the `address_id` indexes, `update_addresses_updated_at` | **`122`** |
| the four `ph_*` tables, their FKs, indexes and triggers, `addresses_psgc_barangay_code_fkey`, `idx_addresses_psgc_barangay_code` | **`123`** |
| `vehiclemaintenance_source_inspection_id_fkey`, `uq_vehiclemaintenance_source_inspection`, the `source_inspection_id` column itself | **nothing in this repo** |

The first two are the uncommitted backlog of `122` and `123` — the plan treats this diff as the
review artifact, and it had been sitting in the working tree rather than in a commit, which
matters here because the vault auto-commits on a timer and could have attached it to an
unrelated change.

**The third is a real finding.** `vehiclemaintenance.source_inspection_id` — an `integer`
column, a foreign key to `vehicleinspection(inspection_id)`, and a unique index on it — exists
in the live database, and:
- no file under `supabase/migrations/` creates it;
- no code in `src/` or `mobile/` reads or writes it;
- no Capstone note mentions it.

**Almost certainly `121_end_duty_maintenance_source`**, the ledger entry the file for which is
gone. That is a name match rather than proof — the ledger stores a checksum, not content — and
`git log --all --diff-filter=D -- "supabase/migrations/121_*.sql"` returns **nothing**, so the
file was never committed and is unrecoverable.

Nothing was changed to "fix" this, deliberately. Re-creating a `121_` file is the wrong move:
the ledger already holds a checksum for that name, so a differing file would surface as
`changed` — trading one confusing state for another. Whether the column should be added to a
fresh database, or dropped as dead, depends on whether it is abandoned or unfinished, and that
is a decision for whoever knows. It is recorded here rather than left in a transcript.

> **A filter's blind spot, caught by accident.** The first pass over this diff filtered on
> `CREATE INDEX`, which does not match `CREATE UNIQUE INDEX` — so
> `uq_vehiclemaintenance_source_inspection` was invisible to it, and the summary was
> incomplete. The filter was widened to `CREATE|ALTER` at the top level. A summary artifact
> that quietly omits a whole class of statement is the same failure mode as `200 []` read as a
> pass: the answer looked complete and was not.

## 2026-09-23 — `122_address_registry.sql`

`npm run db:status`: no pending, no changed → applied. `db:dump` then reported
**61 tables, 1 view, 128 FKs, 158 indexes, 15 functions, 20 triggers**.

| Version | File | Purpose |
|---|---|---|
| **122** | `address_registry.sql` | `addresses` — one normalized registry for every resolved address (raw input, provider formatted address, PH structured components, postal code + source, coordinates, verification state, provider + place id), plus five nullable FKs onto it. Idempotent, **no policies**, **no `FORCE`**. |

**Why a registry and not per-entity columns.** The obvious shape is a
`latitude`/`longitude` pair on each address-bearing table. That was rejected: it
duplicates the same address across entities, lets one copy drift from another, and makes
"which coordinate belongs to this text?" a per-table question. Instead every address is
one row, and `locations`, `drivers`, `drivers.emergency_contact_address_id` and
`transportation_requests.pickup_location_id`/`dropoff_location_id` point at it.
`locations` keeps its own `address`/`latitude`/`longitude` as a **maintained
denormalization** for the geofence and route-resolver hot paths — the same shape
`routes.origin` already has against `origin_location_id` (076) — so no join is added to
geofence evaluation. The registry row is authoritative; those columns are the read cache.

**Nothing was backfilled, and nothing is bulk-geocoded.** Existing rows keep
`address_id = NULL` and go on reading from their existing text columns; a row is upgraded
only when a human next edits it. Geocoding the whole database was explicitly out of
scope pending a review of API cost, rate limits, accuracy and privacy — and the 403 below
is a live demonstration of why that review has to come first.

**The RLS pair — and this time the `schema.sql` diff is NOT empty.** The diff *is* a
review artifact here, because the table, its five FKs and its six indexes are structure
(`db:dump` grew by exactly those). What the diff still cannot show, per SEC-DB-004, is
the security posture, so that was measured separately:

- `ENABLE ROW LEVEL SECURITY` — migration `100` was a one-time list of 20 tables and new
  tables inherit nothing, so a table created afterwards starts unprotected (SEC-DB-003).
- `REVOKE ALL PRIVILEGES … FROM anon, authenticated` on the table **and on
  `addresses_address_id_seq`** — RLS does not apply to `TRUNCATE`, so RLS alone would
  have left the table emptyable with the public anon key (the `116` lesson).

**Verified after applying:** `db:contract` — 62 relations, **0 violations**,
`addresses` = "RLS on; anon has no SELECT; no anon policy"; `verify:anon` — **`PASS
addresses HTTP 401 (42501) — refused`**. That distinction is the whole point: `200 []`
would have been INCONCLUSIVE, and INCONCLUSIVE has already been resolved against this
project once (SEC-DB-003). `addresses` is the only table in the probe where `anon` holds
no SELECT grant at all — the revoke did what 49 other tables returning `200 []` have not.

**Also verified:** 76 address-library tests across 5 files; `npm run lint` 0 errors /
0 warnings; `npm run build` green with `/api/address/search` and `/api/address/geocode`
registered as dynamic routes.

**Blocked, and not by this migration.** The provider is TomTom, reusing the existing
server key — but that key is authorized for **Routing only**. It returns `200` on
`/routing/1/calculateRoute` and `403 {"code":"Forbidden","message":"You are not allowed
to access this endpoint"}` on `/search/2/search`. The two keys in `.env` are different,
so this is not a mix-up: the Search API is simply not enabled for that key in the TomTom
portal. `node scripts/check-address-provider.mjs` probes Routing first as a known-good
baseline and then Search, printing the error body — that pairing is what identified this
as a key-permission problem rather than a bad key.

**Two corrections to the paragraph above, both made 2026-09-25.**

*"Routing only" was an inference from two endpoints, and it was wrong.* A six-endpoint
probe found authorization is **per-endpoint, not per-product**: `/search/2/reverseGeocode`
answers `200` while `/search/2/place` — the *same product* — answers `403`. Every
**forward** path is closed (`/search/2/search`, `/search/2/geocode`,
`/search/2/structuredGeocode`, `/search/2/place`) and the reverse one is open. That is
exactly the wrong way round for the address-entry feature this note is about, but it
matters here for a different reason.

*The mapping is no longer unverified — it was measured, and it is FALSE.* The claim that
"the unit tests cannot settle it" was right, but the conclusion drawn from it was not:
this note filed the check under "blocked by the Search API", and **it never was**. A
field mapping is tested against a *point* — "what does the provider say is here?" — which
is the question reverse geocoding answers, and that endpoint had been returning `200` the
whole time. Four real reverse payloads settled it: `municipalitySubdivision` carries the
**district**. Caloocan returns `Maypajo` while the provider's own freeform for the same
point reads *"…Maypajo, **Barangay 28**, Caloocan City…"*. `barangay` has therefore been
removed from `PH_COMPONENT_MAP` in `src/lib/address/parse.js`, and the same payloads
showed `Metro Manila` — a region, NCR having no provinces — landing in `province`.

The lesson worth keeping: *forward geocoding returning 403 does not mean no provider
payload can be inspected.* It means one direction of question cannot be asked. The
mapping sat unverified for the whole life of this note because a 403 on `/search/2/search`
was read as "the Search API is unavailable", when one endpoint of that API was answering.
Full account in `Capstone/03 - Database/Tables/addresses.md` and the 2026-09-25 section
of `Capstone/07 - Development/Bugs.md`.

## Related

[[Database Overview]] · [[DEBT Schema Drift From Migrations]] · [[Quick Reference]] · [[ADR-008 Manual Migration Procedure]] · [[ERD]] · [[SEC Database Password In Git History]]
