# Dispatch Copilot UI Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 25 findings in the 2026-10-02 Dispatch Copilot UI audit without weakening eligibility, assignment, privacy, or queue-plan safety.

**Architecture:** Retain the existing FleetOps queue + single-mounted Copilot aside/drawer. Make decision presentation derive from one shared mapping, keep the active decision outside the historical transcript, use the existing validated assignment/recovery paths, and handle responsiveness by *available content width*. Improve presentation and accessibility in focused components; do not create a second planner, AI service, database migration, or global visual redesign.

**Tech Stack:** Next.js 16.2 App Router, React 19, Tailwind v4, Radix Dialog, TanStack Query, Vitest, existing FleetOps token system.

## Global Constraints

- **Status:** This is a proposed plan, not implementation authorization. Do not modify UI until the user approves this plan and its design direction.
- **Visual authority:** Preserve `DESIGN.md` and the queue/Copilot composition from `Capstone/07 - Development/Dispatch Copilot Persistent Workspace Plan.md`: Inter, neutral surfaces, semantic status colors, dark mode, compact operator-grade density. High-end visual refinement must be restrained and product-specific; do not impose the conflicting global font/marketing-page rules in High-End Visual Design on this established dashboard.
- **Truth boundary:** Deterministic evidence decides eligibility; the language model explains, never assigns. Preserve queue `plan_token`, explicit named-pair confirmation, 409 recovery, and uncertain-outcome reconciliation. Missing values remain unknown. No fabricated copy, rating, location, ETA, or bag count.
- **Active-trip boundary:** Do not treat a committed pair as a new unassigned recommendation or enable a second assignment through the conversation. Confirm what the existing conversation route supports before enabling assigned/in-progress Q&A; any unsupported active-trip prompt stays read-only or unavailable rather than claiming current eligibility.
- **Permissions/privacy:** Keep existing `reservations:read/recommend/assign` checks and route-level authorization. Do not expose GPS coordinates or introduce unauthorized record links.
- **Repository policy:** Read `.agents/AGENTS.md` and relevant vault notes before implementation; read the relevant installed Next.js guide under `node_modules/next/dist/docs/` before any Next.js code. At completion update `Capstone/02 - Features/AI Advisory.md`, `Capstone/02 - Features/Reservations.md`, the audit note and `SYSTEM.md` with actual outcomes. Never modify user-owned dirty files wholesale; use targeted edits and inspect diffs before commits.
- **Process:** Before Task 1, read the relevant installed Next.js 16.2 App Router guides under `node_modules/next/dist/docs/01-app/` for client components, routing/navigation, hydration and image handling. TDD for each functional change: failing regression → verify red → minimal implementation → verify green. Do not turn `EPERM`/test startup failure into a pass; report it and use a supported approval/boundary path. No fresh dependencies unless approved.
- **Verification:** Run targeted tests, relevant authorization/security suites, touched-file ESLint, full `npm run test:run`, `npm run build`, and one bounded authenticated visual pass (desktop+mobile together, one batch of corrections, at most one confirmation pass). No live assignment or destructive production action for visual QA.

## Design direction / alternatives

**Recommended: targeted rehabilitation of the current decision workstation.** A stable decision dock anchors explicit confirmation; chat remains explanation/history, not a mutation surface. Shared status semantics distinguish Ready, Review required, Needs verification, Blocked, Waiting, Not evaluated, Failed/Unavailable, and lifecycle statuses. At narrow *workspace* widths the same Copilot body moves into a focused dialog. The existing identity, navigation and card structure stay intact; remove repeated visual noise rather than replacing the product design.

**Alternative A — patch only P1:** smaller initial diff, but the same status, focus, density and motion issues would remain in the P2 layer and undercut the request to fix the *whole* audit. **Alternative B — visual redesign:** could look fresher but expands risk, conflicts with the approved `DESIGN.md`, and makes operational regressions harder to isolate. Neither is recommended. Approval of this plan selects the targeted approach; raise a separate decision if the user wants a new visual world.

## File ownership map and dependencies

| Owner | Files | Role |
|---|---|---|
| Pure presentation contract | `src/lib/dispatch/queue-presentation.js` (new), `src/components/ui/status-badge.jsx` | One decision/lifecycle label + semantic tone mapping, no new eligibility logic |
| Queue | `src/components/reservations/reservation-queue-table.jsx`, `src/app/(dashboard)/reservations/queue/page.js`, `src/components/reservations/dispatch-plan-panel.jsx` | Honest data, accessibility semantics, selection, responsive split and dialog |
| Decision | `src/components/reservations/ai-recommendation-panel.jsx`, `src/components/reservations/copilot-option-flow.jsx` | Error/terminal state gating, pair review and confirmation |
| Conversation/evidence | `src/components/reservations/copilot-conversation.jsx`, `src/components/reservations/evidence-drawer.jsx` | History, decision dock, focus, safe links, proof/inspector |
| Visual primitives | `src/components/reservations/copilot-avatar.jsx` (new), `src/components/reservations/copilot-state-message.jsx` (new only if reused by ≥2 states) | Static decorative avatar and consistent actionable messages |
| Tests/docs | Existing neighboring `*.test.js`, focused new test files, vault notes, `SYSTEM.md` | Red/green coverage and honest acceptance record |

Tasks 1–3 establish the truth/lifecycle contract; task 4 depends on task 2; tasks 5–8 can be reviewed independently after task 1 where noted; tasks 9–10 finish integration and browser/documentation verification. Preserve any existing uncommitted changes in `conversation.js`, its tests and other unrelated files; do not overwrite them or commit them accidentally.

---

### Task 1: Canonical queue status and truthful request metrics

**Audit coverage:** P1-01 (queue mapping), P1-09, P2-03.

**Files:**
- Create: `src/lib/dispatch/queue-presentation.js`, `src/lib/dispatch/queue-presentation.test.js`
- Modify: `src/components/ui/status-badge.jsx`, `src/components/reservations/reservation-queue-table.jsx`
- Test: `src/components/reservations/queue-workspace.test.js`

**Interfaces:** `queuePresentation(request, bucket)` returns `{ label, status, entity }` for `StatusBadge`; `bagSummary(request)` returns `'Bags not recorded'` if absent, preserving recorded zero.

- [ ] **Step 1: Write failing table tests.** Pin all plan buckets and lifecycle precedence, including `Needs verification` ≠ `Review required`, Pending Reassignment outranking a proposal, Assigned/Completed outranking old proposal data, and missing vs zero luggage:

```js
expect(queuePresentation({fleet_status:'Scheduled'},'Needs verification'))
  .toEqual({label:'Needs verification',status:'Needs verification',entity:'copilot'});
expect(queuePresentation({fleet_status:'Assigned'},'Ready for confirmation').label).toBe('Assigned');
expect(bagSummary({passenger_count:3,luggage_count:null})).toBe('Bags not recorded');
expect(bagSummary({luggage_count:0})).toBe('0 bags');
```

- [ ] **Step 2: Run `npx vitest run src/lib/dispatch/queue-presentation.test.js src/components/reservations/queue-workspace.test.js`; expect RED** because exports do not yet exist.
- [ ] **Step 3: Implement a finite presentation map only.** Map `Ready for confirmation → Ready/success`, `Review required → Review required/warning`, `Needs verification → Needs verification/warning` (distinct text/icon), `Blocked → Blocked/danger`, `Waiting for preceding request → Waiting/info`, `Not evaluated → Not evaluated/secondary`, and lifecycle states to the existing `reservation` map. Put `copilot` tones in `ENTITY_MAPS` in `status-badge.jsx`; never calculate eligibility here. Replace duplicated private pill classes with `StatusBadge status={status} entity={entity} label={label}`. Keep selection highlight in primary, not success. Replace the existing `{bags} {bags === 1 ? 'bag' : 'bags'}` expressions with `bagSummary(r)` in both queue views, without deriving it from passenger count.
- [ ] **Step 4: Run the focused tests; expect GREEN.** Check unassigned is neutral/warning rather than healthy green, zero bags remains zero, and verified ready differs from missing evidence.
- [ ] **Step 5: Review diff and commit only this task’s paths:** `git add src/lib/dispatch/queue-presentation.js src/lib/dispatch/queue-presentation.test.js src/components/ui/status-badge.jsx src/components/reservations/reservation-queue-table.jsx src/components/reservations/queue-workspace.test.js; git commit -m "fix(copilot): show truthful queue states and luggage"`.

### Task 2: Distinguish recommendation failure, empty evaluation and eligibility inspector verdict

**Audit coverage:** P1-01 (failure/no-match/inspector), P2-08 (consistent errors).

**Files:**
- Modify: `src/components/reservations/ai-recommendation-panel.jsx`, `src/components/reservations/copilot-option-flow.jsx`, `src/components/reservations/evidence-drawer.jsx`
- Test: `src/components/reservations/ai-recommendation-panel.test.js`, `src/components/reservations/evidence-drawer.test.js`
- Optional create after second real consumer: `src/components/reservations/copilot-state-message.jsx`

**Interfaces:** `inspectorConclusion(rows)` returns a bounded sentence from precedence blocked → verify/empty → evaluated clear. `CopilotOptionFlow` receives only a *completed* recommendation result, never a failed fetch.

- [ ] **Step 1: Add failing render tests:** an initial recommendation error does **not** render “No eligible option”; failed plan shows an alert with recovery; blocked and missing inspector rows do **not** say “Eligible.”

```js
state.query = {data:undefined,isError:true,error:new Error('network'),refetch:vi.fn()};
expect(render()).not.toContain('No eligible option is currently available');
expect(inspectorConclusion([{state:'blocked'}])).toMatch(/Blocking/);
expect(inspectorConclusion([{state:'verify'}])).toMatch(/verification/i);
```

- [ ] **Step 2: Run `npx vitest run src/components/reservations/ai-recommendation-panel.test.js src/components/reservations/evidence-drawer.test.js`; expect RED** on the new assertions.
- [ ] **Step 3: Implement strict state precedence:** first load → checking; failed fetch → unavailable + retry and historic findings explicitly labelled historic (if present); completed evaluation with zero qualifying options → no eligible options *within this evaluation*; incomplete/unevaluated result → unknown, not a fleet-wide exclusion. Gate `flowNode` on successful evidence; preserve earlier details without making them actionable. Compute inspector conclusion from row states and include source/evaluation bound. Reuse one error block design only if at least two states actually need it; evidence failure gets Retry/Close.
- [ ] **Step 4: Re-run focused tests and relevant `src/lib/dispatch/decision.test.js`; expect GREEN.** Check error status wins over stale/loading banners and never enables confirmation.
- [ ] **Step 5: Review diff; commit focused files only** with `fix(copilot): separate failed evidence from no eligible options`.

### Task 3: Post-assignment status truth and active-trip read-only conversation

**Audit coverage:** P1-03, P1-04.

**Files:**
- Modify: `src/components/reservations/ai-recommendation-panel.jsx`, `src/app/(dashboard)/reservations/queue/page.js`, `src/components/reservations/copilot-conversation.jsx`
- Test: `src/components/reservations/ai-recommendation-panel.test.js`, `src/components/reservations/copilot-assignment-flow.test.js`, `src/components/reservations/copilot-conversation.test.js`
- Inspect before implementation: `src/app/api/integration/transport-requests/[id]/conversation/route.js` and its tests; no server changes unless the route demonstrably needs a narrow, separately tested read-only adjustment.

**Interfaces:** `assignmentClosed = committed || ['Assigned','In Progress','Completed','Cancelled'].includes(status)`; `conversationClosed = ['Completed','Cancelled'].includes(status)`; `displayedRequest = committedSuccessForId ?? selectedRequest` while awaiting refreshed state.

- [ ] **Step 1: Write failing lifecycle tests.** First post-success render must say Assigned with the committed pair, not stale Scheduled. Assigned/In Progress render context and a permitted read-only question composer, but never an assignment control; Completed/Cancelled have no composer.

```js
expect(firstPostSuccessHtml).toContain('Assigned');
expect(firstPostSuccessHtml).not.toContain('Scheduled</');
expect(assignedChatProps.completed).toBe(false);
expect(assignedHtml).not.toContain('Confirm assignment');
```

- [ ] **Step 2: Run the three focused suites; expect RED.** Inspect the current conversation endpoint’s recommendation projection for committed requests and whether `selectedPair` can safely be the committed vehicle/driver.
- [ ] **Step 3: Separate read-only discussion from mutation state.** Persist the returned successful resource IDs/status until the matching fresh request record arrives; construct one `displayedRequest` and pass it consistently to the terminal card and parent. Preserve the existing 30-second query cadence only for unassigned work; do not present newly ranked unassigned options for committed trips. Route active-trip questions through the existing permission-checked conversation endpoint with the committed pair as *context*, not as a submit-ready choice. If server evidence cannot support a prompt, show a bounded unavailable message instead of a fresh-readiness claim. “Check replacement options” is explicitly read-only; the only existing mutation path remains dispatch detail’s authorized reassignment flow.
- [ ] **Step 4: Re-run focused tests, conversation route tests and assignment security tests; expect GREEN.** Validate no accidental second assignment, no loss of pending `lockedRequest` isolation, and correct Completed/Cancelled gating.
- [ ] **Step 5: Review diff and commit focused files** with `fix(copilot): keep committed status and active-trip discussion honest`.

### Task 4: Move current decision into a persistent, accessible dock

**Audit coverage:** P1-02, P2-07, P2-13.

**Files:**
- Modify: `src/components/reservations/copilot-conversation.jsx`, `src/components/reservations/ai-recommendation-panel.jsx`
- Test: `src/components/reservations/copilot-conversation.test.js`, `src/components/reservations/copilot-assignment-flow.test.js`, `src/components/reservations/ai-recommendation-panel.test.js`

**Interfaces:** Replace `selectedReply` prop with `decisionDock` (React node, mounted once outside `role="log"`, before the composer); keep `reply` for nonactionable messages. `clearReservationMessages(requestId)` may retain logout-wide clearing, but the UI button becomes explicit `Reset Copilot` with `onResetDecision` callback that clears local *and* stored selection immediately.

- [ ] **Step 1: Change the existing transcript-order test to fail until the live review appears exactly once *after* the log and *before* the composer, regardless of message count/pruning.** Add a test that resetting the active decision clears both local and session state; add a jump-to-latest affordance test when scroll follow is paused and a reply arrives.

```js
expect(html.indexOf('role="log"')).toBeLessThan(html.indexOf('data-decision-dock'));
expect(html.indexOf('data-decision-dock')).toBeLessThan(html.indexOf('<form'));
expect(html.match(/data-decision-dock/g)).toHaveLength(1);
```

- [ ] **Step 2: Run focused suites; expect RED.**
- [ ] **Step 3: Keep historical selected-pair messages inert.** Render current pair identity, blocker/review reason, manual override reason, fresh-check state, Confirm and Change selection in a bounded sticky/footer decision dock above the composer. Reuse existing `reviewCurrent`, `dispatchConfirmation`, `confirmSelection`, `chooseAnother` and queue token; never create a second submit path. Make the reset action explicit, immediate, and unavailable while assignment outcome is uncertain. If the user is reading old messages, expose a keyboard-accessible “New reply — jump to latest” button rather than yanking scroll.
- [ ] **Step 4: Re-run focused tests; expect GREEN.** Confirm message-only questions cannot submit, the confirm button is visible after long Q&A, single submission remains single, and changing request remounts one dock.
- [ ] **Step 5: Review diff and commit focused files** with `fix(copilot): pin current decision above conversation composer`.

### Task 5: Repair nested option controls and both evidence/mobile focus lifecycles

**Audit coverage:** P1-05, P1-06, P2-05, P2-11.

**Files:**
- Modify: `src/components/reservations/copilot-option-flow.jsx`, `src/components/reservations/evidence-drawer.jsx`, `src/components/reservations/copilot-conversation.jsx`, `src/components/reservations/dispatch-plan-panel.jsx`, `src/app/(dashboard)/reservations/queue/page.js`
- Test: new `src/components/reservations/copilot-option-flow.test.js`; existing `evidence-drawer.test.js`, `copilot-conversation.test.js`; authenticated keyboard browser check.

**Interfaces:** Option card is a noninteractive `article`, one named selection `Button` per pair, sibling `<details>`. Evidence proof remains GET-only with the existing request/ref scope; mobile dialog and evidence overlay receive exact opener refs and close handling.

- [ ] **Step 1: Add failing static tests:** no `role="button"` on an option ancestor, choice button’s accessible name contains plate + driver, decorative assistant avatar has `alt=""`; no custom modeless dialog overlay. Add browser interaction script/checklist for Enter/Space on `<summary>`, Escape, initial focus, return focus and busy Close.

```js
expect(optionHtml).not.toContain('<section role="button"');
expect(optionHtml).toMatch(/aria-label="Choose Option 1[^\"]*ABC[^\"]*Marco/);
expect(optionHtml).toContain('<details');
```

- [ ] **Step 2: Run focused static suites; expect RED.** Browser keyboard check is the post-implementation behavioral gate; static markup alone cannot prove focus.
- [ ] **Step 3: Implement native interaction structure.** Do not attach click/keydown to an ancestor of disclosure/choice; one explicit choice button carries pair identity and state in its name. Convert the covering evidence view to the project’s Radix dialog pattern (nested-dialog focus management tested inside mobile drawer), retaining its visual right-side placement. Keep focus on title/Close on open; Escape closes; focus returns to the exact Review trigger after Close/Back; no hidden background tab stops. Mobile drawer returns focus to the row or Open Copilot trigger even without a `DialogTrigger`. When assignment is busy, Close is visibly disabled with status context, not a silent no-op.
- [ ] **Step 4: Run focused tests, keyboard acceptance, and an explicit nested-dialog check on mobile; expect GREEN.** Confirm evidence remains GET-only, and no proof request fires merely from focus or opening the panel.
- [ ] **Step 5: Review diff and commit focused files** with `fix(copilot): use native option controls and restore drawer focus`.

### Task 6: Reflow by usable width; improve queue semantics and target sizing

**Audit coverage:** P1-10, P2-01, P2-02, P2-09, P2-10, P2-12.

**Files:**
- Modify: `src/app/(dashboard)/reservations/queue/page.js`, `src/components/reservations/dispatch-plan-panel.jsx`, `src/components/reservations/reservation-queue-table.jsx`, `src/components/reservations/copilot-conversation.jsx`, `src/components/reservations/copilot-option-flow.jsx`, `src/components/reservations/evidence-drawer.jsx`
- Test: `src/components/reservations/queue-workspace.test.js`, focused new `src/components/reservations/queue-accessibility.test.js`; real-browser screenshots/DOM bounds after implementation.

**Interfaces:** `useWorkspaceAside(hostRef)` returns true only when observed *content* width ≥ **1120 CSS px** (460 aside + 24 gap + ≥636 queue); first render returns false to avoid SSR hydration mismatch. CSS queue-row switch keys off its *own container*, not viewport. Only one Copilot body is ever mounted; freeze a busy operation’s presentation until it resolves.

- [ ] **Step 1: Add failing structure tests** for a labelled list of rows, honest `role="alert"` and `aria-busy`, labelled filter group without false tab semantics, and no fabricated mobile hero overflow. Add a browser fixture with long route/guest strings, both sidebar states, 1280/1366/1920px and 390px widths.

```js
expect(queueHtml).toContain('aria-label="Transportation requests"');
expect(queueHtml).not.toContain('role="tablist"');
expect(queueHtml).toContain('Bags not recorded');
```

- [ ] **Step 2: Run focused tests; expect RED.**
- [ ] **Step 3: Implement measured workspace layout.** Use a `ResizeObserver` on the main workspace container (with cleanup) rather than `(min-width:1280px)`. Keep one mounted aside/drawer decision body; preserve selection when crossing the threshold; prevent a mid-commit layout swap. Make the hero’s action buttons wrap/stack individually at 390px. Change rows’ horizontal breakpoint to a container query or responsive layout based on the queue column, remove fixed 220px segments where necessary, allow two-line guest/category/route labels, preserve full accessible names, and prevent page-wide horizontal overflow. Use a named list (`ul/li`) with real selection buttons where nested actions permit; avoid creating nested button descendants. Either implement full ARIA tabs or (preferable here) use a labelled filter-button group with `aria-pressed`, as the controls navigate between filtered queues rather than document tabpanels. Announce loading/failure using `aria-busy`, a visually hidden status and `role="alert"`; use motion-safe skeleton pulse. Enlarge operator touch areas to ≥44px for primary/interactive controls; do not rely on undeclared `Button size="xs"`.
- [ ] **Step 4: Re-run focused tests and browser reflow checks.** At 1280 with expanded nav use drawer rather than a crushed queue; at 1366 use split only if actual content width suffices; at 1920 split; 390px and 200% zoom have no page horizontal scroll, obscured focus, missing route identity, or unreachable primary action.
- [ ] **Step 5: Review diff and commit focused files** with `fix(copilot): adapt workspace to available width and improve queue semantics`.

### Task 7: Correct recovery destinations, comparison identity and bounded retry

**Audit coverage:** P1-08, P2-06, P2-08 remaining proof retry.

**Files:**
- Modify: `src/components/reservations/copilot-conversation.jsx`, `src/components/reservations/evidence-drawer.jsx`
- Test: `src/components/reservations/copilot-conversation.test.js`, `src/components/reservations/evidence-drawer.test.js`, `src/components/reservations/evidence-drawer-fleetmate.test.js`
- Route inventory for allowed targets: `src/app/(dashboard)/fleet/vehicles/[id]/page.js`, `src/app/(dashboard)/fleet/vehicles/page.js`, `src/app/(dashboard)/drivers/[id]/page.js`, `src/app/(dashboard)/drivers/page.js`, `src/app/(dashboard)/maintenance/page.js`, `src/app/(dashboard)/driver/schedule/page.js`. Verify ID semantics and role access before linking.

**Interfaces:** Export `recoveryHref(action)` from `copilot-conversation.jsx` for focused tests; it returns a valid in-app URL or `null` for unsupported records. The caller checks `useRoleAccess` before rendering any returned link; a null/unauthorized target yields guidance text, never a 404 link. Comparison proof presents immutable `vehicleId/driverId` from the existing signed server facts, optionally operational names *only if those are already present*.

- [ ] **Step 1: Add failing tests** for `/fleet/vehicles/:id` and existing directory routes, no `/vehicles` or `/schedules` URLs, no unsafe ID interpolation, comparison columns identifying both actual pairs, and proof retry issuing another GET only on explicit activation.

```js
expect(recoveryHref({record:'vehicle',id:17})).toBe('/fleet/vehicles/17');
expect(recoveryHref({record:'schedule',id:null})).toBeNull();
expect(comparisonHtml).toContain('Vehicle #1 / Driver #2');
```

- [ ] **Step 2: Run focused suites; expect RED.**
- [ ] **Step 3: Implement allowlisted, permission-aware navigation.** Target real routes only; for a driver schedule use a verified driver-specific or schedule page only when access is permitted, otherwise show plain corrective guidance. Existing comparison proof already carries `vehicleId/driverId`; show those immutable identities and checked timestamp; never guess a plate or name absent from proof. Add explicit Retry/Close for transient proof fetch failures without automatic polling, changing evidence scope or modifying the signed reference.
- [ ] **Step 4: Re-run focused tests and evidence security tests; expect GREEN.** Confirm stale/tampered/cross-request refs still fail and retry cannot create an assignment.
- [ ] **Step 5: Review diff and commit focused files** with `fix(copilot): link real records and identify compared pairs`.

### Task 8: Contrast, motion restraint and product-specific visual polish

**Audit coverage:** P1-07, P2-04, P2-05, P3-01, P3-02.

**Files:**
- Create: `src/components/reservations/copilot-avatar.jsx` (static existing asset wrapper), optional `src/components/reservations/copilot-contrast.test.js`
- Modify: `src/components/reservations/copilot-conversation.jsx`, `src/components/reservations/copilot-option-flow.jsx`, `src/components/reservations/ai-recommendation-panel.jsx`, `src/components/reservations/dispatch-plan-panel.jsx`, `src/app/(dashboard)/reservations/queue/page.js`, `src/components/reservations/evidence-drawer.jsx`
- Existing asset: `public/images/copilot-avatar.png` (do not generate a new one).

**Interfaces:** `CopilotAvatar({size, decorative=true})` uses the existing static PNG by default; parent supplies a textual accessible name only once. Status text uses `*-700` ink on light/dark token surfaces; rest-state has no infinite pulse.

- [ ] **Step 1: Add failing contrast and markup assertions:** text/background pair ≥4.5:1 for normal text, essential icons ≥3:1, no looping GIF in repeated messages, no idle `animate-ping`, and no redundant decorative avatar alt.

```js
expect(contrast('#3b82f6','#eff6ff')).toBeLessThan(4.5); // proves old pair fails
expect(chatHtml).not.toContain('copilot-avatar-blinking.gif');
expect(chatHtml).toContain('text-info-700');
```

- [ ] **Step 2: Run focused tests; expect RED** on the new presentation assertions (old contrast failure is a control, not the passing criterion).
- [ ] **Step 3: Replace normal-sized `text-info`, `text-warning`, and `text-danger` with existing AA ink tokens `info-700`, `warning-700`, and `danger-700`; check dark variants and SVG icon contrast.** Use the static asset in repeated bubbles and idle states, remove idle pulse, keep only activity-tied motion with reduced-motion fallbacks. Keep header identity but reduce repeated rounded card/bubble layers and unneeded green pills. Use stronger typography/grouping for evidence and the dock within existing `DESIGN.md` radii/spacing; preserve Inter and operator density. Remove `ID {driver_id}` from primary option card unless it is an actual staff-facing code (no invented replacement label). Do not redesign navigation, dashboard theme, or other pages.
- [ ] **Step 4: Run focused tests and one batched light/dark visual check at desktop+mobile; expect all essential text readable and no repeated/idle infinite animation.** Treat any further polish as part of the bounded final acceptance pass, not open-ended iterations.
- [ ] **Step 5: Review diff and commit focused files** with `style(copilot): improve status contrast and quiet repeated motion`.

### Task 9: Integrated regression, Next.js compliance and cross-role safety

**Audit coverage:** all P1/P2/P3 as integration, preserving existing strengths.

**Files:** Test updates adjacent to touched components; no schema changes.

- [ ] **Step 1: Confirm the Next.js 16.2 guide preflight in Global Constraints was completed before Task 1.** Re-read relevant security/decision tests for queue-token validation and role boundaries before running the integrated suite.
- [ ] **Step 2: Add/adjust integrated tests** for request switch + late response, stale plan/dependency, manual reason, one commit, 409, network ambiguity, post-success refresh, Assigned/In Progress read-only behavior, drawer focus/return, option disclosure keyboard behavior and lifecycle status. Update any older tests that explicitly locked in the now-rejected historic selection card or false success text; explain the changed contract in test names.
- [ ] **Step 3: Run targeted test sets:**

```powershell
npx vitest run src/components/reservations src/lib/dispatch/decision.test.js src/app/api/integration/transport-requests/'[id]'/conversation/route.test.js
npx eslint 'src/app/(dashboard)/reservations/queue/page.js' 'src/components/reservations' 'src/components/ui/status-badge.jsx' 'src/lib/dispatch/queue-presentation.js' --max-warnings 0
npm run test:run
npm run build
```

Expected: all tests pass, touched-source lint zero warnings, build succeeds. If the environment denies esbuild spawning with `EPERM`, record **not run**, use the sandbox’s documented escalation path only if authorized; do not claim success.
- [ ] **Step 4: Review role/security invariants:** dispatcher can review/confirm with current plan; management read-only, no hidden confirm; no cross-reservation persisted state leak, no unauthorized recovery link; no bypass of plan-token or current pair revalidation. Commit only scoped test/code changes with `test(copilot): cover audited workflow and access boundaries`.

### Task 10: Bounded authenticated visual acceptance and documentation

**Audit coverage:** final verification for all 25 findings.

**Files:**
- Update after actual verification: `Capstone/02 - Features/AI Advisory.md`, `Capstone/02 - Features/Reservations.md`, `Capstone/07 - Development/Dispatch Copilot UI UX Audit.md`, `SYSTEM.md`.

- [ ] **Step 1: Use the existing running project URL or an approved managed job; do not start a replacement server to imply it updates an unrelated GUI.** Obtain an authorized *test* dispatcher session. If no browser or account access is available, explicitly mark visual acceptance pending and do not infer pass from promotional stills or static markup.
- [ ] **Step 2: Batch one visual inspection across desktop/mobile together:** 1366×768 and 1920×1080 with expanded/collapsed sidebar, 1280px pressure case, 390×844 mobile, 200% zoom, light/dark. Exercise no-selection, checking, ready, manual-review, needs-verification, blocked, no-match, failed-fetch, stale, assigned, in-progress, completed and cancelled states. Inspect keyboard focus and return, Enter/Space on disclosure vs choice, Escape/Back, long names/routes, zero/missing luggage, touch targets, no page-wide horizontal scroll, decision dock at minimum height, and announced errors. Use non-destructive fixture data; never make a real production assignment for QA.
- [ ] **Step 3: Fix all defects observed in one batch, confirm with *at most one* additional visual pass, then stop.** If acceptance remains blocked, record specific unverified states and screenshots not obtained; do not silently accept them.
- [ ] **Step 4: Re-run the scoped Impeccable detector and final focused tests/lint/build after the batch; compare each audit finding against its test/manual evidence.** Do not promise a numeric score improvement until the checks actually support it.
- [ ] **Step 5: Update feature notes, audit status, and `SYSTEM.md` with exact behavior changes, verification counts, browser evidence/limits and remaining risks.** Commit documentation only after inspecting the dirty tree and staging exact files; never sweep unrelated existing modifications into the commit.

## Coverage map / approval checkpoint

| Finding | Owning task(s) |
|---|---|
| P1-01 | 1, 2 |
| P1-02 | 4 |
| P1-03, P1-04 | 3 |
| P1-05, P1-06 | 5 |
| P1-07 | 8 |
| P1-08 | 7 |
| P1-09 | 1 |
| P1-10 | 6 |
| P2-01, P2-02, P2-09, P2-10, P2-12 | 6 |
| P2-03 | 1 |
| P2-04, P2-05 | 8 (and 5) |
| P2-06 | 7 |
| P2-07, P2-13 | 4 |
| P2-08 | 2, 7 |
| P2-11 | 5 |
| P3-01, P3-02 | 8 |

**Approval requested:** implement all 10 tasks in the stated order, preserving the established FleetOps visual world and safety contract. The plan and this documentation update are the only changes in this planning turn; execution begins only after explicit approval.
