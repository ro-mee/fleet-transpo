// Regression tests for the WebView document TomTomMap.js generates.
//
// The whole map is ONE <script> block. A single dynamic trip value that closes
// its own quote, carries a line break, or emits "</script" makes the whole block
// a syntax error: initMap() never runs, the map's 'load' event never fires,
// MAP_READY is never posted to the native side, and the globe.json loading
// overlay spins forever. That is the failure mode the task calls out, and it
// is triggered by ordinary booking text ("Queen's Hotel", "Driver's Entrance"),
// not by adversarial input.
//
// These tests run the REAL helper functions extracted from the component source
// rather than a copy, so they cannot drift from the implementation.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync("mobile/components/TomTomMap.js", "utf8");
// The radar/entity builder lives on the map SCREEN, not in the WebView
// component, so its provenance rules are asserted against the screen's source.
const MAP_SCREEN = readFileSync("mobile/app/(app)/(tabs)/map.js", "utf8");

/** Pull one arrow-function helper out of the component source and evaluate it. */
function extractHelper(name) {
  const match = SOURCE.match(new RegExp(`const ${name} = \\(s\\) =>[\\s\\S]*?;\\r?\\n`));
  if (!match) throw new Error(`${name} not found in TomTomMap.js`);
  const context = vm.createContext({ String });
  vm.runInContext(`${match[0]}globalThis.${name} = ${name};`, context);
  return context[name];
}

const escapeJsString = extractHelper("escapeJsString");
const escapeHtml = extractHelper("escapeHtml");

/** Round-trip a value through a JS single-quoted literal and back. */
function roundTripSingleQuoted(value) {
  const literal = `'${escapeJsString(value)}'`;
  // The document never contains a raw line terminator inside its script block.
  expect(/\r|\n/.test(literal)).toBe(false);
  // The literal MUST be evaluated as source rather than compared as a string —
  // that is the whole point: it proves the WebView's parser would accept it.
  return new Function(`return ${literal};`)();
}

describe("TomTomMap WebView string escaping", () => {
  it("keeps ordinary apostrophes intact", () => {
    expect(roundTripSingleQuoted("Queen's Hotel")).toBe("Queen's Hotel");
    expect(roundTripSingleQuoted("Driver's Entrance")).toBe("Driver's Entrance");
  });

  it("does not let a value terminate the surrounding <script> block", () => {
    expect(roundTripSingleQuoted("</script><script>alert(1)</script>"))
      .toBe("</script><script>alert(1)</script>");
  });

  it("does not let a trailing backslash escape the closing quote", () => {
    // 'C:\path\' would otherwise swallow the closing quote and merge the next
    // line of the document into this string — a syntax error, whole map dead.
    expect(roundTripSingleQuoted("C:\\path\\")).toBe("C:\\path\\");
  });

  it("collapses newlines and carriage returns", () => {
    expect(roundTripSingleQuoted("Hotel\r\nTower")).toBe("Hotel Tower");
    expect(roundTripSingleQuoted("Line A\nLine B")).toBe("Line A Line B");
  });

  it("escapes the JS line terminators a text editor does not show", () => {
    // U+2028/U+2029 end a line for a JS parser but not for a person reading
    // the trip name, so this is the invisible version of the newline bug.
    expect(roundTripSingleQuoted("Hotel\u2028Tower\u2029")).toBe("Hotel\u2028Tower\u2029");
  });

  it("preserves Unicode destinations verbatim", () => {
    expect(roundTripSingleQuoted("Café亚太 ♪")).toBe("Café亚太 ♪");
    expect(roundTripSingleQuoted("Queen's Hotel 亚太")).toBe("Queen's Hotel 亚太");
  });

  it("survives a mixed torture value", () => {
    const nasty = `Queen's Hotel "D' <b>\\ </script>\u2028 亚太 ♪`;
    expect(roundTripSingleQuoted(nasty)).toBe(nasty);
  });

  it("handles null and undefined without throwing", () => {
    expect(escapeJsString(null)).toBe("");
    expect(escapeJsString(undefined)).toBe("");
    expect(escapeJsString(0)).toBe("0");
  });
});


describe("TomTomMap popup HTML escaping", () => {
  it("neutralises markup in a popup label", () => {
    // The labels also land in tt.Popup.setHTML(...), so a JS-string escape is
    // not enough — without HTML escaping the destination would inject markup
    // into the map popup.
    expect(escapeHtml("<img src=x onerror=alert(1)>"))
      .toBe("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes ampersands before the entities it introduces", () => {
    expect(escapeHtml("Queen's & Co <b>")).toBe("Queen's &amp; Co &lt;b&gt;");
  });

  it("leaves an ordinary destination untouched", () => {
    expect(escapeHtml("Queen's Hotel")).toBe("Queen's Hotel");
  });
});


// The fabricated gas stations / fleet drivers are the one thing in this feature
// that is not backed by the server. They must not be reachable from a
// production build, and the REAL assignment pins must not be collaterally
// suppressed by the same gate.
describe("TomTomMap demo entity gating", () => {
  it("gates the fabricated stations and drivers on a dev-only flag", () => {
    expect(MAP_SCREEN).toMatch(/const DEMO_ENTITY_MODE = __DEV__;/);
  });

  it("returns before the demo entity blocks when the flag is off", () => {
    const marker = "if (!DEMO_ENTITY_MODE) return list;";
    const at = MAP_SCREEN.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    // The demo gas-station and driver arrays must come AFTER the guard.
    expect(MAP_SCREEN.indexOf("const nearbyGasStations")).toBeGreaterThan(at);
    expect(MAP_SCREEN.indexOf("const nearbyDrivers")).toBeGreaterThan(at);
  });

  it("never fabricates coordinates for a real assignment without coordinates", () => {
    // `lat + 0.008` used to place a REAL dispatch pin ~900 m from wherever the
    // driver happened to be standing. Assert against EXECUTABLE lines only —
    // the comment explaining the old fallback names it too.
    const code = MAP_SCREEN.split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/lat \+ 0\.0\d\d/);
    expect(code).toMatch(/if \(t\.origin_latitude == null \|\| t\.origin_longitude == null\) return;/);
  });

  it("no longer suppresses every radar marker in production", () => {
    // The blanket `if (!driverLocation || !__DEV__) return []` also hid the
    // driver's own real pending assignments from production builds.
    expect(MAP_SCREEN).not.toMatch(/if \(!driverLocation \|\| !__DEV__\) return \[\]/);
  });
});
