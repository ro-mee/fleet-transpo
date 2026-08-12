import fs from "fs";
import path from "path";

/**
 * Dynamically loads system prompt instructions from resources/ai/instructions.md
 * Supports fallback to built-in instructions if file is missing.
 */
export function getSystemInstructions(customPromptFile = "instructions.md") {
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
export function getReportInstructions(report) {
  if (!report) return undefined;
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
