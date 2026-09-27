import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { rateLimit } from "@/lib/rate-limit";
import { addressCandidatesFromSearch, getServerKey, serverSearchUrl } from "@/lib/tomtom";

const MAX_QUERY_LENGTH = 1000;

/** Send a full address to TomTom only after an authenticated, explicit request. */
export async function POST(req) {
  try {
    const session = await requirePermission(req, "drivers", "update");
    const limit = await rateLimit(`address:map-lookup:${session.user.employeeId}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.allowed) {
      return Response.json(
        { status: "unavailable", error: "Address lookup is temporarily unavailable." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter || 60) } }
      );
    }

    const body = await parseBody(req);
    const query = typeof body?.query === "string" ? body.query.replace(/\s+/g, " ").trim() : "";
    if (!query || query.length > MAX_QUERY_LENGTH) return err("Enter a shorter address before looking it up.", 400);

    const serverKey = getServerKey();
    if (!serverKey) {
      return Response.json({ status: "unavailable" }, { status: 503 });
    }

    let response;
    try {
      response = await fetch(serverSearchUrl(query, { limit: 3 }), { signal: AbortSignal.timeout(8000) });
    } catch {
      return Response.json({ status: "unavailable" }, { status: 503 });
    }
    if (!response.ok) {
      return Response.json({ status: "unavailable" }, { status: 503 });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return Response.json({ status: "unavailable" }, { status: 503 });
    }
    if (!Array.isArray(payload?.results) || payload.results.length === 0) {
      return ok({ status: "empty" });
    }

    const candidates = addressCandidatesFromSearch(payload);
    if (candidates.length === 0) return Response.json({ status: "unavailable" }, { status: 503 });
    return ok({ status: candidates.length > 1 ? "ambiguous" : "found", candidates });
  } catch (error) {
    return handleError(error);
  }
}
