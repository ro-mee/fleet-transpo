import { describe, it, expect } from 'vitest';
import { selectHomeTrips, homeTripAction, homeVehicleImage, HOME_UPCOMING_LIMIT } from './home-trips';

describe('Home assignment presentation', () => {
  it('accepts real optional vehicle photo fields and picks up a later refreshed photo', () => {
    const vehicle = { model: 'Hiace' };
    expect(homeVehicleImage(vehicle)).toBeNull();
    expect(homeVehicleImage(null)).toBeNull();
    for (const field of ['vehicle_image_url', 'vehicle_photo_url', 'image_url', 'photo_url', 'image', 'imageUrl']) {
      expect(homeVehicleImage({ ...vehicle, [field]: ' https://example.com/vehicle.jpg ' })).toBe('https://example.com/vehicle.jpg');
    }
    expect(homeVehicleImage({ image: {}, photo_url: 'javascript:bad', receipt_url: 'https://example.com/receipt.jpg' })).toBeNull();
    expect(homeVehicleImage({ image_url: '', photo_url: 'https://example.com/new.jpg' })).toBe('https://example.com/new.jpg');
  });
  it('pins the active trip first and passes through every other open trip in server order', () => {
    const active = { trip_id: 2, trip_status: 'En Route' };
    const next = { trip_id: 3, trip_status: 'Assigned' };
    expect(selectHomeTrips([{ trip_id: 1, trip_status: 'Completed' }, active, next, { trip_id: 4, trip_status: 'Cancelled' }], ['En Route']))
      .toEqual({ current: active, upcoming: [next] });
    expect(selectHomeTrips([], [])).toEqual({ current: null, upcoming: [] });
    expect(selectHomeTrips([next], [])).toEqual({ current: null, upcoming: [next] });
  });
  it('exposes all scheduled trips (not just two) so Home can render a capped dynamic list', () => {
    const first = { trip_id: 5, trip_status: 'Dispatched' };
    const second = { trip_id: 6, trip_status: 'Driver Accepted' };
    const third = { trip_id: 7, trip_status: 'Assigned' };
    expect(selectHomeTrips([first, second, third], []))
      .toEqual({ current: null, upcoming: [first, second, third] });
    expect(selectHomeTrips([first, second, { trip_id: 2, trip_status: 'En Route' }], ['En Route']))
      .toEqual({ current: { trip_id: 2, trip_status: 'En Route' }, upcoming: [first, second] });
  });
  it('caps the rendered upcoming list at three with the remainder behind the footer', () => {
    expect(HOME_UPCOMING_LIMIT).toBe(3);
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
