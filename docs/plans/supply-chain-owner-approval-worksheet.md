# Supply-chain owner approval worksheet

**Status:** Draft for owner input. No policy decisions are approved by this worksheet.  
**Worksheet updated:** 2026-10-07. This is a document update date, not an approval date.  
**Related plan:** [FleetOps Supply Chain Integration](supply-chain-fleet-integration-plan.md)

Use this worksheet to record source documents, accountable owners, and approvals before enabling cargo candidate eligibility or assignment. The reviewed materials contain no named decision owners, owner-approved SCM/HR contract, approved cargo eligibility policy, approved safety procedure, or approval dates. The role assignments below are proposed routing only. Management must name the individuals and approve the authoritative sources. Do not infer goods-vehicle rules from passenger requirements or treat an SCM delivery window as Fleet's full reservation interval.

Cargo assignment remains disabled. A measurement-only load-fit result does not satisfy driver, route, schedule, documentation, load-safety, receiving, or approval gates.

## Current UI and implementation evidence (read-only review, 2026-10-07)

- The standard vehicle new/edit forms expose general vehicle facts, passenger seating, and the passenger-oriented minimum LTO code. Cargo ratings are managed separately in the Supply Deliveries profile editor.
- The Supply Deliveries **Vehicle cargo capability** form reveals its measurements after the local **Enable supply delivery** checkbox is selected. The fields include rated payload, gross vehicle weight limit, operating mass, operational reserve, usable volume, compartment and loading-opening dimensions, temperature range, handling capabilities, verification reference, and validity date. The checkbox alone does not save the profile.
- The profile API records the saving employee as verified_by and server time as verified_at; it also stores the reference and validity date. The page displays verification date and reference, but not verifier identity or a separate compliance approval. This editor record does not establish who is authorized to verify vehicle ratings or safety controls.
- The Supply Deliveries import panel and src/lib/supply/contracts.js identify sandbox event schema version 1.0, source module SCM_SANDBOX, package weights in kg, package dimensions in metres, pickup readiness, and a delivery window. The route is admin-only, non-production, and gated by SUPPLY_SCM_SANDBOX_ENABLED=true. This is an internal sandbox contract, not an approved partner SCM API or production source-of-record agreement.
- src/lib/supply/capacity.js evaluates manifest readiness, measured payload and volume, package fit against compartment and loading-opening dimensions, handling, temperature, verification freshness, and vehicle dispatch status. src/app/api/supply/shipments/load-fit/route.js reports assignment_eligibility: NOT_EVALUATED. The evaluator explicitly excludes driver qualification, route and full schedule availability, documents, trip mass, load arrangement, axle distribution, and securement.
- The reviewed Supply Deliveries screen had no SCM snapshots, so no saved shipment detail or linked dispatch/trip flow could be inspected. The current plan and source state say no external SCM/HR interface, receiver/POD workflow, or cargo KPI definitions are approved or implemented.
- Migrations 144–148 add private sandbox and allocation schema. They are implementation groundwork only; no application assignment route writes cargo allocations, and the general dispatch API rejects SUPPLY_DELIVERY.

## 1. Decision owners and approval register

The proposed owner function identifies where a decision should be routed. A named individual, approved authority/version, and approval date are deliberately not fabricated. “None recorded” means the decision remains open.

| ID | Decision requiring approval | Proposed accountable owner function (designation pending) | Named owner / approver | Approved authority or API version | Approval status | Approval date | Current implementation context (not authority) |
|---|---|---|---|---|---|---|---|
| D01 | SCM source-of-record, authentication, request/manifest/revision, readiness, cancellation, sequencing, retry, and event contract | SCM Integration / SCM System Owner | Not identified; management must designate | No external SCM contract or API version supplied or approved. Internal sandbox event schema 1.0 is non-production and is not partner authority. | Pending; no approval recorded | Not approved; no date recorded | src/lib/supply/contracts.js; src/app/api/supply/sandbox/transport-requests/route.js; sandbox flag and SCM_SANDBOX source constraint |
| D02 | HR source-of-record, identity mapping, active status, leave, schedules, duty/rest, freshness, and revocation interface | HRIS / HR Compliance Owner | Not identified; management must designate | No HR API, feed, system-of-record agreement, or version supplied or approved. | Pending; no approval recorded | Not approved; no date recorded | FleetOps currently uses local driver schedule and leave records; these are not evidence of an HR integration (src/services/driver-schedule.service.js; integration plan §2 and risk register) |
| D03 | Vehicle cargo categories, safe payload/GVW/operating-mass basis, usable volume, compartment/opening fit, handling/temperature capabilities, measurement method, verifier, reference, and expiry | Fleet Compliance / Vehicle Standards Owner | Not identified; management must designate | No owner-approved measurement, road-safety, or vehicle-rating policy/version supplied. | Pending; no approval recorded | Not approved; no date recorded | Conditional cargo-profile fields and internal evaluator exist (src/app/api/supply/vehicles/cargo-profile/route.js; src/lib/supply/capacity.js; migrations 144–146); implementation does not approve limits or verifier roles |
| D04 | Cargo driver license class/endorsements, training, accepted evidence, verifier, validity, expiry, and recheck | Fleet Compliance Owner, with HR Compliance as source owner | Not identified; management must designate | No cargo license/training matrix or authoritative evidence policy/version supplied. Goods class B2 remains unsupported pending confirmation. | Pending; no approval recorded | Not approved; no date recorded | Existing vehicle license rules are passenger B/B1 (Capstone/03 - Database/Tables/vehicles.md, “Required driver license class”); local driver-license verification fields are not a cargo qualification policy |
| D05 | Fleet's complete shared reservation interval, route-time source, buffers, overlap, timezone, and delivery-window relationship | Fleet Dispatch Policy Owner | Not identified; management must designate | No cargo reservation-interval policy or API version supplied or approved. | Pending; no approval recorded | Not approved; no date recorded | Sandbox schema 1.0 provides pickup.ready_at and a delivery window, not the Fleet reservation interval. Migrations 147–148 define typed slot/allocation schema, not interval semantics. |
| D06 | Load-plan authorship/review, axle-balance method and limits, securement equipment/checks, special handling, evidence, verifier independence, and recheck triggers | Fleet Safety / Compliance Owner, with Warehouse Loading Operations | Not identified; management must designate | No approved load-safety procedure, checklist, standard, legal limit set, or version supplied. | Pending; no approval recorded | Not approved; no date recorded | src/lib/supply/capacity.js and load-fit API explicitly exclude loading arrangement, axle distribution, and securement. SECURE_LOAD is a declared handling capability, not proof of performed securement. |
| D07 | Driver/warehouse/receiver roles, site permissions, proof of delivery, quantity semantics, discrepancy evidence, replay/offline rules, and reconciliation | Warehouse / Receiving Operations Owner, with FleetOps Access-Control Owner | Not identified; management must designate | No approved receiver-authorization policy, evidence standard, or receipt API version supplied. | Pending; no approval recorded | Not approved; no date recorded | Supply Deliveries says it does not collect receiving evidence or post inventory. The plan marks cargo execution, receiver authorization, and POD as unimplemented (P0.5). |
| D08 | Inventory-posting authority and SCM receipt acknowledgement | SCM / Inventory Owner | Not identified; management must designate | No signed owner decision or receipt API version supplied. | Pending; no approval recorded | Not approved; no date recorded | The integration plan proposes SCM/Inventory as the sole stock writer unless owners approve a change. This is a proposed boundary, not an external approval; no Fleet receipt or inventory writer exists. |
| D09 | Cargo KPI names, numerator/denominator, qualifying events, exclusions, timezone, corrections, and source owners | FleetOps Analytics / Reporting Owner, with Fleet and SCM event owners | Not identified; management must designate | No approved cargo KPI catalog, source-event contract, or version supplied. | Pending; no approval recorded | Not approved; no date recorded | Fleet Utilization, Driver Performance, and Trip Performance exclude typed supply dispatches; cargo-specific KPI reporting is not implemented. Fleet Cost, Financial Summary, and Fuel Consumption remain fleet-wide. |
| D10 | Cargo evidence privacy, access, retention, deletion, and audit review | Information Security / Privacy Owner | Not identified; management must designate | No cargo-evidence retention or access-review policy/version supplied. | Pending; no approval recorded | Not approved; no date recorded | Existing FleetOps permissions do not by themselves define new SCM, warehouse, receiver, or cargo-evidence access. The integration plan calls for least-privilege and retention review. |

## 2. Driver and vehicle eligibility (P0.3; decisions D03–D04)

Record an approved mapping for each cargo vehicle/service category or operating-mass band. Do not copy passenger license classes or infer that passenger capacity establishes goods-vehicle eligibility.

| Vehicle/service category or mass band | Required license class / endorsement | Required cargo training | Accepted evidence source and verifier | Validity, expiry, and recheck rules | Decision reference / approver |
|---|---|---|---|---|---|
| No cargo class or mass-band matrix approved | No approved goods-class mapping. Existing B/B1 rules are passenger-specific; B2 remains unsupported pending Fleet confirmation. | No approved cargo training or endorsement requirements. | FleetOps has local license image and verification fields (class, expiry, verifier, date, method). HR/source authority and cargo-specific verifier are not approved. | No cargo-specific validity, recheck, or HR revocation rule approved. Local leave/schedule records do not establish an HR feed. | D02 and D04; named owners, policy/version, and approval date remain pending. |

**Disposition:** Driver eligibility remains blocked. A license-on-file state, passenger license class, local leave record, or profile editor identity is not an approved cargo qualification.

## 3. Full Fleet reservation interval and route evidence (P0.3 / P0.4; decision D05)

Define the exact interval reserved in the shared passenger/cargo dispatch calendar. The SCM pickup-ready time and delivery window are constraints, not a complete reservation interval.

| Interval element | Approved start/end event or duration source | Buffer / freshness rule | Owner / approval reference |
|---|---|---|---|
| Loading and staging | No approved start/end event or duration source | Not approved | D05; named Fleet Dispatch Policy owner and authority/version/date pending |
| Load-plan review and securement checks | No approved start/end event or minimum lead-time | Not approved | D05, coordinated with D06; verifier role not designated |
| Route and travel-time estimate | No cargo route provider/method or freshness rule approved | Not approved | D05; route evidence source and version pending |
| Waiting at pickup or delivery | No approved waiting allowance or interval treatment | Not approved | D05; owner approval pending |
| Unloading and receiving handoff | No approved duration or handoff event; receipt flow is absent | Not approved | D05 and D07; receiving owner and policy/version/date pending |
| Turnaround and deadhead to next permitted work | No approved rule for return, repositioning, or next-work readiness | Not approved | D05; owner approval pending |
| Timezone and daylight-saving interpretation | Sandbox event has a timezone field; Fleet reservation interpretation is not approved | Not approved | D01 and D05; external source and Fleet timezone rule pending |

**Approved reservation formula:** None approved. Do not derive the reserved interval from only pickup.ready_at, a delivery window, passenger operating hours, or route estimate. Record the approved start event, end event, duration sources, buffers, and conflict rule after owner sign-off. Approval date: none recorded.

## 4. Load-plan, axle-balance, and securement verification (P0.3 / P0.5; decision D06)

| Control | Decision still required | Evidence and freshness | Verifier / authority | Block or recheck condition |
|---|---|---|---|---|
| Load-plan author and verifier | Define who prepares the plan, who independently approves it, and whether driver/warehouse sign-off is required | Approved plan format, revision, package placement, and evidence retention | No named verifier, procedure/version, or approval date recorded | Block until roles and approval evidence are approved; recheck after relevant changes |
| Gross vehicle and axle-load calculation or measurement | Approve method, legal limits, axle configuration, instrumentation/calibration, and reserve | Measurement record, instrument/calibration reference, time, vehicle identity, and manifest revision | No approved method, limit source, verifier, or version | Block if any required mass, limit, method, or evidence is missing or stale |
| Package placement and prohibited orientations | Approve placement, stacking, distribution, separation, and orientation rules | Plan revision and recorded loading confirmation | Current package-fit checks do not validate packability or axle distribution | Block when arrangement cannot be evidenced or the manifest/vehicle/loading arrangement changes |
| Restraint / securement equipment and inspection | Approve equipment, method, inspection steps, and who verifies before departure | Checklist/evidence reference, time, vehicle/load/manifest revision | SECURE_LOAD capability is not a completed securement check; no verifier is designated | Block until the approved check and evidence are complete; recheck on change or interruption |
| Temperature, sanitation, separation, or special handling | Identify regulated/product classes and approve applicable limits and procedures | Verified equipment range and relevant sensor/check evidence | Sandbox schema supports temperature and handling inputs; no owner-approved thresholds or compliance standard found | Block if a required capability, evidence source, or applicable rule is unknown |

All D06 controls remain unapproved and blocking. Decide whether a changed manifest, vehicle, driver, route, or loading arrangement invalidates prior evidence before assignment is designed.

## 5. Driver execution, receiver authorization, and receiving evidence (P0.5; decisions D07–D08)

| Workflow decision | Approved rule / role | Evidence and source | Replay / offline rule | Owner / approval reference |
|---|---|---|---|---|
| Driver assignment and shipment visibility | Cargo assignment is disabled; define eligible role and shipment visibility after policy approval | No cargo driver projection or assignment route is implemented; fit API returns NOT_EVALUATED | No cargo assignment replay contract | D04, D05, and D07; all approvals pending |
| Warehouse ready and loaded quantities | Sandbox has a readiness boolean/time; production actor, loaded quantity, shortage, and loading evidence rules are not approved | Define line-level expected versus loaded quantity, loading actor, time, and evidence source | No approved checkpoint idempotency/offline rule | D01, D06, and D07; approvals pending |
| Driver departure, arrival, and proof of delivery | Define required checkpoints and distinguish trip completion from delivery/receipt | Current trip/GPS events are not proof of delivery or SCM acceptance | No cargo checkpoint replay/offline policy | D07; approval pending |
| Receiver identity and authorized site scope | Define receiver identity source, delegated authority, site scope, and separation of duties | No receiver role, permission map, or receipt endpoint found | No approved identity refresh or replay rule | D02, D07, and D10; named owners and authority pending |
| Shipped, loaded, received, accepted, damaged, missing, and rejected quantities | Define line-level units, conservation, evidence, reason codes, and treatment of over/short delivery | No receipt/discrepancy event contract or evidence model implemented | No approved conflict, duplicate, or correction rule | D01 and D07; approval pending |
| Partial receipt, discrepancy disposition, return, and close | Define who may accept, reject, quarantine, return, amend, or close and which events preserve custody | No receiving ledger or return workflow implemented | No approved retry/reconciliation rule | D07 and D08; approval pending |
| SCM acknowledgement and inventory posting | SCM/Inventory posting authority is a proposed boundary pending owner ratification | No production partner API, receipt outbox, or inventory writer exists | No partner acknowledgement, retry, or dead-letter contract | D01, D07, and D08; approval pending |

The proposed current boundary is that SCM/Inventory remains the inventory-posting authority unless an approved ownership decision changes it. Trip completion, GPS arrival, or Fleet evidence must not silently post stock.

## 6. Cargo reporting definitions (P0.6; decision D09)

The rows below are metric questions to approve, not endorsed definitions. Approve numerator, denominator, qualifying event, exclusions, timezone, correction/reopen treatment, and source version for each metric before reporting cargo performance.

| Metric candidate | Definition still required | Denominator / exclusions still required | Source and time basis still required | Owner / approval reference |
|---|---|---|---|---|
| On-time delivery | Decide whether the qualifying event is arrival, receiver acceptance, or another approved event, and which delivery-window boundary applies | Define eligible shipments and treatment of cancellations, partial receipts, rejected deliveries, and reopenings | Approved delivery window, timezone, and timestamp source | D09 with D01/D07; no approved definition/date |
| Weight utilization | Approve the metric formula separately from the measurement-only fit result | Define safe payload basis, vehicle reserve, excluded equipment/occupant mass, and denominator changes | Approved vehicle profile and immutable manifest revision | D03 and D09; no approved KPI policy/version/date |
| Volume utilization | Approve the metric formula and whether nominal package volume is comparable with usable vehicle volume | Define package/usable-volume rules, orientation, rounding, and exclusions | Approved manifest and verified profile revisions | D03 and D09; no approved KPI policy/version/date |
| Delivery exceptions / discrepancies | Define qualifying shortage, damage, rejection, lateness, and resolution events | Define line/shipment counting, partial delivery, duplicate/corrected events, and denominator | Approved receipt/discrepancy event source and event time | D07 and D09; no approved event contract/version/date |
| Transport cost | Define cost components and allocation to shipment, trip, split, and return | Define shared-cost allocation, empty miles, cancellations, and missing cost data | Approved finance/fleet source and period/time basis | D09; no approved source/version/date |

Specify treatment of cancelled work, reopened work, partial receipts, unclassified legacy dispatches, timezone boundaries, and late or corrected events. Until approved, do not blend passenger metrics with cargo or label fit-check results as operating KPIs.

## 7. Release gates

- P0.1 is not ready until SCM/HR interfaces, identity boundaries, named owners, and versioned examples are approved.
- P0.3 is not ready until cargo driver/vehicle qualifications, verification evidence, full Fleet reservation interval, route evidence, and load-safety rules have named owners and approved sources.
- P0.4 is not ready until hard eligibility checks are implemented and revalidated inside shared-resource assignment. The load-fit pre-screen does not satisfy this gate.
- P0.5 is not ready until driver, warehouse, receiver, and inventory roles, evidence, quantity semantics, and retry rules are approved and implemented.
- P0.6 is not ready until cargo metrics and source events are approved.
- No approval dates are recorded in this worksheet. assignment_eligibility remains NOT_EVALUATED, the general dispatch API rejects SUPPLY_DELIVERY, and cargo assignment remains disabled.

Unknown safety and eligibility rules remain blocking until the accountable owners approve the rules and evidence sources.