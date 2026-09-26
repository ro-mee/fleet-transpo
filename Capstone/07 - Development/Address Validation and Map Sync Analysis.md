---
type: analysis
date: 2026-09-27
tags: [address, maps, validation]
---

# Address validation and map synchronization

Analysis requested for the driver residential/emergency-contact address form. This records findings and proposed work, not implemented behavior.

## Verified current behavior

- `address-form-dialog.jsx` passes latitude, longitude and an onChange callback to `address-pin-map.jsx`; it does not pass address text or a geocoding result. Without a pin the map opens at the Philippines default center. Its `SyncView` resets to that view when a pin is cleared.
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

1. **High / pending:** enable the required forward geocoding access for the server key and re-run the diagnostic. Measure actual result coverage before promising house-level validation.
2. **High / pending:** add an authenticated server lookup for the current structured address, deriving the geography from PSGC. Return explicit outcomes for candidates, no match, ambiguity, mismatch and provider unavailable. Keep keys server-side; do not collapse a 403/timeout into an empty result.
3. **High / pending:** add a `Find on map` action first. Show candidate address, result precision and suggested marker; move the viewport to the result. Keep the suggested point separate from the operator-confirmed pin. Add debounced automatic lookup after this works, rejecting stale responses when the address changes.
4. **High / pending:** retain the PSGC selection as administrative authority. TomTom's `municipalitySubdivision` must not be assumed to be a barangay (the existing measurements disproved that mapping). A city mismatch must be resolved before a result can be accepted. Missing provider barangay data means unknown, not a verified match.
5. **High / pending:** moving a pin invalidates its prior match confirmation. Reverse lookup can propose nearby address details and expose conflicts, but must not silently overwrite the house number, unit or PSGC code. Exact barangay containment would require a trusted boundary dataset; PSGC names alone cannot establish it.
6. **High / pending:** validate ZIP-to-locality compatibility against a maintained PHLPost-derived reference. Support multiple postal areas per city; do not invent one city-wide ZIP. Treat incomplete reference coverage as unknown.
7. **High / pending:** distinguish `address matched`, `street/area only`, `manual pin`, `no match`, `needs recheck` and `service unavailable` in the proposed UI/model. A map match supports existence in the provider's index; it does not establish residency or deliverability. A score is textual similarity, not proof of a doorstep. Any persistent provenance changes need a separately reviewed migration using the repository runner.

On save, the server must validate that accepted evidence belongs to the current address and point (server re-resolution or server-held/signed evidence bound to the input). Never accept a client-sent verification boolean. Existing manual saves can remain explicitly unverified; claiming a verified address requires sufficient matching evidence.

## Required verification for implementation

Cover exact versus street-only matches, ambiguous/no results, wrong city/ZIP, provider 403/429/timeouts, an old response arriving after a newer edit, pin movement invalidating confirmation, forged verification payloads, and save/reopen retaining both fields and point. Browser-check both residential and emergency-contact forms. No implementation tests or browser verification were performed for this analysis; application code, credentials and database were unchanged.

## Sources

- [PHLPost ZIP Code Locator](https://phlpost.gov.ph/zip-code-locator/)
- [TomTom Structured Geocode](https://docs.tomtom.com/geocoding-api/documentation/tomtom-maps/v1/structured-geocode): result types, position, viewport and textual matchConfidence.
- [[ADR-015 Address Owns Administration, Location Owns The Point]], [[addresses]], [[Bugs]] (2026-09-25 map synchronization analysis).
