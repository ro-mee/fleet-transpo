import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { executeLlmCompletion, getActiveAiProvider } from "@/lib/ai/llm-adapter";

export async function GET(req) {
  try {
    await requirePermission(req, "ai_settings", "read");

    const { rows: drivers } = await query(`SELECT * FROM drivers WHERE deleted_at IS NULL`);

    // Diagnostic: check what providers exist
    const { rows: allProviders } = await query(`SELECT provider_id, provider_name, display_name, base_url, model_name, is_enabled, is_default, api_key IS NOT NULL AND api_key != '' AS has_api_key FROM aiproviders ORDER BY provider_id`);

    const activeProvider = await getActiveAiProvider();

    let prompt;
    if (drivers.length === 0) {
      prompt = "No driver data found in the system. Provide a brief note that the driver database is empty and suggest adding driver records to enable AI-driven workforce insights.";
    } else {
      const available = drivers.filter((d) => d.driver_status === "Available").length;
      const onLeave = drivers.filter((d) => d.driver_status === "On Leave").length;
      const offDuty = drivers.filter((d) => d.driver_status === "Off Duty").length;
      const expiringSoon = drivers.filter((d) => d.license_expiry && new Date(d.license_expiry) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).length;
      const expired = drivers.filter((d) => d.license_expiry && new Date(d.license_expiry) < new Date()).length;
      const totalExperience = drivers.reduce((sum, d) => sum + (Number(d.years_of_experience) || 0), 0);
      const avgExperience = drivers.length > 0 ? (totalExperience / drivers.length).toFixed(1) : 0;

      prompt = `Analyze the following fleet driver workforce data and provide a concise operational briefing (3-5 bullet points):

Total Drivers: ${drivers.length}
- Available: ${available}
- On Leave: ${onLeave}
- Off Duty: ${offDuty}
- Licenses Expiring Within 30 Days: ${expiringSoon}
- Licenses Already Expired: ${expired}
- Average Years of Experience: ${avgExperience}

Focus on workforce readiness, licensing compliance risks, and operational recommendations.`;
    }

    const llmResult = await executeLlmCompletion({
      feature_used: "Driver Insights AI",
      user_prompt: prompt,
    });

    return ok({
      driver_count: drivers.length,
      analysis: llmResult.success
        ? llmResult.content
        : "Rule-based calculation complete. No LLM provider configured — connect an AI provider (OpenAI, Gemini, etc.) to receive natural-language driver workforce analysis.",
      llm_status: llmResult.success ? "LLM" : "Rule-Based",
      tokens: llmResult.tokens || null,
      diagnostics: {
        active_provider_found: !!activeProvider,
        active_provider_name: activeProvider?.display_name || null,
        active_provider_has_key: !!(activeProvider?.api_key),
        providers_in_db: allProviders.length,
        providers: allProviders,
      },
    });
  } catch (e) { return handleError(e); }
}
