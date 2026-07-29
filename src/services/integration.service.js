import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getIntegrationLogs(filters = {}) {
  return apiFetch(`/api/integration/logs${buildQuery(filters)}`);
}

export async function logInboundEvent(args) {
  return apiFetch("/api/integration/inbound", { method: "POST", body: args });
}

export async function logOutboundEvent(args) {
  return apiFetch("/api/integration/outbound", { method: "POST", body: args });
}

export async function markIntegrationProcessed(logId) {
  return apiFetch(`/api/integration/logs/${logId}`, { method: "PUT", body: { status: "processed" } });
}

export async function markIntegrationFailed(logId, errorMessage) {
  return apiFetch(`/api/integration/logs/${logId}`, { method: "PUT", body: { status: "failed", error_message: errorMessage } });
}

export async function processInboundBooking(bookingData) {
  const log = await logInboundEvent({
    sourceSystem: bookingData.source_system || "PMS",
    eventType: "booking_created",
    externalBookingId: bookingData.external_booking_id,
    payload: bookingData,
  });
  try {
    const data = await apiFetch("/api/reservations", { method: "POST", body: {
      external_booking_id: bookingData.external_booking_id,
      integration_source: bookingData.source_system || "PMS",
      guest_name: bookingData.guest_name,
      guest_phone: bookingData.guest_phone,
      guest_email: bookingData.guest_email,
      guest_id: bookingData.guest_id,
      room_number: bookingData.room_number,
      bill_to_room: bookingData.bill_to_room || false,
      pickup_location: bookingData.pickup_location,
      dropoff_location: bookingData.dropoff_location,
      reservation_date: bookingData.reservation_date,
      pickup_time: bookingData.pickup_time,
      passenger_count: bookingData.passenger_count || 1,
      service_type_id: bookingData.service_type_id,
      booking_channel_id: bookingData.booking_channel_id,
      purpose: bookingData.purpose,
      notes: bookingData.notes,
      status: "Pending",
    }});
    await markIntegrationProcessed(log.log_id);
    return data;
  } catch (err) {
    await markIntegrationFailed(log.log_id, err.message);
    throw err;
  }
}
