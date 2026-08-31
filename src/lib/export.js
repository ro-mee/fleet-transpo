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
