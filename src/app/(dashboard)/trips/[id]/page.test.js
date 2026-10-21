import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { expect, it, vi } from "vitest";
import { TRIP_STATUS } from "@/lib/constants";
import { tripStatusLabel } from "@/lib/trips/load-presentation";

const { code } = await transform(readFileSync(new URL("./page.js", import.meta.url), "utf8"), { loader: "jsx", format: "cjs" });

function render() {
  const trip = { trip_id: 7, trip_status: "Completed", start_odometer: 25000, end_odometer: 25045, distance: 45, vehicles: { plate_number: "ABC 123" }, transportation_requests: { load_type: "Cargo", request_id: 10 }, customer_rating: 4 };
  const queries = [];
  const router = { back: vi.fn(), push: vi.fn() };
  const stubReact = { ...React, useMemo: fn => fn(), createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const deps = {
    react: stubReact,
    "next/dynamic": { default: () => "TripRouteMap", __esModule: true }, "next/link": { default: "Link", __esModule: true },
    "next/navigation": { useParams: () => ({ id: "7" }), useRouter: () => router },
    "@tanstack/react-query": { useQuery: options => { queries.push(options); return { data: options.queryKey[0] === "trip" ? trip : options.queryKey[0] === "trip-locations" ? [] : null }; } },
    "@/lib/constants": { TRIP_STATUS }, "@/lib/trips/load-presentation": { tripStatusLabel }, "@/lib/scheduling/trip-state": { isPreStartTripStatus: () => false }, "@/lib/scheduling/dispatcher-urgency": { isPickupDueWithoutStart: () => false },
    "@/services/trip.service": { getTrip: vi.fn(), getTripLocations: vi.fn() }, "@/lib/api/client": { apiFetch: vi.fn() }, "@/lib/utils": { formatDateTime: x => x, formatDuration: x => x, cn: (...x) => x.join(" ") }, "@/lib/auth/role-guard": { useRequireRole: () => {} },
    "@/components/ui/phase-rail": { PhaseRail: "PhaseRail" }, "@/components/ui/card": { Card: "Card", CardContent: "CardContent", CardHeader: "CardHeader", CardTitle: "CardTitle" }, "@/components/ui/badge": { Badge: "Badge" }, "@/components/ui/button": { Button: "Button" }, "@/components/ui/skeleton": { DetailSkeleton: "DetailSkeleton" }, "@/components/ui/empty-state": { EmptyState: "EmptyState" }, "@/components/ui/hero-header": { HeroHeader: "HeroHeader", heroButtonOutlineClass: "" }, "@/components/ui/status-badge": { StatusBadge: "StatusBadge" },
    "@/components/cargo/cargo-verification-panel": { CargoVerificationPanel: "CargoVerificationPanel" }, "@/components/trips/trip-odometer-evidence": { TripOdometerEvidence: "TripOdometerEvidence" },
    "lucide-react": Object.fromEntries(["ArrowLeft", "Truck", "Users", "Route", "Clock", "MapPin", "Navigation", "Gauge", "CheckCircle2", "Send", "TrendingUp", "Star", "TriangleAlert", "Calendar"].map(name => [name, name])),
  };
  const scope = { exports: {} };
  runInNewContext(code, { React: stubReact, module: scope, exports: scope.exports, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  const nodes = [];
  function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (node && typeof node === "object") { nodes.push(node); walk(node.children); } else if (typeof node === "string") nodes.push(node); }
  walk(scope.exports.default());
  return { trip, nodes, queries, router };
}

it("adds isolated evidence after route details and before GPS while retaining cargo, header, timeline and metrics", () => {
  const { trip, nodes, queries } = render();
  const evidenceIndex = nodes.findIndex(n => n.type === "TripOdometerEvidence");
  expect(evidenceIndex).toBeGreaterThan(nodes.indexOf(" Route & Schedule Details"));
  expect(evidenceIndex).toBeLessThan(nodes.indexOf(" Real-Time Live GPS Map ("));
  expect(nodes[evidenceIndex].props.trip).toBe(trip);
  expect(nodes.some(n => n.type === "HeroHeader")).toBe(true);
  expect(nodes.some(n => n.type === "CargoVerificationPanel" && n.props.tripId === 7)).toBe(true);
  expect(nodes.some(n => n.type === "PhaseRail")).toBe(true);
  expect(nodes).toContain(" Performance & Efficiency Metrics");
  expect(queries.map(q => q.queryKey[0])).toEqual(["trip", "trip-locations", "trip-route"]);
});
