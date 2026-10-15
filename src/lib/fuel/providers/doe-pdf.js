import { rowInstant } from "@/lib/fuel/price-policy";

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const monthNum = (name) => MONTHS[String(name ?? "").toLowerCase().slice(0, 9)] ?? MONTHS[String(name ?? "").toLowerCase()] ?? null;
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Calendar validation: garbage like Feb 30 or Sep 31 (or start > end) must
// return null here, not a wrong effective_at downstream.
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function validRange(y, m1, d1, m2, d2) {
  if (!m1 || !m2 || d1 < 1 || d2 < 1) return null;
  if (d1 > daysInMonth(y, m1) || d2 > daysInMonth(y, m2)) return null;
  const start = isoDay(y, m1, d1);
  const end = isoDay(y, m2, d2);
  return start <= end ? { startISO: start, endISO: end } : null;
}

export function parseWeekRange(label) {
  const text = String(label ?? "");
  let m = /(\d{1,2})\s+([A-Za-z]+)\s+to\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i.exec(text);
  if (m) { return validRange(Number(m[5]), monthNum(m[2]), Number(m[1]), monthNum(m[4]), Number(m[3])); }
  m = /([A-Za-z]+)\s+(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s+(20\d{2})/i.exec(text);
  if (m) { const mo = monthNum(m[1]); return validRange(Number(m[4]), mo, Number(m[2]), mo, Number(m[3])); }
  m = /([A-Za-z]+)\s+(\d{1,2})\s+to\s+([A-Za-z]+)\s+(\d{1,2})\s+(20\d{2})/i.exec(text);
  if (m) { return validRange(Number(m[5]), monthNum(m[1]), Number(m[2]), monthNum(m[3]), Number(m[4])); }
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
  const normOrigin = (o) => {
    const s = String(o ?? "").trim().toLowerCase();
    try { return new URL(s.includes("://") ? s : `https://${s}`).origin; } catch { return null; }
  };
  const allowed = new Set([page.origin.toLowerCase(), ...pdfOrigins.map(normOrigin).filter(Boolean)]);
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

const BLOCK_END = /^(ron\s*\d+|diesel(\s*plus)?|kerosene)$/i;

function parseProductBlocks(text) {
  const observations = { Diesel: [], Gasoline: [] };
  const target = (line) => (/^diesel$/i.test(line) ? "Diesel" : /^ron\s*91$/i.test(line) ? "Gasoline" : null);
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let current = null;
  for (const line of lines) {
    if (BLOCK_END.test(line)) { current = target(line); continue; }
    if (!current) continue;
    if (/diesel|kerosene|gasoline|ron\s*\d/i.test(line)) { current = null; continue; }
    for (const m of line.matchAll(/\d{1,3}\.\d{2}/g)) {
      const n = Number(m[0]);
      if (n >= 1 && n <= 200) observations[current].push(n);
    }
  }
  return observations;
}

function parseCompanyTable(text) {
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

export function parseNcrPdfText(text) {
  const blocked = parseProductBlocks(text);
  if (blocked.Diesel.length || blocked.Gasoline.length) return blocked;
  return parseCompanyTable(text);
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

import pdfParse from "pdf-parse/lib/pdf-parse.js";

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
  // Same tolerant normalization as extractNcrPdfLinks: bare hosts without a
  // scheme resolve as https instead of throwing a 500 (fail closed on
  // unparseable entries, never on a valid origin).
  const normOrigin = (o) => {
    const s = String(o ?? "").trim().toLowerCase();
    try { return new URL(s.includes("://") ? s : `https://${s}`).origin.toLowerCase(); } catch { return null; }
  };
  const allowed = new Set(allowedOrigins.map(normOrigin).filter(Boolean));
  if (!allowed.has(requested.origin.toLowerCase())) return { ok: false, reason: "PDF origin is not an approved source; retaining the last verified snapshot." };
  const fetched = await guardedFetch(pdfUrl, { fetchImpl, timeoutMs });
  if (!fetched.ok) return fetched;
  const bytes = new Uint8Array(await fetched.res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > PDF_MAX_BYTES) return { ok: false, reason: "PDF body is empty or oversized; retaining the last verified snapshot." };
  return { ok: true, bytes, contentType: fetched.res.headers?.get?.("content-type")?.split(";")[0]?.trim() ?? null };
}

export async function extractPdfText(bytes, extractorImpl = null) {
  const data = new Uint8Array(bytes);
  if (!data.length) return "";
  if (extractorImpl) return String(await extractorImpl(data));
  const parsed = await pdfParse(data);
  return String(parsed?.text ?? "");
}
