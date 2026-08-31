import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { isValidCoordinate } from "@/lib/gps";

/**
 * POST /api/mobile/driver/gps
 *
 * Compatibility endpoint for older mobile clients. A trip id is required for a
 * GPS write; guessing the driver's "latest" trip here could attach a fix to the
 * wrong trip when more than one assignment overlaps. The current mobile client
 * uses /trips/[id]/gps instead.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);

    if (!isValidCoordinate(body.latitude, body.longitude)) {
      return err("latitude and longitude are required", 400);
    }

    // Do not infer a trip or persist an idle/non-trip sample. The explicit trip
    // endpoint is the only canonical GPS write path.
    return ok({ success: true, tracked: false, reason: "trip-id-required" });
  } catch (e) {
    return handleError(e);
  }
}
