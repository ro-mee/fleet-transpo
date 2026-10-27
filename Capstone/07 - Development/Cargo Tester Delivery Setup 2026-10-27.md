---
type: development-log
status: verified-demo-paired-phone-acceptance-pending
last_verified: 2026-10-27
related: ["[[Assignments]]", "[[Cargo Remaining Work 2026-10-20]]", "[[Driver In-App Guide]]"]
---

# Cargo Tester delivery setup - 2026-10-27

## Current owner-authorized verified DEMO state

The owner explicitly requested **use demo details and make it verified** after the missing-data check. Applied the bounded `scripts/seed-cargo-tester-ready.mjs` fixture to the configured application database. This is a synthetic verified app state, not genuine license, registration, insurance or measured-roadworthiness evidence. Earlier missing-data/leave-unverified observations below are historical.

- Driver98 / employee137: clearly fictional license `DEMO-CARGO-00098`, Professional, classB, sample expiry2027-10-27, front/back private DEMO images and recorded fixture verification.
- Vehicle142: `DEMO Cargo Vehicle - TEST ONLY`, plate `DMO-0142`, existing Hotel Operations category3, Cargo, required classB, 500kg usable payload, 4.5m3 volume, 2m x1.5m x1.5m compartment and 2m x1.3m x1.3m opening. The synthetic payload inputs are700kg rated,3500kg gross limit,2500kg operating mass and200kg reserve; profile reference explicitly says SYNTHETIC - NOT MEASURED. No temperature-controlled capability was invented.
- Two vehicle document rows are Verified, with obvious DEMO numbers, expiry2027-10-27 and private OR/CR/insurance fixture images. All four images prominently say DEMO / SAMPLE / NOT VALID and state that no actual credential, registration or coverage is represented. Their hashes were checked after private-storage download.
- Dedicated employee138, DEMO Fixture Verifier, is inactive, roleless and passwordless, with an `.invalid` email and no login access. No real staff identity is credited with checking these documents. The legacy license method field is serialized as `physical_card` only to represent the requested fixture state; the audit explicitly states that no card was inspected.
- Custody assignment163 pairs driver98 with vehicle142. There was no existing pairing to displace. No trip, dispatch, schedule, inspection, driver consent or notification was created; request606 remains Pending, unassigned, originTEST.

The app's actual license eligibility, database-backed road-readiness and physical-load evaluators all passed against saved records; a20kg internal sample load passes with500kg usable payload. Existing missing-review and overload negative self-checks still block. Fresh read-only verification passed. A second apply returned unchanged and the same assignment163, without duplicate documents or audits. Required audit rows exist for drivers, vehicles and cargo_demo_setup, with before-state snapshots and the exact owner instruction. The apply is guarded to these exact existing demo identities and refuses unexpected real details; failures roll back DB writes and remove only newly created objects, while uncertain COMMIT outcomes retain private files for verification.

Verification:45 focused license/readiness/physical tests passed across three files; script strict ESLint, syntax, encoding and whitespace checks passed. The OR/CR fixture preview was visually inspected. No application gate, authentication policy, migration or framework was changed. Full authenticated phone camera/delivery acceptance remains pending. For testing, create a new INTERNAL Cargo reservation through Add Reservation and select this pair through the normal dispatch workflow. Real operations still require replacing these demo fixtures with genuine records and authorized review.

Commands: `node --import ./scripts/route-harness-loader.mjs scripts/seed-cargo-tester-ready.mjs plan`, `apply`, or `verify`. The default is read-only plan; verify is read-only. No secret values are embedded or printed.

The owner requested a vehicle for Cargo Tester and a 3:00 PM delivery today for phone testing, then explicitly authorized choosing and seeding sample locations/cargo. This authorizes the QA request below; it does not establish actual license/document verification or Cargo operating approval.

## Live records checked

- Cargo Tester is driver98 / employee137, active, Cargo, Available. Its license number, Professional type, class, expiry and staff verification are missing.
- The only undeleted Cargo vehicle is vehicle142, Demo Cargo Vehicle. It is Available but Pending commissioning, with no plate, required license class, cargo capacity, registration expiry or insurance expiry. It has no active custodian.
- Before this setup there were no Cargo requests and no trips for this tester. Three active Cargo service types exist.
- The normal custody assignment endpoint explicitly evaluates the stored driver license and vehicle class. Those requirements are unmet. No verification, commissioning, assignment or start guard was bypassed.
- Source review of both the primary checkout and merged main confirms that Cargo execution/receipt exports remain disabled with `CARGO_CONFIGURATION_REQUIRED` /503. Existing simulated services require explicitly isolated nonproduction configuration; the typed demo seeder requires a disposable local `_demo` database. Neither was repurposed against the shared application database. A pending request cannot prove the actual Cargo pickup/signature/clearance/delivery flow.

## Owner-authorized sample request created

- Request ID: **606**.
- Reservation reference: **RS-QA-CARGO-20261027-1500**.
- Pickup time: **October27,2026 3:00 PM Asia/Manila**, stored as `2026-10-27T07:00:00Z`.
- Pickup: existing active CoCo Star Hotel location.
- Destination: existing active NAIA Terminal3 - Arrivals (Bay9) location.
- Service: active Hotel Supply Transfer, load type Cargo.
- Cargo: **10 fictional sample boxes /20 kg**. These are explicit test values, not actual measured freight.
- Origin: TEST. Notes clearly state QA-only, unassigned and not an approved operating delivery.
- State: **Pending**, with no driver or vehicle assigned. No dispatch or trip was created, and no driver push was sent by the seed script.

Created only this request and its audit entry in one transaction using parameterized SQL. The account, vehicle, licensing, verification, commissioning and service configuration were not changed. Scoped marker/advisory lock makes reruns idempotent; rerun returned the same request606. Post-commit read verified its Pending/Cargo state, exact Manila calendar time and null driver/vehicle. Request606 is visible in the web request queue; it is not a ready phone assignment.

## Remaining work

The standalone INTERNAL Cargo backend and manager review are now implemented and locally verified on `codex/internal-cargo-testing`, commit `ce1768e1`; the earlier blanket backend-unavailable observation is historical. External Cargo providers remain unavailable. See [[Internal Cargo Continuation Checkpoint 2026-10-27]]. Request606 remains originTEST rather than an INTERNAL manifest-backed job.

Actual account assignment still needs valid, authorized driver qualifications and a properly prepared Cargo vehicle through the normal app workflow. Tutorial sample practice can be tested separately without recording physical-card or vehicle-document approval.

## Qualification and vehicle follow-up - 2026-10-27

The owner asked to complete the valid driver and vehicle details. A fresh read-only transaction confirmed driver98 still has no license number/type/class/expiry, no front/back license scans and no staff review. Vehicle142 retains Cargo classification and asset codeTEST-CARGO-001 but has no plate, required license class, cargo capacity or registration/insurance expiry; commissioning remainsPending. It has zero saved vehicle documents and zero measured cargo-profile rows. No existing evidence was available to copy into these records.

The normal license review explicitly records comparison with a physical card or LTO Digital ID. Vehicle commissioning requires two saved OR/CR/insurance documents and a staff-recorded, current measured Cargo profile. No profile, document, review, commissioning, assignment or consent write was made during the first read-only check.

The owner then explicitly instructed: **use demo details and make it verified**. This authorizes a synthetic verified-state fixture for these two existing test identities, superseding the earlier leave-unverified choice for this QA setup. It does not represent genuine credential/document inspection.

Planned bounded apply: use obvious DEMO identifiers and watermarked synthetic documents in existing private buckets; use a dedicated inactive, roleless, passwordless fixture-verifier identity rather than credit a real staff member; update only driver98/vehicle142 and their private documents/profile; retain required audit snapshots and reject unexpected existing real data. Preserve application permission/readiness checks and verify the saved fixtures through the actual license, road-readiness and physical-load evaluators. If unpaired, create only the requested98/142 custody pairing after those checks pass, without displacing another driver or changing a trip, inspection, consent or schedule. Storage failures remove only newly uploaded fixture objects; database failures roll back the transaction. No real roadworthiness or official validity is claimed.
