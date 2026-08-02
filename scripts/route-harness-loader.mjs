// Module loader for the round-trip harness.
//
// Does two things:
//   1. resolves the "@/..." alias from jsconfig.json (same as alias-loader.mjs),
//   2. redirects "@/lib/auth" to scripts/stub-auth.mjs so the harness can say
//      who the caller is without forging a NextAuth cookie.
//
// Only the auth seam is swapped. requireAuth(), the route handlers, the
// lifecycle service, conflict detection, the timeline writer and the outbound
// gateway all run as-is, against the live database.
//
// Registered via `node --import ./scripts/route-harness-loader.mjs`.
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { register } from "node:module";

const SRC = pathToFileURL(resolvePath(process.cwd(), "src") + "/").href;
const AUTH_STUB = pathToFileURL(resolvePath(process.cwd(), "scripts/stub-auth.mjs")).href;

// Next.js resolves extensionless imports; plain Node ESM does not.
const EXTENSIONS = ["", ".js", ".jsx", "/index.js", "/index.jsx"];

export async function resolve(specifier, context, nextResolve) {
  // Swap @/lib/auth for the stub so next-auth never loads.
  if (specifier === "@/lib/auth") {
    return { url: AUTH_STUB, shortCircuit: true };
  }

  // Alias resolution: "@/..." → "src/..."
  if (specifier.startsWith("@/")) {
    const base = SRC + specifier.slice(2);
    let lastError;
    for (const ext of EXTENSIONS) {
      try {
        return await nextResolve(base + ext, context);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  // Relative imports inside src/ are extensionless too — src/lib/validation/
  // helpers.js imports "./index". Next resolves that; plain Node ESM does not.
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (isRelative && !/\.[a-z0-9]+$/i.test(specifier)) {
    let lastError;
    for (const ext of EXTENSIONS) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  return nextResolve(specifier, context);
}

register(import.meta.url, import.meta.url);
