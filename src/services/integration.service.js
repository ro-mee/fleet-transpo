import { createClient } from "@/lib/supabase/client";

export async function getIntegrationLogs(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("integration_log")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.direction) query = query.eq("direction", filters.direction);
  if (filters.source_system) query = query.eq("source_system", filters.source_system);
  if (filters.event_type) query = query.eq("event_type", filters.event_type);
  if (filters.external_booking_id) query = query.eq("external_booking_id", filters.external_booking_id);
  if (filters.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function logInboundEvent({
  sourceSystem,
  eventType,
  referenceType = null,
  referenceId = null,
  externalBookingId = null,
  payload = null,
}) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("integration_log")
    .insert({
      direction: "inbound",
      source_system: sourceSystem,
      event_type: eventType,
      reference_type: referenceType,
      reference_id: referenceId,
      external_booking_id: externalBookingId,
      payload,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function logOutboundEvent({
  sourceSystem,
  eventType,
  referenceType = null,
  referenceId = null,
  externalBookingId = null,
  payload = null,
}) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("integration_log")
    .insert({
      direction: "outbound",
      source_system: sourceSystem,
      event_type: eventType,
      reference_type: referenceType,
      reference_id: referenceId,
      external_booking_id: externalBookingId,
      payload,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markIntegrationProcessed(logId) {
  const supabase = createClient();
  const { error } = await supabase
    .from("integration_log")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("log_id", logId);
  if (error) throw error;
}

export async function markIntegrationFailed(logId, errorMessage) {
  const supabase = createClient();
  const { error } = await supabase
    .from("integration_log")
    .update({ status: "failed", error_message: errorMessage, processed_at: new Date().toISOString() })
    .eq("log_id", logId);
  if (error) throw error;
}

export async function processInboundBooking(bookingData) {
  const supabase = createClient();
  const log = await logInboundEvent({
    sourceSystem: bookingData.source_system || "PMS",
    eventType: "booking_created",
    externalBookingId: bookingData.external_booking_id,
    payload: bookingData,
  });

  try {
    const reservation = {
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
    };

    const { data, error } = await supabase
      .from("vehiclereservations")
      .insert(reservation)
      .select()
      .single();

    if (error) throw error;

    await markIntegrationProcessed(log.log_id);
    return data;
  } catch (err) {
    await markIntegrationFailed(log.log_id, err.message);
    throw err;
  }
}
