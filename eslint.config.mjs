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
    },
  },

  // Expo injects __DEV__; it is in no globals preset.
  {
    files: ["mobile/**/*.{js,jsx}"],
    languageOptions: {
      globals: { __DEV__: "readonly" },
    },
  },
]);

export default eslintConfig;
