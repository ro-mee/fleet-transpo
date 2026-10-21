# Fuel estimates polish implementation plan

> Execute inline in the current checkout. The fuel changes under review are uncommitted alongside unrelated work; preserve that work and leave the result uncommitted for review.

**Goal:** Make fuel estimates easier to interpret, preserve missing daily costs, reject impossible dates, and keep paged exports ordered consistently.

**Approved design:** The user approved the focused polish on 2026-10-20. The findings and scope are recorded in `Capstone/02 - Features/Fuel.md` under the review of that date. This approval covers implementation; no further design approval is required.

**Architecture:** Keep the existing estimates page and read-only API. Preserve saved trip estimates, receipt eligibility, measured-efficiency gates, permissions and reference-price policy. Reuse the current shared components and the neighboring Fuel Analytics accessible chart-table pattern.

**Tech stack:** Next.js App Router, React Query, Recharts, PostgreSQL, Vitest.

## Constraints

- No new dependencies, schema changes, data writes or authentication changes.
- Keep all text UTF-8 and use the existing semantic styles and Manila dates.
- Limit production changes to `src/app/api/fuel/estimates/route.js` and `src/app/(dashboard)/fuel/estimates/page.js`.
- Browser access currently redirects to sign-in. Report authenticated acceptance separately from automated or fixture checks.

## Task 1: Correct the read-only API contract

Files: `src/app/api/fuel/estimates/route.js` and its existing `route.test.js`.

- [x] Add regressions: February 30/April 31 return 400 before database access; a real leap day is accepted; the emitted row query orders equal completion timestamps by `trip_id`; the daily response distinguishes null cost from genuine zero and includes `priced_trips`.
- [x] Run `npx vitest run src/app/api/fuel/estimates/route.test.js` and confirm the new checks fail for those defects.
- [x] Validate calendar days by round-tripping their UTC ISO day; order by `t.end_time DESC, t.trip_id DESC`; return SQL `SUM` as null when there is no cost and add `COUNT(t.estimated_fuel_cost)::int AS priced_trips` to the daily series.
- [x] Run that suite again and confirm it passes.

## Task 2: Clarify and polish the estimates screen

Files: `src/app/(dashboard)/fuel/estimates/page.js` and its existing `page.test.js`.

- [x] Add regressions for null-vs-zero chart normalization and an accessible daily data table with priced coverage. Update the existing daily fixture with its priced count.
- [x] Run the page suite and confirm the new data/display checks fail before implementation.
- [x] Preserve null costs in `dailyChartData`; show daily priced coverage and explain unavailable/partial days. Follow Fuel Analytics with a screen-reader table outside the hidden chart wrapper.
- [x] Correct the efficiency explanation to kilometres divided by litres. Label it a fleet-wide period reference that ignores region/vehicle filters.
- [x] Use a three-column KPI grid at desktop widths, wrapping header controls at narrow widths, tabular data and clear comparison explanations. Keep the existing comparison columns and calculation direction.
- [x] Run the page suite again and confirm it passes.

## Task 3: Verify and document

- [x] Run focused estimates suites and the surrounding fuel/report/distance suites.
- [x] Run strict ESLint on the four touched source/test files, `verify:encoding`, and `git diff --check`.
- [x] Review the rendered screen if authenticated access is available; otherwise verify a synthetic real-component fixture and clearly record its limits.
- [x] Review the incremental changes for scope and missing-value errors. Update Fuel.md and SYSTEM.md with changes, test results, and remaining acceptance limits.
