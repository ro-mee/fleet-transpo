import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".opencode/**",
    // Expo web build output (gitignored). Bundled Metro code uses __d /
    // ErrorUtils / nativePerformanceNow and produced 772 of 773 no-undef
    // errors before it was excluded.
    "mobile/dist/**",
    // Not application source, and each drowns the real count:
    //   Capstone/  — the untracked Obsidian vault; its plugins ship minified
    //               bundles (MainLoop, MLTensorUsage, define, ...).
    //   */skills/  — sample outputs captured by skill workspaces, kept as
    //               fixtures. They are not wired into the app and are not
    //               meant to compile.
    "Capstone/**",
    ".github/skills/**",
    ".claude/skills/**",
    ".agents/skills/**",
  ]),

  // `no-undef` is off for plain .js under eslint-config-next, which is how
  // identifiers that were used but never imported (AuthError, Badge, Search)
  // shipped — only the JSX variant caught any of them. Enabling it requires
  // declaring globals, otherwise every window/process/Response is a false
  // positive. Route handlers and client components share one config here, so
  // both browser and node globals are declared rather than split by directory.
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    rules: {
      "no-undef": "error",
      // TDZ guard: reading a const/let before its declaration throws on every
      // render but is invisible to curl, SSR shells, and no-undef (shipped on
      // the fuel console 2026-09-04 — see Bugs.md). Hoisted function
      // declarations stay legal; classes are excluded because this repo throws
      // module-level error classes from function bodies that always run after
      // evaluation. React Native is excluded: StyleSheet-at-file-bottom is the
      // idiomatic RN pattern and fires 1400+ safe hits.
      "no-use-before-define": ["error", { functions: false, classes: false, variables: true }],
      // React Compiler diagnostics currently reject established animation and
      // synchronization patterns in both Next and React Native. Keep them
      // visible while making correctness errors the CI-blocking baseline.
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },

  // Expo injects __DEV__; it is in no globals preset.
  {
    files: ["mobile/**/*.{js,jsx}"],
    languageOptions: {
      globals: { __DEV__: "readonly" },
    },
    rules: {
      // StyleSheet.create lives at file bottom by RN convention while
      // components above reference `styles` — safe (components render after
      // module evaluation) but textually use-before-define. ~1400 hits.
      "no-use-before-define": "off",
    },
  },

  // Deliberate rule policies (kept as config, not per-line suppressions):
  {
    files: ["src/**/*.{js,jsx}"],
    rules: {
      // The dashboard intentionally renders plain <img> for arbitrary remote
      // sources (Supabase-signed URLs, OCR previews, receipt scans). Migrating
      // to next/image requires remotePatterns infra + layout rework; until that
      // happens the heuristic warning is noise, not signal.
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["mobile/**/*.{js,jsx}"],
    rules: {
      // React Native <Image> has no `alt` attribute — accessibility is
      // expressed with accessible/accessibilityLabel props the HTML-oriented
      // jsx-a11y schema does not know about.
      "jsx-a11y/alt-text": "off",
    },
  },
]);

export default eslintConfig;
