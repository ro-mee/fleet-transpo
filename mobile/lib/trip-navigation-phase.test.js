import { describe, expect, it } from 'vitest';
import { navigationPhaseForStatus, legForNavigationPhase, legForStatus } from './trip-navigation-phase';

describe('mobile trip navigation phase', () => {
  it.each(['Pending', 'Approved', 'Assigned', 'Vehicle Assigned', 'Driver Assigned', 'Dispatched', 'Driver Accepted', 'Trip Started', 'At Pickup'])(
    'maps %s to pickup and leg1', status => {
      expect(navigationPhaseForStatus(status)).toBe('to_pickup');
      expect(legForStatus(status)).toBe('leg1');
    }
  );

  it.each(['Passenger Onboard', 'En Route', 'Drop-off', 'Arrived', 'In Progress'])(
    'maps %s to destination and leg2', status => {
      expect(navigationPhaseForStatus(status)).toBe('to_destination');
      expect(legForStatus(status)).toBe('leg2');
    }
  );

  it.each([null, undefined, '', 'Completed', 'Cancelled', 'Unexpected Status'])(
    'fails closed for %s', status => {
      expect(navigationPhaseForStatus(status)).toBeNull();
      expect(legForStatus(status)).toBeNull();
    }
  );

  it.each([['to_pickup', 'leg1'], ['to_destination', 'leg2'], [null, null], ['unexpected', null]])(
    'maps navigation phase %s to %s', (phase, leg) => {
      expect(legForNavigationPhase(phase)).toBe(leg);
    }
  );
});
