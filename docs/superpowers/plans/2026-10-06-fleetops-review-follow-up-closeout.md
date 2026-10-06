# FleetOps external-review follow-up closeout plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Capstone vault and review ledger synchronized with the approved external-review follow-up and provide verified test/review evidence without crossing the migration or deployment hold.

**Architecture:** Complete this plan only after the integration, migration-hardening, and v2-zero-coordinate plans are green. Update the existing feature/system notes to describe observed code behavior; update the local SDD ledger/report without force-staging ignored artifacts; then run final offline verification and request a fresh scoped review.

**Tech Stack:** Obsidian Markdown, SYSTEM.md, Vitest, ESLint, offline migration checker, Git.

## Global Constraints

- Read each note before editing it; never hand-edit generated `schema.sql`.
- Update `SYSTEM.md` and the closest relevant Capstone feature/data/migration notes.
- Do not inspect `.env`, run live database/status/catalog checks, apply migrations, dump schema, activate connectors, merge, or deploy.
- Run the full Vitest suite once after all code changes; do not rerun it without an intervening code change.
- Do not claim a production build passed; the earlier build stopped before compilation because `NEXT_PUBLIC_SUPABASE_URL` was absent, and no placeholder may be added.
- Keep `.superpowers/sdd` local artifacts ignored; do not force-stage them.

---

### Task 1: Run final code verification

**Files:**
- Verify: all JavaScript and test files changed by the three implementation plans
- Verify offline: `supabase/migrations/144_transport_source_identity.sql` and `supabase/migrations/145_load_types_and_services.sql`

**Interfaces:**
- Final full-suite verification uses `npm run test:run -- --reporter=dot` exactly once after the last code change.
- Offline migration validation uses `npm run db:check`; it validates migration filenames and the frozen duplicate-version set, and must not inspect `.env` or connect to a database.

- [ ] **Step 1: Run touched-file ESLint.** Run ESLint on every changed JavaScript/test file; require zero errors and warnings.
- [ ] **Step 2: Run focused migration validation.** Run `npm run db:check`; require successful offline filename and frozen duplicate-version validation.
- [ ] **Step 3: Run initial whitespace validation.** Run `git diff --check`; require no errors.
- [ ] **Step 4: Run the full suite once.** Run `npm run test:run -- --reporter=dot`; record the exact file/test counts and exit status. Do not rerun without a subsequent code change.

### Task 2: Synchronize Capstone and SYSTEM notes

**Files:**
- Modify: `Capstone/02 - Features/Reservations.md`
- Modify: `Capstone/01 - System/System Boundaries.md`
- Modify: `Capstone/02 - Features/Routes.md`
- Modify: `Capstone/02 - Features/Tracking.md`
- Modify: `Capstone/02 - Features/Trips.md`
- Modify: `Capstone/03 - Database/Tables/transportation_requests.md`
- Modify: `Capstone/03 - Database/Migrations/Migrations.md`
- Modify: `SYSTEM.md`

**Interfaces:**
- Documentation must state: v1 missing catalog IDs reject cleanly while v1 activity compatibility is preserved; v2 service and location rows are locked through request insert; v2 route-cache writes follow successful insert and use the precomputed estimate; pull update/cancel/revision items are counted with a stable unsupported-revision code; zero-coordinate opt-in is limited to v2 canonical targets/route geometry and never GPS/v1 targets; candidate migrations remain unapplied.

- [ ] **Step 1: Read the current text.** Read each listed note around its existing relevant section; do not append duplicate sections if the current paragraph can be updated.
- [ ] **Step 2: Update the feature/data notes.** Correct claims that route cache is persisted before locked location validation; record the v2 service-code lock, failure behavior, whitespace and historical preflight guards; record pull rejection aggregation and the complete zero-coordinate target behavior while preserving v1/GPS sentinel rules.
- [ ] **Step 3: Update SYSTEM.md.** Add one concise top-level correction-wave entry with the Task 1 focused/full test counts, commit IDs, no-build explanation, and migration/connector/release holds. Do not copy claims from the prior baseline as post-change evidence.
- [ ] **Step 4: Verify docs against code.** Compare every new statement to final source/tests, run `git diff --check`, and ensure no live DB, migration apply, connector, or build claim was added.
- [ ] **Step 5: Commit.** Commit only Capstone notes and `SYSTEM.md` with `docs: record external review follow-up behavior`.

### Task 3: Record local SDD evidence and request scoped review

**Files:**
- Modify: `.superpowers/sdd/2026-10-06-fleetops-location-intake/progress.md`
- Modify: `.superpowers/sdd/2026-10-06-fleetops-location-intake/final-review-fix-report.md`
- Review: all files changed by the three implementation plans and this closeout.

**Interfaces:**
- Local progress/report records the reviewed HEAD range, implementation commit IDs, RED/GREEN evidence, focused suite counts, full-suite result, touched ESLint, offline `db:check`, and remaining release holds.
- The fresh scoped reviewer checks v1/GPS sentinels, v2 service retirement, route-cache transaction ordering, migration SQL guards, and pull rejection codes.
- `.superpowers/sdd` files remain local/ignored and are not force-staged.

- [ ] **Step 1: Read current ledger/report.** Preserve earlier correction-wave records; append a dated follow-up rather than rewriting prior evidence.
- [ ] **Step 2: Record verified results.** State that no live DB/status/catalog query, migration apply, schema dump, connector activation, merge, or deploy occurred. State the production build was not run and explain the known missing `NEXT_PUBLIC_SUPABASE_URL` limitation without claiming a new failure or success.
- [ ] **Step 3: Verify local artifacts remain ignored.** Run `git status --short --ignored` and confirm no `.superpowers/sdd` file is staged or included in the tracked diff.
- [ ] **Step 4: Obtain a fresh scoped review.** Review only the final correction-wave diff against the approved follow-up design. Resolve any Important/Critical finding before resuming parent-plan Task 4.
- [ ] **Step 5: Confirm release holds.** Verify final output does not imply a migration was applied, live catalog state was checked, connectors were activated, a production build passed, or branch was merged/deployed.
