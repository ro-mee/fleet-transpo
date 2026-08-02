// Load .env.local for plain `node` runs.
//
// Next.js loads this file automatically; `node` does not, and the repo has no
// dotenv dependency. Verification harnesses need the same DATABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY the app uses, so they read it here rather than
// hardcoding credentials.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Populate process.env from .env.local. Existing values win, so a caller can
 * override a variable on the command line.
 * @param {string} [file=".env.local"]
 */
export function loadEnvLocal(file = ".env.local") {
  let raw;
  try {
    raw = readFileSync(resolve(process.cwd(), file), "utf8");
  } catch {
    throw new Error(`${file} not found — run this from the repo root.`);
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key]) continue;
    // Strip surrounding quotes and any trailing CR from CRLF line endings.
    process.env[key] = value.trim().replace(/\r$/, "").replace(/^["'](.*)["']$/, "$1");
  }
}
