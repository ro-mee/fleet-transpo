import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  effects: [],
  settings: { locationTracking: true },
  get: vi.fn(),
  post: vi.fn(),
  position: vi.fn(),
  locationOwner: vi.fn(),
  setTrackedTrip: vi.fn(),
  captureTrackedTripRead: vi.fn(),
  apiListeners: new Set(),
  actorId: 23,
  sessionController: null,
}));

vi.mock("react", () => ({
  useCallback: fn => fn,
  useEffect: fn => { platform.effects.push(fn); },
  useRef: current => ({ current }),
  useState: initial => [typeof initial === "function" ? initial() : initial, vi.fn()],
}));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 1 },
  requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
  getCurrentPositionAsync: (...args) => platform.position(...args),
}));
vi.mock("./settings-context", () => ({ useSettings: () => ({ settings: platform.settings }) }));
vi.mock("./auth", () => ({ useAuth: () => ({ user: platform.actorId == null ? null : { employeeId: platform.actorId } }) }));
vi.mock("./cargo-sync", () => ({
  captureCargoSession: actorId => actorId == null ? null : { actorId, signal: platform.sessionController.signal },
  isCurrentCargoSession: session => Boolean(session && session.actorId === platform.actorId && session.signal === platform.sessionController.signal && !session.signal.aborted),
}));
vi.mock("./api", () => ({
  api: { get: (...args) => platform.get(...args), post: (...args) => platform.post(...args) },
  subscribeApiEvents: listener => {
    platform.apiListeners.add(listener);
    return () => platform.apiListeners.delete(listener);
  },
}));
vi.mock("./trip-location-owner", () => ({
  useTripLocationOwner: (...args) => platform.locationOwner(...args),
  setTrackedTrip: (...args) => platform.setTrackedTrip(...args),
  captureTrackedTripRead: (...args) => platform.captureTrackedTripRead(...args),
}));

let tracking;
let activeTripId;
let stopPoster;
let states;
const sampleAt = "2026-10-21T07:58:00.000Z";
const advisory = { geofence: { near_pickup: true }, monitor: { offRoute: true }, weather: { temperature: 25 } };

async function flush() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function mount(enabled = true) {
  tracking.useActiveTripGpsPoster(enabled);
  return platform.effects.pop()();
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T08:00:00Z"));
  platform.effects = [];
  platform.settings.locationTracking = true;
  platform.locationOwner.mockReset();
  platform.setTrackedTrip.mockReset().mockReturnValue(true);
  platform.captureTrackedTripRead.mockReset().mockReturnValue({ revision: 1 });
  platform.apiListeners.clear();
  platform.actorId = 23;
  platform.sessionController = new AbortController();
  activeTripId = 7;
  states = [];
  platform.get.mockReset().mockImplementation(async url => {
    if (url === "/api/mobile/driver/trips") return activeTripId ? [{ trip_id: activeTripId, trip_status: "En Route" }] : [];
    if (url === "/api/mobile/driver/ref") return { statusGroups: { active: ["En Route"] } };
    if (url === "/api/driver/incidents?role=responder") return [];
    if (url === "/api/mobile/driver/duty") return { checkedIn: false };
    throw new Error(`Unexpected read ${url}`);
  });
  platform.post.mockReset().mockResolvedValue(advisory);
  platform.position.mockReset().mockResolvedValue({
    timestamp: new Date(sampleAt).getTime(),
    coords: { latitude: 14.6, longitude: 121, speed: 12, accuracy: 5 },
  });
  tracking = await import("./tracking");
  tracking.subscribePosterStatus(value => states.push(value));
});

afterEach(() => {
  stopPoster?.();
  stopPoster = null;
  vi.useRealTimers();
});

function expectCleared(status, activeTripId) {
  expect(status).toMatchObject({
    activeTripId,
    geofence: null,
    geofenceTripId: null,
    monitor: null,
    monitorTripId: null,
    weather: null,
    weatherTripId: null,
    advisoryObservedAt: null,
  });
}

function completeTrip(tripId) {
  for (const listener of platform.apiListeners) listener({ type: "trip-completed", tripId });
}

describe("foreground GPS advisory scope and observation time", () => {
  it("passes the canonical active trip to app-level location ownership", async () => {
    stopPoster = mount();
    await flush();
    expect(platform.setTrackedTrip).toHaveBeenLastCalledWith({ trip_id: 7, trip_status: "En Route" }, { revision: 1 });
    activeTripId = null;
    await vi.advanceTimersByTimeAsync(60000);
    expect(platform.setTrackedTrip).toHaveBeenLastCalledWith(null, { revision: 1 });
  });

  it("does not configure the uploader from a trip read rejected by the shared owner", async () => {
    platform.setTrackedTrip.mockReturnValueOnce(false);
    stopPoster = mount(); await flush();
    expect(platform.position).not.toHaveBeenCalled();
    expect(platform.post).not.toHaveBeenCalled();
    expect(states.at(-1).activeTripId).toBeNull();
  });

  it.each(["signed-out", "disabled-setting"])("disables app-level location ownership when %s", reason => {
    if (reason === "disabled-setting") platform.settings.locationTracking = false;
    stopPoster = mount(reason !== "signed-out");
    expect(platform.locationOwner).toHaveBeenCalledWith(false);
  });

  it("keeps the original GPS sample time when a post finishes minutes later", async () => {
    let release;
    platform.post.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    stopPoster = mount();
    await flush();
    expect(states.at(-1).motionFixAt).toBe(sampleAt);
    vi.advanceTimersByTime(120000);
    release(advisory);
    await flush();
    expect(states.at(-1)).toMatchObject({
      ...advisory,
      activeTripId: 7,
      geofenceTripId: 7,
      monitorTripId: 7,
      weatherTripId: 7,
      advisoryObservedAt: sampleAt,
      lastSentAt: "2026-10-21T08:02:00.000Z",
    });
    expect(platform.post).toHaveBeenCalledWith("/api/mobile/driver/trips/7/gps", expect.objectContaining({ recorded_at: sampleAt }), { queueOnFailure: false });
  });

  it("clears every old advisory immediately when a different trip is found", async () => {
    stopPoster = mount();
    await flush();
    expect(states.at(-1).geofenceTripId).toBe(7);
    await vi.advanceTimersByTimeAsync(30000);
    activeTripId = 8;
    platform.position.mockImplementationOnce(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(30000);
    expectCleared(states.at(-1), 8);
  });

  it("clears every old advisory when the active trip ends", async () => {
    stopPoster = mount();
    await flush();
    activeTripId = null;
    await vi.advanceTimersByTimeAsync(60000);
    expectCleared(states.at(-1), null);
  });

  it.each(["signed-out", "disabled-setting", "unmount"])("clears advisory state on %s", async reason => {
    stopPoster = mount();
    await flush();
    stopPoster();
    stopPoster = null;
    if (reason === "signed-out") mount(false);
    if (reason === "disabled-setting") {
      platform.settings.locationTracking = false;
      mount();
    }
    expectCleared(states.at(-1), null);
  });

  it("ignores an old in-flight response after tracking is replaced for another trip", async () => {
    let release;
    platform.post.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    stopPoster = mount();
    await flush();
    stopPoster();
    activeTripId = 8;
    stopPoster = mount();
    await flush();
    expect(states.at(-1).geofenceTripId).toBe(8);
    const current = states.at(-1);
    release({ geofence: { near_destination: true }, monitor: { old: true }, weather: { temperature: 99 } });
    await flush();
    expect(states.at(-1)).toBe(current);
    expect(states.at(-1).geofence).toEqual({ near_pickup: true });
  });

  it("discards a delayed GPS response after confirmed completion of its trip", async () => {
    let release;
    platform.post.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    stopPoster = mount();
    await flush();
    completeTrip("7");
    expectCleared(states.at(-1), null);
    const cleared = states.at(-1);
    release(advisory);
    await flush();
    expect(states.at(-1)).toBe(cleared);
    activeTripId = 8;
    await vi.advanceTimersByTimeAsync(30000);
    expect(states.at(-1).activeTripId).toBe(8);
    expect(states.at(-1).geofenceTripId).toBe(8);
  });

  it("does not clear the active trip for another trip's completion event", async () => {
    stopPoster = mount();
    await flush();
    const current = states.at(-1);
    completeTrip(99);
    expect(states.at(-1)).toBe(current);
    expect(states.at(-1).geofenceTripId).toBe(7);
  });

  it("does not restore a completed trip from an older in-flight assignment read", async () => {
    stopPoster = mount();
    await flush();
    const get = platform.get.getMockImplementation();
    let release;
    platform.get.mockImplementation(url => url === "/api/mobile/driver/trips"
      ? new Promise(resolve => { release = resolve; })
      : get(url));
    await vi.advanceTimersByTimeAsync(60000);
    completeTrip(7);
    release([{ trip_id: 7, trip_status: "En Route" }]);
    await flush();
    expectCleared(states.at(-1), null);
  });

  it("does not start posting a completed trip from the initial pending assignment read", async () => {
    const get = platform.get.getMockImplementation();
    let release;
    platform.get.mockImplementation(url => url === "/api/mobile/driver/trips"
      ? new Promise(resolve => { release = resolve; })
      : get(url));
    stopPoster = mount();
    await flush();
    completeTrip(7);
    release([{ trip_id: 7, trip_status: "En Route" }]);
    await flush();
    expect(platform.setTrackedTrip).not.toHaveBeenCalled();
    expect(platform.post).not.toHaveBeenCalled();
    expectCleared(states.at(-1), null);
  });

  it("clears immediately on a session change and ignores the previous actor's delayed post", async () => {
    let release;
    platform.post.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    stopPoster = mount();
    await flush();
    platform.sessionController.abort();
    platform.actorId = 24;
    platform.sessionController = new AbortController();
    expectCleared(states.at(-1), null);
    const cleared = states.at(-1);
    release(advisory);
    await flush();
    expect(states.at(-1)).toBe(cleared);
  });

  it("cannot configure location ownership from a previous actor's delayed trip read", async () => {
    const get = platform.get.getMockImplementation();
    let release;
    platform.get.mockImplementation(url => url === "/api/mobile/driver/trips"
      ? new Promise(resolve => { release = resolve; })
      : get(url));
    stopPoster = mount();
    await flush();
    platform.sessionController.abort();
    platform.actorId = 24;
    platform.sessionController = new AbortController();
    release([{ trip_id: 7, trip_status: "En Route" }]);
    await flush();
    expect(platform.setTrackedTrip).not.toHaveBeenCalled();
    expectCleared(states.at(-1), null);
    expect(platform.post).not.toHaveBeenCalled();
  });
});
