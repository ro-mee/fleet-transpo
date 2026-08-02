import { TransportStatusEventSchema } from "@/lib/integration/contracts";

// ============================================================================
// Booking Gateway — the ONE seam between Fleet and the parent Booking subsystem.
//
// Fleet code depends only on this interface, never on Booking's database. Today
// Booking is not connected, so the mock implementation serves canned requests
// shaped EXACTLY like the future API (validated against the same contracts).
// Swapping in the real HTTP client later is a one-line env change with zero
// changes to Fleet business logic.
//
//   BOOKING_GATEWAY=mock  (default) -> MockBookingGateway
//   BOOKING_GATEWAY=http           -> HttpBookingGateway (stub until connected)
//
// Interface:
//   fetchPendingRequests(): Promise<TransportationRequest[]>
//       Pull transportation requests that Booking wants Fleet to handle.
//   acknowledgeStatus(event: TransportStatusEvent): Promise<{ delivered: boolean }>
//       Push a Fleet status change back to Booking.
// ============================================================================

// --- Mock canned data. Shaped identically to TransportationRequestSchema. ----
// Datetimes are static (no Date.now()) so the mock is deterministic.
const MOCK_REQUESTS = [
  {
    external_booking_id: "BK-2026-00101",
    source_system: "PMS",
    booking_reference: "RES-77120",
    guest_name: "Jordan Rivera",
    pickup_location: "Main Lobby",
    dropoff_location: "NAIA Terminal 3",
    pickup_datetime: "2026-08-10T14:30:00+08:00",
    passenger_count: 3,
    // Genuine guest requests only — things Fleet must physically accommodate.
    // The vehicle class belongs in requested_vehicle_type, not in here.
    special_requests: "2 large suitcases, child seat",
    requested_vehicle_type: "Airport Transfer Van",
    service_type_id: null,
    priority: "High",
    booking_status: "Approved",
  },
  {
    external_booking_id: "BK-2026-00102",
    source_system: "POS",
    booking_reference: "ORD-55031",
    guest_name: "Sam Delacruz",
    pickup_location: "Seaside Restaurant",
    dropoff_location: "City Center Mall",
    pickup_datetime: "2026-08-10T18:00:00+08:00",
    passenger_count: 2,
    special_requests: null,
    requested_vehicle_type: "Guest Shuttle",
    service_type_id: null,
    priority: "Normal",
    booking_status: "Approved",
  },
  {
    external_booking_id: "BK-2026-00103",
    source_system: "Web",
    booking_reference: "WEB-90887",
    guest_name: "Alex Tan",
    pickup_location: "Airport Arrivals",
    dropoff_location: "Grand Hotel Main Wing",
    pickup_datetime: "2026-08-11T09:15:00+08:00",
    passenger_count: 4,
    // "VIP guest" used to live in special_requests, which was the wrong home for
    // it: VIP-ness is a vehicle class Fleet already models as a category, not a
    // free-text note a dispatcher has to read and interpret. It now arrives as a
    // requested_vehicle_type and resolves to the VIP category at ingest.
    special_requests: "Meet and greet at arrivals gate",
    requested_vehicle_type: "Executive SUV",
    service_type_id: null,
    priority: "Urgent",
    booking_status: "Approved",
  },
];

class MockBookingGateway {
  constructor() {
    this.name = "mock";
  }

  async fetchPendingRequests() {
    // Return copies so callers can't mutate the canned source.
    return MOCK_REQUESTS.map((r) => ({ ...r }));
  }

  async acknowledgeStatus(event) {
    // Validate we're emitting a well-formed event even in mock mode, so a
    // contract regression is caught during development, not at integration time.
    TransportStatusEventSchema.parse(event);
    console.info(`[MockBookingGateway] status ack: ${event.external_booking_id} -> ${event.status}`);
    return { delivered: true };
  }
}

class HttpBookingGateway {
  constructor() {
    this.name = "http";
    this.baseUrl = process.env.BOOKING_API_URL || "";
    this.apiKey = process.env.BOOKING_API_KEY || "";
  }

  async fetchPendingRequests() {
    // Intentionally not implemented until the Booking subsystem is available.
    // Kept as an explicit stub so the wiring/contract exists and the failure is
    // loud rather than silently returning [].
    throw new Error(
      "HttpBookingGateway is not connected yet. Set BOOKING_GATEWAY=mock during development."
    );
  }

  async acknowledgeStatus() {
    throw new Error(
      "HttpBookingGateway is not connected yet. Set BOOKING_GATEWAY=mock during development."
    );
  }
}

let instance;

/**
 * Resolve the active gateway from BOOKING_GATEWAY (defaults to mock).
 * Cached for the lifetime of the server process.
 * @returns {MockBookingGateway | HttpBookingGateway}
 */
export function getBookingGateway() {
  if (instance) return instance;
  const mode = (process.env.BOOKING_GATEWAY || "mock").toLowerCase();
  instance = mode === "http" ? new HttpBookingGateway() : new MockBookingGateway();
  return instance;
}

// Test/reset hook (e.g. when env changes between requests in dev).
export function _resetBookingGateway() {
  instance = undefined;
}
