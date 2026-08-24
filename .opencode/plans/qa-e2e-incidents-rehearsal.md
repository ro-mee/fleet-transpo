# Headless End-to-End QA Rehearsal — Incident Flow

User-approved: shared dev DB mutations with `[QA]`-marked rows + one seeded temp dispatch are OK.
Everything here runs against the **real API over HTTP** (`npm run dev`), not mocked layers.

## Phase 1 — Harness (`scratch/`, gitignored)

**`scratch/qa_incidents_e2e.mjs`** — single self-contained script:

1. **Mint tokens** by importing `signAccessToken` from `src/lib/auth/mobile-token.js`
   (dependency-light, verifies via `NEXTAUTH_SECRET` fallback which IS set in `.env`):
   - driver token: `{ employeeId: <driver's employee>, role: "driver", driverId }`
   - staff token: `{ employeeId: <admin employee>, role: "admin" }`
   - 15-min TTL → mint fresh inside the run.
2. **Runtime target selection** (SQL predicates baked into the script):
   - driver: `drivers.deleted_at IS NULL`, not On Leave, **zero `device_tokens` rows**
     (so `sendPush` fires nowhere real), has a current `driver_vehicle_assignments` vehicle
   - staff: role `admin`|`system_admin`, zero device tokens
   - vehicle: status not Under Maintenance/Decommissioned/Registration Expired,
     no live trips, no active Scheduled/In-Progress dispatch
   - Abort with a clear message if any pool is empty (do NOT fall back to a
     token-holding employee).
3. All QA rows carry `[QA]` markers: incident description prefix `[QA e2e]`,
   dispatch note `[QA seed]`.

## Phase 2 — Server under test

- Check port 3000 free → else `PORT=3100`; start `npm run dev` as background job;
  poll `/api/health`-equivalent (any cheap route) until 200, max ~90s; kill job in finally.

## Phase 3 — Scenarios (assertions over live HTTP)

| # | Step | Requests | Assertions |
|---|---|---|---|
| 1 | Idempotent report | POST `/api/driver/incidents` ×2, same `client_submission_id`, breakdown type, assistance chips, expense claim | 2nd POST returns the SAME `incident_id`; exactly 1 row |
| 2 | Grounding + interruption | (before #1) seed temp dispatch `Scheduled` on the vehicle via SQL | vehicle → `Under Maintenance`; dispatch → `Pending Reassignment`; `audit_logs.old_values->>'reason' = 'Incident #N grounded the vehicle.'`; dispatcher notifications exist; driver ack notification exists |
| 3 | Resolver context | GET `/api/incidents/[id]` (staff) | `affected_dispatches[0].dispatch_status === 'Pending Reassignment'`; `linked_maintenance` empty array |
| 4 | Resolve loop | PATCH ×3 (staff): no actions → w/ actions → repeat | 400 (actions required) · 200 · 409 already-resolved; vehicle → `Available`; reporter got resolution notification |
| 5 | Atomic maintenance | second incident → POST `/api/incidents/[id]/maintenance` ×2 | 201 then 409; repair row: `cost=0`, remarks contain `unverified`, `source_incident_id` set; incident Resolved |
| 6 | Completion loop | PUT `/api/vehicle-maintenance/[id]` status `Completed` (staff) | reporter receives "Vehicle Repair Completed" notification |

Push receipts are explicitly out of scope (no Expo device) — recorded as residual.

## Phase 4 — Cleanup + record (same script, `finally` block)

- Soft-delete `[QA]` incidents + repair rows; delete QA notifications by
  `reference_id IN (qa incident ids)`; restore vehicle status to its captured
  pre-run value; hard-delete the seeded dispatch row.
- Print PASS/FAIL matrix; nonzero exit on any failure.

## Phase 5 — Vault sync + commit

- Incidents.md QA checklist: tick machine-proven steps 1–6 analogues, leave two
  residuals listed (Expo push receipt delivery; AsyncStorage offline-queue path
  on a real device).
- Daily-note entry summarizing results.
- Commit script-free (scratch stays untracked): docs-only commit touching the vault notes.
