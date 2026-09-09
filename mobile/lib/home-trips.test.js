import { describe, it, expect } from 'vitest';
import { selectHomeTrips, homeTripAction } from './home-trips';

describe('Home assignment presentation', () => {
  it('keeps current and next distinct, preserves server order, and excludes terminal rows', () => {
    const active = { trip_id: 2, trip_status: 'En Route' };
    const next = { trip_id: 3, trip_status: 'Assigned' };
    expect(selectHomeTrips([{ trip_id: 1, trip_status: 'Completed' }, active, next, { trip_id: 4, trip_status: 'Cancelled' }], ['En Route']))
      .toEqual({ current: active, next, secondNext: null, upcoming: [next] });
    expect(selectHomeTrips([], [])).toEqual({ current: null, next: null, secondNext: null, upcoming: [] });
    expect(selectHomeTrips([next], [])).toEqual({ current: null, next, secondNext: null, upcoming: [next] });
  });
  it('exposes the second scheduled trip so the no-current case can show two cards', () => {
    const first = { trip_id: 5, trip_status: 'Dispatched' };
    const second = { trip_id: 6, trip_status: 'Driver Accepted' };
    // Only meaningful without an active trip, but harmless with one.
    expect(selectHomeTrips([first, second], []))
      .toEqual({ current: null, next: first, secondNext: second, upcoming: [first, second] });
    expect(selectHomeTrips([first, second, { trip_id: 2, trip_status: 'En Route' }], ['En Route']))
      .toEqual({ current: { trip_id: 2, trip_status: 'En Route' }, next: first, secondNext: second, upcoming: [first, second] });
  });
  it('only exposes start after both inspection and departure gates pass', () => {
    const trip = { trip_status: 'Driver Accepted', pre_trip_status: 'Passed', earliest_start: '2026-09-09T00:00:00Z' };
    const opens = Date.parse(trip.earliest_start);
    expect(homeTripAction(trip, opens - 1)).toBe('Trip Details');
    expect(homeTripAction(trip, opens)).toBe('Start Trip');
    expect(homeTripAction({ ...trip, pre_trip_status: 'Failed' }, opens)).toBe('Trip Details');
    expect(homeTripAction({ ...trip, earliest_start: null }, opens)).toBe('Trip Details');
    expect(homeTripAction({ ...trip, earliest_start: 'invalid' }, opens)).toBe('Trip Details');
    expect(homeTripAction({ trip_status: 'En Route' }, opens)).toBe('Continue Trip');
  });
});
