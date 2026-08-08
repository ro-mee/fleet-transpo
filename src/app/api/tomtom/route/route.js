import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { buildRouteUrl, decodePolyline, getServerKey } from "@/lib/tomtom";

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"];

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
    await requireAuth(req, ROLES);
    const sp = new URL(req.url).searchParams;
    const origin = parseLonLat(sp.get("origin"));
    const destination = parseLonLat(sp.get("destination"));
    if (!origin || !destination) {
      return err("origin and destination are required as 'lng,lat'", 400);
    }

    if (!getServerKey()) {
      return err("TomTom server key is not configured", 500);
    }

    const url = buildRouteUrl(origin, destination);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return err(`TomTom routing failed (${res.status})`, 502);
    }
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return err("TomTom returned no route", 502);

    const points = route.legs?.flatMap((leg) => leg.points || []) || [];
    const coordinates = points.map((p) => [p.latitude, p.longitude]);
    const summary = route.summary || {};
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
      distanceKm: summary.lengthInMeters != null ? Number((summary.lengthInMeters / 1000).toFixed(1)) : null,
      travelTimeMin: summary.travelTimeInSeconds != null ? Math.round(summary.travelTimeInSeconds / 60) : null,
    });
  } catch (e) {
    return handleError(e);
  }
}
