const TO_PICKUP = new Set([
  'Pending', 'Approved', 'Assigned', 'Vehicle Assigned', 'Driver Assigned',
  'Dispatched', 'Driver Accepted', 'Trip Started', 'At Pickup',
]);

const TO_DESTINATION = new Set([
  'Passenger Onboard', 'En Route', 'Drop-off', 'Arrived', 'In Progress',
]);

export function navigationPhaseForStatus(status) {
  if (TO_PICKUP.has(status)) return 'to_pickup';
  if (TO_DESTINATION.has(status)) return 'to_destination';
  return null;
}

export function legForNavigationPhase(phase) {
  if (phase === 'to_pickup') return 'leg1';
  if (phase === 'to_destination') return 'leg2';
  return null;
}

export function legForStatus(status) {
  return legForNavigationPhase(navigationPhaseForStatus(status));
}
