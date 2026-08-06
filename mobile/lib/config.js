/**
 * Build-time feature flags for the mobile app.
 *
 * EXPO_PUBLIC_* values are inlined at bundle time by Expo, so these are fixed
 * per build. All values here are safe to expose; see .env.example.
 */

/**
 * When true, the demo-driver sign-in is offered on the login screen and the
 * api layer short-circuits to a local mock for the demo session. Defaults to
 * off so production builds only ever talk to the real backend.
 *
 * Tune it in mobile/.env, e.g. EXPO_PUBLIC_ENABLE_DEMO=true for a dev build.
 */
export const DEMO_ENABLED = process.env.EXPO_PUBLIC_ENABLE_DEMO === "true";