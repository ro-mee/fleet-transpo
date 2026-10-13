# Fuel PDF Adapter Phase 1 — Design (single reference price)

- Date: 2026-10-08
- Status: approved by user (design), awaiting spec review
- Scope: Phase 1 only. Phase 2 (per-company breakdown table) is explicitly out of scope.

## 1. Problem

DOE publishes NCR pump prices as weekly PDF tables (e.g. "NCR Liquid Fuel Price
Monitoring 29 Sep to 5 Oct 2026", 2 pages, one row per oil company per product).
The app's estimate basis needs exactly one number per fuel product per region
(e.g. Diesel / NCR / PHP 62.70 / effective Oct 1). Today that number is encoded
by a human reading the PDF and typing it into `/fuel/reference-prices`. The
automatic provider pipeline (`GET /api/cron/fuel-prices` +
`src/lib/fuel/providers/official-reference.js`) only understands strict JSON,
so the DOE HTML+PDF pages are rejected by design (wrong body shape, split
origin between `doe.gov.ph` and the `cloudfront.net` PDF CDN).

## 2. Locked decisions (from brainstorming)

- Aggregation rule: arithmetic mean (average) of the company prices per product,
  rounded to 2 decimals for storage.
- Products: Diesel + Gasoline, NCR region only.
- Effectivity: Monday 00:00 +08:00 of the week range named in the PDF filename
  (e.g. "29 Sep to 5 Oct 2026" → 2026-09-29T00:00:00+08:00).
- Automation: both. Weekly cron attempts the fetch+parse; a manual PDF-URL
  upload path runs the same parser as fallback when the cron fails.
- No AI in the pipeline. Deterministic table parse only.

## 3. Architecture

New module `src/lib/fuel/providers/doe-pdf.js` sits beside the existing
`official-reference.js` and feeds the same `fuelPrices.record()` repository
(Task 10). It never writes to the DB itself; every parsed announcement goes
through the repository's validation, advisory locks, duplicate/stale checks,
0.5x–2.0x plausibility band, and Pending-until-effectivity lifecycle. Manual
uploads additionally carry the signed-in employee as verifier
(`verification_method = 'Manual'`); cron results are `Automatic` with a
server-generated ingestion hash.

```
Weekly cron ──► fetch NCR page (doe.gov.ph)
                    │ extract latest PDF link(s)
                    ▼
              download PDF (allowlisted CDN origin, no redirects)
                    │ parse table → company prices per product
                    ▼
              average → 2 announcements (Diesel, Gasoline) + Monday effectivity
                    │ fuelPrices.record({ automatic: true }) → Pending
                    ▼
              human review promotes at effectivity (existing activateDue)

Manual fallback ─► staff pastes PDF URL ─► same parser ─► Manual record
                   with employee verifier ─► same review/activation
```

## 4. Trust and failure rules

- HTTPS only. Page origin must be `https://doe.gov.ph`; PDF origin must be the
  pinned CloudFront CDN host approved by the operator. Any other origin,
  redirect, timeout, or non-PDF body → `{ ok: false }`, retain last verified
  snapshot, no write.
- Format drift (renamed/added columns, unreadable table, zero usable prices) →
  reject the whole announcement, keep the last verified price, surface a
  review flag naming the unexpected shape.
- Plausibility, duplicates, and stale weeks reuse `validateProviderUpdate` and
  the repository's same-effectivity conflict rule unchanged.
- RLS/grants posture unchanged: snapshots stay private to the service role;
  no anon/authenticated privilege is added.

## 5. Parser contract

- Input: PDF bytes + PDF source URL + claimed week range.
- Output per product: `{ fuel_product, region: 'NCR', reference_price,
  prior_price (previous week average when known, else null), announced_at
  (PDF publish instant when known, else null), effective_at (Monday 00:00
  +08:00), source_url (the PDF URL) }`.
- A product with fewer than 2 usable company prices is dropped with a reason;
  if both products drop, the run records nothing.
- Requires a server-side PDF text-extraction dependency (new prod dependency;
  exact package chosen at plan time against criteria: works in the Next.js
  route runtime, no native binaries, tables extract as ordered text rows).

## 6. Testing

- Synthetic PDF fixtures (built at test time, not copies of DOE files) for:
  average math, 2-decimal rounding, Monday normalization across month
  boundaries, sub-2-price drop, column-drift rejection, off-origin URL
  rejection, redirect/timeout fail-closed.
- Cron route tests with fake fetch implementations; repository tests reuse the
  existing fail-closed and concurrency patterns. No live network in tests.
- Manual upload path tested through the real parse → repository → review
  chain with a signed-in verifier fixture.

## 7. Out of scope (Phase 2)

Per-company observation storage, company comparison UI, additional regions or
products, and any change to the trip-estimate snapshot shape (Task 11).

## 8. Spec self-review

- No placeholders: every requirement names its value or its explicit fallback.
  The single plan-time choice (PDF library package) states its selection
  criteria instead of a blank.
- Consistent with the existing pipeline: same repository, same lifecycle,
  same fail-closed posture, same manual-review gate.
- Single-plan scope: Diesel + Gasoline NCR average only; nothing in this spec
  requires the Phase 2 table.
- Unambiguous: "average" means arithmetic mean of usable company prices for
  that product in that PDF, stored to 2 decimals.
