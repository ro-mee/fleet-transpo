# Supply-chain owner decision request

**Status:** Draft for future integration routing. This document requests owner decisions; it does not approve policies, identify real owners, or authorize an external integration. It is not required to harden the current internal sandbox module.
**Prepared:** 2026-10-07
**Decision register:** [Owner approval worksheet](supply-chain-owner-approval-worksheet.md)
**Implementation plan:** [FleetOps Supply Chain Integration](supply-chain-fleet-integration-plan.md)

## Copy-ready request

**Subject:** FleetOps Supply Delivery: designate decision owners and provide approved contracts

Please designate a named accountable approver for each decision row D01-D10 in the linked worksheet. The proposed functions are routing suggestions only; please confirm or replace them.

For each decision, provide the authoritative policy or contract, its owner and version/date, and the required examples or evidence listed below. Mark any item without an approved source as **Not available / not approved**, identify the accountable owner, and provide the expected decision date if known. Silence or a draft is not approval.

Please return the completed decision records or direct links to approved source documents. Do not include passwords, API tokens, private keys, or other credentials in the worksheet or email; provide connection details through the organization's approved secret-sharing process after the contract and owner are approved.

FleetOps currently has a non-production sandbox import and measurement-only load-fit checks. It has no production SCM/HR integration, cargo assignment route, receiver/POD workflow, receipt/outbox schema, or inventory writer. Cargo assignment stays disabled until its applicable release gates are approved and implemented. The sandbox schema is not partner authority.

## Decisions and requested return materials

| Decision | Proposed owner function | Please provide | Needed for |
|---|---|---|---|
| D01 SCM source, request/manifest revisions, readiness, cancellation, sequence, event identity, replay, and acknowledgement | SCM Integration / SCM System Owner | Approved source-of-record statement; API/schema version; redacted request, manifest, event, acknowledgement, and error examples; authentication method and test-environment availability | P0.1; production connection and recovery remain P1.1 |
| D02 HR identity, active status, leave, schedule, duty/rest, freshness, and revocation | HRIS / HR Compliance Owner | Authoritative source and version; identity mapping; fields and freshness/revocation rules; interface or approved evidence process | P0.1, P0.3, P0.4 |
| D03 Vehicle cargo ratings, measurement basis, profile categories, verifier, reference, and expiry | Fleet Compliance / Vehicle Standards Owner | Approved units and rating basis; measurement method; evidence and verifier authority; validity and recheck rules | P0.3 |
| D04 Cargo driver license classes, endorsements, training, evidence, verifier, validity, and recheck | Fleet Compliance with HR Compliance | Approved cargo qualification matrix and authoritative evidence source; verifier and expiry/recheck rules. FleetOps currently supports passenger B/B1 checks only; goods class B2 remains unsupported pending approval. | P0.3, P0.4 |
| D05 Complete Fleet reservation interval, route-time source, buffers, overlap, timezone, and delivery-window relation | Fleet Dispatch Policy Owner | Approved interval start/end events; loading, unloading, securement, travel and deadhead assumptions; route source; timezone and conflict rules | P0.3, P0.4 |
| D06 Load plan, axle-balance method/limits, securement, handling, verifier independence, evidence, and recheck triggers | Fleet Safety / Compliance with Warehouse Loading Operations | Approved procedure/version; methods and applicable limits; roles; checklist/evidence; conditions that invalidate prior checks | P0.3, P0.5 |
| D07 Driver, warehouse, and receiver roles/site access; POD; quantity and discrepancy semantics; idempotency/offline policy | Warehouse / Receiving Operations with FleetOps Access-Control Owner | Role/site permission map; line quantity units and conservation rules; accepted/damaged/missing/rejected and correction rules; evidence requirements; replay/offline rules | P0.5; multi-trip custody is P1.2 |
| D08 Inventory-posting authority and SCM receipt acknowledgement | SCM / Inventory Owner | Written authority boundary; acknowledgement owner and contract; confirm Fleet transport evidence does not post stock; approved sandbox acknowledgement behavior | P0.5; production callback/recovery is P1.1 |
| D09 Cargo KPI names, formulas, source events, exclusions, timezone, corrections, and ownership | FleetOps Analytics / Reporting with Fleet and SCM event owners | Approved metric catalog including numerator, denominator, event-time source, cancellation/partial/reopen handling, and version | P0.6; production support/reporting expands in P1.4 |
| D10 Evidence privacy, access, retention, deletion, and audit review | Information Security / Privacy Owner | Data classification; authorized roles; storage and sharing rules; retention/deletion periods; audit and review process | P0.2, P0.5, production evidence handling |

## Required response format

Complete one record per decision ID in the worksheet or link a signed/approved source containing these fields:

```text
Decision ID:
Disposition: Approved / Changes requested / Not available / Not approved
Named accountable approver and role:
Delegated approval authority:
Decision and constraints:
Authoritative source title and link/reference:
Version and effective date:
Required examples or evidence attached:
Exceptions, expiry, and re-review trigger:
Approved/reviewed date:
Follow-up owner and expected date, if unresolved:
```

Do not mark a row approved based on an informal assumption. If two authorities conflict, record the conflict and leave the dependent gate blocked pending resolution.

## Gate order after responses arrive

1. Confirm named owners and approved source/version for the relevant D01-D10 rows.
2. Close P0.1 contract and identity boundaries and approve the P0.3 cargo safety, qualification, and reservation rules. Keep eligibility `NOT_EVALUATED` until these gates are met.
3. Finalize P0.2 receipt/evidence/outbox semantics and privacy classification before creating schema. Review the live migration ledger, then use the repository migration runner and security/schema-contract gates.
4. Implement P0.4 shared assignment only after eligibility, schema, and commit-time revalidation are ready.
5. Implement P0.5 one-trip execution, receipt discrepancies, receiver authorization, idempotent sandbox replay, and visible acknowledgement. Trip completion and GPS must not post inventory.
6. Approve and implement P0.6 cargo metrics and the repeatable sandbox end-to-end demo.
7. Keep real SCM durable retry/reconciliation and multi-trip, post-load cancellation, and return workflows in P1.1 and P1.2 respectively.

No live partner call, credential exchange, schema change, or policy default is authorized by this request draft.
