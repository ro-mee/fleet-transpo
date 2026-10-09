---
type: reference
title: driver_service_qualifications
tags: [database, drivers, qualifications]
source:
  - supabase/migrations/156_driver_service_qualifications.sql
  - src/lib/drivers/service-qualifications.js
  - src/services/driver-qualification.service.js
last_verified: 2026-10-09
---

# Explicit driver service qualifications

`driver_service_qualifications` stores one UUID record per driver and group (PASSENGER or CARGO). Status is ACTIVE, SUSPENDED or REVOKED. ACTIVE requires an employee verifier, a finite review timestamp and a nonempty policy version. Every record has a reason, positive version and timestamps. Driver and verifier identities are foreign keys.

`driver_service_qualification_events` stores each review's actor, previous/new group and status, reason, policy version, time and resulting version. Qualification/version is unique. Database triggers reject updates, deletes and truncation to preserve history. A privileged database owner can change or disable database protections; these triggers are integrity guards for normal application writes, not a boundary against the owner.

The service locks the driver before reading the current qualification, including first approvals. `expectedVersion` can reject outdated writes with 409; absent current record is version 0. Every change writes the current row, event and `writeAuditRequired` in one transaction. General audit metadata is limited to status/version/driver ID; detailed review reasons remain in private qualification storage. No rejected payload is logged.

Both tables enable RLS, explicitly revoke every anon/authenticated privilege and are classified PRIVATE in `scripts/lib/schema-contract.mjs`. No public policy is created. The generated schema dump contains structure and triggers; live catalog checks separately verify RLS and grants.

Migration ledger was checked immediately before selecting 156: 155 applied, zero pending or changed. Immediately before application, the sole pending file was this migration. Repository runner applied it, then refreshed `schema.sql`: exactly 64 new lines for these objects. Final status was 156 applied, zero pending or changed.

Live verification: qualifications=0 and events=0, RLS=true on both tables, policies=0, anon/authenticated grants=0. The real batch loader returned no approvals. `db:contract` reported 79 classified relations and zero violations. `verify:anon` explicitly refused both new tables; its overall exit 1 reflects 48 unrelated empty responses, resolved by the live contract's RLS/no-policy analysis, not an exposure found on these tables.

Automated tests cover five canonical services, unknown service rejection, missing/inactive/incomplete review details, independent dual groups, audited version updates, policy configuration and authority refusals, stale edits, removed drivers, atomic rollback on audit failure, SQL checks, immutable history, migration idempotence and private privileges. Tests use a dedicated schema inside a transaction that is rolled back; no production driver is approved.

Operational enforcement remains off and requires separate approved policy and roster rollout decisions. See [[Driver Management]].
