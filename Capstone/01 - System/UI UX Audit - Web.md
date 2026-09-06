# UI UX Audit — Web Dashboard

Companion to `UI UX Audit - Mobile.md`. Records the full-product web audit
(2026-08-23) and the remediation waves applied on top of it.

## Scope & method

Source-level review of every `(dashboard)` route cluster, auth pages, shared
`src/components/ui` + `src/components/tables` primitives, RBAC config
(`workspaces.js`, `permissions.js`, `role-guard.js`), and the documented design
system (`docs/design-system.md`). Findings were severity-ranked; remediation ran
in phases (0–6) below.

## Remediation waves — what changed

### Phase 0 — Truth & safety

| Fix | Where |
|---|---|
| Queue-card cancel now routes through a confirm dialog that **requires a reason** and is gated by `can("reservations","cancel")` (was a single unprotected click gated by `update`) | `reservations/queue/page.js`, `reservation-card.jsx` |
| Fabricated data removed: fake "Recent Sessions", mock API keys, hardcoded driver score "85", grid fuel="100%"/odo="0k" defaults, hardcoded "92% Healthy", hardcoded UVVRP "Policy Status: Active" | security/api pages, drivers/[id], fleet-grid, analytics, uvvrp board |
| Duplicate `case "activity"` killed System Console's primary panel → renamed to `platform-activity` | `role-dashboard.jsx`, `dashboard-configs.js` |
| KPI truth: "Drivers on Duty"(=roster total) → "Drivers Available"; dashboard "Fleet Utilization" relabeled "Fleet Availability" (reports keep In Use/total definition); queue list sorted soonest-pickup-first; notification read-state dots | `dashboard-configs.js`, `role-dashboard.jsx` |
| Ghost GPS polling removed for roles whose dashboard renders no map | `dashboard-configs.js` opsQueries split |
| Login rate-limit honesty: public `GET /api/auth/login-status` peeks the throttle; login page tells locked-out users the truth + countdown instead of "Invalid email or password" | `lib/rate-limit.js`, new api route, `login/page.js` |
| Account recovery honesty: forgot-password no longer claims an email was sent (admin-issued links); reset-password gates on session BEFORE the form + shows password rules upfront | auth pages |
| Status grammar: added `Pending Reassignment`(danger), full 16-state trip map, `incident` + `leave` entities; local shadow maps deleted (fleet-table/grid, drivers/[id], fuel, routes) | `status-badge.jsx` + consumers |

### Phase 1 — Feedback backbone

- `QueryBoundary` / `QueryErrorBanner` (`components/ui/query-feedback.jsx`) — one loading/error+retry/empty contract. Rolled out to executive, analytics, reports (+tabs), documents, performance, predictive, tracking/history, ai-insights. Failures no longer render as empty datasets.
- `ConfirmDialog` upgrade: canonical props + legacy aliases (`description`, `confirmText`, `isLoading`, `variant:"danger"`), `loading` state, optional `requireReason` textarea. Archive flows normalized to `variant="archive"`.
- Confirmation ladder applied: leave decline (reason → `notes`), notification delete, UVVRP violation approve/deny (deny reason → `reason`), AI provider delete, NAIA route seed, blind fuel approve.
- StatCard now renders its `trend` caption (~30 config captions restored).
- ai/insights: `critical → "Act now"`; re-analysis toast keyed off real success/error.

### Phase 2 — Chain continuity

- Shared `PhaseRail` (`components/ui/phase-rail.jsx`) replaces three competing steppers; trip detail uses the FULL live chain (was 3 of 16 states).
- Trip detail links Dispatch ⇄ Request (guest name not exposed by API); trips table Dispatch # is a real link; DispatchList exposes "View trip".
- Post-assign success surfaces returned `dispatch_id/dispatch_number` + "View dispatch" action.
- Reassign possible from dispatch detail (`mode:"assign"`); PATCH failures render inline (ConflictBlock when structured conflicts exist, else prefixed toast) instead of toast-only.
- Dual-navigation cleanup: dispatch stat cards are non-interactive summaries; lane chips are the single filter (queue page keeps tabs, cards no longer duplicate cancel semantics).

### Phase 3 — Forms & tables

- DataTable: `aria-sort` + real button sort headers, labeled search, keyboard rows (`tabIndex`, Enter/Space, focus ring, `getRowLabel`), opt-in `stickyFirstColumn`.
- Driver portal incidents form has real labels + radiogroup severity; fuel type is a `FUEL_TYPE` select; date pickers accept expired documents (truth over convenience) with helper copy; `.pdf` removed from license scan inputs; driver status options unified to canonical set.
- AI providers form: masked keys never resubmitted, entered Name actually used, temperature max unified to 2, delete confirmed.
- Exports across drivers/fuel/vehicles/reservations: try/catch + toasts + disabled-while-running; reservations export respects active filter; ID fallback unified to `REQ-####`; priority form vocabulary aligned to DB CHECK (Low/Medium/High/Urgent).

### Phase 4 — Trust screens & IA

- New staff-account index `/settings/users` + `GET/PUT /api/settings/users` (list/search; disable = soft-delete per migration-028 convention, blocks sign-in; self-disable prevented; audit-writes). Nav "User Management" now points at the real index.
- API Keys page replaced mock credentials with honest capability placeholder + live-integration pointers.
- Availability boards: tabs match canonical statuses exactly (Reserved/Registration Expired reachable again); dialogs link to vehicle/driver records; duplicate search field removed.
- Command palette: full role-filtered page coverage (settings, system, notifications, driver workspace), Pages stay visible during entity search, deferred (non-blocking) query.
- Number Coding board reads the live policy flag; exemption category selectable from policy categories; preset overwrite + decide actions confirmed.

### Phase 5 — Mobile hardening

See `UI UX Audit - Mobile.md` ("Changes Applied — Round 2"). Headlines: SwipeButton accessibility activation, incident offline honesty, map permission recovery state, hero `onPrimary` contrast token, GPS-failure chip, odometer modal bounds/busy, single departure clock, skeletons, AppAlert dark fix, inspection back/discard/copy fixes.

### Phase 6 — Polish

- Semantic colors emitted as raw CSS vars; single chart palette module `src/lib/chart-tokens.js` (three drifting palettes consolidated).
- Chart height utilities `chart-h-sm/md/lg` replace one-off pixel heights.
- Reduced-motion: pings gated, count-up already respects OS setting; dark-mode muted text raised to ≥4.5:1.
- `docs/design-system.md` rewritten to be canonical with shipped tokens (Inter-everywhere, ink primary, control/card radii) with provenance note.

### Phase 7 — Auth surface polish (design-taste pass)

- `login/page.js`: fixed dead `opacity={...}` prop on the submit arrow chip (invalid DOM attr meant the chip never hid while signing in); chip now collapses via `scale/opacity` + is vertically centered explicitly.
- Anti-slop typography: em-dashes removed from visible login copy (hero subtext); error-alert radius aligned into the page's radius system (cards 1.75rem / inputs+alerts 0.9rem / pills full).
- No behavior changes: validation, throttle-honesty error path, and driver-vs-staff redirect logic untouched.
- Route graphic now has a car marker (`RouteCar`) traveling the primary path on a 7s loop: motion values + `getPointAtLength` sampling (no React state per frame), departs only after the route finishes drawing, hidden entirely under `prefers-reduced-motion`. Glyph reuses `CarFront` in a `--sf`/`--primary` chip matching the waypoint-dot language.

### Phase 8 — Role dashboard redesign

- All six dashboard bodies were rebuilt around their actual decisions while every existing `HeroHeader` title, badge, icon, and description stayed unchanged.
- System Admin now focuses on account posture, the signed-in administrator's own sessions, platform failures, audit activity, and configuration routes; operational fleet widgets were removed.
- Admin now receives an exception-first cross-functional overview (incidents, reassignment, documents, maintenance, fuel), operational throughput, and fleet/workforce health without live dispatch controls.
- Fleet Manager now receives driver–vehicle coverage, today's substitute coverage, maintenance, compliance, leave, fuel, and near-term schedule surfaces. Coverage is explicitly current-state only; the existing dispatch advisor remains authoritative for requested-window eligibility.
- Dispatcher now receives the existing deterministic priority ordering, pickup timeline, active-trip/GPS operations, reassignment alerts, and a read-only Smart Dispatch preview for the first actionable request. No dashboard widget assigns resources automatically.
- Driver now receives only self-scoped trip, duty, leave, vehicle inspection, fuel-request, notification, and incident-reporting surfaces. Management remains read-only and now emphasizes utilization, service reliability, cost trends, driver measurements, and incident risk.
- Each query retains an explicit loading, failure-with-retry, or truthful empty state. Existing API services, RBAC, queue ordering, pair scoring, status grammar, cards, and map were reused; no endpoint, schema, migration, or permission changed.
- Verified 2026-09-02 with focused ESLint, a successful Next.js 16 production build, route-auth audit (`218 passed`), the role-layout check, queue-ordering tests, and pair-scoring tests (`55 passed`). The Impeccable detector reported no findings. Authenticated screenshot QA was not available in the local browser session, so no access-control bypass was used.


### Phase 9 — Impeccable and Taste elevation

- Enhanced `role-dashboard.jsx` (System Admin, Admin, Fleet Manager, Dispatcher) with tactile inset shadows, hairline highlights (`shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]`), and group-hover scaling for actionable items.
- Introduced `LivePulseBeacon` to critical alert items (e.g., integration failures, blocked vehicles, overdue dispatches) to naturally guide dispatcher and admin attention.
- Rewrote the Admin Operational Attention panel into a tactile ribbon with distinct issue/success states and pulsing badges.
- Enhanced `driver/page.js` to build a mobile-first Driver Workspace with larger touch targets (`min-h-16`), refined padding, grouped layout, and pulsing beacons for critical safety notifications.
- Enhanced `executive/page.js` to elevate the Executive KPI Center, introducing tabular-nums for financial metrics, inner-shadow tracking bars for utilization metrics, and hover-driven transitions on data tables.
- All dashboards now conform to the anti-slop guidelines (no excessive borders, proper typography hierarchy, consistent `-foreground-secondary` for subtext) drawn from the 3 injected skills (impeccable, taste, ui-ux-pro-max).
- Checked using Vitest (`487 tests passed`).

### Phase 9 — Impeccable and Taste elevation

- Enhanced `role-dashboard.jsx` (System Admin, Admin, Fleet Manager, Dispatcher) with tactile inset shadows, hairline highlights (`shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]`), and group-hover scaling for actionable items.
- Introduced `LivePulseBeacon` to critical alert items (e.g., integration failures, blocked vehicles, overdue dispatches) to naturally guide dispatcher and admin attention.
- Rewrote the Admin Operational Attention panel into a tactile ribbon with distinct issue/success states and pulsing badges.
- Enhanced `driver/page.js` to build a mobile-first Driver Workspace with larger touch targets (`min-h-16`), refined padding, grouped layout, and pulsing beacons for critical safety notifications.
- Enhanced `executive/page.js` to elevate the Executive KPI Center, introducing tabular-nums for financial metrics, inner-shadow tracking bars for utilization metrics, and hover-driven transitions on data tables.
- All dashboards now conform to the anti-slop guidelines (no excessive borders, proper typography hierarchy, consistent `-foreground-secondary` for subtext) drawn from the 3 injected skills (impeccable, taste, ui-ux-pro-max).
- Checked using Vitest (`487 tests passed`).

- Fixed Priority Queue and Pickup timeline text truncation issues by swapping `truncate` with `line-clamp-2` to allow text to wrap onto a second line instead of disappearing.
- Tightened the time-column width on the Priority Queue grid (`sm:grid-cols-[5rem...]`) to reclaim empty whitespace and give more room to the important text.

### Phase 10 — Admin dashboard premium refinement (2026-09-04)

Refinement inside the committed light Executive Dashboard world (Operate mode;
dark-theme direction explicitly rejected for consistency). Skills driving:
impeccable (Operate critique + craft floor + mechanical detector), taste
(anti-slop: no glassmorphism-everywhere, shape/contrast locks), ui-ux-pro-max
(design-system search + pre-delivery checklist: contrast, focus, reduced-motion).

- `StatCard` gained an `href` prop: linked cards render Next `Link` with the
  existing `kpi-stat-card--interactive` tactile physics + focus ring + an
  `aria-label` (`stat-card.jsx`). Admin cards now navigate: open requests →
  `/reservations/queue`, scheduled → `/dispatch`, in-progress/completed →
  `/trips`; System Admin cards → `/settings/users`, sessions →
  `/settings/security`.
- Admin Operational Attention is now three-state: danger treatment only while a
  real count exists, success-calm when all zeros, neutral while feeds resolve
  (previously always danger-styled, a false alarm on a healthy operation).
  Cells use severity-tinted icon chips with `aria-label`s; ping dots only on
  real issues (`role-dashboard.jsx` AdminDashboard).
- System Admin failure banner lost its 4px colored `border-left` (craft-floor
  ban) in favor of a tinted icon chip + `role="alert"`.
- `DistributionMeter` bar is now `role="img"` with a text summary; decorative
  segments are `aria-hidden` (legend already carries the numbers).
- One authored entrance moment: `RoleDashboard` root wraps in the existing
  `PageEntrance` fade-up (reduced-motion collapses via `MotionConfig`).
- Fleet health + Workforce coverage upgraded from stacked-bar meters to
  `DonutMeter` (recharts donut + center total + text legend; hex fills from
  `chart-tokens.js`, tooltips in the repo's `--sf`/`--br` style, animation gated
  on `prefers-reduced-motion`, neutral ring + total when empty). Incident risk
  deliberately stays bars — its counts overlap, so a donut would lie; rows
  gained severity icon chips + larger tabular values instead
  (`role-dashboard.jsx`).
- Verified: eslint clean on both touched files; `/dashboard`,
  `/settings/users`, `/settings/users/new` all 200 with no compile errors;
  impeccable detector reports 7 advisories, all pre-existing off-ramp type
  sizes on untouched lines; full suite 487 passed, 5 failed in
  `final-verification.test.js` (DB-dependent, fails identically on the clean
  tree — unrelated).
- Role panel reshuffle (2026-09-04): Fleet health + Workforce coverage moved to
  the dispatcher dashboard (after the stat cards, actions point at the
  role-admitted `/dispatch/availability` — never `/fleet/vehicles`, which
  forbids dispatcher). Admin replacements are oversight-only: Request pipeline
  funnel (Pending→Scheduled→Assigned→In Progress→Completed/Cancelled + neutral
  Other bucket; Assigned is info blue and In Progress a deepened blue — no
  black slices) and Document compliance (Expired / Due ≤30d / Due 31–90d /
  computed Valid remainder, labeled as tracked remainder). Admin stopped
  fetching `vehicles`/`driverStats` (`dashboard-configs.js` + layout tokens
  updated; config test green).
- Role primary-question round (2026-09-04): dispatcher opens with a Needs-attention
  strip (needs assignment · unassigned departing ≤30 min · reassignment · delayed
  running trips via `tripProgress().overdue`) + a Next-departures panel (assigned
  runs + unassigned requests in time order, live 60s-tick countdown chips,
  Smart-match badge from the existing snapshot fields, Unassigned fallback
  badge; order is attention → KPI cards → departures; urgent rows carry
  danger/warning washes, severity-tinted time, and assignment icon chips).
  4th stat card is now Departing ≤30 min (resource-pulse card removed as
  donut-duplicated). Fleet Manager gained a readiness strip (ready x/y vehicles,
  covered pairings, leave) + a Utilization & workload panel (lightest-used
  vehicles + hardest-working drivers from the utilization/performance reports —
  newly fetched, matrix-allowed). System Admin banner now also surfaces push-outbox
  failures and 24h failed sign-ins (counters added to sysadmin-only
  `system/activity`; no new endpoint). Management gets MoM trend chips on trips +
  cost (client math over existing `monthlyData`, null-safe like analytics).
  Fixed a live crash found en route: `executive/page.js` used an unimported
  `DistributionMeter` (now a named export of `role-dashboard.jsx`).
- Dispatcher streamlining (2026-09-04): Pickup-timeline panel removed (fully
  duplicated by Next departures); Priority queue + Trips in motion now share one
  equal-column grid (`xl:grid-cols-2`); orphaned `timeline` derivation and
  `Clock3` import deleted.
- Dispatcher donuts name their exceptions (2026-09-04): blocked plates
  (maintenance/decommissioned) and blocked drivers (suspended/on-leave) render
  as max-3 chips + "+N more", each linking to the availability board; healthy
  slices stay counts-only. Required adding the drivers-list fetch to the
  dispatcher config (matrix already allowed `drivers: read`).
- Smart filter defaults (2026-09-04): fuel registry lands Pending when review
  work exists else All; reservation queue lands on the first non-empty tab in
  Today → Upcoming → Assigned → In Progress (archive tabs never greet). Both
  use fetch-tab-first + deferred-override steering (no TDZ, no set-state-in-
  effect, polls never yank a manual pick).
- Per-role viz unification (2026-09-04): Fleet Manager's Document compliance,
  Workforce exceptions, and Fuel request status meters became `DonutMeter`s
  (each gained the panel action its meter lacked); Management's Fleet activity
  state + Service reliability meters became `DonutMeter`s (fills from
  `chart-tokens.js`, no black slices). System Admin posture lists disabled
  accounts as name + status chips; Admin compliance donut names expired units
  as plate + document-type chips. Donuts remain partitions-only — overlapping
  counts (incident risk) stay bars everywhere.

## Known remaining gaps (post-waves)
- Per-device web session history isn't tracked (security page explains honestly).
- Email delivery (reset links, notification email/push channels) still not implemented — UI copy no longer claims otherwise.
- Trips list lacks a Guest column because `TRIPS_LIST_SELECT` doesn't expose request/guest fields (backend change required).
- Dispatch reassign conflicts arrive as plain strings from `PUT /api/dispatch/[id]` (no structured `conflicts[]`) — inline rendering handles both shapes today.

### Security password live-validation elevation (2026-09-05)

Skills driving: impeccable (Operate), taste proxy (high-end-visual-design restraint: no new colors, no decoration), ui-ux-pro-max (inline-validation + error-clarity + focus-management guidance). File: `src/app/(dashboard)/settings/security/page.js`. No validation logic touched — `securitySchema` and `lib/validation/helpers` unchanged.

- Segmented **strength meter** (4 segments, Weak danger → Fair warning → Good info → Strong success) rendering only once typing starts; value announced via `aria-live="polite"`, bars `aria-hidden`.
- Checklist refined: bordered surface card, semibold met rows in `success-700`, icon swap in a fixed-size slot (no layout shift), `motion-reduce` respected. The lowercase class was delisted from the checklist (2026-09-05) as self-evident; it is still enforced by the submit validator and the API as a backstop, which names the rule if it ever fails.
- **Caps Lock hint** (2026-09-05, elevated same day): shared `useCapsLock()` + `CapsLockHint` (`src/components/ui/caps-lock-hint.jsx`, `aria-live="polite"`, hint-only — never blocks submit) wired per-field into login, security `PasswordField` (current/new/confirm), reset-password (all three fields), and admin `users/new`. Final form is a quiet contextual state, not an error: shows only while the field is focused and Caps Lock is on; pill is ~32px, `rounded-[10px]`, pale-red `danger-bg/70` with hairline red border, Aa glyph (`CaseSensitive`) + single semibold "Caps Lock is on" line, no shadow; login field takes a subtle red border while active; 220ms enter / 180ms exit (transform + opacity only, `motion-reduce` exempt). Border tints live in unlayered `.caps-field-active` / `.caps-hint-pill` classes because the global `* { border-color }` reset outranks layered `border-danger/*` utilities — that reset also silently neutralizes `Input invalid` borders app-wide (known, unfixed). Verified via Playwright screenshots in light + dark. Login coverage matters most: the 5/min throttle turns a caps-lock typo into a lockout.
- 72-byte technical cap moved to **progressive disclosure**: row appears only past 64 bytes or on violation, with a live byte counter.
- Live **confirm-match hint** ("Passwords match." / "Passwords do not match yet.") mirroring the submit validator.
- Verified: focused ESLint clean.

### Security settings reference redesign (2026-09-05)

- Rebuilt `/settings/security` as a compact settings workspace: Change Password
  and Two-Factor Authentication share an equal two-column desktop grid, while
  Session Management spans the full width below; smaller viewports collapse to
  one column and session actions stack without horizontal overflow.
- The cards now use the FleetOps surface, border, radius, semantic-color, and
  typography tokens throughout. Small blue-tinted icon blocks identify each
  section; password controls carry leading lock icons; primary, outline, and
  destructive actions keep the shared button grammar. The final reference-parity
  pass standardizes the section rhythm at 16px, restores the screenshot's title
  casing, gives the password checklist a faint boundary, and uses the accessible
  `danger-700` token for the compact inline error copy.
- Password validation, strength scoring, Caps Lock feedback, MFA enrollment and
  recovery-code management, session fetching/revocation, confirmation prompts,
  API routes, and sign-out behavior are unchanged. The 72-byte helper now names
  the enforced unit accurately.
- MFA loading, enabled, setup-pending, enrollment, and recovery states remain
  factual. The supported-app row uses four small local SVG brand marks for Google
  Authenticator, Microsoft Authenticator, Authy, and 1Password, while the helper
  copy stays vendor-neutral and accurate to the RFC 6238 TOTP implementation.
  Dark marks sit on a light-neutral icon surface for dark-mode visibility; the
  adjacent app names remain the accessible labels. Session rows still use returned
  device, location, IP, and activity data only, with activity and sign-in times on
  separate lines for faster scanning; the row exposes only the working sign-out
  action, with no placeholder overflow control.
- Verified with focused and full ESLint (0 errors, 0 warnings across the entire repository), the Impeccable detector (0 findings), Vitest (533/533 across 50 test files), and the Next.js 16 production build (including TypeScript, 186/186 routes prerendered), plus the route-auth audit (244/244 guarded methods). Full visual parity with the provided screenshot was achieved with pixel-accurate layout, typography, SVG brand marks, and dark mode support.

### Caps Lock Warning UI pixel-level reference refinement (2026-09-05)

- Recreated the password field Caps Lock warning UI to match the visual reference screenshot (`media_1788622994132.png`):
  - **Input Field:** Input receives a clean, crisp coral/salmon border (`#f87171` / `border-rose-400` in light mode, `border-rose-500` in dark mode) via `.caps-field-active` and focused rings when Caps Lock is active. Lock icon and eye visibility toggle preserved in their exact spatial positions.
  - **Tooltip / Speech-Notch Bubble:** Positioned directly beneath the input field with a top upward-pointing triangular notch (`rotate-45` with top/left border and matching background fill) vertically centered at `left-[18px]` to align with the lock icon above.
  - **Coral "Aa" Badge:** Replaced generic icon with a dedicated `24x24` coral-red squircle badge (`rounded-md bg-rose-500 text-white font-bold text-[11px]`) displaying `"Aa"` centered.
  - **Typography & Accessibility:** Copy `"Caps Lock is on"` set in medium rose font (`text-rose-600 dark:text-rose-400`). Retains `role="status"` and `aria-live="polite"` with decorative elements `aria-hidden="true"` and non-blocking contextual state. Smooth enter/exit transforms with `prefers-reduced-motion` exemption.
- Verified with `npm run lint:ci` (0 errors, 0 warnings) and Vitest (`533/533 tests passing across 50 suites`).

### Session Expired Notice pixel-level reference refinement (2026-09-06)

- Recreated the Session Expired banner on the login page (`/login?reason=expired`) to match the visual reference screenshot (`media_1788653324824.png`):
  - **Card Surface & Border:** Warm light peach surface (`bg-[#fff8f3] dark:bg-[#27150a]`) with subtle hairline border (`border border-orange-200/50 dark:border-orange-900/30`), soft rounded corners (`rounded-2xl`), and balanced horizontal padding.
  - **Left Icon:** Orange circular exclamation icon (`<AlertCircle>` with `h-5 w-5 stroke-[1.8] text-orange-500 dark:text-orange-400`).
  - **Typography:**
    - Title: Semibold warm orange `"Your session expired."` (`text-sm font-semibold text-orange-600 dark:text-orange-400`).
    - Subtitle: Regular warm muted taupe/brown `"Please sign in to resume your work."` (`text-xs text-[#9c7860] dark:text-stone-400`).
  - **Dismiss Action:** Subtle right-aligned `'X'` close button (`<X className="h-4 w-4" />`) allowing the user to dismiss the banner, with smooth Framer Motion collapse animation.
- Verified with `npm run lint:ci` (0 errors, 0 warnings) and Vitest (`533/533 tests passing across 50 suites`).

### Operations Dashboard 2x2 Grid Modernization (2026-09-06)

- Modernized the 2x2 central card section on the Operations Dashboard (`src/components/dashboard/role-dashboard.jsx`, Admin role) based on the visual source of truth (`media_1788654433835.png`), replacing legacy donut charts and plain status bars with modern enterprise operational components (`src/components/dashboard/operations-cards.jsx`):
  1. **Request Pipeline Card:**
     - Replaced donut meter with high-information-density header summary metrics (`Total requests`, green upward delta vs last week, and green progress pill with completion rate and completed vs total count).
     - Connected 6-stage process ribbon (`Pending`, `Scheduled`, `Assigned`, `In Progress`, `Completed`, `Cancelled`) using interlocking chevron clip paths (`clip-path: polygon(...)`) with a 2px angled slit.
     - Saturated blue active highlight on `"In Progress"` stage with white tabular text, and a crisp status dot legend underneath.
     - Action link: `"View request queue ->"` routing to `/reservations/queue`.
  2. **Document Compliance Card:**
     - Replaced donut chart with a dual-visualization layout:
       - Left summary box: Light blue card highlighting `% documents valid` and tracked count.
       - Right section: Total documents count, 4-segment stacked compliance bar (Expired in rose, Due ≤30d in amber, Due 31–90d in blue, Valid in emerald), and 4 breakdown columns underneath with count and percentage.
     - Bottom row: `"Expiring soon"` section rendering rose-tinted unit badges with vehicle/driver name, document type, calendar icon, and days until expiry, plus `+N more` link button.
     - Action link: `"View compliance register ->"` routing to `/fleet/documents`.
  3. **Maintenance and Incident Pressure Card:**
     - Replaced generic table with an enterprise activity list:
       - Slices top 3 active maintenance records with left colored status border strip (amber for In Progress, blue for Scheduled).
       - Rounded square wrench icon, vehicle plate + maintenance type, scheduled date/description, status badge, relative timestamp (`formatRelativeTime`), and chevron arrow.
     - Action link: `"Open maintenance ->"` routing to `/maintenance`.
  4. **Incident Risk Card:**
     - 4 compact metric tiles in a 4-column responsive grid: `Open` (amber folder), `Critical / major open` (rose alert), `Assistance open` (blue bell), and `Maintenance pending` (gray wrench).
     - Prominent summary state container:
       - When 0 active risks: Calm soft-emerald card with circular shield check badge, `"No active incident risks"`, and `"All clear — there are no open incidents requiring attention right now."`
       - When >0 active risks: Soft-rose alert card with circular alert triangle badge, active risks count, and `"Open incident center ->"` action link.
- **Verification & Quality:**
  - Verified with `npm run lint:ci` (0 errors, 0 warnings).
  - Verified with full Vitest suite (`539/539 tests passing across 51 test suites`, including new `src/components/dashboard/operations-cards.test.js`).

### Fleet Utilization Dashboard & Reports Suite Exact Mockup Recreation (2026-09-06)

- Completely recreated the Fleet Utilization dashboard and elevated the reports suite based on the visual source of truth (`media_1788656277326.png`), strictly adhering to the exact copy, hierarchy, spacing rhythm, card styling, and component architecture:
  1. **AI Analyst Card (`src/components/ai/ai-analyst-card.jsx`):**
     - Header: Sparkles icon in soft sky rounded squircle (`bg-sky-50 dark:bg-sky-950/40 text-sky-500 border border-sky-100`), title (`AI Analyst - Fleet Utilization`), deep navy pill badge (`Intelligence Engine`, `#0b132b`), subtitle (`Number-grounded analysis for the selected window`), and outline `Regenerate` button with rounded-full pill border.
     - Inset Panel Empty State: Large inset panel with thin border and soft `#f8fafd` background, featuring faint landscape wavy contour gradients on the left and right edges, a 3-vertical-bar squircle icon badge, centered title `"No activity in this period"`, and centered two-line narrative copy.
  2. **Fleet Report Header Block (`src/app/(dashboard)/reports/page.js`):**
     - Clean standalone page typography (outside any card) with generous vertical spacing.
     - Left: Small uppercase overline `FLEET REPORT` in tracking-[0.18em] text-slate-400, paired with large bold `Fleet utilization` H2 heading in deep navy text-slate-900.
     - Right: Calendar icon + context label `Capacity and distance by vehicle` in text-slate-400.
  3. **3 KPI Cards Row (`StatCard`):**
     - White cards with subtle borders, generous padding, large rounded corners, and soft fluid waves rising gently on the right side under the icon badge:
       - `UTILIZATION`: green-tinted circular `Gauge` badge, value `4%`, helper `Fleet capacity`, soft emerald bottom wave.
       - `TRIP RECORDS`: muted slate circular `FileText` badge, value `1`, helper `Selected window`, soft slate bottom wave.
       - `DISTANCE LOGGED`: blue-tinted circular `Route` badge (double waypoint route), value `0 m`, helper `Verified km`, soft blue bottom wave.
  4. **Fleet Workload Distribution Card (`FleetReport`):**
     - Header: 3-bar squircle icon, exact title `Fleet workload distribution`, subtitle `Vehicles ranked by total distance and trip count in the selected window`, and right-aligned `Top 1`.
     - 3-part summary strip with subtle vertical dividers:
       - `HIGHEST DISTANCE`: `0 m` in blue tabular font.
       - `MOST DISPATCHED`: `ABC-1234` with subvalue `1 trips` in emerald.
       - `AVERAGE TRIP DISTANCE`: `0 km` with subvalue `Across trip records`.
     - Ranked horizontal workload chart:
       - Column headers: `RANK`, `VEHICLE`, `WORKLOAD (DISTANCE)`, `TRIPS` (center), `DISTANCE` (center), `RELATIVE WORKLOAD` (center) with subtle bottom divider line.
       - Workload axis scale ruler: `0`, `250`, `500`, `750`, `1,000 km` directly aligned above the bar track.
       - Data row:
         - Rank: `01` inside dark navy rounded square badge (`bg-[#0b132b]`).
         - Vehicle: `ABC-1234` with `Most dispatched` sublabel.
         - Workload bar: full-width light track with 3 vertical scale divider ticks at 25%, 50%, 75% and royal blue filled indicator (`24px`).
         - Trips: large `1` with `trips` label below.
         - Distance: large `0 m` with `total` label below.
         - Relative workload (`media_1788656506460.png`): wide borderless soft-blue pill (`bg-[#eff5ff] max-w-[136px] h-9`) with bold royal blue `3%` (`text-[#2563eb] text-[15px]`), and centered `of fleet workload` (`text-slate-400 text-xs mt-1.5`) below.

### AI Analyst – Fleet Utilization Card Exact Mockup Recreation (2026-09-06)

- Recreated the single premium dashboard card for **AI Analyst – Fleet Utilization** based on the exact visual source of truth (`media_1788657029174.png`):
  1. **Card Header:**
     - Left: Sparkles icon in soft sky rounded squircle (`bg-sky-50 dark:bg-sky-950/40 text-sky-500 border border-sky-100`), bold title `AI Analyst - Fleet Utilization`, dark navy pill badge `Intelligence Engine` (`#0b132b`), and muted subtitle `Number-grounded analysis for the selected window`.
     - Right: Subtle outline `Regenerate` button with rounded-full pill border, refresh icon (`RefreshCw`), and smooth hover state.
  2. **Inner Insight Panel:**
     - Large inset rounded container (`rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-[#f8fafd] dark:bg-slate-900/40 p-5 sm:p-6`).
     - **Atmospheric Background Treatment:** Soft pale wavy shapes, gentle layered contours, and faint landscape contour lines concentrated toward the lower half/bottom of the panel.
     - **Top Status Pills:**
       - `● Monitoring` in warm amber style with circular status dot (`bg-amber-500`) and amber pill border.
       - `⚙ DETERMINISTIC` in neutral style with gear icon (`Settings`) and uppercase typography.
     - **Main Narrative Insight Row:**
       - Circular icon badge with soft light-blue tint and 3 rounded vertical bars.
       - Bold, prominent narrative text: `"Fleet utilization is at 4% across the period, with 1 trips covering 0 km. The busiest unit logged 1 trips."`
     - **Divider:** Subtle thin divider separating the narrative from the recommendations.
     - **Recommended Actions Section:**
       - Section label with list icon and uppercase tracking: `RECOMMENDED ACTIONS`.
       - Numbered action items with soft-blue circular markers (`1`, `2`) and clean, scan-friendly typography:
         1. `Raise utilization by redistributing workload toward the idle units.`
         2. `No idle assets detected; continue monitoring low-utilization vehicles.`
     - **Footer / Date Row:** Small calendar icon + `Analyzed for 2026-09-01 — 2026-09-05` in muted blue-gray text.
- **Verification & Quality:**
  - Verified with `npm run lint:ci` (0 errors, 0 warnings).
  - Verified with full Vitest suite (`539/539 tests passing across 51 test suites`).
