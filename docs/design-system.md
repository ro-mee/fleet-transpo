# FleetOps UI/UX Design System

## Purpose

This is the shared UI/UX playbook for FleetOps and related operational systems. It defines how an interface should feel, behave, and communicate—not just which CSS values to use.

**Website scope:** The patterns in this document describe the FleetOps web dashboard and its responsive website views. Mobile-app interaction patterns are intentionally documented elsewhere and must not be inferred from this file.

Use it when designing a new frontend, extending an existing module, or translating a workflow into screens. The goal is a family of products that feel familiar to users while allowing each system to serve its own work.

FleetOps is the reference product, not a constraint. A POS, PMS, booking, inventory, or driver application may have different tasks and layouts, but it should inherit the same foundations: calm operational clarity, predictable interaction, accessible feedback, and a consistent visual language.

## 1. Design for operational work

Our users work under time pressure. They need to find a state, decide what to do, and complete an action without decoding the interface.

Every frontend should optimize for these outcomes:

- **See what matters first.** Make the current state, urgent exceptions, and next action easy to find.
- **Support fast scanning.** Use consistent placement, concise labels, aligned data, and intentional hierarchy.
- **Prevent avoidable mistakes.** Confirm destructive actions, expose constraints early, and make recovery clear.
- **Keep context visible.** A person should know where they are, what record they are viewing, and what will happen next.
- **Respect real-world workflows.** Design around the user's task and sequence, never around a database schema or a generic dashboard template.

### Design questions before building

Before a screen is designed or implemented, answer:

1. Who uses this screen, and what decision are they making?
2. What information must be noticed within the first few seconds?
3. What is the primary action? Is there truly more than one?
4. What can go wrong, and how will the interface prevent or recover from it?
5. Which states must work on smaller screens, touch devices, slow networks, or with reduced motion?

If those answers are unclear, start with the workflow before selecting components.

## 2. Shared foundations and local flexibility

Every product adopts the same foundations. A product may create its own domain patterns, but it must not fork the foundations.

| Shared across products | May vary by product |
|---|---|
| Color roles and semantic states | Information architecture and navigation labels |
| Typography roles and data formatting | Domain-specific workflows and record models |
| Spacing, shape, elevation, and focus treatment | Module patterns such as a dispatch board or kitchen ticket |
| Core controls and their behavior | Page composition when the task needs it |
| Accessibility, responsive, motion, and writing standards | A single signature device that supports the domain |

### Reuse, compose, or extend

Use this decision order:

1. **Reuse** an existing component when it solves the need.
2. **Compose** shared components into a documented pattern when the task is new but needs no new visual language.
3. **Extend the shared system** only when the need will recur across products or cannot be expressed with existing semantic roles.

Do not introduce page-local colors, arbitrary radii, duplicate button variants, or a different interaction model to solve a local problem.

## 3. Visual language

The visual character is the **dispatch floor**: asphalt, concrete, paper, and signal markings. It is practical rather than decorative—quiet surfaces let data, status, and actions stand out.

### 3.1 Color roles

Use semantic roles rather than raw color values in designs and code. Light and dark themes provide the values; the meaning stays the same.

| Role | Light | Dark | Use |
|---|---:|---:|---|
| `background` | `#F1F1ED` | `#121417` | Page field |
| `surface` | `#FFFFFF` | `#1A1D21` | Cards, sheets, dialogs |
| `border` | `#DFE1DB` | `#2A2E34` | Separators and control outlines |
| `foreground` | `#1A1D21` | `#F2F4F6` | Primary text |
| `foreground-secondary` | `#5C636F` | `#A8AFB8` | Supporting text |
| `foreground-muted` | `#9AA0AA` | `#6E757F` | Disabled or incidental text only |
| `primary` | `#B53A1E` | `#FF6A3D` | Primary actions, active emphasis |
| `accent` | `#F2B900` | `#FFC400` | Restricted brand highlight on dark surfaces |
| `success` | `#157A4D` | `#35C98B` | Complete, available, online |
| `warning` | `#8A5A00` | `#FFB84D` | Needs attention, in progress |
| `danger` | `#B5281A` | `#FF5F52` | Failure, overdue, destructive action |
| `info` | `#2A6CB0` | `#5AA8F5` | Scheduled, neutral system information |

Rules:

- Use `primary` for a meaningful action or focus point, not for broad decoration.
- Use status color with a text label and, where useful, an icon or dot. Color alone never communicates state.
- Reserve muted text for information that is genuinely optional. Important supporting copy uses `foreground-secondary`.
- Products may not invent a new semantic color to distinguish a local status. Map it to an existing role or propose a shared role.

### 3.2 Typography and data

| Role | Typeface | Use |
|---|---|---|
| Display | Archivo | Page titles, board headers, major values |
| Interface | IBM Plex Sans | UI copy, forms, descriptions, table text |
| Data | IBM Plex Mono | Figures, IDs, dates, times, amounts, codes |

Use tabular figures for values that are compared or scanned. Tables, reports, time, currency, percentages, plates, order numbers, and identifiers should align vertically.

| Style | Specification | Use |
|---|---|---|
| Page title | Archivo 700, 24/1.2 | One title per page |
| Section heading | Archivo 600, 18/1.3 | Card and section titles |
| Body | IBM Plex Sans 400, 14/1.5 | Default interface text |
| Supporting text | IBM Plex Sans 400, 12–13/1.4–1.5 | Captions and help text |
| Data | IBM Plex Mono 500, 12–13/1.4 | Numbers, codes, status labels |
| Label | IBM Plex Mono 500, 11/1.3, uppercase | Eyebrows and table headers |

### 3.3 Spacing, shape, and elevation

Build on a 4 px spacing scale: `4, 8, 12, 16, 20, 24, 32, 40, 48`.

- Standard page padding: 24 px on desktop; reduce thoughtfully on smaller screens.
- Card padding: 20 px; compact surfaces: 16 px; controls: 8 px internal padding.
- Radius: 4 px for small markers, 8 px for controls, 12 px for cards and dialogs.
- Cards are flat sheets with a 1 px border and subtle resting shadow. Strong elevation is reserved for temporary layers such as menus and dialogs.

## 4. Information hierarchy and layout

### 4.1 Start every page with purpose

Most pages use this hierarchy:

1. **Context:** breadcrumb or eyebrow when it identifies a real location or workflow.
2. **Title:** a short, task- or record-oriented page title.
3. **Supporting context:** one concise sentence only when it helps the user act.
4. **Actions:** the primary action and any relevant secondary actions.
5. **Work area:** the information or controls needed for the task.

Do not add an eyebrow, subtitle, statistic, or card merely to make a page look full. Every element must clarify context, status, or action.

### 4.2 Layout patterns

Choose a layout based on the task:

| Task | Recommended pattern |
|---|---|
| Monitor a small set of operational measures | Instrument strip followed by prioritized detail |
| Find and compare many records | Filterable data table with persistent useful controls |
| Review or edit one record | Record header, key status, grouped sections, anchored actions |
| Move work through real stages | Board or phase rail, with explicit state transitions |
| Make a focused decision | Single-column task view with supporting context beside it on wide screens |
| Perform repeated touch work | Larger controls, fewer simultaneous choices, task-first layout |

Use grids to create relationships, not visual novelty. A two-thirds/one-third split suits primary work with supporting context. Tables may scroll horizontally on small screens; do not compress important columns into illegibility.

### 4.3 Responsive behavior

Responsive design is a change in priority, not a scaled-down desktop.

- Keep the primary task and current status visible at every width.
- Collapse navigation before collapsing the work area.
- Stack peer fields and cards when their readable width is no longer available.
- Preserve labels for unfamiliar or consequential actions; do not replace everything with icons.
- Make dense data horizontally scrollable with a visible affordance rather than hiding critical columns.
- Use 44 px targets for touch-first contexts; no interactive target may be below 32 px.

## 5. Component behavior

Components are interaction contracts. New frontends should preserve both appearance and behavior.

### Actions and buttons

- One clear primary action per view whenever possible. Use a secondary action when it supports the same task; use a menu for rare actions.
- Labels are sentence case and name the outcome: “Add vehicle,” “Save changes,” “Export report.” Never use vague labels such as “Submit.”
- Destructive actions use `danger`, state the consequence, and receive confirmation when the action cannot be easily undone.
- Disabled controls explain why when the reason is not obvious. Do not use disabled as the only way to communicate a requirement.
- Loading states preserve the button label or clearly name the active operation. Prevent duplicate submissions.

### Status and feedback

Express every status as **text + color + supporting shape/icon**.

| Meaning | Semantic role | Example label |
|---|---|---|
| Positive or currently available | `success` | Available, Completed, Online |
| Active or needs attention | `warning` | In progress, Awaiting review |
| Planned or neutral system state | `info` | Scheduled, Held |
| Inactive or unfinished | neutral | Draft, Disabled, Archived |
| Failed, late, or unavailable | `danger` | Failed, Overdue, Offline |

Use a pulse only for a genuinely live state. Static records never pulse. A status badge is compact; use an alert or inline message when the user needs explanation or a corrective action.

### Forms

- Group fields by the user's mental model, not by data storage.
- Use one column by default. Two columns are appropriate only for short peer fields such as start/end dates.
- Put labels above fields. Mark required fields consistently; do not rely on placeholder text as a label.
- Validate early when it helps, and validate on submit for everything else. Put a concise, actionable error next to the field.
- Preserve entered data after a recoverable error. Confirm successful saves without interrupting the next task.
- Use progressive disclosure for advanced settings; never hide a required decision behind an unexplained “More.”

### Tables and lists

- Use a real table for comparable, row-and-column data. Use cards only when records need richer, non-comparable content.
- Put the most important identifier at the left and place actions consistently at the end.
- Use 44 px rows as a default. Align numeric values right and use the data typeface.
- Provide a meaningful empty state that says what happened and what the user can do next.
- Keep filtering, sorting, pagination, and bulk actions discoverable and keyboard operable.

### Dialogs, menus, and notifications

- Use a dialog for a focused decision or short task—not for routine navigation.
- Dialogs must have a clear title, a way to close, focus management, and a safe default action.
- Menus contain secondary or contextual actions. Do not use them to hide the page’s primary task.
- Toasts confirm brief, completed events. Errors that require action remain visible near the affected work.

## 6. Workflow patterns

### Real sequences

Use a phase rail, stepper, or board only when a workflow has an inherent order. Show completed, current, pending, and blocked states clearly. Do not use decorative numbering for unrelated content.

### Exceptions deserve priority

When a user monitors an operation, show exceptions before healthy routine activity. Make the reason, severity, affected record, and next action visible together.

### Record identity

Each record view should make its identity, current status, owner or source where relevant, and available actions easy to locate. Domain-specific identifiers may have a distinct presentation—for example, FleetOps plates—but use signature treatments sparingly so they retain meaning.

### Confirming change

Before a significant state change, make the new state and side effects clear. After it succeeds, show the result in the screen itself when possible; a toast is supporting feedback, not the only confirmation.

### Website emergency incidents

Emergency reports are operational incidents, not general issue reports. Keep the distinction visible in the web dashboard:

- Use an **Emergency** incident type and a danger treatment for urgent records; do not reuse the neutral issue-report label or presentation.
- Show the driver, vehicle, last known location, timestamp, and response state together in the incident header.
- Use direct response copy such as **Help is on the way** or **Dispatch has called emergency services** after the incident is acknowledged. Avoid vague success messages.
- Place the location on the incidents map and in the incident detail record so dispatch can act from either view.
- Keep response actions explicit: **Call ambulance**, **Call 911**, **Acknowledge**, and **Update response**. Destructive or irreversible actions require confirmation.
- Emergency state must be communicated by text, danger color, and a supporting icon or marker; never by color alone.

**The Emergency Separation Rule.** Emergency incidents share the website incident workflow and data surface, but they must remain visually and semantically distinct from routine issue reports.

### Website driver schedule access

Drivers should be able to reach their current work schedule from a website quick-action area without leaving the dashboard context.

- Label the action **View work schedule** and pair it with a calendar icon; keep the label visible because it is consequential workflow navigation.
- Show the current date range, assigned shift, status, and any approved leave request in the schedule view.
- Keep **Request leave** as a secondary action beside the schedule context, with submitted, pending, approved, and declined states.
- Preserve the dashboard shell and return path; schedule navigation should not open an unrelated modal for a full schedule review.

**The Context-Preserving Action Rule.** Website quick actions should open the complete work surface with the current driver context intact, not create a disconnected shortcut flow.

## 7. Accessibility and inclusive UX

Accessibility is a baseline for every frontend, not a final review item.

- Text contrast is at least 4.5:1; large text is at least 3:1.
- Every interactive element has a visible, 2 px focus treatment with sufficient contrast in both themes.
- Use semantic HTML: buttons for actions, links for navigation, tables for data, labels for fields, and headings in logical order.
- All core flows work with keyboard alone. Dialogs trap focus and return it when closed.
- Icon-only controls require accessible names and tooltips when the meaning is not universally clear.
- Respect `prefers-reduced-motion`; remove pulses, slides, and staggered movement while preserving clear state feedback.
- Do not communicate instructions, errors, or status by color, position, sound, or motion alone.
- Write in plain language. Avoid idioms, unexplained abbreviations, and internal technical terms.

## 8. Motion and visual restraint

Motion should explain a change, direct attention, or acknowledge input. It should never decorate waiting time.

- Micro-interactions: 150–200 ms, with no bounce.
- Use modest fade or short movement for entering temporary layers and for a meaningful change of state.
- Avoid ambient animation, parallax, scroll reveals, and decorative counters in operational screens.
- Prefer stable layouts. Do not let loading content shift controls a user may be about to select.

## 9. Content design

The product voice is direct, calm, and practical.

- Use plain verbs and sentence case: “Assign driver,” “Save changes,” “Trip completed.”
- Keep names consistent throughout a workflow. If the action is “Dispatch,” do not call the result “Send trip.”
- Name concepts by what users control, not how they are implemented.
- Errors state the problem and the fix: “Enter a valid plate number.”
- Empty states explain the next useful action: “No trips scheduled. Create the first trip.”
- Be specific with time, currency, units, and dates. Use localized formats appropriate to the product’s users.

## 10. Adopting this system in another frontend

### Discovery

1. Map the user roles, high-frequency tasks, decisions, and failure points.
2. Identify shared entities and the information users need at each workflow stage.
3. Sketch task flows before designing individual screens.
4. Choose the shared patterns that fit; document any domain pattern the product adds.

### Design and build

1. Use the shared semantic tokens, typography roles, spacing scale, and component behavior.
2. Design the smallest complete path for the highest-value workflow, including loading, empty, error, success, and permission states.
3. Check desktop, narrow desktop, tablet, and touch layouts as the design evolves.
4. Validate keyboard navigation, contrast, focus, reduced motion, and readable data alignment before release.
5. Add reusable patterns back to this document when they prove useful beyond one page.

### Definition of done

- [ ] The primary user task, current status, and next action are clear without training.
- [ ] Existing components and semantic tokens are reused wherever applicable.
- [ ] Every consequential state has loading, empty, error, and success behavior.
- [ ] The layout remains usable at narrow widths and with touch input.
- [ ] Keyboard, focus, contrast, semantics, and reduced-motion requirements are met.
- [ ] Copy is specific, consistent, and action-oriented.
- [ ] Any new domain pattern is documented, reusable, and does not introduce a private visual language.

## Appendix: FleetOps domain patterns

FleetOps adds a few patterns that other systems may reuse conceptually, but not necessarily visually:

- **License plate:** a compact physical-plate treatment for vehicle identity in high-value contexts such as a record header, dispatch card, or map marker. Use a plain code in dense logs and filters.
- **Phase rail:** an ordered lifecycle view for dispatches and trips. Other products can use the same interaction principle for orders, bookings, or approvals.
- **Status seal:** an optional reviewed-document marker for audited paperwork. It is secondary to the standard status badge and should be removed when it adds clutter.

New products should create similarly purposeful patterns only when they make a domain concept faster to recognize or act on. The pattern must be built from the shared foundations above.
