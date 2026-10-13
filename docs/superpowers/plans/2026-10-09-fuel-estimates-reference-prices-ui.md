# Fuel Estimates and Reference Prices UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Refine the Fuel Estimates and Reference Prices pages into a modern, premium, minimalist task-first workspace while preserving current data and actions.

**Architecture:** Keep the work inside the two existing client pages. Reuse FleetOps shared headers, cards, fields, status and feedback patterns; retain existing React Query requests, form body helpers, API routes, permission checks, and source preview. Finish with the required Fuel vault note and root system note updates.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS v4, TanStack Query, shared Radix UI components, lucide-react.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-10-09-fuel-estimates-reference-prices-design.md`.
- Keep the FleetOps Inter typography, neutral surfaces, semantic status colors, shared radii, keyboard focus styles, and reduced-motion behavior.
- Preserve the existing estimates query/filter contract, fuel price API calls, form payloads, role/permission gates, source preview, and trip links.
- Preserve the distinction between locked trip estimates and actual receipt prices; do not add price-validity claims or invented data.
- Keep tables horizontally scrollable on narrow screens and keep labels visible on all form fields.
- Do not modify API, database, or calculation files. Do not add or run tests for this visual-only request; run scoped lint and visual review instead.

## Files

- Modify `src/app/(dashboard)/fuel/estimates/page.js`: summary, filter, result-table, and feedback presentation.
- Modify `src/app/(dashboard)/fuel/reference-prices/page.js`: header, region, DOE import, manual entry, history, and feedback presentation. The current working file includes in-progress PDF import and preview functionality; preserve it.
- Update `Capstone/02 - Features/Fuel.md`: record the screen hierarchy and preserved workflows after implementation.
- Update `SYSTEM.md`: add a concise dated summary under the existing work history.

## Task 1: Refine Fuel Estimates

**Files:** `src/app/(dashboard)/fuel/estimates/page.js`

- [ ] Keep `estimatesQueryString`, the query key, filter state, and `Apply filters` submit behavior unchanged.
- [ ] Use the approved shared page hierarchy: HeroHeader; a compact four-measure summary for estimated cost, total liters, completed trips, and average cost per trip; then one clear results section.
- [ ] Keep the four existing filter labels (`From`, `To`, `Region`, `Vehicle`) visible and group their fields with the Apply button in a responsive filter row.
- [ ] Refine `EstimateRows` as a semantic comparison table: keep trip links, plate and vehicle name together, align numeric values, retain the locked price and region basis, and keep the unavailable-estimate reason visible.
- [ ] Keep the loading message in stable padded space with `aria-busy`; use `QueryErrorBanner` for query failure and `EmptyState` only for a successful empty result, so an error never looks like zero results.
- [ ] Run scoped ESLint on this page and inspect its diff.

## Task 2: Refine Reference Prices

**Files:** `src/app/(dashboard)/fuel/reference-prices/page.js`

- [ ] Preserve `manualSnapshotBody`, `pdfImportBody`, query keys, mutations, role checks, all existing fields, and the source preview dialog.
- [ ] Use a shared page header while keeping the return path to `/fuel` and the current explanation of how reference prices affect trip estimates.
- [ ] Keep the estimate-region editor in a compact, clear section with a truthful unset state and the existing save feedback.
- [ ] Give the weekly DOE PDF import the strongest entry treatment, keeping the PDF URL and optional week label visible and retaining pending, success, and failure feedback.
- [ ] Keep manual verified-price entry visible as a secondary section. Retain the publication check and all Manila-time, product, region, price, prior-price, announcement, effective-time, and source fields.
- [ ] Refine `ReferencePriceHistory` into a comparison table using `fuel_product`, `region`, `reference_price`, `effective_at`, `verification_method`, `verifier_name` or `verified_by`, `lifecycle`, and `source_url`. Keep Preview and Open source actions keyboard-accessible.
- [ ] Keep loading, query failure/retry, and empty history states distinct, using the shared feedback patterns. Do not show write controls to read-only roles.
- [ ] Run scoped ESLint on this page and inspect its diff.

## Task 3: Sync project documentation

**Files:** `Capstone/02 - Features/Fuel.md`, `SYSTEM.md`

- [ ] Add a dated Fuel note entry describing the two screen hierarchies and confirming that price authority, trip snapshot meaning, permissions, and entry flows remain as documented.
- [ ] Add a short dated `SYSTEM.md` work-history entry linking the Fuel feature note.
- [ ] Check the documentation diff for consistency with the final UI and the approved design.

## Task 4: Bounded UI review

**Files:** both updated page files

- [ ] Inspect one desktop and one narrow-width view of each page. Check the filter row, primary DOE import hierarchy, manual-entry discoverability, tables, and source preview.
- [ ] Check keyboard focus, form labels, page loading/error/empty feedback, and dark/light theme contrast where the app supports both.
- [ ] Fix findings in one pass, then make one final confirmation pass. If authenticated browser access is unavailable, inspect committed visual fixtures and current shared tokens/components, then report that limitation.
- [ ] Run ESLint for the two pages and `git -c core.fsmonitor=false diff --check`; do not run Vitest or other test suites for this visual-only request.

## Self-review

- The estimates page requirements map to Task 1; its live query and data fields remain unchanged.
- The price region, DOE import, manual form, history, source actions, and permission requirements map to Task 2.
- Vault and system documentation requirements map to Task 3.
- Desktop/mobile, keyboard, feedback, theme, and final diff checks map to Task 4.
- No new data names, functions, routes, dependencies, or test cases are introduced by the plan.
