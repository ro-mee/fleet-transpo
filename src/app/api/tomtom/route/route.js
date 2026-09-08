import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { buildRouteUrl, parseRouteSummary, getServerKey } from "@/lib/tomtom";

// Proxy for the TomTom Routing API (computeRoute). The routing key stays
// server-side here — it is never shipped to the browser or mobile client, which
// only ever see this route's decoded result. Tiles/static images use the
// separate public key directly from the client.

function parseLonLat(value) {
  if (!value) return null;
  const parts = String(value).split(",").map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  const [lng, lat] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

export async function GET(req) {
  try {
    await requirePermission(req, "maps", "read");
    const sp = new URL(req.url).searchParams;
    const origin = parseLonLat(sp.get("origin"));
    const destination = parseLonLat(sp.get("destination"));
    if (!origin || !destination) {
      return err("origin and destination are required as 'lng,lat'", 400);
    }

    if (!getServerKey()) {
      return err("TomTom server key is not configured", 500);
    }

    const url = buildRouteUrl(origin, destination, {
      departAt: sp.get("departAt"),
      maxAlternatives: Math.min(2, Math.max(0, Number(sp.get("alternatives")) || 0)),
    });
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return err(`TomTom routing failed (${res.status})`, 502);
    }
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return err("TomTom returned no route", 502);

    const points = route.legs?.flatMap((leg) => leg.points || []) || [];
    const coordinates = points.map((p) => [p.latitude, p.longitude]);
    const summary = parseRouteSummary(route) || {};
    const guidance = route.guidance || {};
    const instructions = (guidance.instructions || []).map((inst) => ({
      message: inst.message || inst.instructionType || "Proceed along route",
      street: inst.street || inst.roadNumbers?.join(", ") || "",
      distanceMeters: inst.routeOffsetInMeters || 0,
      instructionType: inst.instructionType || "CONTINUE",
    }));

    return ok({
      coordinates,
      instructions,
      distanceKm: summary.distanceKm ?? null,
      travelTimeMin: summary.durationMin ?? null,
      trafficDelayMin: summary.trafficDelayMin ?? 0,
      noTrafficMinutes: summary.noTrafficMinutes ?? null,
      alternatives: (data?.routes || []).slice(1).map(parseRouteSummary).filter(Boolean),
      provenance: "live",
    });
  } catch (e) {
    return handleError(e);
  }
}
