import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { resolveDriverWorkspace } from './driver-workspace';

const source = readFileSync(new URL('../app/(app)/(tabs)/index.js', import.meta.url), 'utf8');
const callback = source.slice(source.indexOf('async (trip) => {', source.indexOf('const handleTripAction')), source.indexOf('}, [canManageTrip', source.indexOf('const handleTripAction')) + 1);
const statusWriter = source.slice(source.indexOf('async (trip, nextObj) => {', source.indexOf('const doAction')), source.indexOf('}, [load, canManageTrip', source.indexOf('const doAction')) + 1);
function setup({ status = 'At Pickup', type = 'Cargo', offline = false, confirmed = true, current = true, loadType = type, required = false } = {}) {
  const trip = { trip_id: 7, trip_status: status, odometer_capture_required: required, load_type: loadType, vehicle_id: 2, operational_use: type, pre_trip_status: 'Passed' };
  const api = { put: vi.fn() };
  const router = { push: vi.fn() };
  const modal = vi.fn();
  const deps = { canManageTrip: !offline && confirmed, driverProfile: { driverType: type }, resolveDriverWorkspace, confirmedSession: {}, isCurrentCargoSession: () => current,
    getNextStatus: async () => status === 'Drop-off' ? { status: 'Completed' } : { status: 'Passenger Onboard', action: 'onboard' }, router,
    setCompletingTrip: modal, AppAlert: { alert: vi.fn() }, preShiftPassed: true, setActingOn: vi.fn(), api, wasQueued: () => false, load: vi.fn() };
  deps.doAction = runInNewContext(`(${statusWriter})`, deps);
  return { action: runInNewContext(`(${callback})`, deps), trip, api, router, modal };
}
describe('real Home Cargo actions', () => {
  it('opens guarded Map at pickup without a direct onboard write', async () => {
    const h = setup(); await h.action(h.trip);
    expect(h.api.put).not.toHaveBeenCalled(); expect(h.router.push).toHaveBeenCalledWith('/map');
  });
  it('opens the actual completion form instead of the cached-mileage modal', async () => {
    const h = setup({ status: 'Drop-off' }); await h.action(h.trip);
    expect(h.modal).not.toHaveBeenCalled(); expect(h.api.put).not.toHaveBeenCalled();
    expect(h.router.push).toHaveBeenCalledWith({ pathname: '/(app)/trip/complete', params: { tripId: '7' } });
  });
  it.each([{ offline: true }, { confirmed: false }, { current: false }, { loadType: 'Passenger' }])('preserves the Home authority gate: %s', async options => {
    const h = setup(options); await h.action(h.trip);
    expect(h.api.put).not.toHaveBeenCalled(); expect(h.router.push).not.toHaveBeenCalled(); expect(h.modal).not.toHaveBeenCalled();
  });
  it('preserves Passenger terminal modal behavior', async () => {
    const h = setup({ status: 'Drop-off', type: 'Passenger' }); await h.action(h.trip);
    expect(h.modal).toHaveBeenCalledWith(h.trip); expect(h.router.push).not.toHaveBeenCalled();
  });
  it('sends required-photo Passenger completion to the shared screen', async () => {
    const h = setup({ status: 'Drop-off', type: 'Passenger', required: true }); await h.action(h.trip);
    expect(h.modal).not.toHaveBeenCalled(); expect(h.api.put).not.toHaveBeenCalled();
    expect(h.router.push).toHaveBeenCalledWith({ pathname: '/(app)/trip/complete', params: { tripId: '7' } });
  });
  it('preserves Passenger onboard through the real Home status writer', async () => {
    const h = setup({ type: 'Passenger' }); await h.action(h.trip);
    expect(h.api.put).toHaveBeenCalledWith('/api/trips/7/onboard', {}, { queueOnFailure: false });
  });
});
