import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getReservations(filters = {}) {
  return apiFetch(`/api/reservations${buildQuery(filters)}`);
}

export async function getReservation(id) {
  return apiFetch(`/api/reservations/${id}`);
}

export async function getReservationConflicts(vehicleId, date, pickupTime, estimatedReturn) {
  return apiFetch(`/api/reservations/conflicts${buildQuery({ vehicle_id: vehicleId, date, pickup_time: pickupTime, estimated_return: estimatedReturn })}`);
}

export async function linkToExternalBooking(reservationId, externalBookingId, sourceSystem) {
  return apiFetch(`/api/reservations/${reservationId}`, { method: "PUT", body: { external_booking_id: externalBookingId, integration_source: sourceSystem } });
}

export async function getServiceTypes() {
  return apiFetch("/api/reservations/service-types");
}

export async function getBookingChannels() {
  return apiFetch("/api/reservations/booking-channels");
}
