import { describe, expect, it } from "vitest";
import { parseWeekRange, mondayEffectivity, extractNcrPdfLinks, parseNcrPdfText, averagePrices, buildPdfAnnouncements, fetchNcrPage, fetchPdfBytes, extractPdfText } from "./doe-pdf";

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
  it("accepts full https origins as well as bare hosts, still drops evil", () => {
    const html = `<a href="https://d24qbtp4vooyzi.cloudfront.net/f/a.pdf">A</a><a href="https://evil.example/x.pdf">evil</a>`;
    const pageUrl = "https://doe.gov.ph/ncr-pump-prices";
    expect(extractNcrPdfLinks(html, { pageUrl, pdfOrigins: ["https://d24qbtp4vooyzi.cloudfront.net"] })).toEqual(["https://d24qbtp4vooyzi.cloudfront.net/f/a.pdf"]);
    expect(extractNcrPdfLinks(html, { pageUrl, pdfOrigins: ["d24qbtp4vooyzi.cloudfront.net"] })).toEqual(["https://d24qbtp4vooyzi.cloudfront.net/f/a.pdf"]);
    expect(extractNcrPdfLinks(html, { pageUrl, pdfOrigins: ["https://evil.example"] })).toEqual(["https://evil.example/x.pdf"]); // allowlisted means allowed — evil passes here by design
    expect(extractNcrPdfLinks(html, { pageUrl, pdfOrigins: ["https://other.example"] })).toEqual([]); // unrelated allowlist drops both links
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
    expect((await fetchNcrPage({ pageUrl: "http://doe.gov.ph/ncr", fetchImpl: async () => ({}) }))).toMatchObject({ ok: false });
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
describe("product-block layout (real DOE text shape)", () => {
  const real = ["RON 91", "84.8087.2087.6088.80", "84.80", "-", "88.80", "DIESEL", "94.1095.0095.4097.90", "94.10", "-", "97.90", "DIESEL PLUS", "97.1098.00100.30101.90", "KEROSENE", "124.50125.90"].join("\n");
  it("averages RON91-only and DIESEL-only blocks including summaries", () => {
    expect(parseNcrPdfText(real)).toEqual({ Diesel: [94.1, 95, 95.4, 97.9, 94.1, 97.9], Gasoline: [84.8, 87.2, 87.6, 88.8, 84.8, 88.8] });
    expect(averagePrices(parseNcrPdfText(real))).toEqual({ Diesel: 95.73, Gasoline: 87 });
  });
  it("builds announcements from the real week label", () => {
    const result = buildPdfAnnouncements({ text: real, pdfUrl: "https://d24qbtp4vooyzi.cloudfront.net/f/NCR%20Sep%201-7%202026.pdf", weekLabel: "NCR Price Monitoring Sep 1-7 2026.pdf" });
    expect(result).toMatchObject({ ok: true, announcements: [{ fuel_product: "Diesel", reference_price: 95.73 }, { fuel_product: "Gasoline", reference_price: 87 }] });
  });
  it("still parses the legacy company-table layout", () => {
    expect(parseNcrPdfText(["Company Diesel Gasoline", "Shell 95.10 87.20", "Petron 95.40 87.50"].join("\n"))).toEqual({ Diesel: [95.1, 95.4], Gasoline: [87.2, 87.5] });
  });
  it("closes on product-variant headers but not on company names", () => {
    const text = ["DIESEL", "94.10 95.00", "DIESEL PLUS#N/A", "97.10 98.00", "PETRON", "RON 91", "84.80 85.00"].join("\n");
    expect(parseNcrPdfText(text)).toEqual({ Diesel: [94.1, 95], Gasoline: [84.8, 85] });
  });
  it("does not let a mid-block company name close the block (Petron/Chevron)", () => {
    const text = ["DIESEL", "94.10", "PETRON", "95.00", "RON 91", "84.80"].join("\n");
    expect(parseNcrPdfText(text)).toEqual({ Diesel: [94.1, 95], Gasoline: [84.8] });
  });
});
