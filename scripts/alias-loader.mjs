// Resolve the "@/..." path alias (jsconfig.json) for plain `node` runs.
//
// Next.js resolves this alias at build time; verification harnesses that import
// src/lib modules directly need the same mapping. Registered via
// `node --import ./scripts/alias-loader.mjs`.
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { register } from "node:module";

const SRC = pathToFileURL(resolvePath(process.cwd(), "src") + "/").href;

// Next.js resolves extensionless imports; plain Node ESM does not. Try the bare
// specifier first, then the extensions the codebase actually uses.
const EXTENSIONS = ["", ".js", ".jsx", "/index.js", "/index.jsx"];

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

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

register(import.meta.url, import.meta.url);
