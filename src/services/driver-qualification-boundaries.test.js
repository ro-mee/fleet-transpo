import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: db.query, withTransaction: fn => fn(db) }));
import { qualificationRollout, qualificationFinding } from '@/lib/drivers/qualification-rollout';
import { guardDriverQualification, loadQualificationContext, qualificationSummary } from './driver-qualification-boundaries.service';

const approved = { group: 'CARGO', status: 'ACTIVE', verified_by: 8, verified_at: '2026-10-09T00:00:00Z', policy_version: 'fixture-v1', version: 2 };
function enforce() {
  vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'ENFORCE');
  vi.stubEnv('DRIVER_QUALIFICATION_POLICY_VERSION', 'fixture-v1');
  vi.stubEnv('DRIVER_QUALIFICATION_ROSTER_REVIEW', 'fixture-review');
  vi.stubEnv('DRIVER_QUALIFICATION_EXISTING_TRIPS', 'RECHECK');
}
beforeEach(() => { vi.unstubAllEnvs(); db.query.mockReset(); vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'OFF'); });
describe('qualification eligibility boundaries', () => {
  it('keeps OFF free of qualification reads and locks', async () => {
    expect(await loadQualificationContext([7])).toBeNull();
    expect(await guardDriverQualification({ driverId: 7, requestId: 3 }, db)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
  it('fails activation without the approved policy, reviewed roster and existing-trip decision', () => {
    vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'ENFORCE');
    expect(qualificationRollout()).toMatchObject({ mode: 'ENFORCE', configured: false });
    expect(qualificationFinding({ serviceCode: 'HOTEL_SUPPLY_TRANSFER' })).toMatchObject({ severity: 'blocking', code: 'QUALIFICATION_POLICY_DISABLED' });
  });
  it.each(['RESTAURANT_SUPPLY_PICKUP', 'RESTAURANT_FOOD_DELIVERY', 'HOTEL_SUPPLY_TRANSFER'])('shares the cargo approval for %s', serviceCode => {
    enforce();
    expect(qualificationFinding({ serviceCode, qualifications: [approved] })).toBeNull();
  });
  it('requires separate passenger approval and blocks unknown services', () => {
    enforce();
    expect(qualificationFinding({ serviceCode: 'GUEST_TRANSPORT', qualifications: [approved] })).toMatchObject({ code: 'DRIVER_SERVICE_QUALIFICATION_REQUIRED', detail: { required_group: 'PASSENGER' } });
    expect(qualificationFinding({ serviceCode: null, qualifications: [approved] })).toMatchObject({ severity: 'blocking' });
  });
  it('reports SHADOW as a warning without blocking', () => {
    vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'SHADOW');
    expect(qualificationFinding({ serviceCode: 'HOTEL_SUPPLY_TRANSFER' })).toMatchObject({ severity: 'warning' });
  });
  it('refuses retired roster activation without reading substitute approval rows', async () => {
    enforce();
    db.query.mockResolvedValue({ rows: [{ ...approved, driver_id: 9 }] });
    await expect(loadQualificationContext([9, 9, 12])).rejects.toMatchObject({ status: 503, code: 'QUALIFICATION_ROSTER_RETIRED' });
    expect(db.query).not.toHaveBeenCalled();
    expect(qualificationSummary(null, 9)).toBeUndefined();
  });
  it('locks the driver before resolving stored service and refuses revoked approval before the write', async () => {
    enforce();
    db.query.mockImplementation(async sql => ({ rows: sql.includes('FROM drivers') ? [{ driver_id: 7 }] : sql.includes('transportation_requests') ? [{ service_code: 'HOTEL_SUPPLY_TRANSFER' }] : [{ ...approved, status: 'REVOKED', driver_id: 7 }] }));
    await expect(guardDriverQualification({ driverId: 7, requestId: 3, serviceCode: 'GUEST_TRANSPORT' }, db)).rejects.toMatchObject({ code: 'QUALIFICATION_ROSTER_RETIRED', status: 503 });
    expect(db.query.mock.calls[0][0]).toContain('FROM drivers');
    expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE');
  });
  it('rejects a trip relinked after generic edit loaded its assignment', async () => {
    enforce();
    db.query.mockImplementation(async sql => ({ rows: sql.includes('FROM trips') ? [{ driver_id: 7, dispatch_id: 99 }] : [{ driver_id: 7 }] }));
    await expect(guardDriverQualification({ driverId: 7, tripId: 1, dispatchId: 8, expectedDispatchId: 8 }, db))
      .rejects.toMatchObject({ code: 'STALE_DISPATCH_EVIDENCE' });
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
