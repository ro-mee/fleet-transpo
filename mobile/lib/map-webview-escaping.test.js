import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
    useImperativeHandle() {},
    useMemo(callback) {
      return callback();
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

function buildHtml(props) {
  const tree = TomTomMap.render(props, null);
  const webView = findNode(tree, (node) => node.type === "WebView");
  if (!webView) throw new Error("TomTomMap did not render a WebView");
  return webView.props.source.html;
}

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
    expect(code).toMatch(/if \(t\.origin_latitude == null \|\| t\.origin_longitude == null\) return;/);
  });
});
