# Driver qualifications and cargo verification implementation plan

Prepared: 2026-10-09. Status: implementation in progress; qualification storage implemented, review pending. Cargo operating-owner approvals remain pending.

Implementation artifact: [15-task implementation plan](../../docs/superpowers/plans/2026-10-09-driver-qualifications-cargo-verification.md).

Roadmap: [[Driver Qualifications and Cargo Verification Roadmap]]. Scope uses exactly two groups: Passenger Driver for Guest/VIP and Cargo Logistics Driver for all three restaurant/hotel cargo services. Mobile UI must use Impeccable, UI UX Pro Max and High-End Visual Design.

The plan has four workstreams: qualification management/enforcement; manifest adapters and private cargo evidence; authenticated partner decisions, durable feedback and offline capture; web review, mobile UX, reporting and release acceptance. Tasks include exact paths, interfaces, failing-test steps, focused verification, migrations/security checks, documentation and focused commits.

Important source-derived correction: Start Trip begins travel to pickup. Do not block travel to a supplier on an as-yet-unperformed pickup count. Qualification and vehicle/pre-trip gates run at start; current receipt, source acceptance, Fleet clearance and post-load securement gate cargo loading/departure. Shared/legacy progress and direct completion routes must also enforce the relevant checkpoint.

Request cargo and SCM shipment allocation remain separate intake paths, projected into one execution view. SCM manifests are reused, not copied into passenger requests. Current supply assignment remains disabled until its existing owner-policy gates pass. Business quantity acceptance, transport clearance, receiver authority and inventory/order closure stay separate. Changed or repeated submissions are revision-bound and idempotent; offline capture cannot invent approval.

Verification performed for planning: read repository policy and relevant vault/owner notes; inspected installed packages, actual source paths/exports, existing trip transitions, machine authentication and offline queue; read installed Next route-handler guide; live read-only migration status reported 155 applied, 0 pending, 0 changed, with historical ledger-only 113/114/115. Self-review checked roadmap coverage, two-group consistency, source/quantity ownership, permissions, transaction boundaries and dependency order. Documentation whitespace checks passed. No migration was written/applied, runtime code changed, partner messages sent or implementation tests run.

## Execution checkpoint — 2026-10-09

The user authorized implementation. [Execution design](../../docs/superpowers/specs/2026-10-09-driver-qualifications-cargo-verification-design.md) records the confirmed product direction and disabled-development boundaries. The D01–D10 owner worksheet still has no approvals; no signatures, license/training, receiver authority or retention policy were invented. Sandbox-versus-live clarification is pending. Task 0's disabled-development documentation passed independent spec/quality review; external approval remains incomplete.

Native worktree was created but sandbox writes were denied, so the original feature-branch fallback is used. Unrelated maintenance/fuel edits are preserved. The initial full suite needed escalation due to Vitest dependency realpath denial; actual baseline result was 403 passing files/4,509 passing tests, six failing files/ten failing tests and five skipped files/17 skipped tests. Failures belong to existing fuel ThemeProvider and mechanic UI/count assertions; they are recorded in the task-local baseline log.

Qualification storage commit c8709a57 adds the canonical two-group evaluator, audited service, private schema and history. Migration 156 was applied with the repository runner and generated schema refreshed. The implementer reports 47 focused tests passing, including 13 real PostgreSQL tests; 79 classified live relations and zero contract violations. Both new tables refuse anon reads and have zero approval/event rows. The global anon probe still has 48 old inconclusive empty responses, resolved by the live contract; it is not described as a globally passing probe. Independent code review is pending. Enforcement remains off, with no roster approval or production policy configuration.
