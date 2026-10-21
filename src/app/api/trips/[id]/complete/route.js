import { requirePermission, parseBody, ok, AuthError, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { completeTrip } from "@/services/trip-lifecycle.service";
import { checkDestinationProximity } from "@/services/trip-geofence.service";

function formatDistance(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m)) return "an unknown distance";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "update");
    const id = (await params).id;
    const body = await parseBody(req);
    await assertTripOwnership(session, id);

    // PR #3 completion validation: completing far from the destination needs
    // a deliberate override WITH a reason. Inside / unknown proceeds normally
    // (unknown = no trustworthy fix — fail-open, never a fabricated block).
    const override = body.geofence_override === true;
    const reason = typeof body.completion_reason === "string" ? body.completion_reason.trim().slice(0, 500) : "";
    const beforeComplete = async db => {
    if (override && !reason) throw new AuthError("A reason is required when completing away from the destination.", 400);
    const proximity = await checkDestinationProximity(db, id);
    if (proximity.state === "outside" && !override) {
      const error = new AuthError('Return to the destination or provide a completion reason.', 409);
      error.response = Response.json(
        {
          error: `You appear to be ${formatDistance(proximity.distanceM)} from ${proximity.label || "the destination"}.`,
          distance_m: proximity.distanceM,
          destination: proximity.label,
          destination_source: proximity.source,
          geofence: proximity,
          hint: "Return to the destination, or resend with { geofence_override: true, completion_reason } to complete anyway.",
        },
        { status: 409 }
      );
      throw error;
    }
    return proximity.state === "unknown" ? null : proximity;
    };

    return ok(await completeTrip(id, session, {
      endOdometer: body.end_odometer,
      distance: body.distance,
      startOdometer: body.start_odometer,
      odometerCaptureId: body.odometer_capture_id,
      beforeComplete,
      completionReason: reason || null,
      geofenceOverride: override,
    }));
  } catch (e) { return e.response || handleError(e); }
}
