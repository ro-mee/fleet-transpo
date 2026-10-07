---
type: implementation-plan
status: proposed
date: 2026-10-02
related: ["[[Reservations]]", "[[transportation_requests]]", "[[Mobile Architecture]]", "[[System Boundaries]]"]
---

# Reservation luggage and customer contact implementation plan

The requested web/mobile feature is planned in `docs/plans/2026-10-02-reservation-luggage-customer-contact.md`. No application code, migration, database row, or mobile build was changed for this planning task.

## Proposed flow

Booking push/pull or the in-app request form supplies an optional luggage count, luggage notes, and guest/customer phone. The shared reservation contract and ingest writer persist them on `transportation_requests`. The reservation detail and queue display actual recorded luggage; null is **Luggage not recorded** and zero is **Luggage: 0**. The assigned driver's existing trip API projects the fields to Trip Details and Live Map. The phone remains a guest contact, separate from the driver's phone.

This follows the existing Booking ownership rule: Fleet caches inbound guest facts and does not change them through the reservation status workflow. Existing reservations and Booking senders remain valid with null new fields. Idempotent delivery does not overwrite a prior request. The queue's current fallback from missing luggage count to passenger count must be removed as part of the feature.

## Planning evidence and limits

- Confirmed `transportation_requests` lacks luggage and guest phone in generated `schema.sql`; the retired `vehiclereservations.guest_phone` is not the current reservation source.
- Confirmed the paginated queue uses explicit list/card SQL projections, while reservation detail uses `tr.*`.
- Confirmed `GET /api/mobile/driver/trips` joins the request and filters by the token's own `driver_id`; mobile Trip Details, Trips, and Live Map consume that response. The Live Map currently has a call control but its `passenger_phone` field is never projected.
- Confirmed mobile caches trip API payloads in per-driver AsyncStorage without a TTL. The implementation plan calls for an explicit contact-caching decision and recommends excluding the phone from persistent trip snapshots.
- Confirmed the current ingest writer puts the parsed request into `integration_log.payload`; the plan requires redacting guest phone and luggage free text from that reconciliation copy.
- `npm.cmd run db:status` was attempted read-only in this planning environment and returned `status failed:` without a reason. The next migration number remains unverified and must be chosen from the live ledger before implementation.
- The user confirmed the field is a **luggage count**, with “Luggage” used consistently in web and mobile UI labels. Optional notes remain proposed; guest rather than booker phone remains an assumption.

Plan terminology was updated on 2026-10-02 after the user's clarification. Verified by searching the plan and this note for outdated luggage labels; no application behavior changed.

Verification of this task: source and note review plus a clean plan diff. No tests or deployment were run for this documentation-only plan.
