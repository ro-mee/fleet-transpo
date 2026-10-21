---
type: assessment
status: operating-integration-and-acceptance-pending
last_verified: 2026-10-20
related: ["[[Trips]]", "[[Cargo UI Backend Readiness Review 2026-10-14]]", "[[Dual Cargo Signatures Implementation 2026-10-20]]", "[[FleetOps Cargo Rollout Runbook]]"]
---

# Cargo remaining work - 2026-10-20

The owner asked what Cargo still needs. This is a source-based readiness assessment, not authorization to activate providers, change fleet policy, send partner traffic or deploy.

## Existing foundation

- Mobile cargo count/condition review, immutable pickup/delivery acknowledgments, signature capture, optional honest GPS and retry/session protection are implemented and tested.
- Web Trip Details reviews expected/picked-up/delivered quantities, shortages, private receipt photos and both handovers; Dispatch links to the trip's signature section. Saved signatures start hidden until View signatures on web and mobile.
- Starting/ending odometer capture remains shared with Passenger. Cargo retains separate source approval, Fleet securement and receiving-proof requirements. Server entry-point consistency was hardened on October14.
- These are implementation/fixture results. The production cargo routes remain deliberately unavailable; the UI images are labeled concepts/sample records.

## Prioritized operating work

1. **Connect one real request source and operating storage path.** Establish which hotel/restaurant/supplier system owns jobs, item quantities, units and changes. Implement approved production manifest intake plus execution reads/writes using the existing versioned, immutable and replay-safe contracts. Current intake POST and execution read/receipt/decision/clearance/evidence exports return CARGO_CONFIGURATION_REQUIRED /503. This needs production adapter work, not just a feature flag.
2. **Finish private evidence operation.** Install the actual authorized photo upload/read/signing storage path and approved retention/access rules for photos and signed receipt payloads. Current production evidence storage refuses before processing bytes. Signer drawings do not need a separate public image store.
3. **Bind real decision and receiving authority.** Define who releases cargo, accepts shortages/damage, confirms secure loading and can receive at the destination; connect the corresponding server-resolved proofs. Typed names and signatures do not grant that authority. Finish the operational handling of refusal, return/disposition and cancellation/reassignment after pickup without an incident-ID bypass. Quantity/condition discrepancy capture already exists; real authority and disposition remain the gap.
4. **Commission and validate the real cargo fleet.** Record measured usable payload, package dimensions/handling/temperature requirements where applicable and verified vehicle/driver eligibility. Complete the approved staged physical-policy rollout and transaction-time checks. Source defaults physical policy to OFF; no live setting or actual fleet measurements were queried in this assessment.
5. **Connect result delivery and staff recovery.** Install the approved partner transport and existing outbox worker, plus scoped failed-message review/retry and reconciliation. Production staff feedback list/retry currently return503. Message acknowledgment must stay separate from quantity acceptance or stock/order closure.
6. **Prove one full staged trip.** Use approved test identities/data on phone and web from request/assignment through inspections/start odometer, pickup review/signature, source/Fleet clearance, delivery review/signature/receiver proof and ending odometer/completion. Include shortage, damage, refusal, WAIT/recount, offline/reconnect, exact retries, access changes and next assignment. Existing database/unit/build checks do not replace native, authenticated operating or concurrency acceptance.

## Useful later UI additions

An authorized web view of the complete vehicle Pre-Trip checklist and a printable/exportable delivery-proof report would improve staff review. They are enhancements, separate from the operating integration blockers. Multi-stop delivery or barcode workflows should follow demonstrated operating need rather than expand this release automatically.

## Verification and limits

Reviewed current cargo API/service exports, manifest intake, private evidence, physical-policy code and feedback exports against the October14 readiness/hardening plan and October20 signature closeout. Fresh focused API/lifecycle/state regression passed **89 tests across3files**, exit0. No live DB/catalog/policy read, operating write, partner request, phone acceptance or deployment was performed. Older ledger/contract totals in historical notes are not represented as freshly verified here. Application code/configuration remains unchanged.
