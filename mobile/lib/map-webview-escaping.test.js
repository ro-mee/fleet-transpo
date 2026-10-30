import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  escapeHtmlText,
  finiteNumberInRange,
  normalizeRadarMarkers,
  serializeCssString,
  serializeInlineScriptValue,
} from "./map-webview-data";

const MAP_SCREEN = readFileSync("mobile/app/(app)/(tabs)/map.js", "utf8");

vi.mock("react", () => {
  const ReactMock = {
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...props,
          children: children.length <= 1 ? children[0] : children,
        },
      };
    },
    forwardRef(render) {
      return { render };
    },
    memo(component) {
      return component;
    },
    useEffect() {},
    useImperativeHandle(ref, create) {
      if (ref) ref.current = create();
    },
    useMemo(callback) {
      return callback();
    },
    useCallback(callback) {
      return callback;
    },
    useRef(current) {
      return { current };
    },
    useState(initial) {
      return [initial, () => {}];
    },
  };
  return { ...ReactMock, default: ReactMock };
});

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles) => styles },
  View: "View",
}));
vi.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ downloadAsync: async () => ({}) }) } }));
vi.mock("expo-file-system", () => ({}));
vi.mock("react-native-webview", () => ({ WebView: "WebView" }));
vi.mock("./theme-context", () => ({
  useTheme: () => ({
    scheme: "light",
    colors: {
      background: "#ffffff",
      outlineVariant: "#cccccc",
      surface: "#ffffff",
      onSurface: "#111111",
      primary: "#167a55",
      secondary: "#c48020",
      error: "#cc3344",
      onError: "#ffffff",
      onSecondary: "#111111",
      inverseSurface: "#222222",
      inverseOnSurface: "#ffffff",
      inversePrimary: "#aaddcc",
      secondaryContainer: "#eeeeee",
      onSecondaryContainer: "#222222",
      outline: "#aaaaaa",
      onSurfaceVariant: "#333333",
      onPrimary: "#ffffff",
    },
  }),
}));
vi.mock("./theme", () => ({
  palettes: {
    light: {
      background: "#ffffff",
      onSurface: "#111111",
      surface: "#ffffff",
      surfaceBright: "#eeeeee",
      surfaceContainerHigh: "#dddddd",
      surfaceContainerLow: "#f8f8f8",
      surfaceVariant: "#cccccc",
    },
    dark: {
      background: "#000000",
      onSurface: "#eeeeee",
      surface: "#111111",
      surfaceBright: "#222222",
      surfaceContainerHigh: "#333333",
      surfaceContainerLow: "#181818",
      surfaceVariant: "#444444",
    },
  },
}));

let TomTomMap;
beforeAll(async () => {
  ({ default: TomTomMap } = await import("../components/TomTomMap"));
});

function findNode(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
  } else {
    return findNode(children, predicate);
  }
  return null;
}

function buildWebView(props, ref = null) {
  const tree = TomTomMap.render(props, ref);
  const webView = findNode(tree, (node) => node.type === "WebView");
  if (!webView) throw new Error("TomTomMap did not render a WebView");
  return webView.props;
}

function buildHtml(props) {
  return buildWebView(props).source.html;
}

it('reports a fresh document load so a returning screen cannot reuse old readiness', () => {
  const onMapLoading = vi.fn();
  const props = buildWebView({ onMapLoading });
  props.onLoadStart();
  expect(onMapLoading).toHaveBeenCalledOnce();
});

function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
}

describe("WebView data serialization", () => {
  it("serializes values as safe inline-script expressions", () => {
    const payload = "Queen's \\\ < /script>\r\n\u2028\u2029";
    const literal = serializeInlineScriptValue(payload);
    expect(literal).not.toContain("<");
    expect(() => new Function(`return ${literal};`)).not.toThrow();
    expect(new Function(`return ${literal};`)()).toBe(payload);
  });

  it("encodes text for HTML and CSS contexts", () => {
    expect(escapeHtmlText(`<img src=x onerror="alert(1)">`))
      .toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(serializeCssString(`</style><script>\n"`)).not.toContain("<");
  });

  it("rejects invalid coordinates and emits only the marker fields needed by the map", () => {
    expect(finiteNumberInRange("0;alert(1)//", -90, 90)).toBeNull();
    expect(finiteNumberInRange("91", -90, 90)).toBeNull();
    const markers = normalizeRadarMarkers([
      {
        id: "trip_12",
        type: "assignment",
        title: "Passenger",
        lat: "14.6",
        lng: "121.0",
        tripId: 12,
        rawData: { secret: "not-for-the-webview" },
      },
      { title: "Invalid", lat: "0;alert(1)//", lng: 121 },
    ]);
    expect(markers).toHaveLength(1);
    expect(markers[0].lat).toBe(14.6);
    expect(markers[0]).not.toHaveProperty("rawData");
  });
});

describe("generated TomTomMap WebView document", () => {
  it("pauses periodic routing while hidden and refreshes an old route once on resume", () => {
    const script = inlineScripts(buildHtml({}))[0][2];
    const lifecycleStart = script.indexOf("window.__setMapActive = function");
    const lifecycleEnd = script.indexOf("window.__fleetPoint = function", lifecycleStart);
    const refreshStart = script.indexOf("// Periodic refresh:");
    const refreshEnd = script.indexOf("\n                  });", refreshStart);
    const requests = [];
    const intervals = [];
    const window = {
      __mapActive: true,
      currentCarLng: 121.01, currentCarLat: 14.61,
      currentDestLng: 121.1, currentDestLat: 14.7,
      lastCalcCarLng: 121, lastCalcCarLat: 14.6,
      lastRouteAt: 1,
      recalculateRoute: (...coordinates) => { requests.push(coordinates); },
    };
    runInNewContext(script.slice(lifecycleStart, lifecycleEnd) + script.slice(refreshStart, refreshEnd), {
      window, Date: { now: () => 600000 }, setInterval: callback => { intervals.push(callback); },
    });
    window.__setMapActive(false);
    intervals[0]();
    expect(requests).toEqual([]);
    window.__setMapActive(true);
    expect(requests).toEqual([]);
    window.__setMapActive(true);
    expect(requests).toHaveLength(0);
  });

  it('waits for a fresh captured fix before refreshing a resumed or expired GPS route', () => {
    const script = inlineScripts(buildHtml({}))[0][2];
    const start = script.indexOf('window.__setMapActive = function');
    const end = script.indexOf('window.__fleetPoint = function', start);
    const updateStart = script.indexOf('window.__updateFleetPositions = function');
    const updateEnd = script.indexOf('// Route geometry updates', updateStart);
    const refreshStart = script.indexOf('// Periodic refresh:');
    const refreshEnd = script.indexOf('\n                  });', refreshStart);
    const requests = [];
    const window = {
      __mapActive: true, currentCarLng: 121, currentCarLat: 14.6,
      currentFixObservedAt: 1000, currentDestLng: 121.1, currentDestLat: 14.7,
      lastCalcCarLng: 121, lastCalcCarLat: 14.6, lastRouteAt: 1000,
      recalculateRoute: (...point) => { requests.push(point); },
      __paintResponders() {}, __paintDriverPoint() {},
    };
    runInNewContext(script.slice(start, end) + script.slice(updateStart, updateEnd) + script.slice(refreshStart, refreshEnd), {
      window, Date: { now: () => 600000 }, setInterval() {}, requestAnimationFrame: () => 0,
    });
    window.__refreshRouteIfNeeded();
    expect(requests).toEqual([]);
    window.__setMapActive(false); window.__setMapActive(true);
    expect(requests).toEqual([]);
    window.__updateFleetPositions(14.68, 121.08, 0, [], 1000);
    expect(requests).toEqual([]);
    window.__updateFleetPositions(14.68, 121.08, 0, [], 600000);
    expect(requests).toEqual([[121.08, 14.68]]);
  });

  it("does not refresh a fresh parked route when focus returns", () => {
    const script = inlineScripts(buildHtml({}))[0][2];
    const start = script.indexOf("window.__setMapActive = function");
    const end = script.indexOf("window.__fleetPoint = function", start);
    const refreshStart = script.indexOf("// Periodic refresh:");
    const refreshEnd = script.indexOf("\n                  });", refreshStart);
    const requests = [];
    const window = {
      __mapActive: false,
      currentCarLng: 121, currentCarLat: 14.6, currentDestLng: 122,
      lastCalcCarLng: 121, lastCalcCarLat: 14.6, lastRouteAt: 590000,
      recalculateRoute: (...coordinates) => { requests.push(coordinates); },
    };
    runInNewContext(script.slice(start, end) + script.slice(refreshStart, refreshEnd), {
      window, Date: { now: () => 600000 }, setInterval() {},
    });
    window.__setMapActive(true);
    expect(requests).toEqual([]);
  });

  it('hides turn guidance and refuses off-route work after the GPS observation expires', () => {
    const script = inlineScripts(buildHtml({ showCarIcon: true }))[0][2];
    const start = script.indexOf('window.updateNavigationBanner = function');
    const end = script.indexOf('async function initMap', start);
    const header = { style: { display: 'flex' } }, recalculateRoute = vi.fn();
    const window = { currentFixObservedAt: 1000, currentDestLng: 121.1, routeCoords: [[121, 14.6]], routeInstructions: [], recalculateRoute };
    runInNewContext(script.slice(start, end), { window, document: { getElementById: () => header }, Date: { now: () => 600000 } });
    window.updateNavigationBanner(121, 14.6, { minDist: 100, closestIdx: 0 });
    expect(header.style.display).toBe('none');
    expect(recalculateRoute).not.toHaveBeenCalled();
  });

  it("reports unavailable map SDK initialization through the native bridge", async () => {
    const messages = [];
    const window = { addEventListener() {}, ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) } };
    const script = inlineScripts(buildHtml({}))[0][2];
    expect(() => runInNewContext(script, { window })).not.toThrow();
    await Promise.resolve();
    expect(messages).toContainEqual({ type: "MAP_ERROR", reason: "INITIALIZATION_FAILED" });
  });

  it("reports map load failure once, keeps readiness, and ignores later tile errors", async () => {
    const messages = [];
    const events = {};
    const window = { addEventListener() {}, ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) } };
    const map = { on: (name, handler) => { events[name] = handler; } };
    const script = inlineScripts(buildHtml({}))[0][2];
    runInNewContext(script, { window, tt: { setProductInfo() {}, map: () => map } });
    await Promise.resolve();
    expect(events.error).toBeTypeOf("function");
    events.error();
    events.error();
    expect(messages).toEqual([{ type: "MAP_ERROR", reason: "MAP_LOAD_FAILED" }]);
    events.load();
    events.error();
    expect(messages).toEqual([{ type: "MAP_ERROR", reason: "MAP_LOAD_FAILED" }, { type: "MAP_READY" }]);
  });

  it("refuses external navigation and file access without blocking the map document", () => {
    const view = buildWebView({});
    expect(view.onShouldStartLoadWithRequest).toBeTypeOf("function");
    for (const url of ["https://example.com", "file:///secret", "intent://app", "javascript:alert(1)", "https://api.tomtom.com"]) {
      expect(view.onShouldStartLoadWithRequest({ url })).toBe(false);
    }
    expect(view.onShouldStartLoadWithRequest({ url: "about:blank" })).toBe(true);
    expect(view.source.baseUrl).toBe("about:blank");
    expect(view.allowFileAccess).toBe(false);
    expect(view.allowFileAccessFromFileURLs).toBe(false);
    expect(view.allowUniversalAccessFromFileURLs).toBe(false);
    expect(view.javaScriptCanOpenWindowsAutomatically).toBe(false);
    expect(view.setSupportMultipleWindows).toBe(false);
  });

  it("deduplicates native failures and recovers on map readiness", () => {
    const failures = [];
    const view = buildWebView({ onMapError: error => failures.push(error) });
    expect(view.onError).toBeTypeOf("function");
    view.onError({ nativeEvent: { description: "do not leak provider URLs or details" } });
    view.onRenderProcessGone({ nativeEvent: { didCrash: true } });
    expect(failures).toEqual([{ type: "MAP_ERROR", reason: "WEBVIEW_LOAD_FAILED" }]);
    view.onMessage({ nativeEvent: { data: JSON.stringify({ type: "MAP_READY" }) } });
    view.onContentProcessDidTerminate();
    expect(failures).toEqual([
      { type: "MAP_ERROR", reason: "WEBVIEW_LOAD_FAILED" },
      { type: "MAP_ERROR", reason: "WEBVIEW_PROCESS_TERMINATED" },
    ]);
  });

  it("retains hidden state through loading and closes the GPS bridge after failure", () => {
    const ref = { current: null };
    const view = buildWebView({ origin: { lat: 14.6, lng: 121 }, showCarIcon: true }, ref);
    const activeStates = [];
    const positions = [];
    const window = {
      __setMapActive: active => { activeStates.push(active); },
      __updateFleetPositions: (...position) => { positions.push(position); },
    };
    view.ref.current = { injectJavaScript: script => runInNewContext(script, { window }) };
    ref.current.setMapActive(false);
    expect(activeStates).toEqual([]);
    view.onMessage({ nativeEvent: { data: JSON.stringify({ type: "MAP_READY" }) } });
    expect(activeStates).toEqual([false]);
    expect(positions).toHaveLength(1);
    view.onError();
    expect(ref.current.updateFleetPosition({ lat: 14.7, lng: 121.1 })).toBe(false);
    expect(positions).toHaveLength(1);
    view.onMessage({ nativeEvent: { data: JSON.stringify({ type: "MAP_READY" }) } });
    expect(activeStates).toEqual([false, false]);
    expect(positions).toHaveLength(2);
  });

  it('starts a replacement renderer hidden when its Map tab is already hidden', () => {
    const view = buildWebView({ mapActive: false });
    const states = [], window = { __setMapActive: active => states.push(active) };
    view.ref.current = { injectJavaScript: code => runInNewContext(code, { window }) };
    view.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'MAP_READY' }) } });
    expect(states).toEqual([false]);
  });

  it("moves standby coverage with the driver and retains the last valid heading", () => {
    const script = inlineScripts(buildHtml({
      origin: { lat: 14.6, lng: 121, heading: 270 },
      radarMode: true,
      showCarIcon: true,
    }))[0][2];
    const start = script.indexOf('window.__updateFleetPositions = function');
    const end = script.indexOf('// Route geometry updates', start);
    const updateCoverage = vi.fn();
    const window = {
      __mapActive: false,
      __paintResponders: vi.fn(),
      __paintDriverPoint: vi.fn(),
      updateRadarCirclePositions: updateCoverage,
      lastHeading: 270,
    };
    runInNewContext(script.slice(start, end), { window });
    window.__updateFleetPositions(14.61, 121.02, null, []);
    expect(updateCoverage).toHaveBeenCalledWith(121.02, 14.61);
    expect(window.lastHeading).toBe(270);
    expect(window.__paintDriverPoint).toHaveBeenCalledWith(121.02, 14.61);
  });

  it("keeps hostile booking data inside the generated script and parses the full script", () => {
    const attack = `</script><script>alert('map')</script>`;
    const html = buildHtml({
      origin: { lat: `14.6;alert('lat')`, lng: 121, heading: `0;alert('heading')` },
      destination: { lat: 91, lng: 121 },
      originAddress: attack,
      destAddress: `Queen's Hotel\\\nNorth Gate\u2028`,
      pickupLabel: `<img src=x onerror="alert(1)">`,
      dropoffLabel: `Queen's <svg onload=alert(1)>`,
      radarMarkers: [{
        id: "trip_12",
        type: "assignment",
        title: attack,
        lat: 14.6,
        lng: 121,
        distanceKm: 0.5,
        rawData: { passenger_name: attack },
      }],
    });

    const scripts = inlineScripts(html);
    expect(scripts).toHaveLength(1);
    expect((html.match(/<script\b/gi) || []).length).toBe(3);
    expect((html.match(/<\/script\s*>/gi) || []).length).toBe(3);
    expect(scripts[0][2]).toContain("\\u003c/script>");
    expect(scripts[0][2]).toContain("nameEl.textContent = m.title");
    expect(scripts[0][2]).not.toContain("labelEl.innerHTML");
    expect(scripts[0][2]).not.toContain("not-for-the-webview");
    expect(scripts[0][2]).not.toContain("0;alert('lat')");
    expect(scripts[0][2]).not.toContain("0;alert('heading')");
    expect(() => new Function(scripts[0][2])).not.toThrow();
  });
});

// Assignment pins come from real server data; fabricated gas stations and
// fleet drivers must stay behind the development-only gate.
describe("TomTomMap demo entity gating", () => {
  it("gates fabricated entities in development and retains real assignments", () => {
    expect(MAP_SCREEN).toMatch(/const DEMO_ENTITY_MODE = __DEV__;/);
    const guard = MAP_SCREEN.indexOf("if (!DEMO_ENTITY_MODE) return list;");
    expect(guard).toBeGreaterThan(-1);
    expect(MAP_SCREEN.indexOf("const nearbyGasStations")).toBeGreaterThan(guard);
    expect(MAP_SCREEN.indexOf("const nearbyDrivers")).toBeGreaterThan(guard);
    expect(MAP_SCREEN).not.toMatch(/if \(!driverLocation \|\| !__DEV__\) return \[\]/);
  });

  it("does not fabricate coordinates for real assignments without coordinates", () => {
    const code = MAP_SCREEN.split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/lat \+ 0\.0\d\d/);
    const start = MAP_SCREEN.indexOf('function getOperationalRadarMarkers');
    const end = MAP_SCREEN.indexOf('export const MAP_EMPTY_STATES', start);
    const pins = runInNewContext(MAP_SCREEN.slice(start, end) + ";getOperationalRadarMarkers({lat:14.6,lng:121},[{trip_id:7,origin_latitude:null,origin_longitude:null}],'Passenger')", { DEMO_ENTITY_MODE: false });
    expect(pins).toHaveLength(0);
  });
});
