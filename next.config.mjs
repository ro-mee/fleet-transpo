/** @type {import('next').NextConfig} */
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

// React/Turbopack require eval() in development (HMR, debugging); never in production.
const isDev = process.env.NODE_ENV === "development";

// A production build must know its own storage origin.
//
// Everything below is computed at BUILD time, so a missing NEXT_PUBLIC_SUPABASE_URL
// fails nothing here on its own — it just produces a policy without the storage
// origin, and then every receipt, licence photo, face photo and piece of incident
// evidence stops loading in the deployed app. The only symptom is a CSP refusal in
// each individual user's browser console, which is the worst possible place to
// discover it.
//
// So the build fails instead, with the cause named. Development is deliberately
// exempt: `next dev` must stay usable against a local or absent Supabase, and the
// dev CSP differs anyway (isDev adds 'unsafe-eval').
//
// Scoped to the build phase, not to NODE_ENV, because `next start` also loads this
// file with NODE_ENV=production — and NEXT_PUBLIC_* values are inlined at build
// time, so a production runtime is not required to have them set.
function assertProductionStorageOrigin() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set for this production build.\n" +
        "The Content-Security-Policy img-src is built from it, so shipping without it " +
        "blocks every Supabase-hosted image: fuel and expense receipts, driver " +
        "licences, face photos and incident evidence.\n" +
        "Set NEXT_PUBLIC_SUPABASE_URL in the build environment and rebuild."
    );
  }
}

// Origins the BROWSER may load images from.
//
// This directive used to be `https:`, which admits every host on the internet.
// SEC-UPLOAD-005 showed the cost: a stored incident-evidence URL is bound
// straight to <img src> by the incidents page and the incident map, so a
// host of the attacker's choosing in that column made every reviewing staff
// browser call out to it. The write path now refuses those URLs; this directive
// is the second line, and it is the one that actually keeps the request from
// leaving the browser.
//
// The storage and app origins are derived from the same env vars
// src/lib/security/remote-url.js builds its server-side allowlist from, so the
// two lists cannot drift. Same-origin is already covered by 'self'. `data:` and
// `blob:` stay for client-side previews — in img-src they are inert, they cannot
// carry script the way a data: document can.
const MAP_TILE_ORIGINS = [
  "https://api.tomtom.com", // lib/tomtom.js — rasterTileUrl, trafficTileUrl, staticimage
  "https://*.basemaps.cartocdn.com", // live-locations-map.jsx — "street" base layer
  "https://server.arcgisonline.com", // live-locations-map.jsx — "satellite" base layer
];
const IMAGE_ORIGINS = [
  ...MAP_TILE_ORIGINS,
  ...["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"].flatMap((key) => {
    try {
      // A malformed value contributes nothing rather than crashing the module —
      // but a MISSING Supabase URL is fatal in production, and
      // assertProductionStorageOrigin() above is what makes it so.
      return process.env[key] ? [new URL(process.env[key]).origin] : [];
    } catch {
      return [];
    }
  }),
];

const cspValue = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${IMAGE_ORIGINS.join(" ")}`,
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspValue },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  poweredByHeader: false,
  // Minimal self-contained server for container deploys (HostForge own-Dockerfile
  // mode): `next build` emits .next/standalone/server.js plus only the traced
  // files it imports, so the runtime image drops ~700MB of node_modules instead
  // of exporting/unpacking them. `next start` is unaffected.
  output: "standalone",
  serverExternalPackages: ["geoip-lite"],
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// Exported as a function so the build-phase guard above can run. `phase` is the
// documented Next.js hook for this (node_modules/next/dist/docs/01-app/03-api-reference/
// 05-config/01-next-config-js/index.md — "Configuration as a Function").
const loadConfig = (phase) => {
  if (phase === PHASE_PRODUCTION_BUILD) assertProductionStorageOrigin();
  return nextConfig;
};

export default loadConfig;

// Invalidate Turbopack cache: 2026-09-18T00:00:00
