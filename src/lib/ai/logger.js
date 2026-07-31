import { query } from "@/lib/db";

/**
 * Logs AI request execution, token usage, and status to ailogs table in PostgreSQL.
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
    // Auto-create ailogs table if it does not exist
    await query(`
      CREATE TABLE IF NOT EXISTS ailogs (
        log_id SERIAL PRIMARY KEY,
        feature_used VARCHAR(50) NOT NULL,
        provider_name VARCHAR(50),
        model_name VARCHAR(100),
        prompt_tokens INT DEFAULT 0,
        completion_tokens INT DEFAULT 0,
        total_tokens INT DEFAULT 0,
        duration_ms INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'Success',
        error_message TEXT,
        user_email VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

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
