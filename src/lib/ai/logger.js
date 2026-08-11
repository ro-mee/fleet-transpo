import { query } from "@/lib/db";

/**
 * Logs AI request execution, token usage, and status to ailogs table in PostgreSQL.
 *
 * NOTE: The ailogs table is created by migration 034, not here. This used to run
 * CREATE TABLE IF NOT EXISTS on every call — a DDL round-trip on the AI hot path.
 * Same reasoning as getActiveAiProvider in ./llm-adapter.js.
 */
export async function logAiRequest({
  feature_used,
  provider_name = "Rule-Based",
  model_name = "Deterministic Engine",
  prompt_tokens = 0,
  completion_tokens = 0,
  total_tokens = 0,
  duration_ms = 0,
  status = "Success",
  error_message = null,
  user_email = null,
}) {
  try {
    await query(
      `INSERT INTO ailogs (
        feature_used, provider_name, model_name, prompt_tokens, 
        completion_tokens, total_tokens, duration_ms, status, error_message, user_email
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        feature_used,
        provider_name,
        model_name,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        duration_ms,
        status,
        error_message,
        user_email,
      ]
    );
  } catch (err) {
    console.warn("AI Log Insertion Notice:", err.message);
  }
}
