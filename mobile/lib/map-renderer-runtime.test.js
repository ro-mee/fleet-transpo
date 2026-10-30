import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

const hooks = vi.hoisted(() => ({ cells: [], cursor: 0, effects: [] }));
vi.mock('react', () => {
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    forwardRef: render => ({ render }), memo: component => component,
    useRef(value) { const i = hooks.cursor++; return hooks.cells[i] ||= { current: value }; },
    useState(value) { const i = hooks.cursor++; if (!(i in hooks.cells)) hooks.cells[i] = value; return [hooks.cells[i], next => { hooks.cells[i] = next; }]; },
    useMemo(fn, deps) { const i = hooks.cursor++; if (!hooks.cells[i] || changed(hooks.cells[i].deps, deps)) hooks.cells[i] = { deps, value: fn() }; return hooks.cells[i].value; },
    useEffect(fn, deps) { const i = hooks.cursor++; if (!hooks.cells[i] || changed(hooks.cells[i].deps, deps)) { hooks.cells[i] = { deps }; hooks.effects.push(fn); } },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useImperativeHandle(ref, fn) { if (ref) ref.current = fn(); },
  };
  return { ...react, default: react };
});
vi.mock('react-native', () => ({ View: 'View', StyleSheet: { create: x => x }, Dimensions: { get: () => ({ width: 390, height: 800 }) }, PixelRatio: { roundToNearestPixel: x => x } }));
vi.mock('expo-asset', () => ({ Asset: { fromModule: () => ({ downloadAsync: async () => ({}) }) } }));
vi.mock('expo-file-system', () => ({}));
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }));
vi.mock('./theme-context', async () => {
  const { palettes } = await import('./theme');
  return { useTheme: () => ({ scheme: 'light', colors: palettes.light }) };
});
let TomTomMap;
beforeAll(async () => { ({ default: TomTomMap } = await import('../components/TomTomMap')); });

function renderer(initial = {}) {
  hooks.cells = []; hooks.effects = []; hooks.cursor = 0;
  let props = initial;
  const render = (patch = {}) => {
    props = { ...props, ...patch }; hooks.cursor = 0;
    return TomTomMap.render(props, null).props.children[0].props;
  };
  return { render, view: render(), flush: () => { hooks.effects.splice(0).forEach(fn => fn()); } };
}
const scriptFor = props => [...renderer(props).view.source.html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].find(m => !/\bsrc\s*=/.test(m[1]) && m[2].trim())[2];
const slice = (script, start, end) => script.slice(script.indexOf(start), script.indexOf(end, script.indexOf(start)));
function guidance(overrides = {}) {
  const nodes = new Map();
  const document = { getElementById: id => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, innerText: '', textContent: '', setAttribute() {}, getBoundingClientRect: () => ({ height: 112 }) });
    return nodes.get(id);
  } };
  const window = { currentFixObservedAt: 600000, __locationFresh: true, __mapActive: true,
    currentDestLng: 121.1, currentDestLat: 14.7,
    routeCoords: [[121, 14.6], [121.1, 14.7]], routeInstructions: [],
    getManeuverIcon: kind => kind, recalculateRoute: vi.fn(), ...overrides };
  const script = scriptFor({ showCarIcon: true });
  runInNewContext(slice(script, 'window.updateNavigationBanner = function', 'async function initMap'), { window, document, Date: { now: () => 600000 } });
  return { window, node: id => document.getElementById(id), update: (lng = 121, lat = 14.6) => window.updateNavigationBanner(lng, lat, { minDist: 0, closestIdx: 0 }) };
}

describe('truthful turn guidance', () => {
  it('keeps valid route geometry without guidance neutral at the start of a long route', () => {
    const h = guidance(); h.update();
    expect(h.node('navAction').innerText).toBe('Directions unavailable');
    expect(h.node('navStreet').innerText).not.toBe('Arrived');
  });
  it('shows arrival only near the current destination, even with no instructions', () => {
    const h = guidance(); h.update(121.1, 14.7);
    expect(h.node('navAction').innerText).toBe('Arrived');
  });
  it('does not obey a premature provider arrival maneuver far from the target', () => {
    const h = guidance({ routeInstructions: [{ maneuver: 'ARRIVE', message: 'You have arrived', routeOffsetInMeters: 100 }] }); h.update();
    expect(h.node('navAction').innerText).toBe('Continue to destination');
  });
  it('checks the observed fix even after the car is snapped near the destination', () => {
    const h = guidance({ __observedFix: { lng: 121, lat: 14.6, observedAt: 600000 } }); h.update(121.1, 14.7);
    expect(h.node('navAction').innerText).toBe('Directions unavailable');
  });
  it('keeps provider wording and road separate, including an unfamiliar maneuver', () => {
    const h = guidance({ routeInstructions: [{ maneuver: 'FERRY_BOARD', message: 'Board the ferry', street: 'Harbor Road', routeOffsetInMeters: 200 }, { maneuver: 'RIGHT', message: 'Turn right', street: 'Pier Lane', routeOffsetInMeters: 400 }] }); h.update();
    expect(h.node('navAction').innerText).toBe('Board the ferry');
    expect(h.node('navStreet').innerText).toBe('Harbor Road');
    expect(h.node('navThenText').innerText).toContain('Turn right');
    expect(h.node('navDistVal').innerText).toBe(200);
  });
  it('refuses an older delayed fix after a newer position was delivered', () => {
    const script = scriptFor({ showCarIcon: true });
    const window = { currentFixObservedAt: 600000, currentCarLng: 121.1, currentCarLat: 14.7, __mapActive: false, __paintResponders() {}, __paintDriverPoint() {} };
    runInNewContext(slice(script, 'window.__updateFleetPositions = function', '// Route geometry updates'), { window, Date: { now: () => 600000 } });
    window.__updateFleetPositions(14.6, 121, 0, [], 590000);
    expect(window.currentCarLng).toBe(121.1);
    expect(window.currentFixObservedAt).toBe(600000);
  });
  it('does not let an invalid future timestamp block the next valid fix', () => {
    const script = scriptFor({ showCarIcon: true });
    const window = { currentFixObservedAt: 590000, __mapActive: false, __paintResponders() {}, __paintDriverPoint() {} };
    runInNewContext(slice(script, 'window.__updateFleetPositions = function', '// Route geometry updates'), { window, Date: { now: () => 600000 } });
    window.__updateFleetPositions(14.7, 121.1, 0, [], 700000);
    window.__updateFleetPositions(14.6, 121, 0, [], 600000);
    expect(window.currentCarLng).toBe(121);
    expect(window.currentFixObservedAt).toBe(600000);
  });
  it('accepts a current fix after a cold mount supplies a far-future timestamp', async () => {
    const script = scriptFor({ showCarIcon: true, mapActive: false, origin: { lat: 14.6, lng: 121 }, locationObservedAt: 4200000 });
    const window = { addEventListener() {} };
    runInNewContext(script, {
      window, Date: { now: () => 600000 },
      document: { getElementById: () => ({ style: {} }) },
      tt: { map: () => ({ on() {}, setBearing() {} }) },
    });
    window.__updateFleetPositions(14.7, 121.1, 0, [], 600000);
    expect(window.currentCarLng).toBe(121.1);
    expect(window.currentCarLat).toBe(14.7);
    expect(window.currentFixObservedAt).toBe(600000);
    await Promise.resolve();
  });
  it('ignores an invalid future ordering watermark when a current fix arrives', () => {
    const script = scriptFor({ showCarIcon: true });
    const window = { currentFixObservedAt: 4200000, __mapActive: false, __paintResponders() {}, __paintDriverPoint() {} };
    runInNewContext(slice(script, 'window.__updateFleetPositions = function', '// Route geometry updates'), { window, Date: { now: () => 600000 } });
    window.__updateFleetPositions(14.7, 121.1, 0, [], 600000);
    expect(window.currentCarLng).toBe(121.1);
    expect(window.currentFixObservedAt).toBe(600000);
  });
  it.each([{ currentFixObservedAt: 1000 }, { __locationFresh: false }, { currentFixObservedAt: 640000 }])('hides guidance on stale, delayed or future evidence: %j', overrides => {
    const h = guidance(overrides); h.update(121.1, 14.7);
    expect(h.node('navHeader').style.display).toBe('none');
    expect(h.window.recalculateRoute).not.toHaveBeenCalled();
  });
});

describe('measured camera bridge', () => {
  it('updates measured viewport insets without replacing the loaded document', () => {
    const h = renderer({ topInset: 36, viewportInsets: { top: 50, bottom: 250, left: 0, right: 0 } });
    const scripts = []; h.view.ref.current = { injectJavaScript: js => scripts.push(js) };
    h.view.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'MAP_READY' }) } });
    hooks.effects = []; scripts.length = 0;
    const next = h.render({ topInset: 48, viewportInsets: { top: 180, bottom: 360, left: 4, right: 8 } }); h.flush();
    expect(next.source.html).toBe(h.view.source.html);
    const calls = [];
    scripts.forEach(js => runInNewContext(js, { window: { __setViewportInsets: (...args) => calls.push(args) } }));
    expect(calls).toContainEqual([{ top: 180, bottom: 360, left: 4, right: 8 }, 48]);
  });
  it('returns bounded measured directions height to the parent', () => {
    const heights = [];
    const h = renderer({ onNavigationLayout: value => heights.push(value) });
    for (const height of [112, -1, 'large', 0]) h.view.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'NAVIGATION_LAYOUT', height }) } });
    expect(heights).toEqual([{ height: 112 }, { height: 0 }]);
  });
  it('installs the bundled typeface through the bridge without replacing the document', async () => {
    const style = { textContent: '' }, window = { addEventListener() {} };
    runInNewContext(scriptFor({}), { window, document: { getElementById: () => style } });
    expect(window.__setMapFonts).toBeTypeOf('function');
    window.__setMapFonts('@font-face{font-family:FleetMap;src:url(data:font/ttf;base64,AA==)}');
    expect(style.textContent).toContain('data:font/ttf;base64,AA==');
    await Promise.resolve();
  });
  it('reserves the larger top overlay once and preserves a manually panned camera', () => {
    const script = scriptFor({});
    const calls = [], header = { style: {}, getBoundingClientRect: () => ({ height: 112 }) };
    const window = { __mapActive: true, innerWidth: 390, innerHeight: 800 };
    runInNewContext(slice(script, 'window.__cameraMode =', 'window.createGeoJsonCircle = function'), { window, document: { getElementById: () => header } });
    window.ttMap = {}; window.recenterMap = () => calls.push('follow'); window.isFollowing = true;
    window.__setViewportInsets({ top: 180, bottom: 300, left: 4, right: 8 }, 36);
    window.__navigationHeight = 112;
    expect(window.__cameraPadding()).toEqual({ top: 204, bottom: 324, left: 28, right: 32 });
    window.__cameraMode = 'manual'; window.isFollowing = false; calls.length = 0;
    window.__setViewportInsets({ top: 200, bottom: 350, left: 4, right: 8 }, 36);
    expect(calls).toEqual([]);
    expect(header.style.top).toBe('36px');
  });
  it('reports actual wrapping/hidden directions height and updates only the chosen camera mode', () => {
    const script = scriptFor({}); let height = 112;
    const messages = [], header = { style: { display: 'flex' }, getBoundingClientRect: () => ({ height }) };
    const window = { __mapActive: true, ReactNativeWebView: { postMessage: json => messages.push(JSON.parse(json)) } };
    runInNewContext(slice(script, 'window.__cameraMode =', 'window.createGeoJsonCircle = function'), { window, document: { getElementById: () => header } });
    window.__reportNavigationLayout(); window.__reportNavigationLayout(); height = 150; window.__reportNavigationLayout();
    header.style.display = 'none'; window.__reportNavigationLayout();
    expect(messages).toEqual([{ type: 'NAVIGATION_LAYOUT', height: 112 }, { type: 'NAVIGATION_LAYOUT', height: 150 }, { type: 'NAVIGATION_LAYOUT', height: 0 }]);
  });
  it('clears a previous document height when a new map starts with no directions', () => {
    const script = scriptFor({}), messages = [];
    const window = { ReactNativeWebView: { postMessage: json => messages.push(JSON.parse(json)) } };
    runInNewContext(slice(script, 'window.__cameraMode =', 'window.createGeoJsonCircle = function'), { window, document: { getElementById: () => ({ style: { display: 'none' } }) } });
    window.__reportNavigationLayout(); window.__reportNavigationLayout();
    expect(messages).toEqual([{ type: 'NAVIGATION_LAYOUT', height: 0 }]);
  });
  it('keeps padding below map dimensions when large text and sheets nearly cover it', () => {
    const script = scriptFor({}); const window = { innerWidth: 320, innerHeight: 600 };
    runInNewContext(slice(script, 'window.__cameraMode =', 'window.createGeoJsonCircle = function'), { window });
    window.__viewportInsets = { top: 400, bottom: 450, left: 180, right: 180 };
    const pad = window.__cameraPadding();
    expect(pad.top + pad.bottom).toBeCloseTo(520);
    expect(pad.left + pad.right).toBeCloseTo(240);
  });
});

describe('map document assignment controls', () => {
  it('creates named native buttons for assignments and clusters without interpreting their names as HTML', () => {
    const script = scriptFor({}); const elements = [], messages = [], camera = [];
    const document = { createElement: tagName => { const el = { tagName, attrs: {}, style: {}, children: [], setAttribute(key, value) { this.attrs[key] = value; }, appendChild(child) { this.children.push(child); } }; elements.push(el); return el; } };
    const window = { __cameraPadding: () => ({ top: 24, bottom: 24, left: 24, right: 24 }), ttMap: { flyTo: options => camera.push(options), getZoom: () => 14 }, ReactNativeWebView: { postMessage: json => messages.push(JSON.parse(json)) } };
    class Marker { constructor(options) { this.options = options; } setLngLat() { return this; } addTo() { return this; } remove() {} }
    runInNewContext(slice(script, 'function getMarkerIconSymbol', 'window.updateCarRotation = function'), { window, document, tt: { Marker } });
    const hostile = '<svg onload=alert(1)>';
    window.renderRadarMarkers([{ id: 'a', lat: 14.6, lng: 121, title: hostile, distanceKm: 1 }], 3);
    const assignment = elements.find(el => el.className?.startsWith('radar-marker-item'));
    expect(assignment.tagName).toBe('button'); expect(assignment.type).toBe('button');
    expect(assignment.attrs['aria-label']).toContain(hostile);
    for (const key of ['Enter', ' ']) {
      const event = { key, stopPropagation: vi.fn(), preventDefault: vi.fn() };
      assignment.onkeydown(event); expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(event.preventDefault).not.toHaveBeenCalled();
    }
    const escape = { key: 'Escape', stopPropagation: vi.fn() }; assignment.onkeydown(escape); expect(escape.stopPropagation).not.toHaveBeenCalled();
    expect(assignment.children[1].children[0].textContent).toBe(hostile);
    assignment.onclick({ stopPropagation() {} });
    expect(messages[0]).toMatchObject({ type: 'MARKER_TAPPED', marker: { id: 'a' } });
    window.renderRadarMarkers([{ lat: 14.6, lng: 121 }, { lat: 14.6001, lng: 121.0001 }], 3);
    const cluster = elements.find(el => el.className === 'radar-cluster-badge');
    expect(cluster.tagName).toBe('button'); expect(cluster.attrs['aria-label']).toContain('2 nearby dispatches');
    cluster.onclick({ stopPropagation() {} });
    expect(camera[0]).toMatchObject({ zoom: 16 }); expect(window.isFollowing).toBe(false);
  });
});
