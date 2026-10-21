import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { expect, it, vi } from "vitest";
import { CargoHandoverEvidenceContent } from "./cargo-handover-evidence";
import * as handoverContract from "../../../shared/cargo-handover";

// Shared UI primitives use Next's automatic JSX runtime in the application.
globalThis.React = React;

const handover = {
  version: 1, signer_name: "Ana Release", signer_role_or_dept: "Supplier",
  acknowledgment: "CARGO_HANDOVER_V1", captured_at: "2026-10-20T02:00:00.000Z",
  signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80], [100, 40]]] },
  location: { latitude: 14.5, longitude: 121, accuracy_m: 12, captured_at: "2026-10-20T02:00:00.000Z" },
};
const pickup = {
  receipt_id: "pickup-receipt", stage: "PICKUP", received_at: "2026-10-20T02:01:00.000Z", observed_at: handover.captured_at,
  manifest_ref: { kind: "REQUEST", id: "manifest-id", revision: 3, hash: "a".repeat(64) },
  lines: [{ line_id: "oil", observed_quantity: "9", condition: "DAMAGED", issue_code: "SHORTAGE", remarks: "One damaged box" }], handover,
};
const delivery = { ...pickup, receipt_id: "delivery-receipt", stage: "DELIVERY", lines: [{ line_id: "oil", observed_quantity: "8", condition: "INTACT", issue_code: "NONE", remarks: null }], handover: { ...handover, signer_name: "Ben Receiving", signer_role_or_dept: "Kitchen", location: null } };
const pair = { pickup, delivery };
const manifest = { manifest_ref: pickup.manifest_ref, lines: [{ line_id: "oil", name: "Cooking oil", unit: "boxes" }] };
const render = props => renderToStaticMarkup(React.createElement(CargoHandoverEvidenceContent, { tripId: 7, ...props }));
const signatureSvgs = html => (html.match(/<svg[^>]*role="img"[^>]*>[\s\S]*?<\/svg>/g) || []).join("");

it("exposes an accessible disclosure and announces loading without removing the hide control", () => {
  const closed = render({ disabled: true });
  expect(closed).toContain('aria-expanded="false"'); expect(closed).toContain("aria-controls=");
  expect(closed).toContain('id="cargo-chain-of-custody"');
  expect(closed).toContain("Your sign-in must be confirmed");
  const loading = render({ opened: true, loading: true });
  expect(loading).toContain('aria-expanded="true"'); expect(loading).toContain('aria-busy="true"');
  expect(loading).toContain("Hide signatures"); expect(loading).toContain("Loading signatures");
});

it("puts signed item counts before optional receipt and location details and names both stage statuses", () => {
  const html = render({ opened: true, handovers: pair, manifest });
  expect(html.indexOf("Acknowledged item counts")).toBeLessThan(html.indexOf("pickup-receipt"));
  expect(html).toContain("Pickup receipt details"); expect(html).toContain("Delivery receipt details");
  expect(html).toContain("Signature recorded"); expect(html).toContain("<details");
  expect(html).not.toMatch(/<details[^>]*\sopen/);
});

it("names disabled cargo configuration and refused access with a recovery action", async () => {
  const h = await harness();
  h.fetchHandovers.mockRejectedValueOnce({ status: 503, code: "CARGO_CONFIGURATION_REQUIRED" });
  await h.button("View signatures").props.onClick(); h.render();
  expect(h.text()).toContain("Cargo signature records are unavailable until cargo operations are configured");
  expect(h.button("Retry")).toBeDefined();
});

it("uses item names and declared units from the exact receipt manifest without showing its hash", () => {
  const html = render({ opened: true, handovers: pair, manifest });
  expect(html).toContain("Cooking oil"); expect(html).toContain("boxes");
  expect(html).not.toContain("Manifest hash"); expect(html).not.toContain(pickup.manifest_ref.hash);
  expect(html).toContain("Manifest revision 3"); expect(html).toContain("pickup-receipt");
});

it.each([
  { revision: 4 }, { id: "different-manifest" }, { kind: "SUPPLY" }, { hash: "b".repeat(64) },
])("does not borrow item names or units from a different manifest (%o)", patch => {
  const html = render({ opened: true, handovers: pair, manifest: { ...manifest, manifest_ref: { ...manifest.manifest_ref, ...patch } } });
  expect(html).not.toContain("Cooking oil"); expect(html).not.toContain("boxes");
  expect(html).toContain("oil"); expect(html).toContain("9");
});

it("pairs exact signed receipt quantities and manifest revisions with device and server times", () => {
  const html = render({ opened: true, handovers: pair });
  expect(html).toContain("Cargo chain of custody");
  expect(html).toContain('aria-label="Pickup handover"'); expect(html).toContain('aria-label="Delivery handover"');
  expect(html).toContain("md:grid-cols-2"); expect(html).toContain("Ana Release"); expect(html).toContain("Ben Receiving");
  expect(html).toContain("Kitchen"); expect(html).toContain("Supplier");
  expect(html).toContain("pickup-receipt"); expect(html).toContain("Manifest revision 3");
  expect(html).toContain("9"); expect(html).toContain("8"); expect(html).toContain("Damaged"); expect(html).toContain("Intact");
  expect(html).toContain("SHORTAGE"); expect(html).toContain("One damaged box");
  expect(html).toContain("Device capture"); expect(html).toContain("Server received");
  expect(html).toContain('dateTime="2026-10-20T02:01:00.000Z"');
  expect(html).toContain("12 m"); expect(html).toContain("Location not recorded");
  expect(html).toContain("does not verify identity"); expect(html).toContain("server receiving proof");
  expect((signatureSvgs(html).match(/<path /g) || []).length).toBe(2);
});

it("keeps unopened private details out of markup and distinguishes missing and legacy signatures", () => {
  const unopened = render({ handovers: pair });
  expect(unopened).toContain("View signatures"); expect(unopened).not.toContain("Ana Release");
  const html = render({ opened: true, handovers: { pickup: { ...pickup, handover: null }, delivery: null } });
  expect(html).toContain("No signature recorded for this receipt"); expect(html).toContain("No delivery receipt recorded");
  expect(signatureSvgs(html)).toBe("");
  expect(render({ opened: true, handovers: { pickup: null, delivery: null }, pickupRecorded: true })).toContain("No signature recorded for this receipt");
});

it("refuses malformed drawings without treating arbitrary SVG or HTML as markup", () => {
  const html = render({ opened: true, handovers: { pickup: { ...pickup, handover: { ...handover, signature: { width: 600, height: 240, strokes: [[['<script>alert(1)</script>', 3], [5, 8]]] } } }, delivery: null } });
  expect(html).toContain("Saved signature is unavailable"); expect(html).not.toContain("<script"); expect(signatureSvgs(html)).toBe("");
  expect(html).toContain("pickup-receipt"); expect(html).toContain("One damaged box");
});

it("shows loading and retry while preserving saved facts after a refresh failure", () => {
  expect(render({ opened: true, loading: true })).toContain("Loading signatures");
  const html = render({ opened: true, handovers: pair, error: true });
  expect(html).toContain("Signatures could not be refreshed"); expect(html).toContain("Retry"); expect(html).toContain("Ana Release");
});

async function harness() {
  const { code } = await transform(readFileSync(new URL("./cargo-handover-evidence.jsx", import.meta.url), "utf8"), { loader: "jsx", format: "cjs" });
  const slots = new Map(); let slot, index; const queries = [];
  let tripId = 7; let sessionId = "session-1"; let authenticated = true;
  const fetchHandovers = vi.fn();
  const stubReact = { ...React,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => { const at = index++; const current = slot; if (!(at in current)) current[at] = initial; return [current[at], next => { current[at] = typeof next === "function" ? next(current[at]) : next; }]; },
    useRef: initial => { const at = index++; if (!(at in slot)) slot[at] = { current: initial }; return slot[at]; },
    useId: () => "custody",
    useEffect: () => {},
  };
  const deps = {
    react: stubReact,
    "next-auth/react": { useSession: () => ({ data: authenticated ? { user: { employeeId: 12, sessionId, role: "dispatcher" } } : null, status: authenticated ? "authenticated" : "unauthenticated" }) },
    "@/services/cargo-execution.client": { getCargoHandovers: (...args) => { queries.push(args); return fetchHandovers(...args); } },
    "../../../shared/cargo-handover": handoverContract,
    "@/lib/utils": { formatDateTime: v => v },
    "@/components/ui/card": { Card: "Card", CardContent: "CardContent" },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/badge": { Badge: "Badge" },
    "@/components/ui/skeleton": { Skeleton: "Skeleton" },
    "lucide-react": { ChevronDown: "ChevronDown" },
  };
  const scope = { exports: {} };
  runInNewContext(code, { React: stubReact, module: scope, exports: scope.exports, require: name => { if (!deps[name]) throw Error(name); return deps[name]; }, AbortController });
  const nodes = [];
  function walk(node, path = "root") {
    if (Array.isArray(node)) return node.forEach((child, i) => walk(child, `${path}.${i}`));
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "function") { const key = `${path}:${node.type.name}:${node.props.key ?? ""}`; if (!slots.has(key)) slots.set(key, []); slot = slots.get(key); index = 0; return walk(node.type(node.props), key); }
    nodes.push(node); walk(node.props.children, `${path}.children`);
  }
  const h = { fetchHandovers, queries, render() { nodes.length = 0; walk(stubReact.createElement(scope.exports.CargoHandoverEvidence, { tripId })); return h; },
    button(text) { return nodes.find(n => n.type === "Button" && JSON.stringify(n.props.children).includes(text)); },
    text() { return JSON.stringify(nodes); },
    trip(id) { tripId = id; return h.render(); }, session(id) { sessionId = id; return h.render(); }, logout() { authenticated = false; return h.render(); },
  };
  return h.render();
}

it("loads only on selection, refreshes with retry, and clears on hiding", async () => {
  const h = await harness(); expect(h.queries).toHaveLength(0);
  h.fetchHandovers.mockResolvedValueOnce(pair);
  await h.button("View signatures").props.onClick(); h.render(); expect(h.text()).toContain("Ana Release");
  h.fetchHandovers.mockRejectedValueOnce(new Error("Offline"));
  await h.button("Refresh signatures").props.onClick(); h.render();
  expect(h.text()).toContain("Ana Release"); expect(h.text()).toContain("could not be refreshed");
  h.fetchHandovers.mockResolvedValueOnce({ pickup: null, delivery: null });
  await h.button("Retry").props.onClick(); h.render(); expect(h.text()).toContain("No pickup receipt recorded");
  h.button("Hide signatures").props.onClick(); h.render(); expect(h.text()).not.toContain("Ana Release");
});

it("clears on trip/session changes and does not display a late response for the previous context", async () => {
  const h = await harness(); let resolve;
  h.fetchHandovers.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const pending = h.button("View signatures").props.onClick(); h.render(); expect(h.text()).toContain("Loading signatures");
  h.trip(8); resolve(pair); await pending; h.render(); expect(h.text()).not.toContain("Ana Release");
  h.fetchHandovers.mockResolvedValueOnce(pair); await h.button("View signatures").props.onClick(); h.render();
  h.session("session-2"); expect(h.text()).not.toContain("Ana Release");
  h.fetchHandovers.mockResolvedValueOnce(pair); await h.button("View signatures").props.onClick(); h.render();
  h.logout(); expect(h.text()).not.toContain("Ana Release"); expect(h.button("View signatures").props.disabled).toBe(true);
});

it("aborts and ignores a request hidden before the response arrives", async () => {
  const h = await harness(); let resolve;
  h.fetchHandovers.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const pending = h.button("View signatures").props.onClick(); h.render();
  const signal = h.queries[0][1].signal;
  h.button("Hide signatures").props.onClick(); h.render(); expect(signal.aborted).toBe(true);
  resolve(pair); await pending; h.render(); expect(h.text()).not.toContain("Ana Release");
});

it.each([401, 403, 404])("clears private saved facts when server access is refused (%s)", async status => {
  const h = await harness();
  h.fetchHandovers.mockResolvedValueOnce(pair); await h.button("View signatures").props.onClick(); h.render();
  h.fetchHandovers.mockRejectedValueOnce(Object.assign(new Error("Denied"), { status }));
  await h.button("Refresh signatures").props.onClick(); h.render();
  expect(h.text()).not.toContain("Ana Release"); expect(h.text()).toContain("Retry");
});
