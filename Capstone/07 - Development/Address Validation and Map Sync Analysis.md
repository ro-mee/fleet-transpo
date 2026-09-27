---
type: analysis
date: 2026-09-27
tags: [address, maps, validation]
---

# Address validation and map synchronization

Analysis requested for the driver residential/emergency-contact address form. This records findings and proposed work. The **Implemented — task #29** section records the original map-centering change. The later **Implemented — address validation + explicit map search** section below supersedes its browser-key lookup behavior and records what is now live.

## Verified current behavior

- `address-form-dialog.jsx` passes latitude, longitude and an onChange callback to `address-pin-map.jsx`; it does not pass address text or a geocoding result. Without a pin the map opens at the Philippines default center. Its `SyncView` resets to that view when a pin is cleared. **The last three clauses were true when this was written and changed on 2026-09-27 — see Implemented, below.**
- `structured.js` clears the coordinates when address details or the geographic selection change. This prevents saving a changed address with its previous pin, but no replacement lookup runs.
- `validate-structured.js` derives the administrative hierarchy from the PSGC barangay code. It checks required fields and coordinate pairing/ranges, not whether the street/house exists or whether the point belongs to that address. It explicitly saves `provider: manual`, `verified: false`.
- ZIP validation is four-digit format only. The screenshot pairs Caloocan with 4122; the official PHLPost ZIP locator lists 4122 for Indang, Cavite. No replacement ZIP was inferred for the specific home.
- The old address search/geocode routes and provider layer were removed on 2026-09-25. Granting provider access alone does not connect this form to geocoding.

## Live provider check, 2026-09-27

Ran the existing read-only diagnostic with a public landmark, not the personal address: `node scripts/check-address-provider.mjs 'Caloocan City Hall, Philippines'`.

| Request | Result |
|---|---|
| Server key: routing | HTTP 200 |
| Server key: search | HTTP 403, "You are not allowed to access this endpoint" |
| Server key: geocode | HTTP 403, same error |
| Browser key: search | HTTP 200 |
| Browser key: search with configured localhost Origin | HTTP 200 |

The initial sandbox run had transport failures and provided no authorization evidence. The network-enabled retry above is the meaningful result. The current server key is refused by these forward endpoints while the browser key can search. Check the products/permissions/restrictions of the key configured as `TOMTOM_API_KEY`, retaining its routing access. Structured geocoding and reverse geocoding were not re-probed in this run. The script's broad claim that the entire Search family is unavailable is not established by these results; earlier notes recorded reverse geocoding success.

## Proposed implementation sequence

**Status update (2026-09-27):** Items 2, 3 and 6 have been implemented in the later section below. Item 1 remains an operator dependency: the server TomTom key still needs Search permission. Items 4, 5 and 7 remain future work where they require provider-to-PSGC evidence or persistent match provenance; the new lookup is deliberately only a viewport aid, and the manual point stays unverified.

1. **High / pending:** enable the required forward geocoding access for the server key and re-run the diagnostic. Measure actual result coverage before promising house-level validation.
2. **High / pending:** add an authenticated server lookup for the current structured address, deriving the geography from PSGC. Return explicit outcomes for candidates, no match, ambiguity, mismatch and provider unavailable. Keep keys server-side; do not collapse a 403/timeout into an empty result.
3. **High / pending:** add a `Find on map` action first. Show candidate address, result precision and suggested marker; move the viewport to the result. Keep the suggested point separate from the operator-confirmed pin. Add debounced automatic lookup after this works, rejecting stale responses when the address changes.
4. **High / pending:** retain the PSGC selection as administrative authority. TomTom's `municipalitySubdivision` must not be assumed to be a barangay (the existing measurements disproved that mapping). A city mismatch must be resolved before a result can be accepted. Missing provider barangay data means unknown, not a verified match.
5. **High / pending:** moving a pin invalidates its prior match confirmation. Reverse lookup can propose nearby address details and expose conflicts, but must not silently overwrite the house number, unit or PSGC code. Exact barangay containment would require a trusted boundary dataset; PSGC names alone cannot establish it.
6. **High / pending:** validate ZIP-to-locality compatibility against a maintained PHLPost-derived reference. Support multiple postal areas per city; do not invent one city-wide ZIP. Treat incomplete reference coverage as unknown.
7. **High / pending:** distinguish `address matched`, `street/area only`, `manual pin`, `no match`, `needs recheck` and `service unavailable` in the proposed UI/model. A map match supports existence in the provider's index; it does not establish residency or deliverability. A score is textual similarity, not proof of a doorstep. Any persistent provenance changes need a separately reviewed migration using the repository runner.

On save, the server must validate that accepted evidence belongs to the current address and point (server re-resolution or server-held/signed evidence bound to the input). Never accept a client-sent verification boolean. Existing manual saves can remain explicitly unverified; claiming a verified address requires sufficient matching evidence.

## Implemented — 2026-09-27 (task #29: centre the map on the entered address)

Task #29, built from step 3 below but **not in the order step 3 sets out**. Recorded here rather than folded into the list above, so the divergence is visible instead of the plan quietly rewriting itself.

**What it does.** When the operator picks a barangay, the pin map moves off the country view and frames that address. Nothing else about the form changes.

**Which lookup — the browser key, deliberately.** `TOMTOM_API_KEY` is still refused by Search (`403`, re-measured 2026-09-27), and that remains a portal permission grant rather than a code change. The implementation uses `NEXT_PUBLIC_TOMTOM_API_KEY` against `/search/2/search` **from the browser**, so it works today with no grant. Two things make that a choice rather than a workaround:

- It exposes no new secret. `rasterTileUrl()` already embeds that same key in a URL the browser fetches on every map render (`address-pin-map.jsx`), so the key is in the bundle and always has been.
- It is what `scripts/check-address-provider.mjs:243` prescribes — "the browser key belongs in the browser, and `TOMTOM_API_KEY` is what every server-side call uses." This is the former. The server key is untouched, and step 2 below is still the better long-term shape.

**The cost, named.** The query is a real person's address and it now goes to TomTom **from the client** rather than through our server. The map tiles already tell TomTom which area is being viewed; this tells it the street and house number. That is a genuine privacy delta and the reason `searchUrl` carries a comment forbidding a second, server-side use of the public key.

**Where it diverges from step 3.** Step 3 says add an explicit `Find on map` action **first** and make the lookup automatic only once that works. This went straight to automatic-on-barangay-pick. The consequence is that step 3's "rejecting stale responses" is not optional here and is implemented: the trigger is a discrete selection rather than typing, so there is no debouncing, but two picks in quick succession do overlap and each lookup aborts the one before it.

**What it deliberately does not do.** The lookup result is a **viewport** and nothing else. It is never written to the form's `latitude`/`longitude`, never stored on the row, and never sent to the server. The pin stays something a person clicked, saved `provider = 'manual'`, `verified = false`. None of steps 2 and 4-7 — matching the street to the barangay, ZIP-to-locality, reverse lookup, provenance — is attempted, and nothing here should be mistaken for that work: a centred viewport is not evidence that a doorstep exists.

**How it reports itself.** `empty` (the provider answered, no match) and `unavailable` (refused, timed out, offline) are separate states and never collapsed, per step 2's requirement. Both say so in a line under the map; the line shown on success exists specifically to say that a map which moved itself is not a placed pin. No failure path logs the query or the address.

**Verified how — and what that word does and does not cover.** Three separate things, with different strengths, and the difference matters:

1. **Unit-tested.** `centreFromSearch` is pure and asserted (position, viewport-derived zoom, both clamp ends, no-viewport fallback, and every shape of no-answer), as is `searchUrl`'s encoding, its `countrySet`/`limit`, and — the security assertion — that it carries the public key and never the server key. 23 tests, all green.
2. **Observed in the browser, 2026-09-27, on `/drivers/60/edit`.** Picking a barangay centred the map on the address with no pin placed; changing the city returned it to the country view; reopening an address that already had a saved pin left the view on the pin. Four checks, all as intended.
3. **Now unit-tested — but only after the browser pass above.** `SyncView`'s ordering was originally backed by those four observations and nothing else. It could not be tested where it lived: `address-pin-map.jsx` imports Leaflet at module scope, and this repo cannot render React in a test. The decision has since been extracted to `src/lib/address/pin-view.js` as `planViewMove`, a pure function of `{ hasPin, hadPin, lastKey, centre }`, with `pin-view.test.js` asserting the ordering that matters: a placed pin owns the view and is never overruled by a lookup, clearing a pin returns to the centre rather than the country, a withdrawn centre returns to the country, and an identical centre arriving again does not re-set the view. `SyncView` now performs only the `setView` call and holds the two refs. `PIN_ZOOM` is asserted in that file as the literal `16` which `tomtom.js` restates as `LOOKUP_MAX_ZOOM`, so the coupling is checked from both ends and neither side can drift silently. 13 tests.
   **The four observations in point 2 predate this refactor**, so on their own they describe the component as it was. The decision is now tested, and the wiring between it and `setView` was re-checked in the browser afterwards: picking a barangay centred the map and placed no pin, reopening an address with a saved pin left the view on the pin, and changing the city returned the country view. All three matched the pre-refactor behaviour, which is what makes this a behaviour-preserving move rather than an assumption that it was one.
4. **Also unverified.** The `unavailable` branch was never forced in a real browser (blocking `api.tomtom.com` in DevTools), and the "one request per barangay pick, superseded request cancelled" claim was never confirmed at the network level. Both branches are unit-tested on the parsing side, but neither has been seen failing end to end.

## Required verification for implementation

Cover exact versus street-only matches, ambiguous/no results, wrong city/ZIP, provider 403/429/timeouts, an old response arriving after a newer edit, pin movement invalidating confirmation, forged verification payloads, and save/reopen retaining both fields and point. Browser-check both residential and emergency-contact forms. No implementation tests or browser verification were performed for this analysis; application code, credentials and database were unchanged.

## Sources

- [PHLPost ZIP Code Locator](https://phlpost.gov.ph/zip-code-locator/)
- [TomTom Structured Geocode](https://docs.tomtom.com/geocoding-api/documentation/tomtom-maps/v1/structured-geocode): result types, position, viewport and textual matchConfidence.
- [[ADR-015 Address Owns Administration, Location Owns The Point]], [[addresses]], [[Bugs]] (2026-09-25 map synchronization analysis).

## Implemented — address validation + explicit map search (2026-09-27)

This section supersedes the task #29 browser-key lookup described above. The shared structured-address form is used by drivers and other registry-backed address surfaces, so the ZIP consistency check is enforced both in that form and by the server resolver for every structured-address save.

**Map search is explicit and server-side.** The form sends the full address to `POST /api/address/lookup` only after an operator presses **Find on map**. The route requires `drivers:update`, limits requests to 10/minute per employee, caps the query at 1,000 characters, and calls TomTom with the server key. The browser key is no longer used for address search. The route distinguishes `found`, `ambiguous`, `empty` and `unavailable`, returns bounded candidate metadata, and does not log the query. The UI rejects stale results, displays multiple candidates for explicit selection, and uses any selection to move the map only. It never places or saves a pin, marks an address verified, or treats TomTom's text match score as proof. Until Search is enabled for the server key, the UI reports the provider as unavailable; the existing map tiles continue to use their configured public key.

**Pin placement is deliberate.** Map clicks and the keyboard-accessible **Place pin at center** control require zoom level 15 or closer. The operator must still place the pin manually. Changing a location-bearing address detail, ZIP, or geographic selection clears the existing pin; changing only delivery notes or a landmark keeps it. This prevents a pin from silently following a text-only edit while preserving it for non-location notes.

**ZIP validation is evidence-limited.** Migration `135_phlpost_postal_codes.sql` stores a normalized snapshot of PHLPost's published ZIP locator captured 2026-09-27: 958 unique valid locality/ZIP rows. A covered locality with a ZIP absent from its listed set is rejected with the available code(s); an uncovered locality or an unavailable lookup is `unknown` and does not block saving. Live DB verification found Indang/Cavite → 4122 and no Caloocan row. Therefore the screenshot's Caloocan + 4122 combination remains unknown; the system does not infer that 4122 is correct for that address or invent a replacement. The private reference table has RLS enabled and no `anon`/`authenticated` privileges.

**Verification.** Focused address, driver, service and API tests passed (214 tests across 13 files); full Vitest passed (244 files / 3,069 tests); repository-wide `npm run lint:ci` passed with zero warnings; and `npm run build` compiled successfully, type-checked, and generated all 214 static pages. Migration 135 was applied through `npm run db:up`; `db:status` reported 135 applied, 0 pending, 0 changed. `db:contract` reported 0 violations, and `verify:anon` explicitly refused the new table (HTTP 401 / SQLSTATE 42501). The read-only live query confirmed 958 rows, Indang/Cavite → 4122, and no Caloocan rows. Browser verification was unavailable in this run. The server-key Search permission must be enabled and rechecked before live map lookup can return candidates.
