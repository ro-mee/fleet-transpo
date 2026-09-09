import { describe, it, expect } from 'vitest';
import {
  IN_PROGRESS,
  PRE_START,
  bucketOf,
  isOverdue,
  bucketTone,
  groupTrips,
  BUCKET_ORDER,
  BUCKET_LABEL,
  OPEN_BUCKETS,
} from './trips-queue';

const T0 = Date.parse('2026-09-09T08:00:00Z');

describe('Trips queue bucketing', () => {
  it('buckets in-progress, terminal and unknown statuses', () => {
    for (const status of IN_PROGRESS) {
      expect(bucketOf({ trip_status: status }, T0)).toBe('inProgress');
    }
    expect(bucketOf({ trip_status: 'Completed' }, T0)).toBe('completed');
    expect(bucketOf({ trip_status: 'Cancelled' }, T0)).toBe('cancelled');
    // Unrecognized statuses land in upcoming, never silently dropped.
    expect(bucketOf({ trip_status: 'Something New' }, T0)).toBe('upcoming');
  });

  it('splits ready by whether a start window is actually known', () => {
    const opens = '2026-09-09T07:00:00Z';
    const later = '2026-09-09T09:00:00Z';
    for (const status of PRE_START) {
      expect(bucketOf({ trip_status: status, earliest_start: opens }, T0)).toBe('ready');
      expect(bucketOf({ trip_status: status, earliest_start: later }, T0)).toBe('upcoming');
      // Unknown earliest_start is its own bucket — not a verified READY claim.
      expect(bucketOf({ trip_status: status }, T0)).toBe('scheduleUnconfirmed');
      expect(bucketOf({ trip_status: status, earliest_start: null }, T0)).toBe('scheduleUnconfirmed');
      expect(bucketOf({ trip_status: status, earliest_start: 'invalid' }, T0)).toBe('scheduleUnconfirmed');
    }
  });

  it('keeps the list free of the inspection gate (detail owns it)', () => {
    // Inspection-failed trips still bucket as ready here; the detail screen
    // and the server stay decisive about the actual start.
    expect(bucketOf({ trip_status: 'Driver Accepted', earliest_start: '2026-09-09T07:00:00Z', pre_trip_status: 'Failed' }, T0)).toBe('ready');
  });

  it('marks only pre-start trips past their departure as overdue', () => {
    const past = '2026-09-09T06:00:00Z';
    expect(isOverdue({ trip_status: 'Assigned', departure_time: past }, T0)).toBe(true);
    expect(isOverdue({ trip_status: 'En Route', departure_time: past }, T0)).toBe(false);
    expect(isOverdue({ trip_status: 'Assigned', departure_time: '2026-09-09T10:00:00Z' }, T0)).toBe(false);
    expect(isOverdue({ trip_status: 'Assigned' }, T0)).toBe(false);
  });

  it('groups with overdue override, departure ordering, and empty buckets dropped', () => {
    const late = { trip_id: 1, trip_status: 'Assigned', departure_time: '2026-09-09T06:00:00Z', earliest_start: '2026-09-09T09:00:00Z' };
    const early = { trip_id: 2, trip_status: 'Driver Accepted', departure_time: '2026-09-09T10:00:00Z', earliest_start: '2026-09-09T07:00:00Z' };
    const otherReady = { trip_id: 5, trip_status: 'Dispatched', departure_time: '2026-09-09T11:00:00Z', earliest_start: '2026-09-09T07:00:00Z' };
    const active = { trip_id: 3, trip_status: 'En Route' };
    const sections = groupTrips([late, active, early, otherReady], T0);
    expect(sections.map((s) => s.bucket)).toEqual(['inProgress', 'overdue', 'ready']);
    // late is pre-start and past its departure → overdue despite a future window.
    expect(sections[1].items.map((t) => t.trip_id)).toEqual([1]);
    // Departure ascending inside the bucket.
    expect(sections[2].items.map((t) => t.trip_id)).toEqual([2, 5]);
    // Empty buckets (scheduleUnconfirmed, upcoming, cancelled) are absent.
    expect(sections.map((s) => BUCKET_LABEL[s.bucket])).toEqual(['IN PROGRESS', 'OVERDUE · ACTION REQUIRED', 'READY']);
  });

  it('exposes tones and open buckets consistently', () => {
    expect(bucketTone('OVERDUE · ACTION REQUIRED')).toBe('danger');
    expect(bucketTone('READY')).toBe('success');
    expect(bucketTone('SCHEDULE UNCONFIRMED')).toBe('warning');
    expect(bucketTone('NOPE')).toBe('neutral');
    // Open buckets are exactly the non-terminal prefix of the order.
    expect(BUCKET_ORDER.slice(0, OPEN_BUCKETS.length)).toEqual(OPEN_BUCKETS);
  });
});
