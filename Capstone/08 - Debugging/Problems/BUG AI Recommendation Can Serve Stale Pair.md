---
type: bug
status: closed
severity: sev-2
tags: [bug, ai, reservations, assignment, stale-data]
source:
  - src/components/reservations/ai-assign-dialog.jsx
  - src/components/reservations/ai-recommendation-panel.jsx
  - src/app/api/integration/transport-requests/[id]/recommendation/route.js
  - src/app/api/integration/transport-requests/[id]/assign/route.js
  - src/services/recommendation.service.js
last_verified: 2026-08-18
---

# Bug: AI Recommendation Can Serve Stale Pair

## Symptom

The AI-assisted assignment card showed `XYZ 5678` with Juan Dela Cruz for
reservation `RS-5RB7`, even though the live custodial assignment for that
vehicle was Jack Mors (driver 21). The live database had no substitute schedule
for `XYZ 5678`, so Juan was not a legal substitute either.

## Confirmed live evidence - 2026-08-17

- Request 466 / `RS-5RB7` was unassigned.
- `XYZ 5678` had active `driver_vehicle_assignments.driver_id = 21`.
- Driver 21 was Jack Mors.
- `substitute_vehicle_schedules` had no row for `XYZ 5678`.
- Request 466 had no persisted recommendation snapshot at the time of the check.

## Root cause

There are two recommendation surfaces with different data paths.

### AI-assisted assignment dialog - fixed

The dialog assembled a current DB-backed pair, but when it could not form one it
fell back to stored AI vehicle/driver JSON. Those values can outlive a custodial
reassignment and could therefore supply both the display and commit ids.

The dialog now refreshes active pairings when opened, displays only a current
custodian or dated substitute, never uses stored AI JSON as an id fallback, and
disables assignment when no complete current pair exists.

### Reservation Info AI Recommendation - fixed 2026-08-18

All eight items are closed:

1. GET now revalidates the stored snapshot against live pairing
   (`validatePairAvailability`) before serving it; a stale pair is discarded and
   a fresh one computed.
2. The expired-snapshot Regenerate button now sets `regenerate=1` (previously it
   just refetched the same cached snapshot).
3. Expired / refreshing recommendations disable Accept & Assign.
4. `saveRecommendationSnapshot()` now stores and returns the canonical
   `{ trip, recommended, alternate }` shape (was a flat pair); GET reads it back
   as the same shape the panel consumes.
5. Narration is pinned to the selected vehicle/driver
   (`?vehicle_id=&driver_id=`), so the rationale always describes the shown pair.
6. The panel normalizes singular `conflict` and plural `conflicts[]` responses.
7. `markRecommendationConsumed()` is called after a successful assignment, so a
   used suggestion is never shown again.
8. The recommendation endpoint is the single source of truth; the assign route
   remains the final live revalidation gate.

## Fix

Use the recommendation endpoint as the single source of truth:

1. Revalidate snapshots against live pairing, availability and conflicts.
2. Discard expired or invalid snapshots and generate a fresh recommendation.
3. Store and return one canonical `pair.recommended` / `pair.alternate` shape.
4. Make both regenerate controls request `regenerate=1`.
5. Disable acceptance while a snapshot is expired or refreshing.
6. Key narration by the selected vehicle and driver.
7. Normalize singular and plural conflict responses in the panel.
8. Mark the accepted snapshot consumed after successful assignment.

The assign endpoint remains the final live revalidation gate.

## Verification

- Focused pair-scoring and reservation-state suites: 56 tests passed after the
  dialog fix.
- Expected confirmed-case result: `XYZ 5678 + Jack Mors`, or no pair if Jack is
  unavailable and no explicit substitute exists.
- 2026-08-18: relevant suites pass (12/12 reservation-state) and eslint is clean
  on all four edited files.

## Related

[[AI Advisory]] · [[Reservations]] · [[Dispatch]] · [[Bugs]] · [[Defence In Depth]]
