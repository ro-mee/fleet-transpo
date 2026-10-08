# HR Leave and Fleet Availability Readiness Plan

**Status:** Internal adapter preparation started; HR contract, connection, and cutover are not approved  
**Date:** 2026-10-07  
**Scope:** Prepare FleetOps to consume HR-owned leave status later. No HR endpoint, credentials, schema, or operational connection is included.

## Ownership target

- HR owns employee leave requests, approvals/declines, cancellations, balances, and leave evidence.
- FleetOps consumes the minimum effective leave status needed to calculate driver availability and to show an employee/driver their own status.
- FleetOps remains the owner of weekly driver work schedules unless a separate decision moves that domain.
- FleetOps does not send leave requests or approval decisions to HR under this plan.

These are the user-approved target boundaries. They do not establish an HR payload, status vocabulary, privacy authorization, or synchronization method.

## Current FleetOps behavior

Migration 049 and the current application provide local leave submission, withdrawal, review, and balance behavior. Approved leave blocks availability; pending leave is a warning. Approval currently deducts local balance and updates overlapping `Scheduled` and `In Progress` dispatches to `Pending Reassignment` while clearing the driver. Several availability, recommendation, conflict, and trip-start paths consume `loadDriverScheduleContext`.

Keep the local workflow operational during preparation. Do not cut over or remove its write paths until an HR source or HR-owned interim handoff is active, records are reconciled, and affected dispatch behavior is approved. The current in-progress-dispatch mutation needs a specific replacement rule before cutover; an HR status update must not silently clear an active driver assignment.

## Preparation implemented

`src/services/driver-leave-availability.service.js` now isolates the operational leave read. `loadDriverScheduleContext` calls this service while retaining its existing `{ schedules, leave }` context for all current consumers. The local `driver_leave_requests` table remains the current source behind the boundary, so existing status behavior is unchanged.

The adapter returns only availability fields: `driver_id`, `start_date`, `end_date`, optional `start_time`/`end_time`, and current status. It does not return leave reasons, leave balances, reviewer notes, or request audit details to scheduling consumers. No migration, API, permission, UI, or external connection changed in this preparation step.

## Provisional internal example (synthetic only)

The following shape is an example for discussion and fixture design, not an approved HR contract. Field names, statuses, identity mapping, time semantics, and delivery guarantees remain open.

```json
{
  "event_id": "synthetic-leave-event-001",
  "worker_ref": "SYNTH-EMP-0001",
  "status": "approved",
  "start_date": "2030-06-10",
  "end_date": "2030-06-12",
  "start_time": null,
  "end_time": null,
  "revision": 1,
  "source_updated_at": "2030-05-30T01:00:00Z"
}
```

Fixture scenarios to carry into the approved contract and later acceptance suite:

1. Approved full-day leave blocks an overlapping driver window.
2. Approved partial-day leave blocks only an overlapping window, if HR authorizes partial-day data.
3. Pending status remains warning-only only if HR authorizes FleetOps to receive it; it does not block under current behavior.
4. Declined, cancelled, or revoked leave does not block after the authoritative correction is applied.
5. Duplicate, replayed, out-of-order, unknown-status, stale, or unmatched-worker events do not silently mark a driver available.
6. A leave update overlapping a future dispatch is raised for dispatcher review; an in-progress trip follows a separately approved operational procedure.

## Open HR and Fleet decisions

Resolve these when integration is initiated; none is a blocker for the internal adapter seam:

- HR system and accountable HR data owner.
- Stable HR worker identifier and reviewed mapping to Fleet `employee_id`/`driver_id`; never match by name alone.
- Which statuses FleetOps may receive and how approval, correction, cancellation, revocation, and retroactive changes are represented.
- Full-day versus partial-day intervals, date inclusivity, timezone, and boundary behavior.
- Delivery method, authentication, event identity/version ordering, replay, reconciliation, and deletion/tombstone behavior.
- Maximum acceptable data age, source-outage behavior, and the operational owner for unresolved or unmatched identities.
- Display permissions and retention; default to excluding reason, medical evidence, balance, and reviewer notes.
- What dispatchers must do when new or corrected leave overlaps a committed dispatch or an active trip.

## Phases and gates

### Phase 0 — Define the Fleet boundary (in progress)

- Keep the pure availability rules and `loadDriverScheduleContext` consumer shape independent from the local leave table.
- Keep the existing local provider active so Fleet operations do not lose leave coverage before a replacement exists.
- Prepare synthetic examples for future mapping and failure-case acceptance.

**Acceptance:** Current leave and schedule behavior remains unchanged; source provenance is explicit; no HR-specific assumptions are enforced.

### Phase 1 — Approve the HR contract (future gate)

- Record the HR owner, identifier mapping, status/time contract, privacy scope, freshness target, error behavior, and active-dispatch procedure.
- Confirm that the HR process is operational before selecting an integration method.

**Gate:** No production projection or HR connection until the accountable owners approve these decisions.

### Phase 2 — Implement an isolated HR adapter (future)

- Validate source events at the server boundary and map HR identity/status into Fleet's internal availability shape.
- Make ingestion idempotent and safe for corrections, cancellation, replay, and out-of-order updates.
- Keep unmapped or invalid events visible for resolution; never store unnecessary leave details.
- Apply repository migration, RLS, grant, and live-catalog gates if the approved design requires persisted projection data.

### Phase 3 — Shadow and reconcile (future)

- Compare HR statuses with existing local records without changing dispatch eligibility.
- Resolve driver identity mismatches and local/HR conflicts with HR and Fleet owners.
- Confirm freshness and outage behavior using synthetic and owner-approved non-production data.

### Phase 4 — Read-only UI and controlled cutover (future)

- Replace Fleet-side request/review/balance controls with read-only leave availability after HR is the functioning source.
- Show source and last-sync freshness to authorized staff; show a driver only their own operational status.
- Retain or dispose of legacy request history according to an approved audit/retention decision.
- Switch all availability consumers to HR-projected status and remove legacy writes only after reconciliation and acceptance.

## Verification boundaries

This preparation changed a server-side query boundary only. Static source parsing and `git diff --check` are the local checks for this slice; automated tests, browser acceptance, database changes, and HR connectivity are not claimed. Current FleetOps behavior continues to use the local leave workflow.
