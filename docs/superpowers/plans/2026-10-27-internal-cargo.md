# Internal Cargo implementation plan

> Implement the owner's approved design in this session, using independent owned-file workstreams and integration/review checkpoints.

**Goal:** Save internal Cargo reservations and item lists and support real driver observations plus Fleet Manager review through completion without another subsystem.

**Architecture:** Reuse the current manifest/receipt/state/evidence infrastructure. Add a trusted INTERNAL runtime and append-only manager records; preserve external/fixture boundaries. Reuse existing UI components and authorized APIs.

**Stack:** Installed Next.js16.2, React19, PostgreSQL/pg, Supabase private storage, Expo54 mobile, existing Zod/Vitest.

## Constraints

- Follow `.agents/AGENTS.md`, vault specifications and shared design system; UTF-8 only.
- No new package or framework upgrade; preserve unrelated mobile package/TypeScript changes.
- Use server-derived INTERNAL ownership and authenticated roles, never request-controlled approval identities.
- Keep external integration runtime closed; keep fixture wrappers restricted.
- Apply only new idempotent migration170 through db runner, never edit applied migrations or generated schema manually.
- No license/commissioning/physical-readiness bypass or invented operating proof.

## Tasks

- [x] **1. Intake:** extend `/reservations/new`, add authenticated `/api/reservations` and atomic internal request/manifest service. First failing tests prove Cargo save, schema validation, canonical IDs, same-key replay and rollback. Use `submission_id`, typed load/service/location fields and current Cargo editor line structure. Produce saved request/manifest identity; create no dispatch.
- [x] **2. Internal execution/reviews:** factor existing core from simulated wrapper, add INTERNAL provider, durable SOURCE/SECUREMENT/RECEIVER manager reviews and runtime/lifecycle selection. First failing tests prove internal GET initialization, authenticated roles, clean pickup requiring acceptance, counts/photo/signature persistence, review/version/assignment binding, receiving after submission, accepted delivery discrepancies, rollback and exact retries. Expose `reviewInternalCargo(tripId,input,session)` and internal-aware existing execution functions. Own migration170 and source/command constraints, audit linkage and private-table contract entries.
- [x] **3. Private evidence/mobile:** install internal-only actual storage/read adapters without weakening fixture factories, preserve private bucket policies, repair receipt/upload UUID binding, and scope private photo/query state to session/trip. First failing tests cover stable upload/receipt identity, foreign trip/image denial, signed-link expiry, hide/session cancellation and external503 preservation. Backend API uses the internal adapter exports; coordinate the single `cargo/api.js` owner.
- [x] **4. Manager workspace:** add session-authorized `/api/cargo-review` queue and `/api/trips/[id]/cargo/internal-review`, Cargo review page/detail actions, permissions and navigation. First failing tests prove only Fleet Manager/admin/super_admin can decide, dispatcher cannot, safe bounded queue projection and stale/retry errors preserve inputs. Reuse CargoVerificationPanel, shared forms/dialogs/table and explicit photo/signature reads. Use `reviewInternalCargo` with immutable command UUID, exact receipt/version, kind/action/reason/reviewed evidence/checks.
- [x] **5. Integration:** combine workstreams, review tests and guards, apply migration170 and dump, verify catalog/anon/bucket, run focused actual-DB lifecycle/evidence cases and broad checks, inspect rendered pages and restart the local test stack on the implementation branch. Update Cargo/Reservations/Trips/vault/SYSTEM with current behavior and exact results. Native/device and remaining authentic qualification prerequisites must be stated accurately.

## Review checkpoints

At each task verify failing-before/passing-after evidence and owned-file diff. Before completion review authorization, origin separation, immutable replay, private image handling and source/receiver/securement meaning together. Check fresh usage at task boundaries; at5% remaining save a concrete checkpoint and schedule the authorized same-chat continuation for two minutes after the actual reset, avoiding duplicates.

## Final verification

Implementation/local integration complete on codex/internal-cargo-testing. Final full suite: 6,750 passed, zero failed, 183 optional tests skipped; production webpack build, strict lint,345 guarded API methods,170 migration checks and encoding passed. Live ledger170 applied/0 pending/0 changed; catalog93 relations/0 violations. Independent final review found no concrete blocker. Browser fixtures and updated Android bundle passed; authenticated operating delivery and physical-phone acceptance remain pending genuine eligible fleet data. See the current vault checkpoint for exact evidence, local URLs and limitations. No merge, push or deployment occurred.
