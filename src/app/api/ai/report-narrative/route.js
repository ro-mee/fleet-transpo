import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, handleError } from "@/lib/api/utils";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { getSystemInstructions, getReportInstructions } from "@/lib/ai/prompt-loader";
import {
  REPORT_TYPES,
  isDemoPayload,
  buildReportSnapshot,
  deterministicNarrative,
  buildNarrativePrompt,
  parseNarrativeJson,
} from "@/lib/ai/report-narrative";

// Report-narrative generation (Tier 1 AI analyst).
//
// Takes the ALREADY-COMPUTED report payload from the client (no new DB queries)
// and turns it into a short executive analysis: narrative + actions + flag. The
// reports and analytics pages feed the same numbers they render, so the AI never
// describes anything the user can't see. Falls back to a deterministic, number-
// grounded narrative when no LLM provider is configured or the call fails.
//
// TOKEN GUARD (DB-persisted, survives restarts): each (report, date-range) has a
// durable row in ai_report_narratives (migration 035). That row is both the 24h
// sticky note (revisited tabs/loads do NOT re-bill an LLM call) and the per-tab
// regenerate budget: max 3 regenerations per calendar day, resetting on day roll-
// over. Only an explicit regenerate (`force=true`) bypasses the 24h cache.

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const FORCE_DAILY_LIMIT = 3;

// (report, range) -> canonical key strings for the COALESCE'd UNIQUE index.
function keyParts(report, range) {
  return [report, range?.from || "*", range?.to || "*"];
}

async function loadNarrative(report, range) {
  const [r, from, to] = keyParts(report, range);
  const { rows } = await query(
    `SELECT * FROM ai_report_narratives
      WHERE report = $1 AND COALESCE(range_from, '*') = $2 AND COALESCE(range_to, '*') = $3
      LIMIT 1`,
    [r, from, to]
  );
  return rows[0] || null;
}

async function upsertNarrative(report, range, payload, force) {
  const [r, from, to] = keyParts(report, range);
  // Base columns always refreshed on cache write; force additionally bumps the
  // per-tab daily budget.
  const updates = [
    "mode = $4",
    "narrative = $5",
    "actions = $6",
    "flag = $7",
    "generated_at = NOW()",
    "force_day = CURRENT_DATE",
  ];
  if (force) {
    updates.push(
      "force_count = COALESCE(ai_report_narratives.force_count, 0) + 1",
      "last_force_at = NOW()"
    );
  }
  const { rows } = await query(
    `INSERT INTO ai_report_narratives
        (report, range_from, range_to, mode, narrative, actions, flag, generated_at, force_count, force_day)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 0, CURRENT_DATE)
      ON CONFLICT (report, COALESCE(range_from, '*'), COALESCE(range_to, '*'))
      DO UPDATE SET ${updates.join(", ")}
      RETURNING *`,
    [r, from, to, payload.mode, payload.narrative, JSON.stringify(payload.actions || []), payload.flag]
  );
  return rows[0];
}

export async function POST(req) {
  try {
    await requirePermission(req, "ai", "report_narrative");

    const body = await parseBody(req);
    const report = body?.report;
    if (!REPORT_TYPES.includes(report)) {
      return ok({ ok: false, message: `Unsupported report type: ${report}` });
    }

    const data = body?.data || {};
    const range = body?.range ? { from: body.range.from, to: body.range.to } : null;
    const force = body?.force === true;

    // Never synthesize a story from demo/empty data — do not waste budget.
    if (isDemoPayload(data)) {
      return ok({ ok: true, report, range, mode: "no-data", narrative: null, actions: [], flag: "success" });
    }

    const existing = await loadNarrative(report, range);

    // Token guard: serve cached sticky note unless explicitly regenerating.
    if (!force && existing && Date.now() - new Date(existing.generated_at).getTime() < CACHE_DURATION) {
      return ok({
        ok: true,
        report,
        range,
        cached: true,
        mode: existing.mode,
        narrative: existing.narrative,
        actions: existing.actions || [],
        flag: existing.flag,
      });
    }

    // Regenerate budget (3/day per report tab). Lazy day roll-over.
    if (force && existing) {
      const dayChanged =
        !existing.force_day ||
        new Date(existing.force_day).toDateString() !== new Date().toDateString();
      if (!dayChanged && (Number(existing.force_count) || 0) >= FORCE_DAILY_LIMIT) {
        return ok({
          ok: false,
          report,
          range,
          mode: "rate-limited",
          message: `You can only regenerate this analysis ${FORCE_DAILY_LIMIT} times per day.`,
          // Keep the most recent narrative so the UI can still show it and only
          // surface a small "limit reached" notice instead of a blank card.
          narrative: existing.narrative,
          actions: existing.actions || [],
          flag: existing.flag,
          force_used_today: Number(existing.force_count) || 0,
          force_remaining_today: 0,
        });
      }
      // Rolled over to a new day: zero the stored counter before bumping so the
      // persisted force_count reflects today's budget, not yesterday's.
      if (dayChanged) {
        const [r2, from2, to2] = keyParts(report, range);
        await query(
          `UPDATE ai_report_narratives
              SET force_count = 0, force_day = CURRENT_DATE
            WHERE report = $1 AND COALESCE(range_from, '*') = $2 AND COALESCE(range_to, '*') = $3`,
          [r2, from2, to2]
        );
      }
    }

    const snapshot = buildReportSnapshot(report, data);
    // Per-report analyst instructions refine the shared persona to this report.
    // Fall back to the global system instructions when no report file exists.
    const system_instructions = (await getReportInstructions(report)) || (await getSystemInstructions());
    const llmResult = await executeLlmCompletion({
      feature_used: "Report Narrative AI",
      system_instructions,
      user_prompt: buildNarrativePrompt(report, snapshot),
    });

    let outcome = null;
    if (llmResult.success && llmResult.content) {
      const parsed = parseNarrativeJson(llmResult.content);
      if (parsed) outcome = { mode: "generative", ...parsed };
    }

    if (!outcome) {
      // Deterministic fallback: rules-based, grounded in the same numbers.
      outcome = { mode: "deterministic", ...deterministicNarrative(report, data) };
    }

    const saved = await upsertNarrative(report, range, outcome, force);
    const forceCount = Number(saved?.force_count) || 0;

    return ok({
      ok: true,
      report,
      range,
      mode: outcome.mode,
      narrative: outcome.narrative,
      actions: outcome.actions || [],
      flag: outcome.flag,
      force_used_today: forceCount,
      force_remaining_today: Math.max(0, FORCE_DAILY_LIMIT - forceCount),
    });
  } catch (e) {
    return handleError(e);
  }
}
