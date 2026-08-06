import {
  getAccessToken,
  getRefreshToken,
  saveTokens,
  clearAll,
} from "./storage";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

if (!BASE_URL) {
  console.warn(
    "EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env and point it at your dev machine's LAN IP."
  );
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Called when the refresh token is itself rejected — the session is
 * unrecoverable and the app must return to the login screen. The root layout
 * registers the handler so this module doesn't need to import the router.
 */
let onSessionExpired = () => {};
export function setSessionExpiredHandler(fn) {
  onSessionExpired = fn;
}

/**
 * A single in-flight refresh shared by every concurrent 401.
 *
 * Without this, a screen firing three requests at once on a stale token would
 * run three refreshes; because refresh is single-use and rotating, the first
 * would succeed and the other two would present an already-revoked token and
 * log the driver out.
 */
let refreshPromise = null;

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) throw new ApiError("No refresh token", 401);

    const res = await fetch(`${BASE_URL}/api/mobile/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      await clearAll();
      onSessionExpired();
      throw new ApiError("Session expired", 401);
    }

    const data = await res.json();
    await saveTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    return data.accessToken;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * fetch wrapper that attaches the bearer token and transparently retries once
 * after refreshing on a 401.
 */
let driverTripsState = [
  {
    trip_id: "TRIP-DRV-101",
    trip_number: "TRIP-2026-880",
    origin_address: "Port of Manila, South Harbor Pier 3",
    destination_address: "Laguna Technopark, Building 12",
    trip_status: "En Route",
    cargo_description: "Automotive Spare Parts & Lubricants",
    scheduled_start_time: "2026-08-01T07:30:00Z",
    notes: "Requires temperature logs upon arrival at site.",
    vehicle_code: "TRUCK-101",
    license_plate: "ABC-1234",
    plate_number: "ABC-1234",
    vehicle_id: "VEH-101",
  },
  {
    trip_id: "TRIP-DRV-102",
    trip_number: "TRIP-2026-881",
    origin_address: "Cavite Economic Zone",
    destination_address: "Ninoy Aquino Int'l Airport Cargo Terminal",
    trip_status: "Assigned",
    cargo_description: "Export Semiconductor Wafers",
    scheduled_start_time: "2026-08-02T14:00:00Z",
    notes: "High priority shipment. Coordinate with dispatch.",
    vehicle_code: "TRUCK-101",
    license_plate: "ABC-1234",
    plate_number: "ABC-1234",
    vehicle_id: "VEH-101",
  },
];

function handleDriverMock(path, options = {}) {
  if (path === "/api/mobile/driver/trips") {
    return driverTripsState;
  }
  if (path === "/api/mobile/driver/me") {
    const active = driverTripsState.find((t) =>
      ["Driver Accepted", "Trip Started", "En Route", "Arrived", "In Progress"].includes(t.trip_status)
    );
    return {
      id: "driver-demo-001",
      first_name: "John",
      last_name: "Doe",
      email: "john.driver@fleetops.com",
      phone: "+1 555-0188",
      activeTrip: active || driverTripsState[0],
      vehicle: {
        vehicle_id: "VEH-101",
        vehicle_code: "TRUCK-101",
        license_plate: "ABC-1234",
      },
    };
  }
  if (path.includes("/accept")) {
    const tripId = path.split("/trips/")[1]?.split("/")[0];
    const target = driverTripsState.find((t) => t.trip_id === tripId);
    if (target) {
      const body = options.body ? JSON.parse(options.body) : {};
      target.trip_status = body.accept ? "Driver Accepted" : "Declined";
    }
    return { success: true };
  }
  if (path.includes("/status") || path.includes("/trips/")) {
    const tripId = path.split("/trips/")[1]?.split("/")[0];
    const target = driverTripsState.find((t) => t.trip_id === tripId);
    if (target && options.body) {
      const body = JSON.parse(options.body);
      if (body.status) target.trip_status = body.status;
    }
    return { success: true };
  }
  if (path === "/api/mobile/fuel" || path === "/api/mobile/driver/location") {
    return { success: true };
  }
  return { success: true };
}

/**
 * fetch wrapper that attaches the bearer token and transparently retries once
 * after refreshing on a 401.
 */
export async function apiFetch(path, options = {}) {
  const { skipAuth = false, ...init } = options;

  let token = skipAuth ? null : await getAccessToken();

  if (token === "mock-driver-access-token") {
    return handleDriverMock(path, options);
  }

  const send = async (t) => {
    const headers = {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    };
    if (t) headers.Authorization = `Bearer ${t}`;
    return fetch(`${BASE_URL}${path}`, { ...init, headers });
  };

  let res = await send(token);

  if (res.status === 401 && !skipAuth) {
    // Access token expired mid-session; refresh once and replay the request.
    const fresh = await refreshAccessToken();
    res = await send(fresh);
  }

  if (res.status === 204) return null;

  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (HTML error page, empty body).
  }

  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, res.status);
  }

  return body;
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body, opts) =>
    apiFetch(path, { method: "POST", body: JSON.stringify(body), ...opts }),
  put: (path, body) =>
    apiFetch(path, { method: "PUT", body: JSON.stringify(body) }),
};
