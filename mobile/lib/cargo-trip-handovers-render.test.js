import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import * as handover from "../../shared/cargo-handover";

const code = (await transform(readFileSync(new URL("../components/cargo/CargoTripHandovers.jsx", import.meta.url), "utf8"), { loader: "jsx", format: "cjs" })).code;
const manifest_ref = { kind: "CargoDispatch", id: "order-7", revision: 1, hash: "hash-7" };
function receipt(stage, name) {
  return { receipt_id: stage, stage, manifest_ref, received_at: "2026-10-20T03:00:00Z", lines: [{ line_id: "item-1", observed_quantity: 8, condition: "INTACT" }], handover: {
    version: 1, signer_name: name, signer_role_or_dept: stage === "PICKUP" ? "Supplier" : "Kitchen",
    acknowledgment: "CARGO_HANDOVER_V1", captured_at: "2026-10-20T02:00:00Z", location: null,
    signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80], [100, 40]]] },
  } };
}
function savedView() {
  return { trip_id: 7, manifest: { manifest_ref, lines: [{ line_id: "item-1", name: "Kitchen supplies", unit: "boxes" }] },
    handovers: { pickup: receipt("PICKUP", "Alex & Sons"), delivery: receipt("DELIVERY", "Maria Reyes") } };
}

function harness(initial = {}) {
  let state = [], refs = [], effects = [], stateCursor = 0, refCursor = 0, effectCursor = 0, root, key;
  const getHandovers = vi.fn().mockResolvedValue(savedView());
  let props = { tripId: "7", actorId: "employee-7", session: { actorId: "employee-7", generation: 1, signal: new AbortController().signal }, confirmed: true, online: true, ...initial };
  const react = { ...React,
    useState(value) { const i = stateCursor++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === "function" ? next(state[i]) : next; }]; },
    useRef(value) { return refs[refCursor++] ||= { current: value }; },
    useEffect(fn, deps) { const i = effectCursor++, old = effects[i]; if (!old || deps.some((dep, n) => dep !== old.deps[n])) { old?.cleanup?.(); effects[i] = { deps, run: fn }; } },
    createElement: (component, props, ...children) => ({ component, props: props || {}, children }),
  };
  const deps = {
    react, "react-native": { Text: "Text", View: "View" }, "react-native-webview": { WebView: "WebView" }, "../clay": { ClayCard: "Card", ClayButton: "Button" },
    "../../lib/theme-context": { useTheme: () => ({ type: {}, colors: { onSurface: "#F5F1E9", surfaceContainerHigh: "#19211E" } }) },
    "../../lib/cargo-api": { cargoApi: { getHandovers } }, "../../lib/cargo-sync": { isCurrentCargoSession: snapshot => snapshot === props.session && !snapshot?.signal.aborted },
    "../../../shared/cargo-handover": { ...handover, validateCargoHandover: value => handover.validateCargoHandover(JSON.parse(JSON.stringify(value))) },
  };
  const scope = { exports: {} };
  runInNewContext(code, { module: scope, exports: scope.exports, React: react, Date, AbortController, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  function unmount() { effects.forEach(effect => effect.cleanup?.()); }
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node?.component) return node;
    if (typeof node.component === "function") return expand(node.component({ ...node.props, children: node.children }));
    return { ...node, children: node.children.map(expand) };
  }
  function render(next = {}) {
    props = { ...props, ...next };
    const boundary = scope.exports.CargoTripHandovers(props);
    if (key !== boundary.props.key) { unmount(); state = []; refs = []; effects = []; key = boundary.props.key; }
    stateCursor = refCursor = effectCursor = 0;
    root = expand(boundary);
    effects.forEach(effect => { if (effect.run) { effect.cleanup = effect.run(); delete effect.run; } });
  }
  const nodes = () => { const out = []; const walk = node => { if (Array.isArray(node)) node.forEach(walk); else if (node?.component) { out.push(node); node.children.forEach(walk); } }; walk(root); return out; };
  const button = label => nodes().find(node => node.component === "Button" && node.props.label === label);
  const text = () => nodes().filter(node => node.component === "Text").map(node => node.children.join("")).join(" ");
  render();
  const open = async () => { await button("View signatures").props.onPress(); render(); };
  return { render, nodes, button, text, open, getHandovers, unmount, props: () => props };
}

describe("saved mobile cargo handovers", () => {
  it("loads paired saved receipts only on explicit request, with safe read-only drawings", async () => {
    const h = harness();
    expect(h.getHandovers).not.toHaveBeenCalled(); expect(h.text()).not.toContain("Maria Reyes");
    await h.open();
    expect(h.getHandovers).toHaveBeenCalledWith("7", "employee-7", expect.any(AbortSignal));
    for (const text of ["Pickup handover", "Delivery handover", "Alex & Sons", "Maria Reyes", "Supplier", "Kitchen", "Server received", "8", "boxes", "Intact", "Location not recorded"]) expect(h.text()).toContain(text);
    const drawings = h.nodes().filter(node => node.component === "WebView");
    expect(drawings).toHaveLength(2);
    for (const { props } of drawings) {
      expect(props.javaScriptEnabled).toBe(false); expect(props.cacheEnabled).toBe(false); expect(props.allowFileAccess).toBe(false);
      expect(props.source.html).toContain('d="M 20 30 L 60 80 L 100 40"');
      expect(props.source.html).toContain("default-src 'none'"); expect(props.source.html).not.toMatch(/Alex|Maria|<script/);
      expect(props.onShouldStartLoadWithRequest({ url: "about:blank" })).toBe(true);
      for (const url of ["https://outside.com", "file:///private", "intent://outside"]) expect(props.onShouldStartLoadWithRequest({ url })).toBe(false);
    }
  });

  it("distinguishes unsigned history, absent receipt and malformed signature", async () => {
    const h = harness(); h.getHandovers.mockResolvedValueOnce({ handovers: { pickup: null, delivery: null }, pickup_receipt: { receipt_id: "old" } });
    await h.open(); expect(h.text()).toContain("No signature recorded for this receipt"); expect(h.text()).toContain("No delivery receipt recorded");
    const view = savedView(); view.handovers.pickup.handover.signature.strokes = "<svg onload=alert(1)>";
    h.getHandovers.mockResolvedValueOnce(view); await h.button("Refresh signatures").props.onPress(); h.render();
    expect(h.text()).toContain("Saved signature is unavailable"); expect(h.text()).not.toContain("Alex & Sons");
    expect(h.nodes().filter(node => node.component === "WebView")).toHaveLength(1);
  });

  it("never borrows changed manifest descriptions for signed historical counts", async () => {
    const h = harness(), view = savedView(); view.manifest = { ...view.manifest, manifest_ref: { ...manifest_ref, revision: 2 } };
    h.getHandovers.mockResolvedValueOnce(view); await h.open();
    expect(h.text()).not.toContain("Kitchen supplies"); expect(h.text()).not.toContain("boxes"); expect(h.text()).toContain("item-1");
  });

  it("preserves loaded facts on network refresh failure and clears them on revoked access", async () => {
    const h = harness(); await h.open();
    h.getHandovers.mockRejectedValueOnce({ status: 500 }); await h.button("Refresh signatures").props.onPress(); h.render();
    expect(h.text()).toContain("Maria Reyes"); expect(h.text()).toContain("Previously loaded");
    h.getHandovers.mockRejectedValueOnce({ status: 403 }); await h.button("Retry signatures").props.onPress(); h.render();
    expect(h.text()).not.toContain("Maria Reyes"); expect(h.text()).toContain("Signature access is unavailable");
  });

  it("shows the unavailable cargo configuration without inventing saved proof", async () => {
    const h = harness(); h.getHandovers.mockRejectedValueOnce({ status: 503, code: "CARGO_CONFIGURATION_REQUIRED" }); await h.open();
    expect(h.text()).toContain("until cargo operations are configured"); expect(h.nodes().some(node => node.component === "WebView")).toBe(false);
  });

  it("can refresh a cached history trip after reconnecting before requesting private records", async () => {
    const onRefreshTrip = vi.fn();
    const h = harness({ confirmed: false, online: false, onRefreshTrip });
    expect(h.button("Refresh trip").props.disabled).toBe(true);
    h.render({ online: true });
    expect(h.button("Refresh trip").props.disabled).toBe(false);
    h.button("Refresh trip").props.onPress(); expect(onRefreshTrip).toHaveBeenCalledOnce();
    expect(h.getHandovers).not.toHaveBeenCalled();
    h.render({ confirmed: true }); await h.open(); expect(h.text()).toContain("Maria Reyes");
  });

  it.each(["hide", "unmount", "session abort"])("aborts and ignores a late response after %s", async action => {
    const h = harness(); let release;
    h.getHandovers.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = h.button("View signatures").props.onPress(); h.render();
    if (action === "hide") h.button("Hide signatures").props.onPress();
    else if (action === "unmount") h.unmount();
    else h.props().session.signal.dispatchEvent(new Event("abort"));
    expect(h.getHandovers.mock.calls[0][2].aborted).toBe(true);
    release(savedView()); await pending; h.render(); expect(h.text()).not.toContain("Maria Reyes");
  });

  it.each([{ tripId: "8" }, { actorId: "employee-8" }, { online: false }, { confirmed: false }])("discards private records when the viewing scope changes: %o", async next => {
    const h = harness(); await h.open(); h.render(next); expect(h.text()).not.toContain("Maria Reyes");
    if (next.online === false || next.confirmed === false || next.actorId) {
      expect(h.button("View signatures").props.disabled).toBe(true);
      await h.button("View signatures").props.onPress(); expect(h.getHandovers).toHaveBeenCalledTimes(1);
    }
  });
});
