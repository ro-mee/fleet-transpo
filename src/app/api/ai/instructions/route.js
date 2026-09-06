import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { REPORT_TYPES } from "@/lib/ai/report-narrative";
import { getSystemInstructions, getReportInstructions, promptSettingKey } from "@/lib/ai/prompt-loader";
import { query } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req) {
  try {
    const session = await requirePermission(req, "ai_settings", "read");
    const [content, ...reportContents] = await Promise.all([
      getSystemInstructions(),
      ...REPORT_TYPES.map((type) => getReportInstructions(type)),
    ]);
    const reports = REPORT_TYPES.map((type, index) => ({
      report: type,
      exists: Boolean(reportContents[index]),
      content: reportContents[index] || null,
    }));

    return ok({ content, reports, actor: { employeeId: session.user.employeeId } });
  } catch (e) { return handleError(e); }
}

// Whitelist of editable prompt documents. The client only ever sends a KEY
// ("main" or a REPORT_TYPES entry) — never a path — so directory traversal
// is impossible by construction: every write target below is assembled from
// constants, never from request input. Overrides live in system_settings so
// they persist across serverless instances and deployments.
const MAIN_TARGET = "main";
const MAX_INSTRUCTIONS_BYTES = 51200; // 50KB: prompts are text, not uploads

/**
 * PUT /api/ai/instructions
 *
 * Persist prompt markdown edited in the AI Providers UI. Body:
 *   { target: "main" | <report type>, content: string }
 * Takes effect immediately — prompt-loader.js checks system_settings on every
 * call, then falls back to repository markdown. Audited like any other
 * settings mutation.
 */
export async function PUT(req) {
  try {
    const session = await requirePermission(req, "ai_settings", "update");
    const body = await parseBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return err("Body must be a JSON object.", 400);
    }
    const { target, content } = body;
    let label;
    if (target === MAIN_TARGET) {
      label = "instructions.md";
    } else if (typeof target === "string" && REPORT_TYPES.includes(target)) {
      label = `reports/${target}.md`;
    } else {
      return err('Target must be "main" or a known report type.', 400);
    }

    if (typeof content !== "string" || !content.trim()) {
      return err("Content must be a non-empty string.", 400);
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_INSTRUCTIONS_BYTES) {
      return err("Content too large (max 50KB).", 413);
    }

    await query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value,
                     updated_at = NOW(),
                     updated_by = EXCLUDED.updated_by`,
      [promptSettingKey(target), JSON.stringify({ content }), session.user.employeeId || null]
    );
    await writeAudit(req, session, {
      action: "ai_instructions_update",
      resource: "ai_instructions",
      resourceId: target,
      newValues: { file: label, bytes },
    });
    return ok({ saved: true, target, file: label, bytes });
  } catch (e) { return handleError(e, { req }); }
}
