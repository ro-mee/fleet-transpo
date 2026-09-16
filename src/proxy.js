import { NextResponse } from "next/server";
import { checkEdgeThrottle } from "@/lib/edge-throttle";

// CORS lockdown for the API (Roadmap Phase 5, item 20).
//
// The web client talks to /api/* same-origin; the mobile app is native and
// applies no browser origin checks; Booking integration is server-to-server.
// There is no legitimate cross-origin browser caller, so preflight is only
// answered for the app's own origin. Fail-closed: an unknown Origin gets no
// Allow-Origin header and the preflight fails, just as if this handler didn't
// respond. Same-origin requests (no Origin header) are always allowed through —
// matching how the browser treats them.

function isAllowedOrigin(origin, request) {
  if (!origin) return false;

  // 1. Configured NEXT_PUBLIC_APP_URL
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      const configured = new URL(process.env.NEXT_PUBLIC_APP_URL).origin;
      if (configured && origin === configured) return true;
    } catch {}
  }

  // 2. Configured NEXTAUTH_URL
  if (process.env.NEXTAUTH_URL) {
    try {
      const nextAuthOrigin = new URL(process.env.NEXTAUTH_URL).origin;
      if (nextAuthOrigin && origin === nextAuthOrigin) return true;
    } catch {}
  }

  // 3. Vercel deployment URLs (production or preview)
  const vercelEnvUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelEnvUrl) {
    try {
      const urlStr = vercelEnvUrl.startsWith("http") ? vercelEnvUrl : `https://${vercelEnvUrl}`;
      const vercelOrigin = new URL(urlStr).origin;
      if (vercelOrigin && origin === vercelOrigin) return true;
    } catch {}
  }

  // 4. Same-origin validation from request URL and headers
  if (request) {
    try {
      const reqUrl = request.nextUrl || (request.url ? new URL(request.url) : null);
      if (reqUrl?.origin && origin === reqUrl.origin) return true;

      const forwardedHost = request.headers?.get?.("x-forwarded-host") || request.headers?.get?.("host");
      if (forwardedHost) {
        const forwardedProto =
          request.headers?.get?.("x-forwarded-proto") ||
          (reqUrl?.protocol ? reqUrl.protocol.replace(":", "") : "https");
        const detectedOrigin = `${forwardedProto}://${forwardedHost}`;
        if (origin === detectedOrigin) return true;

        const parsedOrigin = new URL(origin);
        const hostWithoutPort = forwardedHost.split(":")[0];
        if (parsedOrigin.hostname === hostWithoutPort) {
          if (parsedOrigin.protocol.startsWith(forwardedProto) || parsedOrigin.protocol === "https:") {
            return true;
          }
        }
      }
    } catch {}
  }

  // 5. In development, also allow standard local loopback and LAN origins if app URL is localhost/loopback
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  if (
    process.env.NODE_ENV !== "production" &&
    (!configuredAppUrl || configuredAppUrl.includes("localhost") || configuredAppUrl.includes("127.0.0.1"))
  ) {
    try {
      const parsed = new URL(origin);
      const host = parsed.hostname;
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host === "[::1]" ||
        host.startsWith("192.168.") ||
        host.startsWith("10.")
      ) {
        return true;
      }
    } catch {}
  }
  return false;
}

export function proxy(request) {
  const origin = request.headers.get("origin");
  const allowed = isAllowedOrigin(origin, request);

  if (origin && !allowed) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 403, headers: { Vary: "Origin" } });
    }
    return NextResponse.json(
      { error: "Forbidden: origin not allowed" },
      { status: 403, headers: { Vary: "Origin" } }
    );
  }

  const forwarded = request.headers.get("x-forwarded-for");
  const edgeIp = forwarded ? forwarded.split(",").pop().trim() : (request.headers.get("x-real-ip") || "unknown");
  const edge = checkEdgeThrottle(edgeIp);
  if (!edge.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(edge.retryAfter), Vary: "Origin" } }
    );
  }

  if (request.method === "OPTIONS") {
    // A preflight without an Origin header is malformed — refuse it.
    if (!origin) return new NextResponse(null, { status: 400 });

    const headers = {
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
      "Access-Control-Allow-Origin": origin,
    };
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
