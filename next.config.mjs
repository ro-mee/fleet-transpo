/** @type {import('next').NextConfig} */

// CORS is locked to the app's own origin (Roadmap Phase 5, item 20).
// The web client talks to /api/* same-origin; the mobile app is native (no
// browser CORS applies); Booking integration is server-to-server. No legitimate
// cross-origin browser caller exists, so ANY Origin other than
// NEXT_PUBLIC_APP_URL is refused. Fail-closed: with the env var unset, no
// Allow-Origin header is emitted at all.
function appOrigin() {
  const raw = process.env.NEXT_PUBLIC_APP_URL || "";
  return raw.replace(/\/+$/, "");
}

const ALLOWED_ORIGIN = appOrigin();

const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          ...(ALLOWED_ORIGIN
            ? [{ key: "Access-Control-Allow-Origin", value: ALLOWED_ORIGIN }]
            : []),
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
          { key: "Access-Control-Max-Age", value: "86400" },
          { key: "Vary", value: "Origin" },
        ],
      },
    ];
  },
};

// Invalidate Turbopack cache: 2026-08-07T14:30:45
export default nextConfig;
