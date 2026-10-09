# Driver service qualifications and cargo verification — idea assessment

Full proposed roadmap: [[Driver Qualifications and Cargo Verification Roadmap]]. Includes the user's requirement to apply Impeccable, UI UX Pro Max and High-End Visual Design to mobile UI/UX.

Date: 2026-10-09
Status: Proposal assessment only; no implementation or policy approval.

The proposal aims to prevent unsuitable driver assignments and give drivers clear passenger or cargo tasks in one shared app. User-confirmed grouping (2026-10-09): Passenger Driver covers Guest/VIP, and Cargo Logistics Driver covers Restaurant Supply Pickup, Restaurant Food Delivery and Hotel Supply Transfer. Hotel and restaurant cargo share the same driver pool and cargo workflow; do not create separate qualifications based only on those sources. Individual service permissions remain auditable underneath the two groups. Cross-group qualification must be explicit. The assigned trip should select the app's workflow; a driver's profile alone should not select it.

Qualification checks should cover candidate filtering, assignment, reassignment/substitution and trip start, with shared deterministic rules and clear dispatcher/Copilot explanations. Qualification approval, suspension and changes during an active trip need explicit ownership and handling rules. Operational qualifications do not replace the existing vehicle/license eligibility checks. The Driver Management note records goods-vehicle license support as unresolved; this assessment makes no new legal or license-policy determination.

Cargo manifests, pickup counts, delivery counts, receiver identity and evidence photos would improve accountability. Vehicle safety inspection remains separate from item receipt verification. Record expected, picked-up and delivered quantities per manifest line, including units, discrepancies and who recorded them. A manifest reference image identifies an expected item; a pickup or delivery photo records an observed event. Images do not prove quantity or condition by themselves.

Before implementation, decide who may authorize departure after shortages/damage, how partial delivery is closed, who handles disputed receipts, and how offline submissions/retries avoid duplicate evidence. Do not label a partial receipt as complete merely because the trip ended.

Reconcile the existing typed transportation-request path with the separate supply-delivery foundation before adding a new item table. The latter already includes immutable manifest revisions and shipment event history; a new parallel manifest store could create competing sources of truth. This overlap needs design review rather than assuming either path is interchangeable or complete.

Suggested first release: service qualifications with backend enforcement; trip-based passenger/cargo screens; read-only manifest and pickup/delivery quantities with discrepancy handling and receiver name. Make item reference images optional. Add proof photos when private storage, ownership permissions and offline evidence behavior are defined. Signature, OTP and specialized cargo monitoring are later scope decisions.

Verification: read the user-supplied proposal and relevant vault notes: [[Driver Management]], [[supply_delivery_foundation]], [[FleetOps Cargo Rollout Runbook]] and [[FleetOps Passenger Cargo Integration and Fuel Implementation Plan]]. This was a documentation-based assessment, not a live database, device or implementation verification. No application code, database rows or approved policies changed.

## Proposed web placement — 2026-10-09

This is a suggested information layout, not implemented UI or approved integration architecture.

| Existing web area | Proposed information |
|---|---|
| Drivers > driver detail | Service Qualifications section: allowed services, status, reviewer and review date; authorized staff manage changes. |
| Reservations > request detail / Supply Deliveries > shipment detail | Requested service and original cargo manifest: expected quantities, units, weights, handling notes and optional reference images. Placement follows the request's owning intake path, pending reconciliation of the two paths. |
| Dispatch > Calendar / assignment view | Eligible drivers and clear qualification blockers alongside existing availability, vehicle and license checks; a compact cargo summary links to the source manifest. |
| Trips > trip detail | Cargo Verification section: expected/picked-up/delivered quantities, discrepancies, pickup/delivery photos, receiver identity, recorded times and responsible users. Vehicle inspection remains a separate section. |
| Reports | Service filters and agreed cargo summaries, such as complete/partial deliveries and discrepancy counts, once their definitions are approved. |

Example review path: open a cargo trip, inspect its Cargo Verification section, and follow its source-request/shipment link to the original manifest. Driver mobile submissions would appear against that same trip; web staff should not need to enter them again. A discrepancy approval action requires a defined owner and permission before implementation.

Verification: confirmed the existing driver, reservation, supply-delivery, dispatch calendar, trip detail and report page files are present. Proposed sections and cross-links were not implemented or browser-tested.

## Proposed shortage scenario and external feedback — 2026-10-09

Example: a restaurant expects 10 boxes of cooking oil; the supplier presents 9. The driver records expected 10, counted 9, shortage 1, remarks and available photo evidence against the original manifest revision. FleetOps saves the report, shows it to dispatch and places pickup in a proposed awaiting-decision state. The original expected quantity remains 10.

With an agreed integration, FleetOps sends a shortage event to the system that owns the source request (for example SCM), which routes it to the responsible restaurant/purchasing owner. Direct restaurant delivery of the event is appropriate only where that restaurant system is the agreed source or recipient. The event identifies source request, shipment/trip, manifest revision, item/unit, expected and counted quantities, stage, time, reporter and authorized evidence references. Recording and sending an observation do not approve a short pickup or change inventory.

The proposed business decision is wait for the missing box, authorize pickup of 9, or cancel/reschedule. A designated source-side owner decides quantity acceptance; Fleet dispatch decides whether the revised transport can proceed under its own checks. Record decision identity/time/reason before allowing departure. Exact authority and permissions remain unapproved. Safety holds are not bypassed by business acceptance.

If 9 were picked up and 9 received, record delivery of all 9 collected boxes while retaining the unresolved/accepted shortage of 1 against the order of 10. If 9 were picked up and only 8 received, record a separate delivery discrepancy of 1; do not assume its cause. Source-side receiving/purchasing owns stock, supplier claims and order closure. Trip completion is separate from order completeness.

The web should distinguish report saved, external send pending, acknowledged and failed; offline or failed delivery is never presented as an external receipt. Retry must preserve event identity to avoid duplicate processing. If partner integration is unavailable, dispatch follows a manual handoff and records its outcome. These are proposed capabilities: the existing supply foundation note explicitly records no partner receiving/POD/outbox workflow. No messages were sent, software changed or workflow approved. Verification: proposal and supply foundation documentation review only.
