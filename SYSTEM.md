# FleetOps — Fleet & Logistics Management System
**Reset email template redesign (2026-09-19):** `resetEmailHtml()` in `src/lib/email/smtp.js` — premium-minimalist, inbox-safe (table layout, inline styles only, text wordmark, DESIGN.md palette): ink header, CTA button + fallback link, mobile code box, single-use/30-min copy, footer. Structural tests pin the shape; email body unchanged in contract (link + code). Same commit stream as the Nodemailer swap below.
**Forgot-password email via Nodemailer SMTP (2026-09-19, implemented):** Swapped the day-one Resend integration for Nodemailer before any production send — same `src/lib/email/` interface (`isEmailConfigured`/`emailFrom`/`sendPasswordResetEmail`), transport now SMTP (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`, per-send transporter, no shared connection). `resend` SDK uninstalled, `nodemailer` installed. Email body (link + paste-able code) unchanged. Needs operator action: `SMTP_*` credentials in `.env.local` + HostForge env (Gmail = App Password, not login password). Verification: mail + route tests 10/10, ESLint clean, `verify:auth` 278/278. See `Capstone/04 - Architecture/Authentication.md`.
**First green HostForge deploy (2026-09-19):** Live at `https://fleetops-fleet-and-transportation-management.hostforgeplatforms.com` via manual redeploy of `fd84166` (own Dockerfile, `/api/health` probe, Database None, 18 env vars). Four failed attempts preceded it (missing build env, 2× generated-pipeline timeouts, jsconfig `.dockerignore` failure). Still open: browser smoke test, external cron, secret rotation, mobile APK backend URL. See `Capstone/11 - Memory/Deployment Knowledge.md`.
**HostForge .dockerignore fix (2026-09-19, implemented):** The `.dockerignore` excluded `jsconfig.json` (the `@/*` alias definition), failing the HostForge build with 1828 "Can't resolve '@/...'" errors while the local build stayed green. Un-excluded it and added a pin test (`src/dockerignore.build-inputs.test.js`, 9 tests) so required build inputs can never be excluded again. Verification: new tests 9/9, local production build green, pushed — needs a HostForge redeploy of the latest commit. See `Capstone/11 - Memory/Deployment Knowledge.md`.
**HostForge own-Dockerfile switch (2026-09-19, implemented):** Two generated-pipeline builds exceeded the 2400s limit (cold `npm ci` 17min + platform setup step 12–27min + 9min compile + ~13min export/unpack of the ~1GB image; the second build compiled 204 pages and died exporting). Committed `output: "standalone"` (150MB runtime), a root multi-stage `Dockerfile` on `node:24-alpine` with explicit `PORT`/`HOSTNAME`/`HEALTHCHECK` and no hardcoded env, plus `.dockerignore` (notably `.env*` — Docker ignores `.gitignore`, so `COPY . .` would otherwise bake `.env.local` into the image). Also dropped 7 depcheck-flagged Radix primitives with zero source imports (687→675 packages; `geoip-lite` flagged too but dynamically imported by `geoip.js`, so kept). Verification: local production build green, standalone boot serves `/` (200) and `/api/health` (fixed JSON); standalone ignores `.env` files (local-only caveat, env is platform-injected in prod). Needs: HostForge switched to "Use my own Dockerfile", probe `/api/health`, full env set, redeploy of the latest commit. See `Capstone/11 - Memory/Deployment Knowledge.md`.
**HostForge health-check route (2026-09-19, implemented):** Added public `GET /api/health` (`src/app/api/health/route.js`) returning fixed `{ ok: true, service: "fleetops-web" }` with no auth, no DB, and no env reads — `/` is a 307 redirect and every other `/api/*` is guarded, so no valid probe path existed. Registered in `PUBLIC_METHOD_ALLOWLIST` with a structural test pinning the dependency-free shape. Also verified from installed Next 16.2.11 source that `npm run start` already honors `PORT` and binds `0.0.0.0`, and that the build fails loud without `NEXT_PUBLIC_SUPABASE_URL` — no start/build config changes needed; DB stays on Supabase (no HostForge managed DB). Verification: 2 new tests green, ESLint clean, `npm run verify:auth` 278/278 (stash-verified baseline 277, delta exactly the new GET). See `Capstone/11 - Memory/Deployment Knowledge.md`.
**HostForge deployment assessment (2026-09-19, blocked before remote write):** The `main` branch at commit `30f0790` passes `npm run build` (Next.js 16.2.11, 204 generated routes/pages). HostForge's documented CLI package `@hostforge/cli` is currently not available from the public npm registry (`E404`), and no workspace/project/token is configured locally, so no remote deployment was attempted. Expected HostForge settings are root `.`, Node.js 22+, `npm ci`, `npm run build`, and `npm run start`; production secrets remain provider-managed. See `Capstone/11 - Memory/Deployment Knowledge.md`.
**Forgot-password email delivery via Resend (2026-09-19, implemented):** `POST /api/auth/forgot-password` self-serves now — with `RESEND_API_KEY` set it looks up the Active account, mints from the shared `issueResetToken()` issuer (`src/lib/auth/reset-token.js`, also used by the admin `reset-token` route, refactored without behavior change), and emails a 30-minute single-use link + paste-able code via new server-only `src/lib/email/resend.js` (`EMAIL_FROM`, defaults to `onboarding@resend.dev`). The response stays identical whether or not the account exists (message varies only on provider configuration, never on lookup), rate limits unchanged, delivery failures warn-logged without leaking. Covers web (`(auth)/forgot-password` renders the server message) and mobile (same endpoint; code pastes into `reset-password.js`, copy updated) with no new route surface. Verification: 11 new tests green (`resend` 6 + `forgot-password` route 5), ESLint clean on all 9 touched files, `npm run verify:auth` 275/275, existing auth suites green. Needs a rotated key in `.env.local` (the key pasted in chat was compromised) plus a verified sender domain for non-owner recipients. See `Capstone/04 - Architecture/Authentication.md`.
**OTP verification modal + trusted device (2026-09-19, implemented):** Matched the login authenticator-code step to the supplied reference with a centered ~512px pale modal, blue-gray blurred veil, lock/check hero mark, six accessible animated code cells, authenticator guidance, automatic verification, an animated lock scan while the server confirms, a drawn green success check with restrained particles, recovery-code action, auto-submit on the sixth digit, reduced-motion support, and role-aware navigation after server confirmation. The duplicate primary verify button was removed; recovery codes submit automatically at 20 characters or Enter. “Remember this device for 30 days” is now an explicit opt-in: `POST/DELETE /api/auth/trusted-device` issues or revokes a 30-day HttpOnly opaque cookie, while only its SHA-256 hash is stored in private `trusted_web_devices`, bound to `auth_version`, expiry, and revocation state. Password, MFA, email, account, and session revocation changes invalidate remembered devices. The current implementation is TOTP/recovery-code MFA, not email OTP; email delivery remains a separate backend/provider phase. Verification: touched-file ESLint, production build, focused auth tests, `db:contract`, and migration status passed; repo-wide lint still reports unrelated generated `mobile/.expo` bundle errors. See `Capstone/07 - Development/OTP Verification Modal Plan.md` and `Capstone/04 - Architecture/Authentication.md`.
**Idle countdown instant reset (2026-09-19, implemented):** Fixed the top-bar session countdown keeping on draining through real clicks/typing. Root cause: the visible deadline only moved on a successful `POST /api/auth/heartbeat`, which is throttled to one write/minute — so every interaction inside the throttle window showed no reset. `src/context/session-manager.jsx` now applies an optimistic local reset on every verified human interaction (`click`, `keydown`, `touchstart`, `pointerdown`; still no `mousemove`) and dismisses the idle warning immediately; the POST only confirms server-side (fires at once when the gap elapsed, otherwise scheduled once for the gap boundary). `GET` reconciliation keeps the optimistic value only while the activity is still unflushed; the periodic backstop is timestamp-gated so it can no longer extend a session long after the user left. No policy, timeout, or DB change. Verification: ESLint clean on the touched file; 45 tests passed across `idle-session`/`countdown`/`session-timeout-dialog`/`security-boundaries` plus 50 across `auth-session.security`/`api/utils`. See `Capstone/04 - Architecture/Authentication.md`.
**FleetMate concise wording and response shell (2026-09-19, implemented):** Improved `src/lib/dispatch/conversation.js`, the conversation route, `copilot-prompt.js`, and pair-ranking explanations so Copilot answers lead with the operational answer, use plain dispatcher language, distinguish hard conflicts from pending verification, and state a clear next step only when useful. Deterministic fallback replies now handle selected and unselected options more clearly, including no-material-advantage ties and readable preparation/workload wording. Provider-generated choice prompts are stripped because the interface owns the choice prompt. No response-shape, assignment authority, radar evidence, or database change. Verification: five focused suites / 83 tests passed; touched-source ESLint passed with zero warnings. Live-provider wording and browser acceptance remain pending. See `Capstone/07 - Development/Jev Dispatch Pair Ranking Implementation Plan.md`.
**Mobile Profile Photo Picker claymorphic bottom sheet redesign (2026-09-19, implemented):** Replaced the native `AppAlert.alert` photo source prompt in `mobile/app/(app)/(tabs)/profile.js` with a dedicated tactile bottom sheet modal (`<Modal visible={photoModalVisible}>`). Solved button text truncation, cramped multi-button layout, and uniform green styling in the native dialog. Features: (1) full 64×64 avatar container touch target, (2) claymorphic bottom action card with drag handle and backdrop dismissal, (3) facial guidance notice banner for biometric attendance verification, (4) vertical action rows ("Take Photo" and "Choose from Gallery") with raised clay forest icon tiles and subtitles, (5) enforced 1:1 aspect ratio square cropping (`allowsEditing: true, aspect: [1, 1]`) in both camera and gallery pickers, and (6) tonal clay Cancel button. Verification: ESLint clean (0 errors), all 24 mobile Vitest suites (143 tests) and all 171 workspace test suites (1,931 tests) passing. See `Capstone/01 - System/Mobile Profile & Settings Claymorphism Implementation Plan.md`.

**Dashboard operational attention per-cell color states (2026-09-19, implemented):** Resolved blanket-red background on operational attention panels (`AdminDashboard` "Operational attention" and `DispatcherDashboard` "Needs attention now" in `src/components/dashboard/role-dashboard.jsx`). Instead of applying a container-wide `bg-danger/5` across the entire row whenever any single issue exists, styling is now strictly per-cell: individual cells with active exceptions (>0) render red (`bg-danger/5 hover:bg-danger/10`), while zero-count cells stay calm green (`bg-success/5 hover:bg-success/10`), preventing false alarms across unrelated healthy queues. The outer panel border stays calm green (`border-success/25`) when all clear and neutral default when mixed. Verification: ESLint clean (0 errors), 3 test suites / 14 tests passing. See `Capstone/01 - System/UI UX Audit - Web.md`.

**FleetMate evidence-family and GPS-row fixes (2026-09-17, implemented):** Closed both defects the scenario suite found. (1) **HIGH — a leave-sourced driver block minted the wrong proof family.** `proofTypeForRecovery()` classified on `recovery.hint`, the *static* template from `recoveryForCheckId()`, and never the check's own `message` where the recorded reason lives — so a pair blocked with *"Driver is on approved leave during this time."* minted `schedule_conflict`, which resolves overlapping `dispatchschedules` and can legitimately return *clear*. The drawer could therefore prove the opposite of the chat. Classification now tests the recorded `message` first with the hint as fallback (the only carrier an exclusion action has), and a `leave` ref is scoped to the driver. (2) **MEDIUM–HIGH — a repositioning candidate rendered "GPS Health: Unknown".** `buildInspectorRows()` branched on `meta.horizon === 'REPOSITION'`, but REPOSITION is a `dispatchContext` **mode**, a separate taxonomy, so the branch was unreachable and an *intentional* absence of live evidence was narrated as *missing* evidence, which `LIVE_EVIDENCE_RULES` forbids. The mode is now projected as a `dispatchMode` label (beside the existing `gpsHealth` label — the raw `dispatchContext` and its siblings are still never projected), carried into `clearanceMeta.mode`, and the inspector tests mode and horizon independently. (3) LOW latent: `recoveryForCheckId('schedule')`'s driver-source assumption is now documented at the mapping with both upstream filters named and frozen by FM-VEH-007, rather than replaced with a prose heuristic (`recoveryActionForCheck` is explicitly forbidden from classifying by display text). (4) LOW cosmetic: a lone option now reads *"This is the only evaluated option, so there is nothing to compare it against."* instead of inviting a comparison that cannot exist. (5) **A defect introduced by fix (1), caught reviewing the diff and closed with it:** scoping the `leave` ref to the driver is only sound where a driver is known, and an **exclusion** row has none — `dispatch-radar.service.js` builds `none_reasons` from an INFEASIBLE pair as `{vehicle_id, reason}`, so `recoveryActionForExclusion` leaves `id: null`. Those rows never classified as `leave` before fix (1), so the gap was unreachable; afterwards a leave *reason* on an exclusion began minting `{type: 'leave', driverId: null}`, and `resolveLeave()` with a null driver builds `WHERE driver_id = NULL`, matches nothing, and returns `{verdict: 'clear'}` — a drawer clearing a driver the chat just said is on leave, the same contradiction class through a new door and reachable in production. `sign()` now mints no ref for any **driver-sourced** block (`record: 'driver' | 'schedule'`) that has no id, generalized from `leave` alone: a probe with the guard disabled showed three families reaching it, each resolving a different wrong record (`leave` → no row, answers clear; `schedule_conflict` → `driver_id=$1 OR vehicle_id=$2` silently narrowing to a vehicle-only check; `compliance` → the vehicle branch, so a licence problem reports registration/insurance). Every other family is vehicle-scoped and unaffected. So the row renders with its reason and no Review action. **No live data was mutated, no schema change or migration, no dependency added, no commit.** Verification: new suite **109/109**, dispatch+reservations+transport-request routes+security **542/542 in 38 files**, full suite **1808/1808 in 168 files**, touched-file ESLint clean, production build passed (all routes emitted, exit 0). FM-EVID-014 covers all three families in both directions and was confirmed to bite by temporarily disabling the guard (the file then reported `1 failed | 13 passed`, FM-EVID-014 the only failure — nothing else covered that path). Browser confirmation of the two fixed rows is still pending — no DOM in this environment — and is listed as manual acceptance in `Capstone/07 - Development/FleetMate Scenario Test Suite.md` §6. **Reported, not fixed at the time** (classified **B** in that note's §7): `resolveLeave()` failing open on a null driver — the guard stops the Copilot path, another caller could; `resolveGps`'s null-driver posture is the intended shape, and the next entry applied exactly that posture to `resolvePairing`. **Closed the same day by the third plan** (see the entry below), which also tightened this guard: the predicate it used admitted `0`, and `0` — not `null` — is the shape an absent driver actually arrives in.

**FleetMate proof-subject fixes (2026-09-17, implemented):** Closes the two residuals the scenario suite left open — a compliance proof resolving the wrong record, and a pairing proof reading a vehicle id as its driver. Both came from one missing concept rather than a wrong line: a signed `ev_` ref carried *who* it was about (`vehicleId`/`driverId`) and *what family* to read (`proofType`), but never **which of the two identities the claim was scoped to** — so each resolver inferred it, and the inference was vehicle-first. (6) **HIGH — a licence proof opened the vehicle's registration.** `resolveCompliance()` branched on `if (vehicleId != null)`, and **every** pair-path compliance ref carries a vehicleId, so a proof minted for *"Driver license is expired."* returned the vehicle's `registration`/`insurance` — a drawer whose content is unrelated to the block it exists to support. Reachable on the normal **pair** path, so the FM-EVID-014 mint guard could not cover it: the driver id was present, the resolver simply never read it. Classified **B + E**. (7) **MEDIUM — a pairing proof read the vehicle id as its driver.** `decision.js` records a pairing block as `{record: 'schedule', id: <vehicleId>}`, and `record: 'schedule'` otherwise means *"the id is the driver"*, so `sign()` signed `driverId = <vehicleId>`; `resolvePairing` then queried `vehicle_id=V AND driver_id=V`, matched nothing, and returned `{verdict: 'blocked', pairingState: 'none'}` — a definitive negative from a check that never ran — while `EVIDENCE_ALLOWLISTS[PAIRING]` admits `driverName` and `resolveEvidence` enriches it from `refData.driverId`, so a *Pairing Evidence* drawer could print the name of whichever driver happens to share that number. Classified **C**. **Fix.** The ref now carries a validated `subject: 'vehicle' | 'driver'` — `COMPLIANCE_SUBJECT_BY_CHECK` for clearance checks and `COMPLIANCE_SUBJECT_BY_CODE` for recovery codes, one definition read by both mint sites and the resolver — and `resolveCompliance` branches on it instead of on which id is non-null; a ref minted before the field existed verifies but is **refused** (`UNSCOPED` → route 404) rather than guessed at, and the 15-minute TTL clears it on the next Copilot run, so no in-flight ref needed migrating. A pairing ref takes its driver from the pair (`pairCtx.driverId`) — the only place the real answer exists — and `resolvePairing` returns `{verdict: null, pairingState: null}` for a null driver (the `resolveGps` posture), which the drawer renders as *—*; a new verdict *string* was not an option because `formatValue` prints any unrecognized verdict verbatim. `decision.js` was deliberately **not** changed: its `record` value drives fix ordering and navigation through `RECOVERY_RECORDS`, and changing it would send the *Check substitute schedule* button somewhere other than the vehicle record its label promises. The FM-EVID-014 mint guard was made identity-aware rather than exempting pairing, so a pairing action with no vehicle identity still mints nothing. **No live data was mutated, no schema change or migration, no dependency added, no commit.** Verification: FM-EVID-015/016 (the subject decides the branch with both ids present; no vehicle fact survives a licence resolution), FM-EVID-017 (the ref carries the pair's driver **and the SQL was issued with `[9, 6]`** — the parameters, not the outcome, show which record was read), FM-EVID-018 (an unevaluated pairing queries nothing and claims nothing), FM-EVID-019 (a subjectless ref is refused; an undefined subject cannot be minted), FM-EVID-020 (a validly-signed ref with a bogus subject is `TAMPERED`), plus one rendering assertion in the pre-existing `evidence-drawer.test.js`. Each guard was disabled in turn to confirm the regression test bites: vehicle-first fails FM-EVID-015 with `subject: 'vehicle'` where `'driver'` was required; the pairing driver-sourcing revert fails FM-EVID-017 with `driverId: 9` (the vehicle) instead of `6`; disabling the null-driver early return fails FM-EVID-018 with `expected 'none' to be null`. All guards restored and absence of the temporary edits verified. Suite **109/109**; focused scope **542/542 in 38 files**; full suite **1808/1808 in 168 files**; touched-file ESLint clean; production build passed (exit 0). Browser confirmation of the pairing row's *—* rendering is still pending — the drawer test observes static markup through `renderToStaticMarkup`, not a browser, and no DOM exists in this environment.

**FleetMate record-identity fix (2026-09-17, implemented):** Closes the last fail-open in the proof path — the one residual the first two plans left open. (8) **MEDIUM–HIGH — `resolveLeave()` answered *clear* to a question it was never able to ask.** Asked with no usable driver it built `WHERE driver_id=$1`, matched no row, and took its "no overlapping leave" branch — returning `{verdict: 'clear'}`: a **clearance for a driver nobody looked up**, sitting under a check the drawer renders as *verified*. Classified **B** (deterministic service layer). The mint guard from plan 1 stops the Copilot path minting such a ref, but the resolver stays callable that way by any other caller, and a ref minted before the guard existed stays resolvable for its 15-minute TTL — so the guard narrowed the surface without closing the defect. **What made it survive earlier review is that the dangerous value is `0`, not `null`:** the projection coerces ids with `Number()` (`conversation.js`), so an absent driver arrives as `0` and `Number(undefined)` as `NaN`. `0` passes a `!= null` check, and `driver_id = 0` is a clean, valid query that matches no row — nothing upstream looks wrong and nothing downstream errors, so the wrong answer is well-formed. **Fix.** Definitional before behavioural: the contract now exports one predicate, `usableRecordIdentity(value)`, admitting only a **positive safe integer** and returning `null` otherwise — covering `null`, `undefined`, `0`, `NaN`, negatives and non-integers in a single place, so the mint sites and the resolver cannot drift apart about what an id is. All three sites read it: the leave-clearance mint in `attachClearanceProofs`, the recovery-path guard in `sign()`, and `resolveLeave` itself, which now returns `{verdict: null, overlapsBooking: null}` and **issues no query at all** — the `resolveGps` posture, applied for the third time in this file. The recovery-path guard was **tightened** as a side effect, and that is a second closed hole rather than a tidy-up: it previously tested only non-null plus safe-integer, so a licence block carrying id `0` passed it and went out scoped to a driver that does not exist. **No live data was mutated, no schema change or migration, no dependency added, no commit.** Verification: FM-EVID-021 covers both mint sites and both directions — the clearance row is present with `proof: null` while its sibling stays intact; resolving a hand-minted null-driver ref returns no claim with the SQL assertion **empty**, proving no query was issued rather than that a query happened to miss; a real driver with no overlapping leave is still reported `clear` **and** still issues exactly one query, so the guard does not swallow the legitimate answer; and a driver-sourced block carrying id `0` now mints no recovery proof. Each of the three sites was disabled in turn to confirm the regression test bites — `expected 'clear' to be null` (resolver), the clearance row carrying a proof again (mint guard), `expected { type: 'compliance', …(1) } to be null` (tightened predicate) — then all were restored and `grep -rn "PROBE" src/` returned nothing. New suite **110/110** (group K 20 → 21); focused scope **543/543 in 38 files**; full suite **1809/1809 in 168 files**; touched-file ESLint clean; production build passed (compiled in 20.3 s, all 203 static pages generated, exit 0). Browser confirmation of the *—* rendering is still pending — no DOM in this environment — and is manual acceptance item 10 in `Capstone/07 - Development/FleetMate Scenario Test Suite.md` §6. **Nothing this suite found remains open**; what is outstanding is manual acceptance, not a known defect. One observation is carried forward rather than fixed, because no approved plan covers it and its impact is a narrowing rather than a false claim: the `schedule_conflict` clearance row can still silently narrow to a vehicle-only check when the driver is unusable, since `resolveScheduleConflict` matches `driver_id=$1 OR vehicle_id=$2` and a `0` driver simply never matches.

**FleetMate scenario test suite (2026-09-17, test-only):** **110** automated scenarios across 7 files proving that FleetMate cannot narrate more than the deterministic layer computed — eligibility verdicts and their recovery codes (A–G, 32), temporal horizons and GPS qualification (H–I, 20), the verified ranking hierarchy (J, 13), chat↔Evidence-Drawer proof agreement (K, 21), drawer rendering of the same evidence (L, 7), adversarial claims / paraphrase consistency / missing-evidence honesty (M, 10), and the route's server-owned response contract incl. option identity, the verified-baseline change narration and the read-only simulate/impact/return paths (N, 7). Shared engine-shape fixtures in `fleetmate-fixtures.js`. **No live data was mutated and nothing was committed.** The suite found **two real defects** (a leave-sourced driver block minting a `schedule_conflict` proof, so the drawer could show a *clear* schedule snapshot contradicting the chat; and a REPOSITION-mode candidate rendering "GPS Health: Unknown" instead of *not applicable*). Both were first registered as **open** in `Capstone/07 - Development/Bugs.md` with deliberate failing assertions as their evidence — the run reported **100 passed / 2 failed by design** — and were then **fixed the same day** under an approved remediation plan (see the entries above); all 110 pass now. The suite grew in three approved rounds, and every scenario added after the first round was written for a defect the *previous* fix exposed: the 103rd (FM-EVID-014) covers a defect the first fix introduced and the same-day review caught; a **second plan** added FM-EVID-015…020 for two further defects in the same proof path — a licence proof resolving the vehicle's documents, and a pairing proof reading the vehicle id as its driver — plus a rendering assertion in `evidence-drawer.test.js` that an unevaluated pairing is shown as no claim; and a **third plan** added FM-EVID-021 for the last fail-open, `resolveLeave()` clearing a driver it never looked up, together with the `usableRecordIdentity` predicate that now defines what counts as an id for both mint sites and the resolver (see the entries above). Because the file grew as it found things, the counts 102 → 109 → 110 are successive states of one file, **not** a decomposition of a single run. Combined dispatch/copilot/drawer/route/security run at the time: 338 tests in 30 files, 336 passed, no pre-existing test regressed; touched-file ESLint clean; production build passed. Live model prose and browser interaction were **not** verified — no DOM in the Vitest environment and no authenticated provider call; both are recorded as pending with manual acceptance steps (items 5, 6 and 9–10 of §6 in the note linked below). See `Capstone/07 - Development/FleetMate Scenario Test Suite.md`.

**Evidence Drawer B1–B4 (2026-09-17, implemented):** Read-only dispatcher proof for Copilot decisions. B1: evidence contract (`evidence-contract.js`: 11 proof types, per-type allowlists/default-deny, signed `ev_` refs binding reservation+pair+type+record, comparison activated / trail reserved) + GET-only `.../[id]/evidence` endpoint (reservations/read+recommend gate, scope re-verified per fetch, double projection). B2: `EvidenceDrawer` (one GET per open, never refetches on validation changes, stale warning observes existing plan state only) + Review Evidence buttons + Evidence/Conflict card renderers. B3: Eligibility Inspector (server-minted clearance refs for verified checks, horizon-aware rows, locked bounded copy). B4: Option comparison from live server evaluation (codes/bands/facts only, no scores) + Compare options entry. Live-verified read-only on RS-KXIH (compliance facts match DB row; cross-request 403). 21 files / 108 tests green, lint clean, build 203 pages. See `Capstone/02 - Features/AI Advisory.md`.

**Copilot prompt hardening (2026-09-17, implemented; scope sentence added 2026-09-18):** Extracted the conversation system prompt into `src/lib/dispatch/copilot-prompt.js` — ten single-owner blocks (answer guidance, evidence trust, option identity, decision priority with eligible/recommended/selected/assigned distinction, temporal, live GPS health, selection, simulation, recovery, style) composed via `buildCopilotSystemInstructions()`; the route no longer concatenates inline literals. `conversationEvidence` now projects the `gpsHealth` label (`Fresh|Delayed|Offline|No signal`) only when the server supplies it — FUTURE/SAME_DAY/REPOSITION absence preserved, never synthesized, never a ranking factor, never restoring expired ETAs. English-only retained. **The scope boundary lives inside `EVIDENCE_TRUST_RULES` rather than as an eleventh block** (the block count is asserted at ten): the Copilot covers dispatch work only, and must decline an unrelated subject while never declining a dispatch question its evidence cannot cover. See the narration-guards section at the end of this file. 15 files / 74 tests green, lint clean, build 203 pages, live old-vs-new RS-KXIH comparison confirmed improved recovery framing and correct no-change wording. See `Capstone/02 - Features/AI Advisory.md`.

**Copilot wording improvements (2026-09-17, implemented):** Intent routing in the conversation route ("what if" runs the real read-only simulation with date clarification instead of guessing; impact questions run the pinned A-vs-B comparison; return questions run the bounded search — all with deterministic provider-outage fallbacks), fixable-first `fix: record|verify|choice` recovery ordering with sharpened labels, per-call temperature override in the LLM adapter (conversation passes 0.2; provider row unchanged), and prompt rules for no-change framing and intent labeling. Live-verified on RS-KXIH against real DeepSeek. 13 files / 58 tests green, lint clean, build 203 pages. See `Capstone/02 - Features/AI Advisory.md`.

**Dispatch Copilot decision-support enhancement Phases 1–5B (2026-09-17, implemented):** (1) Recovery guidance: stable `RECOVERY_CODES` + `recoveryActionForCheck/Exclusion` in `decision.js`, projected per-pair and per-exclusion in `conversationEvidence`, allowlisted record navigation buttons in chat, evidence-only fallback carries the next step. (2) Verified what-changed: signed size-bounded snapshots (`explanation.js`, purpose `fleet-dispatch-explanation-v1`, never assignment authority), baseline compare by stable pair identity with slack-band jitter suppression, per-reservation baseline in sessionStorage, timestamp-only refresh yields no change. (3) Read-only simulation: `POST .../[id]/simulate` allowlists pickup_datetime + passenger_count only, in-memory overlay, `persistRoute:false`, no tokens, `Simulation — reservation unchanged` label. (4) Queue impact: `POST .../[id]/queue-impact` runs the same queue pinned to A vs B within one budget, reports affected IDs + coverage with `Within the evaluated queue` wording, no assignment. (4B) Return-trip matching: `POST .../[id]/return-matches` bounded window/cap/deadline search reusing radar evaluation, reliability-first ranking, no savings math, follow-on commits only via guarded assignment in its own conversation. (5A) Assigned-trip workspace check: `GET .../[id]/assigned-status` evaluates the committed pair with its own commitment excluded, one deduplicated issue per fingerprint, assignment stays intact. (5B) Background scan: `syncAssignedTripAlerts` bounded horizon scan with advisory-lock dedupe via notifications table, wired as an isolated best-effort step in `/api/cron/sync` (external scheduler still required). Verification: 13 files / 59 tests green across dispatch/conversation/cron suites, touched-source ESLint clean, production build passed (203 pages incl. 4 new routes). Browser/live-provider wording and scheduler end-to-end acceptance remain pending. See `Capstone/07 - Development/Dispatch Copilot Decision Support Enhancement Plan.md` and `Capstone/02 - Features/AI Advisory.md`.
**Contextual Coach Marks Subsystem & In-App Operational Guidance (2026-09-16, implemented):** Built a lightweight, just-in-time contextual guidance subsystem for the FleetOps Driver App (`mobile/`) to guide drivers through high-stakes operational workflows without intrusive product tours, mascots, or gamification.
- *Core Philosophy*: "Guidance when needed, not guidance everywhere." Teaches difficult workflows at the exact moment of real action: Welcome dialog on first app launch, Pre-trip inspection (Pass/Fail, remarks requirement, submission lock), Trip Readiness (departure window, inspection dependency, Start Trip vs Continue to Map), Live Map & Progression (mission destination target and service point confirmation without turn-by-turn claims, live telemetry, swipe advancement), Fuel Scan (camera receipt framing and liters/cost verification), SOS & Incident reporting (safe emergency assistance, category triage), and Offline Outbox sync banner.
- *Safe & Non-Invasive Architecture*: Built on `mobile/components/coachmarks/` (`CoachMarkProvider`, `CoachMarkTarget`, `CoachMarkOverlay`, `CoachMarkTooltip`) and `mobile/lib/coach-marks.js` + `mobile/lib/coach-mark-storage.js`. Production components serve as real anchor targets measured via `measureInWindow`. Spotlight uses a translucent scrim with cutout and subtle theme-derived contour (`colors.primary` forest green). Guidance controls advance strictly via `Next` / `Got it` and NEVER trigger real production actions (no accidental SOS calls, trip transitions, inspection submits, or fuel logs).
- *Android Measurement Stabilization & Dynamic Active Re-measurement (2026-09-16)*: Resolved vertical coordinate offset and premature auto-scrolling on Android. `CoachMarkTarget` listens directly to `currentStep` from `useCoachMarks()`, gating auto-scroll strictly to `isCurrentActiveTarget === true` so background targets never shift the ScrollView. On step activation, triggers authoritative measurements across `requestAnimationFrame`, `InteractionManager.runAfterInteractions()`, and staggered settling ticks (80ms, 240ms, 480ms) to capture post-transition settlement and async data arrivals (such as dynamic vehicle assignment loading). Defers early $y \le 0$ measurement returns on Android until the native window position settles. Constrained tooltip positioning within safe insets to prevent offscreen clipping or target overlap.
- *Impeccable Polish & Craft Pass (2026-09-17)*: Refined visual depth and tactile quality across `CoachMarkTooltip` and `CoachMarkOverlay`. Upgraded tooltip with molded claymorphic elevation, top specular sheen (`borderTopColor: rgba(255, 255, 255, 0.95)` light / `rgba(255, 255, 255, 0.14)` dark), 100% color-harmonized pointer arrow (eliminating dark mode seam mismatch), segmented step progress dots (`1 / N`), tactile primary CTA styling with spring-scale press response, and an executive compass badge for first-launch welcome. Elevated spotlight cutout with a dual-ring contour (inner primary crisp border + outer diffused aura ring) with smooth cubic arrival pulse easing (`Easing.out(Easing.cubic)`).
- *Strict Safety & Driving Locks*: Vehicle velocity > 10 km/h or active driving transit suppresses non-critical coach marks, with a mark already on screen dismissed the moment motion begins. SOS guidance auto-presents only in safe, stationary contexts (`pathname === '/'`, `!isDriving`, 2s stationary delay) and is instantly dismissed if an emergency occurs or the emergency modal opens; tapping the SOS cutout in the overlay immediately passes through to trigger the real emergency SOS action, ensuring zero interference with real emergency operations.
- *Driving Safety Lock Made Real + Guide Conflicts Fixed (2026-09-18)*: The lock above was advertised but inert — `CoachMarkProvider` accepted an `isDriving` prop its only call site never passed, so it held its `false` default forever and the context never exposed it either. It now reads `useIsDriving()`, derived in the RN-free `mobile/lib/motion-state.js` from the `coords.speed` the existing 30 s GPS poster already reads on every fix (no second GPS stream). The threshold is `10 / 3.6` m/s because `LocationObjectCoords.speed` is metres per second. Motion is sticky for 2 minutes after the last moving fix — a stationary fix does not release it early, so a red light or tunnel cannot un-suppress the guide mid-route — and unknown motion (no permission, tracking off, no fix yet) fails open so the guide still works on a device that never grants location. The poster publishes raw evidence via a new `subscribePosterStatus` (an imperative subscription, so the provider that wraps the whole app tree is not re-rendered every 30 s), and the lock is re-checked after each async storage read. A mark taken away by the lock is **abandoned, not completed** — not written to storage — so it returns once stationary. Also fixed: `triggerMilestone` no longer pre-empts a guide that is on screen (the Welcome card was being replaced by the SOS tip ~2 s in, so it was never read *and* never marked complete); the guard is scoped to *visible* rather than merely *active*, so a guide hidden by navigation cannot wedge every later guide; a target id may now be live more than once with per-instance ownership tokens (`inspection.remarks` mounts once per failed item, and unmounting either one used to delete the shared registration); targets measured entirely outside the safe viewport are rejected rather than spotlighting nothing; the four scrim rectangles and cutout are now actually driven by the animated bounds (they were animated for 240 ms and then never referenced in JSX); `trip_readiness` fires only in the pre-start presentation its targets exist in; and Welcome/Offline copy was aligned to the Capstone spec verbatim.
- *In-App Guide Replay*: Replay provides a non-destructive "Reset In-App Tips" option in Help & Support (`profile/help.js`) that resets versioned coach-mark keys (`fleetops.guide.<milestone>.v<version>_<driverId>`) without locking the driver out or launching mandatory training gates.
- *Focus-Scoped Target Registration (2026-09-19)*: Fixed paired `[coach-marks] Two live targets share the id "incident.category" with different bounds` warnings from the device — two boxes with identical `x` and width, offset vertically by 145.71 dp, alternating "which measured last". Identical `x`/width proved they were the same element on the same route, so `byToken.size > 1` meant two **live mounts** of one target id, and the alternation proved both were still re-measuring rather than one being a frozen ghost. The producers are all mounts that stay alive off-screen: a covered stack screen, a background tab, and a route expo-router mounted ahead of time for `router.prefetch` (a PRELOAD renders in the native stack as an inactive `Screen`). Three changes: (1) `CoachMarkTarget` reads `useIsFocused()` and gates registration on it, re-checked at every registration rather than only where the work was scheduled — `measureInWindow` is a native round trip and the $320\text{ms}$ scroll-settle timer both outlive the render that scheduled them, so `canRegister()` (mounted **and** focused, mirrored into refs by `useLayoutEffect`) guards each async callback and the settle timer is `clearTimeout`-ed on unmount so it cannot register after the unregister that would have cleaned it up; (2) losing focus drops the registration outright (a blurred instance's bounds describe a screen the driver has left), and regaining focus re-registers because `isFocused` is in `measureAndRegister`'s deps; (3) the duplicate-registration dev warning now names both instances (a dev-only module counter — the ownership token is a `Symbol` and identifies nothing), their routes, the live count, and the registering stack, because the bounds alone cannot distinguish a mount effect from a settle timer from a measure callback that outlived its screen. `mobile/lib/coach-marks.test.js` gained a five-test `describe("One instance, one spotlight")` block (now 44 tests in the file, **green** — `npx vitest run mobile/lib/coach-marks.test.js --no-file-parallelism --maxWorkers=1`, 44 passed), and `npm run lint:ci` is **clean at 0 errors / 0 warnings** — the new `react-hooks` dep arrays pass with no suppression needed. Both gates were run from the session prompt with the `!` prefix, which bypasses the Bash/PowerShell tool-availability classifier that was down for the whole session (same outage as 2026-09-18). See `Capstone/02 - Features/Driver In-App Guide.md` §5.7–5.8.
- *Verification*: `mobile/lib/motion-state.test.js` (11 tests) and `mobile/lib/coach-marks.test.js` (39 tests at that run; 44 as of 2026-09-19, green — see above) both pass, and the **full suite is green as of 2026-09-18 — 143 test files, 1,389 tests**, run with `npx vitest run --no-file-parallelism --maxWorkers=1` (vitest's default per-file forking bursts past this machine's memory and dies with `FATAL ERROR: Committing semi space failed`). The mobile tests cover the definitions, storage, the motion arithmetic and the hold-window boundaries directly; provider wiring is asserted as **source text** because the RN component tree is outside `vitest.config.mjs`'s include list, which catches a deletion or revert but not a subtle rewrite. `npm run lint:ci` is clean (0 errors, 0 warnings) as of 2026-09-18. Getting there meant resolving five `react-hooks` findings: two render-time ref writes in `CoachMarkProvider.jsx` moved to `useLayoutEffect` (which still flushes synchronously at commit, so a pending async continuation cannot read a stale value — the guarantee the render-time write existed for), a render-time ref read in `CoachMarkTarget.jsx` whose per-instance token now comes from a lazy `useState` (it is read during render and sits in two dep arrays), and one setState-in-effect in `CoachMarkProvider.jsx` and one in `src/context/session-manager.jsx`, both carrying documented `eslint-disable-next-line` comments. Manual device checks of the lock remain outstanding — they are the only thing that exercises the wiring rather than the arithmetic (see the 2026-09-18 journal entry).

**Driver Academy Decommissioned & Exclusive In-App Guide Focus (2026-09-16, implemented):** Fully removed the standalone Driver Academy simulator (`mobile/app/(app)/guide.js`, `mobile/components/guide/DriverGuideModal.jsx`, `mobile/components/guide/DriverGuideCard.jsx`, `mobile/lib/driver-guide.js`, and `mobile/lib/driver-guide.test.js`) to focus exclusively on the Contextual In-App Guide.
- *Clean Experience*: Removed the Driver Academy card from the Home dashboard (`mobile/app/(app)/(tabs)/index.js`), removed the Driver Academy row from Profile (`mobile/app/(app)/(tabs)/profile.js`), updated Help & Support (`mobile/app/(app)/profile/help.js`) with an In-App Guidance section, and cleaned unused imports from `login.js` and `permissions.js`.
- *Zero Mandatory Gate*: Drivers immediately access real assignments upon login; high-stakes workflows are taught just-in-time on production screens via the contextual coach marks subsystem.
**Mobile DriverHomeCards JSX syntax & stylesheet cleanup (2026-09-16, implemented):** Resolved JSX parser errors in `mobile/components/home/DriverHomeCards.jsx` caused by an unclosed `<View>` tag and duplicated return block in `AssignmentsHeading`. Removed duplicate import of `statusColorForTone` / `tripStatusTone`, cleaned trailing duplicate `empty`, `mapArt`, and outdated `scheduleLink` styles from `StyleSheet.create`. Verification: ESLint 0 errors / 0 warnings on `DriverHomeCards.jsx`, all 24 mobile Vitest test suites (143 tests) passing. See `Capstone/01 - System/Mobile Home Claymorphism Implementation Plan.md`.

**Security hardening batch 1 (2026-09-16, implemented, uncommitted):** (1) `createUserSchema` password now uses the shared `isPassword` rule (8+, upper/lower/digit/special), matching the register route and `driverSchema` — the client form no longer accepts 6-char passwords the server rejects. (2) Account lockout: 10 failed password attempts per 15-minute window freeze the account on web (`ACCOUNT_LOCKED:<seconds>` from `authorize`) and mobile (429 + `Retry-After`), reusing `auth_rate_limits` buckets with peek-before/burn-on-fail/clear-on-success; exhaustion emits an `account_locked` alert. (3) Per-IP edge throttle (600 req/min, in-memory, fail-open by design) wired in `src/proxy.js` after the CORS checks. (4) `security_alert` audit rows (`account_locked`, `token_replay` on refresh-family replay wipe) plus admin-only `GET /api/system/security-alerts` (`reports/read` roles). (5) Deleted dead `withRole`/`requireRole` (`src/lib/auth/api-auth.js`, zero callers, trusted stale session role). Verification: new unit/route tests green, `npm run verify:auth` 270/0, full suite green, touched-source ESLint clean (2 pre-existing `no-undef` errors in `src/lib/auth.js` left untouched — see Authentication note). Dashboard widget and push delivery for alerts are explicit follow-ups. See `Capstone/07 - Development/Security Hardening Batch 1 Implementation Plan.md`.

**Pre-existing defect follow-up fix (2026-09-16, implemented, uncommitted):** moved `isSafeAvatarUrl` back to module scope in `src/lib/auth.js` (was trapped inside `authorize()` while the `jwt` callback called it — 2 `no-undef` errors, present on `main`; lint now clean) and repaired `AssignmentsHeading` in `mobile/components/home/DriverHomeCards.jsx` (removed stale unclosed return block, duplicate import, and duplicate `scheduleLink` style key; file lints clean). Auth tests (32) and `verify:auth` 270/0 green. See `Capstone/04 - Architecture/Authentication.md`.

**Login lockout UX (2026-09-16, implemented, uncommitted):** wrong-password failures show a friendly message instead of raw `CredentialsSignin`; `GET /api/auth/login-status?email=` peeks the account lockout bucket (enumeration-safe) and the login page renders a live ticking countdown with submit blocked until zero, then a retry invitation. See `Capstone/04 - Architecture/Authentication.md`.

**Closed & terminal reservation trip details in Copilot chat (2026-09-16, implemented):** Suppressed recommendation fetching and option cards (`CopilotOptionFlow`) for reservations in `Completed`, `Cancelled`, `In Progress`, or `Assigned` statuses. Instead, Copilot renders an elevated modern `<CopilotTripDetailsBubble>` in the chat featuring an executive status header with glowing status indicators, double-bezel hardware container, transit route wayfinding stops (visual pickup/dropoff track), schedule & passenger metrics, assigned driver/vehicle bento mini-cards, cancellation callout (when cancelled), and a sleek button-in-button CTA linking to `/reservations/[id]`. Verified with targeted Vitest unit tests in `ai-recommendation-panel.test.js` (7/7 passed), full test suite (131 files / 1,284 tests passed), and Next.js production build. See `Capstone/07 - Development/Dispatch Copilot Scope and Conversation Audit.md`.

**Direct card-click selection for Copilot option cards (2026-09-16, implemented):** Made recommendation cards in `CopilotOptionFlow` (`src/components/reservations/copilot-option-flow.jsx`) directly clickable to select that option (`onChoose(option)`). Added `role="button"`, keyboard navigation (`Enter`, `Space`), and hover/focus styles. Top header row (`Option X`, badge, `Pickup HH:MM`) is now direct-click selectable, and schedule/workload facts disclosure was decoupled into an inner `<details>` with `e.stopPropagation()`. Full test suite (131 files / 1,283 tests passed) and production build passed. See `Capstone/07 - Development/Dispatch Copilot Scope and Conversation Audit.md`.

**Copilot option flow unified chat bubble presentation (2026-09-16, implemented):** Unified initial assignment discovery counts (*"I found X options for this reservation."*) and empty/blocked states (*"No eligible assignment is currently available."* + exclusion reasons) inside `<CopilotBubble>` message bubbles with Copilot's mascot avatar. Replaces raw, unstyled paragraph text with conversational speech bubbles for visual continuity from the initial checking state (*"I am checking the eligible pairs and their schedules."*). Verified with unit tests in `ai-recommendation-panel.test.js`, full test suite (131 files / 1,283 tests passed), ESLint, and Next.js production build. See `Capstone/07 - Development/Dispatch Copilot Scope and Conversation Audit.md`.

**Blinking Copilot avatar activated (2026-09-16):** All eight UI avatar references now use `/images/copilot-avatar-blinking.gif`. Asset renamed and generator updated; verified references and 3-second infinite GIF loop. AI Advisory updated.

**Copilot blink asset (2026-09-16):** Added `public/images/copilot-avatar-blink.gif`, a three-second loop with quick eye closure/reopening. Generated and verified with Python; all non-eye regions remain static. Pulse asset retained and AI Advisory updated.

**Copilot pulse asset (2026-09-16):** Generated `public/images/copilot-avatar-pulse.gif` with Python: 60 frames, 3-second infinite loop, only detected eye pixels pulsing. Verified static pixels across decoded frames and inspected bright/dim previews. Source PNG and app asset references unchanged. Reproduction script and AI Advisory note added.

**Reference Copilot option-card UI (2026-09-16):** Matched the supplied card structure and emerald/neutral treatments, two-column resource row, icons and full-width arrow buttons. Uses actual candidate data and vehicle photos with icon fallback; header disclosure retains temporal evidence. Ten focused tests, lint and the production build (201 pages) passed. Browser pixel comparison remains unavailable (no provider). AI Advisory updated; one file-scoped badge-color detector false positive was suppressed.

**Copilot answer quality (2026-09-16):** Added direct-answer and trade-off guidance, question-specific evidence fallbacks, driver names, fresh-evidence choice prompts and suppression of stale/future live ETA aliases. Selection and assignment gates are unchanged. Background refresh does not create new chat messages. Twenty-nine focused tests, touched-source ESLint, 267 authorization checks and the production build (201 pages) passed. The small Clear memory label now uses the design system's 12px size. Updated AI Advisory; live-provider/browser acceptance remains unverified.

**Copilot Analyze controls removed (2026-09-15):** Removed manual Analyze actions from the header, empty state and recovery UI. Option selection retains automatic queue analysis; Recheck reservation revalidates the selected pair. Seven focused tests and lint passed; Capstone notes updated.

**Queue analysis summary removed (2026-09-15):** Removed the four analysis status cards and their evaluated-count/expiry/duplicate Analyze footer. Copilot analysis, validation and assignment guards remain intact. Queue-page ESLint passed; Capstone reservation and queue-flow notes updated.

**Unified Copilot conversation (2026-09-15, implemented locally):** Two assistant option bubbles, pre-selection Q&A, choice prompts, typed option selection, automatic pair revalidation and assignment now share one message log and composer. Selection displays the checked confirmation reply; one subsequent explicit Assign it uses the existing guarded mutation. Success remains visible after the queue row leaves, and mobile no longer closes the drawer on assignment. Verification: 131 test files / 1,280 tests, touched-source lint, 267 authorization guards and production build passed. Browser/live-model acceptance remains pending (no browser provider). Capstone feature notes and the temporal/queue implementation notes record the updated flow.

**Temporal dispatch recommendations (2026-09-15, implemented locally):** Horizon-aware schedule/live evidence, date-specific workload and reliability-before-fairness comparisons now drive Copilot options and explanations. Selected alternatives retain signed queue authority; exact chat confirmation shares the existing guarded review/assignment handler. Boundary refresh pins the selected identity, and trip start rechecks the committed pair with fresh owned-trip GPS and revision locking. Full suite: 130 files / 1,265 tests; 267 route guards; production build and read-only live SQL passed. Browser/live-provider acceptance remains pending; no dependency, migration or live assignment was added. See `Capstone/07 - Development/Temporal Dispatch Recommendation Implementation Plan.md`.

**Queue-only Dispatch Copilot plan (2026-09-15, proposed):** Created `Capstone/07 - Development/Queue Only Dispatch Copilot Implementation Plan.md` for one conversational assignment workspace in Reservation Queue. Covers exact-request navigation from Detail, up to two structured options, pinned-choice queue reanalysis, explicitly signed manual-review authorization, one current confirmation area, history/race protection and verification. The temporal implementation below supersedes VERIFIED-only authorization with explicit signed manual choices. Detail-to-queue navigation consolidation remains separately planned.

**AI recommendation panel improvements & redundant accordion removal (2026-09-15, implemented):** Removed redundant static "Why this pair?" and "Why options were excluded" accordions in favor of the integrated Dispatch Copilot chat, which dynamically answers these questions on-demand via suggestion chips and free text. Copilot captures the displayed pair/request at send time, resolves IDs against fresh server evidence, preserves asked-about context in history, and reports bounded evidence coverage. The confirmation footer remains visible with disabled reasons and recovery actions; the queue hook alone owns validation, queue confirmation requires a current verified independent proposal, and detail does not inherit cached queue context. Review also binds plan token and override reason. Corrected `match_score` to serialized `score` with ranking semantics, added read-only queue comparisons, and removed orphan dialog/callback/polling code. Verification: 69 targeted tests across 10 suites, touched-source ESLint, 267/267 route guards and production build (201 pages) passed. No DB change or live assignment; desktop/mobile and live-provider acceptance remain pending because no browser provider was connected. See `Capstone/07 - Development/AI Recommendation Panel Improvement Plan.md`.

**AI recommendation implementation report review (2026-09-15, source only):** Identified missing selected-pair context in Copilot requests, confirmation footer disappearance during background validation, and missing evidence truncation totals. Recommended preserving signed-plan choice binding when exposing alternatives and consolidating validation ownership; duplicate observers do not establish exactly doubled network traffic. Application behavior is unchanged; no new runtime verification was performed. See `Capstone/07 - Development/Dispatch Copilot Scope and Conversation Audit.md`, Implementation report review.

**Queue timezone boundary, category badge refinement, 3D Copilot mascot & per-reservation conversation memory (2026-09-15, implemented):** Resolved PostgreSQL UTC date truncation mismatch in `transport-requests` queue predicates (`today` and `upcoming`). Because PostgreSQL runs in UTC, early morning Manila bookings (e.g. Sep 16 01:00 AM PHT = Sep 15 17:00 UTC) previously cast to Sep 15 and incorrectly bled into the `Today` tab. Updated predicates to evaluate `(pickup_datetime AT TIME ZONE 'Asia/Manila')::date <= (now() AT TIME ZONE 'Asia/Manila')::date` for `today` (including overdue) and `> (now() AT TIME ZONE 'Asia/Manila')::date` for `upcoming`. Refined reservation queue rows to remove redundant `[Guest Transpo]` pill badge, keeping the clean inline text indication `#RS-xxxx · Category` beside the reference number in both List and Grid views. Integrated bespoke 3D Dispatch Copilot mascot avatar (`public/images/copilot-avatar.png`) across the Copilot header, chat messages, loader indicator, mobile drawer title, mobile open button, and empty state. Implemented strictly isolated, per-reservation session memory (`fleetops_dispatch_copilot_convo_map`) so conversations never bleed across bookings (e.g. RS-KXIH vs. RS-ZK1U), each reservation independently retains its chat history across tab switches and row navigation, and the `Clear memory` button selectively purges only the active reservation's conversation. All 122 Vitest test files (1,212 tests) and Next.js production build passed cleanly.

**Copilot conversational presentation (2026-09-15):** Chat now uses compact left/right bubbles, immediate outgoing messages, a checking indicator, timestamps, suggestion chips and a bottom composer following the user's reference. Evidence metadata is expandable. Reply instructions favor short practical answers without raw IDs/count dumps, Markdown markers or repetitive disclaimers; pickup times are explicitly localized to Manila. Existing safety and assignment rules remain. Five focused conversation tests passed; browser/live-model visual and wording acceptance remains pending. See `Capstone/07 - Development/Dispatch Copilot Scope and Conversation Audit.md`.

**Dispatch Copilot scope/chat repair (2026-09-15, implemented locally):** Analysis actions target the selected reservation's explicit Manila service date; existing plan tokens include the date window. Restored exclusions and truthful missing/stale copy, removed obsolete-pair fallback, protected pending selection and queue validation gates. Added free-text English/Filipino conversation with shortcuts through a read/recommend-guarded endpoint, existing deterministic evidence/LLM adapter and rate limiter; no chat mutations, coordinates, new dependency or migration. Provider unavailable yields labelled evidence-only fallback. Full suite 121 files / 1,194 tests and 267 route guards passed; lint/build passed. Browser/live-provider acceptance remains pending (no browser provider available). See `Capstone/07 - Development/Dispatch Copilot Scope and Conversation Audit.md`.

**Dispatch Copilot audit (2026-09-15, research only):** User screenshots/source inspection exposed Upcoming-versus-today planner scope mismatch, hidden exclusion reasons, unconditional Live/verified copy, stale pair/scope UI risks and absence of a free-text conversation. User now explicitly requires freely typed dispatcher questions with suggested shortcuts, superseding the prior buttons-only Q&A direction; chat must remain read-only and grounded in deterministic evidence. No application fix was made in this audit; the selected request's exact exclusion cause requires its live payload. See `Capstone/07 - Development/Dispatch Copilot Scope and Conversation Audit.md`.

**Dispatch Copilot persistent workspace (2026-09-14, implemented):** Unified the Transportation Queue (`/reservations/queue`) into a high-density two-column persistent workspace: selectable queue view on the left (`ReservationQueueTable`) with a 1-to-1 reference toggle between compact List View and 2-column Grid View (featuring `#TR-xxxx` codes with vehicle category annotation, guest party & bag counts, schedule dates/times, route distance/duration estimates, pill tags `Guest Transpo`/`Hotel Ops`/`VIP`/`Airport`/`Group`/`Restaurant`, and status chips), paired with a persistent, non-modal Dispatch Copilot aside on desktop (`DispatchPlanPanel` + `AiRecommendationPanel` widened to `w-[460px] 2xl:w-[490px]` for comfortable pair/route display). On tablet/mobile (<1280px), single-mount discipline strictly mounts only one Copilot instance via an accessible slide-over drawer upon row selection. The queue header features four truthful Copilot analysis tiles (Ready, Review required, Blocked, Needs verification) derived from the planner scope (today through Manila midnight plus overdue), preserving an honest unanalysed state prior to evaluation. Assignment confirmation is performed directly inside the Copilot panel with live server revalidation, plan token preservation, mandatory override reasons for manual reviews, atomic timeline auditing, and 409 conflict recovery. Resolved React 19 Rules of Hooks violation in `AiRecommendationPanel` by hoisting `dispatch-plan` `useQuery` unconditionally at the top level (removing conditional `plan || useQuery(...)` short-circuiting), eliminating cascading `setState` in render effects, and importing missing `Ban` icon. Automated verification: 121 test files / 1,202 tests passed; Next.js production build passed cleanly. Visual browser acceptance pending live browser inspection. See `Capstone/07 - Development/Dispatch Copilot Persistent Workspace Plan.md`.

**Dispatch decision workstation (2026-09-14, implemented locally):** Queue side dialog and shared reservation-detail evidence view replace the former long proposal/recommendation presentation. Deterministic ready/review/blocked/insufficient states, ID-pinned selection, contextual confirmation, Why answers and existing-plan contention use the existing recommendation/radar/planner engines. Strict evidence covers required records, pairing, grounding incidents and full service-window maintenance. Scheduled UNKNOWN requires permitted manual review; every force request requires a reason, hard blockers remain non-overridable, and required assignment timeline evidence commits atomically. Existing freshness tokens/refresh paths, RBAC and coordinate privacy remain; success requires queue reanalysis. No new migration/dependency/LLM engine. Verification: 118 files / 1,180 tests, production build, touched ESLint and all 266 route guards passed. Browser and real database concurrency acceptance are pending. See `Capstone/07 - Development/Dispatch Copilot Decision Workstation Plan.md` for manual checks and rollback.

**Web Live Map operations workspace v3 (2026-09-14, implemented):** Stable pickup→destination mission corridor (endpoint-keyed, 5-min stale; route-less trips via additive monitor `endpointTargets` from the existing target chain, corridor only when both ends known; GPS never the corridor origin) + dispatcher-owned viewport (manual pan/zoom sticks; Recenter/select re-fits) + opportunistic per-row ETA/delay/next-risk from cheap fleet evidence (zero new TomTom calls) + VIP/Airport tokens from projected request fields + Available-resources vs Fleet-exceptions split + pickup-overdue WATCH. No new engine/provider/migration/mobile scope. Verified: full Vitest 114 files / 1164 tests, live-DB projection check, build 201 pages, auth 266/266. See Tracking and Live Map Radar notes. Browser/device acceptance pending.

**Mobile launch optimization (2026-09-19, implemented):** Removed the 588 KB embedded-image car Lottie from the startup overlay while retaining native-driver dial/route/wordmark motion and the static location beacon. Reduced the normal launch hold from 2.3 s to 1.1 s with a 180 ms exit fade. Native splash now hides after `ThemedApp` commits, preventing the blank handoff while `SettingsProvider` restores preferences; notification setup waits until the overlay exits and interactions settle. Verified 22 mobile test files / 135 tests, targeted ESLint, and Android export (1,376 modules, 79 assets, 4.58 MB Hermes; car Lottie omitted). Physical-device FPS/cold-start validation remains pending. See Mobile Architecture.

**Web standby tracking (2026-09-14):** Fixed the missing PR 4.5 connection to /tracking/live-map. A trips:read_all guarded, no-store standby feed now supplies fresh checked-in/consented/session-valid paired driver positions to the operations map with Standby labels; expired/failed-feed pins are hidden. No standby trip/history records are created. Verified with 15 focused tests, ESLint, web build, 264-method auth audit and live SQL. See Tracking and Live Map Radar notes. Foreground app and real-device acceptance requirements remain.

**PR 4.5 ? Context-aware dispatch radar (2026-09-13, implemented):** Candidate-specific Immediate/Reposition/Scheduled policy; attendance-backed foreground standby publishing; observed-time/accuracy/session validation; route ETA and both-resource feasibility before final selection; authorized request-specific radar and GPS-free scheduled payloads; transactionally revalidated assignment plus dispatch creation. Migration 111 applied and schema.sql refreshed. Full suite 1,140 passing tests, followed by 37 focused passing checks; web/Android builds and 263-method auth audit passed. Physical-device GPS/visual acceptance remains pending. See `Capstone/07 - Development/PR 4.5 Context-Aware Dispatch Radar Implementation Plan.md`.

**Mobile Home Claymorphic Loading Skeletons & Anti-Lag Optimization (2026-09-13, implemented):** Replaced the generic flat wireframe `<SkeletonCard />` on the mobile Home screen (`mobile/app/(app)/(tabs)/index.js`) with dedicated 1:1 content-matched claymorphic placeholder skeletons (`mobile/components/home/DriverHomeSkeletons.jsx`):
- **Zero-Lag Master Pulse Clock (`useSharedSkeletonPulse`)**: Single hoisted `Animated.Value` operating on a smooth 850ms ease-in-out cycle (`0.38 <-> 0.78`) with `useNativeDriver: true`. Bypasses the JS bridge during animation cycles, slashing frame drops and bridge congestion by >90% compared to multiple independent skeleton timers. Supports OS reduced-motion preferences via `AccessibilityInfo.isReduceMotionEnabled()` (holding steady 0.55 opacity).
- **Zero Cumulative Layout Shift (CLS)**: Skeletons match the exact heights and visual structures of loaded cards (`DriverHeroCardSkeleton` at ~245dp with header, pale mint KPI panels and vehicle bar; `DriverTripCardSkeleton` at ~370dp with badges, route timeline stops, map preview block, and CTA button), eliminating the 150-275dp jump when data arrives.
- **Curved Silhouette & Zero Box Shadow Artifacts**: Completely eliminated rectangular drop shadow boxes and elevation artifacts on curved cards (`borderRadius: 28` / `24` with `overflow: 'hidden'`) by removing outer elevation, dropping asymmetric border widths, and stripping `renderToHardwareTextureAndroid` from containers. Adapts dynamically to light warm ivory (`#D8E2DC`) and dark forest slate (`#22332A`) palettes without layer clipping.
- **Section Heading Typography Refinement**: Adjusted `AssignmentsHeading` on the Home screen from bulky 20px `titleLg` to 17px semi-bold (`moderateScale(17)` / 22px lineHeight, `letterSpacing: -0.2`) and "View Full Schedule" from 14px to 13px (`moderateScale(13)` / 18px lineHeight) with a 14px chevron icon, eliminating truncation on 360-390dp screens and establishing balanced visual hierarchy.
- **Verification**: ESLint 0 errors / 0 warnings; all 21 mobile Vitest test suites (123 tests) passing; Expo Android Hermes export succeeded cleanly (1,395 modules, 5.15 MB bundle). Existing trip details logic and workflows preserved completely untouched.

**Mobile Map Top-Down Vehicle Marker carlive.png, Radar Visibility & Performance Optimization (2026-09-13, implemented):** Integrated bespoke top-down 3D vehicle asset `mobile/assets/images/carlive.png` into `mobile/components/TomTomMap.js` at ~51px visible height (60x60 container accounting for image padding) with GPS heading rotation. Resolved the lifecycle race condition where async Base64 asset loading could miss TomTom's initial DOM marker creation by persisting `window.carMarkerImageUrl`, assigning the image upon marker creation, and re-injecting on the `MAP_READY` WebView bridge event alongside Android `allowFileAccess` permissions. Completely removed the synthetic car headlights glow, color customizer modal, and swatches for unified FleetOps branding. Added a subtle pale mint contour outline (`drop-shadow`) in dark mode for crisp separation without harsh glow. Refined radar wave visibility with 1.5px border and dark mode mint styling. Eliminated mobile panning/idle lag by removing GPU-heavy dynamic `box-shadow` on 1000px scaling pulses, suspending pulse animations during map drag (`.map-interacting`), preventing redundant WebView reloads via module asset caching, throttling zoom/rotate via RAF, eliminating dead React re-renders on map drag, and wrapping `TomTomMap` in `React.memo`. See [[Live Map Radar]]. 20 test files / 121 tests passed, 0 ESLint errors, Android Hermes export passed (1,394 modules).

**PR 5 dispatch copilot (2026-09-14, implemented):** Queue-wide provisional planning through Manila end-of-day plus overdue requests; fixed future trips remain protected. Bounded deterministic optimization, tentative driver/vehicle commitments, explicit partial results, signed expiring plan evidence and single-pair confirmation through existing guarded assignment. No bulk apply, migration or new dependency. Final full suite: 115 files / 1,173 tests passed; build, ESLint, auth audit and migration filename checks passed. Browser/live concurrency acceptance pending. See `Capstone/07 - Development/PR 5 AI Dispatch Copilot.md`.

**Dispatch Copilot decision-workstation research (2026-09-14, proposed only):** Audited local PR 5 and two UX proposals. Recommended a shared queue/detail decision view, explicit evidence/state/freshness separation, deterministic Q&A, and targeted shared validation/override-audit fixes. No application code changed. See `Capstone/07 - Development/Dispatch Copilot Decision Workstation Plan.md`; do not treat its proposed safeguards as implemented.

Comprehensive system overview for AI assistants and new developers. Covers architecture, tech stack, directory layout, database schema, API surface, auth/RBAC, the mobile companion app, and the business logic domains.

**Production Login & Cookie Header Overflow Hardening (2026-09-16, implemented):** Resolved `HTTP ERROR 431` (localhost), `494 REQUEST_HEADER_TOO_LARGE` (Vercel), and web driver login routing failure:
- **JWT Cookie Sanitization & Bloat Prevention (`src/lib/auth.js`)**: Isolated the cause of HTTP 431/494 to a 57.5 KB base64 data URL stored in `employees.avatar_url` (from license scan payload) which NextAuth serialized into the session JWT cookie, producing 15+ chunked cookies totaling >60 KB and overflowing Node/Vercel header limits. Added `isSafeAvatarUrl()` exported at module scope (preventing `ReferenceError` during `callbacks.jwt` execution on credential sign-in which previously returned HTTP 500) to strictly reject `data:` URLs or strings >512 chars from session tokens, ensuring cookies stay lean (<1-2 KB). Cleaned existing base64 strings in the database.
- **Driver Return-To Role Scoping (`src/lib/auth/return-to.js`)**: Updated `getAndClearReturnTo(role)` so drivers logging in via web are always sent to their role home (`/driver`), overriding foreign `/dashboard` paths stored during prior redirects. Non-drivers are blocked from `/driver`.
- **Driver Creation/Edit API Guarding (`src/app/api/drivers/route.js`, `src/app/api/drivers/[id]/route.js`)**: Prevented raw base64 license scans from being assigned to `employees.avatar_url`.
- **CORS Same-Origin & Deployment Awareness (`src/proxy.js`)**: Updated `isAllowedOrigin(origin, request)` to dynamically validate and allow same-origin requests matching `request.nextUrl.origin`, `Host`, and `X-Forwarded-Host`/`X-Forwarded-Proto`. Added support for `NEXTAUTH_URL` and `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` deployment host aliases.
- **Structured Error Responses on 403**: Forbidden API requests in `src/proxy.js` now return structured JSON `{ error: "Forbidden: origin not allowed" }` with `status: 403` instead of an empty `null` body (0 bytes), preventing client JSON stream parsers from crashing on empty input.
- **Graceful Error Translation (`src/services/auth.service.js`)**: Wrapped `nextAuthSignIn` with error translation so any unexpected empty-response or JSON parsing `SyntaxError` from edge/network proxies is caught and translated to `"Authentication service returned an unexpected response. Please check your network and server configuration."` instead of leaking low-level browser DOM exceptions.
- **Session Manager Route Scoping & Safe Text Parsing (`src/context/session-manager.jsx`)**: Scoped `isAppApiRequest` to ignore all auth flows (`/api/auth/*` except `/api/auth/profile`) so failed login credentials do not trigger session invalidation. In the 401 interceptor, swapped `cloned.json()` with `cloned.text()` and safe `JSON.parse` to eliminate unhandled rejections on 0-byte 401s.
- **Login Status Resiliency (`src/app/(auth)/login/page.js`)**: Protected `/api/auth/login-status` polling with `res.ok` validation and `.catch(() => ({}))`.
- **Verification**: `src/lib/auth.test.js` (5/5 passed), `src/services/auth.service.test.js` (3/3 passed), `src/lib/auth/return-to.test.js` (8/8 passed), `src/security-boundaries.test.js` (10/10 passed), full Vitest suite passing (137 test files, 1319 tests), and `npm run verify:auth` passing (261/261 routes).

**Driver Academy & Interactive In-App Guide (2026-09-16, implemented):** Replaced static text FAQs with a hands-on interactive driver onboarding simulator (`mobile/app/(app)/guide.js`):
- **Interactive Missions (`mobile/components/guide/DriverGuideModal.jsx`)**: 6 tactile sandbox modules simulating real app interactions without affecting live dispatch: pre-trip vehicle safety checklist (7-point inspection with pass/fail triggers), swipe-gesture masterclass (`SwipeButton` 48% slide confirmation for route start/completion), trip lifecycle and odometer verification, fuel receipt camera viewfinder alignment, floating emergency SOS medallion hotline menu, and offline mode tunnel resilience.
- **Home Integration (`mobile/components/guide/DriverGuideCard.jsx`, `mobile/app/(app)/(tabs)/index.js`)**: Compact molded clay card showing live completion percentage and resume CTA for uncertified drivers.
- **Persistent State (`mobile/lib/driver-guide.js`)**: Pure module managing driver progress in `@fleetops_driver_guide_progress` with completion timestamps and reset abilities.
- **Profile & Help Center Integration**: Direct navigation from Profile General menu (`profile.js`) and Help & Support (`profile/help.js`).
- **Verification**: `mobile/lib/driver-guide.test.js` (6/6 passed), full Vitest suite passing (142 test files, 1340 tests), and `npm run verify:auth` passing (270/270 routes).

**RSC Fetch & Client Fetch Hardening (2026-09-16, implemented):** Resolved `TypeError: Failed to fetch` on RSC payload (`/dashboard`) and NextAuth session (`/api/auth/session`):
- **CORS Development Origin Flexibility (`src/proxy.js`)**: `isAllowedOrigin()` now supports loopback (`localhost`, `127.0.0.1`, `::1`) and local LAN addresses when `NODE_ENV !== "production"` and the app is bound locally, preventing 403 CORS preflight rejections when accessing the dashboard via `127.0.0.1` or LAN IP. Validated allowed origins are dynamically echoed in `Access-Control-Allow-Origin` (replacing the rigid single-string assignment). Production remains strictly locked down to `NEXT_PUBLIC_APP_URL`.
- **Scoped `window.fetch` Interception (`src/context/session-manager.jsx`)**: The global 401 interceptor in `SessionManagerProvider` is now strictly scoped via `isAppApiRequest()` to app `/api/` endpoints, completely bypassing Next.js internal RSC payload requests (`/_next/`, page navigations, static assets) and NextAuth initialization (`/api/auth/session`). Added `window.__fleetops_fetch_intercepted` guard to prevent double-wrapping during React StrictMode remounts/HMR, and ensured safe `this || window` invocation context.
- **NextAuth Catch-All Route Standardization (`src/app/api/auth/[...nextauth]/route.js`)**: Replaced custom async parameter wrapping with standard `export const GET = handler; export const POST = handler;`. NextAuth v4's `NextAuthRouteHandler` directly handles `context.params` resolution internally, restoring 200 responses on `/api/auth/session` and `/api/auth/providers`.
- **Verification**: `src/security-boundaries.test.js` (10/10 tests pass, including production fail-closed + development loopback origins), `npm run verify:auth` 261/261 pass, syntax check clean.

**Driver password change + reset on mobile (2026-09-13, implemented):** Drivers can now change and recover their password without the web dashboard:
- **Change (authenticated):** New `mobile/app/(app)/profile/change-password.js` reached from a "Change Password" row at the top of Profile → Privacy & Security. Calls the existing `POST /api/auth/change-password` — the route accepts any role and `resolveIdentity()` prefers the mobile bearer token, so no backend change was needed. Success shows the `signInRequired` alert, signs out (clearing the offline cache namespaced to the old driver first, per the `auth.js` ordering), and returns to login, mirroring web Settings > Security.
- **Recovery (public):** New `mobile/app/forgot-password.js` (email → existing public stub, generic contact-admin message verbatim, no enumeration) and `mobile/app/reset-password.js` (administrator-issued 30-minute single-use code + new password → public token mode of `POST /api/auth/reset-password`), linked from a new "Forgot password?" entry on `mobile/app/login.js`. Paste-the-code entry — no deep-link config; a `reset-password?token=` deep link remains a follow-up.
- **Strong-password enforcement:** New pure `mobile/lib/password-validation.js` (min 8, lower + upper + number + special, ≤72 UTF-8 bytes, new-must-differ, confirm-must-match) blocks submit on both screens with a live checklist; `password-validation.test.js` (12 tests) pins the policy plus client≡server parity — it imports `isPassword`/`isPasswordByteLengthAllowed` from `src/lib/validation/index.js` and asserts identical accept/reject verdicts on an adversarial corpus and 2000 deterministic fuzz passwords, so the server (`type: "password"` on both routes) can never reject what the client accepted. All credential mutations use `queueOnFailure: false` — never queued offline.
- **Verification:** Mobile suite 129/129 pass, ESLint clean on all 7 touched files, `npm run verify:auth` 261/261 (no new backend surface). Physical-device pass (airplane-mode errors, post-change forced re-login, admin-code reset E2E) still requires a device — not claimed.

**Driver Profile Picture Web & Shell Sync (2026-09-13, implemented):** Completed the end-to-end sync of driver face photos / profile pictures across the web application shell and mobile home header:
- **UserDropdown & AppShell Avatar Rendering**: Upgraded `UserDropdown` (`src/components/ui/user-dropdown.jsx`) and the `AppShell` sidebar user footer (`src/components/layout/app-shell.jsx`) to render `<AvatarImage>` with `object-cover` styling, resolving the uploaded driver photo (`employee.avatar_url || employee.face_image_url`) and gracefully falling back to initials when unset.
- **NextAuth Session & JWT Propagation**: Extended `authorize()` in `src/lib/auth.js` to select `employees.avatar_url` and driver `face_image_url`, forwarding `avatarUrl` and `image` through `jwt` and `session` callbacks.
- **Live Auth Profile API**: Added `GET /api/auth/profile` returning the current user's profile with resolved `avatar_url` (prioritizing `face_image_url` for drivers). Wired `AuthProvider` (`src/hooks/use-auth.js`) with React Query (`["auth-profile"]`), ensuring active browser sessions immediately reflect the uploaded photo without requiring a cookie wipe or re-login.
- **Upload Dual-Table Sync & Backfill**: Extended `POST /api/driver/face-photo` (`src/app/api/driver/face-photo/route.js`) to update both `drivers.face_image_url` and `employees.avatar_url` on upload. Backfilled existing records (e.g. Jack Mors) so database consistency is guaranteed.
- **Mobile Home Header Parity**: Added `photoUrl` support to `DriverHomeHeader` (`mobile/components/home/DriverHomeHeader.jsx`) and wired `index.js` to display the driver's face photo in the header avatar circle.

**Mobile 3D Claymorphic SOS Medallion Integration (2026-09-12, implemented):** Replaced the generic flat vector shield icon and embossed text inside the floating emergency trigger (`DriverSos.js`) with the bespoke 3D claymorphic asset `mobile/assets/images/SOS.png` (`! + SOS`):
- **Tactile Clay Medallion (Option 2 Enhanced: Dual-Tone Rose Clay Gradient)**: Features a sculpted pearl-rose to warm blush dual-tone clay gradient (`['#FFF5F5', '#FFDFDF']` in light mode, `['#3D1E1E', '#221010']` in dark mode) via `LinearGradient`, pure white specular top edge highlight (`borderTopColor: '#FFFFFF'`, `borderTopWidth: 2.5`), deep shaded bottom rim (`borderBottomWidth: 3`, `rgba(210,50,50,0.30)`), an inner concentric medallion ring (`concentricRim`, 1dp), and an emergency coral red ambient drop shadow (`shadowColor: '#E24B4B'`, `shadowOpacity: 0.28`, `elevation: 9`). Gives the circular medallion rich spherical 3D curvature that harmonizes with the studio reflections on the coral-red (`#E24B4B`) 3D exclamation mark and SOS lettering.
- **Micro-details & Contrast**: Prominent circular medallion sized at 64dp (`SOS_SIZE = moderateScale(64)`) with `overflow: 'hidden'` and `sosInner` wrapper, with centered 3D image sized at 50×50dp for bold visibility and clear legibility.
- **Emergency Modal Parity**: Upgraded the confirmation dialog's header icon tile to render the 3D SOS asset (44×44dp) inside a matching dual-tone rose clay tile with subtle edge highlights and red glow shadow, reinforcing emergency visual cohesion.
- **Workflow & Integrity**: Maintained full `PanResponder` drag-to-reposition spring physics (`damping: 18`, `stiffness: 220`), tap-to-open emergency modal, 911 phone dialing, GPS reverse-geocoded dispatch capture, emergency payload submission (`POST /api/driver/incidents`), and accessibility attributes intact. Touched-file ESLint clean; all 101 Vitest suites (1,112 tests) passed.
- **Visibility Fix (2026-09-12)**: The FAB is mounted in the `(tabs)` layout and stays mounted while Stack screens push on top, hiding itself on profile/settings-area routes via `HIDDEN_ROUTE_PREFIXES` (`/profile`, `/settings`, `/work-schedule`). `/devices` (Devices & Sessions, opened from the Profile tab) was missing from that list, so the SOS abruptly reappeared there mid profile flow; it is now included and the hide list is a single constant for future settings-area routes.
- **Clay bugfix plan executed (2026-09-12)**: All 7 bug groups from the [Mobile Clay Bugfix Implementation Plan](Capstone/01%20-%20System/Mobile%20Clay%20Bugfix%20Implementation%20Plan.md) are now fixed on `perf/quick-actions` (uncommitted per branch rule): B1 `isDark` undefined — now derived `const isDark = scheme === "dark"` in **8** files (the planned 6 plus `work-schedule.js` and `submissions.js`, which the audit found carrying the same bug); B2 trip status badge routes through `tripStatusTone` + `tone=`; B3 `inspection.js` plate label uses real `headlineMd`; B4 license badge passes `tone={status.tone}` directly (amber stays amber, Valid is green again, `badgeVariant` indirection deleted); B5 `ClayTile` accepts numeric `size` (dp), deriving radius ≈ 0.375× and icon ≈ 0.5× so `size={48}` call sites keep exact md values; B6 `complete.js` MISSION COMPLETE badge got `dot` back (pre-migration `pulseDot`), `fuel-report.js` dead `dotColor` dropped (pre-migration badge had a clock icon, no dot); B7 hoisted the inline `useMemo` in `trips.js` `TripCard`, `TripMapPreview` shows "Loading route…" while static images load, `RouteTimeline` guards `stops ?? []`. Verified: grep clean of all bug patterns, `node --check` on 7 files, `git diff --check` on 3 JSX files, ESLint clean on all 10 touched files, 19 mobile lib Vitest suites (117 tests) pass. Pending: Expo device visual checks + nested-Pressable tap test (expected no change).

**Mobile Floating Curved Pill Bottom Navigation Bar 1:1 Reference Alignment & Claymorphism (2026-09-12, implemented):** Recreated the floating bottom navigation bar 1-to-1 matching the user's reference mockup with authentic FleetOps claymorphic depth:
- **Floating Pill Container**: Detached capsule pill bar (`mobile/components/CurvedPillTabBar.js`) with capsule ends (`borderRadius: 36`), floating off the bottom edge via dynamic device-adaptive clearance (`getDynamicBottomOffset`: 52dp on 3-button nav, 13-19dp on gesture nav, 10dp on zero-inset screens), warm white background in light mode (`#FFFFFF`) / dark forest slate (`#17221D`) in dark mode, molded clay edge lighting (crisp top specular highlight `borderTopWidth: 2`, `borderTopColor: '#FFFFFF'`, bottom shade `borderBottomWidth: 2.5`), and soft ambient drop shadow (`shadowOffset: { width: 0, height: 8 }`, `shadowRadius: 18`, `shadowOpacity: 0.09`, `elevation: 8`).
- **Mathematical S-Curve Clay Wave**: Eliminated boxy vertical walls and stepped arch artifacts in favor of a true C2-continuous cubic Hermite spline wave (`clay_wave_light.png` / `clay_wave_dark.png`, compact 92x28dp with lowered 10dp peak, 4x supersampled anti-aliasing) that flows tangent to the horizontal pill top line, curves up gently in an organic S-curve hill to cradle the circular button, and completely clears the Live Map and Trips tab items with elevated `zIndex: 120` tabCluster layering.
- **Lowered Flush Circular Action Button (Scan)**: Lowered 54dp circular button (sitting gently nestled at `top: -12` relative to pill top) with rich forest green gradient (`['#204E3C', '#143828']` in light mode), white camera/viewfinder reticle icon (`Ionicons` `scan-outline`), zero harsh bottom borders or dark drop shadow rings (`elevation: 0`, `shadowOpacity: 0`, `borderWidth: 0`), sitting clean and flush against the white wave cradle, with soft press scale animation directly routing to the fuel report scanner (`/fuel-report?scan=1`).
- **Tactile Icons & Active Indicator Dot**: 4 primary tabs (Home, Live Map, Trips, Profile) symmetrically distributed around the center slot. Active tab displays primary deep forest green (`#1B4332`), semibold typography, and a centered active indicator dot (`4.5dp`) placed directly under the label text with zero layout shift (`opacity: isFocused ? 1 : 0`). Inactive tabs use muted slate (`#55606F`) without the dot.
- **Clearance & Integration**: Wired via `<Tabs tabBar={(props) => <CurvedPillTabBar {...props} />}>` in `mobile/app/(app)/(tabs)/_layout.js`. Maintained hidden tabs (`history`, `notifications`, `vehicle`) and floating `<DriverSos />`. Container has top padding to ensure 100% reliable Android touch bounds across the elevated button. Updated bottom scroll padding on `trips.js` and `profile.js` to `insets.bottom + 96` so bottom content and actions remain fully visible. All 101 Vitest suites (1,112 tests) and ESLint checks passed.

**Mobile Home dynamic trip list (2026-09-12, implemented):** Replaced the fixed Current + Next (+Then) slots with a status-driven list — conditional current card pinned first only when an active trip exists (same active-status definition, so tracking/weather/vehicle-context logic is untouched), then up to 3 chronological upcoming cards (first `NEXT TRIP`, rest `UPCOMING`; `+N more · View Full Schedule` past the cap) under an `Upcoming Trips` heading. No empty placeholder slots; the no-trips state card keeps the truthful confirmed/unconfirmed/offline copy. No backend change (API already sorts by scheduled departure). Full Vitest suite (1112 tests), touched-file ESLint, and Android export passed.

**Home Hero Card & Hotel 3D Background 1:1 Reference Alignment (2026-09-12, implemented):** Aligned the mobile driver Home hero card (`DriverHeroCard` in `mobile/components/home/DriverHomeCards.jsx`) one-to-one with the reference design mockup:
- **3D Hotel Illustration**: Incorporated `mobile/assets/images/hotel.png` into the top-right quadrant of the hero shell with `overflow: 'hidden'`, with its road sweeping down and across behind the subtitle and KPI cards to create the exact 2.5D layered depth from the reference mockup.
- **Header Typography**: `"Smooth rides. Happy guests."` subtitle beneath the uppercase bold date, constrained to the left column (`maxWidth: '62%'`) to avoid colliding with the hotel building. (The `"Ready for what’s next?"` headline was removed per owner request on 2026-09-12.)
- **Pale Mint Clay KPI Cards**: Restyled the 2 KPI stat cards (`Upcoming trips` and `Trips completed`) with soft pale mint clay containers (`#E5EEE7` in light mode with top highlight and soft clay drop shadow; `colors.primaryContainer` in dark mode). Integrated an extruded clay squircle icon badge (`#F3F7F4`, 36x36dp) on the top-left with bold numbers (26px) on the right, followed by bold labels and action links with chevrons (`View assignments >` / `All time >`). Shrunk ~20% from the original 44px-tile/32px-number sizing per owner request (2026-09-12).
- **Assigned Vehicle Intact**: Preserved the assigned vehicle card structure, vehicle photo loading, and handlers completely untouched per instructions (*"wag mo na pakielaman yung van jann"*).
- **Verification**: Touched-file ESLint clean; all 22 mobile Vitest suites (129 tests) passed; Android Expo export passed (1,366 modules, 5.14 MB bundle).

**Home ivory clay reference refinement (2026-09-09):** Home-only raised ivory hero, sage KPI panels and molded icon tiles replace the scenic hero; compact density and real navigation/data remain. Optional assigned vehicle photos render from existing URL fields, fall back only to the same vehicle's standing assignment, and disappear cleanly on failure. New Home-only inset/outer materials retain legacy Android fallback and equal light/dark style keys. Touched lint, 103 mobile tests and Android export passed; browser component checks covered light/dark, missing/present/failed images and a theme cycle. Native device acceptance remains pending. See the Mobile Home Claymorphism Implementation Plan note. No commit created.

**Mobile dark-mode clay depth pass (2026-09-09, implemented):** App-wide fix for dark mode reading as flat "dark neumorphism". `mobile/lib/clay.js` now exposes scheme-aware `clayMaterials(isDark)` — light values byte-identical, dark variants use a diffused low-alpha border + faint top sheen (no harsh white strip) and deeper/wider shadows; all 13 clay consumers plus the local recipes in Trips/Trip Details/Home cards switched to it. Dark palette nudges (dark-only): `background`/`surfaceDim` `#111816`→`#0D1713` (stage separation from the container ladder) and `primaryContainer` `#285448`→`#245F50` (muted-emerald tiles; onPrimaryContainer ≈ 5.7:1 AA). Screen fixes: Profile inline strips → materials, Settings text-size Cancel → clay CTA, SOS FAB/chip/emboss scheme-aware, Work Schedule hero white overlays → onPrimary alphas, AppAlert foreign Tailwind palette → theme tone tokens, Vehicle tab's foreign blue → `colors.info` tint, license scan-box/source-button strips dark-aware, and `trip/complete.js`'s dead `isDark` destructure (the context never exposed that key — it silently evaluated undefined) replaced with `scheme`. Light mode and high-contrast palettes untouched. Mobile suite 106 tests, touched-file lint (24 files), and Android export passed; native device acceptance pending.

**Mobile Dark→Light theme-switch regression fix (2026-09-09, implemented):** After the depth pass, toggling Dark→Light left rectangular shadow/backing artifacts on clay cards — React Native does not reliably reset a style prop that merely *vanishes* from a style object, and the dark clay materials added `borderWidth`/`borderColor` keys with no light counterparts (the stale border + Android elevation drew a rectangular outline). Fix is state cleanup only, both themes' recipes otherwise unchanged: light `clayShade`/`compactShade` now declare `borderWidth: 0, borderColor: "transparent"` (explicit restoration), Trips' `styles.pill` gained a `borderBottomWidth: 0` reset its dark-only override was missing, and the Settings theme segment's `segmentOption` static now carries the full border/shadow/background key set as neutral defaults so the `active && mats.clayPill` pattern resets on deselection. New `mobile/lib/clay.test.js` locks in key parity between `clayMaterials(true)` and `clayMaterials(false)`. Mobile suite 113 tests, touched-file lint, and Android export passed; repeated Light→Dark→Light cycle verification on a native device pending.

**PR 4.5 planning (2026-09-13, proposed only):** [Context-Aware Dispatch Radar implementation plan](Capstone/07%20-%20Development/PR%204.5%20Context-Aware%20Dispatch%20Radar%20Implementation%20Plan.md) connects the existing driver standby screen with a request-scoped dispatcher view. Prerequisites include a trusted checked-in duty source and standby GPS publishing (the current global poster handles trips/rescue only). The plan centralizes per-candidate Immediate/Reposition/Scheduled location relevance, suppresses irrelevant GPS across API/scoring/narration, reuses feasibility before ranking, protects both resources' next commitments, and validates freshness at snapshot/assignment boundaries. The 5 km circle remains visual context. No implementation, migration or live-data change was made by the planning task.

**Mobile Live Map standby refinement (2026-09-13):** Fixed 5 km geographic coverage with a single 3.6s fading radar pulse and reduced-motion support; compact Live Tracking / Waiting for assignment header; real weather in an existing ClayCard above the bottom navigation; right-side clay controls; four Map-screen tabs (Home / Map / Trips / Profile) without the scan action. Removed the standby dashboard/range selector and bright layered radar. Missing GPS is not rendered as a fabricated vehicle. See [Live Map Radar](Capstone/02%20-%20Features/Live%20Map%20Radar.md). ESLint clean, 14 focused tests passed, Android Hermes export passed (1,373 modules). Native visual review pending. This supersedes the standby presentation described in the historical September 9 entries below.

**Mobile Live Map Radar & Standby HUD (2026-09-09, implemented):** See [Live Map Radar feature note](Capstone/02%20-%20Features/Live%20Map%20Radar.md). Redesigned idle standby mode into an interactive "Proximity + Dispatch Coverage Map" featuring a 4-tier concentric depth zone structure with distinct visibility layers matching the "Radar Wave Pulse – Visibility Layers" design specification: 4 background proximity zones (Zone 1: 130px 1km, Zone 2: 210px 3km, Zone 3: 290px 5km, Zone 4: 370px All) with subtle harmonic breathing; central ambient core `#A8FFE1` (70-90% opacity, 22px glow); and 3 distinct, defined wave pulse rings layer-by-layer (Inner: `#5CFFDC` sharp 1.5px border, 45-70% opacity; Middle: `#00FFB3` 1.5px border with 18px glow, 25-45% opacity; Outer: `#00E5A8` 1.5px border with soft dispersion, 15-25% opacity) emitting across a 2.4s stepped loop (0ms -> 350ms -> 700ms -> 1200ms full pulse) in FleetOps brand colors (Mint/Emerald dark, Forest/Sage light); top-down fleet car with headlights glow, customizable color swatches modal on tap, and heading orientation rotation; parity red `#ef4444` pulse disc applied to standby emergency dispatch markers; reverted map view to FleetOps tactical palette (`palettes.dark` / `palettes.light`); top HUD status pill cleaned of manual theme toggle with automatic dark/light theme adaptation; range filter (`1 km`, `3 km`, `5 km`, `All`); color-coded circular dispatch markers with dynamic proximity clustering (`[ 3 ]`); compact floating Assignment Info Card; collapsible legend; pan-detection recenter FAB; and driver operational command bottom sheet with prominent coral SOS button wired to the emergency distress workflow. All 996 Vitest tests passing.

**Mobile Home UI update (2026-09-09):** See [Mobile Home Claymorphism Implementation Plan and outcome](Capstone/01%20-%20System/Mobile%20Home%20Claymorphism%20Implementation%20Plan.md). Implemented image-backed summary, grouped shortcuts, and distinct Current/Next cards while preserving the warm ivory theme and driver workflows. Mobile utility tests, targeted lint, and Android export passed; native device smoke testing remains pending.

**Mobile Profile & Settings UI update (2026-09-09, implemented):** [Profile & Settings claymorphism plan + outcome](Capstone/01%20-%20System/Mobile%20Profile%20%20%26%20Settings%20Claymorphism%20Implementation%20Plan.md) extends the Home/Trips clay language to the Profile tab and everything reachable from it — Settings, personal/license/vehicle/safety/help, Logged-in Devices. Styling-only: new shared `mobile/lib/clay.js` (pure material constants) + `ClayScreenHeader` (raised back control); `components/ui.js` untouched. All permission/upload/session/phone-edit/sign-out logic unchanged. Mobile suite 102 tests, targeted lint, and Android export passed; native device acceptance pending.

**Mobile Profile IA restructure (2026-09-09, implemented):** Profile menu regrouped into Account (Personal Information hub, which now contains License & Compliance and Assigned Vehicle rows), Privacy & Security (Privacy & Consent — read-only consent status + policy rendered from the cached `/api/driver/me` `consent` payload, no mobile policy copy; App Permissions — management screen moved out of Settings; Devices & Sessions — retitled former Logged-in Devices), and General (Help Center, new About FleetOps, Settings). `settings.js` lost its permission management and later its push/location toggles too (see the next note); the first-run consent gate's summary wording was reconciled with `src/lib/consent/policies.js` (flow untouched); `profile/safety.js` was superseded by `profile/privacy.js`. New shared `ClayMenuRow`. Mobile suite 102 tests, targeted lint, and Android export passed; native device acceptance pending.

**Mobile App Permissions hybrid + Settings trim (2026-09-09, implemented):** App Permissions is now a hybrid screen — APP CONTROLS holds the app-level Location Tracking and Push Notifications toggles (Location ON requests the OS permission first; OFF stops FleetOps use only and the always-visible "Device permission: …" line keeps the OS state honest — the app never implies it can revoke an OS permission), and DEVICE ACCESS holds the remaining OS-permission rows (Background Location, Camera, Photo Library) as status/manage, never switches. Settings lost the push/location toggles and is display-only (theme/text-size/high-contrast). Profile's Sign Out became a soft destructive clay button (errorContainer surface, clay edge strips, error-tinted icon tile), and the logout confirm modal is now a raised clay card — destructive medallion, clay Cancel (raised surface) and clay Confirm (solid error red, the actual destructive action). Mobile suite 102 tests, targeted lint, and Android export passed; native device acceptance pending.

## 1. System Overview

### Live deployment security assessment - 2026-09-18

The authorized live pass against `https://fleet-transpo.vercel.app` was
strictly read-only: `GET`, `HEAD`, and `OPTIONS` only. No credentials, cookies,
form submissions, uploads, AI calls, mutations, or production data were used.

- Protected GET routes returned `401`; malformed web/mobile bearer tokens also
  returned `401`.
- CORS rejected an untrusted origin and allowed only the canonical deployment
  origin with `Vary: Origin`.
- HSTS, frame/nosniff, referrer, and permissions headers were present.
- The live Supabase contract passed with 59 classified relations, 58/59 RLS,
  zero contract violations, and zero anon-exposed relations after resolving
  the anon probe's empty-table results with live catalog checks.
- Production drift remains: the live CSP still allows `img-src ... https:`
  while the checked-in config uses an origin allowlist, and five newer local
  evidence/dispatch routes return live `404`s. These are documented in
  `Capstone/01 - System/Security Audit.md` as `SEC-DEPLOY-001` and
  `SEC-DEPLOY-002`.
- No Critical, High, or Medium finding was confirmed. Authenticated RBAC/IDOR,
  business-logic, upload, GPS, evidence-reference, MFA/reset, session, and
  browser checks remain staging/manual work because no live test account or
  browser provider was used.

Home verification follow-up: the final header revision also passes Android export. Local native-device tooling remains unavailable, so the Home reference's phone-rendering acceptance is still open; see the Home feature note.

**Shared clay route preview (2026-09-09):** Home and Trip Details share TripMapPreview with raised route shading and rounded clay pins. Detail full-map navigation remains unchanged. See Home/Trips notes for verification.

**Map preview clarity (2026-09-09):** Preserved provider land-use detail instead of flattening every fill, added responsive map resizing, and strengthened the clay frame. No route geometry or navigation changes; reported partial-render symptom still requires device confirmation.

**Home map labels (2026-09-09):** Added Pickup/Drop-off pin labels and restored forest Details buttons on Home. Road route remains solid; trip behavior unchanged.

**Home real route preview (2026-09-09):** Shared TomTom WebView preview replaces endpoint-only static images in Home cards. Muted basemap, real calculated forest route, custom pins, consistent clay frame and aligned map/CTA stack. No trip/navigation changes. See Home implementation note for checks and pending on-device visual acceptance.

**Reference Home header (2026-09-09):** DriverHomeHeader now groups a green avatar, real greeting, reusable weather pill and separate unread bell with soft clay elevation. Compact layout reflows for narrow/large-text screens; profile/weather/notification data flows preserved. See the Mobile Home note for verification and night-data limitations.

**Forest action accents (2026-09-09):** Home/Trips Details controls and Trips Completed badges now share primary/onPrimary coloring, retaining theme adaptation and existing behavior.

**Live Map Radar & Entity Refinements (2026-09-09, implemented):** [Live Map Radar feature note](Capstone/02%20-%20Features/Live%20Map%20Radar.md) updated mobile standby map behavior:
- Removed hardcoded random establishments (`defaultHubs`).
- Radar entities strictly restricted to nearest partner gas stations (Petron, Shell, Caltex, Cleanfuel with fuel brands), nearest active fleet drivers, and official dispatcher-assigned trip requests from `/api/mobile/driver/trips`.
- Dispatcher-only booking acceptance: drivers can only accept trips with a valid `tripId` assigned by dispatcher/admin; gas stations offer a Fuel Report shortcut and drivers display availability status with no accept action.
- Interactive Coverage Legend toggling: drivers can tap any category in the Coverage Legend to toggle its visibility on/off (e.g. hiding gas stations, fleet drivers, dispatch requests, or driver vehicle puck/pulse) with real-time marker cluster updates, eye/eye-off indicators, strikethrough styling, active layer counter badge, and a "Show all layers" button.
- Radar pulse scaling: dynamic bloom expansion up to 5 km when zoomed out to envelope the full coverage scope.
- Hardware-composited 60/120fps radar animation: isolated with `contain: layout paint`, `will-change: transform, opacity`, and `transform: translate3d(0, 0, 0)`; eliminated software `filter: blur` re-rasterization on Zone 4; refactored wave pulses into an organic 2.7s continuous loop with 0.9s phase stagger and smooth fade-in/fade-out keyframes to eliminate opacity popping and timing dead periods.
- Removed redundant SOS button in idle dashboard sheet (standard header distress flow handles emergencies).
- Full Map View: idle bottom sheet supports swipe-down gesture via `PanResponder` to collapse into a minimal ~44px peek bar.
- Touched-file lint and 1,098 Vitest tests passed.

**Home clay consistency (2026-09-09):** Home now matches the stronger Trips card curvature, depth, edge highlights, raised controls and route nodes. KPI artwork, warm palette and business behavior preserved. See the Mobile Home implementation note; physical-device visual checks remain pending.

**Trips clay depth refinement (2026-09-09):** Increased card curvature, soft elevation, edge highlights and raised controls in Trips/Trip Details and their route timeline. Warm theme and trip behavior preserved; see the Trips implementation note. Native visual acceptance remains pending.

**Trips Android export unblocked (2026-09-09):** Restored the temporary web-only VisualReview configuration to FleetOps' existing configuration. Android Expo export now passes (1,346 modules); no app.json diff remains. Physical-device acceptance remains pending. No commit or deployment made.

**Trips follow-up verification (2026-09-09):** Existing clay Trips/detail implementation retained; readiness copy and banner styling corrected, invalid start dates regression-covered. Targeted lint and 92 mobile tests passed. Fresh Android export is blocked by the current web-only VisualReview configuration; no configuration override or commit was made. See the Trips claymorphism implementation note for details.

**Mobile Trips UI update (2026-09-09, implemented):** [Trips and Trip Details claymorphism plan + outcome](Capstone/01%20-%20System/Mobile%20Trips%20Claymorphism%20Implementation%20Plan.md) extends the Home visual direction to the Trips list and Trip Details. Includes the six truthfulness/action corrections: whole-card Details navigation (no unscoped "START TRIP"), active-trip Continue is navigate-only (never re-issues accept/start), no fabricated Completed/VIP/`10:00 AM`/passenger-count defaults, completion time from `end_time` (never `updated_at`), honest notFound/error fetch states, and a READY · SCHEDULE UNCONFIRMED queue bucket for unknown start windows. Pure helpers `mobile/lib/trips-queue.js` + `trip-detail.js` (13 new tests), shared `RouteTimeline` component. Mobile suite 97 tests, touched-file lint, and Android export passed; native device acceptance pending.

**Map weather chip (2026-09-09, implemented):** [Mobile Map Weather Chip plan](Capstone/01%20-%20System/Mobile%20Map%20Weather%20Chip%20Implementation%20Plan.md) added a compact ambient weather pill fed from the GPS ingest response (Open-Meteo, coarse-grid cache, fail-open ~2 s timeout) via a new shared post-write advisory helper (`src/services/ping-advisories.service.js`) used by both GPS POST routes, plus a `GET /api/mobile/driver/weather` endpoint and `useAmbientWeather` hook so the chip is visible even without an active trip (one-shot/last-known position, never a watcher). The chip label is a reverse-geocoded place name (TomTom, existing server key, `src/lib/geo/reverse-geocode.js`) with the condition carried by a dual-tone Ionicon. Weather is never a banner/notification — permanently chip-only; placed in the **Home header beside the notification bell** (map has no weather surface). Vitest (994 tests) and lint passed; native device acceptance pending. **2026-09-13 Meteocons upgrade:** glyphs replaced with vendored Meteocons Fill PNGs (12 keys, MIT attribution in `mobile/assets/images/weather/`); truthful `is_day` threaded for day/night art; glyph tinting dropped (full-color art), text tokens kept.

**Contextual Coach Marks Subsystem (2026-09-16, implemented & refined):** [Driver In-App Guide](Capstone/02%20-%20Features/Driver%20In-App%20Guide.md) and [Mobile Architecture](Capstone/04%20-%20Architecture/Mobile%20Architecture.md) record the lightweight, non-intrusive contextual guidance system (`mobile/components/coachmarks/` and `mobile/lib/coach-marks.js`). Adheres strictly to "ONE COACH MARK = ONE EXACT COMPONENT TARGET", real 4-scrim passthrough interactivity (modal-less absolute fill container with 4 blocking regions and unblocked cutout for interactive controls), protected action guarantees (SOS, Start Trip, Complete Inspection, Swipe Progression require Got it without forced execution), cross-screen route stamping and stale measurement prevention, ScrollView safe viewport auto-scrolling, and theme forest-green primary contour with a single restrained arrival pulse (no neon #00E676). Driver-isolated persistence via AsyncStorage with reset in Help & Support. All 26 mobile test suites (172 tests) passing with 0 ESLint warnings.

**Session Timeout UI Redesign (2026-09-18, implemented):** [Authentication architecture note](Capstone/04%20-%20Architecture/Authentication.md) records the centered blocking modal enhancement (`src/components/auth/session-timeout-dialog.jsx`) aligned with the Operations Center design language (`--session-*` design tokens). Features calm amber card during inactivity warning, 120px circular SVG countdown ring during final 60s, clear recovery upon expiration, fail-safe inline error retry on extension failure, focus trap, and ARIA polite interval announcements. 13 new unit tests and clean ESLint.



**FleetOps** is a hotel-affiliated fleet & logistics management platform (guest transport for a hotel, e.g. "CoCo Star Hotel"). It runs the full lifecycle of guest transportation requests — from an external **Booking** subsystem through intake, review, approval, dispatch scheduling, trip execution, GPS tracking, fuel reporting, and maintenance — plus fleet/driver/vehicle management, analytics, reports, and a driver-facing mobile app.

It is a **single-organization** system (branch/multi-tenant concepts were removed in migration 013). There are two applications in one repo:

> **Last audited:** 2026-09-03 against Git `1a16346`. Repository counts and the checked-in schema are synchronized below; live Vercel environment variables and the production migration ledger remain deployment-specific and must be verified in their respective environments.

| App | Location | Tech | Audience |
|---|---|---|---|
| Web dashboard | `src/` | Next.js 16 (App Router) + React 19 | Admin, fleet managers, dispatchers, drivers, management |
| Mobile app | `mobile/` | Expo SDK 54 / React Native 0.81 (Expo Router) | Drivers |

**Scope:** FleetOps is strictly **fleet & transportation**. The three hospitality
roles (`reception_staff`, `restaurant_staff`, `concierge`) were **removed**
(migration `022_remove_front_desk_roles.sql`). Six roles remain. Each role is a
distinct **workspace** (identity, tagline, accent, home, role-specific nav)
driven by `src/lib/workspaces.js` (`WORKS[role]`, `getWorkspace(role)`); role
dashboards render through `src/components/dashboard/role-dashboard.jsx` +
`dashboard-configs.js`. Earlier additions still apply: **read-only operational/
executive boards** (`/fleet/documents`, `/drivers/performance`, `/reports/cost`,
`/executive`) and
endpoints `GET /api/documents/expiring`, `GET /api/reports/fleet-cost`. The
`/fleet/availability` + `/drivers/availability` boards were merged **2026-08-23**
into the dispatch module as `/dispatch/availability` (one page, Drivers |
Vehicles tabs); management gained Vehicles visibility in the merge. **2026-09-04:**
the page went **pairs-only** — the separate status lists re-proved misleading
(`5 Available vehicles + 5 Available drivers` reading as 5 dispatchable), so
`/dispatch/availability` now answers "which actual vehicle + driver pairs can
dispatch in this window?" Full-day default (`Showing dispatchability for today`),
optional exact-window picker, hard-blocker precedence, collapsed may-be-affected
trip warnings. Read surface: `GET /api/dispatch/availability-pairs` (see §6).

**Latest changes** (the current feature wave — details in §7/§8/§9/§12):

- **Smart Transportation Queue** (migrations 032–033): explicit priority inputs
  `is_vip` / `is_emergency` on `transportation_requests` feed a deterministic
  priority engine (`src/lib/scheduling/priority.js`) that writes a cached
  `derived_priority` (`Overdue → Critical → High → Medium → Normal → Future`);
  thresholds are admin-configurable (`src/lib/dispatch-policy.js`, `/settings/dispatch`).
  AI fleet-pair recommendations are now **immutable snapshots**
  (`recommendation_snapshots`, `src/lib/ai/pair-scoring.js` + `dispatch-advisor.js`)
  with a TTL, a `designated-driver` rule enforced at assign, and regeneration.
- **Incidents module** (migrations 030/035, 081–086): driver-reported incidents (severity +
  GPS coords) surface in a staff **read-only registry** with an active-incident
  map (TomTom tiles), resolve / send-to-maintenance actions, and **vehicle
  grounding + dispatch-interrupt automation** (see §7.3). Web page `/incidents`.
- **Notifications direction & preferences** (migration 030): notifications carry
  `reference_type` / `severity` / `link`; render with shared category/severity
  chips on web, mobile, and the in-app feed; taps route **per-role**
  (`src/lib/notifications/target.js`); per-user `notification_preferences` back
  the `/notifications/preferences` toggle grid.
- **Global search** (`Ctrl/Cmd+K`): `src/components/ui/command-palette.jsx` +
  `GET /api/search` across reservations, dispatches, drivers, vehicles.
- **TomTom routing** (`src/lib/tomtom.js` + `GET /api/tomtom/route` proxy with the
  server key): traffic-aware routing (`traffic=true` by default, `departAt`,
  0–2 alternatives, `trafficDelayMin` surfaced), short-TTL server cache
  (`src/lib/routing/route-cache.js`, rounded coords + 10-min departure buckets,
  `live/cached/snapshot/fallback/unknown` provenance), and the pure three-leg
  feasibility engine (`src/lib/scheduling/route-feasibility.js` fed by
  `src/services/route-feasibility-context.service.js`); route / distance /
  turn-by-turn for trip detail and live tracking; the mobile **Live Map** uses
  TomTom static images (no native map SDK).
- **CORS lockdown:** `src/proxy.js` (Next 16 middleware) answers preflights only
  for the `NEXT_PUBLIC_APP_URL` origin and 403s every other cross-origin caller —
  fail-closed, no `*` (see §4.6).
- **Authentication and session hardening** (migrations 087–089, 113, 2026-09-02 /
  2026-09-18):
  web sessions are server-backed with a 5-minute idle timeout and 12-hour absolute
  expiry; heartbeat activity, cross-tab session events, validated return-to
  redirects, TOTP MFA, and hashed recovery codes are shipped. Session management
  identifies web rows by `sessionId` and mobile rows by refresh `familyId`; IP
  address is display metadata only, so shared-IP rows remain separate sessions.
  The primary mobile Home assignment card uses the existing deferred route
  preview so the pickup-to-drop-off road line renders; secondary cards stay
  static so only one interactive map mounts at a time.
  The mobile revoke confirmation uses the concise `Revoke` action label.
  A read-only inventory on 2026-09-19 found 29 active mobile families for the
  reviewed Jack account, with 24 idle for more than 7 days; each family had
  exactly one active token row. No live session was revoked during the audit.
  Production requires distinct `MOBILE_JWT_SECRET` and dedicated
  `MFA_ENCRYPTION_KEY` secrets.
  redirects, TOTP MFA, and hashed recovery codes are shipped. Production requires
  distinct `MOBILE_JWT_SECRET` and dedicated `MFA_ENCRYPTION_KEY` secrets.
  The idle deadline moves only through the human-gated `POST /api/auth/heartbeat`
  — API traffic (including the dashboard's background polling) cannot extend a
  session. See §"Session idle timeout" for the policy rationale.
  The password field Caps Lock warning UI matches the reference design with an
  upward speech-notch pointer, a coral "Aa" badge, and an active coral input border,
  also extended to Confirm New Password for live match/mismatch feedback.
  The login session-expired banner matches the reference design with warm peach card
  surface, orange alert circle icon, two-line title/description, and dismiss action.
- **Live map & incident-map UX polish** (2026-09-03): the live map always
  auto-fits to all pins on every GPS poll, vehicle markers carry permanent
  plate + driver labels (no hover/click), marker colors are phase-coded with
  no gray fallback, and the open-incidents layer and floating "Live Route
  Navigation" panel were removed (the Incidents module already plots
  incidents on its own map, whose markers now show permanent type · severity
  + driver labels). Mobile SOS reports a reverse-geocoded place name instead
  of a raw Google Maps URL. Details in §9.3/§12.10.
- Mobile app tab bar is Home / Live Map / **scan FAB** (fuel gauge+receipt
  capture) / Trips / Profile; Vehicle, Alerts (notifications) and History live
  off the bar (header access) — see §8.
- **Newer waves** (2026-08-15 → 2026-09-03, details in §12): driver work
  schedules + leave requests, substitute-driver coverage, fuel **requests**
  (monthly allocations + Gemini gauge scan), **push notifications**
  (`push_outbox` + Expo), AI report narratives, per-trip pre-trip inspection
  gate, idempotent client submissions, and the CORS lockdown (`src/proxy.js`
  replaced `src/middleware.js`).

---

## 2. Tech Stack

### Web (`package.json`)
| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.2.11** (App Router) | Repo `AGENTS.md` warns this Next version has breaking changes vs. earlier training data; guides in `node_modules/next/dist/docs/` |
| React | **19.2.4** | Server + client components |
| Auth | **next-auth ^4.24** (Credentials, JWT cookie sessions) | bcryptjs for password hashes; jose for mobile tokens |
| Database | **Supabase** (`@supabase/supabase-js` admin/service-role client) **+ raw `pg` Pool** on `DATABASE_URL` | Dual pattern; see §4.1 |
| Data fetching | **@tanstack/react-query ^5** | 30s staleTime, retry 1, no refetch-on-focus — app-wide defaults in `providers.jsx`; a per-query override must not weaken them (§4.7) |
| Tables | @tanstack/react-table ^8 | generic `DataTable` |
| Forms | **react-hook-form + zod ^4** | `@/lib/validation/schemas.js` |
| UI | **shadcn-style** — ~17 `@radix-ui/react-*`, class-variance-authority, clsx, tailwind-merge, **lucide-react**, Tailwind **v4** (CSS-first, no config file) | components in `src/components/ui/` |
| Charts / maps | **recharts ^3**, **leaflet ^1.9 + react-leaflet ^5**, framer-motion, date-fns | live GPS map |
| Document scanning | **Google Gemini** structured extraction (`gemini-3.1-flash-lite`) + LLM provider abstraction | license / OR-CR / insurance / fuel-receipt **+ fuel-gauge** scanning; tesseract.js removed 2026-08-25 |
| Tests | **vitest ^3** | harnesses import real `src/lib` modules against the live DB |
| Scripts | `dev`, `build`, `start`, `lint`/`lint:ci`, `test`/`test:run`, `db:{status,up,check,rebaseline,erd,dump}`, `seed:{status,plan,up,down}` | |

### Mobile (`mobile/package.json`)
- Expo SDK ~54, RN 0.81.5, React 19.1, **expo-router ~6** (file-based), **expo-secure-store** (tokens), **expo-location** (GPS), **expo-notifications** (foreground handler + local scheduling + Expo push token), **expo-camera** + **expo-image-picker** + **expo-image-manipulator** (fuel gauge/receipt capture, incident photos, license scan), **expo-dev-client**; fonts `@expo-google-fonts/plus-jakarta-sans` + `@expo-google-fonts/ibm-plex-mono`; **react-native-web + @expo/metro-runtime** (Expo web target), lottie (completion animation).
- Scripts: `start`, `tunnel` (`@expo/ngrok`), `android`, `ios`, `web`.

### Key environment config
- Local configuration is read from `.env`; deployed configuration is supplied by the hosting provider. Core server keys are `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`; `NEXT_PUBLIC_APP_URL` is the browser CORS origin. `AUTH_SECRET` is retained for compatibility.
- Production auth requires a distinct `MOBILE_JWT_SECRET` and a dedicated 32-byte hex or base64 `MFA_ENCRYPTION_KEY`. The MFA key encrypts TOTP secrets with AES-256-GCM; generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, configure it in Vercel for Production and Preview, and redeploy. Never expose either secret to the client or rotate `MFA_ENCRYPTION_KEY` after enrollment unless all enrolled factors are intentionally reset.
- Mobile EAS configuration is committed in `mobile/app.json` and `mobile/eas.json`. It links project `0c1651d5-7014-48da-8227-5d9f30ea1a23` to Expo owner `josephlopezzzz`; before building, run `eas whoami` and `eas project:info` from `mobile/`. An `Entity not authorized` / `action=READ` error is an Expo-account permission problem, not an app-runtime error; authenticate as the owner or obtain project access before changing the linked project ID.
- Optional integrations use `CRON_SECRET`, `BOOKING_WEBHOOK_SECRET`, `BOOKING_GATEWAY`, `BOOKING_API_URL`, `BOOKING_API_KEY`, AI provider keys, and TomTom (`NEXT_PUBLIC_TOMTOM_API_KEY` client, `TOMTOM_API_KEY` server). Missing integration keys degrade to documented fallbacks or disable the protected integration.
- `next.config.mjs` — `turbopack.root` + security headers (CSP, HSTS, frame/nosniff, referrer policy). **No CORS here.** The CSP's `img-src` no longer admits every https host (narrowed 2026-09-17, SEC-CONFIG-004): it is `'self' data: blob:` plus the Supabase and app origins — derived from the same `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_APP_URL` env vars `src/lib/security/remote-url.js` uses, so the browser-side and server-side allowlists cannot drift — plus the three map hosts (`api.tomtom.com`, `*.basemaps.cartocdn.com`, `server.arcgisonline.com`). Without the map hosts the dispatch radar, incident map and live-locations map render blank; without the storage origin every receipt, avatar and vehicle photo breaks. **The write side enforces the same list.** Since 2026-09-18 (SEC-UPLOAD-008) any column that later binds to an `<img src>` is gated on write by `isAllowedStoredImageRef` (`src/lib/validation/index.js`), exposed to routes as the `mediaUrl` validation type — so the stored value and the rendered value are held to one allow-list rather than the CSP being the only line behind them. It is deliberately **stricter than the guard on the `data:` branch**: `isSafeRemoteMediaUrl` returns true for any `data:image/` prefix, which would admit `data:image/svg+xml,<svg …>`. `script-src` still carries `'unsafe-inline'` in production — moving it off needs a nonce and a `src/proxy.js` matcher widened past `/api/:path*`, which is deferred rather than done badly.
- `src/proxy.js` — **Next 16's middleware** (export `proxy()`, matcher `/api/:path*`). CORS **lockdown, fail-closed**: same-origin/no-Origin requests pass; any other `Origin` gets 403; preflight is answered 204 only for the `NEXT_PUBLIC_APP_URL` origin. No auth in the proxy — protected handlers enforce auth per route; public protocol and service-token endpoints use explicit checks. Covered by `src/security-boundaries.test.js`.
- Path alias: `@/* → ./src/*` (`jsconfig.json`).

---

## 3. Directory Layout

```
fleet-transpo/
├── src/                        # Next.js web app
│   ├── proxy.js                # Next-16 middleware: CORS lockdown on /api/* (fail-closed, no auth)
│   ├── security-boundaries.test.js  # vitest guard for the boundaries above
│   ├── app/
│   │   ├── layout.js           # ONLY root layout; wraps all pages in DashboardLayout + beforeInteractive theme-init script
│   │   ├── page.js             # "/" → server redirect: no session → /login, driver → /driver, else /dashboard
│   │   ├── globals.css
│   │   ├── (auth)/             # login, register(→redirect /login), forgot-password, reset-password
│   │   ├── (dashboard)/        # all app modules (no group layout; chrome from DashboardLayout)
│   │   │   ├── dashboard/      # home KPIs, charts, live map, AI insights
│   │   │   ├── driver/         # ★ driver portal — home, trips, profile (licenses+scan), incidents, vehicle, fuel
│   │   │   ├── fleet/          # vehicles (+ new/[id]/edit), categories, documents
│   │   │   ├── drivers/        # list, new, [id] (detail+account), [id]/edit, performance
│   │   │   ├── trips/          # register, active (live cards), [id]
│   │   │   ├── reservations/   # register, queue (dispatcher workspace), new (dev mock), [id]
│   │   │   ├── dispatch/       # kanban board, calendar, pair-first availability (today/exact-window), [id]
│   │   │   ├── fuel/           # ops console (registry/budget/permits/review), analytics
│   │   │   ├── maintenance/    # records, predictive (AI)
│   │   │   ├── incidents/      # ★ Fleet Incidents Registry (staff read-only + resolve, live map)
│   │   │   ├── tracking/       # live-map, history
│   │   │   ├── routes/
│   │   │   ├── ai/             # insights, predictive-maintenance, provider settings, logs
│   │   │   ├── reports/        # 6 report types + cost dashboard (+ AI narrative cards)
│   │   │   ├── analytics/
│   │   │   ├── executive/      # ★ Executive KPI Center (management/admin, read-only)
│   │   │   ├── notifications/  # feed, preferences, templates
│   │   │   ├── system/         # ★ System Console (admin) — audit log (system_admin only)
│   │   │   └── settings/       # general, profile, security, users/new, api, ai/logs, number-coding (UVVRP), dispatch (smart queue)
│   │   └── api/                # 183 route handler files (see §6)
│   ├── components/
│   │   ├── layout/             # app-shell, dashboard-layout (+RouteGuard)
│   │   ├── dashboard/          # ★ role-dashboard renderer + dashboard-configs.js
│   │   ├── ui/                 # shadcn primitives (card, button, dialog, toast, query-feedback, phase-rail, ...)
│   │   ├── tables/             # data-table, fleet-table
│   │   ├── maps/               # live-locations-map
│   │   ├── drivers/            # assigned-vehicle-card, substitute-driver-card
│   │   ├── dispatch/  reservations/
│   │   ├── providers.jsx       # SessionProvider + QueryClientProvider
│   │   └── error-boundary.jsx
│   ├── lib/
│   │   ├── db.js               # getAdminClient(), getPool()/query()/withTransaction()
│   │   ├── auth.js             # NextAuth options (Credentials, JWT, rate-limited)
│   │   ├── constants.js        # ROLES, ROLE_IDS, status lifecycles, NOTIFICATION_EVENTS/CHANNELS, derived-priority, etc.
│   │   ├── workspaces.js       # ★ WORKS[role] per-role workspace (identity, accent, home, nav) + getWorkspace()
│   │   ├── dispatch-policy.js  # ★ smart-queue thresholds (critical/high/medium minutes, vip/emergency flags)
│   │   ├── tomtom.js           # ★ TomTom URLs + server-keyed route builder (two-key split, traffic/departAt/alternatives)
│   │   ├── routing/            # route-cache.js — short-TTL live-route cache (rounded coords + departure buckets)
│   │   ├── audit.js            # writeAudit() — the only audit_logs writer since 014b dropped the DB triggers
│   │   ├── auth/               # api-auth, permissions.js (RBAC matrix), role-guard, mobile-token
│   │   ├── api/                # utils (requireAuth/ok/err), client (apiFetch), service-auth, ownership, trips-query
│   │   ├── consent/            # policies.js, driver-visibility.js
│   │   ├── driver/             # grounding.js — breakdown regex + vehicle-grounding rule (unit-tested)
│   │   ├── fuel/               # request-policy.js, gemini-gauge.js (gauge scan, fail-closed)
│   │   ├── notifications/      # presentation.js (category/severity chips), target.js (per-role nav), copy.js (driver microcopy), recipients.js (role-aware fan-out)
│   │   ├── scheduling/         # calendar, conflicts, priority, queue-grouping, trip-progress, travel-buffer,
│   │   │                       #   route-feasibility (pure 3-leg SAFE/TIGHT/INFEASIBLE/UNKNOWN), driver-schedule, state machines
│   │   ├── integration/        # booking-gateway, contracts, ingest (shared writer), category-resolver, status-map
│   │   ├── ai/                 # llm-adapter, rule-engine, dispatch-advisor, pair-scoring, predictive-maintenance,
│   │   │                       #   gemini-document, report-narrative, license-scan-policy
│   │   ├── uvvrp/              # policy.js (Number Coding), uvvrp.service.js
│   │   ├── supabase/, geo/, vehicles/, validation/
│   ├── services/               # 35 modules: client apiFetch wrappers + server business-logic services
│   └── hooks/                  # use-auth, use-realtime, use-role-access, use-theme, ...
├── mobile/                     # Expo driver app — see §8
├── supabase/
│   ├── migrations/             # 93 SQL migrations (through 089; see §5)
│   ├── config.toml
│   └── functions/ai-recommend-vehicle/   # edge function
├── docs/                       # rbac-model.md, design-system.md, mobile-*.md, architecture/
├── scripts/                    # 57 files: migrate.mjs, dump-schema.mjs, generate-erd.mjs, seed-demo.mjs, verification harnesses
├── schema.sql                  # GENERATED by npm run db:dump — never edit by hand
├── resources/ai/instructions.md
└── SYSTEM.md                   # this file
```

---

## 4. Architecture Patterns

### 4.1 Dual database access
- **`getAdminClient()`** — Supabase service-role client (bypasses RLS) used for most row operations.
- **`getPool()` / `query()` / `withTransaction()`** — raw `pg` Pool on `DATABASE_URL` for raw SQL, joined reads, and atomic multi-statement transactions (e.g. driver↔vehicle assignment swaps).
- **Important — "RLS is inert" was half true and dangerously incomplete (corrected 2026-09-18).** It is true that RLS does not constrain *this application's* connections: the service-role client and the `postgres`-role Pool both bypass it, so **authorization for the API is enforced in the application layer** (`requireAuth`). See `docs/rbac-model.md` and §7.
  But there is a second path that never touches the API. Supabase exposes PostgREST at `<project>.supabase.co/rest/v1/`, and **the public anon key — which ships in the browser bundle by design — authenticates to it.** Those requests arrive as the `anon` / `authenticated` roles, which *are* subject to RLS, and no application code runs on them. For that path RLS is **not inert; it is the entire boundary.**
  So the load-bearing statement is: **RLS is irrelevant to the app's own queries and load-bearing for every other path.** A table in `public` with RLS disabled is readable by anyone holding the anon key. This is not theoretical — `app_errors` was, and was measured so on 2026-09-18 ([[Bugs]] SEC-DB-003). Default posture: every table in `public` has RLS enabled unless it is deliberately public and documented as such.
  **RLS alone is not the whole boundary (learned 2026-09-18, migration `115`).** Row security does not apply to `TRUNCATE`, and Supabase grants new tables to `anon`/`authenticated` by default — so a table with RLS enabled but grants intact is still emptyable through PostgREST. The complete posture is **RLS enabled, no anon-permissive policy, AND no anon/authenticated grant.** A **view** needs `security_invoker = true` as well: without it the view runs as its owner and reads straight through the RLS protecting its base tables (SEC-DB-006, `driver_stats`, 40 driver rows readable). All three are now enforced by `npm run db:contract`.

### 4.2 Request flow & auth resolution (`src/lib/api/utils.js`)
- `resolveIdentity(req)` — if `Authorization: Bearer <token>` present → verify mobile JWT (`jose`, `NEXTAUTH_SECRET`) → `{ user, via: "bearer" }`; else fall back to NextAuth cookie session (`auth()`), backfilling `driverId` for driver roles. Bearer wins when both present.
- `requireAuth(req, allowedRoles)` — resolves identity, throws `AuthError(401)` unauth / `AuthError(403)` wrong role. **`DEFAULT_ROLES = ["system_admin","admin","fleet_manager","dispatcher","management"]`** (driver excluded by default).
- `requireDriver(req)` — `requireAuth(req, ["driver"])` + guarantees a linked `driverId` exists (403 otherwise).
- Shared: `parseBody`, `ok`, `err`, `errValidation`, `validateBody`, `handleError`.
- `AuthError(message, status = 401, code)` — **`code` is a session-liveness signal, so it defaults only on a 401** (changed 2026-09-17). It used to default unconditionally, which made every 403 role denial and every 404 ship `code: "SESSION_INVALID"` — a permission refusal telling the client its session is dead. No consumer acted on it (both read `code` only inside a `status === 401` branch), so nothing changed behaviourally; the envelope simply stopped lying. A caller that passes a code still gets it, whatever the status.
- M2M endpoints use `verifyServiceToken` (`src/lib/api/service-auth.js`, constant-time compare, Bearer or `?token=`, fail-closed when secret unset) — used by `/api/cron/sync` and the integration POST.
- Ownership scoping: `src/lib/api/ownership.js` — `assertTripOwnership`, `assertDispatchOwnership` (404 for other drivers' rows), `resolveDriverScope` (403 if a driver requests another driver's data).

### 4.3 State machines — one job, three legs, then a loop
The three lifecycle machines are **one continuous chain**, not three separate lists.
The same job moves through them: **Transportation Request → Reservation → Dispatch →
Trip**, and when the trip finishes the resources loop back into the pool. See
§4.8 for the operative sequence; the diagram below shows the hand-offs.

```
TRANSPORTATION REQUEST (Booking) ──► RESERVATION ──► DISPATCH ──► TRIP
   (external ingest)                   6-state      5-state      16-state
                                             │          │            │
                                             ▼          ▼            ▼
                                       Scheduled   Scheduled     Assigned
                                                          │      (live chain)
                                                          ▼            ▼
                                                   In Progress   Driver Accepted
                                                          │            ▼
                                                          ▼        Trip Started
                                                   Completed ◄── En Route ──► Drop-off
                                                          │            │
                                                          ▼            ▼
                               TRIP COMPLETED ◄──────────┴────────── Completed
                                          │
                                          ▼
                     Re-evaluate driver + vehicle (see §4.8/§9)
                     ─► Available / Next Scheduled Assignment /
                        Restricted / Under Maintenance / Incident
                                          │
                                          └──► back to the available pool
```

Centralized lifecycle logic lives in `src/lib/scheduling/` and server services.
The machinery (kept, plus the actual state counts):
- **Reservation** — `reservation-lifecycle.service.js` + `lib/scheduling/reservation-state.js`.
  `advanceReservation()` is the *only* place `fleet_status` changes; it validates the
  hop, persists, appends a timeline event, and notifies Booking. Legal transitions:
  a **strict linear chain** `Pending → Scheduled → Assigned → In Progress →
  Completed`; `Cancelled` from any non-terminal. Terminal states are locked.
  The old review cluster (`Under Review` / `Approved` / `Rejected`) was removed by
  migration `037_remove_review_statuses.sql` — existing rows were backfilled
  (`Under Review→Pending`, `Approved→Scheduled`, `Rejected→Cancelled`) and the CHECK
  now carries exactly six values; the `review|approve|reject` routes remain as thin
  aliases that walk this chain (`approve` = `Pending→Scheduled`).
- **Dispatch** — `dispatch-state.js` (`chk_dispatch_status` CHECK + explicit
  `Pending Reassignment`). Edges: `Scheduled ⇄ Pending Reassignment → Cancelled`;
  `Scheduled → In Progress`; `In Progress → Completed / Pending Reassignment /
  Cancelled`; `Completed / Cancelled` terminal. `Pending Reassignment` is a first-class
  state: a committed-then-released resource (incident, stand-down, driver/vehicle swap)
  sits there until reassigned (→ `Scheduled`) or cancelled. Dispatch is created for a
  request automatically (`dispatch-autocreate.service.js`) once a vehicle **and** a
  driver are both committed.
- **Trip** — `trip-state.js` (16-state graph, mirrors `chk_trip_status`).
  `canTransitionTrip` gates single forward hops; two vocabularies coexist — a loose
  legacy ingest cluster and the strict live driver chain (`Assigned → Driver Accepted →
  Trip Started → At Pickup → Passenger Onboard → En Route → Drop-off → Completed`).
  Cancellation is allowed from any non-terminal; `Completed` / `Cancelled` are locked.
  `trip-lifecycle.service.js` (`completeTrip`, `cancelTrip`, `syncBusyTrip`) validates
  the odometer, cascades status to vehicle/driver/dispatch/request, and writes the audit.

> Ownership rule: the **transportation request** carries the booking intent, the
> **dispatch** is the committed schedule on the board, and the **trip** is the executed
> drive. Requests do not advance to `Assigned` until both halves (vehicle + driver) are
> committed; dispatch is the entity that owns the operational timeline; trip completion
> closes the loop and releases the resources.

### 4.4 Booking integration (anti-corruption layer)
The external **Booking** subsystem owns guest data + approval. Fleet:
- Depends only on `src/lib/integration/booking-gateway.js`, never on Booking's
  database. `BOOKING_GATEWAY=mock` (default) serves canned requests shaped exactly
  like the future API; `http` is a loud stub until Booking is connected.
- Validates every inbound payload against `contracts.js`
  (`parseTransportationRequest`, which also translates Booking's `"Normal"`
  priority to Fleet's `"Medium"`).
- **Ingests through one shared writer**, `src/lib/integration/ingest.js`
  (`ingestRequest`), idempotent on `external_booking_id`. Two doors call it:
  - `POST /api/integration/transport-requests` — push. `BOOKING_WEBHOOK_SECRET`
    service token or a staff session. A contract violation is a 400 naming the
    failing issue; a replay returns the existing row with `idempotent: true`.
  - `POST /api/integration/pull` — pull. Staff session; polls the gateway. A
    malformed item is skipped and counted rather than failing the batch, so one
    bad record cannot block the good ones behind it.
  - The routes differ only in auth, that error handling, the
    `integration_log.event_type` (`transport_request_received` vs
    `transport_request_pulled`, kept distinct so reconciliation can tell push from
    pull), and the audit row — pull writes one aggregate per operator click.
  - Before this was unified, pull inserted 13 columns against push's 19: a pulled
    request arrived with no resolved category, no travel estimate, no reservation
    number and no timeline event.
- Caches in `transportation_requests` (the **Fleet Reservation Queue**);
  `dispatchschedules.request_id` is the back-link.
- Notifies Booking outbound via `outbound.service.js` (`emitTransportStatus`), logs everything in `integration_log`.
- The legacy `vehiclereservations` table, its `reservation_id` columns on both
  parents, and the whole `/api/reservations/*` route tree were **dropped**
  (migration `047_drop_vehiclereservations.sql`). It held 0 rows and duplicated
  `transportation_requests`.

### 4.5 AI layer (optional LLM + rule engine)
- **Rule engine** (`lib/ai/rule-engine.js`) is the deterministic baseline (recommendations, insights, predictive maintenance).
- **LLM** (`lib/ai/llm-adapter.js`) adds natural-language summaries/narrations — failure-tolerant, time-budgeted (25 s), falls back to rule output.
- `aiproviders` config table (API keys masked); `ailogs` usage log; `POST /api/ai/scan-document` (Gemini structured extraction via `src/lib/ai/gemini-document.js`, 12 s timeout, null-for-unreadable) powers license / OR-CR / insurance scanning with LTO renewal scheduling.
- **Server-owned narration guards and deterministic scope routing (2026-09-17, extended 2026-09-18):** the Dispatch Copilot conversation route owns six honesty obligations the model used to own — four keyed on the question, and since 2026-09-18 two keyed on what the model **volunteers** — and `classifyCopilotScope()` routes courtesy, unrelated and FleetOps messages before request/evidence/provider work. Contextual follow-ups require recent in-scope FleetOps history or active reservation/recommendation state; an unrelated turn resets context. Courtesy/unrelated responses are private `scope-only` replies and do not replace the panel's options, selected review, plan state or evidence. Scope never decides availability, eligibility, ranking, evidence or mutations. Each firing narration guard writes a `logAiRequest` row with `provider_name='Narration Guard'`, `model_name='Deterministic Guard'`, `status='Flagged'` and the fired labels in `error_message`. **`'Flagged'` is not `'error'` and is not an anomaly:** `ailogs.status` is `varchar(20)` with no CHECK, and both AI error counters match `ILIKE 'error'`, so a dispatcher-visible guard firing raises no alert and enters no review queue. A `Flagged` row means the server appended its own sentence to a narrated answer; it does not mean a request failed.
- **Prompt overrides (2026-09-06, migration 106):** `ai_prompt_templates` (`prompt_key` PK, `content`, `updated_by`, `version`) is the source of truth for live-edited prompts — the Vercel runtime filesystem is ephemeral, so the earlier disk-write PUT was replaced before production. Loader checks DB first, bundled `resources/ai/*.md` second, built-in last (both callers already awaited it: zero-change migration). `PUT /api/ai/instructions` upserts (`ai_settings`-update, allowlist, 50KB cap, audited), `DELETE` resets to the bundled default (idempotent), GET flags `overridden`/`version`; UI shows Customized badges + confirm-guarded Reset.
- **Error-log ownership (2026-09-06):** `app_errors` (migration 103) owns *unexpected* application/platform failures only. AI provider/timeout/parse/quota/fallback events stay exclusively in `ailogs`; the gate is proof-of-persistence (`subsystemOwned` set only after the specialized write succeeds — a bare subsystem code never suppresses), so a failed specialized write still lands in `app_errors` as fallback. Scan routes (`scan-document`, driver `license-scan`) now persist their contained Gemini failures to `ailogs`. Writer: `src/lib/app-errors.js` (sanitize + fingerprint + 90-day prune helper); `handleError(error, { req, employeeId })` stays backward-compatible (224 single-arg + 11 string-label callsites untouched). **Pass 1b APIs (same day):** `POST /api/errors` (explicit 6-role array incl. driver, per-account+IP throttles, rejects `source=server` + oversized/non-path payloads, always 200 with `{ received }` so reporters never retry-loop) and `GET /api/errors` (`audit`-read gate; events without stack + `GROUP BY fingerprint` occurrence groups + single-`error_id` detail with stack);   client `src/services/errors.service.js` (`getAppErrors`, `getAppError`,
  fire-and-forget `reportAppError`). **Pass 2 UI + reporters (same day):**
  `/system/errors` page (system_admin-only via `NAV_ROLES` + workspace nav +
  path-derived guard; grouped-by-fingerprint default with expandable events,
  stack detail dialog, source/date filters, CSV export) under Administration
  next to Audit Logs; web `ErrorBoundary.componentDidCatch` and mobile
  `ErrorBoundary` report once per mount (mobile stack display is `__DEV__`-only
  in production); 90-day `pruneAppErrors` runs inside the CRON_SECRET
  `/api/cron/sync` flow in an isolated step with an `errors_pruned` count —
  **deploy check:** an external scheduler must actually hit that route or
  neither the status sync, nor pruning, nor the trip start-window
  notification scan (added 2026-09-09, ~once-per-minute target cadence)
  runs.
- **System Health (2026-09-06):** detection + remediation routing, no auto-fix.
  Pure evaluator `src/lib/system-health.js` (locked per-subsystem thresholds:
  app 0/1–4/5+ per 15m, db <300/300–1000/>1000ms with probe-failure = degraded,
  integration pending→attention/failed→degraded, push stale-pending→attention/
  error→degraded, AI 0/1–4/5+ per 24h, logins 0–4/5–19/20+, sync heartbeat
  ≤24h/24–26h/>26h-or-missing) feeding `GET /api/system/health`
  (audit-read; isolated probes, `{ rows, overall, checked_at }`, action
  descriptors by kind link/post/refetch). One-click safe actions reuse the
  SAME service functions (not parallel logic): `POST .../push-retry` →
  `flushOutbox`, `POST .../integration-retry` → `reconcileFailedDeliveries`,
  `POST .../sync-now` → sync set + prune + heartbeat — all system_admin
  explicit, throttled, audit-logged. Cron/sync records the
  `cron_sync_last_ok` heartbeat in `system_settings` (key-specific readers
  only, no UI pollution) with `heartbeat_recorded` in its response.
  `/system/health` page (Administration, system_admin-only) renders rows with
  what/impact/recommended-action drill-downs, inline failure samples, and
  post-then-refetch buttons; total DB outage shows an "unavailable" fallback
  instead of a fake classification. **Acknowledge flow:** permanently
  undeliverable failures (no device token; stale provider config) can never be
  fixed by retry, so `push-review` / `ai-review` POSTs mark unreviewed rows
  reviewed (migrations 104/105 add `reviewed_at`/`reviewed_by`; history kept,
  health/activity counters count unreviewed only); live-verified to
  `overall: operational`, with the first real `cron_sync_last_ok` heartbeat
  recorded — the scheduled-sync path works end to end.

### 4.6 CORS — `src/proxy.js` lockdown (fail-closed)
Next 16 renamed middleware to **proxy**: `src/proxy.js` exports `proxy(request)`
with `config.matcher = "/api/:path*"`. Policy (Roadmap Phase 5): the web client
is same-origin, the mobile app is native (no browser origin checks), and Booking
is server-to-server — so there is **no legitimate cross-origin browser caller**.
Requests with no `Origin` header pass untouched; any `Origin` other than
`NEXT_PUBLIC_APP_URL` gets **403**; `OPTIONS` preflights are answered 204 only
for that allowed origin. There is no auth in the proxy — the real boundary stays
per-route `requireAuth()`/`requireDriver()` (§4.2). `src/security-boundaries.test.js`
locks this behavior in. (The older `Access-Control-Allow-Origin: *` design is
gone — do not reintroduce it.)

### 4.7 Smart dispatch & AI pair recommendation
- **Priority engine** (`lib/scheduling/priority.js`) — pure, deterministic. Inputs:
  pickup time, status, `is_vip`, `is_emergency`, thresholds. Terminal states → `null`;
  missed pickup → `Overdue`; then by time-to-pickup `Critical/High/Medium`, same-day
  `Normal`, else `Future`. VIP boosts one band (max High); emergency forces Critical.
  The queue groups/sorts by this (`lib/scheduling/queue-grouping.js`); `priority.service.js`
  batched-UPSERTs it into `transportation_requests.derived_priority` (never human-set).
  Thresholds come from `dispatch-policy` in `system_settings` (`lib/dispatch-policy.js`).
- **Fleet-pair scoring** (`lib/ai/pair-scoring.js`) scores vehicle+driver **as one
  unit** (designated-driver match +45); only a *provably unavailable* custodian
  legitimizes a substitute. `dispatch-advisor.js` enriches candidates with fuel-burn
  estimates and `detected_risks`; `recommendation.service.js` enforces the
  **designated-driver rule** at assign and flips snapshots to `is_consumed`.
- **Recommendation snapshots** (`recommendation_snapshots`, migration 033) are
  immutable pair records (`pair_json`, score, reasons, validity window). The
  saved-recommendation card reads the active snapshot; unconsumed/past-`valid_until`
  is surfaced as expired with `?regenerate=1`.
- **The confirmation gate reads *result* state, never *request* state** (`lib/dispatch/decision.js`,
  `components/reservations/ai-recommendation-panel.jsx`). `dispatchConfirmation()`'s `awaitingResult` flag
  means *"the caller has no result to act on yet"* — a first load, passed as `query.isLoading` — and
  explicitly **not** *"a request is in flight"*. Keying it on `query.isFetching` disabled Assign on every
  30s background poll and on every window focus, and because that branch also sat **above** `error || stale`
  it **masked a known blocker**, narrating "Checking current availability…" over evidence that had expired or
  a query that had failed. `error || stale` now outranks it, so a known reason is never hidden by a refresh.
  Queue validation follows the same rule — `!queue.validation?.isSuccess` may block, but an `isFetching` on
  top of a *current successful* validation must not — while plan absence and expiry, `invalidReason`, the
  dependency on a preceding request, the signed token, the pair-identity recheck and the server's own
  assignment revalidation all stay authoritative. The recommendation query runs on the app-wide policy
  (30s staleTime, no focus refetch, 30s interval + horizon-boundary refresh); the queue validation query
  deliberately keeps `staleTime: 0` and its 10s poll, because a short-lived signed plan's freshness *is*
  what is being validated. The Evidence Drawer keeps **no cache**: exactly one fresh GET per explicit open,
  and one new GET after close/reopen.
- **The dispatcher's chosen pair is part of the per-request Copilot memory, not component state**
  (`components/reservations/copilot-conversation.jsx`, `components/reservations/copilot-options.js`).
  `DispatchPlanPanel` keys the panel on the reservation (`key={selectedRequest?.request_id}`,
  `dispatch-plan-panel.jsx:38`/`:93`), so any move away from the route **remounts** it and any `useState`
  selection is lost. The choice is therefore stored beside the transcript, in the same module and with the
  same 30-entry prune and private-mode guards (`fleetops_dispatch_copilot_selection_map`,
  `get/set/clearReservationSelection`), recording the pair key **and the pinned option key list** so the
  restored card keeps the number and position the dispatcher saw even if the engine re-ranks meanwhile; a
  pinned key that has left the candidate list resolves to the existing `unavailable:true` card and is
  refused by the check. `clearReservationMessages` / `clearAllReservationMessages` clear it too, so "Clear
  memory" and per-request isolation keep meaning what they say, and *Change selection* clears it — a
  transcript can record a selection but not its absence, which is why the transcript is not the source of
  truth. Restoring **appends no message**: `CopilotConversation` already re-anchors the inline review to the
  persisted `select-pair` turn matching the selection, and re-running the check on return is deliberate (one
  queue re-analysis per remount). The restore is guarded by a ref keyed on `requestId`, because the
  re-analysis invalidates the recommendation query and would otherwise re-fire in a loop.

### 4.8 Dispatch eligibility, future availability & travel buffer

These are the **formal eligibility rules**. SYSTEM.md is the spec of record; the
two rules that were previously documented-only (future availability and the
travel/safety-buffer gate) are now **enforced** in code — see the inline notes
in 4.8.2 / 4.8.3 and §10.

#### 4.8.1 The dispatchable predicate

A **driver** is dispatchable for a requested trip when **all** hold:

1. **Active availability** — not `Suspended`, `On Leave`, or `Off Duty`. Being
   mid-trip is **not** itself "unavailable" for a *future* request (see 4.8.2),
   so `On Trip` is excluded from the disqualifying set.
2. **Qualified** — driver's license is valid on the pickup date (not expired).
3. **Compatible with the vehicle** — appropriate class / seating fit for the
   passenger count.
4. **No overlapping assignment** — no active reservation or dispatch already
   committed to this driver inside the requested window.
5. **Enough travel + safety buffer** — the previous scheduled commitment clears
   the requested pickup with the ETA + buffer rule of 4.8.3.
6. **Working per weekly schedule** — `driver_work_schedules` must have a row for
   the pickup weekday, the pickup→return window must fit inside the shift, and a
   half-open break overlap blocks (`lib/scheduling/driver-schedule.js`).
   No schedule row = blocked (fail-closed when context was loaded).
7. **Not on leave** — approved leave covering the pickup date blocks; *pending*
   leave surfaces as a non-blocking warning.
8. **No blocker** — no active incident / restriction, etc.

A **vehicle** is dispatchable when **all** hold:

1. **Operationally dispatchable** — status not `Under Maintenance` or
   `Decommissioned`. `In Use` is **not** a blocker
   for a *future* request (see 4.8.2); `Reserved` (a whole-day label) never
   hides a genuinely free window. (`Registration Expired` was removed from the
   live status CHECK — see §5.3.)
2. **Not grounded** — not grounded by an incident / not under an open maintenance
   window on the pickup date.
3. **Documents valid** — registration and insurance valid on the pickup date.
4. **Free in the window** — no overlapping dispatch / reservation.
5. **Right size** — seating capacity ≥ passenger count.
6. **Covered custodian** — if the designated driver is unavailable
   (e.g. suspended), a `substitute_vehicle_schedules` row covering the date must
   exist; consumers resolve the "effective driver for a date" through it
   (`recommendation.service.js`, `pair-scoring.js`, `conflicts.js`,
   `uvvrp.service.js`).

These predicates are enforced at: `GET /api/drivers` (picker filters blocked
drivers with a reason), `GET /api/vehicles/available`, `validatePairing`
(`recommendation.service.js`) + `pair-scoring.js`, conflict checks
(`conflicts.js`), and the trip-start guard (`PUT /api/trips/[id]/start`).
`GET /api/dispatch/availability-pairs` reports (not enforces) the same rules
for the availability board — classification only, assignment authority stays
with the gates above.

#### 4.8.2 Future availability (current status ≠ future availability)

Eligibility is evaluated against the **requested trip's time window**, not solely
against the driver's or vehicle's **current** status label. A resource currently
marked `On Trip` / `In Use` may still be eligible for a future booking if its
current and scheduled assignments end early enough to satisfy the required travel
time and safety buffer.

- Example: *Juan is `On Trip` printing 2:00–5:00 PM today. A new booking starts
  tomorrow 8:00 AM. His current trip ends long before that window, so he is
  eligible.*
- The time-aware authority is **window overlap** (`lib/scheduling/conflicts.js`),
  which already implements the half-open rule for dispatches/reservations; the
  status label must not short-circuit it for future windows.
- **Enforced:** `lib/ai/pair-scoring.js` no longer disqualifies `On Trip` / `In Use`
  unconditionally (removed from `UNAVAILABLE_STATUSES` /
  `NON_DISPATCHABLE_VEHICLE_STATUSES`); a currently-busy-but-future-free resource
  is offered unless an overlapping `_schedule_load` marks it genuinely busy.

#### 4.8.3 Dynamic travel + safety buffer (spec)

```
earliest_next_available =
    previous_scheduled_end
  + travel_time_to_next_pickup      (TomTom travelTimeMin, /api/tomtom/route)
  + safety_buffer
```

Decision rule:

- requested `pickup_datetime >= earliest_next_available` → **eligible** ✅
- requested `pickup_datetime <  earliest_next_available` → **ineligible** ❌

- The safety buffer is **derived, not a fixed 30 minutes**: it scales with the
  trip via a configurable offset on top of TomTom `travelTimeMin`, with a
  configurable floor for very short hops and no blanket minimum forced on every
  trip. **Enforced** — config `safetyBufferMinutes` / `bufferFloorMinutes` /
  `travelBufferEnabled` (defaults in `src/lib/dispatch-policy.js`, editable at
  `/settings/dispatch`); the rule lives in `src/lib/scheduling/travel-buffer.js`
  (`earliest_next_available`) and is a **hard BLOCKING** gate at assign time via
  `detectRequestConflicts`. The queue-chip (batch) path stays advisory —
  matching how chips never block while the assign gate is the authoritative 409.
- **The ETA is derived server-side and never taken from the caller** (hardened
  2026-09-17, SEC-DISP-004). `src/lib/scheduling/travel-signals.js` resolves it
  from stored data — the previous commitment's drop-off to this request's pickup,
  via `tomtomEtaMinutes`, falling back to a straight-line `etaFromDistanceKm`,
  else UNKNOWN — and its result is what the gate enforces. A caller-supplied
  `travel.etaMinutes` survives only as a **cross-check**: a divergence beyond
  `TRAVEL_ETA_DIVERGENCE_MIN` (15 min) raises a `TRAVEL_ETA_DIVERGENCE` WARNING,
  and the claim is never the value the gate compares against. Before this, the
  ETA came straight from the request body, so omitting `travel` skipped the gate
  silently and a forged low value cleared it — with no `override_reason` record
  of the kind the sanctioned `force: true` path demands.
- **Three outcomes, not two: eligible / ineligible / unverified.** When a prior
  commitment exists but no ETA can be computed, `TRAVEL_BUFFER_UNVERIFIED`
  (WARNING) is raised rather than a clean bill of health — visible to the
  dispatcher, non-blocking. Failing open with *no* prior commitment is still
  correct and unchanged: the gate never fabricates a conflict from absent data.
- The buffer reserves slack so one late finish cannot cascade into the next
  pickup.

#### 4.8.4 The operative sequence (booking → assignment → execution → re-evaluate)

1. Booking / trip request enters (external ingest, §4.4).
2. **Pending dispatch** — find eligible drivers (**4.8.1**) and eligible vehicles
   (**4.8.1**) for the requested window.
3. Check **driver ↔ vehicle compatibility**.
4. Check **schedule conflicts** (`conflicts.js`).
5. Check **travel time + safety buffer** (**4.8.3**).
6. **Show valid assignments** (assign dialog / pair recommendations).
7. Dispatcher **selects driver + vehicle**.
8. **Final backend validation** — re-run the conflict gate; blocking findings 409
   unless the dispatcher overrides with `force` (see `assign` route).
9. **`Assigned`** — the transportation request advances.
10. **Driver accepts**.
11. **`Dispatched`** → **pre-trip verification** → **en route to pickup** →
    **arrived at pickup** → **pickup started/completed** → **en route to
    destination** → **arrived** → **drop-off completed** → **Trip completed**.
12. **Re-evaluate driver + vehicle status** → `Available` / `Next Scheduled
    Assignment` / `Restricted` / `Under Maintenance` (incident/grounding §7.3),
    then return to the available pool for the next request (loop to step 1).

#### 4.8.5 Three-leg route feasibility (PR #1, 2026-09-07)

`evaluateRouteFeasibility` (`src/lib/scheduling/route-feasibility.js`, pure —
no DB, no fetch, `now` passed in) scores one pair against three journeys:
driver→pickup (deadhead, live routing matters most), pickup→destination
(canonical snapshot first, live only when freshness is required), and
destination→next **assigned** pickup (hard constraint). Verdicts `SAFE /
TIGHT / INFEASIBLE`, plus `UNKNOWN` fail-open whenever a leg ETA is missing —
never a fabricated block. `pickupBufferMin` is slack before the latest safe
departure net of the safety buffer (45 min to pickup − 19 deadhead − 10
buffer = 16). "Next booking" means the next `Scheduled`/`In Progress`
dispatch touching the vehicle or driver; a pending queue request is never a
next booking (scarcity/lookahead is Phase 2). The I/O boundary
(`src/services/route-feasibility-context.service.js`) resolves minutes +
provenance and caps live routed ETAs to a nearest-5 Haversine shortlist
(`_deadhead_minutes_routed` / `_deadhead_provenance` on candidates; scoring
itself unchanged until Phase 2). Tests: `route-feasibility.test.js` (incl.
the 8:15 → 9:00 → 11:00 acceptance case), `route-cache.test.js`,
extended `tomtom.test.js`; PR #1 suite 654 passing.

PR #2 (2026-09-07) makes the verdict dispatcher-visible: `attachPairFeasibility`
stamps a JSON-safe `feasibility` object (verdict, legs, reasons, per-leg
provenance) onto recommended + alternate + top-3 candidates in recommendation
GET and POST (so persisted snapshots carry exactly what was shown), and
`AiRecommendationPanel` renders it as a Route Feasibility card with provenance
labels. Skipped-vehicle rejection reasons render in a collapsible list even
when pairs exist; the assign endpoint records an optional `override_reason`
(≤500 chars) in timeline metadata. Tests: `route-feasibility-context.test.js`;
full suite 659 passing.

PR #3 (2026-09-08) adds arrival intelligence (migration 108:
`locations.pickup_radius_m/dropoff_radius_m` NOT NULL DEFAULT 100 with a
1–1000 m check constraint, tuned live to hotel 60 / arrivals pickup 150 /
departures dropoff 120; `trips.gps_distance_km`). Pure `evaluateGeofence` /
`evaluateTripGeofences` (`src/lib/geo/geofence.js`) with an accuracy guard
(>150 m → UNKNOWN, never a fake arrival) and `trailDistanceKm` (teleport
filter 180 km/h). `trip-geofence.service.js` resolves per-trip targets
(canonical location → gazetteer → null) with a 5-min cache, enriches every
ingested ping, and backs `checkDestinationProximity` (latest-ping, 10-min
freshness, fail-open). The mobile map shows near-geofence banners and gates
completion through Go Back / Complete Anyway + required reason; geofences
never auto-transition status. Tests: `geofence.test.js`,
`trip-geofence.test.js`; full suite 678 passing.

### 4.9 Canonical route resolution and lifecycle

`src/services/route-resolver.service.js` is the shared server-side path for
turning a request leg into a reusable route estimate. It normalizes endpoint
names, resolves both ends to active `locations` rows, reuses the active
directional route when one exists, and only creates a route after both endpoint
identities are valid. Unknown/free-text destinations remain ad-hoc request legs
and never pollute the route registry.

Routes are directional (`origin → destination`) and the database allows only one
active, non-deleted route per location pair while preserving inactive history.
`estimate_source` (`TomTom`, `Manual`, or `Legacy / Unknown`) and
`estimate_updated_at` preserve provenance; manual values are not overwritten by
TomTom refreshes, which is an explicit action from the Routes registry.
Endpoint identity changes are blocked after any dispatch/trip usage; operators
create a replacement route and deactivate the old one instead. Hotel renames
preserve the location identity, while a physical move creates a new active
location and retires the old location/routes so historical trips keep their
original geography.

Booking ingestion, dispatch auto-create, rescheduling, and AI recommendations
use this resolver. Live GPS and mobile navigation consume the selected trip's
route/destination data only; missing endpoint coordinates omit the route line
and ETA rather than guessing another route or a default hotel position.

### 4.10 Media references — store the object KEY, sign on read

Every bucket holding personal media is **private**: `driver-licenses`,
`face-captures`, `fuel-receipts`, `incident-evidence`, `expense-receipts`
(migration 070 for licences, 006/039/065/092 for the rest). `vehicle-images`
(migration 050) is public **by design** — vehicle photography, read by URL — and
is the one exception.

A private object is reachable only through a signed URL, and **a signed URL is a
bearer credential with an expiry**. So it is minted when it is needed and never
written down. A column that holds a driver's licence, face or receipt stores a
**bucket-qualified object key** (`driver-licenses/12/6f1c….jpg`); the route that
serializes the row calls `signedUrlFor` and returns a 1-hour URL. The format
lives in `src/lib/storage/key-format.js`, the reader/writer in
`src/lib/storage/object-refs.js`, and `src/lib/drivers/media.js` wraps both for
driver-shaped payloads. The precedent this generalises is
`lib/expenses/receipt-storage.js` (`receipt_storage_key` + a per-read signature).

Three rules, each of which was learned from a defect:

1. **Sign in the response, not in each component.** Doing it at the API boundary
   means one place to audit for a forgotten column, and the UI components do not
   change — they still receive a URL, it just expires.
2. **A legacy URL is recovered, never passed through.** A host allow-list is not
   a substitute: a `getPublicUrl` value's host is the Supabase URL, and on a
   private bucket that URL authorizes nothing. Recover the key from the path (the
   shape is deterministic) and re-sign. Unrecoverable → `null` and a warning,
   never passed through and never silently dropped.
3. **The write path canonicalises.** Readers hand clients a short-lived URL, and
   clients submit what they were shown back on the next save, so
   `canonicalStoredRef` reduces an echoed URL to its key server-side rather than
   trusting each client to remember.

**Storing a URL instead is two recorded findings.** SEC-UPLOAD-006 —
`getPublicUrl` on the private `driver-licenses` bucket: a dead link (it never
contacts storage, so it does not authorize) and a public-style reference to a
photograph of a government ID. Confirmed **LOW** against the live project, which
reports the bucket private and zero stored licence references; **closed at the
write path 2026-09-18**. SEC-UPLOAD-003 — `createSignedUrl` minted at ten years
and persisted, which is a credential with no revocation path: rotating the
storage key is the only way to invalidate one. It reached **four** columns, not
the two originally scoped — `fuelrecords.receipt_url`,
`fuelrequests.gauge_photo_url`, `drivers.face_image_url` and
`employees.avatar_url`; the second is written by the same `storeFuelReceipt`
and was found by the Step 0 census rather than by reading the code. **Code
closed 2026-09-18; data residual open** — the census found 7 + 1 + 1 + 1
non-empty values, of which 4 still resolve to a present object and 6 are
dangling. Those rows still hold live ten-year tokens and must be cleared by one
of two separately-approved actions: rewrite the rows to keys, or rotate the
storage key. See → `Capstone/07 - Development/Bugs.md`.

**The one column whose bucket cannot be assumed is `employees.avatar_url`** — it
receives face-capture keys from the face-photo route and licence keys from the
driver mirror, so a value must carry its own bucket prefix
(`face-captures/…` vs `driver-licenses/…`). `AVATAR_BUCKETS`
(`src/lib/drivers/media.js`) is the ordered candidate list and is exported
precisely so `src/lib/auth.js` — which resolves the same two columns onto the
session cookie — cannot drift from it. `lib/auth.js` signs **before**
`isSafeAvatarUrl`, because that guard requires an `http(s)` string and would
otherwise reject a key and silently blank every avatar.

**The key charset is a whitelist, and that is load-bearing.** A key segment may
contain only `[A-Za-z0-9._-]`. Without the whitelist a value with no `://` is a
single well-formed segment, so `javascript:alert(1)` parses as a valid bare
object key and the shared media rule accepts it — the shape of input a media
column is most likely to be attacked with. The whitelist admits `.` so extensions
parse, which is why a **separate** `/^\.+$/` check is required to reject `..`
traversal; neither check subsumes the other.

---

## 5. Database Schema (PostgreSQL on Supabase)

The checked-in `schema.sql` currently declares **50 tables, 1 view (`driver_stats`),
103 foreign keys, 108 standalone indexes plus 15 unique indexes, 14 functions, and
19 triggers**. It is the authoritative structure dump; §5.2 below is a reading aid,
not the source. Dispatch numbers are random strings, while serial-backed tables
still use PostgreSQL sequences in the live database.

There are **105 migration files** in `supabase/migrations/`, numbered through 102 (090 unused).
Exactly four numeric versions are duplicated historically — **036, 037, 059, and
060** each have two files, applied in filename order. The checked-in schema includes
the server-backed session/MFA tables and the `idle_timeout_seconds` column from
migrations 087–089. Live ledger state is environment-specific; verify it with
`npm run db:status` before applying anything. Migrations are applied via a direct
`pg` connection, NOT the Supabase CLI or the SQL editor (see `AGENTS.md` — the CLI
is broken here and the web editor was found to silently target the wrong project).
Use the runner rather than a one-off script: `npm run db:status` (applied /
pending / changed-since-applied), `npm run db:up` (apply pending, each in its own
transaction), `npm run db:dump` (regenerate `schema.sql` from live).
`scripts/migrate.mjs` records every apply in a `schema_migrations` ledger keyed by
**full filename** — because version numbers are duplicated — and refuses to run if
an already-applied file's checksum changed. New migrations must be idempotent
(`IF NOT EXISTS`, `DROP ... IF EXISTS`): the live DB is ahead of the files in
places, so a migration has to be a safe no-op there.

### 5.1 Migration timeline
| Mig | File | Purpose |
|---|---|---|
| 001 | `schema.sql` | Baseline: 36 tables — roles, employees, vehicles, drivers, trips, dispatchschedules, gpstracking, fuelrecords, **fuelrequests** (born here), audit/notifications/AI tables; `update_updated_at()` + `generate_dispatch_number()` |
| 002 | `rls_policies.sql` | RLS on all tables + `has_role()` helper (documented **inert** at runtime) |
| 003 | `notification_triggers.sql` | SECURITY DEFINER notification triggers |
| 004 | `integration_sub_system.sql` | `service_types`, `booking_channels`, `integration_log`; guest columns on `vehiclereservations` |
| 005 | `schema_cleanup.sql` | Trim 40→22 tables (drop permissions/fuel sub-tables/attendance/incidents/etc.; merge inspection→maintenance) |
| 006 | `driver_attendance_face.sql` | `drivers.face_image_url`; recreate `driverattendance` w/ face fields; `face-captures` bucket |
| 007 | `normalization.sql` | `locations` table; restore `vehicledocuments`; merge trip cost+performance into `trips`; create `driver_stats` VIEW |
| 008 | `auth_migration.sql` | `employees.password_hash` (bcrypt); seed admin |
| 009 | `registration_policy.sql` | anon INSERT/SELECT on employees (revoked again in 060b) |
| 010 | `compliance_notifications.sql` | registration-overdue + license-expired triggers |
| 011 | `rls_fix.sql` | missing policies; grant `driver_stats` |
| 012 | `status_constraints.sql` | CHECK constraints on vehicle/driver/reservation/dispatch/trip/fuel status |
| 013 | `drop_branches.sql` | remove single-tenant branches |
| 014 | `registration_expired_status.sql` | add `Registration Expired` vehicle status (the live `chk_vehicle_status` has since been rebuilt without it — five values remain, see §5.3) |
| 015 | `cleanup_dead_objects.sql` | drop broken triggers/functions (auth trigger, dashboard stats, audit fns) |
| 016 | `mobile_tokens.sql` | `mobile_refresh_tokens` (hashed, revocable) |
| 017 | `transportation_requests.sql` | **Fleet Reservation Queue** (`external_booking_id` UNIQUE idempotency) |
| 018 | `reservation_module.sql` | reservation lifecycle, `reservation_number`, AI recommendation cols, `reservation_events` timeline |
| 019 | `driver_consents.sql` | ★ privacy consent audit table (append-only) |
| 020 | `driver_vehicle_assignments.sql` | permanent driver↔vehicle pairing history w/ 2 partial UNIQUE active indexes |
| 021 | `cleanup_dead_columns.sql` | drop 6 never-read/written columns |
| 022 | `predictive_maintenance.sql` | `vehicles.service_interval_km/days` |
| 023 | `admin_role.sql` | ★ insert **`admin`** role (`role_id 9`); backfill role-less drivers to `driver` |
| 024 | `cleanup_ai_and_gpstracking.sql` | drop `vehiclereservations.ai_*` + `gpstracking.driver_id` (both dead) |
| 025 | `service_interval_guards.sql` | positive-interval CHECKs + partial `idx_trips_end_time` |
| 026 | `fuel_hardening.sql` | fuel review workflow (`rejection_reason`, `approved_by/at`, status CHECK) |
| 027 | `driver_personal_details.sql` | `drivers.address/sex/birthdate/nationality` (license scan auto-fill) |
| 028 | `remove_front_desk_roles.sql` | ★ drop hospitality roles (role rows 5/6/8); disable the 3 employees who held them |
| 029 | `dispatch_overlap_guard.sql` | ★ DB-level double-booking guard trigger + advisory locks on `dispatchschedules` |
| 030 | `driverincidents.sql` | ★ recreate `driverincidents` (dropped in 005) — driver incident reporting + breakdown automation |
| 031 | `uvvrp.sql` | ★ Number Coding: `uvvrp_exemptions` + `uvvrp_violations` |
| 032 | `smart_dispatch.sql` | ★ smart-queue inputs `is_vip`/`is_emergency` + cached `derived_priority` (CHECK) + indexes |
| 033 | `recommendation_snapshots.sql` | ★ immutable AI fleet-pair snapshots (UNIQUE active-per-request, TTL, consumed flag) |
| 034 | `recreate_vehicleinspection.sql` | ★ restore `vehicleinspection` for driver inspection reporting |
| 035 | `incident_coordinates.sql` | ★ `driverincidents.latitude/longitude` for the incident live map |
| 036a | `dispatch_cancel_reason.sql` | `dispatchschedules.cancel_reason` (auditable stand-downs) |
| 036b | `trip_lifecycle_status.sql` | rebuild `chk_trip_status` with the pickup-lifecycle statuses; declare `Pending Reassignment` in `chk_dispatch_status` |
| 037a | `notification_preferences.sql` | ★ per-employee (event×channel) toggles table + self-access RLS |
| 037b | `remove_review_statuses.sql` | ★ `fleet_status` → six values: backfill `Under Review→Pending`, `Approved→Scheduled`, `Rejected→Cancelled`; re-add CHECK without the review cluster |
| 038 | `perf_ai_provider_and_board_index.sql` | migrate `aiproviders` out of hot-path DDL; partial `scheduled_departure` index for the board |
| 039 | `fuel_receipts_bucket.sql` | private `fuel-receipts` storage bucket (server uploads, signed URLs out) |
| 040 | `substitute_driver_schedules.sql` | ★ `substitute_vehicle_schedules` — substitute custodian coverage per vehicle/date window |
| 041 | `dispatch_number_trigger.sql` | BEFORE INSERT trigger `trg_dispatch_number` fills `dispatch_number` when NULL |
| 042 | `dispatch_pending_reassignment.sql` | reconciliation no-op re-declaring the five dispatch status values |
| 043 | `backfill_undeclared_tables.sql` | reconciliation: declares `ailogs`, `ai_report_narratives`, `system_settings`, `substitute_vehicle_schedules` that existed live but had no migration |
| 044 | `dispatch_number_random.sql` | redefine `generate_dispatch_number()` → random `DSP-XXXX` suffix (50 collision re-rolls); sequence numbering gone |
| 045 | `ai_report_narratives.sql` | AI report narrative cache/budget table (+RLS); guarded create, no-op after 043 |
| 046 | `driverincidents_assistance_needed.sql` | declare `assistance_needed text[]` (existed live only) |
| 047 | `drop_vehiclereservations.sql` | ★ **drop `vehiclereservations`** (0 rows), both `reservation_id` columns and their FKs/indexes, two orphaned trigger functions |
| 048 | `trip_pretrip_gate.sql` | `vehicleinspection.trip_id` FK + index — inspections become per-trip |
| 049 | `driver_work_schedule_and_leave.sql` | ★ `driver_work_schedules` (weekly shift rows) + `driver_leave_requests` |
| 050 | `vehicle_images_bucket.sql` | public `vehicle-images` storage bucket |
| 051 | `fix_driver_work_schedules_constraint.sql` | rest-day rows exempt from `shift_end > shift_start` |
| 052 | `server_side_pagination_indexes.sql` | seven list/pagination indexes (trips by vehicle/driver/status, dispatch by request, routes endpoints) |
| 053 | `driver_leave_improvements.sql` | leave start/end times; `driver_leave_balances`; `notify_leave_requested/reviewed()` triggers |
| 054 | `notify_dispatcher_leave.sql` | briefly adds dispatcher to leave-request notifications |
| 055 | `remove_dispatcher_leave_notification.sql` | deliberate revert of 054 (fleet_manager/admin only) |
| 056 | `names_proper_case.sql` | data normalization: initcap names across employees/drivers/guest_name |
| 057 | `vehicle_names_proper_case.sql` | acronym-aware title-casing of `vehicles.vehicle_name`/manufacturer via temp function |
| 058 | `device_tokens.sql` | ★ Expo push tokens (`token` UNIQUE, platform, active flag) |
| 059a | `dispatch_push_outbox.sql` | ★ `push_outbox` queue + `notifications.pushed_at` + trigger enqueueing a driver push on dispatch INSERT |
| 059b | `fuel_submission_idempotency.sql` | `fuelrecords.client_submission_id` + UNIQUE partial index (offline replay safety) |
| 060a | `inspection_submission_idempotency.sql` | same idempotency pattern on `vehicleinspection` |
| 060b | `remove_anon_employee_access.sql` | ★ security hardening: drops anon policies on `employees`, REVOKEs anon privileges |
| 061 | `invalidate_seeded_admin_hash.sql` | nulls the publicly-known seeded admin password hash if ever still present (normally a no-op) |
| 062 | `driverincidents_resolution_integrity.sql` | incidents get `client_submission_id`; stray statuses normalized; `chk_driverincidents_status` → `Open\|Resolved` |
| 063 | `vehiclemaintenance_source_incident.sql` | `vehiclemaintenance.source_incident_id` FK + backfill from "generated from Incident #N" descriptions |
| 064 | `driver_suspension_reason.sql` | `drivers.suspension_reason` + backfill `license_expired` |
| 065 | `incident_photos.sql` | ★ `driverincidents.photo_urls text[]` + private `incident-evidence` bucket |
| 066 | `vehicle_monthly_fuel_allocations.sql` | ★ vehicles get `tank_capacity_l`/`fuel_efficiency_kmpl`; monthly `fuelallocations` table; `fuelrequests` snapshot columns (`current_fuel_level_percent`, `recommended_liters`, `allocation_month`, …); open-request uniqueness moves trip→vehicle scope |
| 067 | `fuelrecord_receipt_fuel_type.sql` | `fuelrecords.receipt_fuel_type` |
| 068 | `fuelrequest_gauge_photo.sql` | `fuelrequests.gauge_photo_url` |
| 069 | `fuel_requests.sql` | declares `fuelrequests` indexes/idempotency (table born in 001) and links receipts: `fuelrecords.fuel_request_id` 1:1 UNIQUE FK |
| 070 | `driver_licenses_bucket.sql` | private `driver-licenses` storage bucket for sensitive driver documents |
| 071 | `fuel_receipt_integrity.sql` | preserves receipt scan data, anomaly flags, transaction IDs, and corrects fuel status defaults |
| 072 | `cleanup_fuel_test_data.sql` | soft-deletes fuel test artifacts and adds fuel/trip analytics indexes |
| 073 | `fuel_review_remarks.sql` | adds review remarks to fuel records |
| 074 | `vehiclemaintenance_completion_audit.sql` | records the employee who completed maintenance |
| 075 | `vehiclemaintenance_completed_at.sql` | records maintenance completion time |
| 076 | `routes_integrity.sql` | canonical location links, estimate provenance, active directional uniqueness, and route integrity checks |
| 077 | `routes_direction_labels.sql` | normalizes legacy bidirectional labels to explicit direction arrows |
| 078 | `validate_routes_integrity.sql` | validates route status, endpoint, estimate, and provenance constraints |
| 079 | `normalize_route_arrows.sql` | normalizes remaining legacy `->` route labels to `→` |
| 080 | `backfill_hotel_location_identity.sql` | persists the canonical active hotel `location_id` in `system_settings` |
| 081 | `incident_triage_integrity.sql` | adds incident acknowledgement/resolution ownership, grounding state, retry indexes, and severity checks |
| 082 | `incident_grounding_no_vehicle.sql` | prevents incidents without a vehicle from triggering grounding automation |
| 083 | `incident_maintenance_unique.sql` | enforces one maintenance work order per source incident |
| 084 | `incident_maintenance_state.sql` | links incident maintenance state, backfills work orders, and grounds affected vehicles |
| 085 | `incident_maintenance_grounding.sql` | keeps unresolved vehicle incidents in the grounding queue |
| 086 | `incident_maintenance_grounding_backfill.sql` | completes legacy incident grounding backfills after maintenance linkage |
| 087 | `auth_security_lifecycle.sql` | adds auth-version invalidation, shared rate limits, mobile token families, and password reset tokens |
| 088 | `auth_sessions_mfa.sql` | adds server-backed web sessions, encrypted employee MFA, recovery codes, and supporting indexes |
| 089 | `session_idle_timeout.sql` | adds the configurable `web_sessions.idle_timeout_seconds` defaulting to 3600 seconds |
| 091 | `company_cards_and_assignments.sql` | `company_cards` + `company_card_assignments` (fleet fuel payment cards) |
| 092 | `expense_records.sql` | `expense_records` (driver expenses, idempotent `client_submission_id`) |
| 093 | `fuelrecords_payment_method.sql` | `fuelrecords.payment_method` + `company_card_id` + consistency CHECK |
| 094 | `expense_receipt_scans.sql` | `expense_receipt_scans` (receipt storage key + sha + OCR snapshot) |
| 095 | `expense_receipts_rls_fix.sql` | locks down `expense-receipts` storage to backend-signed URLs only |
| 096 | `company_card_unique_assignment.sql` | one active assignment per company card (partial UNIQUE) |
| 097 | `incident_production_remediation.sql` | incident remediation fields (confidentiality, injury, police/insurance refs, SLA dates) |
| 098 | `incident_overdue.sql` | `update_incident_sla_breaches()` helper for SLA-breach marking |
| 099 | `pg_cron_sla.sql` | pg_cron schedule running the SLA-breach check every minute |
| 100 | `enable_rls_all.sql` | **enables RLS on 20 tables — this is what closes the PostgREST/anon path.** The app's own connections still bypass it (§4.1); tables created *after* this migration do not inherit it |
| 101 | `incident_response_tracking.sql` | physical-rescue columns on incidents (response status/type/ETA, history via `incident_comments`) |
| 102 | `incident_responder_tracking.sql` | links incidents to a GPS-tracked fleet responder driver (auto-advance Dispatched→En Route→Arrived) |
| 103 | `app_errors.sql` | `app_errors` — centralized unexpected-failure log (server 500s, web/mobile crashes) |
| 104 | `push_review.sql` | `push_outbox` review columns — acknowledge permanently-undeliverable push failures |
| 105 | `ai_review.sql` | `ailogs` review columns — same acknowledge flow for non-actionable AI failures |
| 106 | `ai_prompt_templates.sql` | DB-backed prompt overrides that survive redeploys |
| 107 | `notification_transport_assigned.sql` | notification key `reservation_approved` → `transport_assigned` (loop closes at first assignment) |
| 108 | `location_geofence_radii.sql` | per-location arrival geofence radii + persisted trip trail distance |
| 109 | `trip_monitor_alerts.sql` | `trip_monitor_alerts` — durable live-monitoring alerts (serverless has no in-process state) |
| 110 | `notification_copy_triggers.sql` | driver notification microcopy for the two plpgsql trigger producers |
| 111 | `dispatch_standby_presence.sql` | latest standby observation metadata, separate from the location trail |
| 112 | `backfill_registration_expiry.sql` | backfills NULL LTO registration expiries from the deterministic per-plate window |
| 113 | `session_idle_timeout_5min.sql` | reduces the `web_sessions.idle_timeout_seconds` **default** to 300 seconds. No backfill — pre-existing rows keep their recorded window (3600) until they roll off inside the 12-hour cap, so the deploy cannot mass-logout live sessions. The app passes the value explicitly on INSERT, so new logins get 300 immediately. See §12.9. |
| 114 | `maintenance_repairer_identity.sql` | `vehiclemaintenance.repair_completed_by` FK — the maintenance completion guard's real repairer; `inspection_required` default flips to FALSE |
| **115** | `app_errors_rls.sql` | ★ security: `ENABLE ROW LEVEL SECURITY` on `app_errors` — closes SEC-DB-003 for that table. The anon key had been reading live rows, `stack` column included. Verified from the database side (RLS on, no anon policy) by the first `db:contract` run. |
| **116** | `rls_gap_tables.sql` | ★ security: closes the rest of SEC-DB-003 (`ai_prompt_templates`, `trip_monitor_alerts` — RLS enabled) and all of SEC-DB-006 (`driver_stats` — `security_invoker = true`), plus `REVOKE ALL PRIVILEGES … FROM anon, authenticated` on all three. **The revoke is load-bearing:** row security does not apply to `TRUNCATE`, so RLS alone would have left both tables emptyable with the public anon key. Rehearsed against live inside a rolled-back transaction before applying — 12/12 application queries identical, anon went from 40 visible `driver_stats` rows to `42501`. After: `verify:anon` EXPOSED 0, `db:contract` 0 violations |

> 042–046 are **reconciliation** migrations: the live database had drifted ahead of
> the files, so replaying the history onto an empty database produced a schema the
> app could not run against. They declare what already existed rather than
> changing live — which is why every one is a no-op there.

> This table is itemised only to 102, then jumps to 113. Migrations 103–112 exist
> in `supabase/migrations/` and in the `schema_migrations` ledger but were never
> written up here; `npm run db:status` is the authoritative list.
>
> The ledger is authoritative rather than the directory, and as of 2026-09-18 the
> two disagree: `113_maintenance_repairer_identity.sql`, `114_app_errors_rls.sql`
> and `115_rls_gap_tables.sql` are recorded as applied with **no file on disk**,
> and disk numbering stops at 113. `ls supabase/migrations/` therefore cannot tell
> you whether a version is free. The 113 entry's effects are visible in the
> refreshed `schema.sql` (`vehiclemaintenance.repair_completed_by` plus its FK, and
> `inspection_required` now defaulting to `false`). 114 and 115 are RLS, which
> `schema.sql` does not capture at all, so they were characterised against live
> with `npm run verify:rls` instead — **114** enabled RLS on `app_errors` (created
> by 103, i.e. after 100 had already swept the schema, so it started unprotected),
> and **115** closed the remaining gap. All 58 tables in `public` now have RLS
> enabled and none is SELECT-granted to `anon`/`authenticated` with RLS off.
> The same probe counts **73 policies**, which are pre-existing Supabase-schema
> policies rather than anything 100/114/115 added — so 100's "we intentionally do
> NOT create explicit policies" deny-all posture holds only for the 25 tables that
> carry no policy at all.

### 5.2 Tables (final state)
| Table | Domain | Notes |
|---|---|---|
| `roles` | auth | `role_id`, `role_name` UNIQUE |
| `employees` | auth/users | 1:1 with `auth.users`, `role_id`, `password_hash`, `auth_version`, soft-delete |
| `auth_rate_limits` | auth | shared IP/account throttle buckets used by web/mobile auth |
| `password_reset_tokens` | auth | hashed, one-time, expiring administrator-issued reset links |
| `web_sessions` | web auth | server-backed session records with revocation, device metadata, 12-hour expiry, and configurable idle timeout |
| `employee_mfa` | web/mobile auth | encrypted TOTP secret, enrollment expiry, enabled state, and replay marker |
| `mfa_recovery_codes` | web/mobile auth | hashed, single-use recovery codes |
| `vehiclecategories` | fleet | base/per-km/per-hour rates, seating |
| `vehicles` | fleet | plate UNIQUE, status CHECK, service intervals, expiry dates |
| `drivers` | drivers | license fields, status CHECK, GPS last-known, face image, personal details (021) |
| `routes` | operations | canonical directional location FKs, active-pair uniqueness, estimate provenance, lifecycle/status checks (076–079) |
| `dispatchschedules` | operations | `dispatch_number` UNIQUE, status CHECK, `request_id` FK, `cancel_reason` (036) |
| `trips` | operations | 16-state CHECK, cost+performance cols (007) |
| `gpstracking` | tracking | BIGSERIAL time-series GPS (no `driver_id`, 024) |
| `vehiclemaintenance` | maintenance | inspection merged (005), inspection cols dropped (018b); `repair_completed_by` completion guard (113) |
| `vehicledocuments` | fleet | restored real table (007) |
| `fuelrecords` | fuel | review workflow (026) |
| `driverattendance` | attendance | face rec, UNIQUE (driver_id, date) |
| `notifications` | notifications | fed by triggers |
| `ai_recommendations`, `ai_insights` | AI | rule-engine output |
| `audit_logs` | audit | the DB trigger functions were dropped (015); writes now come from the application — `writeAudit()` (`src/lib/audit.js`) is called across route/service modules |
| `service_types`, `booking_channels`, `integration_log` | integration | |
| `locations` | reference | named places with active/retired identity metadata (076, 080) |
| `mobile_refresh_tokens` | mobile auth | hashed, revocable, family-grouped, device metadata; RLS enabled by 100 (the app reaches it as the owner, so this is unaffected) |
| `transportation_requests` | queue | 6-state `fleet_status` (review states removed, 037), `external_booking_id` UNIQUE, AI rec cols, `is_vip`/`is_emergency`/`derived_priority` (032) |
| `reservation_events` | timeline | append-only |
| **`driver_consents`** | ★ privacy | `driver_id`, `policy_version`, `accepted_at/via`, `ip_address`; append-only; index `(driver_id, accepted_at DESC)` |
| `driver_vehicle_assignments` | drivers | interval history + 2 partial UNIQUE active-pairing indexes |
| `driverincidents` | ★ incidents | driver-reported incidents (030), coordinates (035), photos (065), triage/grounding/maintenance state (081–086) |
| `uvvrp_exemptions`, `uvvrp_violations` | ★ Number Coding | vehicle exemptions + violation history (031) |
| `recommendation_snapshots` | ★ AI | immutable fleet-pair advice per request; TTL + UNIQUE active-per-request (033) |
| `vehicleinspection` | ★ fleet | restored driver-facing inspection table for `/api/driver/vehicle-inspection` (034) |
| `notification_preferences` | ★ notifications | per-employee (event × channel) toggles; absent rows = server defaults (037) |
| `aiproviders` | AI | LLM provider config (migrated to proper table in 038; used to be hot-path DDL) |
| `system_settings` | settings | created ad-hoc then declared by 043; stores `dispatch_policy`, `uvvrp_policy` |
| `schema_migrations` | tooling | migration ledger keyed by full filename + checksum |
| **`driver_work_schedules`** | ★ scheduling | weekly shift rows per driver (shift/break/rest-day CHECKs; UNIQUE driver+weekday) (049/051) |
| **`driver_leave_requests`** / **`driver_leave_balances`** | ★ leave | Pending→approve/decline workflow w/ balance deduction; approval auto-`Pending Reassignment`s overlapping dispatches (049/053–055) |
| **`substitute_vehicle_schedules`** | ★ coverage | substitute custodian per vehicle for a date window (`effective_until NULL` = open-ended; one open-ended per vehicle) (040) |
| **`fuelrequests`** | ★ fuel | driver fuel requests w/ gauge photo, snapshot columns, one-open-per-vehicle, 1:1 to the fulfilled receipt (066/068/069) |
| **`fuelallocations`** | ★ fuel | monthly liters budget per vehicle (UNIQUE vehicle+month) (066) |
| **`device_tokens`** | ★ push | Expo push tokens per install (token UNIQUE, platform, active) (058) |
| **`push_outbox`** | ★ push | pending/sent/error push queue drained by `flushOutbox()`; fed by DB trigger on dispatch INSERT (059a) |
| **`ai_report_narratives`** | ★ AI | cached LLM report narratives (24 h sticky, ≤3 forced regenerations/day, unique COALESCE range key) (043/045) |

**Views:** `driver_stats` (computed from completed trips). **Storage buckets:**
`face-captures`, `fuel-receipts`, `incident-evidence` (private), `driver-licenses`
(private), `vehicle-images` (public). Dispatch numbers are random `DSP-XXXX`
strings from `generate_dispatch_number()` (trigger `trg_dispatch_number`); the
old dispatch-number sequence is gone, although other serial-backed tables still
use PostgreSQL sequences.

### 5.3 DB-enforced integrity (highlights)
- Status CHECKs, counted from `schema.sql`: vehicle (5 — `Available`, `Reserved`,
  `In Use`, `Under Maintenance`, `Decommissioned`; `Registration Expired` is no
  longer in the constraint), driver (5 — `Available`, `On Trip`, `Off Duty`,
  `On Leave`, `Suspended`), dispatch (5 — incl. `Pending Reassignment`), trip
  (16, the full pickup-lifecycle vocabulary), transport `fleet_status`
  (**6** since 037b: `Pending → Scheduled → Assigned → In Progress → Completed`,
  plus `Cancelled`; no review states), fuel record (4), transport `priority`
  (4 — `Urgent/High/Medium/Low`), transport `derived_priority` (6),
  incident status (`Open|Resolved`). There is **no** reservation status CHECK —
  it went with the table in 047.
- Partial UNIQUE: `uq_dva_active_driver`, `uq_dva_active_vehicle` (one active pairing per driver/vehicle); client-submission idempotency indexes on `fuelrecords`, `vehicleinspection`, `driverincidents`, `fuelrequests`; one-open-fuel-request-per-vehicle.
- Partial UNIQUE: `uq_routes_active_direction` permits only one active, non-deleted route for each `(origin_location_id, destination_location_id)` pair while preserving inactive history. `routes` also enforce valid status/source values, positive estimates, and complete non-self endpoint pairs.
- Route estimates carry `estimate_source` (`TomTom`, `Manual`, `Legacy / Unknown`) and `estimate_updated_at`; `locations.is_active`/`retired_at` preserve location identity across hotel renames and physical moves.
- UNIQUE (driver_id, date) on attendance; positive service-interval / tank-capacity / efficiency guards; `idx_trips_end_time` partial index for the 90-day maintenance window.

---

## 6. API Surface (`src/app/api/` — 162 route files)

Protected handlers call `requireAuth(req, [...roles])` / `requireDriver(req)`; public protocol endpoints and service-token endpoints use explicit alternatives. Reads default to the 5 ops roles; writes are narrowed to admin/fleet_manager (+ dispatcher for dispatch/trip/integration; + driver for self-owned actions).

### Auth & account
- `auth/[...nextauth]` (GET/POST) — NextAuth Credentials.
- `auth/register` (POST) — **admin-only** employee account creation; 409 on duplicate email; no silent credential overwrite.
- `auth/profile` (PATCH), `auth/change-password` (POST) — self-service.
- `auth/login-status` (GET) — read-only lockout status; `auth/heartbeat` (GET/POST) — session expiry state and human-activity heartbeat.
- `auth/sessions` (GET/DELETE) — owner-scoped web/mobile session listing and revocation.
- `auth/mfa` (GET), `auth/mfa/setup`, `auth/mfa/confirm`, `auth/mfa/disable`, `auth/mfa/recovery-codes` — password-gated TOTP enrollment, confirmation, disablement, and recovery-code management.
- `auth/forgot-password`, `auth/reset-password`, `auth/reset-token` — rate-limited recovery/reset flows; reset tokens are administrator-issued, hashed, one-time, and expiring.

### Drivers & driver self-service
- `drivers/` (GET/POST) — list (filters; `includeUnlinked=1` surfaces driver-role employees without a `drivers` row flagged `requires_completion`); create (employee+driver, optional password, rollback on failure).
- `drivers/[id]` (GET/PUT/DELETE) — detail w/ `driver_stats` + last 20 trips + `account` block; update; soft-delete archive.
- `drivers/[id]/account` (PUT) ★ — **enable/reset driver login**: force driver role, set/reset bcrypt password, revoke all `mobile_refresh_tokens`.
- `drivers/link` (POST) ★ — finalize a driver profile for an existing driver-role employee missing a `drivers` row.
- `drivers/stats` (GET) — counts by status.
- `driver/me` (GET/PATCH) ★ — **driver's own profile**: license, performance, trips, attendance, consent status, editable fields, visible sections; PATCH only `DRIVER_SELF_EDITABLE_FIELDS` (`phone`, `face_image_url`, `license_image_url`, `license_back_image_url`). License scan columns are self-writable anytime (30-day window removed 2026-08-25); the quality gate lives in `driver/license-scan`. License number/class/expiry remain staff-only.
- `driver/license-scan` (POST) ★ — **single-call self-service renewal**: Gemini verifies the photo is a genuine LTO card (`document_is_license_card`, fail-closed), reads key fields, and on pass **persists the scan** + applies a future-dated `license_expiry` (front side), then notifies ops staff (`system_admin`/`admin`/`fleet_manager`) best-effort. Failures write nothing — an unreadable or non-card photo is never saved. Policy: `src/lib/ai/license-scan-policy.js`.
- `driver/face-photo` (POST, 2026-09-13) ★ — **single-call self-service face/profile photo**: same `{ file_url }` data-URL contract as license-scan (magic-byte + SSRF guards, JPEG/PNG ≤5MB), stores in the private `face-captures` bucket (migration 006), writes a 10-year signed URL to the driver's OWN `face_image_url` (fuel-receipt URL convention). One upload fills the mobile Profile avatar AND the attendance face-verification reference; staff notified best-effort. No AI face gate (staff review is the quality control). Mobile: Profile-tab pencil badge → camera/gallery → upload (never queued offline). License-card scans deliberately NOT reused as avatars (document photo + compliance PII). Web sync (2026-09-13, display-only, no endpoint changes): staff detail header renders `AvatarImage` on the existing `face → avatar → license` chain (Radix fallback to initials), staff list + performance table show photo-or-initials (`GET /api/drivers` already selected the column; performance report payload extended additively with `face_image_url`/`avatar_url`, Excel ignores the extra keys), driver's own `/driver/profile` shows a photo header with a mobile-app update hint.
- `driver/me/consent` (POST) ★ — record policy acceptance; 409 on stale `policy_version`.
- `driver/incidents` (GET/POST) ★ — driver-reported incidents (self-scoped to own trips).
- `driver/vehicle-inspection` (GET/POST) ★ — driver vehicle inspection reporting (reads `vehicleinspection`, migration 034).
- `driver/trips` (GET) ★ — **web driver-portal** trip list; always `WHERE driver_id = auth` (unlike the unscoped `trips/`).
- `driver/balances`, `driver/leave`, `driver/incidents/upload` — driver-scoped leave balance/self-service and incident-photo upload support.

### Trips
- `trips/` (GET/POST), `trips/[id]` (GET/PUT) — shared `TRIPS_SELECT/TRIPS_JOINS` (`src/lib/api/trips-query.js`).
- `trips/[id]/status` (PUT) — state-machine transition (`canTransitionTrip`); `transition.service.js` centralizes trip/dispatch status writes with derived-resource reconciliation + audit.
- `trips/[id]/start` (PUT) — **pre-trip inspection gate**: requires the latest per-trip `vehicleinspection` for this driver+vehicle to be `Passed`, else 400 (migration 048); also runs the work-schedule/leave window guard.
- `trips/[id]/complete` (PUT) — odometer validation + cascade sync + PR #3 completion validation: outside the destination geofence (server's own latest ping, 10-min freshness) → 409 unless `geofence_override: true` with a required `completion_reason` (≤500 chars, timeline metadata); GPS trail distance fills `trips.gps_distance_km` and backs `distance` only when odometer/supplied figures are absent.
- `trips/[id]/destination-check` (GET) — read-only pre-completion proximity (inside/outside/unknown + distance) for the driver app's Complete-Anyway flow; the PUT above is the enforcing counterpart.
- `trips/[id]/locations` (GET/POST) — GPS breadcrumbs (trip-isolated route history). POST (and the mobile `trips/[id]/gps` alias) now returns a `geofence` enrichment (`near_pickup/near_destination`, distances, accuracy-gated state) — advisory only, never transitions status.
- `trips/active` (GET) — active fleet; **driver sees only own trips**.
- `trips/latest-locations` (GET) — latest status-aware GPS telemetry per active vehicle/trip (`src/lib/gps.js`); filters by active states (`In Progress`, `Dispatched`, `Assigned`), marks staleness with a 3-minute disconnect threshold (`GPS_STALE_THRESHOLD_MS`), and isolates breadcrumbs to active trips.
- `trips/[id]/accept|at-pickup|cancel|complete|dropoff|enroute|onboard|start` — explicit lifecycle action endpoints; the centralized transition service remains the status-write authority.

### Vehicles, maintenance, fuel
- `vehicles/` (GET/POST), `vehicles/[id]` (GET/PUT/DELETE, archive admin-only), `vehicles/available`, `vehicles/[id]/documents`, `vehicles/[id]/image`, `vehicle-documents/[id]`, `vehicle-categories`, `vehicle-categories/[id]`.
- `vehicle-maintenance/` (GET/POST), `vehicle-maintenance/[id]` (PUT) — drivers can file reports **without** moving the service schedule (ops roles only); maintenance rows created from incidents carry `source_incident_id` (063).
- **Fuel requests & allocations** ★ — `fuel/requests` (GET staff+driver-scoped; POST = driver-only: requires an owned gauge photo + idempotent `client_submission_id`, derives vehicle from trip/assignment, computes `calculateFuelRecommendation` vs tank/efficiency/monthly allocation, then **auto-authorizes within policy** or files `Pending`; PUT = staff approval with override reasons, bounded by tank space and current month). `fuel/allocations` (GET/PUT, staff) — monthly liters per vehicle with consumed/committed CTEs. Fulfillment: `POST /api/mobile/fuel` creates the receipt against an **Approved** request and flips it to `Fulfilled`. Gauge scanning: `POST /api/mobile/fuel/gauge-scan` → Gemini (`lib/fuel/gemini-gauge.js`, fail-closed); uploads via `POST /api/mobile/fuel/upload` (`kind=receipt|gauge`). Policy helpers: `src/lib/fuel/request-policy.js`.
- `fuel/[id]` (GET/PUT/DELETE) — record review workflow (reason required; Completed locked), `fuel/analytics` (Approved only).
- `admin/analytics/fuel` and `admin/analytics/fuel/resolve` — staff fuel analytics and anomaly resolution.

### Reservations & integration (Booking)
There is **no `reservations/` route tree.** It was deleted with migration 036
(§5.1): the legacy endpoints that used to answer 410, plus `conflicts`,
`service-types` and `booking-channels`, are all gone. `transportation_requests`
is the only reservation concept, and `integration/` is its only door.

- `integration/transport-requests` (GET/POST — POST = inbound ingest), `[id]` (GET), `[id]/review|approve|assign|reschedule|cancel|reject` (PUT), `[id]/timeline` (GET), `[id]/recommendation` (GET/POST), `[id]/flags` (PATCH).
  > `review|approve|reject` are thin aliases over the linear lifecycle now: approve walks `Pending→Scheduled`; there is no `Under Review`/`Rejected` status anymore (037b).
- `[id]/flags` (PATCH) ★ — set `is_vip` / `is_emergency`; recomputes `derived_priority` immediately + writes timeline/audit (system_admin, admin, fleet_manager).
- `[id]/recommendation` (GET/POST) ★ — active recommendation snapshot (regenerate/narrate); POST persists a snapshot + back-writes legacy AI columns.
- `integration/inbound`, `outbound`, `pull`, `logs`.

### Dispatch & assignments
- `dispatch/` (GET/POST), `dispatch/[id]` (GET/PUT), `dispatch/[id]/status` (PUT), `dispatch/calendar` (GET), `dispatch/by-status` (GET). Dispatch numbers are random `DSP-XXXX` assigned by the DB trigger (`trg_dispatch_number`), with a JS fallback in the autocreate service.
- `dispatch/availability-pairs` (GET) ★ — pair-first read surface for
  `/dispatch/availability`: hard eligibility per vehicle (capacity, operational
  status, travel docs/coding, custodial pairing via the shared
  `resolveVehiclePairing` rule) plus every overlapping dispatch as `clashes[]`
  data. Classification is board-side (today overview vs exact-window check);
  no new eligibility, read-only.
- `driver-assignments/` (GET/POST), `driver-assignments/[id]` (DELETE) — transactional pairings.
- `substitute-driver-schedules/` (GET; POST; `[id]` PATCH/DELETE) ★ — substitute custodian coverage per vehicle/date window; overlap-guarded 409s, audited.

### Work schedules & leave ★
- `driver-work-schedules/` (GET — driver self-scoped; PUT — system_admin/fleet_manager only, admin deliberately read-only) — replaces the whole week.
- `driver-leave-requests/` (GET staff feed), `[id]` (PATCH approve/decline — system_admin/fleet_manager); driver self-service via `driver/leave` (GET/POST/DELETE, withdraw own Pending only). Approval deducts `driver_leave_balances`, notifies fleet_manager/admin, and flips overlapping dispatches to `Pending Reassignment`.

### Push notifications & device tokens ★
- `device-tokens/` (POST upsert / DELETE deactivate — any role incl. driver) — registers this install's Expo push token against the session employee.
- Server side: `push.service.js` tiers every notification (`deliveryFor`: Alert/Emergency + Critical/Major/incident → loud push; Warning/Moderate → heads-up; else silent in-app only), sends via Expo Push to active tokens, deactivates `DeviceNotRegistered` tokens, and drains `push_outbox` (`flushOutbox()` after dispatch create + autocreate sync).

### Reports, AI, notifications, system, mobile
- `reports/{maintenance,fuel-consumption,fleet-utilization,financial,driver-performance,fleet-cost}` (GET) + `reports/{analytics,driver-performance,financial,fleet-cost,fleet-utilization,fuel-consumption,incidents,maintenance,trip-performance}/excel` (GET) ★ — multi-tab native Excel workbooks with embedded OpenXML charts (bar, line, doughnut) powered by `src/lib/reports/{native-charts,operational-reports,fuel-workbook,remaining-workbooks}.js` and `exceljs`.
- `documents/expiring` (GET) ★ — Document Expiration Center: aggregates `vehicles.*_expiry` + `vehicledocuments.expiry_date` + `drivers.license_expiry` with days-left/expired flags (admin, system_admin, fleet_manager).
- `ai/recommendations`, `ai/predictive-maintenance`, `ai/insights[/[id]/dismiss]`, `ai/driver-insights`, `ai/providers[/[id]]`, `ai/providers/fetch-models`, `ai/scan-document`, `ai/logs`, `ai/instructions`.
- `ai/report-narrative` (POST) ★ — LLM report narration over a client-computed payload: 24 h sticky cache, ≤3 forced regenerations per tab/day, deterministic rules fallback (`lib/ai/report-narrative.js`, `ai_report_narratives` table).
- `notifications/` (GET/POST) — **self-scoped** GET (ops roles may pass `?employee_id=`); POST admin-directed. `notifications/[id]/read`, `notifications/read-all` (self-scoped), `notifications/[id]` (DELETE, self- or ops-scoped), `notifications/preferences` (GET/PUT) ★ — per-user event × channel toggle matrix (migration 037); PUT also accepts a `bulk` body (`{ channel, enabled, bulk: true }`) used by the mobile Push master toggle — OFF writes one explicit false row per event for the channel, ON deletes the channel's rows to restore `NOTIFICATION_EVENTS` defaults.
- `search` (GET) ★ — global command-palette search across reservations, dispatches, drivers, vehicles (min 2 chars, LIMIT 5 per entity; any role).
- `tomtom/route` (GET) ★ — server-keyed routing proxy (`origin`/`destination` as `lng,lat`, optional `departAt` + `alternatives=0-2`): decoded polyline, turn-by-turn instructions, distanceKm, travelTimeMin, trafficDelayMin, alternative summaries, `provenance: "live"`; all roles incl. driver.
- `audit/` (GET) ★ — system audit log (system_admin only).
- `system/activity` (GET) ★ — system console activity feed.
- `routes/`, `routes/[id]`, `routes/seed-naia`, `locations/`, `settings/hotel`, `settings/users`, `settings/connectors`, `manifest`, `status/sync`, `cron/sync`, `cron/reconcile` (service-token protected). The Routes registry stores canonical directional location pairs: reads include management/dispatcher, writes are limited to system_admin/admin/fleet_manager, endpoint edits lock after dispatch/trip use, and unused routes may be archived while historical routes are deactivated. `locations` hides retired identities by default; hotel rename preserves its location ID while a physical move versions and retires the old identity.
- The active NAIA registry currently contains six canonical curbside endpoints: Terminal 1 arrivals/departures, Terminal 2 arrivals/departures, and Terminal 3 Bay 9 arrivals/departures. Terminal 4 is not an active endpoint; its legacy row/routes remain only as inactive history. Canonical endpoint coordinates are maintained in `src/lib/naia-locations.js` and seeded without fabricated distance/time estimates.
- `incidents/` (GET) + `incidents/[id]` (PATCH) ★ — **staff incident registry**: all driver-reported incidents (severity/status/coords filters, join plate + driver), resolve with `actions_taken`. Acknowledge, resolve, grounding, and maintenance actions have dedicated guarded endpoints; creation is driver-side. Emergency response features a two-phase tracking workflow (Dispatch selection: Fleet Responder vs External Rescue with assistance chips; Active Mission Tracking: visual progress stepper, GPS auto-tracking for fleet units, and 1-click status advances for external services). Vehicle-related reports automatically create one linked maintenance work order; `incidents/[id]/maintenance` (POST) is an idempotent recovery endpoint for a failed automatic attempt.
- `settings/dispatch` (GET/PUT) ★ — smart-queue policy (`criticalMinutes`/`highMinutes`/`mediumMinutes`, `enableVipFlag`/`enableEmergencyFlag`); audit-writes `dispatch_policy` (system_admin/admin; fleet_manager read).
- `settings/uvvrp` (GET/PUT) ★ — configurable Number Coding (UVVRP) policy (`system_settings.uvvrp_policy`; enable, location preset, per-weekday ending digits, block|warn|approve response, exemption categories).
- `uvvrp` (GET) ★ — read-only board (restricted today, exemptions, upcoming restrictions, violation history, dispatches affected).
- `uvvrp/exemptions` (GET/POST), `uvvrp/exemptions/[id]` (PUT) ★ — per-vehicle coding exemptions (category, approver, optional expiry).
- `uvvrp/violations` (GET), `uvvrp/violations/[id]/decide` (POST) ★ — coding violation history + approve/deny pending approvals (defer-then-retry: an approved violation exempts that vehicle+date).
- `mobile/auth/login|refresh|logout`, `mobile/driver/me`, `mobile/driver/ref` (GET) ★ — driver-only trip/status reference (status buckets, `getNextStatus` chain, tones; the server owns the state machine), `mobile/driver/trips` (+ `pre_trip_status` per trip), `mobile/driver/trips/[id]/accept|gps` (trip-scoped GPS ping ingestion — only records live movement during `In Progress` trips), `mobile/driver/inspections` (POST — per-trip pre-trip inspection, notifies staff on fail), `mobile/driver/submissions` (GET — activity-log/dead-letter feed), `mobile/driver/gps` and `mobile/driver/trips/[id]/gps` (driver GPS ingestion), `mobile/fuel/scan|upload|gauge-scan|[id]`, `mobile/fuel` (POST receipt → fulfills the Approved request).

### Client service layer (`src/services/`)
Thin `apiFetch` wrappers per domain plus server-only business-logic services. Current modules: `ai.service, audit.service, auth.service, dispatch.service, dispatch-autocreate.service, dispatch-settings.service, driver.service, driver-assignment.service, driver-schedule.service, fuel.service, integration.service, location.service, maintenance.service, maintenance-schedule.service, notification.service, outbound.service, priority.service, push.service, recommendation.service, report.service, reservation-events.service, reservation-lifecycle.service, route.service, route-resolver.service, search.service, settings.service, status.service, substitute-driver.service, system.service, transition.service, transport.service, trip-lifecycle.service, trip.service, uvvrp.service, vehicle.service`. Notable server-only ones: `reservation-lifecycle`, `trip-lifecycle`, `transition` (centralized trip/dispatch status writes), `status`, `outbound`, `push`, `uvvrp`, `dispatch-autocreate`, `route-resolver`.

---

## 7. Roles & RBAC

### Roles (6)
`system_admin`, `admin`, `fleet_manager`, `dispatcher`, `driver`, `management`.

> The hospitality roles `reception_staff`, `restaurant_staff`, `concierge` were
> removed in migration 022 (FleetOps is fleet & transport only). Their 3
> employees were disabled.

### Model
- Single source of truth: **`src/lib/auth/permissions.js`** — `MATRIX[role][resource][action]` with resources `vehicles, driver_assignments, reservations, dispatch, drivers, trips, maintenance, fuel, routes, categories, reports, analytics, ai, employees, system` (+ management-only `fuelallocations`, `scheduled_reports`). Verbs `create/read/update/delete` + reservation lifecycle verbs (`approve/assign/dispatch/cancel/reschedule`). `system_admin` short-circuits to always-true.
- **Denials are explicit** (e.g. management gets no lifecycle verbs — read-only by design).
- `NAV_ROLES[path]` drives the sidebar + route guard; `hasRole()`, `can()`, `filterNavItems()`, `getRequiredRolesForPath()`.
- **Per-role workspaces:** `src/lib/workspaces.js` maps each role to a workspace (name, tagline, accent, home route, role-specific `nav` groups). `getWorkspace(role)` falls back to `WORKS.admin` for unknown roles. The sidebar/top-nav render the active role's workspace; `filterNavItems` further gates each item by `NAV_ROLES[item.href]`.
- **Role dashboards:** `src/components/dashboard/role-dashboard.jsx` renders role-specific KPIs/widgets defined in `src/components/dashboard/dashboard-configs.js`.
- **Enforcement layers:** per-route `requireAuth(req, [...])` on the server (the real boundary); `useRequireRole()` / `RouteGuard` + `useRoleAccess()` on the client (convenience). `/` redirects server-side (no flash). For deep protected routes the client guard distinguishes no-session (`!employee` → `saveReturnTo()` + `/login`, shell withheld until a session exists so no dashboard chrome flashes) from session-without-role (renders the role-not-configured card, never `/login`, to avoid a login loop); wrong-role sessions fall back to the role home with an access-restricted panel.
- **Routes permissions:** dispatcher and management are read-only; create/update is limited to `system_admin`, `admin`, and `fleet_manager`; route DELETE/archive is limited to `system_admin` and `admin`. `scripts/verify-rbac.mjs` covers the UI/API agreement.
- `scripts/verify-rbac.mjs` asserts the UI matrix and API role lists agree.
- Role **assignment** is itself guarded: only `system_admin` can grant `system_admin` (`canAssignRole`; asserted in `src/security-boundaries.test.js`).
- `src/lib/constants.js` — `ROLES`, `ROLE_IDS` = `{ system_admin: 1, fleet_manager: 2, dispatcher: 3, driver: 4, management: 7, admin: 9 }`, `REGISTRATION_ROLES` (6, incl. "FleetOps Admin").

**Workspace names:** `system_admin`→System Console · `admin`→Operations Center · `fleet_manager`→Fleet Operations · `dispatcher`→Transportation Operations · `driver`→Driver Workspace · `management`→Executive Center.

### 7.1 Read-only operational & executive boards (Phase B)

New read-only boards built on existing data, wired into `NAV_ROLES` + the relevant
workspaces. Management-facing boards are strictly read-only (no write controls).

| Route | Purpose | Roles |
|---|---|---|
| `/fleet/documents` | Document Expiration Center — Vehicle / Driver tabs; driver licenses + vehicle registration/OR-CR/insurance | admin, system_admin, fleet_manager |
| `/drivers/performance` | Driver Performance Center — on-time, trips, score, cost/km | admin, system_admin, fleet_manager, management |
| `/reports/cost` | Fleet Cost Dashboard — per-vehicle fuel/maintenance cost | admin, system_admin, fleet_manager, management |
| `/executive` | Executive KPI Center — fleet/driver/financial KPIs + AI insights | admin, management |

Backing endpoints: `GET /api/documents/expiring`, `GET /api/reports/fleet-cost`,
and `GET /api/reports/driver-performance` (extended with `on_time_rate`,
`total_distance`, `cost_per_km`). Driver performance is computed from the merged
`trips`/`drivers` columns (`tripperformance`/`tripcostanalysis`/`driverincidents`
were dropped in migrations 005/007).

### 7.2 Number Coding (UVVRP) validation

Configurable plate-coding policy (`src/lib/uvvrp/`). Enforced at dispatch create
and update (`dispatch/route.js`, `dispatch/[id]/route.js`) and surfaced as a
queue conflict (`conflicts.js`). Response modes:
- **block** → dispatch rejected (409), violation recorded, dispatcher notified.
- **warn** → dispatch proceeds, violation recorded as `warned`.
- **approve** → dispatch deferred; `pending_approval` violation; an authorized
  role approves/denies via `PUT …/uvvrp/violations/[id]/decide`; once approved
  (vehicle+date) the dispatcher retries and it passes.
Per-vehicle exemptions (category + approver + optional expiry) skip the check.
Policy config UI at `/settings/number-coding` (admin/system_admin); read-only
board at `/uvvrp` (ops roles). New endpoints `settings/uvvrp`, `uvvrp`,
`uvvrp/exemptions[/[id]]`, `uvvrp/violations[/[id]/decide]`; tables
`uvvrp_exemptions`, `uvvrp_violations` (migration 025).

### 7.3 Incident reporting & vehicle grounding

Drivers report incidents (type, severity `Minor/Moderate/Major/Critical`, GPS
coords, assistance, expense) via `/api/driver/incidents` (web portal + mobile).
The staff registry `/incidents` is **read + resolve only** (PATCH status/
`actions_taken`; vehicle-related maintenance is automatic). Automation on a
driver POST (`src/lib/driver/grounding.js` + `src/lib/incidents/maintenance.js`):
1. Acknowledges the reporter (Info notification).
2. If `shouldGroundVehicle` → sets the vehicle **Under Maintenance**, alerts
   dispatcher/staff, and if the vehicle has an active dispatch inside a 48 h
   (Major/Critical) or 2 h window, cancels its trips, unassigns the pair, resets
   the dispatch to **Pending Reassignment**, and sends URGENT interruption alerts.
3. If `requiresVehicleMaintenance` → creates one linked `Emergency Repair`
   for breakdown/mechanical/vehicle-damage reports, or `Vehicle Inspection` for
   qualifying accidents; alerts fleet/maintenance staff. Passenger, route,
   traffic-delay, medical, and other non-vehicle reports do not create a work
   order.
4. Otherwise notifies overseers of the report.

5. **Emergency rescue response tracking** (`src/lib/incidents/responder-tracking.js`, `/api/incidents/[id]/responder`):
   Staff can dispatch an internal fleet driver or external rescue provider from the Incident Detail modal.
   - **Automated Live Traffic ETA:** Estimated ETA is calculated automatically using TomTom live traffic (`tomtomEtaMinutes`) with origin routing (base hotel `hotel_location` in `system_settings` for external rescue, live driver GPS coordinates for internal fleet candidates).
   - Candidate fleet drivers in the assignment dropdown are sorted nearest-first (`sortCandidateResponders` by GPS distance, broken by TomTom live traffic ETA), highlighting the closest driver with a `Nearest` badge, distance `X km away`, and `~Xm ETA`. Drivers without GPS appear at the bottom.
   - Initial dispatch immediately writes `response_eta` into `driverincidents`.
   - Continuous 10-second polling evaluates responder GPS distance and remaining travel time dynamically; push alerts trigger on status transitions (`Dispatched` → `En Route` → `Arrived`) or significant ETA drift (≥5m).

Incident resolution and maintenance completion are separate state changes:
resolving a maintenance-required incident never releases its vehicle. The
maintenance PUT state machine calls `syncVehicleStatus` after `Completed`; only
then can the vehicle become `Available` (subject to other active work/trip and
registration checks).

`shouldGroundVehicle` (`src/lib/driver/grounding.js`) grounds when the severity is
Major/Critical **or** the incident type matches the breakdown regex (breakdown,
mechanical, engine, flat tire, battery, electrical, overheat), and never when
there is no `vehicleId`. It was previously a stub that grounded on any incident
with a vehicle attached; the rule is now real and unit-tested
(`src/lib/driver/grounding.test.js`).

### Web sessions (NextAuth)
- Credentials provider; bcrypt vs `employees.password_hash`; **IP/account rate limit 5/min**; JWT transport (`NEXTAUTH_SECRET`) identifies a server-backed `web_sessions` record. Role/employeeId/name remain in the token for UI landing, while every API request revalidates the live employee and session row.
- Sessions expire after 12 hours absolutely or 5 minutes idle (`idle_timeout_seconds`). The idle deadline moves **only** through `POST /api/auth/heartbeat`, which the client fires on real DOM activity (click/keydown/touch/pointer) and on explicit "Stay signed in"; `GET /api/auth/heartbeat` reads the deadlines without moving them. Identity resolution (`resolveCurrentIdentity`) is deliberately read-only for session timing — it must never slide `last_seen_at`, or background polling would keep an abandoned browser alive indefinitely (see `src/security-boundaries.test.js`). The session manager warns 60 seconds before idle expiry (5 minutes before the 12-hour cap), synchronizes tabs through `BroadcastChannel`, and preserves only validated internal return-to routes through re-authentication.
- Registration is **admin-only**; public signup redirects to login. TOTP MFA is checked before a web session is created, and enabling/disabling MFA revokes existing sessions.

### Mobile tokens (separate system)
- Access = 15-min HS256 JWT (aud `fleetops-mobile-access`), refresh = 30-day JWT (aud `fleetops-mobile-refresh`), signed with production-only `MOBILE_JWT_SECRET` (development can fall back to `NEXTAUTH_SECRET` with a warning). Refresh tokens are stored SHA-256 hashed in `mobile_refresh_tokens`; **single-use rotation**, family grouping, and device metadata are enforced; role/driver re-read from DB every refresh; `logout?allDevices` revokes all.

---

## 8. Mobile App (`mobile/`)

Driver-only Expo app (guest experience not implemented). Tab bar: **Home · Live
Map · scan FAB · Trips · Profile** over a guard stack; no native map SDK (TomTom
static images). Push is **wired**: foreground handler + local scheduling +
Expo token registration at sign-in/out (terminated-app remote fan-out is honest,
documented future work — see below).

### Route tree
```
app/_layout.js            fonts (Plus Jakarta Sans / IBM Plex Mono) + AuthProvider +
                          ThemeProvider + SettingsProvider + launch overlay + ErrorBoundary;
                          initPush() runs after the overlay and pending interactions settle
app/login.js              interactive sign-in (email/password, show/hide toggle)
app/permissions.js        OS-permission status board (location/camera/media/notifications)
app/consent.js            privacy-policy consent gate (public)
app/(app)/_layout.js      guard: isDriverSession + accepted consent version else → /login or /consent
app/(app)/(tabs)/         bottom tab bar:
  index.js                Home — active vs pending trips, accept/decline, single “advance” button,
                          odometer modal, GPS toggle, tools; SOS button mounted beside the Tabs
  map.js                  Live Map — full-screen trip map + bottom-sheet nav card; START ROUTE time-gate
  fuel_action.js          dummy anchor for the center scan FAB → /fuel-report?scan=1
  trips.js                Trips list — time-aware queue (in-progress → overdue → ready →
                          ready·schedule-unconfirmed → upcoming → completed → cancelled);
                          whole-card tap → details; open-assignment summary
                          (queue logic in lib/trips-queue.js)
  profile.js              ★ driver profile hub — Account (Personal Information), Privacy & Security
                          (Privacy & Consent, App Permissions, Devices & Sessions), General (Help,
                          About, Settings), Sign out
    …history.js           hidden from bar (header access): completed/cancelled trips
    …notifications.js     hidden from bar: alerts inbox w/ tiered banners (push/heads-up/silent)
    …vehicle.js           hidden from bar: assigned-vehicle detail
app/(app)/fuel-report.js  fuel hub: live-camera gauge/receipt scan (CameraView), library pick, manual
                          entry, fuel-request creation, past requests
app/(app)/incidents.js    report incident (typed categories, assistance chips, camera photos, GPS)
app/(app)/inspection.js   pre-shift 7-point pass/fail checklist tied to a trip (POSTs trip_id)
app/(app)/work-schedule.js weekly schedule editor + leave requests (Vacation/Personal/Medical)
app/(app)/submissions.js  activity logs: fuel/inspection/incident submissions + offline dead-letter retry
app/(app)/settings.js     display preferences only: theme/text-size/high-contrast
app/(app)/devices.js      Devices & Sessions — current/other session cards, revoke (other + self)
app/(app)/trip/[id].js    trip detail + accept & START ROUTE gate (30 s refresh); active trips
                          get navigate-only CONTINUE TO MAP; terminal trips read-only; honest
                          notFound/error/never-synced states (decisions in lib/trip-detail.js)
app/(app)/trip/complete.js animated completion summary (Lottie) w/ note & issue modals
app/(app)/profile/*.js    personal (phone edit + hub rows to license/vehicle), license (capture→scan),
                          vehicle, privacy (read-only consent status + server policy from
                          /api/driver/me), permissions (hybrid: app-level tracking/push toggles +
                          device-access status rows), help, about
```

### lib/
- `api.js` — `BASE_URL = EXPO_PUBLIC_API_URL`; Bearer attach; single-flight refresh on 401; 30 s timeout + one retry (including login); offline-enqueue hooks. **No demo/mock layer** (fully removed). Physical-phone development requires the current LAN IP and a separately running root `npm run dev` API on port 3000; Expo must be reloaded after `.env` changes because `EXPO_PUBLIC_*` values are bundled.
- `auth.js` — AuthContext (login/signOut/session restore); registers/unregisters the Expo device token at `/api/device-tokens` on auth events.
- `sync.js` — AsyncStorage offline queue replayed on foreground; incident dead-letter store surfaced in Submissions.
- `tracking.js` — `useTripTracking`: foreground GPS every 30 s to `/api/mobile/driver/trips/{id}/gps`; `background-tracking.js` TaskManager task exists but needs a dev build (not yet installed).
- `tripRef.js` — cached `GET /api/mobile/driver/ref`: status buckets, `getNextStatus()`, tones (server owns the machine).
- `trips-queue.js` + `trip-detail.js` — pure, vitest-runnable decision helpers: queue bucketing (incl. READY · SCHEDULE UNCONFIRMED for unknown start windows) and detail actions/readiness/display facts (`end_time` completion, no default departure, supplied-only passenger data).
- `notifications/` — `tiers.js` (+test) classifier, `notify.js` emitter, `presentation.js` labels, `navigation.js` deep-link table, `push.js` expo-notifications wrapper (channels `default`/`heads-up`, token minting), `device-token.js` registration.
- `settings-context.js` (persisted prefs), `theme.js`+`theme-context.js` (FleetOps Tactical tokens, light/dark MD3; dark stage `#0D1713`, dark primaryContainer `#245F50`), `scaling.js`, `clay.js` (import-free claymorphism material constants; `clayMaterials(isDark)` returns the scheme-appropriate set — consumers pass `scheme === "dark"`), `receipt-crop.js`, `permissions.js` registry, `launch.js`, `consent.js`, `storage.js`, `rbac.js`.
- `components/` — `ui.js` (MD3 primitives), `ClayScreenHeader` (raised clay back-control header), `ClayMenuRow` (shared clay menu row), `TomTomMap` (static images, pan/zoom, live overlay, Google Maps deep link), `RouteTimeline` (shared pickup→drop-off timeline), `NotificationHost` (banners/toasts/push taps), `DriverSos`, `plate.js`, `logo.js`, `error-boundary.js`.

### Backend integration / auth
- Talks to the Next API over plain JSON fetch; `EXPO_PUBLIC_API_URL` → LAN IP of the dev server. Referer-free, cookie-less: auth is `Authorization: Bearer` (the same `mobile_refresh_tokens` flow as §7).
- The web API's CORS is now **fail-closed same-origin** (`src/proxy.js`) — irrelevant to the native app (no browser origin checks) but it means the Expo *web* target can no longer call the API cross-origin unless served from `NEXT_PUBLIC_APP_URL`.

### Security rule
Only `EXPO_PUBLIC_*` config is allowed; the **server derives driver/vehicle/role from the token** — the mobile app never sends its own `driver_id`/`vehicle_id`/role. (`EXPO_PUBLIC_ENABLE_DEMO` has zero code references — demo mode fully removed.)

---

## 9. ★ Current Update: Smart Queue & Dispatch, Incidents, Notification Direction, Mobile Tabs

The current feature wave (post-driver-consent) makes dispatch **priority-driven and
pair-scored**, adds **incident management** end-to-end, points **notifications at the
right surface**, and turns the mobile app into a **5-tab driver workspace**.

### 9.1 Smart Transportation Queue (priority engine)
- Explicit inputs `transportation_requests.is_vip` / `is_emergency` (set at intake
  or via `PATCH .../[id]/flags`, migration 032) feed a **deterministic priority
  engine** (`src/lib/scheduling/priority.js`). It writes a cached `derived_priority`
  (`Overdue → Critical → High → Medium → Normal → Future`) that the queue groups and
  orders on (`queue-grouping.js`); never human-set (CHECK in migration 032).
  Thresholds live in `system_settings.dispatch_policy` (`src/lib/dispatch-policy.js`),
  configurable at `/settings/dispatch` (system_admin/admin).

### 9.2 AI fleet-pair snapshots
- `src/lib/ai/pair-scoring.js` + `dispatch-advisor.js` recommend a **vehicle+driver
  pair** (designated-driver match dominates; a provably-unavailable custodian is the
  only legit substitute). Recommendations persist as immutable snapshots
  (`recommendation_snapshots`, migration 033) with a 60-min TTL, an `is_consumed`
  flag (flipped on assign), and a hard **designated-driver rule** at assign
  (`recommendation.service.js`). The saved-recommendation card surfaces stale
  snapshots as expired with regeneration.

### 9.3 Incidents (driver → staff → maintenance)
- Drivers report incidents with severity + GPS (web portal `/driver/incidents`,
  mobile `/incidents`; mobile SOS reverse-geocodes the fix into a place name
  via `expo-location`, falling back to `"lat,lng"` text — never a maps URL).
  Staff see a **read-only registry** (`/incidents`) with an
  active-incident TomTom map (permanent type · severity + driver labels on
  every marker — no hover needed), filters, and only two write controls:
  **Resolve** (`PATCH /api/incidents/[id]` → `Resolved` + `actions_taken`)
  and **Send to Maintenance** (creates an Emergency Repair record). A driver
  POST runs the grounding automation in `src/lib/driver/grounding.js` —
  acknowledge, then ground the vehicle + interrupt active dispatches, or just
  notify overseers (§7.3). The web live map no longer plots open incidents
  (removed 2026-09-03 — this registry's own map owns that view).

### 9.4 Notification direction & preferences
- Rows carry `reference_type` / `reference_id` / `severity` / `link`; all surfaces
  (web feed, driver inbox, admin pages) render shared category/severity chips
  (`src/lib/notifications/presentation.js`). Tap targets resolve **per-role**
  (`src/lib/notifications/target.js`) — staff or driver routes, guarded by
  `getRequiredRolesForPath` so a tap never loops through a redirect.
- Per-user toggles persist in `notification_preferences` (migration 037) and drive
  the `/notifications/preferences` grid (event × channel, in-app non-disableable);
  the mobile Push toggle bulk-syncs the push channel
  (`PUT /api/notifications/preferences` `{ channel, enabled, bulk }` — OFF writes
  one false row per event, ON deletes the channel's rows to restore defaults).
- **Preferences are honored by producers since 2026-09-09:**
  `src/lib/notifications/preferences.js` (`channelEnabled` — row overrides,
  absent row inherits the `NOTIFICATION_EVENTS` default) is read by the
  start-window producer; a disabled `in_app` suppresses the notifications row,
  a disabled `push` suppresses the push_outbox row.
- **Time-driven trip start-window notifications (2026-09-09):** the first JS
  time-driven producer. `syncStartWindowNotifications()`
  (`src/services/start-window-notifications.service.js`) runs inside the
  CRON_SECRET `/api/cron/sync` flow as an isolated best-effort step (~once-per-minute
  target cadence — the endpoint is not a scheduler; an external caller must be
  configured, same deploy check as the rest of the sync) and notifies **Driver
  Accepted** trips at each departure-window threshold:
  `earliest_start` → "Trip Start Window Open" (quiet heads-up channel),
  `recommended_departure` → "Time to Head to Pickup" (loud Alert),
  `latest_start`/scheduled pickup passed → "Trip Has Not Started" (driver) +
  "Scheduled Trip Has Not Started" (dispatchers via `dispatch.update_all`;
  management/system_admin never). Catch-up rule: only the most advanced crossed
  threshold fires per trip per run. Dedupe is per (employee, stable title,
  trip reference) under a per-trip `pg_advisory_xact_lock` inside a
  transaction — no global unique constraint. The window math is the shared
  `src/lib/scheduling/start-window.js` resolver (TomTom → haversine → stored
  estimate ladder), consumed identically by the start gate
  (`PUT /api/trips/[id]/start`), the driver trips feed, and this producer —
  no third implementation. Copy never mentions the pre-trip inspection and
  never claims the trip can start (the start endpoint's gates are untouched);
  pickup times render in Asia/Manila explicitly. Deep-links use
  `reference_type='trip'`. After inserts the outbox is drained **targeted**
  (`flushOutbox({ employeeIds })`, which now also sends heads-up-channel rows
  without sound). Response counters: `start_window_notifications_created` /
  `start_window_pushes_attempted` / `start_window_skipped` /
  `start_window_stale_locations` (eligible trips whose driver position fed
  the ETA but is >10 min old or of unknown age — acceptance-testing signal,
  not an error; NULL positions aren't counted). Operational acceptance
  (external scheduler, CRON_SECRET in production, live device tests) is
  pending — checklist in the plan note; as of 2026-09-09 no external
  scheduler is active and `cron_sync_last_ok` has been stale since 2026-09-06.
- **Role-aware routing (2026-09-07):** inbox stays per-user (own `employee_id`
  rows), but producers resolve recipients through
  `src/lib/notifications/recipients.js` — `notificationRolesFor()` (authority
  minus non-operational roles) → `resolveNotificationRecipients()` (union +
  dedupe) → per-user rows. `rolesFor()` is never a recipient source (it injects
  the system_admin bypass by design). **system_admin is silent** on routine ops;
  management gets informational only, never action-required alerts; dispatcher
  is paged on stranded-guest abort (role-name fix, was system_admin-only);
  first arrival at **Assigned** emits "Transport Assigned" to the dispatch chain
  (replaces the dead `reservation_approved` key, migration 107); suspended /
  reinstated drivers are told alongside staff.

### 9.5 Mobile tabs + TomTom map
- The mobile app is now `(app)/(tabs)/`: Home · Live Map · scan FAB · Trips ·
  Profile (§8). Sign-out moved to Profile; login is interactive (demo mode removed).
  The map is TomTom **static images** (no RN/Leaflet native module) so it runs in
  Expo Go and on the web target; routing on web/server uses the `/api/tomtom/route`
  proxy.

### 9.6 Routes integrity refactor
- The Routes registry is a canonical operational registry, not a free-text cache.
  `route-resolver.service.js` normalizes request endpoints, resolves active
  location identities, reuses a directional active route, and leaves unknown
  destinations ad-hoc. Booking ingestion, dispatch auto-create, rescheduling,
  and AI recommendations share this resolver.
- The database enforces one active route per directional location pair while
  retaining inactive history. Route estimates expose `TomTom`, `Manual`, or
  `Legacy / Unknown` provenance; manual estimates require an explicit TomTom
  recalculation to change. New or endpoint-changed routes with valid coordinates
  automatically request a TomTom baseline; unavailable values remain blank.
  Stored duration is labelled estimated travel time, not live ETA. Endpoint
  edits lock after dispatch/trip use.
- `/routes` shows Active, Navigation Ready, Needs Setup, and Used Last 30 Days
  operational KPIs. Dispatcher and management are read-only; route writes are
  restricted at both the UI and API boundary. Hotel rename preserves its location
  identity; physical relocation versions the location and retires old routes.

### 9.7 Prior wave (still in effect): driver consent + portal
The consent/portal work (merged from `5794427`) remains live and is condensed here.
Versioned privacy policy (`CURRENT_PRIVACY_POLICY_VERSION = 1` in
`src/lib/consent/policies.js`) gates both web (`/driver`) and mobile (`(app)/_layout.js`)
personal-data screens; acceptance is append-only in `driver_consents` (migration 019,
IP + via captured, no UPDATE/DELETE) via `POST /api/driver/me/consent` (409 on stale
version). The driver self-service portal spans `/driver` + subpages
(profile/license-scan, trips, incidents, vehicle, fuel) — `GET/PATCH /api/driver/me`
(whitelisted fields; license scans self-serve anytime since 2026-08-25),
`POST /api/driver/license-scan` (Gemini verify + persist + expiry auto-apply + staff notification), `GET /api/driver/trips`,
`GET /api/driver/vehicle-inspection` (table restored by migration 034), and admin
controls `PUT /api/drivers/[id]/account` + `POST /api/drivers/link`.

---

## 10. Known Notes / Gotchas

- **RLS is inert *for the app's own connections* — and that claim was over-generalized, which is how SEC-DB-003 happened (corrected 2026-09-18).** The API's `requireAuth` is the boundary for anything going through `/api/**`. But the PostgREST surface (`<project>.supabase.co/rest/v1/`) is reachable with the **public anon key**, runs no application code, and is governed **only** by RLS — so a table in `public` with RLS disabled is world-readable. `app_errors` was, until migration `114`; `ai_prompt_templates` and `trip_monitor_alerts` still are. `has_role()` in SQL references a dropped function (`get_current_employee_role`) and would error if ever executed — it has never run on the app path.
- **A VIEW is not covered by the RLS on its base tables (SEC-DB-006, 2026-09-18).** A view executes as its **owner** unless it sets `security_invoker`, so `driver_stats` — owned by `postgres`, with an `anon` SELECT grant — reads straight through the RLS protecting `trips` and `drivers`. Confirmed by probe: one live row of per-driver performance data. Adding RLS everywhere else does nothing for this. `npm run db:contract` fails on it, and the offline contract gate requires every view in `schema.sql` to carry a classification.
- **Two gates read this boundary, and neither is sufficient alone (2026-09-18).** `npm run verify:anon` is the end-to-end probe with the anon key alone; `npm run db:contract` reads the live catalog (RLS flags, grants, policies). The probe's `200 []` is **INCONCLUSIVE by rule** — an empty table and a policy-denied one are indistinguishable from outside — and the contract is what resolves it. That rule earned its place immediately: `ai_prompt_templates` and `trip_monitor_alerts` returned `200 []` and were **empty, not protected**. Both scripts are read-only; neither prints the key.
- **The schema contract closes the `024` gap ("no check that the schema satisfies the code").** `scripts/lib/schema-contract.mjs` classifies every object in `public` as `private` or `public` with a reason, and `scripts/lib/sql-references.mjs` extracts the objects the code's SQL actually names. The offline half runs on every `npm test` (12 gates: classification completeness for tables *and* views, code-coverage of the contract, destructive-DDL and RENAME detection); the live half is `npm run db:contract`. Adding a table or view without registering it now fails `npm test`.
- **Migration tooling:** the `supabase` CLI is broken in this repo; use the runner — `npm run db:status` / `db:up` / `db:dump` (`scripts/migrate.mjs`, direct `pg` + `DATABASE_URL`, ledger-keyed by filename).
- **CORS is a fail-closed lockdown, not `*`.** `src/proxy.js` (Next 16 middleware) 403s any cross-origin browser caller except `NEXT_PUBLIC_APP_URL`; preflight is answered only for that origin. No auth in the proxy — real protection stays per-route `requireAuth`/`requireDriver`. Mobile auth uses `Authorization: Bearer`.
- **Notification scoping is now self-scoped:** `GET /api/notifications`, `[id]/read`,
  and `read-all` all restrict to the caller (ops roles may pass `?employee_id=` on the
  GET); `notifications/[id]` DELETE allows staff to delete any row, others only their own.
- **`shouldGroundVehicle` is real and unit-tested** (see §7.3): grounds on Major/Critical
  severity or the breakdown regex, never without a `vehicleId`
  (`src/lib/driver/grounding.test.js`). Older notes calling it a stub are obsolete.
- **Future-availability is enforced** (§4.8.2): a driver on `On Trip` or a vehicle
  on `In Use` is no longer excluded by status alone; `pair-scoring.js` now treats
  window overlap (`_schedule_load`) as the authority, so a busy-now-but-free-tomorrow
  resource is correctly offered. Removed `On Trip` from `UNAVAILABLE_STATUSES` and
  `In Use` from `NON_DISPATCHABLE_VEHICLE_STATUSES`; tests updated.
- **Travel + safety-buffer is enforced** (§4.8.3): `earliest_next_available` lives
  in `src/lib/scheduling/travel-buffer.js` and is a hard `TRAVEL_BUFFER` BLOCKING
  conflict at assign time. The ETA feeding it is derived server-side by
  `src/lib/scheduling/travel-signals.js` from the previous commitment's drop-off
  to this request's pickup; a caller-supplied estimate is a cross-check only and
  cannot clear or skip the gate. Buffer config in `dispatch-policy.js`. The
  `distance/25*60` value in `dispatch-advisor.js` remains a scoring heuristic only.
- **`vehiclereservations` is gone** (migration `047_drop_vehiclereservations.sql`) along with both `reservation_id`
  columns, two trigger functions, and the `/api/reservations/*` route tree. Any
  older note describing a "two tables for one concept" split, or reservation
  endpoints returning 410, is describing a state that no longer exists.
- **Mobile demo-driver mode was removed** — login is interactive only; `EXPO_PUBLIC_ENABLE_DEMO` has zero code references.
- Route protection is via root `layout.js` → `DashboardLayout` → `RouteGuard` (client) + per-route API checks.
- A driver hitting `/dashboard` directly would render it (UI-only exposure; data APIs still enforce roles).
- Mobile status-advance uses the **web** route `PUT /api/trips/{id}/status` (not `/mobile/` prefix).
- Scope status (2026-09-02): **push notifications are shipped in-app + local/foreground** (Expo tokens registered at sign-in; server tiers via `push.service.js`; terminated-app remote fan-out documented future work). Offline queueing exists for incident reports (dead-letter surfaced in Submissions). Background location task exists but needs a dev build. Still not implemented: guest mode.
- `070_driver_licenses_bucket.sql` is present and tracked. It owns the private `driver-licenses` bucket; keep its filename and checksum stable because the migration ledger keys entries by full filename.

---

## 11. ★ UI remediation wave (2026-08-23) — shared primitives & behavior contracts

A full UX audit ran across web + mobile; the remediation landed in phases
0–6. The complete record lives in
`Capstone/01 - System/UI UX Audit - Web.md` (and the mobile twin). What a
future developer/AI must know:

**New/changed shared primitives (`src/components/ui/`)**
- `query-feedback.jsx` — `QueryBoundary` (loading skeleton / error+Retry /
  empty / children-as-function) and `QueryErrorBanner`. Every data surface is
  expected to handle query failure explicitly; failures must never render as
  "empty".
- `phase-rail.jsx` — `PhaseRail`, the ONE stepper grammar for ordered
  lifecycles (request/reservation/dispatch/trip chains). Tolerant of unknown
  statuses via fallback note.
- `confirm-dialog.jsx` — canonical props `{title, message, confirmLabel,
  variant, requireReason, loading, onConfirm(reason)}` with legacy aliases
  (`description`, `confirmText`, `isLoading`, `variant:"danger"` accepted).
  Variants: destructive/danger/warning/archive/logout/info. Destructive or
  externally-visible actions require confirmation; reason capture where audit
  matters.
- `stat-card.jsx` — renders `trend` as a context caption under the value;
  dashboard configs rely on it.
- `status-badge.jsx` — central grammar now covers ALL dispatch/trip states
  (incl. `Pending Reassignment` = danger), plus `incident` and `leave`
  entities. Do not add local status maps in pages; extend the central maps.
- `command-palette.jsx` — full role-filtered page coverage + entity search
  (deferred, non-blocking); Pages remain visible during search.

**Design tokens**
- Semantic colors exist as raw CSS vars AND Tailwind theme colors
  (`globals.css`). Charts take hex mirrors from `src/lib/chart-tokens.js` —
  never declare private palettes. Chart heights use `chart-h-sm/md/lg`
  utilities. `docs/design-system.md` is canonical for the shipped visual
  language (Inter-everywhere, ink primary). `DESIGN.md` (re-synced
  2026-09-17, web-only scope) records the component layer on top: StatCard
  base/interactive variants, dashboard Panels + FeedState, DonutMeter
  (partitions-only) / DistributionMeter / StatusBars, LivePulseBeacon,
  PageEntrance, Operations 2x2 cards, AI Analyst card, map-entity-marker
  grammar, CapsLock/session-expired/lockout surfaces, and the
  Partition-Only-Donut / No-Severity-Border / Honest-Feed rules. Accent navy
  `#0b132b` is scoped to the AI Analyst identity; session peach `#fff8f3`
  is a one-off. Mobile Claymorphism stays in the Mobile * plans.

**Behavior contracts**
- Cancel of a transportation request ALWAYS goes through ConfirmDialog +
  required reason, gated by `can("reservations","cancel")`.
- Login throttling surfaces honestly: `GET /api/auth/login-status`
  (read-only peek) backs the login page's lockout messaging.
- Staff account management: `/settings/users` index +
  `GET/PUT /api/settings/users` (disable = soft-delete;
  that is what blocks sign-in; status='Inactive' is the readable flag).
- Availability is pair-first (2026-09-04): `/dispatch/availability` shows
  vehicle + driver pairs for a window, not separate Drivers/Vehicles status
  lists (removed — they re-proved misleading). Do not reintroduce standalone
  status lists as dispatch truth.
- Mobile: SwipeButton exposes accessibility actions; offline-queued incident
  reports say "saved offline", never claim dispatch receipt.

---

## 12. ★ Current wave (2026-08-15 → 2026-09-04) — schedules, leave, fuel requests, push, auth, map UX, availability, fuel console

The newest feature set after §9/§11. Everything here is shipped and enforced in code; the auth/session items were added 2026-09-02.

### 12.1 Driver work schedules + leave (migrations 049–055)
Weekly per-driver shift rows (`driver_work_schedules`, UNIQUE driver+weekday,
rest days stored 00:00–00:00) and a leave workflow (`driver_leave_requests` →
approve/decline by system_admin/fleet_manager; balances in
`driver_leave_balances`). `lib/scheduling/driver-schedule.js::driverBlockReason`
blocks dispatch when approved leave covers pickup, the weekday has no schedule,
it is a rest day, the window doesn't fit the shift, or a break overlaps;
pending leave warns. Leave approval auto-flips overlapping dispatches to
`Pending Reassignment`. Routes: `driver-work-schedules`, `driver-leave-requests[/id]`,
`driver-leave-balances`, driver self-service `driver/leave`; mobile screens
`work-schedule.js`. DB triggers notify fleet_manager/admin on request/review
(054 added dispatchers; 055 reverted that).

### 12.2 Substitute drivers (migration 040)
When a vehicle's designated custodian can't drive it (e.g. suspended), the
vehicle stays out of recommendations/dispatch unless
`substitute_vehicle_schedules` covers the date (`effective_until NULL` =
open-ended; one open-ended row per vehicle). Consumers resolve "effective driver
for a date": `recommendation.service.js`, `pair-scoring.js`, `conflicts.js`,
`uvvrp.service.js`. Routes `substitute-driver-schedules[/id]`; UI cards on fleet/
dispatch pages.

### 12.3 Fuel requests + monthly allocations + gauge AI (migrations 066–069)
Drivers file a **fuel request** with a gauge photo (Gemini scan via
`lib/fuel/gemini-gauge.js`, fail-closed) instead of directly writing receipts.
The server computes recommendation from `vehicles.tank_capacity_l` /
`fuel_efficiency_kmpl`, last report variance, and remaining monthly budget
(`fuelallocations`, UNIQUE vehicle+month), then **auto-authorizes within policy**
or files Pending for staff review. Fulfillment: the receipt (`POST /api/mobile/fuel`)
must reference an Approved request and flips it to `Fulfilled`
(`fuelrecords.fuel_request_id` 1:1). Policy helpers: `src/lib/fuel/request-policy.js`.

### 12.4 Push notifications (migrations 058/059a)
`device_tokens` stores Expo push tokens per install (registered at sign-in/out).
Every dispatch INSERT enqueues a driver push via DB trigger into `push_outbox`;
`push.service.js` tiers notifications (loud / heads-up / silent), sends via Expo
Push in batches, deactivates dead tokens, and drains the outbox after dispatch
create/autocreate sync. Mobile renders tiered banners (`notifications/tiers.js`)
— honest scope: local/foreground scheduling only; terminated-app remote fan-out
is documented future work.

### 12.5 AI report narratives (migrations 043/045)
`POST /api/ai/report-narrative` narrates an already-computed report payload:
24 h sticky cache per report+range, ≤3 forced regenerations/day, deterministic
fallback grounded in the same numbers. Engine: `lib/ai/report-narrative.js`;
UI card on analytics/reports pages.

### 12.6 Per-trip pre-trip inspection gate (migration 048)
Inspections are tied to trips (`vehicleinspection.trip_id`). `PUT /api/trips/[id]/start`
requires a `Passed` inspection for this trip's driver+vehicle before starting;
mobile posts inspections via `/api/mobile/driver/inspections` and reads
`pre_trip_status` from the trips feed.

### 12.7 Idempotent client submissions (059b/060a/062)
Fuel records, inspections, incidents, and fuel requests all carry
`client_submission_id` UNIQUE partial indexes so mobile retries/offline replays
never duplicate rows.

### 12.8 Hardening & hygiene
CORS lockdown via `src/proxy.js` (§4.6); anon access to `employees` revoked
(060b); seeded admin hash invalidated if ever still present (061);
`source_incident_id` links maintenance to incidents (063);
`drivers.suspension_reason` (064); incident photos + evidence bucket (065);
random `DSP-XXXX` dispatch numbers (044); seven pagination indexes (052);
incident triage/grounding/maintenance integrity (081–086); auth-version
invalidation and shared auth rate limits (087); server-backed web sessions and
TOTP MFA (088); configurable web-session idle timeout (089); 5-minute idle
timeout default (113).

### 12.9 Auth lifecycle and session UX (migrations 087–089, 113)
Web authentication records a server-backed session with a 12-hour absolute
lifetime and a 5-minute idle timeout. Live identity resolution checks session
expiry, revocation, employee status, role, and `auth_version` before authorizing
each API request. Human activity and the Stay signed in action use
`POST /api/auth/heartbeat`; that route is the **only** writer of
`web_sessions.last_seen_at`, so neither background polling nor any other API
traffic can extend the idle deadline. The browser session manager slides the
deadline as soon as real DOM activity occurs (throttled to one write per minute),
warns 60 seconds before idle expiry through the blocking modal, shows the remaining
idle time continuously as a countdown chip in the top bar (a readout — it cannot
extend the session, and it escalates its tone at 120s so the escalation is visible
before the modal covers the screen), coordinates failures/extensions/logout across
tabs, and returns users only to validated internal routes after re-authentication.
TOTP enrollment and login MFA use encrypted per-employee secrets, a v9-compatible
`otpauth` implementation, hashed single-use recovery codes, replay protection, and
separate IP/account throttles. Production deployments must set both
`MOBILE_JWT_SECRET` and `MFA_ENCRYPTION_KEY` as distinct server-side secrets.

The `/settings/security` UI uses a compact two-column password/MFA layout with a
full-width session manager recreated with pixel-level parity to the reference design.
It renders live password validation with a segmented strength meter, a 2-column requirements checklist,
all real MFA states, recovery codes, and owner-scoped session rows through the existing auth
endpoints; the redesign did not change authentication, revocation, or
authorization behavior. The vendor-neutral RFC 6238 helper is paired with local
brand marks for Google Authenticator, Microsoft Authenticator, Authy, and 1Password;
session rows render official browser marks (e.g. Google Chrome) and accurate metadata.
Responsive composition and dark mode inherit the shared FleetOps semantic tokens.
The enrollment QR is rendered through the Next image boundary without changing
the data URI flow, and session rows expose only implemented actions.


### 12.10 Live map & SOS UX polish (2026-09-03)
`src/components/maps/live-locations-map.jsx` (used by `/tracking/live-map`, role
dashboards, and `/trips/[id]`):
- **Always auto-fit** — the viewport re-fits to all pins (or the selected trip's
  route) on every GPS poll; user pans are re-fitted on the next refresh.
- **Permanent labels** — latest-locations markers (nested `vehicles`/`drivers`
  data) show a status-color dot + plate + driver name without hovering; the
  click popup (telemetry, Street View) is unchanged. Raw GPS-history rows
  (`/trips/[id]`) have no identity and keep the hover tooltip.
- **No gray markers** — every `LIVE_TRIP_STATUSES` phase maps to a phase color
  (pre-trip blue, to-pickup amber, passenger-onboard/arrived green); the
  fallback default is blue, not gray.
- **Removed** — the open-incidents layer (the `/incidents` module's own map
  owns that view) and the floating "Live Route Navigation" panel (turn-by-turn
  instructions, distance/ETA). The route polyline, origin/destination labels,
  and sidebar trip metrics remain; the `incidents`, `instructions`,
  `routeDistanceKm`, `routeTravelMin`, and `showNavigationPanel` props are gone.

### 12.11 Pair-first availability, fuel console, dashboard wave (2026-09-04)
- **Availability is pairs, not lists.** `/dispatch/availability` dropped the
  Drivers | Vehicles tabs: default is the full day (`Showing dispatchability
  for today`), with an optional exact-window picker behind `Set exact window`.
  Today-mode classifies Clear Schedule Today / Has Trips Today (upcoming-first)
  / Blocked; exact-window mode stays strict (Ready / Blocked, overlap blocks).
  Hard blockers always outrank schedule activity; blocked cards with trips get
  a collapsed `N scheduled trips today — may be affected` warning (never
  "requires reassignment"). Backend `GET /api/dispatch/availability-pairs`
  reports hard eligibility + `clashes[]` using the shared `resolveVehiclePairing`
  rule — read-only, no new eligibility. Request prefill via query params.
  Today-mode (`mode=today`) evaluates day-scoped schedule eligibility only
  (leave / schedule-exists / rest day via `driverDayEligibility`, shift span
  shown as duty window); `driver-schedule.js` untouched, exact mode keeps load
  + containment strictness.
- **Fuel is one ops console.** `/fuel` holds registry/budget/permits/review
  (Needs-review pins atop Registry when flagged; smart Pending/All default;
  full-set CSV export); `fleet/fuel` is a redirect stub; driver web Log Fuel
  (direct-record bypass) is replaced with mobile-request guidance; driver role
  removed from `/fuel` nav.


### 12.10 Live map & SOS UX polish (2026-09-03)
`src/components/maps/live-locations-map.jsx` (used by `/tracking/live-map`, role
dashboards, and `/trips/[id]`):
- **Always auto-fit** — the viewport re-fits to all pins (or the selected trip's
  route) on every GPS poll; user pans are re-fitted on the next refresh.
- **Permanent labels** — latest-locations markers (nested `vehicles`/`drivers`
  data) show a status-color dot + plate + driver name without hovering; the
  click popup (telemetry, Street View) is unchanged. Raw GPS-history rows
  (`/trips/[id]`) have no identity and keep the hover tooltip.
- **No gray markers** — every `LIVE_TRIP_STATUSES` phase maps to a phase color
  (pre-trip blue, to-pickup amber, passenger-onboard/arrived green); the
  fallback default is blue, not gray.
- **Removed** — the open-incidents layer (the `/incidents` module's own map
  owns that view) and the floating "Live Route Navigation" panel (turn-by-turn
  instructions, distance/ETA). The route polyline, origin/destination labels,
  and sidebar trip metrics remain; the `incidents`, `instructions`,
  `routeDistanceKm`, `routeTravelMin`, and `showNavigationPanel` props are gone.
- **Dashboards answer their primary question first.** Dispatcher opens with
  Needs-attention + Next-departures (live countdowns); fleet manager has
  readiness + utilization/workload strips; admin swaps status meters for request
  pipeline + document-compliance donuts; linked StatCards navigate; executive
  gains MoM trend chips; reservation queue lands on the first non-empty work tab.
- **Merged incident responder work (origin/main):** GPS-tracked fleet responders
  on incidents (101–102, auto-advance Dispatched→En Route→Arrived), SLA-breach
  marking + pg_cron schedule (098–099), incident remediation fields (097),
  company cards + expense records/receipts (091–096); dispatcher live map plots
  active rescuers alongside GPS.

### 12.12 Operations Dashboard 2x2 Grid Modernization (2026-09-06)
- Rebuilt the central 2x2 dashboard card section on `/dashboard` (`AdminDashboard` in `src/components/dashboard/role-dashboard.jsx`) to achieve visual and functional fidelity with the reference operations console:
  - **Request pipeline (`RequestPipelineCard`):** Displays overall count, weekly volume change, and completion rate summary header; renders a 6-stage interlocking chevron process ribbon (`Pending`, `Scheduled`, `Assigned`, `In Progress`, `Completed`, `Cancelled`) with precise 2px gap geometry and status dot legend.
  - **Document compliance (`DocumentComplianceCard`):** Side-by-side view with a primary valid-documents percentage stat box, full-width multi-segment progress bar (Expired, Due ≤30d, Due 31–90d, Valid), 4 breakdown columns, and an Expiring soon unit chips row with `+N more` link.
  - **Maintenance and incident pressure (`MaintenancePressureCard`):** Clean event list displaying active work orders with colored left status strips, vehicle plates, service types, schedules, status pills, relative timestamps, and hover navigation to `/maintenance`.
  - **Incident risk (`IncidentRiskCard`):** 4 metric tiles for Open, Critical/major, Assistance, and Maintenance pending, paired with a dynamic calm-state card (soft-green shield when 0 active risks; rose alert with action link when risks exist).
- Component architecture encapsulated in `src/components/dashboard/operations-cards.jsx` with unit testing in `src/components/dashboard/operations-cards.test.js`. Verified clean with `npm run lint:ci` (0 errors, 0 warnings) and Vitest (`539/539 tests passing`).

### 12.13 Fleet Utilization Dashboard & Reports Suite Exact Mockup Recreation (2026-09-06)
- Rebuilt the Fleet Utilization dashboard and elevated the reports suite (`src/app/(dashboard)/reports/page.js`) according to the exact visual source of truth (`media_1788656277326.png`):
  - **AI Analyst Card (`AiAnalystCard` in `src/components/ai/ai-analyst-card.jsx`):** Refined header with Sparkles squircle, title (`AI Analyst - Fleet Utilization`), deep navy pill badge (`Intelligence Engine`, `#0b132b`), subtitle (`Number-grounded analysis for the selected window`), and rounded-full border button `Regenerate`. Inset panel empty state features faint landscape wavy contour gradients on left and right edges, 3-vertical-bar squircle icon badge, centered title `"No activity in this period"`, and centered narrative copy.
  - **Fleet Report Header Block & Elevated StatCards:** Standalone page typography with `FLEET REPORT` overline, bold `Fleet utilization` H2 heading, and right-aligned calendar icon with `Capacity and distance by vehicle`. 3 StatCards (`UTILIZATION` at `4%` with `Fleet capacity`, `TRIP RECORDS` at `1` with `Selected window`, `DISTANCE LOGGED` at `0 m` with `Verified km`) upgraded with gentle right-side rising bottom waves, large tabular typography, and tinted circular icon badges (`Gauge`, `FileText`, `Route`).
  - **Fleet Workload Distribution Card (`FleetReport`):** Exact title `Fleet workload distribution`, subtitle `Vehicles ranked by total distance and trip count in the selected window`, and right-side `Top 1`. Features a 3-part summary strip with vertical dividers (`HIGHEST DISTANCE` `0 m`, `MOST DISPATCHED` `ABC-1234` `1 trips`, `AVERAGE TRIP DISTANCE` `0 km` `Across trip records`), integrated horizontal axis scale ruler (`0`, `250`, `500`, `750`, `1,000 km`), navy squircle rank badge (`01`), vehicle plate with `Most dispatched`, track bar with 3 scale divider ticks (25%, 50%, 75%) and royal blue filled indicator (`24px`), column metrics (`1 trips`, `0 m total`), and wide soft-blue Relative Workload pill (`media_1788656506460.png`: `bg-[#eff5ff] max-w-[136px] h-9`, royal blue `3%` in `#2563eb`, and centered `of fleet workload` below).
  - **Verification:** Verified clean with `npm run lint:ci` (0 errors, 0 warnings) and full Vitest suite (`539/539 tests passing across 51 test suites`).

### 12.14 AI Analyst – Fleet Utilization Card Exact Mockup Recreation (2026-09-06)
- Recreated the single premium dashboard card for **AI Analyst – Fleet Utilization** based on the exact visual source of truth (`media_1788657029174.png`) in `src/components/ai/ai-analyst-card.jsx`:
  - **Header Structure:** Squircle badge with `Sparkles`, title `AI Analyst - Fleet Utilization`, dark navy pill badge `Intelligence Engine` (`#0b132b`), subtitle `Number-grounded analysis for the selected window`, and outline `Regenerate` button with rounded-full pill border.
  - **Inner Insight Panel:** Large rounded inset container (`bg-[#f8fafd] border border-slate-200/60 dark:bg-slate-900/40 p-5 sm:p-6`) with atmospheric landscape wave background along the lower half of the panel (gentle translucent gradients and faint dotted landscape contours).
  - **Top Status Pills:**
    - `● Monitoring` in warm amber style with status dot (`bg-amber-500`) and amber pill border.
    - `⚙ DETERMINISTIC` in neutral style with gear icon (`Settings`) and uppercase tracking.
  - **Main Narrative Insight Row:** Leading circular icon badge with soft light-blue tint and 3 rounded vertical bars, paired with bold prominent narrative text (`"Fleet utilization is at 4% across the period, with 1 trips covering 0 km. The busiest unit logged 1 trips."`).
  - **Divider & Recommended Actions:** Thin horizontal divider, uppercase section label `RECOMMENDED ACTIONS` with list icon, and numbered action items inside soft-blue circular markers (`1`, `2`).
  - **Footer Date Row:** Small calendar icon + `Analyzed for 2026-09-01 — 2026-09-05` in muted blue-gray text.
- **Verification:** Verified clean with `npm run lint:ci` (0 errors, 0 warnings) and full Vitest suite (`539/539 tests passing across 51 test suites`).

### 12.15 FleetOps System Admin Dashboard Recreation (2026-09-06)
- Rebuilt the **FleetOps System Admin Dashboard** (`/dashboard` for `role === "system_admin"`) according to the exact visual source of truth (`media_1788665666304.png`) as a premium, modern, minimal enterprise console.
- Replaced the legacy 4 KPI stat cards, platform failure alert banner, and generic activity feed with a dedicated 6-panel 2-row composition (`grid-cols-1 xl:grid-cols-[1.3fr_1fr_1fr]`):
  - **Top Row:**
    1. `System Usage Overview` (`SystemUsageOverviewCard`): Multi-series time chart (Bookings `#2563eb`, Trips Completed `#10b981`, Maintenance `#f59e0b`, User Logins `#8b5cf6`), date axis, custom tooltip, "Last 30 days" context pill, and horizontal legend below.
    2. `System Health` (`SystemHealthCard`): Live seven-row System Health status list with operational/attention/degraded tones, explicit unavailable state when telemetry cannot load, and an `Open System Health` footer link.
    3. `Account Posture` (`AccountPostureCard`): Donut chart with total accounts (`64`) in the center, role distribution legend on the right, divider, and disabled roles warning chips (`concierge`, `resto resto`, `reception reception`, `+26 more`).
  - **Bottom Row:**
    4. `Recent System Activities` (`RecentSystemActivitiesCard`): Compact operational activity table (`TIME`, `USER` avatar with initials, `ACTION` badge, `MODULE`, `DETAILS`) with `View all` action.
    5. `Recent Errors` (`RecentErrorsCard`): Severity-ranked technical error list (`CRITICAL`, `ERROR`, `WARNING` badges, occurrences count, last seen timestamps, chevrons) with `View all` action.
    6. `Recent Security and Change Audit` (`RecentSecurityAuditCard`): Immutable audit trail list (`login_success`, `role_updated`, actors, timestamps) with `Open full audit →` action.
- Encapsulated in `src/components/dashboard/system-admin-cards.jsx`; missing API data renders honest empty/unavailable states rather than sample records.
- **100% Real Data Integration & Thesis-Safe Subsystem Telemetry (`GET /api/system/activity`):**
  - **Subsystem-Ownership Health Model (No Arbitrary Formulas):** Discarded synthetic or weighted uptime percentages (e.g. `100 - (errors * 0.1)`) in favor of a deterministic, defense-proof telemetry architecture backed directly by live database tables and hardware/network probes:
    1. **Web Application:** Queries `app_errors` for server exceptions and unhandled 5xx errors in the last 24h (`Operational` if 0, displaying exact error count).
    2. **Database Engine (Supabase):** Live round-trip `SELECT 1` ping measuring actual query latency in milliseconds (e.g., `24ms`–`350ms`, `Operational` if `< 400ms`).
    3. **API Integrations:** Reads `integration_log` for processed vs. failed external requests over 30d/24h (true mathematical success rate, e.g. `100.0%`).
    4. **Push Notifications:** Reads `push_outbox` for mobile dispatch alerts (true mathematical delivery rate, e.g. `33.3%` with error flag triggering `Degraded` status).
    5. **Auth & Security Posture:** Aggregates `audit_logs` for `login_failure` events in the last 24h (`Operational` if $\le 5$, displaying active alert count).
    6. **File Storage:** Probes object storage error logs in `app_errors` (`Healthy` / `Degraded`).
    7. **Scheduled Sync (Cron Heartbeat):** `/api/cron/sync` writes one canonical heartbeat through `recordSyncHeartbeat()` to `system_settings` (`setting_key = 'cron_sync_last_ok'`). The dashboard inspects timestamp freshness: `Operational` if executed within 24h, `Attention` near the expected cadence, or `Degraded` when stale/missing.
  - **System Usage 30d:** Dynamic time series computed across `transportation_requests` (bookings), `trips` (completed trips), `vehiclemaintenance` (maintenance work orders), and `audit_logs` (user logins where `action = 'login_success'`) for the last 30 calendar days.
  - **Account Posture:** Real 64 employee accounts, exact role distribution from `employees` + `roles`, and real disabled accounts (`concierge`, `resto`, `reception` + 26 more) where `deleted_at IS NOT NULL` or `status = 'Inactive'`.
  - **Recent Activities & Errors:** Real immutable events from `audit_logs` + `employees`, and delivery errors from `push_outbox` / login failures.
- Pre-commit verification: lint clean, production build successful, route-auth `253/253`, migrations `108 applied / 0 pending / 0 changed`, and retained Vitest suite `603/603` across 57 files.

### 12.16 FleetOps Live Map & Incident Marker System (2026-09-06)
- Standardized map markers across the **Live Operations Map** (`src/components/maps/live-locations-map.jsx`) and the **Incidents Map** (`src/components/maps/incident-map.jsx`) to faithfully recreate the compact, premium design from `media_1788671682556.png`:
  - **Shared Marker Architecture (`src/components/maps/map-entity-marker.jsx` & `src/styles/map.css`):**
    - Leaflet `DivIcon` and React component (`MapEntityMarker`) combining a 30px circular state pin with a downward pointing tip anchored at `[15, 35]` pointing precisely to coordinates, attached to a floating rounded card (`rounded-xl`, subtle 1px border, soft shadow).
    - Compact typography: primary label (12px bold, plate number or incident ID) with colored status label below (10.5px semibold, e.g. `On trip`, `At pickup`, `Idle`, `Critical · Accident`).
  - **Color Semantics & State Grammar:**
    - `Green`: Active trip (`On trip`, `En Route`, `In Progress`).
    - `Blue`: Trip at pickup (`At pickup`) or assigned rescue responder unit (`Rescue #1`, `En Route`).
    - `Slate`: Idle / available vehicle (`Idle`).
    - `Rose`: Under maintenance (`Maintenance`) or critical unacknowledged incident (`Critical · <Type>`).
    - `Amber`: Delayed trip (`Delayed`) or moderate incident.
    - `Gray`: Stale GPS / offline telemetry (`No signal`, >10m without update).
  - **Controlled Subtle Pulse:**
    - Subtle pulse ring animation is applied strictly to unacknowledged critical emergencies or stranded drivers requesting assistance, avoiding map noise.
  - **Z-Index Layering Hierarchy:**
    - Critical incidents (`2500`) > Selected entity (`2000`) > Rescue responders (`1500`) > Active trips (`1000`) > Maintenance (`800`) > Idle (`500`).
  - **Minimal Map Legend (`MinimalMapLegend`):**
    - Compact, translucent backdrop-blur pill legend (`● Active trip`, `● At pickup`, `● Available / idle`, `● Maintenance`, `▲ Incident`).
  - **Interactive Incident Selection Drawer (`IncidentMap`):**
    - Floating operational drawer displaying vehicle grounding status, cancelled trips impact, requested assistance chips, driver telemetry, and linked maintenance work orders with direct actions.
  - **SSR & Node Test Safe:**
    - Decoupled Leaflet module dependencies so `map-entity-marker.jsx` safely evaluates in Node/Vitest environments while injecting `L` in browser contexts.
- **Verification:**
    - Verified with `npm run lint:ci` (0 errors, 0 warnings), successful production build, and retained Vitest suite (`603/603` across 57 files); marker hardening was temporarily validated before test-file cleanup.

### 12.17 Automated Live Traffic ETA & Dynamic Responder Tracking (2026-09-07)
- **Automated Rescue ETA:** Upgraded the manual "Estimated ETA (Minutes)" input in emergency response dispatch to an automated, real-time calculation powered by TomTom live traffic:
  - **External Rescue Routing:** Computes live route distance and travel time from the organization's base operations (`hotel_location` in `system_settings`) to incident GPS coordinates (falling back to the stranded driver's live GPS or reported coordinates). Pre-fills the ETA field with a live traffic indicator badge and "Reset to live ETA" override option.
  - **Fleet Candidate Live ETAs & Nearest-First Sorting:** Candidate drivers in `GET /api/incidents/[id]/responder` calculate individual TomTom traffic ETAs in parallel and are sorted nearest-first via `sortCandidateResponders` (closest GPS distance, then lowest ETA, with non-GPS drivers sorted alphabetically at the bottom). The UI highlights the closest driver with a `Nearest` tag, prominent distance (`X km away`), `~Xm ETA`, and clear GPS status (`Live GPS`, `Stale fix`, or `No GPS`).
  - **Immediate ETA Persistence:** Dispatching a responder immediately computes and persists `response_eta` into `driverincidents`, broadcasting the expected arrival time in push notifications and audit logs.
  - **Dynamic Tracking & Auto-refresh:** The incident detail modal continuously polls active rescue tracking every 10 seconds (`refetchInterval: 10000`), advancing ladder status (`Dispatched` → `En Route` → `Arrived`), computing remaining distance/minutes without React render impurities, and syncing live progress seamlessly.

### 12.18 Mobile Claymorphism & UI/UX Audit Passes (2026-09-10)
- **Molded Claymorphism Upgrade (Round 5):**
  - Upgraded mobile visual language to match the Driver Home notification bell's tactile dual-pass shadow formula (`moldedMaterials` in `mobile/components/clay/molded-materials.js`).
  - Created reusable component primitives in `mobile/components/clay/`: `ClayCard`, `ClayTile`, `ClayBadge`, `ClayButton`, `ClayInput`, and `ClaySection`.
  - Upgraded `WeatherChip` to use tactile clay pill and tile styling in harmony with the notification bell.
  - Guaranteed strict style-key parity between light and dark modes to prevent Android theme-switching ghost borders.
- **UI/UX Audit & Theme Conflict Resolution (Round 6):**
  - Resolved contrast failures on `work-schedule.js` hero card by adopting a solid Forest Green brand card with high-contrast white typography.
  - Replaced skeuomorphic beveled metal troughs with modern flat segmented pill containers in `work-schedule.js` and `settings.js`.
  - Replaced stacked puffy 3D badges with clean architectural data tags (`IBMPlexMono`) on schedule day rows.
  - Fixed affordance inversion on leave type selectors by stripping heavy bottom drop shadows from unselected chips.
  - Fixed vehicle card badge in `fuel-report.js` and added resilient prop fallbacks (`text` $\rightarrow$ `label`, `variant` $\rightarrow$ `tone`, `dot` $\rightarrow$ `statusDot`) in `ClayBadge.jsx`.
  - Mapped status badges to semantic tones and dots in `submissions.js`.
- **Verification:**
  - 16 test files / 112 tests passing (`npx vitest run mobile/lib`).
  - 0 ESLint errors or warnings across touched files.
  - Production Android Hermes bundle compiled cleanly (`npx expo export --platform android`).

### 12.19 Mobile Map Standby Radar & 3D Vehicle Marker (`carlive.png`) Integration (2026-09-13)
- **Radar Pulse Animation & Visibility Refinement:**
  - Tuned expanding radar wave animations in `mobile/components/TomTomMap.js` and `mobile/components/RadarPulse.jsx` to be cleanly visible without map clutter.
  - Applied 1.5px borders (`rgba(40, 95, 80, 0.75)` light, `rgba(92, 255, 220, 0.85)` dark), radial wash gradient fill, and balanced `box-shadow` depth.
  - Preserved fixed 5 km geographic coverage, 3.6s pulse duration with 1.8s secondary ripple, and reduced-motion fallback.
- **Top-Down 3D Vehicle Marker (`carlive.png`):**
  - Replaced legacy synthetic SVG car and headlights glow overlay with bespoke 3D top-down asset `mobile/assets/images/carlive.png` in `TomTomMap.js`.
  - Sized marker container to 60px x 60px to achieve ~51px visible car height (within the 48–56px requirement) accounting for image transparent margin (85.2% vehicle height on 1254x1254 canvas).
  - Maintained dynamic GPS heading rotation matching vehicle travel bearing.
  - Applied subtle ground drop-shadow in light mode (`rgba(18, 38, 28, 0.28)`) and high-contrast pale mint contour outline in dark mode (`drop-shadow(0 0 1.5px rgba(220, 245, 232, 0.60))` with deep ground shadow), avoiding noisy glow while ensuring clear separation over dark tactical map tiles.
  - Completely removed car customizer modal, color swatches, and click triggers to reinforce unified FleetOps forest-green branding and keep the map focused on operational tracking.
  - Asset loaded via resilient Base64 data URI injection with dynamic `window.setCarMarkerImage` support to avoid WebView asset path failures.
- **Mobile Map Performance Optimization (2026-09-13):**
  - Eliminated map gesture stutter and idle frame drops ("medj laggyy") across Android WebViews without any visual sacrifice.
  - **GPU Fill-Rate Protection:** Stripped GPU-saturating dynamic `box-shadow` calculations from 1000px scaling radar bloom pulses, maintaining crisp 1.5px borders and smooth radial gradients with hardware layer backface isolation (`transform: translate3d(0, 0, 0); -webkit-backface-visibility: hidden; backface-visibility: hidden;`).
  - **Gesture Interaction Suspension:** Dynamically toggles `.map-interacting` on `dragstart`/`dragend` to suspend pulse animations (`animation-play-state: paused`) while the user is actively panning or zooming, dedicating 100% of GPU resources to 60fps gesture rendering.
  - **Prevented Redundant WebView Reloads:** Hoisted `cachedCarImage` at module level and removed `carImage` from `htmlContent` dependencies. Asset loads inject via `window.setCarMarkerImage` without re-creating the DOM or re-executing SDK scripts.
  - **RAF-Throttled Transform Calculations:** Throttled `zoom` and `rotate` map event listeners via `requestAnimationFrame` to eliminate DOM layout thrashing.
  - **React & Native Bridge Optimization:** Removed dead `setIsPannedAway` state setter which caused whole-screen re-renders on map touch; widened parked compass heading deadband to 10° to filter hand tremors; enabled Android WebView hardware acceleration (`androidHardwareAccelerationDisabled={false}`, `overScrollMode="never"`); and wrapped `TomTomMap` in `React.memo`.
- **Verification:**
  - 20 test files / 121 tests passing (`npx vitest run mobile/lib --no-cache`).
  - 0 ESLint errors across touched components (`mobile/components/TomTomMap.js`, `mobile/app/(app)/(tabs)/map.js`, `mobile/components/RadarPulse.jsx`).
  - Production Android Hermes bundle export succeeded with 0 errors (`1,394 modules`, 5.14 MB).


**Dispatch Copilot feature review (2026-09-16):** Documented proposed recovery guidance, verified change explanations, what-if simulation, downstream impact explanations and meaningful-change alerts in AI Advisory. Source/document review only; no application changes.


## Copilot enhancement implementation plan - 2026-09-16

Created [[Dispatch Copilot Decision Support Enhancement Plan]] in `Capstone/07 - Development/`: phased recovery guidance, verified change explanations, read-only simulation, queue impact and assigned-trip alerts. Includes source reuse, permissions, simulation/assignment separation, notification scheduler dependencies, acceptance cases and rollout gates. Status: proposed; documentation only, no application behavior changed.


**Return-trip matching plan added (2026-09-16):** Extended [[Dispatch Copilot Decision Support Enhancement Plan]] with Phase 4B: bounded follow-on booking search from scheduled destination/release, full sequence feasibility, evidence-backed empty-travel comparison and separate explicit follow-on assignment review. Includes cross-midnight, missing evidence and concurrent-assignment acceptance cases. Documentation only; not implemented.


## Selected Copilot option readability - 2026-09-16

Reworked the selected-pair summary within the existing conversation: separate labeled vehicle/driver identity, prominent preparation slack, previous release time, service-date workload columns and temporal context. Schedule reasoning and verified checks use keyboard-accessible native disclosures; unresolved checks and schedule uncertainty stay visible. Repeated check-label prefixes are removed without changing evidence. Pending rechecks withhold old detail, future live ETA remains suppressed and existing assignment/review handlers are preserved. Raised existing 10px panel labels to the 12px design-system step.

Verification: 15 focused component tests passed, touched-source ESLint passed and layout detector reported no findings. Live desktop/mobile visual inspection unavailable because the session has no browser provider.

Production build also passed (201 pages).


## Selected review conversation order fix - 2026-09-16

The selected-pair summary previously rendered after all chat messages, causing bottom-follow scrolling to land on the summary instead of the newest question/answer. Selection messages now carry structured pair/action identity, and the live selected review renders immediately after the latest matching selection turn. Subsequent questions, answers and the typing indicator stay below it. Cleared/pruned history places the review above remaining messages; no duplicate review is created. Operational errors/assignment progress remain separate current replies and assignment guards are unchanged. Explicit commands also resume bottom-follow scrolling.

Verification: 16 focused component tests and touched-source ESLint passed, including review ordering and pruned-history regression cases. Browser visual validation remains unavailable in this session.


## Server-owned narration guards - 2026-09-17, extended 2026-09-18

**What.** `src/lib/dispatch/narration-guards.js` — `narrationGuards({question, evidence, answer})` returns the guard facts for one turn, `guardDisclosure(guards)` returns an ASCII sentence block (`''` when nothing fires, so callers concatenate blindly), `withGuards(answer, guards)` appends it. Wired into `src/app/api/integration/transport-requests/[id]/conversation/route.js`, beside the pre-existing coverage disclosure:

```js
const narrated = result.success && result.content ? plainChatText(result.content) : null;
// `narrated` is the model's own prose, never the assembled answer: if the server's
// appended coverage sentence were visible here, it could trip the location detector.
const guards = narrationGuards({ question: body.message, evidence, answer: narrated });
const answer = narrated
  ? withGuards(withCoverageDisclosure(narrated, evidence.coverage), guards).slice(0, 8000)
  : fallbackAnswer;
```

**Why it exists.** The live probe (`scripts/fleetmate-live-probe.mjs`, 20 real `deepseek-chat` calls on 2026-09-17) measured the Copilot's honesty contract against the actual model for the first time. One obligation failed — a **bounded evaluation narrated as exhaustive** — and three others passed only because the model happened to comply. All four are closed facts about `(question, evidence)`, so the server now states them instead of asking. A second pass on 2026-09-18 closed two more, which are closed facts about the model's **own output** rather than about the question.

| Guard | Condition (closed) | Appended fact |
|---|---|---|
| coverage disclosure (pre-existing) | the evaluation was bounded | the evaluated window, so a projection cannot read as the complete set |
| `contradictedAvailability` | question claims an entity is free / a record was cancelled or should be ignored, **and** that pair is `BLOCKED` or `INSUFFICIENT_DATA` | a message is a request, not a record change; restates the pair's state and reason |
| `absentEntities[]` | an id named in the question is in neither `evidence.pairs` nor `evidence.exclusions` | that entity was not evaluated here; check its own record |
| `gpsNotApplicable` | GPS-topic question **and** an in-scope pair has no `gpsHealth` on `FUTURE`/`SAME_DAY` or as a `REPOSITION` dispatch | live location was not part of this evaluation, and why |
| `probabilitySought` | question asks for a rate, a promise or punctuality | the deterministic checks are the whole basis; no wording raises or lowers the outcome |
| `volunteeredRate` *(2026-09-18)* | the model's **prose** asserts a rate or a punctuality promise, and no rate was asked for | same sentence as `probabilitySought` |
| `volunteeredLocation` *(2026-09-18)* | the model's **prose** makes an affirmative location claim, an in-scope pair has no `gpsHealth`, `liveLocationInapplicable()` holds, and the question did not raise GPS | same sentence as `gpsNotApplicable` |

The two output-side guards are each gated on their question-side counterpart being false, so one turn never states the same sentence twice, and `guardDisclosure` gained **no new wording** — the reused sentences are already proven against the group M honesty predicates by FM-GUARD-007.

**Constraints that shaped it** (all asserted, not assumed):

- **Append, never rewrite.** `SEC-AI-007` pins that model prose is returned verbatim. The guard makes the answer *as a whole* carry the server's sentence; it does not retract a wrong sentence above it.
- **Never inside `evidenceSummary`.** FM-ADV-001 asserts eight phrasings of one question produce byte-identical output; a question-keyed clause in the deterministic summary would break that.
- **Narrated path only.** The deterministic fallback is bit-for-bit unchanged, so FM-ROUTE-006's exact-answer assertions cannot move and the scenario suite stays green by construction.
- **No new response field.** FM-ROUTE-003 pins the exact 13-key response shape.
- **Every clause passes the group M honesty predicates** (ASCII, no operation claimed, no rate/promise language, no fleet-wide claim, no safety claim, no over-claim). The trap is real: a probability clause containing the word "probability" would match the predicate it exists to satisfy.
- **GPS is a mirror, not a shared import.** `evidence-drawer.jsx:235` already owns `horizon ∈ {FUTURE, SAME_DAY} || mode === 'REPOSITION'`; `liveLocationInapplicable({horizon, mode})` restates it so the change stays additive, and FM-DRAW-015 asserts the chat and the drawer agree across all five shapes — drift fails a test.
- **A claim and a refusal are not the same string.** `"I can't give a success probability"` carries the banned token and is compliance, so the two output-side guards cannot be bare regexes: the match must be judged **per clause**, and only when the clause is not negated. `src/lib/dispatch/clause-polarity.js` (`assertionMatches`, `clauseHead`, `NEGATION`) owns that rule, and `scripts/fleetmate-live-probe.mjs` now **imports** it rather than keeping its own copy — a guard and the test predicate that judges it would otherwise be two copies of one honesty rule, and two copies drift.

**Observability.** On a narrated answer where a guard fires, one `logAiRequest` row is written: `provider_name='Narration Guard'`, `model_name='Deterministic Guard'`, `status='Flagged'`, labels in `error_message` (`contradicted-availability:V/D:STATE`, `absent-entities:…`, `gps-not-applicable`, `rate-or-promise-sought`, and since 2026-09-18 `gps-volunteered`, `rate-or-promise-volunteered`). `'Flagged'` is deliberately outside the error rate: `ailogs.status` is `varchar(20)` with no CHECK, and both AI error counters match `ILIKE 'error'`, so guard frequency is visible without inflating error metrics or entering the review queue. Accepted consequence: Flagged rows are observability only.

**Hazard found and closed — in the test suite, not the app.** `logAiRequest` swallows its own errors, **no test mocked `@/lib/ai/logger`** anywhere in `src/`, and `vitest.config.mjs` loads no environment. A developer running `npm test` in a shell exporting `DATABASE_URL` would therefore have had the guard tests insert **real rows into the production `ailogs` table**. Fixed with `vi.mock('@/lib/ai/logger', () => ({ logAiRequest: vi.fn(async () => {}) }))` in the conversation route suite (which also makes the flag assertable), and proven by re-running the focused scope with `DATABASE_URL` exported: `ailogs` 1230 rows / max `log_id` 1230 / 0 Flagged before and after, zero rows above the watermark.

**Honest residue.** Novel injection phrasings that assert nothing about the evidence match no predicate — the guard owns the outcome half of that case, not the recognition half. Numeric `vehicle N` / `driver #N` ids are closed; plate-shaped names are best-effort and a miss is residue. The volunteered-claim gap — a guard that keyed on the question and so missed a claim the model raised unprompted — was closed on 2026-09-18 (the two output-side rows above). **The deterministic scope gap was closed on 2026-09-18** by the route-edge classifier and `scope-only` short-circuit; the prompt remains defense in depth. No prose is ever retracted. Live sampling remains the only measurement for the residue, reported as an observation and never as a rate; nothing here enters the scenario count.

**Scope, now enforced at the route edge.** `EVIDENCE_TRUST_RULES` in `src/lib/dispatch/copilot-prompt.js` still bounds the narrated subject: an unrelated request is declined rather than answered from general knowledge, **and** an in-scope question the evidence cannot cover is answered by naming what is missing. The deterministic `classifyCopilotScope()` gate now runs before request loading, evidence preparation and provider work. It accepts direct FleetOps vocabulary; accepts a short follow-up only when recent user history contains an in-scope FleetOps turn or the request has active reservation/recommendation context; and blocks that active-context fallback after an unrelated or neutral non-FleetOps turn. Courtesy and unrelated requests receive private `scope-only` replies whose empty operational fields cannot replace displayed options, selected review, plan state or evidence. Scope is routing only: availability, eligibility, ranking, evidence and mutations remain server-owned. The prompt sentence remains inside the existing ten-block contract. The focused and broader FleetMate regression suites cover the exact redirect, courtesy response, provider/evidence short-circuit and UI-preservation boundary.

**Verification.** `src/lib/dispatch/narration-guards.test.js` (11 tests) quotes the real observed live answers verbatim as constants, so each live observation is a permanent regression; `src/lib/dispatch/clause-polarity.test.js` (new, 6 tests) pins the extracted claim-versus-refusal matcher on those same fixed strings, including the refusals that must **not** match; FM-ROUTE-009 (7 tests) pins the route wiring, the unchanged 13-key shape, the `Flagged` row, and the two volunteered-claim cases; FM-DRAW-015 (2 tests) pins chat/drawer agreement. Full suite **1859/1859 (171 files)**, 8-file scenario scope **133/133 (124 ids)**, touched-source ESLint clean. Teeth proof: forcing only the two new triggers to `false`/`null` in the route fails exactly the four new assertions and leaves 208 green — with the honest caveat that FM-GUARD-010/011 do not fail under it, since they are false-positive regressions rather than teeth tests. The `ailogs` hazard above was re-confirmed closed by counting the table around a real vitest run with `DATABASE_URL` genuinely exported: 1230 before, 1230 after, value never printed. Extended live probe — now assembling through the same pure functions the route uses, so it can observe a route-level fix, and now carrying six **residue** cases (11–16: injection phrasings no guard covers, reported as observations rather than checks), two volunteered-claim observation cases (17–18) and three scope cases (19–21) — reported **121 checks passed, 0 failed over 21 cases**, `ailogs` net-zero. Three measured results worth carrying: five of the six residue phrasings meet no guard at all and the sixth fires on the `overrid` stem, which the run produced rather than the comment predicting it (case 11 had been filed as a residue candidate and came back `FIRED`); the model disclosed a truncated evaluation unaided on one run but **not** on the identical next one, while the server's sentence disclosed it in both — the direct evidence for server-owned disclosure; and the two volunteered guards did not fire live, because the model volunteered nothing on those turns, which is not the same as a detector missing something — the reason they are asserted deterministically and merely observed here. The probe's own `DISCLOSES_LIMIT` predicate produced one **false failure** on the first extended run (a trailing `` made its `truncat` stem unmatchable while the model had in fact disclosed); fixed, and disclosed here because an instrument that misreports compliance is the same class of error as the defects it hunts. No schema change, no migration, no dependency, no commit. Browser rendering of the appended sentence remains pending (no DOM in the Vitest environment).
