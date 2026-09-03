export async function getExpenseRecords({ page = 1, pageSize = 10, status, search, sort, sortDir }) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (status) params.append("status", status);
  if (search) params.append("search", search);
  if (sort) params.append("sort", sort);
  if (sortDir) params.append("sortDir", sortDir);

  const res = await fetch(`/api/expenses?${params}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Failed to fetch expense records");
  }
  return res.json();
}

export async function reviewExpenseRecord(id, { action, review_remarks }) {
  const res = await fetch(`/api/expenses/${id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, review_remarks }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Failed to review expense record");
  }
  return res.json();
}

export async function getExpenseReceiptUrl(id) {
  const res = await fetch(`/api/expenses/${id}/receipt`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Failed to get receipt URL");
  }
  const data = await res.json();
  return data.url;
}
