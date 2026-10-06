# FleetOps v2 location intake — design

**Status:** User-approved design; implementation not yet started. Approved 2026-10-06 in session.

## Context and trust decision

`locations` is the operational source for routing/geofencing coordinates; `addresses.verified` is administrative-address provenance and does not verify a routing point (ADR-015). There is no `locations` verification flag today. The user approved treating an active Fleet-managed registry row with a valid coordinate pair as usable canonical routing input, labelled `canonical_registry`—not as independently verified. Partner-supplied coordinates are always untrusted and never drive routing automatically.

The user also selected durable persistence of unregistered endpoint proposals for dispatcher review. This preserves the approved Task 3 pathway of receiving partner place data without turning it into a routing fact.

## Contract

V2 may provide `pickup_location_code` / `dropoff_location_code` plus optional `pickup_location_proposal` / `dropoff_location_proposal` objects containing a bounded address and optional latitude/longitude pair. Existing pickup/dropoff text remains the sender's original label.

- A location code is an opaque server-generated UUID, unique across active and retired rows, never derived from mutable names/addresses, and immutable through application APIs. Location-list/detail API responses expose it for partner configuration.
- A supplied code must match an active Fleet location. Unknown or retired code is a validation conflict; never fall back to its text or a gazetteer.
- If a code resolves, only that active registry row may feed routing, and only when it has a complete in-range coordinate pair. Provenance is `canonical_registry`. Missing registry coordinates mean unknown estimate, not an external-coordinate fallback.
- A proposal is bounded and checked for a complete, finite, in-range coordinate pair; it is persisted durably in explicitly named `partner_pickup_location_proposal` / `partner_dropoff_location_proposal` request fields, so it cannot be mistaken for a Fleet point. It is projected only to authorized reservation/dispatch readers and never used by route estimation, dispatch, mobile navigation, or geofencing. A future explicit dispatcher action may map it to an active Fleet location.
- Text-only requests and proposal-only requests remain ingestible but unresolved, with null/unknown route distance and duration. No name matching, gazetteer, seed heuristic or free-text route estimate for v2. Legacy PMS v1 keeps current behavior.
- Proposal-only data is not discarded or stored solely in best-effort `integration_log`/`reservation_events`. Request row fields are the durable source; event/audit metadata is supplemental.

## Persistence and flow

Prepare an additive migration (candidate 146 only; confirm current ledger before naming it) to add `locations.location_code` with unique, full-table reservation including retired locations, backfill existing rows with opaque generated UUIDs, and add nullable `partner_pickup_location_proposal` / `partner_dropoff_location_proposal` JSONB fields on `transportation_requests`. Validate JSON shape, coordinate-pair completeness, bounds and non-NaN numeric values. Do not create a new public table. Migration remains unapplied unless separately authorized; never hand-edit generated `schema.sql`.

At create intake, validate codes and proposals before the insert; resolve codes strictly to active rows and persist the existing `pickup_location_id` / `dropoff_location_id` foreign keys. The v2 fingerprint covers the code and exact normalized proposal payload. For future estimates, use the persisted Task 1 non-null v2 fingerprint to select strict behavior: linked active registry points only, no text fallback/gazetteer/legacy heuristic. V1 with null fingerprint continues legacy resolution. Historical trip routes remain unchanged.

GET projections for locations and authorized request queue/detail expose the stable code and pending proposal/reason. No automatic location creation or automatic acceptance of a proposal. A dispatcher mapping/review mutation, with actor/time audit and transaction-safe request-link updates, is a later Task 3 increment; do not claim review is complete until it exists.

## Alternatives considered

1. **Registry-code only:** safest/smallest, but rejects or loses the plan's named-address/coordinate dispatcher-review path.
2. **Persist untrusted proposals (chosen):** keeps partner place facts for review while the router trusts only Fleet's active registry; additive columns and projection required.
3. **Trust incoming coordinates:** rejected; conflicts with ADR-015 provenance and permits unreviewed partner data to determine routing/geofencing.

## Verification and release gates

- Unit/contract tests: active code → canonical ID; unknown/retired code rejects; proposal-only remains unresolved; paired/range-checked coordinates; invalid partial/NaN/out-of-range proposals reject; text ambiguity cannot choose a location; v2 has no heuristic/gazetteer fallback; v1 fallback behavior remains; changes to code/proposal produce same-ID create conflict.
- Route tests: authorized GET exposes code/proposal; unauthorized readers remain denied; pull and push share the same typed parser/writer.
- Focused and full Vitest, auth verification, touched ESLint and offline `db:check`.
- No live schema, same-source location, or browser claim until separately authorized staging/live migration and catalog checks; migrations 144/145 are still provisional drafts and must be reconciled with concurrent main integration before merge.
- Operational location-review UI/action, revision/correction/cancel semantics, cargo dispatch capacity, driver mobile and fuel remain outstanding parent-plan tasks.
