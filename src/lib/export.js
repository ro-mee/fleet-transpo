import { toCalendarDay } from "@/lib/dates";

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Keep the object URL alive until the browser has started the download.
  // Revoking it synchronously can leave binary downloads incomplete.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Returns { count, filename } so callers can confirm the download honestly
// instead of firing it into silence. count === 0 means nothing was written.
export function exportToCSV(data, filename, columns) {
  if (!data?.length) return { count: 0, filename: "" };

  const cols = columns || (data[0] ? Object.keys(data[0]).map((k) => ({ label: k, key: k })) : []);
  const headers = cols.map((c) => c.label);
  const rows = data.map((row) =>
    cols.map((c) => {
      let val = c.accessor ? c.accessor(row) : row[c.key];
      if (val == null) val = "";
      if (typeof val === "string" && (val.includes(",") || val.includes('"') || val.includes("\n"))) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    })
  );

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  // Local-day stamp: toISOString() would file an early-morning UTC+8 export
  // under yesterday's date — the same trap documented in dates.js.
  const stampedName = `${filename}-${toCalendarDay(new Date())}.csv`;
  downloadBlob(blob, stampedName);
  return { count: data.length, filename: stampedName };
}

export function exportToJSON(data, filename) {
  if (!data?.length) return { count: 0, filename: "" };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const stampedName = `${filename}-${toCalendarDay(new Date())}.json`;
  downloadBlob(blob, stampedName);
  return { count: data.length, filename: stampedName };
}

/**
 * Collect the WHOLE filtered set from a paginated list endpoint.
 *
 * Exists because "export the visible list" was implemented as a single call
 * whose result was handed straight to `exportToCSV`. Paginated endpoints answer
 * with an envelope — `{ rows, total, counts }` — not an array, and
 * `exportToCSV` tests `data?.length`, which is `undefined` on an object: it
 * returned `count: 0`, wrote no file, and the caller toasted a success anyway.
 * Reading `rows` and walking the pages is the fix, and keeping it in one place
 * means every export path inherits it.
 *
 * @param {(page: number, pageSize: number) => Promise<object|Array>} fetchPage
 *   Resolves the endpoint's envelope (`{ rows, total }`) or, for endpoints that
 *   do answer with a bare array, that array.
 * @param {object} [options]
 * @param {number} [options.pageSize] rows requested per page
 * @param {number} [options.maxPages] hard stop, so a bad `total` cannot loop
 * @returns {Promise<Array>} every row the endpoint reports for the filter
 */
export async function collectPagedRows(fetchPage, { pageSize = 100, maxPages = 100 } = {}) {
  const first = await fetchPage(1, pageSize);
  if (Array.isArray(first)) return first;

  const rows = [...(first?.rows || [])];
  const total = Number(first?.total) || rows.length;

  for (let page = 2; rows.length < total && page <= maxPages; page += 1) {
    const next = await fetchPage(page, pageSize);
    if (Array.isArray(next)) {
      if (!next.length) break;
      rows.push(...next);
      continue;
    }
    const batch = next?.rows || [];
    // A short-but-nonempty page or an empty one both mean "there is no more".
    if (!batch.length) break;
    rows.push(...batch);
  }

  return rows;
}
