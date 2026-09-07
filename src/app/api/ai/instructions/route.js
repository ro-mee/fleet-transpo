import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { REPORT_TYPES } from "@/lib/ai/report-narrative";
import { writeAudit } from "@/lib/audit";

// Editable prompt keys. The client only ever sends a KEY ("main" or a
// REPORT_TYPES entry) — never a path — so directory traversal and table-key
// injection are impossible by construction.
const MAIN_TARGET = "main";
const MAX_INSTRUCTIONS_BYTES = 51200; // 50KB: prompts are text, not uploads

async function dbOverride(key) {
  try {
    const { rows } = await query(`SELECT content, version FROM ai_prompt_templates WHERE prompt_key = $1`, [
      key,
    ]);
    const content = rows[0]?.content;
    if (typeof content === "string" && content.trim()) {
      return { content, version: rows[0]?.version ?? 1 };
    }
  } catch {
    // A DB failure here must not break the read path — fall through to .md.
  }
  return null;
}

export async function GET(req) {
  try {
    const session = await requirePermission(req, "ai_settings", "read");
    const base = join(process.cwd(), "resources", "ai");
    const [override, content, reportFiles] = await Promise.all([
      dbOverride(MAIN_TARGET),
      readFile(join(base, "instructions.md"), "utf-8"),
      readdir(join(base, "reports"), { withFileTypes: true }).catch(() => []),
    ]);

    const reports = [];
    for (const type of REPORT_TYPES) {
      const f = `${type}.md`;
      const exists = reportFiles.some((d) => d.isFile() && d.name === f);
      let fileContent = null;
      if (exists) {
        try {
          fileContent = await readFile(join(base, "reports", f), "utf-8");
        } catch {
          fileContent = null;
        }
      }
      const repOverride = await dbOverride(type);
      const effective = repOverride?.content ?? fileContent;
      reports.push({
        report: type,
        exists: effective != null,
        content: effective,
        overridden: repOverride != null,
        version: repOverride?.version ?? null,
      });
    }

    return ok({
      content: override?.content ?? content,
      overridden: override != null,
      version: override?.version ?? null,
      reports,
      actor: { employeeId: session.user.employeeId },
    });
  } catch (e) { return handleError(e); }
}

/**
 * PUT /api/ai/instructions
 *
 * Persist prompt markdown edited in the AI Providers UI — to the DATABASE
 * (ai_prompt_templates upsert), not the filesystem, so edits survive Vercel
 * redeploys and apply across scaled instances. Body:
 *   { target: "main" | <report type>, content: string }
 * Takes effect on the next AI request (the loader checks DB first; no
 * restart). Audited like any other settings mutation.
 */
export async function PUT(req) {
  try {
    const session = await requirePermission(req, "ai_settings", "update");
    const body = await parseBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return err("Body must be a JSON object.", 400);
    }
    const { target, content } = body;

    let promptKey;
    let label;
    if (target === MAIN_TARGET) {
      promptKey = MAIN_TARGET;
      label = "instructions.md";
    } else if (typeof target === "string" && REPORT_TYPES.includes(target)) {
      promptKey = target;
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

    const { rows } = await query(
      `INSERT INTO ai_prompt_templates (prompt_key, content, updated_by, updated_at, version)
       VALUES ($1, $2, $3, NOW(), 1)
       ON CONFLICT (prompt_key)
       DO UPDATE SET content = EXCLUDED.content,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW(),
                     version = ai_prompt_templates.version + 1
       RETURNING version`,
      [promptKey, content, session.user.employeeId ?? null]
    );
    await writeAudit(req, session, {
      action: "ai_instructions_update",
      resource: "ai_instructions",
      resourceId: target,
      newValues: { file: label, bytes, version: rows[0]?.version ?? 1 },
    });
    return ok({ saved: true, target, file: label, bytes, version: rows[0]?.version ?? 1 });
  } catch (e) { return handleError(e, { req }); }
}

/**
 * DELETE /api/ai/instructions?target=<main|report>
 *
 * Reset to Default: deletes the DB override so the bundled .md default
 * takes over again. Idempotent — resetting with no override still 200s
 * ({ reset: true, had_override: false }). Same gate + audit as PUT.
 */
export async function DELETE(req) {
  try {
    const session = await requirePermission(req, "ai_settings", "update");
    const target = new URL(req.url).searchParams.get("target");

    let promptKey;
    if (target === MAIN_TARGET) {
      promptKey = MAIN_TARGET;
    } else if (typeof target === "string" && REPORT_TYPES.includes(target)) {
      promptKey = target;
    } else {
      return err('Target must be "main" or a known report type.', 400);
    }

    const { rows } = await query(
      `DELETE FROM ai_prompt_templates WHERE prompt_key = $1 RETURNING prompt_key`,
      [promptKey]
    );
    const had_override = rows.length > 0;
    await writeAudit(req, session, {
      action: "ai_instructions_reset",
      resource: "ai_instructions",
      resourceId: target,
      newValues: { had_override },
    });
    return ok({ reset: true, target, had_override });
  } catch (e) { return handleError(e, { req }); }
}
