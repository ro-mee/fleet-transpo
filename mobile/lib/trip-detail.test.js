import { describe, it, expect } from 'vitest';
import {
  detailPrimaryAction,
  readinessFor,
  completionTime,
  scheduledDeparture,
  passengerSummary,
} from './trip-detail';

const T0 = Date.parse('2026-09-09T08:00:00Z');
const OPENS = '2026-09-09T07:00:00Z';
const LATER = '2026-09-09T09:00:00Z';

describe('Trip detail primary action', () => {
  it('active trips are navigate-only — CONTINUE must never write accept/start', () => {
    for (const status of ['Trip Started', 'At Pickup', 'Passenger Onboard', 'En Route', 'Drop-off', 'Arrived', 'In Progress']) {
      expect(detailPrimaryAction({ trip_status: status })).toBe('navigate');
    }
  });

  it('pre-start trips take the accept-start flow; terminal trips are closed', () => {
    for (const status of ['Pending', 'Approved', 'Assigned', 'Vehicle Assigned', 'Driver Assigned', 'Dispatched', 'Driver Accepted']) {
      expect(detailPrimaryAction({ trip_status: status })).toBe('accept-start');
    }
    expect(detailPrimaryAction({ trip_status: 'Completed' })).toBe('closed');
    expect(detailPrimaryAction({ trip_status: 'Cancelled' })).toBe('closed');
    expect(detailPrimaryAction({})).toBeNull();
    expect(detailPrimaryAction(null)).toBeNull();
  });
});

describe('Trip detail start readiness', () => {
  it('requires both an opened window and a passed inspection', () => {
    const ready = readinessFor({ earliest_start: OPENS, pre_trip_status: 'Passed' }, T0);
    expect(ready.startReady).toBe(true);
    expect(ready.unavailableReason).toBeNull();

    const windowNotOpen = readinessFor({ earliest_start: LATER, pre_trip_status: 'Passed' }, T0);
    expect(windowNotOpen.startReady).toBe(false);
    expect(windowNotOpen.unavailableReason).toBe('window');
    expect(windowNotOpen.minsToStart).toBe(60);

    const inspectionBlocked = readinessFor({ earliest_start: OPENS, pre_trip_status: 'Failed' }, T0);
    expect(inspectionBlocked.startReady).toBe(false);
    expect(inspectionBlocked.unavailableReason).toBe('inspection');

    const noSchedule = readinessFor({ pre_trip_status: 'Passed' }, T0);
    expect(noSchedule.startReady).toBe(false);
    expect(noSchedule.unavailableReason).toBe('schedule');
    expect(noSchedule.minsToStart).toBeNull();
  });

  it('treats an invalid earliest_start as no schedule, not an open window', () => {
    expect(readinessFor({ earliest_start: 'invalid', pre_trip_status: 'Passed' }, T0).unavailableReason).toBe('schedule');
  });
});

describe('Trip detail display facts', () => {
  it('uses end_time as the verified completion time and never updated_at', () => {
    const ms = Date.parse('2026-09-09T10:14:00Z');
    expect(completionTime({ end_time: '2026-09-09T10:14:00Z' })).toBe(ms);
    // updated_at is a generic write timestamp, not an arrival.
    expect(completionTime({ updated_at: '2026-09-09T10:14:00Z' })).toBeNull();
    expect(completionTime({ end_time: 'invalid' })).toBeNull();
    expect(completionTime({})).toBeNull();
  });

  it('has no default departure time — missing means not provided', () => {
    expect(scheduledDeparture({ departure_time: '2026-09-09T10:00:00Z' })).toBe(Date.parse('2026-09-09T10:00:00Z'));
    expect(scheduledDeparture({})).toBeNull();
  });

  it('keeps supplied passenger facts and never invents a count or name', () => {
    expect(passengerSummary({ passenger_name: 'Maria Santos', passenger_count: 3 })).toEqual({ name: 'Maria Santos', count: 3 });
    // A supplied 0 is real data and survives.
    expect(passengerSummary({ passenger_name: 'Maria Santos', passenger_count: 0 })).toEqual({ name: 'Maria Santos', count: 0 });
    // Missing count stays null — it must not become 1.
    expect(passengerSummary({ passenger_name: 'Maria Santos' })).toEqual({ name: 'Maria Santos', count: null });
    expect(passengerSummary({ passenger_count: 2 })).toEqual({ name: null, count: 2 });
    expect(passengerSummary({})).toEqual({ name: null, count: null });
    expect(passengerSummary({ passenger_count: 'invalid' }).count).toBeNull();
  });
});
