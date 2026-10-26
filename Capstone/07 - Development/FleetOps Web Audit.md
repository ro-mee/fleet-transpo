---
type: audit
status: source-remediated-acceptance-pending
date: 2026-10-26
tags: [audit, web, scope, qa]
related: ["[[UI UX Audit - Web]]", "[[Security Audit]]", "[[Travel Expenses]]", "[[Reports]]", "[[System Boundaries]]"]
---

# FleetOps Web Audit

## Current scope - 2026-10-26

Audit FleetOps as a standalone web application. Improve FleetOps-owned behavior and workflows without adding requirements belonging to another project or subsystem. This scope replaces broader integration requirements in the current web audit backlog; older dated audits remain historical records.

**Included:** Super Admin, Admin, Fleet Manager, Dispatcher, Mechanic, and other FleetOps web roles; their dashboards, internal modules, create/read/update/delete operations, interface usability, database operations, permissions, reports, and internal workflows. Check both permitted and blocked actions against each role's intended permissions.

**Excluded:** PMS/Booking integration, POS integration, external API gateways, partner-system callbacks, and any finding requiring development, configuration, or access to a separate external subsystem. Do not count these as missing FleetOps features or unresolved standalone web defects.

For mixed workflows, retain only issues FleetOps can reproduce and resolve independently. Displaying a failed request as a successful zero result is an internal issue; connecting or repairing the external provider is outside this audit. Inspection follow-up covers web review, ownership, and escalation; changes to the separate mobile application are outside this web audit.

## Finding labels

- **Confirmed source-code defect:** Current source evidence identifies behavior violating an intended FleetOps requirement. Record the file/location, expected and actual behavior, affected roles, and verification evidence. State separately whether runtime reproduction was completed.
- **Reported defect - verification pending:** Reported behavior has not yet been verified against current source. Priority expresses urgency, not confirmation.
- **Recommended enhancement:** An improvement to intended FleetOps functionality, not a confirmed bug. An absent feature outside the intended scope is not a bug.
- **QA coverage:** A validation task. Record any confirmed failures as separate findings with evidence.

Mark an item fixed only after verifying its correction. Check existing fixes before opening a duplicate defect.

## Verified findings and completed changes - 2026-10-26

The earlier scope-only update did not verify the reports. The owner requested source verification and implementation; the entries below now describe the actual checked code and resulting changes. Priorities are unchanged. Source corrections are not a claim that production has been deployed or that every role has completed manual acceptance.

| Priority | Module | Verified finding / resulting improvement | Classification and outcome |
|---|---|---|---|
| P0 | Expenses | Expense employee/reviewer joins and company-card employee/assigner joins selected complete employee rows. Responses now select only employee ID and first/last names; the expense driver join also drops unrelated driver fields. | Confirmed source-code defect; corrected and verified with regression checks and live read-only SQL. |
| P1 | Expenses | Backend ignored sort fields; the page supplied unsupported table search/sort/pagination props and exported one default 10-row page. Corrected shared-table wiring, allowlisted stable sorting, pagination validation and complete filtered export with currency. Incomplete exports fail instead of reporting partial success. | Confirmed source-code defects; corrected with API, service and rendered-page checks. |
| P1 | Financial Reports | Financial totals included pending/rejected fuel and omitted approved travel expenses. Financial Summary, Fleet Cost, Analytics, CSV/XLSX and AI summaries now reconcile eligible fuel, recorded maintenance and approved PHP expenses; categories, other-currency exclusions and unallocated spend remain visible. | Confirmed calculation defects corrected; categorization/reconciliation enhancements implemented. See [[Reports]]. |
| P1 | Vehicle Inspections | Office queue had no way beyond its first 100 records and page-derived counts could understate the backlog. Added exact full-queue counts, 25-row paging, oldest untracked findings first, mechanic ownership, next actions and direct work-order links. High-severity copy prompts immediate dispatch review. | Confirmed access/count defects corrected; accountability and manual escalation improvements implemented. Automatic escalation timers are not introduced. |
| P1 | AI Dashboard | Landing page ignored query errors and rendered zero metrics/empty results on failure. Added separate loading, failure/retry and successful-empty states; unavailable metrics stay unknown. Management no longer receives a denied maintenance request/link. Copy identifies advisory suggestions and service schedules honestly. | Confirmed source-code defects; corrected and checked with rendered-state tests and an isolated browser fixture. |
| P1 | Fleet Assignments / UVVRP | Assignment badges used UTC while counts used Manila. UVVRP weekdays, forecasts, expiry, date-scoped approvals and substitute matching mixed UTC/host dates. Applied Philippine-day helpers and explicit date-only API values; fixed future open-ended substitutes appearing active too early. | Confirmed date defects; corrected. Seventy focused checks pass in both UTC and Asia/Manila. See [[Assignments]] and [[UVVRP Number Coding]]. |
| P2 | Maintenance Web UI | Staff return-to-repair forms omitted the server-required reason, and saved repair findings were absent from staff review. Both forms now submit required reasons and show diagnosis, parts, labor, performer and handover evidence. Work-order links open a precisely filtered register. | Confirmed blocked workflow and review gaps corrected; presentation enhanced. Existing mechanic scoping and independent approval rules remain enforced. |
| P2 | Dashboard UX | Expense failures looked empty, review controls appeared to read-only users, and the expense module lacked navigation. Added shared failure/retry/loading states, permission-aware decisions and guarded sidebar access for its documented readers. | Confirmed feedback/permission gaps corrected; navigation improved using existing components. |
| P2 | Web Architecture | Dashboard segment contained both loading.js/loading.jsx and error.js/error.jsx. Removed the duplicate JSX files and retained the more complete JS boundaries with retry, reload and reference support. | Confirmed duplicate convention files removed; existing canonical behavior retained. |
| P2 | QA & Security | Expanded positive and negative role checks, expense/card reads, review and repair handlers, date boundaries, report calculations, downloaded workbook contents and cache compatibility. All 339 exported API methods pass the route-guard audit. | QA coverage expanded; authenticated end-to-end acceptance for every web role remains pending, not a completed blanket certification. |

## Source evidence and verification

- Expenses: `src/app/api/expenses/route.js`, `src/services/expenses.service.js`, `src/app/(dashboard)/expenses/page.js`, company-card routes, and `src/components/expenses/ExpenseVerificationModal.jsx`. New checks cover all seven roles, sorting (including malicious and inherited object keys), filtered pagination/export, failed later export pages, private receipt parameters and read-only review controls. The receipt/card routes now await Next.js route parameters.
- Financial: `src/lib/reports/operational-reports.js`, `remaining-workbooks.js` and their page/export/narrative consumers. Final focused run: 132 passed across 15 suites; nine opt-in live database tests skipped. CSV is checked through the actual download handler; workbooks are decoded with ExcelJS. Financial and Analytics narrative cache scope is versioned so old totals are not described as current. Source review found and corrected omitted Analytics CSV columns and stale Analytics cache handling before closeout.
- Inspections/maintenance: `src/lib/inspections/problem-queue.js`, problem/register APIs, office pages, both staff forms and shared `repair-evidence.jsx`. Nineteen focused files / 195 tests passed, including actual query callbacks and form handlers; strict changed-file lint passed. No new acknowledgment storage, automatic timer or changed grounding policy is claimed.
- Dates: assignment/substitute routes, `assignment-coverage.js`, shared UVVRP policy/service, conflict checks and the two web pages. Seventy checks passed in both supported test time zones; changed-source lint passed.
- Live read-only expense/card check: actual current SQL ran inside `BEGIN READ ONLY` followed by `ROLLBACK`; safe identity keys, sort variants and promised history parameters were verified without printing private records or credentials. This checks SQL/response shaping with an injected test identity, not an authenticated HTTP session. No live business data was changed.
- Browser: actual components rendered in an isolated fixture with synthetic data and no FleetOps connection. Checked AI failure/retry at desktop size, Expenses at 360 px with contained horizontal table scrolling, dark inspection follow-up and paging at 360 px, and saved repair evidence at desktop size. This is visual/layout evidence, not live authenticated workflow acceptance.

## Remaining acceptance and boundaries

Deploying these changes and manual acceptance with authenticated web roles are separate from source completion. Native Excel visual acceptance and opt-in database fixture tests were not performed. Other expense currencies are listed separately without inventing exchange rates. Recorded maintenance costs retain the existing all-status scope and are labeled accordingly. Expense categories exclude Fuel, but a mislabeled physical receipt cannot be deduplicated across ledgers without shared receipt identity; Finance review remains responsible for that case.

External-system work remains excluded. A missing external feature is not recorded as a FleetOps bug. Unrelated mobile/GPS work already present in the checkout was preserved.

## Final integrated verification - 2026-10-26

- Full final suite: **566 files passed; 6,276 tests passed, 114 skipped across 12 opt-in database files; zero failures**. The first restricted run had four host-permission failures and one navigation mismatch while files were changing. The completed permitted rerun above is the final result; no tests were disabled or weakened.
- Production build: **passed** using Next.js 16.2.11 webpack mode, including all 248 static pages. The pre-existing dynamic dependency warning in `src/lib/auth/geoip.js` remains. Default Turbopack hit a local generated junction collision; the restricted webpack attempt hit output-folder permissions. The permitted webpack run completed without changing application configuration.
- Route guard audit: **339/339** exported methods passed. Offline migration gate: **166** files valid; no migration added or applied.
- Strict changed-file lint and whitespace checks passed. UTF-8 checks cover the tracked files, with separate strict decoding for new task files.
- Read-only live expense/card SQL and isolated synthetic browser checks are described above. No deployment, commit, production business-data change or external-system connection was performed.

**Commit-review corrections (2026-10-26):** An independent review pass over the finished tree found no dropped role guards, no permission regression and no SQL-injection surface, and applied these smallest-complete corrections before committing: the expense register and review modal normalize a NULL/padded row currency through `formatCurrency` instead of letting `Intl` throw during render; expense review/receipt service calls moved to `apiFetch` so expired sessions hit the shared dispatch; an empty no-op guard in the card-assignments route was removed; the expense-analytics route test stubs and asserts the bare `ok` envelope actually produced; the executive "Fuel and maintenance" quick-link became "Fuel, maintenance and expenses" and adds approved expense cost so it reconciles with the financial-report total beside it; the financial narrative schema gate and fixture moved from the vestigial `tripCost` to `expenseCost` and the dead `tripCost` key plus two never-fireable `??` fallbacks were removed; the unreachable workbook `costMonthly` fallback (false zero expense series) is gone and the three workbook empty-state merge ranges were widened for the added columns; the cost page skeleton/empty state matches the 5-stat/7-column layout and the unallocated row gained a stable React key; the maintenance register hides its register-wide KPI strip while a work-order deep link scopes the page and the staff view dialog no longer repeats the repair performer; the substitute-schedule PATCH re-normalizes unchanged dates to calendar-day keys with a regression test (previously a notes-only edit could shift an unchanged schedule date one day back); `/api/uvvrp` rejects non-`YYYY-MM-DD` date params with 400; `calendar-service.test.js` was renamed `uvvrp.service.calendar.test.js`. All evidence was re-verified post-edit: expenses 27, reports/AI 76, maintenance 63, UVVRP/scheduling 79, full suite 6,276 passed / 114 skipped.

**Owner continuation preference:** If unfinished authorized work reaches 5% remaining in the five-hour allowance, save the exact stopping point and schedule one same-chat continuation after the usage tool's reported reset. The closeout check reported 98% remaining; this remediation completed without needing a reset automation. The saved implementation plan records the continuation rule.
