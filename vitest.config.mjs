import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Next compiles the dashboard's `.js` route modules — `page.js` included —
  // with SWC, so they may contain JSX. Vite derives the esbuild loader from the
  // extension, so a `.js` file would be parsed as plain JS, and vite:esbuild
  // filters with `createFilter(include || /\.(m?ts|[jt]sx)$/, exclude || /\.js$/)`:
  // supplying `include` REPLACES the default, and the default `exclude: /\.js$/`
  // survives unless `exclude` is supplied too. Widening only one of the two
  // still filters every `.js` file out, so `exclude: []` is load-bearing rather
  // than decorative. `loader` must be a string — esbuild rejects a
  // per-extension map ("loader" must be a string) — so the JSX loader applies to
  // every matched file; that is why `.ts`/`.tsx` are left out of `include`
  // instead of being re-parsed as JSX (the repo has no such files, and a JSX
  // loader cannot read TS syntax). The classic factory this produces resolves
  // `React` from imports, which the mobile WebView component test mocks.
  esbuild: {
    include: [/\.jsx$/, /[\\/]src[\\/].*\.js$/, /[\\/]mobile[\\/]components[\\/].*\.js$/],
    exclude: [],
    loader: "jsx",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js", "mobile/lib/**/*.test.js", "scripts/defense-seed/**/*.test.mjs"],
  },
});
