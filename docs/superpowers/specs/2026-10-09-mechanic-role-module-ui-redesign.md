# Mechanic Role Module UI Redesign

**Date:** 2026-10-09

**Status:** Direction approved; spec awaiting review
**Affects:** Mechanic workspace routes and their shared presentation. Existing mechanic permissions and record assignment scope remain in force.

## Goal

Help mechanics find the right assigned repair, understand its state, record work, and hand it to inspection with less scanning and fewer mistakes. The layout must work on desktop, tablet, and phone, including touch-based editing during repairs.

## Current findings

The current My Line screen repeats the in-progress job in both the main job card and the queue. Its **Start next job** action opens the in-progress order without starting anything. The inspection count can show two while its panel says nothing is waiting. The detail page loads the full maintenance collection and searches for one order in the browser, saved evidence is not prefilled in the form, and the current order can appear in its own previous-maintenance history. Mutation controls are disabled below 1024px.

The existing mechanic QA review also reports that saving parts evidence currently fails at the API boundary. The redesign must show the real save outcome and keep entered data when saving fails; the repair-evidence save path must be made reliable before the mechanic flow is considered complete.

## Approved direction

Use the queue-first composition shown in the approved preview, with the selected work order kept in a right-side snapshot on wide screens. The queue remains the main working area; the snapshot makes the selected vehicle and next action clear without repeating the selected row as another queue item.

Add one compact vehicle photo near the top of the selected-order snapshot, beside the vehicle identity, following the placement shown in the revised preview. This image is secondary to the queue and work-order state. The preview’s car is illustrative, not a claim that it is the actual assigned vehicle.

The mechanic shell keeps the existing navigation labels: **My Line**, **My Work Orders**, **Problem Queue**, **History**, and **Profile**. Keep the established FleetOps design system: Inter, neutral surfaces and text, semantic status colors, existing spacing and radii, and flat cards. The premium finish comes from clean hierarchy, restrained density, consistent alignment, and well-spaced controls, not new decoration or a new palette.

### Responsive behavior

- **Wide desktop:** Keep the assigned-work queue as the large center area and the selected work-order snapshot beside it.
- **Tablet:** Keep the queue readable and allow a selected-order panel or sheet without horizontal page scrolling. All work-order edits remain available.
- **Phone:** Show one work order at a time. Selecting a row opens its detail route with a clear back action. Keep inputs, evidence controls, and primary actions touch-friendly; never hide an action solely because the viewport is below 1024px.

The selected-order snapshot is a preview. **Continue work order** opens the full detail route; it does not silently change status or replace the form.

## Data and role rules

1. Keep all existing server-side mechanic assignment checks. The mechanic sees and updates only work orders assigned to them.
2. Preserve the mechanic’s existing status transitions and read-only boundaries. Do not add create, archive, completion, or approval controls to the mechanic role. Problem Queue and History remain read-only.
3. Return only the existing lean vehicle fields plus `image_url` for the vehicle joined to that already-scoped work order. Do not return a full vehicle row, documents, cost, or unrelated vehicle records. The image field is optional; when it is missing, show a neutral vehicle silhouette with a clear “Photo unavailable” label. Do not reuse one vehicle’s photo for another.
4. Load a single work order through the existing assignee-scoped detail endpoint instead of downloading the whole maintenance collection to find one row.
5. Seed diagnosis, parts, labor, and handover fields from the saved work-order values. Keep those values in place if a save fails.
6. Ensure parts evidence is sent and stored in the JSON shape the API expects. Show a truthful saved state only after the server confirms success; on failure, show an actionable message and keep the mechanic’s edits intact.
7. Derive status counts and the visible queue from the same assigned-order scope. A nonzero Pending Inspection count must have corresponding orders in the inspection filter; do not show an empty state against a nonzero count.
8. Exclude the open work order from its own previous-maintenance list.

## Interaction details

- Replace the false **Start next job** label with an honest navigation label such as **Open work order** or **Continue work order**, based on the order’s current state.
- Use distinct, state-appropriate labels only for actual status changes, and preserve the mechanic’s existing transition rules.
- Keep status text visible; color is an additional signal, not the only one.
- Use visible labels for every editable field, clear keyboard focus, and touch targets of at least 44px. Do not rely on hover to reveal actions.
- On the full detail route, show saved-evidence completeness and a clear save result. Do not clear or reset the form when a request fails.
- Keep filters scoped to the mechanic’s assigned work and provide an obvious way back from a work order to the queue.

## Scope

Redesign the mechanic My Line, My Work Orders, work-order detail, Problem Queue, and History surfaces to use one consistent task-first hierarchy. Improve responsive layouts and the repair-evidence form states. Add the limited vehicle-photo field to the existing mechanic-scoped response and correct the parts-save payload only as needed to make the documented workflow reliable.

No database migration is expected: `vehicles.image_url` already exists. Do not change RBAC, assignment rules, business status transitions, non-mechanic routes, or the existing vehicle-image upload flow.

## Acceptance checks

- The current work order appears once in the queue and is not listed as its own history.
- Counts match the assigned rows visible under their filters, including Pending Inspection.
- Queue actions describe navigation truthfully; status actions reflect the existing mechanic state machine.
- The selected-order snapshot shows a real stored photo for that assigned vehicle when present, otherwise the labeled neutral fallback.
- Mechanics can review and edit assigned work orders on phones and tablets without horizontal scrolling or missing controls.
- Saved values prefill the detail form. A successful save is visibly confirmed; a failed save preserves input and explains what happened.
- Mechanic API responses stay assignee-scoped and expose no additional vehicle fields beyond the selected `image_url` exception.
- Status meaning, keyboard access, visible form labels, and focus states remain clear without relying on color or hover.

## Reference

Approved comp: `.impeccable/mocks/decision/mechanic-shift-queue.png`
The comp’s photo is illustrative. The implementation uses the selected vehicle’s stored photo when one exists.
