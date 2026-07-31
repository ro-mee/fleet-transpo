export async function apiFetch(path, options = {}) {
  const { body, method, ...rest } = options;
  let jsonBody = undefined;
  if (body !== undefined && body !== null) {
    jsonBody = JSON.stringify(body, (key, value) => {
      if (typeof value === "number" && isNaN(value)) return null;
      if (value === undefined) return null;
      return value;
    });
  }

  const res = await fetch(path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...rest.headers },
    body: jsonBody,
    ...rest,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export function buildQuery(params) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  });
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}
