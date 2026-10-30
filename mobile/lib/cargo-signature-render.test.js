import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import * as drawing from "./cargo-signature";
import * as handover from "../../shared/cargo-handover";

// Execute the actual modal JSX/hooks; only native rendering, GPS and callbacks are fixtures.
async function harness(stage = "PICKUP", { sample = false, reviewedObservation } = {}) {
  const state = [], refs = [], effects = [];
  let cursor = 0, refCursor = 0;
  const react = { ...React, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; }, useRef(initial) { return refs[refCursor++] ||= { current: initial }; }, useMemo: fn => fn(), useEffect: fn => { effects.push(fn); }, createElement: (component, props, ...children) => ({ component, props: props || {}, children }) };
  const confirm = vi.fn(), cancel = vi.fn();
  const location = { requestForegroundPermissionsAsync: vi.fn(async () => ({ granted: false })) };
  const deps = { react, "react-native": { ...Object.fromEntries(["View", "Text", "Modal", "ScrollView", "KeyboardAvoidingView"].map(n => [n, n])), StyleSheet: { create: x => x }, Platform: { OS: "android" } }, "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) }, "react-native-webview": { WebView: "WebView" }, "expo-location": location, "../clay": { ClayInput: "Input" }, "./CargoButton": { CargoButton: "Button" }, "../../lib/theme-context": { useTheme: () => ({ colors: {}, type: {} }) }, "../../lib/cargo-signature": drawing, "../../../shared/cargo-handover": { ...handover, validateCargoHandover: value => handover.validateCargoHandover(JSON.parse(JSON.stringify(value))) } };
  const code = (await transform(readFileSync(new URL("../components/cargo/CargoSignatureModal.jsx", import.meta.url), "utf8"), { loader: "jsx", format: "cjs" })).code;
  const scope = { exports: {} };
  runInNewContext(code, { module: scope, exports: scope.exports, React: react, Date, require: name => { if (!deps[name]) throw Error(`Missing ${name}`); return deps[name]; } });
  let root, props = { visible: true, stage, reviewedObservation, busy: false, onCancel: cancel, onConfirm: confirm, getLocation: sample ? async () => null : options => drawing.captureCargoSignatureLocation(location, options) };
  const render = (next = {}) => { props = { ...props, ...next }; cursor = refCursor = 0; root = scope.exports.CargoSignatureModal(props); if (typeof root?.component === "function") root = root.component(root.props); return root; };
  const nodes = () => { const out = []; const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (n?.component) { out.push(n); n.children.forEach(walk); } }; walk(root); return out; };
  render(); const cleanup = effects.splice(0).map(fn => fn());
  const node = label => nodes().find(n => n.props.label === label);
  const text = () => JSON.stringify(root);
  const fill = () => { node(stage === "PICKUP" ? "Releasing staff name" : "Receiving staff name").props.onChangeText("Alex Santos"); node(stage === "PICKUP" ? "Role or department" : "Receiving department or role").props.onChangeText("Receiving"); nodes().find(n => n.component === "WebView").props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "signature", strokes: [[[20, 30], [60, 80], [100, 40]]] }) } }); render(); node("I acknowledge these reviewed counts and conditions").props.onPress(); render(); };
  return { render, nodes, node, text, fill, confirm, cancel, location, unmount: () => cleanup.forEach(fn => fn?.()) };
}
describe("cargo signer modal", () => {
  it('shows the frozen counts, conditions and remarks that the staff member signs', async () => {
    const h = await harness('PICKUP', { reviewedObservation: { manifest: { lines: [{ line_id: 'a', name: 'Rice crates', unit: 'crates', expected_quantity: '12' }] }, counts: { a: '10' }, issues: { a: { damaged: true, remarks: 'Two crates damaged', evidence: [{ uri: 'file:///local.jpg' }] } } } });
    expect(h.text()).toContain('Rice crates'); expect(h.text()).toContain('10 crates'); expect(h.text()).toContain('Damaged'); expect(h.text()).toContain('Two crates damaged');
  });
  it('uses the same signing controls for samples without invoking native GPS', async () => {
    const h = await harness('PICKUP', { sample: true }); h.fill();
    await h.node('Save signed observation').props.onPress();
    expect(h.location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ location: null }));
  });
  it("refuses external navigation before the installed WebView can open another app", async () => {
    const h = await harness(), web = h.nodes().find(n => n.component === "WebView");
    const path = new URL("../node_modules/react-native-webview/lib/WebViewShared.js", import.meta.url), requireNative = createRequire(path);
    const adapter = { exports: {} }, linking = { canOpenURL: vi.fn(async () => true), openURL: vi.fn() };
    runInNewContext(readFileSync(path, "utf8"), { module: adapter, exports: adapter.exports, require: name => name === "react-native" ? { Linking: linking } : name === "./WebView.styles" ? {} : requireNative(name) });
    const load = vi.fn(), shouldStart = adapter.exports.createOnShouldStartLoadWithRequest(load, web.props.originWhitelist, web.props.onShouldStartLoadWithRequest);
    for (const url of ["https://example.com", "file:///private", "intent://outside", "javascript:alert(1)"]) shouldStart({ nativeEvent: { url, lockIdentifier: 1 } });
    await Promise.resolve();
    expect(linking.canOpenURL).not.toHaveBeenCalled(); expect(linking.openURL).not.toHaveBeenCalled(); expect(load.mock.calls.every(call => call[0] === false)).toBe(true);
  });
  it.each(["PICKUP", "DELIVERY"])("names %s signer fields and protects refusal and authority boundaries", async stage => {
    const h = await harness(stage);
    expect(h.text()).toContain(stage === "PICKUP" ? "Releasing staff name" : "Receiving staff name");
    expect(h.text()).toContain("Refusing to sign"); expect(h.text()).toContain("does not verify identity");
    const web = h.nodes().find(n => n.component === "WebView");
    expect(web.props.onShouldStartLoadWithRequest({ url: "https://example.com" })).toBe(false);
    expect(web.props.onShouldStartLoadWithRequest({ url: "about:blank" })).toBe(true);
    expect(web.props.allowFileAccess).toBe(false); expect(web.props.domStorageEnabled).toBe(false);
    expect(h.node("Save signed observation").props.disabled).toBe(true);
    h.node("Cancel and keep counts").props.onPress(); expect(h.cancel).toHaveBeenCalledOnce(); expect(h.confirm).not.toHaveBeenCalled();
  });
  it("requires explicit acknowledgment and drawing then submits normalized data with honest null GPS", async () => {
    const h = await harness(); h.fill();
    await h.node("Save signed observation").props.onPress(); h.render();
    expect(h.confirm).toHaveBeenCalledOnce(); expect(h.confirm.mock.calls[0][0]).toMatchObject({ signer_name: "Alex Santos", acknowledgment: "CARGO_HANDOVER_V1", location: null });
    expect(h.text()).toContain("Location unavailable");
  });
  it("clears drawing, refuses malformed bridge data and locks repeated saves", async () => {
    const h = await harness(); h.fill();
    h.node("Clear signature").props.onPress(); h.render(); expect(h.node("Save signed observation").props.disabled).toBe(true);
    h.nodes().find(n => n.component === "WebView").props.onMessage({ nativeEvent: { data: "<svg onload=alert(1)>" } }); h.render();
    expect(h.text()).toContain("drawing"); expect(h.confirm).not.toHaveBeenCalled();
    h.fill(); let release; h.location.requestForegroundPermissionsAsync.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const save = h.node("Save signed observation").props.onPress;
    const pending = save(); await save(); expect(h.location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    release({ granted: false }); await pending; expect(h.confirm).toHaveBeenCalledOnce();
  });
  it("ignores a late location result after cancellation/unmount", async () => {
    const h = await harness(); h.fill(); let release;
    h.location.requestForegroundPermissionsAsync.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = h.node("Save signed observation").props.onPress(); h.unmount(); release({ granted: false }); await pending;
    expect(h.confirm).not.toHaveBeenCalled();
  });
});
