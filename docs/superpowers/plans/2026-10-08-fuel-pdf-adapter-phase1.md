# Fuel PDF Adapter Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the disabled fuel-price provider pipeline for DOE NCR weekly PDFs, producing one averaged Diesel and one averaged Gasoline reference price per week through the existing repository and review gates.

**Architecture:** New pure parser module `src/lib/fuel/providers/doe-pdf.js` beside `official-reference.js`. It never writes to the DB. Both the weekly cron branch and the manual import endpoint feed its announcements into the existing `fuelPrices.record()`, keeping Pending-until-effectivity, duplicate/stale rejection, the 0.5x–2.0x plausibility band, advisory locks, and RLS posture unchanged.

**Tech Stack:** Next.js route handlers, `pdf-parse@1.1.1` (exact) for server-side PDF text extraction, vitest with fake transport adapters (no live network in tests).

## Global Constraints

- No live network calls in tests; transport is injected (`fetchImpl`, `extractTextImpl`).
- Every provider failure resolves to retain-last-verified with a reason; no write on any failure path.
- Snapshots stay private to the service role; no anon/authenticated privilege is added; no migration in Phase 1.
- `reference_price` stays within PHP 1–200 per litre at exactly 2 decimals; `effective_at` carries an explicit timezone.
- No AI/LLM anywhere in this pipeline; deterministic parsing only.
- The existing JSON provider branch and all its passing tests stay byte-for-byte behavior-identical.
- Commits happen only when the user explicitly asks for them; implementation steps do not commit on their own.

---

## File map

- Create `src/lib/fuel/providers/doe-pdf.js` — pure parse functions + fail-closed transport helpers. One responsibility: turn DOE NCR page HTML and PDF bytes into repository-ready announcements.
- Create `src/lib/fuel/providers/doe-pdf.test.js` — unit tests for every export, including a hand-built minimal PDF through the real `pdf-parse` wiring.
- Modify `src/app/api/cron/fuel-prices/route.js` — add the PDF branch; JSON branch untouched.
- Modify `src/app/api/cron/fuel-prices/route.test.js` — new describe block for the PDF branch; existing blocks untouched.
- Create `src/app/api/fuel/reference-prices/import-pdf/route.js` — manual fallback endpoint (`fuelallocations.update` gated, Manual verifier).
- Create `src/app/api/fuel/reference-prices/import-pdf/route.test.js` — endpoint tests with mocked parser/transport and fake DB.
- Modify `src/app/(dashboard)/fuel/reference-prices/page.js` — add `pdfImportBody` helper plus an "Import from DOE PDF" card following the existing mutation pattern.
- Modify `src/app/(dashboard)/fuel/reference-prices/page.test.js` — helper test plus card visibility test.
- Modify `Capstone/02 - Features/Fuel.md` — document the enabled PDF pipeline, env gates, and verification evidence.

## Shared shapes (every task uses these exact names)

```js
// Announcement (identical shape to parseOfficialReference output):
{ fuel_product, region, reference_price, prior_price, announced_at, effective_at, source_url }
// Build result:
{ ok: true, announcements: [...] } | { ok: false, reason: "..." }
// Transport result:
{ ok: true, bytes | html } | { ok: false, reason: "..." }
```

---

### Task 1: Pure parsing core (week range, links, table, average, announcements)

**Files:**
- Create: `src/lib/fuel/providers/doe-pdf.js` (pure section only)
- Test: `src/lib/fuel/providers/doe-pdf.test.js` (pure section only)

**Interfaces:**
- Consumes: `rowInstant` from `@/lib/fuel/price-policy` (same import the JSON adapter uses).
- Produces: `parseWeekRange`, `mondayEffectivity`, `extractNcrPdfLinks`, `parseNcrPdfText`, `averagePrices`, `buildPdfAnnouncements` with the signatures below. Task 2 wraps these with transport; Tasks 3–4 call them.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import { parseWeekRange, mondayEffectivity, extractNcrPdfLinks, parseNcrPdfText, averagePrices, buildPdfAnnouncements } from "./doe-pdf";

describe("parseWeekRange", () => {
  it("parses the three DOE label shapes", () => {
    expect(parseWeekRange("NCR Liquid Fuel Price Monitoring 29 Sep to 5 Oct 2026.pdf")).toEqual({ startISO: "2026-09-29", endISO: "2026-10-05" });
    expect(parseWeekRange("NCR Price Monitoring Sep 1-7 2026.pdf")).toEqual({ startISO: "2026-09-01", endISO: "2026-09-07" });
    expect(parseWeekRange("NCR Price Monitoring June 30 to July 6 2026.pdf")).toEqual({ startISO: "2026-06-30", endISO: "2026-07-06" });
    expect(parseWeekRange("NCR Prices sometime soon.pdf")).toBeNull();
  });
});

describe("mondayEffectivity", () => {
  it("uses the range start at Manila midnight", () => {
    expect(mondayEffectivity("NCR Price Monitoring Sep 1-7 2026.pdf")).toBe("2026-09-01T00:00:00+08:00");
    expect(mondayEffectivity("no date here.pdf")).toBeNull();
  });
});

describe("extractNcrPdfLinks", () => {
  it("keeps only allowlisted https pdf links as absolute urls", () => {
    const html = `<a href="/data-and-prices/a.pdf">Sep 1-7</a><a href="https://d24qbtp4vooyzi.cloudfront.net/api/media/file/NCR%20Price%20Sep%201-7%202026.pdf?prefix=dev%2Fmedia">PDF</a><a href="http://evil.example/x.pdf">evil</a><a href="https://doe.gov.ph/about">about</a>`;
    expect(extractNcrPdfLinks(html, { pageUrl: "https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/ncr-pump-prices", pdfOrigins: ["d24qbtp4vooyzi.cloudfront.net"] })).toEqual([
      "https://doe.gov.ph/data-and-prices/a.pdf",
      "https://d24qbtp4vooyzi.cloudfront.net/api/media/file/NCR%20Price%20Sep%201-7%202026.pdf?prefix=dev%2Fmedia",
    ]);
  });
});

describe("parseNcrPdfText + averagePrices", () => {
  const text = ["Company Diesel Gasoline", "Shell Philippines 62.10 63.50", "Petron 62.40 63.80", "Weekly Average 62.25 63.65"].join("\n");
  it("maps positional prices and skips summary rows", () => {
    expect(parseNcrPdfText(text)).toEqual({ Diesel: [62.1, 62.4], Gasoline: [63.5, 63.8] });
    expect(averagePrices({ Diesel: [62.1, 62.4], Gasoline: [63.5] })).toEqual({ Diesel: 62.25 });
  });
});

describe("buildPdfAnnouncements", () => {
  it("builds Diesel+Gasoline announcements with Monday effectivity", () => {
    const text = ["Company Diesel Gasoline", "Shell Philippines 62.10 63.50", "Petron 62.40 63.80"].join("\n");
    const result = buildPdfAnnouncements({ text, pdfUrl: "https://d24qbtp4vooyzi.cloudfront.net/f/NCR%20Sep%201-7%202026.pdf", weekLabel: "NCR Price Monitoring Sep 1-7 2026.pdf" });
    expect(result.ok).toBe(true);
    expect(result.announcements).toMatchObject([
      { fuel_product: "Diesel", region: "NCR", reference_price: 62.25, prior_price: null, announced_at: null, effective_at: "2026-09-01T00:00:00+08:00" },
      { fuel_product: "Gasoline", region: "NCR", reference_price: 63.65, prior_price: null, announced_at: null, effective_at: "2026-09-01T00:00:00+08:00" },
    ]);
  });
  it("rejects drifted tables instead of guessing", () => {
    expect(buildPdfAnnouncements({ text: "No prices here at all", pdfUrl: "https://d24qbtp4vooyzi.cloudfront.net/f/NCR%20Sep%201-7%202026.pdf", weekLabel: "NCR Price Monitoring Sep 1-7 2026.pdf" })).toMatchObject({ ok: false });
    expect(buildPdfAnnouncements({ text: "Company Diesel Gasoline", pdfUrl: "https://d24qbtp4vooyzi.cloudfront.net/f/x.pdf", weekLabel: "unparseable label" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fuel/providers/doe-pdf.test.js`
Expected: FAIL with "Failed to resolve import ./doe-pdf" (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```js
import { rowInstant } from "@/lib/fuel/price-policy";

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const monthNum = (name) => MONTHS[String(name ?? "").toLowerCase().slice(0, 9)] ?? MONTHS[String(name ?? "").toLowerCase()] ?? null;
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function parseWeekRange(label) {
  const text = String(label ?? "");
  let m = /(\d{1,2})\s+([A-Za-z]+)\s+to\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i.exec(text);
  if (m) { const m1 = monthNum(m[2]); const m2 = monthNum(m[4]); if (!m1 || !m2) return null; return { startISO: isoDay(m[5], m1, Number(m[1])), endISO: isoDay(m[5], m2, Number(m[3])) }; }
  m = /([A-Za-z]+)\s+(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s+(20\d{2})/i.exec(text);
  if (m) { const mo = monthNum(m[1]); if (!mo) return null; return { startISO: isoDay(m[4], mo, Number(m[2])), endISO: isoDay(m[4], mo, Number(m[3])) }; }
  m = /([A-Za-z]+)\s+(\d{1,2})\s+to\s+([A-Za-z]+)\s+(\d{1,2})\s+(20\d{2})/i.exec(text);
  if (m) { const m1 = monthNum(m[1]); const m2 = monthNum(m[3]); if (!m1 || !m2) return null; return { startISO: isoDay(m[5], m1, Number(m[2])), endISO: isoDay(m[5], m2, Number(m[4])) }; }
  return null;
}

export function mondayEffectivity(weekLabel) {
  const range = parseWeekRange(weekLabel);
  if (!range) return null;
  const instant = `${range.startISO}T00:00:00+08:00`;
  return rowInstant(instant) ? instant : null;
}

export function extractNcrPdfLinks(html, { pageUrl, pdfOrigins = [] } = {}) {
  const page = new URL(String(pageUrl));
  if (page.protocol !== "https:") return [];
  const allowed = new Set([page.origin, ...pdfOrigins.map((o) => `https://${String(o).toLowerCase()}`)]);
  const found = [];
  for (const match of String(html ?? "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let url;
    try { url = new URL(match[1], page.origin); } catch { continue; }
    if (url.protocol !== "https:") continue;
    if (!allowed.has(url.origin.toLowerCase())) continue;
    if (!url.pathname.toLowerCase().endsWith(".pdf")) continue;
    const absolute = url.toString();
    if (!found.includes(absolute)) found.push(absolute);
  }
  return found;
}

const PRODUCT_COLUMNS = [{ key: "Diesel", test: /diesel/i }, { key: "Gasoline", test: /gasoline/i }];
const SKIP_ROW = /average|total|common|prevailing/i;

function headerColumns(line) {
  const hits = PRODUCT_COLUMNS.filter((c) => c.test.test(line)).map((c) => ({ key: c.key, index: line.search(c.test) }));
  hits.sort((a, b) => a.index - b.index);
  return hits.map((h) => h.key);
}

function linePrices(line) {
  const prices = [];
  for (const token of line.split(/\s+/)) {
    const cleaned = token.replace(/[^0-9.]/g, "");
    if (!/^\d{1,3}\.\d{2}$/.test(cleaned)) continue;
    const n = Number(cleaned);
    if (n >= 1 && n <= 200) prices.push(n);
  }
  return prices;
}

export function parseNcrPdfText(text) {
  const observations = { Diesel: [], Gasoline: [] };
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headerIdx = lines.findIndex((l) => PRODUCT_COLUMNS.filter((c) => c.test.test(l)).length >= 1 && linePrices(l).length === 0);
  if (headerIdx < 0) return observations;
  const columns = headerColumns(lines[headerIdx]);
  if (!columns.length) return observations;
  for (const line of lines.slice(headerIdx + 1)) {
    if (SKIP_ROW.test(line)) continue;
    const prices = linePrices(line);
    if (!prices.length || prices.length !== columns.length) continue;
    const company = line.slice(0, line.search(/[0-9]/)).trim();
    if (!company) continue;
    columns.forEach((product, i) => observations[product].push(prices[i]));
  }
  return observations;
}

export function averagePrices(observations) {
  const out = {};
  for (const product of ["Diesel", "Gasoline"]) {
    const values = Array.isArray(observations?.[product]) ? observations[product] : [];
    if (values.length < 2) continue;
    out[product] = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
  }
  return out;
}

export function buildPdfAnnouncements({ text, pdfUrl, weekLabel } = {}) {
  let pdf;
  try { pdf = new URL(String(pdfUrl ?? "")); } catch { return { ok: false, reason: "PDF URL is not a valid https URL." }; }
  if (pdf.protocol !== "https:") return { ok: false, reason: "PDF URL must use HTTPS." };
  const effective_at = mondayEffectivity(weekLabel);
  if (!effective_at) return { ok: false, reason: "Week label has no parseable date range; no effectivity can be assigned." };
  const averaged = averagePrices(parseNcrPdfText(text));
  const products = ["Diesel", "Gasoline"].filter((p) => averaged[p] !== undefined);
  if (!products.length) return { ok: false, reason: "No usable company prices parsed; retaining the last verified snapshot." };
  return { ok: true, announcements: products.map((fuel_product) => ({ fuel_product, region: "NCR", reference_price: averaged[fuel_product], prior_price: null, announced_at: null, effective_at, source_url: pdf.toString() })) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fuel/providers/doe-pdf.test.js`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Run lint on the touched files**

Run: `npx eslint src/lib/fuel/providers/doe-pdf.js src/lib/fuel/providers/doe-pdf.test.js`
Expected: clean, no warnings.

### Task 2: Fail-closed PDF transport plus pdf-parse wiring

**Files:**
- Modify: `src/lib/fuel/providers/doe-pdf.js` (append transport section)
- Test: `src/lib/fuel/providers/doe-pdf.test.js` (append transport describe)

**Interfaces:**
- Consumes: Task 1 exports (unchanged).
- Produces: `fetchNcrPage`, `fetchPdfBytes`, `extractPdfText` with the signatures below. Tasks 3–4 call exactly these names.

- [ ] **Step 1: Write the failing test**

```js
import { fetchNcrPage, fetchPdfBytes, extractPdfText } from "./doe-pdf";

describe("pdf transport (fail-closed)", () => {
  it("fetches page html and rejects redirects, non-https and failures", async () => {
    const ok = await fetchNcrPage({ pageUrl: "https://doe.gov.ph/ncr", fetchImpl: async () => ({ ok: true, status: 200, url: "https://doe.gov.ph/ncr", text: async () => "<html></html>" }) });
    expect(ok).toMatchObject({ ok: true });
    for (const fetchImpl of [
      async () => ({ ok: false, status: 403, url: "https://doe.gov.ph/ncr", text: async () => "" }),
      async () => { throw new Error("timeout"); },
      async () => ({ ok: true, status: 200, url: "https://evil.example/ncr", text: async () => "" }),
    ]) {
      expect((await fetchNcrPage({ pageUrl: "https://doe.gov.ph/ncr", fetchImpl })).ok).toBe(false);
    }
    expect((await fetchNcrPage({ pageUrl: "http://doe.gov.ph/ncr", fetchImpl: async () => ({}) })).toMatchObject({ ok: false });
  });
  it("caps pdf bytes and refuses non-https origins", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const ok = await fetchPdfBytes({ pdfUrl: "https://d24qbtp4vooyzi.cloudfront.net/f/x.pdf", allowedOrigins: ["https://d24qbtp4vooyzi.cloudfront.net"], fetchImpl: async () => ({ ok: true, status: 200, url: "https://d24qbtp4vooyzi.cloudfront.net/f/x.pdf", arrayBuffer: async () => bytes }) });
    expect(ok).toMatchObject({ ok: true });
    expect((await fetchPdfBytes({ pdfUrl: "https://evil.example/f/x.pdf", allowedOrigins: ["https://d24qbtp4vooyzi.cloudfront.net"], fetchImpl: async () => ({}) })).ok).toBe(false);
  });
  it("extracts text from a real minimal pdf through pdf-parse", async () => {
    const lines = ["Company Diesel Gasoline", "Alpha Oil 60.10 61.20", "Beta Oil 60.30 61.40"];
    const text = await extractPdfText(buildTextPdf(lines));
    expect(text).toContain("Alpha Oil");
    expect(text.replace(/\s+/g, " ")).toContain("Diesel");
  }, 15000);
});
```

Test helper `buildTextPdf` (same test file, above the describe). It builds a valid single-page PDF with computed xref offsets so no binary fixture is committed:

```js
function buildTextPdf(lines) {
  const safe = lines.map((l) => l.replace(/[()\\]/g, ""));
  const content = `BT /F1 12 Tf 50 750 Td 14 TL ${safe.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objs = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objs.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
```

- [ ] **Step 2: Install the pdf extraction dependency, then run the test to verify it fails**

Run: `npm install pdf-parse@1.1.1 --save-exact`
Then run: `npx vitest run src/lib/fuel/providers/doe-pdf.test.js`
Expected: FAIL with "fetchNcrPage is not exported" (dependency installs; functions do not exist yet).

- [ ] **Step 3: Write minimal implementation** (append to `doe-pdf.js`)

```js
import pdfParse from "pdf-parse";

const PDF_MAX_BYTES = 10_000_000;

async function guardedFetch(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const requested = new URL(url);
  if (requested.protocol !== "https:") return { ok: false, reason: "URL must use HTTPS." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: "error" });
    if (!res || res.ok !== true) return { ok: false, reason: `Fetch failed (status ${res?.status ?? "unknown"}): retaining the last verified snapshot.` };
    if (res.url && new URL(res.url, url).origin !== requested.origin) return { ok: false, reason: "Response changed origin; retaining the last verified snapshot." };
    return { ok: true, res };
  } catch (e) {
    return { ok: false, reason: `Fetch failed (${e?.name === "AbortError" ? "timeout" : e?.message || "network"}): retaining the last verified snapshot.` };
  } finally { clearTimeout(timer); }
}

export async function fetchNcrPage({ pageUrl, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const fetched = await guardedFetch(pageUrl, { fetchImpl, timeoutMs });
  if (!fetched.ok) return fetched;
  try { return { ok: true, html: await fetched.res.text() }; }
  catch { return { ok: false, reason: "Page body unreadable; retaining the last verified snapshot." }; }
}

export async function fetchPdfBytes({ pdfUrl, allowedOrigins = [], fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  let requested;
  try { requested = new URL(pdfUrl); } catch { return { ok: false, reason: "PDF URL is not a valid https URL." }; }
  const allowed = new Set(allowedOrigins.map((o) => new URL(o).origin.toLowerCase()));
  if (!allowed.has(requested.origin.toLowerCase())) return { ok: false, reason: "PDF origin is not an approved source; retaining the last verified snapshot." };
  const fetched = await guardedFetch(pdfUrl, { fetchImpl, timeoutMs });
  if (!fetched.ok) return fetched;
  const bytes = new Uint8Array(await fetched.res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > PDF_MAX_BYTES) return { ok: false, reason: "PDF body is empty or oversized; retaining the last verified snapshot." };
  return { ok: true, bytes };
}

export async function extractPdfText(bytes, extractorImpl = null) {
  const data = new Uint8Array(bytes);
  if (!data.length) return "";
  if (extractorImpl) return String(await extractorImpl(data));
  const parsed = await pdfParse(Buffer.from(data));
  return String(parsed?.text ?? "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fuel/providers/doe-pdf.test.js`
Expected: PASS (all tests, including the real pdf-parse extraction).

- [ ] **Step 5: Run lint on the touched files**

Run: `npx eslint src/lib/fuel/providers/doe-pdf.js src/lib/fuel/providers/doe-pdf.test.js`
Expected: clean, no warnings.

### Task 3: Cron PDF branch (automatic path)

**Files:**
- Modify: `src/app/api/cron/fuel-prices/route.js`
- Test: `src/app/api/cron/fuel-prices/route.test.js` (append one describe block; existing blocks stay untouched)

**Interfaces:**
- Consumes: `fetchNcrPage`, `fetchPdfBytes`, `extractPdfText`, `extractNcrPdfLinks`, `parseWeekRange`, `buildPdfAnnouncements` from `@/lib/fuel/providers/doe-pdf`; `fuelPrices` from `@/lib/fuel/price-repository` (unchanged).
- Produces: PDF-branch cron responses `{ outcome: "recorded" | "duplicate" | "retained", persisted: boolean, products: [{ fuel_product, outcome, reason? }] }`. The JSON branch response shape is unchanged.

- [ ] **Step 1: Write the failing test** (append to `route.test.js`; mock the new module exactly like the existing `official-reference` mock)

```js
vi.mock("@/lib/fuel/providers/doe-pdf", () => ({ fetchNcrPage: vi.fn(), fetchPdfBytes: vi.fn(), extractPdfText: vi.fn(), extractNcrPdfLinks: (html) => (html.includes("LATEST") ? ["https://cdn.example/f/NCR%20Sep%201-7%202026.pdf"] : []), parseWeekRange: () => ({ startISO: "2026-09-01", endISO: "2026-09-07" }), buildPdfAnnouncements: (input) => (input.text === "PARSEABLE" ? { ok: true, announcements: [{ fuel_product: "Diesel", region: "NCR", reference_price: 62.25, prior_price: null, announced_at: null, effective_at: "2026-09-01T00:00:00+08:00", source_url: "https://cdn.example/f/NCR%20Sep%201-7%202026.pdf" }] } : { ok: false, reason: "No usable company prices parsed." }) }));
```

Top-of-file import addition: `import { fetchNcrPage, fetchPdfBytes, extractPdfText } from "@/lib/fuel/providers/doe-pdf";` plus an env helper:

```js
const activatePdf = () => { process.env.FUEL_PRICE_PDF_ENABLED = "1"; process.env.FUEL_PRICE_SOURCE_VERIFIED = "1"; process.env.FUEL_PRICE_NCR_PAGE_URL = "https://official.example/ncr-pump-prices"; process.env.FUEL_PRICE_PDF_CDN = "https://cdn.example"; };
```

And extend `beforeEach` cleanup to delete `FUEL_PRICE_PDF_ENABLED`, `FUEL_PRICE_NCR_PAGE_URL`, `FUEL_PRICE_PDF_CDN`. New tests:

```js
describe("pdf provider branch", () => {
  it("stays on the legacy path until the pdf branch is explicitly enabled", async () => {
    activate(); fetchReferencePrice.mockResolvedValue({ ok: true, data: payload });
    const body = await (await call()).json(); expect(body.snapshot.fuel_product).toBe("Diesel");
    expect(fetchNcrPage).not.toHaveBeenCalled();
  });
  it("records parsed pdf announcements pending through the real repository", async () => {
    activatePdf();
    fetchNcrPage.mockResolvedValue({ ok: true, html: "LATEST" });
    fetchPdfBytes.mockResolvedValue({ ok: true, bytes: new Uint8Array([9]) });
    extractPdfText.mockResolvedValue("PARSEABLE");
    const body = await (await call()).json();
    expect(body).toMatchObject({ outcome: "recorded", persisted: true });
    expect(body.products).toMatchObject([{ fuel_product: "Diesel", outcome: "recorded" }]);
    expect(fake.writes).toBe(1);
  });
  it("retains on page, download, parse and plausibility failures without writing", async () => {
    activatePdf(); fake.rows = [{ ...payload, reference_price: 62, effective_at: "2029-10-01T00:00:00Z" }];
    fetchNcrPage.mockResolvedValue({ ok: false, reason: "page down" });
    expect(await (await call()).json()).toMatchObject({ outcome: "retained", persisted: false });
    fetchNcrPage.mockResolvedValue({ ok: true, html: "LATEST" });
    fetchPdfBytes.mockResolvedValue({ ok: false, reason: "cdn down" });
    expect(await (await call()).json()).toMatchObject({ outcome: "retained", persisted: false });
    fetchPdfBytes.mockResolvedValue({ ok: true, bytes: new Uint8Array([9]) });
    extractPdfText.mockResolvedValue("GARBAGE");
    expect(await (await call()).json()).toMatchObject({ outcome: "retained", persisted: false });
    expect(fake.writes).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/cron/fuel-prices/route.test.js`
Expected: FAIL (route has no PDF branch yet: the pdf-env calls fall into the 503 disabled path and `products` is undefined).

- [ ] **Step 3: Write minimal implementation** (modify `route.js`; JSON branch lines stay identical)

Add import:

```js
import { fetchNcrPage, fetchPdfBytes, extractPdfText, extractNcrPdfLinks, parseWeekRange, buildPdfAnnouncements } from "@/lib/fuel/providers/doe-pdf";
```

Add after `activation()`:

```js
function pdfActivation() {
  if (process.env.FUEL_PRICE_PDF_ENABLED !== "1" || process.env.FUEL_PRICE_SOURCE_VERIFIED !== "1") return null;
  const pageUrl = String(process.env.FUEL_PRICE_NCR_PAGE_URL ?? "").trim();
  const cdn = String(process.env.FUEL_PRICE_PDF_CDN ?? "").trim();
  try {
    const page = new URL(pageUrl); const pdf = new URL(cdn);
    if (page.protocol !== "https:" || pdf.protocol !== "https:") return null;
    return { pageUrl: page.toString(), pdfOrigins: [pdf.origin] };
  } catch { return null; }
}

function latestWeekPdf(pdfUrls) {
  const dated = [];
  for (const pdfUrl of pdfUrls) {
    let label = "";
    try { label = decodeURIComponent(new URL(pdfUrl).pathname.split("/").pop() ?? ""); } catch { continue; }
    const range = parseWeekRange(label);
    if (!range) continue;
    dated.push({ pdfUrl, endISO: range.endISO });
  }
  dated.sort((a, b) => (a.endISO < b.endISO ? 1 : -1));
  return dated[0]?.pdfUrl ?? null;
}
```

Insert the PDF branch at the top of `GET` after auth, before the JSON `activation()` block:

```js
const pdf = pdfActivation();
if (pdf) {
  await fuelPrices.activateDue();
  const page = await fetchNcrPage({ pageUrl: pdf.pageUrl });
  if (!page.ok) return ok({ outcome: "retained", reason: page.reason, persisted: false, products: [] });
  const pdfUrl = latestWeekPdf(extractNcrPdfLinks(page.html, { pageUrl: pdf.pageUrl, pdfOrigins: pdf.pdfOrigins }));
  if (!pdfUrl) return ok({ outcome: "retained", reason: "No dated weekly PDF found.", persisted: false, products: [] });
  const downloaded = await fetchPdfBytes({ pdfUrl, allowedOrigins: pdf.pdfOrigins });
  if (!downloaded.ok) return ok({ outcome: "retained", reason: downloaded.reason, persisted: false, products: [] });
  let text;
  try { text = await extractPdfText(downloaded.bytes); } catch (e) { return ok({ outcome: "retained", reason: "PDF text unreadable.", persisted: false, products: [] }); }
  let label = "";
  try { label = decodeURIComponent(new URL(pdfUrl).pathname.split("/").pop() ?? ""); } catch { label = ""; }
  const built = buildPdfAnnouncements({ text, pdfUrl, weekLabel: label });
  if (!built.ok) return ok({ outcome: "retained", reason: built.reason, persisted: false, products: [] });
  const products = [];
  for (const announcement of built.announcements) {
    try {
      const result = await fuelPrices.record(announcement, { automatic: true });
      products.push({ fuel_product: announcement.fuel_product, outcome: result.duplicate ? "duplicate" : "recorded" });
    } catch (error) {
      if ([400, 409].includes(error.status)) { products.push({ fuel_product: announcement.fuel_product, outcome: "retained", reason: error.message }); continue; }
      throw error;
    }
  }
  const persisted = products.some((p) => p.outcome === "recorded");
  const allDuplicate = products.length > 0 && products.every((p) => p.outcome === "duplicate");
  return ok({ outcome: allDuplicate ? "duplicate" : persisted ? "recorded" : "retained", persisted, products });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/cron/fuel-prices/route.test.js`
Expected: PASS (all 8 tests: 5 legacy + 3 new).

- [ ] **Step 5: Run lint on the touched files**

Run: `npx eslint src/app/api/cron/fuel-prices/route.js src/app/api/cron/fuel-prices/route.test.js`
Expected: clean, no warnings.

### Task 4: Manual import endpoint (fallback path)

**Files:**
- Create: `src/app/api/fuel/reference-prices/import-pdf/route.js`
- Test: `src/app/api/fuel/reference-prices/import-pdf/route.test.js`

**Interfaces:**
- Consumes: Task 1–2 exports (`fetchPdfBytes`, `extractPdfText`, `buildPdfAnnouncements`); `fuelPrices.record(body, { verifierId })`; `requirePermission(req, "fuelallocations", "update")`; `writeAudit` (same call shape as the POST route).
- Produces: `POST` returning `{ outcome, persisted, products }` with 201 on first record, 200 on duplicate/retained. `parseImportBody` is exported for the UI task.

- [ ] **Step 1: Write the failing test**

```js
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/api/utils", () => ({ AuthError: class extends Error { constructor(message, status) { super(message); this.status = status; } }, requirePermission: vi.fn(async () => ({ user: { employeeId: 7 } })), parseBody: vi.fn(), ok: (body, status = 200) => Response.json(body, { status }), err: (error, status) => Response.json({ error }, { status }), handleError: (e) => Response.json({ error: e.message }, { status: e.status || 500 }) }));
vi.mock("@/lib/fuel/providers/doe-pdf", () => ({ fetchPdfBytes: vi.fn(), extractPdfText: vi.fn(), buildPdfAnnouncements: vi.fn() }));
vi.mock("@/lib/fuel/price-repository", () => ({ fuelSchemaError: (e) => e, fuelPrices: { record: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ query: async () => ({ rows: [] }) }));

import { requirePermission, parseBody } from "@/lib/api/utils";
import { fetchPdfBytes, extractPdfText, buildPdfAnnouncements } from "@/lib/fuel/providers/doe-pdf";
import { fuelPrices } from "@/lib/fuel/price-repository";

const pdfUrl = "https://cdn.example/f/NCR%20Sep%201-7%202026.pdf";
const announcement = { fuel_product: "Diesel", region: "NCR", reference_price: 62.25, prior_price: null, announced_at: null, effective_at: "2026-09-01T00:00:00+08:00", source_url: pdfUrl };
const post = (body) => { parseBody.mockResolvedValue(body); return POST(new Request("https://local/api/fuel/reference-prices/import-pdf", { method: "POST" })); };
beforeEach(() => { vi.clearAllMocks(); });

describe("manual pdf import", () => {
  it("records parsed announcements with the signed-in verifier", async () => {
    fetchPdfBytes.mockResolvedValue({ ok: true, bytes: new Uint8Array([9]) });
    extractPdfText.mockResolvedValue("PARSEABLE");
    buildPdfAnnouncements.mockReturnValue({ ok: true, announcements: [announcement] });
    fuelPrices.record.mockResolvedValue({ snapshot: { ...announcement, snapshot_id: 1 }, duplicate: false });
    const response = await post({ pdf_url: pdfUrl });
    expect(response.status).toBe(201);
    expect(fuelPrices.record).toHaveBeenCalledWith(announcement, { verifierId: 7 });
    expect(await response.json()).toMatchObject({ outcome: "recorded", persisted: true });
  });
  it("rejects non-https urls and unparseable pdfs without writing", async () => {
    const bad = await post({ pdf_url: "http://cdn.example/f/x.pdf" });
    expect(bad.status).toBe(400); expect(fuelPrices.record).not.toHaveBeenCalled();
    fetchPdfBytes.mockResolvedValue({ ok: false, reason: "cdn down" });
    expect(await (await post({ pdf_url: pdfUrl })).json()).toMatchObject({ outcome: "retained", persisted: false });
    expect(fuelPrices.record).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/fuel/reference-prices/import-pdf/route.test.js`
Expected: FAIL with "Failed to resolve import ./route" (route does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```js
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { fuelPrices, fuelSchemaError } from "@/lib/fuel/price-repository";
import { fetchPdfBytes, extractPdfText, buildPdfAnnouncements } from "@/lib/fuel/providers/doe-pdf";

export function parseImportBody(body = {}) {
  const pdf_url = String(body.pdf_url ?? "").trim();
  const week_label = body.week_label == null || String(body.week_label).trim() === "" ? null : String(body.week_label).trim();
  return { pdf_url, week_label };
}

function pdfOrigins() {
  const cdn = String(process.env.FUEL_PRICE_PDF_CDN ?? "").trim();
  try { const url = new URL(cdn); return url.protocol === "https:" ? [url.origin] : []; } catch { return []; }
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, "fuelallocations", "update");
    const { pdf_url, week_label } = parseImportBody(await parseBody(req));
    let pdf;
    try { pdf = new URL(pdf_url); } catch { return err("Paste a valid https PDF URL.", 400); }
    if (pdf.protocol !== "https:" || !pdf.pathname.toLowerCase().endsWith(".pdf")) return err("Paste a valid https PDF URL.", 400);
    const origins = pdfOrigins();
    const downloaded = await fetchPdfBytes({ pdfUrl: pdf.toString(), allowedOrigins: origins.length ? origins : [pdf.origin] });
    if (!downloaded.ok) return ok({ outcome: "retained", reason: downloaded.reason, persisted: false, products: [] });
    let text;
    try { text = await extractPdfText(downloaded.bytes); } catch { return ok({ outcome: "retained", reason: "PDF text unreadable.", persisted: false, products: [] }); }
    let label = week_label ?? "";
    if (!label) { try { label = decodeURIComponent(pdf.pathname.split("/").pop() ?? ""); } catch { label = ""; } }
    const built = buildPdfAnnouncements({ text, pdfUrl: pdf.toString(), weekLabel: label });
    if (!built.ok) return ok({ outcome: "retained", reason: built.reason, persisted: false, products: [] });
    const products = [];
    for (const announcement of built.announcements) {
      try {
        const result = await fuelPrices.record(announcement, { verifierId: session.user.employeeId });
        if (!result.duplicate) await writeAudit(null, session, { action: "create", resource: "fuelallocations", resourceId: result.snapshot.snapshot_id, newValues: { reference_price_snapshot: result.snapshot } });
        products.push({ fuel_product: announcement.fuel_product, outcome: result.duplicate ? "duplicate" : "recorded" });
      } catch (error) {
        if ([400, 409].includes(error.status)) { products.push({ fuel_product: announcement.fuel_product, outcome: "retained", reason: error.message }); continue; }
        throw error;
      }
    }
    const persisted = products.some((p) => p.outcome === "recorded");
    const allDuplicate = products.length > 0 && products.every((p) => p.outcome === "duplicate");
    return ok({ outcome: allDuplicate ? "duplicate" : persisted ? "recorded" : "retained", persisted, products }, allDuplicate || !persisted ? 200 : 201);
  } catch (error) { return handleError(fuelSchemaError(error)); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/fuel/reference-prices/import-pdf/route.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Run lint on the touched files**

Run: `npx eslint src/app/api/fuel/reference-prices/import-pdf/route.js src/app/api/fuel/reference-prices/import-pdf/route.test.js`
Expected: clean, no warnings.

### Task 5: Dashboard import card

**Files:**
- Modify: `src/app/(dashboard)/fuel/reference-prices/page.js` (add `pdfImportBody` export plus one Card; existing form untouched)
- Test: `src/app/(dashboard)/fuel/reference-prices/page.test.js` (append two tests)

**Interfaces:**
- Consumes: `POST /api/fuel/reference-prices/import-pdf` from Task 4 (by URL only).
- Produces: `pdfImportBody` export; card renders only for `canEdit` and posts `{ pdf_url, week_label }`.

- [ ] **Step 1: Write the failing test** (append to `page.test.js`; extend the import on line 8 to include `pdfImportBody`)

```js
it("builds the pdf import body without client verification authority", async () => {
  const { pdfImportBody } = await import("./page");
  const form = new FormData();
  form.set("pdf_url", "https://cdn.example/f/NCR%20Sep%201-7%202026.pdf"); form.set("week_label", "");
  expect(pdfImportBody(form)).toEqual({ pdf_url: "https://cdn.example/f/NCR%20Sep%201-7%202026.pdf", week_label: null });
});
it("shows the pdf import card only to editors", () => {
  let markup = renderToStaticMarkup(<ReferencePricesPage />);
  expect(markup).toContain("Import from DOE PDF"); expect(markup).toContain('id="pdf-url"');
  view.canEdit = false; markup = renderToStaticMarkup(<ReferencePricesPage />);
  expect(markup).not.toContain("Import from DOE PDF");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(dashboard)/fuel/reference-prices/page.test.js"`
Expected: FAIL (the page module has no `pdfImportBody` export yet).

- [ ] **Step 3: Write minimal implementation** (edit `page.js`)

Add helper after `manualSnapshotBody` (line 17):

```js
export function pdfImportBody(form) {
  const week = form.get("week_label");
  return { pdf_url: form.get("pdf_url"), week_label: week == null || String(week).trim() === "" ? null : String(week).trim() };
}
```

Add mutation beside `save`/`setRegion` (line 43):

```js
const importPdf = useMutation({ mutationFn: (body) => apiFetch("/api/fuel/reference-prices/import-pdf", { method: "POST", body }), onSuccess: () => cache.invalidateQueries({ queryKey: ["fuel-reference-prices"] }) });
```

Add Card inside the `{canEdit ? ... : null}` region, directly after the "Record a verified price" Card (after line 74):

```jsx
{canEdit ? <Card><CardHeader><CardTitle>Import from DOE PDF</CardTitle></CardHeader><CardContent>
  <p className="mb-4 text-sm text-muted-foreground">Paste the weekly NCR monitoring PDF link. The server averages company Diesel and Gasoline prices and records them as pending snapshots with you as verifier. Anything it cannot parse is reported, never guessed.</p>
  <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; importPdf.mutate(pdfImportBody(new FormData(form)), { onSuccess: () => form.reset() }); }}>
    <div className="space-y-2"><Label htmlFor="pdf-url">Weekly NCR PDF URL</Label><Input id="pdf-url" name="pdf_url" type="url" required maxLength={2000} placeholder="https://…/NCR Liquid Fuel Price Monitoring 29 Sep to 5 Oct 2026.pdf" /></div>
    <div className="space-y-2"><Label htmlFor="week-label">Week label override (optional)</Label><Input id="week-label" name="week_label" maxLength={200} placeholder="NCR Price Monitoring Sep 1-7 2026.pdf" /></div>
    <Button disabled={importPdf.isPending}>{importPdf.isPending ? "Importing…" : "Import weekly PDF"}</Button>
    {importPdf.error ? <p role="alert" className="text-destructive">{importPdf.error.message}</p> : null}
    {importPdf.isSuccess ? <p role="status">{importPdf.data.persisted ? "Weekly PDF imported." : `Import finished without new prices: ${importPdf.data.reason ?? importPdf.data.products.map((p) => `${p.fuel_product}: ${p.reason ?? p.outcome}`).join("; ")}`}</p> : null}
  </form>
</CardContent></Card> : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/(dashboard)/fuel/reference-prices/page.test.js"`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Run lint on the touched files**

Run: `npx eslint "src/app/(dashboard)/fuel/reference-prices/page.js" "src/app/(dashboard)/fuel/reference-prices/page.test.js"`
Expected: clean, no warnings.

### Task 6: Docs, full verification, and closeout

**Files:**
- Modify: `Capstone/02 - Features/Fuel.md` (append a short Phase 1 section under the provider pipeline heading)
- Test: full offline suite plus targeted suites

**Interfaces:**
- Consumes: all Tasks 1–5 merged and passing.
- Produces: updated vault note plus a verification summary (no code changes in this task except docs).

- [ ] **Step 1: Run the full offline verification**

Run: `npx vitest run src/lib/fuel src/app/api/cron/fuel-prices src/app/api/fuel/reference-prices "src/app/(dashboard)/fuel/reference-prices"`
Expected: PASS, zero failures. If any unrelated file fails, record the failure verbatim and stop; do not fix unrelated suites in this plan.

- [ ] **Step 2: Run lint across all touched files**

Run: `npx eslint src/lib/fuel/providers/doe-pdf.js src/lib/fuel/providers/doe-pdf.test.js src/app/api/cron/fuel-prices/route.js src/app/api/cron/fuel-prices/route.test.js src/app/api/fuel/reference-prices/import-pdf/route.js src/app/api/fuel/reference-prices/import-pdf/route.test.js "src/app/(dashboard)/fuel/reference-prices/page.js" "src/app/(dashboard)/fuel/reference-prices/page.test.js"`
Expected: clean, no warnings.

- [ ] **Step 3: Update the vault note**

Append to `Capstone/02 - Features/Fuel.md` directly under the "Optional provider pipeline" section a dated subsection recording: the PDF adapter module path, the average/Diesel+Gasoline-NCR/Monday-effectivity rules, the three env gates (`FUEL_PRICE_PDF_ENABLED`, `FUEL_PRICE_NCR_PAGE_URL`, `FUEL_PRICE_PDF_CDN` alongside the existing `FUEL_PRICE_SOURCE_VERIFIED`), the manual import endpoint path, and the exact offline suites run with their result. Keep it to one short paragraph plus the gate list; do not restate code.

- [ ] **Step 4: Report closeout**

Reply with: files touched, test command outputs (pass counts), lint result, the docs diff summary, and the explicit statement that no migration ran, no live network was touched, and the pipeline stays disabled until the operator sets the env gates.

---

## Coverage map (spec section → task)

- Average / Diesel+Gasoline NCR / Monday effectivity → Task 1
- Allowlisted origins, no redirects, fail-closed transport → Task 2
- Weekly cron automatic path → Task 3
- Manual PDF-URL fallback with employee verifier → Task 4
- Review-surface import card → Task 5
- Vault sync (Fuel.md) → Task 6
- Phase 2 per-company table → intentionally no task (out of scope)
