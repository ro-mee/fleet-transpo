import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { scoreReservationVehicles, scoreDispatchDrivers } from "@/lib/ai/rule-engine";
import { NON_DISPATCHABLE_VEHICLE_STATUSES } from "@/lib/ai/pair-scoring";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";

// The rule-based scoring is the point of this endpoint; the LLM summary is
// decorative. A slow/down provider must not stall the AI page, so the call is
// raced against a short budget — the summary arrives when the provider is fast
// and is simply omitted (with a null) when it isn't.
const LLM_SUMMARY_BUDGET_MS = 2500;

function withSummaryBudget(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) =>
      setTimeout(() => resolve({ success: false, fallback: true, reason: "timeout" }), LLM_SUMMARY_BUDGET_MS)
    ),
  ]);
}

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const type = sp.get("type") || "reservation";

    if (type === "reservation") {
      const passengerCount = Number(sp.get("passengers")) || 1;

      // This endpoint takes no pickup time — only a passenger count — so the
      // only window it can honestly evaluate is RIGHT NOW. It therefore keeps
      // `Reserved` vehicles (that label only records a booking somewhere in the
      // day, not that the vehicle is taken at this moment) and instead excludes
      // the ones that are genuinely out on a dispatch as of now. Statuses that
      // ground the vehicle regardless of time are excluded outright.
      //
      // These are advisory suggestions for the AI overview page, NOT the
      // assignment screen: no driver is paired here, so nothing on this list is
      // assignment-ready. The dispatch recommendation endpoint, which does have
      // a pickup window and the pairing data, is what decides that.
      const { rows: vehicles } = await query(
        `SELECT * FROM vehicles
          WHERE deleted_at IS NULL
            AND vehicle_status <> ALL($1::text[])
            AND NOT EXISTS (
              SELECT 1 FROM dispatchschedules ds
               WHERE ds.vehicle_id = vehicles.vehicle_id
                 AND ds.deleted_at IS NULL
                 AND ds.status IN ('Scheduled', 'In Progress')
                 AND ds.scheduled_departure <= NOW()
                 AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > NOW()
            )
          ORDER BY vehicle_id DESC`,
        [NON_DISPATCHABLE_VEHICLE_STATUSES]
      );

      const scoredVehicles = scoreReservationVehicles(vehicles, passengerCount);

      // Attempt LLM Synthesis if provider is configured
      const prompt = `Analyze available hotel vehicles for a reservation of ${passengerCount} guest(s). Recommending top vehicle: ${scoredVehicles[0]?.vehicle?.vehicle_name || "None"}. Provide a brief 2-sentence operational summary.`;
      
      const llmResult = await withSummaryBudget(executeLlmCompletion({
        feature_used: "Reservation AI",
        user_prompt: prompt,
      }));

      return ok({
        type: "reservation",
        passenger_count: passengerCount,
        recommendations: scoredVehicles,
        llm_summary: llmResult.success ? llmResult.content : null,
      });
    }

    if (type === "dispatch") {
      const { rows: drivers } = await query(
        `SELECT d.*, row_to_json(e.*) as employees FROM drivers d LEFT JOIN employees e ON d.employee_id = e.employee_id WHERE d.driver_status = 'Available' AND d.deleted_at IS NULL`
      );

      const scoredDrivers = scoreDispatchDrivers(drivers);

      const prompt = `Analyze available drivers for immediate hotel guest dispatch. Recommended top driver: ${scoredDrivers[0]?.driver?.employees?.first_name || "None"}. Provide a 2-sentence recommendation summary.`;
      
      const llmResult = await withSummaryBudget(executeLlmCompletion({
        feature_used: "Dispatch AI",
        user_prompt: prompt,
      }));

      return ok({
        type: "dispatch",
        recommendations: scoredDrivers,
        llm_summary: llmResult.success ? llmResult.content : null,
      });
    }

    return ok({ recommendations: [] });
  } catch (e) { return handleError(e); }
}
