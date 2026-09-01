import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { generateFleetInsights } from "@/lib/ai/rule-engine";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";

let cachedData = null;
let lastCacheTime = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Token Protection Rate Limit
let forceCount = 0;
let forceResetDate = new Date().toDateString();

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    await requirePermission(req, "ai", "read");

    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const force = url.searchParams.get("force") === "true";

    // Reset rate limit every day
    const today = new Date().toDateString();
    if (forceResetDate !== today) {
      forceCount = 0;
      forceResetDate = today;
    }

    if (force) {
      if (forceCount >= 3) {
        return Response.json(
          { error: "Daily limit reached. You can only force re-analyze 3 times per day." },
          { status: 429 }
        );
      }
      forceCount++;
    } else if (cachedData && lastCacheTime && (Date.now() - lastCacheTime < CACHE_DURATION)) {
      return ok(cachedData);
    }

    const { rows: vehicles } = await query(`SELECT * FROM vehicles WHERE deleted_at IS NULL`);
    const { rows: drivers } = await query(`SELECT * FROM drivers WHERE deleted_at IS NULL`);
    const { rows: trips } = await query(`SELECT * FROM trips WHERE deleted_at IS NULL LIMIT 100`);

    const deterministicInsights = generateFleetInsights(vehicles, drivers, trips);

    // Create a concise text summary to avoid blowing up the LLM context window
    const availableVehicles = vehicles.filter((v) => v.vehicle_status === "Available").length;
    const maintenanceVehicles = vehicles.filter((v) => v.vehicle_status === "Under Maintenance").length;
    const expiringDrivers = drivers.filter(d => {
      if (!d.license_expiry) return false;
      return (new Date(d.license_expiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000) <= 45;
    });

    const fleetSummary = `
      Fleet State:
      - Total Vehicles: ${vehicles.length}
      - Available: ${availableVehicles}
      - Under Maintenance: ${maintenanceVehicles}
      - Total Drivers: ${drivers.length}
      - Drivers expiring < 45 days: ${expiringDrivers.length}
      - Recent Trips: ${trips.length}

      Current System Generated Safety Alerts:
      ${JSON.stringify(deterministicInsights, null, 2)}
    `;

    // Hybrid Generative Prompt
    const prompt = `You are an intelligent Fleet Operations AI. 
Based on the fleet data below, rewrite/enhance the "Current System Generated Safety Alerts" to make them sound more actionable and professional, and add 1 or 2 new operational insights (e.g. regarding Fleet Optimization, Driver Utilization, etc).

CRITICAL RULE: You MUST output ONLY valid JSON. The JSON must be an object matching this exact schema:
{
  "summary": "A 1-2 sentence professional summary of the overall fleet state and top priority actions.",
  "insights": [
    {
      "title": "Short Alert Title (e.g. Fleet Availability)",
      "category": "e.g. Fleet Utilization, Maintenance, Compliance, Optimization",
      "severity": "high, medium, or low",
      "summary": "1 very short, punchy sentence explaining the insight."
    }
  ]
}

${fleetSummary}`;

    const llmResult = await executeLlmCompletion({
      feature_used: "Fleet Insights AI",
      user_prompt: prompt,
    });

    let mergedInsights = [...deterministicInsights]; // fallback
    let nlSummary = null;

    if (llmResult.success && llmResult.content) {
      try {
        // Extract JSON from potential markdown block (e.g. ```json ... ```)
        const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.summary) {
            nlSummary = parsed.summary;
          }
          if (Array.isArray(parsed.insights) && parsed.insights.length > 0) {
            const generativeCards = parsed.insights.map((insight, index) => ({
              insight_id: `gen-${(insight.title || "insight").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`,
              title: insight.title || "Insight",
              category: insight.category || "General",
              severity: insight.severity || "low",
              summary: insight.summary || "No summary provided.",
              is_generative: true
            }));
            mergedInsights = [...deterministicInsights, ...generativeCards];
          }
        }
      } catch (err) {
        console.error("Failed to parse LLM insights JSON:", err);
      }
    }

    const finalData = {
      insights: mergedInsights,
      natural_language_summary: nlSummary,
    };

    cachedData = finalData;
    lastCacheTime = Date.now();

    return ok(finalData);
  } catch (e) { return handleError(e); }
}
