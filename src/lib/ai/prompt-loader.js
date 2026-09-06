import fs from "fs";
import path from "path";
import { query } from "@/lib/db";

export function promptSettingKey(target) {
  return target === "main" ? "ai_prompt:main" : `ai_prompt:report:${target}`;
}

async function getPromptOverride(target) {
  try {
    const { rows } = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
      [promptSettingKey(target)]
    );
    const content = rows[0]?.setting_value?.content;
    return typeof content === "string" && content.trim() ? content : null;
  } catch (err) {
    console.warn("Failed to load stored AI prompt override:", err);
    return null;
  }
}

/**
 * Dynamically loads system prompt instructions from resources/ai/instructions.md
 * Supports fallback to built-in instructions if file is missing.
 */
export async function getSystemInstructions(customPromptFile = "instructions.md") {
  if (customPromptFile === "instructions.md") {
    const override = await getPromptOverride("main");
    if (override) return override;
  }
  try {
    const promptPath = path.join(process.cwd(), "resources", "ai", customPromptFile);
    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, "utf-8");
    }
  } catch (err) {
    console.warn("Failed to load dynamic system prompt file:", err);
  }

  // Built-in fallback prompt
  return `You are the Enterprise Fleet AI Assistant. Provide read-only recommendations for vehicle reservations, dispatching, predictive maintenance, and document validation. Always explain your reasoning.`;
}

/**
 * Loads report-specific analyst instructions from
 * resources/ai/reports/<report>.md. These tailor the analyst's focus and style
 * for a given report type. Falls back to undefined (caller decides: use the
 * generic instructions, or none) when the file is missing.
 */
export async function getReportInstructions(report) {
  if (!report) return undefined;
  const override = await getPromptOverride(report);
  if (override) return override;
  try {
    const promptPath = path.join(process.cwd(), "resources", "ai", "reports", `${report}.md`);
    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, "utf-8");
    }
  } catch (err) {
    console.warn("Failed to load report instructions file:", err);
  }
  return undefined;
}
