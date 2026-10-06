# FleetOps migration and contract hardening implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the reviewed typed-load SQL validation gaps and make the unapplied integration migrations explicitly atomic, with executable whitespace coverage at the v2 parser boundary.

**Architecture:** Harden only draft migrations 144 and 145 and their static assertions; keep candidate 146 unchanged. Use an explicit ASCII whitespace trim set in both the expected and actual cargo constraint expressions, check NULL historical passenger counts before schema changes, require the service-code index to be ready, and add v2 contract tests for non-space whitespace. Do not use a live catalog or apply migrations.

**Tech Stack:** PostgreSQL migration SQL, Node.js Vitest static migration tests, Zod 4 source-contract tests.

## Global Constraints

- Migrations 144/145/146 remain draft/unapplied and held for concurrent-main reconciliation and explicit apply approval.
- Never run `npm run db:status`, `db:up`, `db:dump`, live SQL/catalog queries, inspect `.env`, or edit generated `schema.sql`.
- Preserve exact validated-constraint guards; do not drop/recreate a mismatched or unvalidated constraint.
- Cargo descriptions consisting only of ASCII space, tab, LF, CR, FF, or VT must fail the SQL CHECK.
- Keep the v2 address-or-complete-coordinate proposal rule and the existing coordinate-only proposal behavior.
- Use TDD. Run only offline `npm run db:check` after static migration tests; it validates migration filenames and the frozen duplicate-version set without connecting to the database.

---

### Task 1: Harden migration 145 and proposal parser whitespace tests

**Files:**
- Modify: `supabase/migrations/145_load_types_and_services.sql`
- Test: `src/lib/integration/load-migration.test.js`
- Test: `src/lib/integration/source-contract.test.js`

**Interfaces:**
- The migration preflight rejects any historical row with `passenger_count IS NULL OR passenger_count <= 0` before typed-load changes.
- The expected scratch constraint and actual `chk_transport_typed_load` use the same expression: `btrim(cargo_description, E' \t\n\r\f' || chr(11)) <> ''`.
- The public v2 request parser continues to reject whitespace-only proposal addresses and accepts a complete coordinate-only proposal.

- [ ] **Step 1: Add failing static and parser tests.** Assert the migration preflight includes both NULL and nonpositive cases; assert both scratch and production cargo-description expressions use the explicit ASCII whitespace set; assert migration 145 starts with `BEGIN;` and ends with `COMMIT;`. In `source-contract.test.js`, submit `{ address: "\t\n\r\f\u000b " }` without coordinates and expect parsing to throw; keep the existing coordinate-only acceptance assertion.

```js
it("rejects ASCII-whitespace-only proposal addresses", () => {
  for (const address of ["\t", "\n", "\r", "\f", "\v", " \t\n\r\f\v "]) {
    expect(() => v2Create({ ...typedRequest, pickup_location_proposal: { address } })).toThrow();
  }
});

expect(migration).toMatch(/passenger_count IS NULL OR passenger_count <= 0/i);
const cargoTrim = "btrim(cargo_description, E' \\t\\n\\r\\f' || chr(11))";
expect(migration.split(cargoTrim)).toHaveLength(3); // two identical CHECK expressions
expect(migration).toMatch(/i\.indisready/i);
const uncommented = migration.replace(/^\s*--.*$/gm, "").trim();
expect(uncommented).toMatch(/^BEGIN;/i);
expect(uncommented).toMatch(/COMMIT;$/i);
```
- [ ] **Step 2: Verify RED.** Run `npm run test:run -- src/lib/integration/load-migration.test.js src/lib/integration/source-contract.test.js`. Expected: new migration-shape checks fail; the Zod whitespace assertion should already pass, demonstrating the missing coverage is the regression test rather than a parser behavior defect.
- [ ] **Step 3: Fix migration 145.** Add the NULL predicate and clarify the preflight message. Add explicit `BEGIN;` and `COMMIT;` as the file transaction boundary. Add `AND i.indisready` to the service-code index guard. Use the explicit ASCII whitespace trim expression in both scratch expected constraint and production CHECK.

```sql
IF EXISTS (
  SELECT 1 FROM public.transportation_requests
  WHERE passenger_count IS NULL OR passenger_count <= 0
) THEN
  RAISE EXCEPTION 'Existing passenger_count requires explicit historical review before typed-load CHECK';
END IF;

-- In both the scratch and production CHECK definitions:
btrim(cargo_description, E' \t\n\r\f' || chr(11)) <> ''
```
- [ ] **Step 4: Verify GREEN.** Re-run the two focused test files; expect all migration assertions and executable v2 parser cases to pass.
- [ ] **Step 5: Commit.** Commit only migration 145 and the two test files with `fix: harden typed-load migration checks`.

### Task 2: Make source-identity migration 144 explicitly atomic

**Files:**
- Modify: `supabase/migrations/144_transport_source_identity.sql`
- Test: `src/lib/integration/source-identity-migration.test.js`

**Interfaces:**
- The migration file begins with `BEGIN;` and commits only after every DDL, backfill, uniqueness-index, and catalog-guard statement has succeeded.
- No migration behavior, identity key, or index definition changes in this task.

- [ ] **Step 1: Add a failing wrapper assertion.** Assert the parsed SQL begins with `BEGIN;` and ends with `COMMIT;` after line comments are removed.

```js
const uncommented = migration.replace(/^\s*--.*$/gm, "").trim();
expect(uncommented).toMatch(/^BEGIN;/i);
expect(uncommented).toMatch(/COMMIT;$/i);
```
- [ ] **Step 2: Verify RED.** Run `npm run test:run -- src/lib/integration/source-identity-migration.test.js`. Expected: migration 144 is reported as unwrapped.
- [ ] **Step 3: Add the transaction boundary.** Add `BEGIN;` as the first SQL statement and `COMMIT;` after the final statement. Do not alter the migration's identity semantics.

```sql
BEGIN;
```

Place that before the existing migration statements, then place this after the final statement:

```sql
COMMIT;
```
- [ ] **Step 4: Verify GREEN.** Run `npm run test:run -- src/lib/integration/source-identity-migration.test.js`.
- [ ] **Step 5: Commit.** Commit only migration 144 and its static test with `fix: wrap source identity migration atomically`.

### Checkpoint

- [ ] Run `npm run test:run -- src/lib/integration/load-migration.test.js src/lib/integration/source-identity-migration.test.js src/lib/integration/source-contract.test.js`.
- [ ] Run offline `npm run db:check`; expect migration filenames to validate without a database connection.
- [ ] Run `git diff --check`.
- [ ] Do not proceed if either candidate migration's static guards fail.
