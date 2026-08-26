---
type: status
title: Technical Debt
tags: [development, debt]
source:
  - (see individual notes)
last_verified: 2026-08-11
---

# Technical Debt

Ranked by **cost of leaving it** × **cost of fixing it now vs later**.

## Fix now — cheap today, expensive later

**This section is empty as of 2026-08-11.** Both entries were closed in Phase 3.
The next cheapest items are in "Fix before anything real happens" below.

**Cleared 2026-08-11:** [[DEBT Vitest Not Installed]] (197 tests now run) ·
[[BUG Root proxy.js Is Dead Code]] (deleted) ·
[[DEBT Runtime DDL On Hot Path]] (all three `CREATE TABLE` calls gone, tables declared by migration 034) ·
[[DEBT Schema Drift From Migrations]] (migrations 033–035 + `schema.sql` + a ledgered runner) ·
**`no-undef`** (enabled; it found a fourth instance of the bug class immediately) ·
[[DEBT vehiclereservations vs transportation_requests]] (migration 036 — the table, 2 columns, 2 FKs, 2 indexes, 2 trigger functions, `syncDispatchReservation()` + 5 call sites, and the `/api/reservations/*` tree) ·
[[DEBT Ingest Paths Diverge]] (both doors now call one `ingestRequest()`; a test asserts they emit identical SQL) ·
[[DOC rbac-model Says 9 Roles]] · [[DOC README Is Boilerplate]] · [[DOC ERDs Missing Core Table]] (`docs/erd/` deleted) ·
[[SEC Database Password In Git History]] (rotated — the old value is rejected by the server)

## Fix before anything real happens

| Debt | Why |
|---|---|
| No reconciliation job for [[integration_log]] | Failed outbound events are recorded and never retried |
| No audit that every route calls a guard | 113 routes, per-route discipline. `scripts/verify-rbac.mjs` pins the **role lists** (78 checks) but not the presence of a guard → [[Authentication]] |
| Missing env keys | `CRON_SECRET`, `BOOKING_WEBHOOK_SECRET`, `BOOKING_GATEWAY`. Consequence today: cron and the webhook fail closed with 503, outbound goes to a mock → [[Environment Setup]] |
| No `engines` field in `package.json` | The README's Node 20.9+ floor is **Next 16's** requirement, not this repo's declaration |

## Accept for now — real, but not urgent at this scale

| Debt | Note |
|---|---|
| [[DEBT Services Folder Mixes Two Concerns]] | A refactor. Worth doing when the folder next needs touching. Phase 3 hit it: the obvious home for shared ingest code, `services/integration.service.js`, turned out to be **client-side**. |
| `docs/` rot generally | Largely closed 2026-08-11 — `README.md`, `docs/rbac-model.md` and `SYSTEM.md` rewritten, `docs/erd/` deleted. Still open: [[DOC Mobile Tabs Documented Three Ways]]. And the fix is a snapshot, not a property → [[Documentation Rot]] |
| Wildcard CORS in two places | Fine on a LAN, not for deployment → [[Technology Stack]] |
| ~~`substitute_vehicle_schedules`~~ | **CLOSED 2026-08-19** — shipped (migration 040, API, card); managed by `/fleet/assignments` since 2026-08-23 → [[Assignments]] |
| 10 zero-row tables | Not debt exactly — unexercised features → [[Feature Index]] |
| Duplicate migration numbers | `008` missing, `019` ×3. The ledger keys on filename, which makes this survivable rather than correct → [[Migrations]] |
| 38 pre-existing UI lint errors | Largest group is 15 `set-state-in-effect` → [[Bugs]] |

## The meta-debt

**Nothing in the repository verifies the repository.** No CI, no schema check, no route-auth audit, no lint gate in a pipeline. Tests now run locally, but nothing runs them for you.

Every finding in this vault was found by hand. That's the debt that generates all the others: there is no mechanism that would have caught [[BUG AuthError Not Imported]], [[DEBT Schema Drift From Migrations]], or the `024_driverincidents` breakage before a human noticed.

**Sharpened by this session.** Three things are now proven rather than suspected:

1. **A green suite is not verification.** 185/185 passed while a sev-1 bug was live, because a test asserted it. CI would have run that suite happily. → [[Tests Can Encode Bugs]]
2. **The linter was the thing that actually found bugs** — but only the JSX half. `no-undef` was off for plain `.js`, so `AuthError` in an API route was invisible while `Badge` in a `.jsx` file was caught. Same bug class, one detector. Turning it on found a fourth instance within minutes.
3. **Verification tooling can be silently dead.** `scripts/load-env.mjs` defaulted to `.env.local`, a file that does not exist, so **all 17 verification scripts** loaded no credentials. Two further bugs (a UTF-8 BOM and CRLF line endings against a `.` that does not match `\r`) meant it still loaded nothing after the first fix. Nothing failed loudly; the scripts just did nothing. → [[Verification Tooling Can Be Dead]]
4. **The gates that exist don't resolve imports.** Phase 3: tests and lint both passed with a deleted symbol still imported in three modules. Vitest only loads what its tests reach; eslint here doesn't run `import/no-unresolved`. A CI job built from these same gates would inherit the blind spot. → [[Things I Should Not Forget]]

**Still true, and now the whole remaining list:** enable a CI job running lint +
tests + `npm run db:status`. The pieces it would call all exist as of today —
`no-undef` is on, 197 tests pass, and the ledger can answer "is the DB current".
What is missing is only the thing that runs them without being asked.

`schema.sql` is the sharpest version of this. It makes drift **visible** in a
git diff, but nothing **gates** it: a schema change applied without a re-dump
still leaves the file stale and silent. Visibility is not enforcement.

## Related

[[Debugging Index]] · [[Bugs]] · [[Roadmap]] · [[Current State]] · [[Home]]
