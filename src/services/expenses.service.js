import { collectPagedRows } from "@/lib/export";
import { apiFetch } from "@/lib/api/client";

export async function getExpenseRecords({ page = 1, pageSize = 10, status, search, sort, sortDir } = {}) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (status) params.append("status", status);
  if (search) params.append("search", search);
  if (sort) params.append("sort", sort);
  if (sortDir) params.append("sortDir", sortDir);

  return apiFetch(`/api/expenses?${params}`);
}

export async function getAllExpenseRecords(filters = {}) {
  let total = 0;
  const rows = await collectPagedRows(async (page, pageSize) => {
    const result = await getExpenseRecords({ ...filters, page, pageSize });
    total = Number(result.total);
    return result;
  });
  if (rows.length < total) throw new Error("The complete expense export could not be loaded. Narrow the filter and try again.");
  return rows;
}

export async function reviewExpenseRecord(id, { action, review_remarks }) {
  // apiFetch keeps 401s routed through the shared session-expiry dispatch that
  // the list request above already benefits from.
  return apiFetch(`/api/expenses/${id}/review`, { body: { action, review_remarks } });
}

export async function getExpenseReceiptUrl(id) {
  const data = await apiFetch(`/api/expenses/${id}/receipt`);
  return data.url;
}
