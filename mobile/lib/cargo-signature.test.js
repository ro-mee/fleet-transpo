import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { cargoSignatureHtml, parseCargoSignatureMessage, captureCargoSignatureLocation, cargoSignatureContextKey } from "./cargo-signature";

export const signedHandover = {
  version: 1, signer_name: "Alex Santos", signer_role_or_dept: "Receiving",
  acknowledgment: "CARGO_HANDOVER_V1", captured_at: "2026-10-20T02:00:00.000Z",
  signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80], [100, 40]]] }, location: null,
};
describe("isolated cargo drawing", () => {
  it("accepts only bounded numeric drawing messages, including an explicit clear", () => {
    expect(parseCargoSignatureMessage(JSON.stringify({ type: "signature", strokes: signedHandover.signature.strokes }))).toEqual(signedHandover.signature);
    expect(parseCargoSignatureMessage('{"type":"signature","strokes":[]}').strokes).toEqual([]);
    for (const value of ["<svg/>", JSON.stringify({ type: "signature", strokes: [[[601, 0]]] }), JSON.stringify({ type: "signature", strokes: [[[0, -1]]] }), JSON.stringify({ type: "signature", strokes: [[["2", 3]]] }), JSON.stringify({ type: "signature", strokes: Array(65).fill([[1, 2]]) }), JSON.stringify({ type: "signature", strokes: [Array(2049).fill([1, 2])] }), JSON.stringify({ type: "signature", strokes: [], html: "<script/>" }), "x".repeat(100001)]) expect(() => parseCargoSignatureMessage(value)).toThrow();
  });
  it("uses fixed canvas code without inserting caller markup and enforces browser point bounds", () => {
    const html = cargoSignatureHtml({ ink: '</script><script>alert(1)</script>', background: "#FBF8F3" });
    expect(html).toContain("default-src 'none'"); expect(html).not.toContain("alert(1)");
    const sent = [], handlers = {}, context = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
    const canvas = { getContext: () => context, addEventListener: (name, fn) => { handlers[name] = fn; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 240 }), setPointerCapture() {} };
    runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { document: { getElementById: () => canvas }, window: { ReactNativeWebView: { postMessage: data => sent.push(JSON.parse(data)) } } });
    handlers.pointerdown({ clientX: -20, clientY: -1, pointerId: 1, preventDefault() {} });
    handlers.pointermove({ clientX: 900, clientY: 300, preventDefault() {} });
    handlers.pointerup({ preventDefault() {} });
    expect(sent.at(-1).strokes).toEqual([[[0, 0], [600, 240]]]);
  });
});
describe("optional fresh signature location", () => {
  const now = Date.parse("2026-10-20T02:00:00Z");
  it("returns honest unavailable status on denial, stale fixes, invalid fixes and provider errors", async () => {
    const get = vi.fn();
    expect(await captureCargoSignatureLocation({ requestForegroundPermissionsAsync: async () => ({ granted: false }), getCurrentPositionAsync: get })).toBeNull();
    expect(get).not.toHaveBeenCalled();
    for (const fix of [{ timestamp: now - 120001, coords: { latitude: 1, longitude: 2, accuracy: 5 } }, { timestamp: now, coords: { latitude: 91, longitude: 2, accuracy: 5 } }, { timestamp: now, coords: { latitude: 1, longitude: 2, accuracy: null } }]) expect(await captureCargoSignatureLocation({ requestForegroundPermissionsAsync: async () => ({ granted: true }), getCurrentPositionAsync: async () => fix }, { now: () => now })).toBeNull();
    expect(await captureCargoSignatureLocation({ requestForegroundPermissionsAsync: async () => { throw new Error("unavailable"); } })).toBeNull();
  });
  it("bounds waiting and records only an actual fresh fix", async () => {
    expect(await captureCargoSignatureLocation({ requestForegroundPermissionsAsync: async () => ({ granted: true }), getCurrentPositionAsync: async () => ({ timestamp: now, coords: { latitude: 14.6, longitude: 121, accuracy: 8 } }) }, { now: () => now })).toEqual({ latitude: 14.6, longitude: 121, accuracy_m: 8, captured_at: new Date(now).toISOString() });
    expect(await captureCargoSignatureLocation({ requestForegroundPermissionsAsync: () => new Promise(() => {}) }, { timeoutMs: 1 })).toBeNull();
  });
  it("does not start a GPS request after permission timed out or the signer screen closed", async () => {
    let allow;
    const get = vi.fn(), location = { requestForegroundPermissionsAsync: () => new Promise(resolve => { allow = resolve; }), getCurrentPositionAsync: get };
    const waiting = captureCargoSignatureLocation(location, { timeoutMs: 1 });
    expect(await waiting).toBeNull(); allow({ granted: true }); await Promise.resolve(); await Promise.resolve();
    expect(get).not.toHaveBeenCalled();
    const cancelled = captureCargoSignatureLocation(location, { isCurrent: () => false });
    allow({ granted: true }); await cancelled; expect(get).not.toHaveBeenCalled();
  });
});
it("invalidates signer context for count, issue, stage, manifest, assignment and account changes", () => {
  const input = { identity: "12:701:PICKUP", manifestHash: "abc", assignment: "driver12:vehicle3:At Pickup", form: { counts: { a: "10" }, issues: {} } };
  const original = cargoSignatureContextKey(input);
  for (const change of [{ identity: "13:701:PICKUP" }, { identity: "12:701:DELIVERY" }, { manifestHash: "def" }, { assignment: "driver14:vehicle3:At Pickup" }, { form: { counts: { a: "9" }, issues: {} } }, { form: { ...input.form, issues: { a: { remarks: "Damaged" } } } }]) expect(cargoSignatureContextKey({ ...input, ...change })).not.toBe(original);
});
