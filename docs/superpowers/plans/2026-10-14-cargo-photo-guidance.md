# Cargo Photo Guidance Implementation Plan

**Goal:** apply the user-approved expandable Pre-Trip mockup and image-aware Cargo item presentation without activating providers.

**Architecture:** one native ReferencePhotoGuide holds disclosure/image loading/failure only. Inspection keeps existing answer/submit/hold logic. CargoItemReceiptRow keeps source quantities, blank actual counts, issue reporting and optional authenticated source image lookup. Exact tomato/potato display-name aliases select labeled illustrations; unknown names use generic packaging, never guessed source photos.

**Stack:** installed Expo54/React Native0.81, shared native clay controls, Vitest executable component tests. Preserve existing dirty checkout; no commit/deployment/migration/provider changes.

User approved the generated Pre-Trip design and requested it on Cargo items, then explicitly chose "Use labeled illustrative images for now". All five local generated assets are labeled illustrations; actual source item references remain policy-disabled. Missing real photos never become evidence or approval.

## Steps

- [x] Test shared guide disclosure, image loading/failure/source changes, readable fallback and no answer/count mutation. Test image-aware pickup/delivery rows retaining distinct quantities and unfilled actual input.
- [x] Add `mobile/components/ReferencePhotoGuide.jsx` with `{source, subject, caption, children}`; local expansion/loading state, native Image, accessible native disclosure control, fixed aspect ratio, no mutation callback. No source shows honest fallback and textual guide.
- [x] Apply guide in shared `mobile/app/(app)/inspection.js` for confirmed Cargo Pre-Trip only. Retain Passenger/Pre-Shift, existing answer IDs, fail remarks, cabin acknowledgment, progress, coachmarks and securement blocking.
- [x] Improve existing `mobile/components/cargo/CargoItemReceiptRow.jsx` header, image preview and actual-count instruction; preserve resolved source imageUrl/physical fields/issues/readonly. Exact tomato/potato aliases select labeled art only; unknown names use generic packages. Never hardcode operational quantities or infer source images.
- [x] Run actual component/interactions and all mobile regressions, strict scoped lint, encoding/whitespace and Android export. Record device/approved-photo limits.
- [x] Update relevant vault notes and SYSTEM.md, including live-integration-disabled scope and asset provenance. No fake Fleet approval, sample source facts or live image-policy activation.

## Acceptance

Disclosure is independent from answers; each image is explicitly reference-only; actual counts never prefill; reference failure leaves text and counts usable; source change clears old failure/loading state; images fit light/dark/large-text layouts. Missing approved source images remain unavailable, not replaced by another shipment's photo. Native screenshot/keyboard/screen-reader acceptance requires actual device tooling.

## Final verification

920 tests/71 mobile files passed; strict scoped lint passed. Final Android export passed (1,465 modules,5.69MB,87 assets), retained in mobile/.expo/cargo-photo-export-20261014. Independent source and all-five-image review found no important issue; reviewer test run was blocked before collection by sandbox EPERM and is not counted. Tests first demonstrated missing item disclosure, missing inspection guide, absent tomato illustration and incorrect non-package instruction. No runtime/native screenshot, iOS/web export, approved safety/source-photo acceptance, activation, live write, migration, commit or deployment. Generated asset prompts/provenance saved in mobile/assets/images/cargo-guides/README.md. Vault/SYSTEM synchronized.
