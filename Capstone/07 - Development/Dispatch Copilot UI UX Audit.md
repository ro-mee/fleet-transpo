# Dispatch Copilot UI/UX Audit

**Date:** 2026-10-02  
**Status:** Approved remediation in progress; Tasks 1–3 committed and independently reviewed; Task 2 has one Minor duplicate-control finding spanning two edge states, and Task 3 has two Minor observations deferred to final review; Tasks 4–10, production build, and authenticated browser acceptance remain pending<br>
**Scope:** The reservation queue, persistent desktop workstation, responsive drawer, recommendation and option states, selected-pair review, conversation UI, evidence drawers, and assigned/in-progress/completed/cancelled terminal presentation.

## Method and limits

This audit combined:

- **Impeccable:** technical UI audit, implementation integrity, accessibility, responsive behavior, theming, and performance.
- **UI/UX Pro Max:** keyboard interaction, focus management, touch targets, responsive overflow, semantic feedback, and WCAG-oriented checks.
- **High-End Visual Design:** hierarchy, density, tone, product specificity, premium craft, motion restraint, and avoidance of generic chatbot/dashboard conventions.

The audit inspected the current source, `PRODUCT.md`, `DESIGN.md`, the Dispatch feature notes, and all current Dispatch Copilot planning/audit notes. The Impeccable detector returned `[]` for the scoped files; every issue below was therefore verified in context rather than copied from automated output. Focused ESLint passed with zero output.

An authenticated live browser session was not available. A local app was reachable on port 3000, but isolated Chrome/Edge screenshot capture did not produce a usable artifact (Edge reported a crashpad access denial). Existing `motion/stills` were treated as promotional material, not proof of the current shipped interface. Responsive and visual judgments are source-derived and should be confirmed in a bounded browser pass at 1366×768, 1440×900, 1920×1080, 390×844, and 200% zoom.

The focused Vitest command could not start because the sandbox denied esbuild's child-process spawn with `EPERM`; it was not retried through a workaround. No application behavior was changed by this audit.

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|---|---:|---|
| 1 | Accessibility | **2/4** | Strong base semantics, but the evidence overlay lacks dialog focus behavior, option cards nest controls, and several semantic color pairs fail 4.5:1. |
| 2 | Performance | **3/4** | Bounded history and query cadence are good; the repeatedly rendered 1024px animated avatar is avoidable motion/decoding overhead. |
| 3 | Responsive Design | **1/4** | The mobile drawer exists, but the 1280px viewport breakpoint predictably leaves only ~508px for dense queue rows beside an expanded sidebar; mobile hero actions also cannot wrap independently. |
| 4 | Theming | **2/4** | Global semantic tokens exist, but Copilot maintains local status/color grammars and uses raw emerald/blue/rose/slate values heavily. |
| 5 | Implementation Integrity | **2/4** | The system is strongly product-specific, but several verified truth, lifecycle, route, and action-placement defects remain. |
| **Total** |  | **10/20** | **Acceptable — significant work needed** |

## Implementation Integrity Verdict

**PASS for product specificity; FAIL for release readiness until the P1 findings are resolved.**

The composition is genuinely specific to dispatch operations: a prioritized request queue sits beside pair identity, Manila-scoped schedule/workload facts, deterministic evidence, revalidation, and explicit dispatcher confirmation. It could not be relabeled as an unrelated generic chatbot without losing its core logic.

However, a trustworthy operational system must never collapse “needs verification” into “needs review,” show “eligible” beneath blocking evidence, infer luggage from passenger count, or send corrective actions to missing routes. These are not subjective polish issues; they weaken operational truth.

## Executive Summary

- **Score:** 10/20 — Acceptable, with significant work needed.
- **Findings:** **0 P0**, **10 P1**, **13 P2**, **2 P3**.
- **Strongest quality:** The queue/workstation architecture and identity-pinned, revalidated assignment flow are unusually product-specific and safety-conscious.
- **Largest risks:** misleading operational states, confirmation disappearing into transcript history, inaccessible evidence overlay behavior, broken corrective links, and lifecycle contradictions immediately after assignment.
- **Recommended first release gate:** fix findings P1-01 through P1-10, then run a real authenticated desktop/mobile/zoom acceptance pass.

---

## P1 — Major findings

### P1-01 — Operational states are collapsed or contradicted

- **Locations:**
  - `src/components/reservations/reservation-queue-table.jsx:154-173`
  - `src/components/reservations/ai-recommendation-panel.jsx:768-776, 878-893`
  - `src/components/reservations/evidence-drawer.jsx:213-246, 274`
- **Category:** Implementation integrity / Accessibility
- **Evidence:**
  1. Canonical `Needs verification` is visibly relabeled `Needs review`, making incomplete evidence look equivalent to an allowed manual-review state.
  2. When the recommendation request fails with no candidates, the option flow can still announce “No eligible option is currently available,” even though evaluation failed.
  3. The inspector supports `blocked` and `verify` rows but always ends with “Eligible based on the evaluated server evidence.”
- **Impact:** A dispatcher can interpret uncertainty, failed evaluation, or blocking evidence as permission to proceed.
- **Standard:** Operational-truth and fail-closed product principles; WCAG 3.3.2/3.3.3 for accurate instructions and recovery context.
- **Recommendation:** Render one canonical four-state vocabulary from a shared decision-status source. Distinguish `error`, `not evaluated`, `needs verification`, `review required`, `blocked`, and `ready`. Compute the inspector conclusion from row state; never show unconditional success copy.
- **Suggested command:** `$impeccable clarify`

### P1-02 — The active confirmation action disappears into chat history

- **Locations:**
  - `src/components/reservations/copilot-conversation.jsx:378-382, 538, 591-655`
  - `src/components/reservations/ai-recommendation-panel.jsx:747-759`
- **Category:** UX / Implementation integrity
- **Evidence:** The live selected-pair review and Confirm button are injected at the historical selection turn. Follow-up questions append below and auto-scroll to the newest message, while the composer remains at the bottom.
- **Impact:** After asking questions, the primary high-stakes action leaves the viewport. Typing “Assign it” becomes more discoverable than the explicit confirmation control.
- **Recommendation:** Keep historical transcript entries inert. Move the current pair, state, reason, Confirm, and Change-selection controls into a persistent decision dock above the composer. Let it collapse, but never leave the viewport while a decision is active.
- **Suggested command:** `$impeccable shape`

### P1-03 — Immediate post-assignment UI can contradict itself

- **Locations:**
  - `src/components/reservations/ai-recommendation-panel.jsx:49-52, 125-168, 390-393, 465-485`
  - `src/app/(dashboard)/reservations/queue/page.js:221-228`
- **Category:** Implementation integrity
- **Evidence:** Mutation success makes the panel closed through local `committed`, but the terminal bubble prefers the stale `selectedRequest.fleet_status`. It can therefore say “Assignment Completed” while its status pill still says Pending or Scheduled.
- **Impact:** The interface becomes least trustworthy at the exact moment the dispatcher needs certainty that resources were committed.
- **Recommendation:** Build one optimistic committed record from the assignment response and give it precedence until the queue query refreshes. Add a regression for the first post-success render.
- **Suggested command:** `$impeccable harden`

### P1-04 — Assigned and In Progress are treated as conversation-terminal

- **Locations:**
  - `src/components/reservations/ai-recommendation-panel.jsx:390-411, 862-889`
  - `src/components/reservations/copilot-conversation.jsx:591-655`
- **Category:** UX / Implementation integrity
- **Evidence:** Assigned and In Progress enter `isClosed`, disable the recommendation query and conversation, remove suggestions/composer, and show only static trip detail.
- **Impact:** The Copilot is unavailable during active operations—the moment dispatchers need “what changed?”, alert explanation, replacement review, or current evidence most.
- **Recommendation:** Separate `assignmentClosed` from `conversationClosed`. Disable mutation controls after assignment, but keep read-only Q&A, alerts, evidence, and explicitly allowed replacement analysis for Assigned/In Progress. Fully close only Completed/Cancelled.
- **Suggested command:** `$impeccable shape`

### P1-05 — Drawer focus lifecycle is incomplete in both responsive layers

- **Locations:**
  - `src/components/reservations/dispatch-plan-panel.jsx:64-71`
  - `src/app/(dashboard)/reservations/queue/page.js:298-309, 591`
  - `src/components/reservations/evidence-drawer.jsx:107-127`
  - `src/components/reservations/copilot-conversation.jsx:656-680`
- **Category:** Accessibility
- **Evidence:** The mobile drawer is a controlled Radix Dialog mounted only after opening, but its opener is external and there is no trigger ref or `onCloseAutoFocus` contract; reliable return focus is therefore absent. The evidence surface visually covers the workstation but uses `role="dialog" aria-modal="false"` with no initial focus, Escape behavior, focus containment, inert background, or opener restoration.
- **Impact:** Keyboard users can lose their position after closing the mobile drawer, remain behind the visible evidence overlay, or tab into visually hidden conversation controls.
- **Standard:** WCAG 2.1.1 Keyboard, 2.4.3 Focus Order, 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured, 4.1.2 Name/Role/Value; ARIA dialog pattern.
- **Recommendation:** Keep opener refs, focus the title/Close control on open, support Escape, and restore the exact opener. Use Radix Dialog/Sheet behavior for the evidence view if it occludes the panel; if intentionally modeless, stop covering the entire panel and explicitly manage heading focus and tab order.
- **Suggested command:** `$impeccable harden`

### P1-06 — Option cards nest interactive controls inside a synthetic button

- **Location:** `src/components/reservations/copilot-option-flow.jsx:112-126, 158-188`
- **Category:** Accessibility
- **Evidence:** A focusable `<section role="button">` contains an interactive `<details>/<summary>` and a real `<Button>`. The disclosure stops click propagation but not keydown, so Enter/Space on its summary can bubble to the parent, prevent disclosure behavior, and select the option. The parent accessible label exposes only “Option N — Recommended/Alternate option,” omitting the visible plate and driver identity.
- **Impact:** Keyboard users can accidentally select/re-analyze a pair while trying to inspect details; screen-reader users cannot identify the pair from the actionable name, and two controls claim the same selection action.
- **Standard:** WCAG 2.1.1 Keyboard, 2.4.6 Headings and Labels, 4.1.2 Name, Role, Value.
- **Recommendation:** Use a non-interactive article containing one real radio/select button with plate + driver + state in its accessible name and a sibling details disclosure. Express selection with `aria-checked` in a radiogroup or a native pressed/selected contract.
- **Suggested command:** `$impeccable harden`

### P1-07 — Semantic text colors fail normal-text contrast

- **Locations:**
  - `src/components/reservations/copilot-conversation.jsx:472, 607`
  - `src/components/reservations/copilot-option-flow.jsx:186`
  - `src/components/reservations/ai-recommendation-panel.jsx:777, 860`
  - `src/app/globals.css:98-107, 122-125, 145-171`
- **Category:** Accessibility / Theming
- **Evidence:** The user bubble uses `text-info` (`#3b82f6`) on `info-bg`: **3.38:1** in light mode and **3.13:1** in dark mode. Light-mode `text-warning` on white is **2.15:1** and `text-danger` on white is **3.76:1**; both are used as normal-sized text instead of their AA `*-700` variants. Warning icons in the option flow also miss the 3:1 non-text contrast floor.
- **Impact:** Chat text, warnings, and error messages are difficult to read and fail WCAG AA for normal text.
- **Standard:** WCAG 1.4.3 Contrast (Minimum), 4.5:1 for normal text.
- **Recommendation:** Use `info-700`, `warning-700`, and `danger-700` for semantic text; reserve base hues for fills/icons that meet their own contrast requirements. Add automated contrast assertions for light and dark tokens.
- **Suggested command:** `$impeccable colorize`

### P1-08 — Corrective links target routes that do not exist

- **Location:** `src/components/reservations/copilot-conversation.jsx:61-70`
- **Category:** Implementation integrity / UX
- **Evidence:** Vehicle recovery links target `/vehicles` or `/vehicles/:id`; schedule recovery targets `/schedules`. No corresponding dashboard routes exist. Current vehicle detail is under `/fleet/vehicles/:id`.
- **Impact:** A dispatcher who follows Copilot’s recommended corrective action lands on a 404 instead of resolving the blocking record.
- **Recommendation:** Centralize entity-route generation and add route-existence tests. Map vehicle records to `/fleet/vehicles/:id`; map schedule actions to the actual authorized scheduling surface or omit the link if none exists.
- **Suggested command:** `$impeccable harden`

### P1-09 — Queue UI fabricates luggage count from passenger count

- **Location:** `src/components/reservations/reservation-queue-table.jsx:288, 407`
- **Category:** Implementation integrity
- **Evidence:** `const bags = r.luggage_count != null ? r.luggage_count : pax;` presents passenger count as luggage count when luggage data is absent.
- **Impact:** Dispatchers can believe a request has a known bag count and make capacity judgments from invented operational data.
- **Recommendation:** Show luggage only when recorded; otherwise display “Bags not recorded” or omit the metric. Never substitute a different field for visual completeness.
- **Suggested command:** `$impeccable clarify`

### P1-10 — The responsive composition has predictable reflow and overflow failures

- **Locations:**
  - `src/app/(dashboard)/reservations/queue/page.js:98-105, 297-330, 444-447`
  - `src/components/layout/dashboard-layout.jsx:175-182`
  - `src/components/reservations/dispatch-plan-panel.jsx:33-35`
  - `src/components/reservations/reservation-queue-table.jsx:423-503`
- **Category:** Responsive design / Accessibility
- **Evidence:** Side-by-side mode starts at the 1280px viewport breakpoint. With the 240px expanded sidebar and 48px page padding, usable content is roughly 992px; after the 460px Copilot and gap, the queue receives roughly 508px. Its horizontal row still reserves a 220px left segment, 130px date segment, gaps, route content, and a nonshrinking status/tag segment. The mobile hero places three wide buttons in one inner flex item, so the outer wrapping container cannot wrap them independently.
- **Impact:** Dense queue content, route/status labels, and page actions can clip or overflow at 1280–1366px, narrow mobile widths, and browser zoom.
- **Standard:** WCAG 1.4.10 Reflow.
- **Recommendation:** Use container queries or measured content width, define the queue’s minimum viable width, delay horizontal row layout until that width exists, and let hero actions wrap/stack as independent children.
- **Suggested command:** `$impeccable adapt`

---

## P2 — Important next-pass findings

### P2-01 — Critical queue content is forced to one-line truncation

- **Location:** `src/components/reservations/reservation-queue-table.jsx:317-370, 451-493`
- **Category:** Responsive design / UX
- **Evidence:** Category, guest, date, route, and trip metrics use single-line truncation in grid and list variants. Pointer-only `title` text is not a reliable touch or assistive-technology recovery path.
- **Impact:** Dispatchers cannot distinguish long guest names and similar routes in the narrow queue column, even though these are operational identifiers.
- **Recommendation:** Allow two-line wrapping for guest/route identity, preserve the complete accessible name, and reserve truncation for secondary metadata only.
- **Suggested command:** `$impeccable adapt`

### P2-02 — Touch and pointer targets are undersized

- **Locations:**
  - `src/app/(dashboard)/reservations/queue/page.js:371, 524-568`
  - `src/components/reservations/dispatch-plan-panel.jsx:81-88`
  - `src/components/reservations/ai-recommendation-panel.jsx:724-726, 834-847`
  - `src/components/reservations/copilot-conversation.jsx:401-411, 599-652`
  - `src/components/reservations/copilot-option-flow.jsx:158-161`
  - `src/components/reservations/evidence-drawer.jsx:120-155, 260-266`
  - `src/components/ui/button.jsx:22-27`
- **Category:** Accessibility / Responsive design
- **Evidence:** Multiple tabs, pagination, drawer, recheck, send, memory, disclosure, and evidence controls are 20–36px high. The panel also uses `Button size="xs"`, but the shared Button defines no `xs` size, so those controls receive no size-specific height/padding.
- **Impact:** High-pressure tablet/mobile use becomes error-prone, especially for users with limited dexterity.
- **Standard:** WCAG 2.5.8 minimum 24×24 CSS px; UI/UX Pro Max premium target 44×44px.
- **Recommendation:** Use at least 36–40px for compact secondary controls and 44px for primary drawer/composer actions, with 8px separation.
- **Suggested command:** `$impeccable adapt`

### P2-03 — Copilot bypasses the global status system

- **Location:** `src/components/reservations/reservation-queue-table.jsx:136-219`
- **Category:** Theming / Implementation integrity
- **Evidence:** A private status map uses raw Tailwind colors. Ready, Assigned, Completed, fallback Unassigned, and selection all lean on emerald.
- **Impact:** Selection, readiness, lifecycle completion, and unassigned work blur into one green visual field.
- **Recommendation:** Extend the shared `StatusBadge` grammar with decision states. Use primary for selection, neutral/amber for unassigned work, warning for incomplete evidence, and success only for genuinely healthy/ready/completed states.
- **Suggested command:** `$impeccable colorize`

### P2-04 — Mascot motion is repeated, non-essential, and not reduced-motion safe

- **Locations:**
  - `src/components/reservations/copilot-option-flow.jsx:8-14`
  - `src/components/reservations/copilot-conversation.jsx:431-479, 542-558`
  - `src/components/reservations/ai-recommendation-panel.jsx:696-704, 803-813`
  - `src/components/reservations/dispatch-plan-panel.jsx:73-79`
- **Category:** Accessibility / Performance / Visual design
- **Evidence:** A 284,457-byte, 1024×1024, six-frame GIF loops every 3 seconds indefinitely and is rendered at 24–80px in multiple locations—potentially once per assistant message. CSS reduced-motion rules do not stop animated image content, and no pause/hide control or static source is provided. The idle “Ready” state also adds `animate-ping`.
- **Impact:** Repeated blinking/pulsing adds motion noise, decoding/repaint work, and a consumer-chatbot tone to an operational workstation.
- **Standard:** WCAG 2.2.2 Pause, Stop, Hide; reduced-motion best practice.
- **Recommendation:** Keep one static or gently animated identity mark in the header; make message avatars decorative and static; provide a static/reduced-motion source and animation toggle; reserve pulse for checking or a genuinely live alert.
- **Suggested command:** `$impeccable animate`

### P2-05 — Assistant identity is redundantly announced

- **Locations:** `src/components/reservations/copilot-option-flow.jsx:9-13`; `src/components/reservations/copilot-conversation.jsx:454-479`
- **Category:** Accessibility
- **Evidence:** Repeated assistant avatars have `alt="Copilot"` while message content also includes a screen-reader-only “Copilot:” prefix.
- **Impact:** Screen-reader users hear duplicate speaker identity on every assistant message.
- **Recommendation:** Use `alt="" aria-hidden="true"` for repeated decorative avatars and keep the textual speaker label.
- **Suggested command:** `$impeccable harden`

### P2-06 — Evidence comparison omits immutable pair identity

- **Location:** `src/components/reservations/evidence-drawer.jsx:165-190`
- **Category:** UX / Implementation integrity
- **Impact:** “Option 1” and “Option 2” require memory from the covered screen and become ambiguous after selection/reanalysis changes.
- **Recommendation:** Show plate + driver name/code and checked timestamp at the top of each column. Treat option number as secondary historical context.
- **Suggested command:** `$impeccable clarify`

### P2-07 — “Clear memory” has a hidden decision-state side effect

- **Location:** `src/components/reservations/copilot-conversation.jsx:192-195, 401-411`
- **Category:** UX / Implementation integrity
- **Evidence:** The action is titled as conversation clearing but also deletes the persisted selected pair; current local selection remains visible until remount.
- **Impact:** The user sees the choice now, returns later, and finds it silently lost.
- **Recommendation:** Split “Clear conversation” from “Reset decision,” or make one explicit reset action that immediately clears both local and persisted state with consequence copy.
- **Suggested command:** `$impeccable clarify`

### P2-08 — Error treatment is fragmented

- **Locations:** `src/components/reservations/ai-recommendation-panel.jsx:860, 878-881`; `src/components/reservations/evidence-drawer.jsx:140-145`
- **Category:** UX / Theming
- **Evidence:** Queue-plan failure is a bare red paragraph, recommendation and assignment errors are bubbles, and evidence failure is plain text without retry.
- **Impact:** Recovery feels assembled from separate systems and makes error scope harder to understand.
- **Recommendation:** Create one compact `CopilotStateMessage` pattern with scope, state icon, exact consequence, and next action. Give the evidence drawer Retry and Close paths.
- **Suggested command:** `$impeccable shape`

### P2-09 — Queue tabs claim the ARIA tabs pattern without implementing it

- **Location:** `src/app/(dashboard)/reservations/queue/page.js:336-382`
- **Category:** Accessibility
- **Evidence:** The controls use `tablist`/`tab` and `aria-selected`, but have no `tabpanel`, `aria-controls`/`aria-labelledby`, roving `tabIndex`, or Arrow/Home/End keyboard behavior.
- **Impact:** Screen readers announce a tabs widget while keyboard users receive six ordinary Tab stops and none of the expected tab behavior.
- **Standard:** WCAG 4.1.2 Name, Role, Value; WAI-ARIA Tabs APG.
- **Recommendation:** Implement the complete tabs pattern or remove the tab roles and present a labelled filter-button group.
- **Suggested command:** `$impeccable harden`

### P2-10 — Queue loading and failure changes are not announced

- **Locations:** `src/app/(dashboard)/reservations/queue/page.js:448-463`; `src/components/reservations/reservation-queue-table.jsx:529-590`
- **Category:** Accessibility
- **Evidence:** The error panel lacks `role="alert"`/status semantics, and loading uses only a visual animated skeleton with no `aria-busy` or hidden status text.
- **Impact:** Screen-reader users can wait on an apparently blank region or miss a polling failure.
- **Standard:** WCAG 4.1.3 Status Messages.
- **Recommendation:** Add `aria-busy` and a visually hidden loading status to the queue region, use `role="alert"` for failures, and gate skeleton pulse with reduced motion.
- **Suggested command:** `$impeccable harden`

### P2-11 — Busy mobile Close control silently does nothing

- **Locations:** `src/components/reservations/dispatch-plan-panel.jsx:81-88`; `src/app/(dashboard)/reservations/queue/page.js:591`
- **Category:** UX / Accessibility
- **Evidence:** Close remains enabled, but the parent callback refuses to close while `lockedRequest` exists.
- **Impact:** An apparently actionable control becomes a silent no-op during recheck or assignment.
- **Recommendation:** Either allow close while preserving operation state, or visibly disable the control and explain that the current verification/assignment must finish.
- **Suggested command:** `$impeccable clarify`

### P2-12 — The queue collection has no list/table relationship semantics

- **Location:** `src/components/reservations/reservation-queue-table.jsx:278-308, 397-427`
- **Category:** Accessibility
- **Evidence:** Both collections are plain `<div>` containers and each row is only a button-role div; there is no list/table structure conveying count or position.
- **Impact:** Screen-reader users do not receive item count or position across a page of up to 25 requests.
- **Standard:** WCAG 1.3.1 Info and Relationships.
- **Recommendation:** Use a named `ul/li` collection or a true table/grid pattern while retaining the per-item selection control.
- **Suggested command:** `$impeccable harden`

### P2-13 — Conversation has no “new messages below” recovery when scroll-follow pauses

- **Location:** `src/components/reservations/copilot-conversation.jsx:333-338, 415-427`
- **Category:** UX / Accessibility
- **Evidence:** Auto-follow intentionally stops when the user scrolls away from the bottom, but no jump-to-latest control or unread indicator appears when a new assistant reply arrives below the viewport.
- **Impact:** A user reviewing old evidence can miss the completed answer or believe the Copilot is still waiting.
- **Recommendation:** Add a keyboard-reachable “New response — jump to latest” affordance that appears only while follow mode is paused.
- **Suggested command:** `$impeccable clarify`

---

## P3 — Polish findings

### P3-01 — Internal database IDs leak into option cards

- **Location:** `src/components/reservations/copilot-option-flow.jsx:177-180`
- **Category:** Visual design / Content design
- **Impact:** `ID {driver_id}` reads as implementation residue unless operators use it as a real staff identifier.
- **Recommendation:** Show an operational employee/driver code or move numeric database IDs into evidence details.
- **Suggested command:** `$impeccable distill`

### P3-02 — The visual language is product-specific but not consistently premium

- **Locations:** Across `dispatch-plan-panel.jsx`, `copilot-option-flow.jsx`, `copilot-conversation.jsx`, and `ai-recommendation-panel.jsx`.
- **Category:** Visual design judgment
- **Evidence:** The workstation relies heavily on familiar SaaS cards, repeated rounded chat bubbles, green pills, thin gray borders, and a glossy 3D bot. The logic is bespoke, but the surface treatment often resembles a generic AI assistant.
- **Impact:** The design feels credible and friendly, but less authoritative and editorially controlled than a high-end fleet-operations product.
- **Recommendation:** Preserve the queue/workstation architecture while reducing repeated bubble chrome, using stronger typographic grouping for evidence, consolidating status color, quieting the mascot, and making the persistent decision dock the visual anchor.
- **Suggested command:** `$impeccable quieter`

---

## Patterns and systemic issues

1. **Truth is not derived from one owner.** Decision state is reinterpreted separately in the queue, option flow, panel, and evidence inspector.
2. **Selection, readiness, and success share emerald.** Color carries too many meanings, weakening glanceability.
3. **High-stakes action is treated as message content.** The transcript owns a live confirmation control that should belong to the workstation shell.
4. **Overlay behavior is visual rather than semantic.** The evidence drawer looks modal but behaves modelessly.
5. **Compact styling is over-applied.** 11px captions and 28–32px controls recur in an operational surface that needs rapid scanning and reliable touch.
6. **Decorative motion is not state-bound.** Blinking and pulsing appear in idle and repeated-message contexts rather than only during live activity.
7. **Recovery navigation is hand-authored.** Entity routes can drift from the actual application route map.

## Positive findings to preserve

- **Excellent core information architecture:** one selectable queue beside one persistent decision-support surface.
- **Honest queue copy:** “Today & overdue” accurately names the server predicate; loading counts do not pretend to be zero.
- **Identity-pinned assignment:** pair IDs survive refresh/reordering and confirmation names the chosen vehicle + driver.
- **Safety-aware confirmation:** selection is rechecked, availability/conflicts are revalidated, and pending copy explains what is happening.
- **Mature conversation mechanics:** per-reservation memory, send-before-response, failed-question restoration, IME-safe Enter handling, bounded history, and user-respecting scroll-follow behavior.
- **Strong evidence provenance:** source, manager, timestamp, and staleness language reinforce deterministic decision support.
- **Rich terminal context:** route, schedule, guest, resource, cancellation, and continuity links are co-located.
- **Good code hygiene signal:** scoped ESLint passed, and the deterministic Impeccable detector found no generic slop-rule violations.

## Recommended action sequence

1. **[P1] `$impeccable clarify`** — unify the operational state vocabulary, remove false eligibility/no-match copy, and stop fabricating luggage data.
2. **[P1] `$impeccable shape`** — introduce a persistent decision dock and separate active-trip conversation from assignment mutation state.
3. **[P1] `$impeccable harden`** — repair evidence-drawer focus behavior, nested option controls, post-success status, and broken recovery routes.
4. **[P1] `$impeccable colorize`** — correct contrast failures and consolidate status semantics into shared tokens/components.
5. **[P2] `$impeccable adapt`** — switch by usable workspace width and enlarge compact controls; verify desktop/mobile/zoom acceptance.
6. **[P2] `$impeccable animate`** — replace repeated infinite mascot motion with static/reduced-motion-safe identity treatments.
7. **[P2] `$impeccable quieter`** — reduce bubble/pill/border repetition and elevate evidence hierarchy.
8. **[P3] `$impeccable distill`** — remove internal IDs and secondary implementation detail from the primary layer.
9. **[Final] `$impeccable polish`** — run one bounded desktop/mobile finish pass after structural and accessibility fixes.

You can ask me to run these one at a time, all at once, or in any order you prefer.

Re-run `$impeccable audit` after fixes to see the score improve.

## Approved implementation plan and progress — 2026-10-02

The user approved the 10-task, test-first remediation plan on 2026-10-02. Work remains isolated in branch `fix/dispatch-copilot-ui-audit`; no merge is authorized. Task 1 is committed as `2ccaf752`; Task 2's base, inspector-fix, and scoped follow-up commits are `b7a570d5`, `df4e8c4b`, and `8d4f19e8`. Task 2 review found no Critical/Important regressions; one Minor duplicate-control finding spanning two edge states is deferred. Task 2 Round 4 buckets incomplete proposals as `Not evaluated`, makes Recheck refetch and rederive by saved key before queue checking, permits fresh recovery only when evidence remains current, and retains saved-selection clearing on plan errors. Focused Task 2 verification is 74/74 with touched-file ESLint and `git diff --check` passing. Task 3 is committed as `21ba8efd`: the first post-assignment render prefers the server's committed status/pair over stale queue copies, active trips have permission-gated read-only conversation, and terminal trips remain composer-closed. The generic recommendation route now has a narrow server-derived, no-ranking/proof/LLM lifecycle response for committed requests; Pending behavior is preserved. Task 3 verification is 182/182 across 10 focused suites, touched-file ESLint and `git diff --check` passed, and independent review found no Critical/Important issues. Two Task 3 Minor observations (render-level terminal-composer assertion and expected 409/403 test stderr) are deferred to final whole-branch triage. Tasks 4–10, production build, and authenticated browser acceptance remain pending.
