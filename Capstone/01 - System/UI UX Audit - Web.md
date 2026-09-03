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

## Known remaining gaps (post-waves)

- Per-device web session history isn't tracked (security page explains honestly).
- Email delivery (reset links, notification email/push channels) still not implemented — UI copy no longer claims otherwise.
- Trips list lacks a Guest column because `TRIPS_LIST_SELECT` doesn't expose request/guest fields (backend change required).
- Dispatch reassign conflicts arrive as plain strings from `PUT /api/dispatch/[id]` (no structured `conflicts[]`) — inline rendering handles both shapes today.
