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
