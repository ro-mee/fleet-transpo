import { NextResponse } from "next/server";

// CORS lockdown for the API (Roadmap Phase 5, item 20).
//
// The web client talks to /api/* same-origin; the mobile app is native and
// applies no browser origin checks; Booking integration is server-to-server.
// There is no legitimate cross-origin browser caller, so preflight is only
// answered for the app's own origin. Fail-closed: an unknown Origin gets no
// Allow-Origin header and the preflight fails, just as if this handler didn't
// respond. Same-origin requests (no Origin header) are always allowed through —
// matching how the browser treats them.

function allowedOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

export function proxy(request) {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    // A preflight without an Origin header is malformed — refuse it.
    if (!origin) return new NextResponse(null, { status: 204 });

    const allowed = allowedOrigin();
    const headers = {
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (allowed && origin === allowed) {
      headers["Access-Control-Allow-Origin"] = allowed;
    }
    return new NextResponse(null, { status: 204, headers });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};