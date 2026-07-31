import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { scoreReservationVehicles, scoreDispatchDrivers } from "@/lib/ai/rule-engine";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const type = sp.get("type") || "reservation";

    if (type === "reservation") {
      const passengerCount = Number(sp.get("passengers")) || 1;

      const { rows: vehicles } = await query(
        `SELECT * FROM vehicles WHERE vehicle_status = 'Available' AND deleted_at IS NULL ORDER BY vehicle_id DESC`
      );

      const scoredVehicles = scoreReservationVehicles(vehicles, passengerCount);

      // Attempt LLM Synthesis if provider is configured
      const prompt = `Analyze available hotel vehicles for a reservation of ${passengerCount} guest(s). Recommending top vehicle: ${scoredVehicles[0]?.vehicle?.vehicle_name || "None"}. Provide a brief 2-sentence operational summary.`;
      
      const llmResult = await executeLlmCompletion({
        feature_used: "Reservation AI",
        user_prompt: prompt,
      });

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
      
      const llmResult = await executeLlmCompletion({
        feature_used: "Dispatch AI",
        user_prompt: prompt,
      });

      return ok({
        type: "dispatch",
        recommendations: scoredDrivers,
        llm_summary: llmResult.success ? llmResult.content : null,
      });
    }

    return ok({ recommendations: [] });
  } catch (e) { return handleError(e); }
}
