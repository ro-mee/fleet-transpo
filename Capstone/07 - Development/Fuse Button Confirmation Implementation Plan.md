---
type: implementation-plan
status: implemented
tags: [web, ui, confirmation, archive, delete, cancellation]
created: 2026-10-09
source:
  - src/components/ui/confirm-dialog.jsx
  - src/components/ui/button.jsx
  - src/components/ui/dialog.jsx
  - docs/design-system.md
related: ["[[UI UX Audit - Web]]", "[[Driver Management]]", "[[Dispatch]]", "[[Maintenance]]"]
---

# Fuse Button Confirmation Implementation Plan

The requested React Bits FuseButton interaction is implemented as a FleetOps-styled, dependency-free web control. It is enabled only on the scoped archive/delete/release/removal and saved operational cancellation confirmations below. No API, permission, database, or package change was needed. Build and broad browser acceptance remain open.

## Intended outcome

Give staff a brief opportunity to reconsider an archive, deletion, or operational cancellation after confirming it. Start with the pictured driver-management archive dialog, then cover all equivalent web entry points through a shared interaction. Preserve the existing FleetOps dialog, typography, semantic colors, permission gates, required reasons, and actual business consequences.

Scope assumption: the web dashboard, including responsive driver website views. The supplied component uses DOM, SVG, and Web Animations APIs and cannot be copied into the Expo app. Native coverage would need a separate adaptation using its own design system and policy.

## Recommended interaction

Use deferred execution: `commitOn="fuseEnd"`, with a proposed five-second reconsideration window. The first confirmation arms the action; it does not call the API. During that window the same button becomes **Undo**, with a restrained shrinking outline and readable remaining time. Undo means cancelling a pending local action, not restoring a server mutation.

For the pictured modal:

1. Open the existing **Archive Driver Profile?** dialog. Show the selected driver's name or ID and retain the active-selection consequence.
2. Press **Archive driver**. Keep the dialog open, change the action to **Undo**, and show **Archiving in 5 seconds. Undo to keep this driver.**
3. Press Undo or Escape before expiry to return to the unarmed confirmation, preserving any reason. Choosing the existing secondary **Cancel**, closing the dialog, or leaving the route cancels the pending action entirely.
4. At expiry, make exactly one existing archive request. Show **Archiving...** and prevent another submission or dismissal while the result is awaited.
5. Refresh the relevant data only after success. On failure, keep the target and reason available with an accessible inline error; do not automatically retry. Dismiss and reopen the confirmation only after checking whether an uncertain request took effect.

For deletes and cancellations, use equivalent operation-specific wording. Do not display **Archived**, **Deleted**, or **Cancelled** until the server confirms success. Do not call a second delete/purge callback after the timer. Do not add a post-commit Undo promise where no complete restore operation exists.

Ordinary **Cancel**, **Close**, **Keep it**, and navigation buttons remain immediate because they dismiss or abandon a decision. If a form cancel discards meaningful unsaved work, route that case through an explicit discard confirmation before applying the same reconsideration pattern. A saved operational cancellation and a harmless modal dismissal must not share behavior just because both say Cancel.

## Current source findings

- The pictured modal is `src/app/(dashboard)/drivers/page.js:465`; the detail page has another archive confirmation at `drivers/[id]/page.js:926`.
- `ConfirmDialog` already centralizes archive/danger/warning styles, required reasons, legacy prop aliases, and the promise-based `useConfirm` helper.
- Its `handleConfirm` invokes `onConfirm` and then closes immediately based on the current render's `busy` value. A mutation starting on that click cannot reliably keep the dialog open. Deferred confirmation needs an explicit asynchronous lifecycle.
- Several callers invoke TanStack Query `mutate`, which returns no completion promise; some do not supply `loading`. Callers participating in the new lifecycle need completion-aware adapters, usually `mutateAsync`.
- The driver DELETE route archives through `deleted_at` and a required transaction-bound audit entry. It does not expose a matching restore action in this flow.
- Dispatch detail uses its own dialog; driver leave withdrawal uses native `confirm()`. Updating only shared ConfirmDialog would miss both.
- Maintenance cancellation can be saved through a status selector rather than a dedicated Cancel button. It is terminal and must receive the same protection when an existing record is transitioned to Cancelled.
- ConfirmDialog currently renders plain heading/paragraph elements despite importing the Radix title/description primitives. Use those primitives and link the description in the affected dialog so the new status does not replace its accessible name or consequence description.

## UI adaptation

- Keep the existing white/dark semantic surface, compact dialog footer, Inter typography, border, and dialog proportions.
- Use the actual shared Button height/radius at each confirmation surface. The pictured footer uses a 36px control; allow a 44px target on touch layouts. Avoid the sample's full-pill radius and charcoal theme defaults.
- Archive uses the existing warning family; irreversible deletion and operational cancellation use danger. Retain operation icons and use existing Lucide `Archive`, `Trash2`, `Undo2`, `Check`, and `Loader2` rather than adding Hugeicons dependencies.
- Use theme tokens, not hard-coded sample colors. Verify label and outline contrast in both themes; choose an AA-safe warning treatment if the existing amber/white pair fails. Keep any contrast adjustment scoped to the new action control.
- Use a thin outline without neon glow or blur-heavy crossfades. State transitions should be brief, approximately 150-200ms, with stable width across the action, Undo, and progress labels.
- Preserve visible keyboard focus and understandable text. At narrow widths, allow the footer/helper text to stack without clipping the record name or changing button order.
- Respect reduced motion: remove movement and decorative transitions while keeping a readable time/state indicator and the full reconsideration window.

## Shared implementation design

### 1. Adapt FuseButton into a FleetOps primitive

Proposed files: `src/components/ui/fuse-button.jsx` and `src/components/ui/fuse-button.module.css`.

Confirm the supplied component's upstream license and preserve any required attribution before copying/adapting it. Keep the client boundary explicit and follow the installed Next.js documentation for CSS Modules and client components.

Use a small explicit lifecycle: **idle -> armed -> executing -> success/error**. Add an immediate mutable guard so rapid clicks, Enter repeats, Undo at the deadline, and animation completion cannot execute twice. Treat promise settlement as the source of success; animation completion only permits the request to start.

Track remaining time independently of the SVG animation, using a monotonic clock and cancellable scheduling. Web Animations is visual feedback, not the sole execution clock. If animation APIs are unavailable, the same delay and Undo still work. Handle Strict Mode setup/cleanup without duplicating the action.

Pause while the document is hidden; resume only the remaining duration. Keep Undo and Escape as the only visible reconsideration controls; do not add a Pause/Play icon or pointer-hover pause. Keep the action button's semantic fill and text color unchanged as its label moves through confirm, Undo, and progress states. Describe how much time remains without announcing every animation frame. Escape cancels the armed action before it reaches the dialog's close handler. Abort local pending work on unmount, target changes, permission loss, or session expiry.

### 2. Add an explicit opt-in to ConfirmDialog

Proposed dialog contract: a named delayed-confirmation option and configurable delay, plus operation-specific pending/busy labels. Do not turn every `warning` or `danger` confirmation into a delayed action: those variants also serve approvals, password resets, invitations, and configuration changes.

Retain `description`, `confirmText`, `isLoading`, reason trimming/max length, and existing unarmed flows. While armed, freeze the selected target and validated reason; Undo restores the same reason. While executing, prevent Escape/backdrop/secondary-button dismissal and leave the progress state visible. Keep existing permission and server validation checks authoritative after the delay.

Avoid duplicated close/toast ownership. For direct mutation callers, resolve success/error from a returned promise and use the existing mutation hooks for cache invalidation and established feedback. Choose one owner for each close and error message. For `useConfirm`, preserve its boolean / `{ confirmed: true, reason }` results, resolve once only after the delay, resolve false on dismissal, and never call its eager-close path after resolving true. Waiting on the helper is not evidence that the caller's eventual API mutation succeeded.

Unknown network outcomes need reconciliation, not a success label or automatic re-submit. A lost response may follow a committed action; refresh/check current state before offering a retry. Cancellation of a local timer or an aborted fetch does not undo a server request already sent.

### 3. Cover all archive/delete/cancel entry points

| Action group | Known implementation targets | Integration requirement |
|---|---|---|
| Driver archive | `drivers/page.js`, `drivers/[id]/page.js` | First pilot; capture driver identity; completion-aware archive mutation. |
| Vehicle archive | `components/tables/fleet-table.jsx`, `fleet/vehicles/[id]/page.js` | Protect list/detail paths consistently. |
| Category archive | `fleet/categories/page.js` | Preserve category dependency validation and current error handling. |
| Maintenance archive | `maintenance/page.js` | Preserve staff authorization, terminal-record rules, and existing invalidation. |
| Notification deletion | `notifications/page.js`, callbacks from `components/notifications/notification-card.jsx` | Trace both card variants and any other consumer to a protected mutation; do not add a second countdown to the trigger. |
| AI provider deletion | `settings/ai/page.js` | Keep provider consequences and deletion validation. |
| Substitute schedule removal | `fleet/assignments/page.js`, `components/drivers/substitute-driver-card.jsx` | Protect both entry points and keep the stated recommendation/coverage consequence. |
| Transport request cancellation | `reservations/queue/page.js`, `reservations/[id]/page.js` | Require and snapshot the reason; preserve request/dispatch/trip cascade and Booking notice result. |
| Dispatch stand-down | `dispatch/[id]/page.js` | Adapt its custom reason dialog; preserve release-to-Scheduled behavior and open-trip cancellation. |
| Driver leave withdrawal | `driver/schedule/page.js` | Replace native `confirm()` with the shared dialog; keep self-scope and Pending-only server rule. |
| Maintenance operational cancellation | `maintenance/page.js`, `fleet/maintenance/components/MaintenanceFormDialog.js` and their active callers | Intercept Save when an existing record changes to Cancelled; snapshot the submitted fields, retain validation/errors, and avoid a second unprotected submit path. New records still follow the server's Scheduled-only creation rule. |

Paths in this table are relative to `src/app/(dashboard)` unless prefixed with `components/`, which means `src/components`.

Also apply the same pattern to the existing **Release assignment/custody** confirmations in `fleet/assignments/page.js` and `components/drivers/assigned-vehicle-card.jsx`: these close/archive saved pairings. Keep their guarantee that scheduled trips are unaffected.

Before implementation closeout, repeat the source inventory across buttons, menus, card callbacks, forms, native confirm calls, and mutation handlers. Classify each hit by its actual saved effect. Remove unsaved part rows or dispatch-threshold rows immediately unless they cause material draft loss; do not indiscriminately wrap every Trash icon or every DELETE-shaped helper. Account disabling, session revocation, reassignment, approvals/denials, reset links, invitations, and emergency response are separate operations and require an explicit scope decision before extending this pattern to them.

## Business and data boundaries

- Call the existing service functions and endpoints once after the window. Preserve server authorization, transaction-bound audit, required reasons, immutable records, and cache invalidation.
- Request cancellation cancels transport fulfillment and its related active chain. Dispatch stand-down cancels the dispatch/open trips and releases the request for reassignment. Their consequence copy stays distinct.
- No early optimistic removal, early success toast, outgoing Booking message, or operational audit write during the local reconsideration window. On Undo, no mutation occurred.
- No new restore API, automatic purge, status rollback, database migration, or new table is needed for the proposed deferred-execution design.
- Never queue armed actions across reload, logout, or navigation. Once a request is in flight, its actual server result governs subsequent feedback.

## Implementation order

1. Complete the action inventory and call-site completion contract; confirm source attribution and installed Next.js guidance.
2. Build the shared primitive and opt-in ConfirmDialog lifecycle with focused timing/async tests.
3. Pilot both driver archive paths using the pictured UI; verify the reconsideration and failure states before broader rollout.
4. Roll out to remaining archive/delete/removal/release actions; convert custom dispatch/leave flows and maintenance cancellation saves.
5. Run relevant regressions, lint, build, and browser acceptance. Update `docs/design-system.md`, affected feature notes, this plan's implementation evidence, and `SYSTEM.md` to reflect the shipped behavior.

## Acceptance and verification plan

- Fake-clock lifecycle tests prove zero requests before expiry, zero after Undo/close/unmount/target change, and exactly one after uninterrupted expiry. Cover pause/resume, background visibility, missing animation APIs, Strict Mode cleanup, rapid repeats, and the expiry/Undo boundary.
- Async tests cover a slow success, known failure with retained target/reason, uncertain network outcome, duplicate prevention while executing, and success-only close/labels. Cover `useConfirm` single-resolution and compatibility behavior separately.
- Call-site tests exercise actual handlers: driver list/detail, archive table/detail, delete callback, request cancellation with its reason, dispatch stand-down, driver withdrawal, and cancellation saved through a maintenance form. Prove that non-target confirmations still execute as before and that server permission/state refusals remain visible.
- Retain existing reservation/dispatch cascade and maintenance lifecycle regression suites. Test UI wiring without making destructive production-data submissions.
- Run changed-file ESLint, the relevant Vitest suites (`npm run test:run -- <targets>`), `npm run build`, and `git diff --check`. Expand testing only when a new failure or cross-cutting concern warrants it.
- Browser acceptance on controlled non-production records: light/dark desktop, narrow/touch layout, keyboard Enter/Space/Escape, safe initial focus, focus return, screen-reader title/description/status, reduced motion, contrast, long names, background-tab pause/resume, slow/error responses, stable action-button color across labels, and multiple available entry points. Source tests do not substitute for browser evidence.

## Implementation and verification, 2026-10-09

Implemented `src/components/ui/fuse-button.jsx` and its CSS module, with an explicit idle/armed/executing/settled/error lifecycle, monotonic five-second delay, Undo/Escape, hidden-tab pause/resume, reduced-motion behavior, touch target sizing, inline error reporting, and a stable action-button color as the label changes. The shared countdown controller has four fake-clock tests covering expiry, pause/resume, Undo cancellation, and the expiry/Undo boundary. `ConfirmDialog` opts in explicitly, preserves its normal behavior by default, locks required reasons while armed, and awaits `mutateAsync` completion. The custom dispatch stand-down dialog uses the same control. Callsites cover driver and vehicle list/detail archive, categories and maintenance archives, Notification Center and AI provider deletion, assignment release and substitute removal in both entry points, reservation cancellation in queue/detail, driver leave withdrawal, dispatch stand-down, and cancellation saved through both maintenance editors. Ordinary dialog Cancel stays immediate. Account/session revocation, user deactivation, approval/denial, reassignment, and emergency response remain outside this scope; unsaved form-row removal remains immediate.

Changed-file ESLint and the four focused countdown tests passed; `git diff --check` passed with only LF-to-CRLF working-copy notices. The local `/drivers` page rendered the target archive dialog and Undo state; Undo returned to the unarmed dialog without changing the record. That browser check preceded the final no-Pause and stable-color adjustment, which has not been browser-accepted. The local dev server remained in `Compiling...` while later Escape handling was changed, so final Escape behavior, other flows, themes, and responsive states remain browser-open. `npm run build` stopped before compilation because another Next process held the shared build lock. No production-data mutation was made, and no database or deployment action occurred.

Remaining acceptance gates: a successful production build after the shared Next build lock clears; controlled-record/browser checks for keyboard Escape, hidden-tab pause/resume, dark/light contrast, narrow/touch layout, stable button color during Undo/progress, async failure, and the remaining entry points. Source-level checks do not establish those browser or release gates.
