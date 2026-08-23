// SSRF guard for server-side fetches of client-supplied media URLs.
//
// Endpoints like /api/ai/scan-document used to fetch any URL a caller posted,
// which made the server a proxy into the internal network (cloud metadata
// endpoints, localhost admin panels, RFC1918 hosts). We only fetch media that
// lives in fleet-controlled storage: the Supabase storage host, the app's own
// origin, or an inline data: URL. Everything else is rejected before any
// outbound request is made.

let cachedHosts;

function allowedHosts() {
  if (!cachedHosts) {
    cachedHosts = new Set();
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"]) {
      try {
        const value = process.env[key];
        if (value) cachedHosts.add(new URL(value).host);
      } catch {
        // Unset or malformed env var contributes nothing.
      }
    }
  }
  return cachedHosts;
}

/**
 * True when `value` is safe for the server to retrieve:
 * - an inline image data URL (no network request at all), or
 * - an http(s) URL whose host matches a fleet-controlled origin.
 */
export function isSafeRemoteMediaUrl(value) {
  if (!value || typeof value !== "string") return false;
  if (value.startsWith("data:image/")) return true;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  return allowedHosts().has(url.host);
}
