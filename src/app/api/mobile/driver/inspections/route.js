import { requireDriver, ok, handleError } from "@/lib/api/utils";

/**
 * POST /api/mobile/driver/inspections
 * 
 * Dummy endpoint for the Stitch prototype. Accepts pre-shift inspections
 * and returns success so the mobile app can continue the flow.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    // Parse body if needed, but for prototype we just return success
    const body = await req.json().catch(() => ({}));

    // Respond with success
    return ok({ message: "Inspection recorded successfully", received: true });
  } catch (e) {
    return handleError(e);
  }
}
