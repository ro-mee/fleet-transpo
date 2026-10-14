import { describe, expect, it, vi } from 'vitest';
import { beginNavigationHandoff } from './navigation-handoff';

const trip = { trip_id: 7, trip_status: 'Trip Started', origin_latitude: 14.6, origin_longitude: 121, destination_latitude: 14.7, destination_longitude: 121.1 };

describe('ordered navigation handoff', () => {
  it.each(['Passenger', 'Cargo'])('prepares the correct leg before launching for %s', async load_type => {
    const calls = [];
    const prepare = async options => { calls.push(options); return { ok: true }; };
    const openUrl = async url => { calls.push(url); };
    const result = await beginNavigationHandoff({ trip: { ...trip, load_type, trip_status: 'En Route' }, prepare, openUrl });
    expect(result).toEqual({ ok: true, target: { lat: 14.7, lng: 121.1 } });
    expect(calls).toEqual([
      { tripId: 7, leg: 'leg2', requestPermission: true },
      'https://www.google.com/maps/dir/?api=1&destination=14.7%2C121.1&travelmode=driving&dir_action=navigate',
    ]);
  });
  it.each([null, { ...trip, trip_id: null }, { ...trip, trip_id: '' }, { ...trip, trip_status: 'Completed' }, { ...trip, trip_status: 'Unknown' }, { ...trip, pickup_location_provenance: 'pending_review' }, { ...trip, origin_latitude: null }])('rejects invalid trips before any permission request: %j', async value => {
    const prepare = vi.fn(), openUrl = vi.fn();
    expect(await beginNavigationHandoff({ trip: value, prepare, openUrl })).toEqual({ ok: false, reason: 'invalid-target' });
    expect(prepare).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });
  it.each(['permission-denied', 'start-failed', 'unsupported'])('does not launch after %s', async reason => {
    const openUrl = vi.fn();
    expect(await beginNavigationHandoff({ trip, prepare: async () => ({ ok: false, reason }), openUrl })).toMatchObject({ ok: false, reason });
    expect(openUrl).not.toHaveBeenCalled();
  });
  it('rolls back exactly once if the platform launch fails', async () => {
    const rollback = vi.fn().mockResolvedValue({ ok: true });
    expect(await beginNavigationHandoff({ trip, prepare: async () => ({ ok: true }), openUrl: async () => { throw new Error('unavailable'); }, rollback })).toMatchObject({ ok: false, reason: 'open-failed' });
    expect(rollback).toHaveBeenCalledOnce();
  });
  it('does not launch a trip that ended while permissions were pending', async () => {
    let current = true;
    const openUrl = vi.fn(), rollback = vi.fn();
    const result = await beginNavigationHandoff({ trip, isCurrent: () => current, prepare: async () => { current = false; return { ok: true }; }, openUrl, rollback });
    expect(result).toMatchObject({ ok: false, reason: 'stale-trip' });
    expect(openUrl).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
  });
  it('honors a permission-free preparation request', async () => {
    const prepare = vi.fn().mockResolvedValue({ ok: true });
    await beginNavigationHandoff({ trip, requestPermission: false, prepare, openUrl: async () => {} });
    expect(prepare).toHaveBeenCalledWith({ tripId: 7, leg: 'leg1', requestPermission: false });
  });
});
