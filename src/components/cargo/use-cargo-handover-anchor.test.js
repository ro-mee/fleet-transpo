import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { expect, it, vi } from "vitest";

const code = (await transform(readFileSync(new URL("./use-cargo-handover-anchor.js", import.meta.url), "utf8"), { format: "cjs" })).code;
function harness() {
  const refs = []; let cursor = 0, effect, cleanup;
  const listeners = new Map(), location = { hash: "#cargo-chain-of-custody" };
  const target = { scrollIntoView: vi.fn(), focus: vi.fn() };
  const root = { scrollIntoView: vi.fn(), focus: vi.fn(), querySelector: vi.fn(() => target) };
  const react = { useRef: value => refs[cursor++] ||= { current: value }, useEffect: fn => { effect = fn; } };
  const scope = { exports: {} };
  runInNewContext(code, { module: scope, exports: scope.exports, require: () => react, window: { location, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) } });
  const render = (loading, tripId = 7) => { cleanup?.(); cursor = 0; scope.exports.useCargoHandoverAnchor(tripId, loading).current = root; cleanup = effect(); };
  return { root, target, render, location, hash: value => { location.hash = value; listeners.get("hashchange")?.(); } };
}

it("waits for delayed cargo loading, then follows the signature target once without opening private details", () => {
  const h = harness(); h.render(true); expect(h.target.scrollIntoView).not.toHaveBeenCalled();
  h.render(false); expect(h.target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  expect(h.target.focus).toHaveBeenCalledWith({ preventScroll: true });
  h.render(false); expect(h.target.scrollIntoView).toHaveBeenCalledTimes(1);
});

it("follows the cargo error section if configuration or manifest is unavailable", () => {
  const h = harness(); h.root.querySelector.mockReturnValue(null); h.render(false);
  expect(h.root.scrollIntoView).toHaveBeenCalledOnce(); expect(h.root.focus).toHaveBeenCalledOnce();
});

it("leaves normal trip visits in place and handles a later explicit fragment navigation", () => {
  const h = harness(); h.location.hash = ""; h.render(false); expect(h.target.scrollIntoView).not.toHaveBeenCalled();
  h.hash("#cargo-chain-of-custody"); expect(h.target.scrollIntoView).toHaveBeenCalledOnce();
  h.hash(""); h.hash("#cargo-chain-of-custody"); expect(h.target.scrollIntoView).toHaveBeenCalledTimes(2);
});

it("handles a different trip without jumping again on an ordinary refresh", () => {
  const h = harness(); h.render(false); h.render(true); h.render(false); expect(h.target.scrollIntoView).toHaveBeenCalledTimes(1);
  h.render(false, 8); expect(h.target.scrollIntoView).toHaveBeenCalledTimes(2);
});
