import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { generateFleetInsights } from "@/lib/ai/rule-engine";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";

export async function GET(req) {
  try {
    await requireAuth(req);

    const { rows: vehicles } = await query(`SELECT * FROM vehicles WHERE deleted_at IS NULL`);
    const { rows: drivers } = await query(`SELECT * FROM drivers WHERE deleted_at IS NULL`);
    const { rows: trips } = await query(`SELECT * FROM trips WHERE deleted_at IS NULL LIMIT 100`);

    const deterministicInsights = generateFleetInsights(vehicles, drivers, trips);

    // LLM Natural Language Operations Summary
    const prompt = `Synthesize fleet metrics (${vehicles.length} total vehicles, ${drivers.length} drivers, ${trips.length} recent trips) into 3 bullet points highlighting fleet health, availability, and optimization.`;

    const llmResult = await executeLlmCompletion({
      feature_used: "Fleet Insights AI",
      user_prompt: prompt,
    });

    return ok({
      insights: deterministicInsights,
      natural_language_summary: llmResult.success ? llmResult.content : null,
    });
  } catch (e) { return handleError(e); }
}
