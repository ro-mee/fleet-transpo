# Fuel Estimates and Reference Prices UI Refinement

**Date:** 2026-10-09  
**Status:** Approved visual direction  
**Surface mode:** Operate

## Goal

Make Fuel Estimates and Reference Prices feel more modern, premium, and minimalist while keeping them easy to scan during daily fleet work. Follow the existing FleetOps dashboard language: Inter typography, neutral surfaces, semantic status colors, clear focus states, and restrained motion.

## Users and tasks

- Fleet managers and management review completed-trip fuel estimates and compare results across dates, regions, and vehicles.
- Authorized fuel staff set the estimate region, import weekly DOE prices, record a manually verified price, and inspect source-backed price history.

## Approved direction

Use a task-first layout rather than adding a new visual theme or putting the workflows behind tabs. Reduce visual noise through spacing, type hierarchy, and consistent data alignment. Keep each action visible in the page flow.

## Component composition and data flow

Reuse the shared `HeroHeader`, `StatGrid`/`StatCard`, `Card`, `Input`, `Label`, `Button`, `EmptyState`, and `QueryErrorBanner` patterns where they fit. Keep semantic HTML tables for comparable rows and retain the existing source-preview dialog. The estimate page continues to read through its existing estimates query; filters only change the applied query values. The price page continues to use its existing read query and region, manual-price, and PDF-import mutations. Permission checks remain the source of truth for which controls are shown.

Query failures remain visible with a retry path, mutation failures remain beside their form, and successful saves/imports retain their in-page status feedback. Empty history and an empty estimate range continue to explain what the user is seeing.

### Fuel Estimates

1. Open with the existing four summary measures: estimated cost, liters, completed trips, and average cost per trip. Keep them compact and data-led, with tabular figures.
2. Place the labeled date, region, and vehicle filters together immediately above the results. Preserve the existing Apply behavior.
3. Present completed trips in a clean comparison table. Keep trip navigation and the locked price basis visible; align numeric values for scanning and retain the reason when an estimate is unavailable.
4. Keep loading, query error, and no-results states clear and truthful.

### Reference Prices

1. Use a page header consistent with the Fuel Estimates screen while preserving the return link and explanatory context.
2. Show the current estimate region and its edit control in a compact region panel, including a clear state when no region is selected.
3. Lead with the weekly DOE PDF import as the primary entry path. Keep the existing PDF URL and optional week-label fields, action feedback, and import result behavior.
4. Keep manually recording a verified price available as a secondary, clearly labeled form. Preserve its product, region, price, prior-price, Manila-time, source URL, and publication-check fields.
5. Give verified history a readable comparison table with product and region, PHP per liter, effectivity, verifier, lifecycle, and source preview/open actions.

## Interaction and data contracts

The redesign keeps the existing routes, query parameters, API calls, request payloads, authorization checks, source preview, and price/estimate meaning. The interface must continue to distinguish locked trip estimates from actual receipt prices and must not invent a source-validity period or an unavailable price.

## Responsive and accessible behavior

- Stack sections and filters when there is not enough width; keep table content horizontally scrollable on narrow screens.
- Keep form labels visible, keyboard access intact, and focus states easy to see.
- Use text with color for lifecycle and feedback states; do not rely on color alone.
- Keep controls comfortable to use on touch screens and respect reduced-motion preferences.

## Verification

- Review both pages at a desktop width and a narrow mobile width.
- Confirm the DOE import remains the most prominent price-entry path and the manual form remains discoverable.
- Check the filter controls, trip and source links, preview dialog, loading/error/empty states, and keyboard focus.
- Run lint for the touched UI files and inspect the final diff. No API, database, or calculation changes are part of this design.
