// Load the repo's env files for plain `node` runs.
//
// Next.js loads these automatically; `node` does not, and the repo has no
// dotenv dependency. Verification harnesses need the same DATABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY the app uses, so they read it here rather than
// hardcoding credentials.
//
// Files are read in Next.js precedence order — .env.local overrides .env — and
// a missing file is skipped rather than fatal. This repo currently ships only
// .env; the older behaviour of requiring .env.local meant every script that
// called this threw on startup.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_FILES = [".env.local", ".env"];

/**
 * Populate process.env from the repo's env files.
 *
 * Already-set values always win, so a caller can override a variable on the
 * command line, and earlier files in the list win over later ones.
 *
 * @param {string|string[]} [files] One or more env files, highest precedence
 *   first. Defaults to [".env.local", ".env"].
 * @throws If none of the given files exist.
 */
export function loadEnvLocal(files = DEFAULT_FILES) {
  const list = Array.isArray(files) ? files : [files];
  let loadedAny = false;

  for (const file of list) {
    let raw;
    try {
      raw = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue; // Absent file is fine as long as one of them is present.
    }
    loadedAny = true;

    // Strip a UTF-8 BOM (this repo's .env has one — it would otherwise become
    // part of the first key's name) and split on either line ending. Splitting
    // on "\n" alone leaves a trailing "\r", and JS's "." does not match "\r",
    // so `(.*)$` fails outright on a CRLF file rather than capturing a value.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

    for (const line of raw.split(/\r?\n/)) {
      // Requires KEY=; bare tokens (this repo's .env has one) are skipped.
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (!match) continue;
      const [, key, value] = match;
      if (process.env[key]) continue;
      // Strip surrounding quotes; the line ending is already gone.
      process.env[key] = value.trim().replace(/^["'](.*)["']$/, "$1");
    }
  }

  if (!loadedAny) {
    throw new Error(
      `None of ${list.join(", ")} found — run this from the repo root.`
    );
  }
}
