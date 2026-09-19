import { prepareDispatchRecommendation } from '@/services/dispatch-recommendation-preparation.service';
import { applyDispatchRadar } from '@/services/dispatch-radar.service';
import { conversationEvidence } from '@/lib/dispatch/conversation';

// Shared read-only simulation core (Phase 3). Used by the standalone
// simulate endpoint and by Copilot intent handling in the conversation route.
// Never writes: in-memory overlay only, persistRoute:false, no tokens.
export function validateScenario(scenario = {}) {
  const allowedKeys = ['pickup_datetime', 'passenger_count'];
  const extra = Object.keys(scenario).filter(k => !allowedKeys.includes(k));
  if (extra.length) throw new Error(`Unsupported simulation fields: ${extra.join(', ')}. Only pickup_datetime and passenger_count are supported.`);
  let pickupAt = null, passengers = null;
  if (scenario.pickup_datetime != null) {
    if (typeof scenario.pickup_datetime !== 'string' || scenario.pickup_datetime.length > 64 || !Number.isFinite(Date.parse(scenario.pickup_datetime)))
      throw new Error('Scenario pickup_datetime must be a valid ISO timestamp.');
    pickupAt = new Date(scenario.pickup_datetime).toISOString();
  }
  if (scenario.passenger_count != null) {
    if (!Number.isSafeInteger(scenario.passenger_count) || scenario.passenger_count < 1 || scenario.passenger_count > 60)
      throw new Error('Scenario passenger_count must be an integer from 1 to 60.');
    passengers = scenario.passenger_count;
  }
  if (!pickupAt && passengers == null) throw new Error('Provide pickup_datetime and/or passenger_count to simulate.');
  return { pickupAt, passengers };
}

const fmt = value => {
  try { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' (Philippine time)'; } catch { return null; }
};

export async function runReservationSimulation(request, scenario) {
  const { pickupAt, passengers } = validateScenario(scenario);
  const hypothetical = { ...request };
  if (pickupAt) { hypothetical.pickup_datetime = pickupAt; hypothetical.scheduled_arrival = null; }
  if (passengers != null) hypothetical.passenger_count = passengers;
  const prepared = await prepareDispatchRecommendation(hypothetical, { persistRoute: false });
  await applyDispatchRadar({ ...prepared, includePosition: false });
  const evidence = conversationEvidence(hypothetical, prepared.recommendation, null);
  return {
    label: 'Simulation — reservation unchanged.',
    interpreted: { pickupAt, pickupLocal: pickupAt ? fmt(pickupAt) : null, passengerCount: passengers },
    actual: { pickupAt: request.pickup_datetime, pickupLocal: request.pickup_datetime ? fmt(request.pickup_datetime) : null, passengerCount: request.passenger_count },
    options: (evidence.pairs ?? []).slice(0, 2).map(p => ({
      vehicleId: p.vehicleId, driverId: p.driverId, plate: p.plate, driverName: p.driverName,
      state: p.state, reasons: p.reasons?.slice(0, 2) ?? [],
      usableSlackMinutes: p.scheduleEvidence?.usableSlackMinutes ?? null,
    })),
    coverage: evidence.coverage,
    evaluatedAt: evidence.evaluatedAt,
    assignable: false,
  };
}
