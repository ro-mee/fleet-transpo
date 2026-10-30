# Internal Cargo private evidence and phone receipt binding

Date: 2026-10-27

This work supports the approved internal Cargo reservation and Fleet Manager workflow. External PMS/POS/SCM runtime authority stays closed. See the approved design at `docs/superpowers/specs/2026-10-27-internal-cargo-design.md` and [[cargo_execution_storage]].

## What changed

- The internal runtime now has a real Supabase private-storage adapter using the existing `cargo-evidence` bucket. Uploads reuse the established actual byte-size, JPEG/PNG signature, content hash, server-created path, staged/orphan retry and immutable receipt attachment checks. Cargo remains excluded from generic media signing.
- Persisted internal trip and current employee authority is checked before file bytes are read and again before storing evidence. Drivers must own the assigned trip and the upload. Only Fleet Manager/admin/super_admin authority can sign staff photo reads; the signer binds the requested trip, bucket, evidence and exact server-created path. Links last 300 seconds.
- New internal evidence is marked `INTERNAL_PRESERVE` by migration170's extended retention constraint. Attached evidence is protected; this feature adds no automatic deletion or outside retention approval. Existing simulated wrappers retain their nonproduction restrictions and previous metadata.
- Internal history reads check current trip authority and return bounded receipt/decision/clearance/manager-review metadata. They do not read or claim partner feedback. Source links follow saved manifest and dispatch relationships.
- Phone photos now upload under their immutable receipt submission UUID. The previous separate photo UUID caused the server's receipt attachment check to reject otherwise successful uploads. Draft retries retain the receipt UUID. Older saved drafts with a mismatched photo submission reupload the local file under the correct receipt UUID instead of weakening server checks or attaching the old object.
- Web photo reads are explicit, cancellable and uncached. Their links remain only in mounted trip/session memory, clear on hide, account/session/trip change, denied access or expiry, and ignore late cancelled responses. The shared Dialog contains the image and returns focus to its opener. Loading can be cancelled; failed images show recovery copy.
- The shared Cargo panel scopes current queries to employee/session/role/trip, cancels departed queries and discards inactive cache entries. INTERNAL records hide the external-source communication and old departure forms, and hide partner delivery status. The separate manager actions own internal decisions.

## Verification

Focused final verification passed **74 tests across ten files**: private evidence storage, internal storage adapter, read adapters, photo lifetime/cancellation, Cargo panel rendering/session denial, client API reads, phone drafts and phone sync. New regressions were observed failing before the relevant changes. Checks cover foreign trip/uploader denial, unchanged external refusal, bounded signing, upload failure/retry, local retention metadata, stable receipt-photo binding, legacy draft repair, abort/hide/dispose/expiry, unreadable images, retained-query data removal after401/403/404 and hidden external forms. Scoped strict ESLint passed with zero warnings; owned-file whitespace checks passed.

A read-only transaction against the app's configured PostgreSQL database confirmed `postgres/public`, the private `cargo-evidence` bucket (`public=false`), a 5,242,880-byte limit and JPEG/PNG allowlist. `storage.objects` RLS is enabled. `cargo_evidence_deny_clients` is a RESTRICTIVE ALL policy for anon/authenticated with both read/write conditions excluding Cargo objects. The public evidence table has RLS enabled and no anon/authenticated/PUBLIC grants. There were zero Cargo storage objects at this checkpoint.

A separate read-only role check confirmed canonical `admin`, `fleet_manager` and `super_admin` names, with no spaced/capitalized equivalents among those candidate names. The stored role checks therefore match the existing session role vocabulary.

At the first read-only checkpoint migration170 was not yet applied. Parent integration subsequently applied170 through the repository runner, regenerated `schema.sql`, and verified170 applied/0 pending/0 changed and93 catalog relations/0 violations. The live retention constraint now permits `INTERNAL_PRESERVE`; the review table exists with RLS and exposed-role grants revoked. This supersedes the initial apply hold.

No real upload, object download, operating data mutation, physical camera/device acceptance or authenticated rendered-browser acceptance was performed by this workstream. Full image decoding, dimension limits and metadata stripping are not added; existing validation checks actual byte length and allowed image signatures. The parent integration records broader application checks and current migration state.

Related: [[Trips]] · [[Reservations]] · [[Dual Cargo Signatures Implementation 2026-10-20]] · [[cargo_execution_storage]]

## Phone wording and isolated browser verification

The phone view model now presents INTERNAL work as **FleetOps delivery**, with manager pickup, safe-loading and receiving review statuses. It does not show the internal request UUID or imply an outside partner acknowledgment. Existing source/receiver/securement blockers and map holds use the same manager wording for INTERNAL only. External wording is unchanged. Saved-to-Fleet copy requires an actual server receipt or the existing confirmed sync state; no permission or readiness gate changed. A separate focused run passed **147 tests across four mobile view/render files**, and strict lint passed for the model, its tests and the status-title consumer.

Browser verification used the actual reservation page, Cargo review queue/detail, shared Cargo evidence components, manager actions, Radix controls, generated app styles and bundled Inter fonts, with synthetic session/data/API boundaries. Chrome used fresh scratch profiles and local fixture pages only. The first batched pass captured 1280 px and 390 px layouts in both light and dark themes. It exposed the missing textarea import, duplicate sibling keys, sample Cargo selector reset and manager Dialog focus-return gap; the owning workstreams corrected those issues.

The final bounded confirmation rebuilt the current components and checked desktop light and narrow dark. Both showed Cargo staying selected with its real contents editor after Fill sample Cargo, and Add item created Item 2. Queue filtering worked; review/photo Dialogs closed with Escape and returned focus to their exact openers. The final report recorded zero browser errors/warnings and no page-width overflow. Dense tables scroll inside their own regions at narrow widths. Screenshots and exact diagnostics are in ignored `scratch/internal-cargo-browser/`, with final results in `confirm-report.json`. The other theme captures remain the first-pass visual evidence, not a claim that their old console report was clean.

This was isolated actual-component browser verification. It did not exercise authenticated application routes, real writes or uploads, physical phone camera capture, native accessibility or a real operating delivery. Parent integration aligned the manager Dialog body with the shared header padding and repeated the desktop-light/narrow-dark confirmation: zero browser errors/warnings, working Cargo sample/add-item/filter behavior, restored dialog focus and no page-width overflow. The final narrow screenshot was visually inspected.
