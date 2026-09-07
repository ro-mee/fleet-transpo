import fs from "fs";
import path from "path";
import { query } from "@/lib/db";

/**
 * Prompt resolution order: DATABASE OVERRIDE first, bundled .md second,
 * built-in fallback last.
 *
 * Prompt markdown edited in the AI Providers UI lives in ai_prompt_templates
 * (migration 106) — the database is the source of truth because the Vercel
 * runtime filesystem is ephemeral and does not survive redeploys or scale
 * across instances. resources/ai/*.md files are the defaults, the disaster
 * fallback, and the Reset-to-Default seed source.
 *
 * Both exported loaders are async and already awaited by all callers. A DB
 * failure degrades to the .md fallback (never breaks AI); an empty override
 * is treated as absent so a blank save can never blank out the persona.
 */

const BUILT_IN = `You are the Enterprise Fleet AI Assistant. Provide read-only recommendations for vehicle reservations, dispatching, predictive maintenance, and document validation. Always explain your reasoning.`;

async function getDbOverride(key) {
  try {
    const { rows } = await query(`SELECT content FROM ai_prompt_templates WHERE prompt_key = $1`, [
      key,
    ]);
    const content = rows[0]?.content;
    return typeof content === "string" && content.trim() ? content : null;
  } catch (err) {
    console.warn("Prompt DB override unreadable, using bundled default:", err?.message || err);
    return null;
  }
}

function readBundledMd(relativePath) {
  try {
    const promptPath = path.join(process.cwd(), "resources", "ai", relativePath);
    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, "utf-8");
    }
  } catch (err) {
    console.warn("Failed to load dynamic system prompt file:", err);
  }
  return null;
}

/**
 * Dynamically loads system prompt instructions.
 * Supports fallback to built-in instructions if file is missing.
 */
export async function getSystemInstructions(customPromptFile = "instructions.md") {
  if (!customPromptFile || customPromptFile === "instructions.md") {
    return (await getDbOverride("main")) || readBundledMd("instructions.md") || BUILT_IN;
  }
  return readBundledMd(customPromptFile) || BUILT_IN;
}

/**
 * Loads report-specific analyst instructions.
 * Falls back to undefined (caller decides: use the generic instructions,
 * or none) when neither a DB override nor a file exists.
 */
export async function getReportInstructions(report) {
  if (!report || typeof report !== "string" || !/^[A-Za-z0-9_-]+$/.test(report)) return undefined;
  return (
    (await getDbOverride(report)) || readBundledMd(path.join("reports", `${report}.md`)) || undefined
  );
}
