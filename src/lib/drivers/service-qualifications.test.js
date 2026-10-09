import { describe, expect, it } from 'vitest';
import { evaluateServiceQualification, groupForService } from './service-qualifications';

const active = { group: 'CARGO', status: 'ACTIVE', policy_version: 'review-v1', verified_by: 21, verified_at: '2026-10-09T08:00:00Z' };
describe('explicit two-group driver qualification', () => {
  it.each([
    ['GUEST_TRANSPORT', 'PASSENGER'], ['VIP_GUEST_TRANSPORT', 'PASSENGER'],
    ['RESTAURANT_SUPPLY_PICKUP', 'CARGO'], ['RESTAURANT_FOOD_DELIVERY', 'CARGO'], ['HOTEL_SUPPLY_TRANSFER', 'CARGO'],
  ])('%s requires %s', (serviceCode, group) => {
    expect(groupForService(serviceCode)).toBe(group);
    expect(evaluateServiceQualification({ serviceCode, qualification: { ...active, group } })).toEqual({ eligible: true, code: null, group });
  });
  it.each(['UNKNOWN', 'SCM', '', null])('rejects unsupported service %s', serviceCode => {
    expect(groupForService(serviceCode)).toBeNull();
    expect(evaluateServiceQualification({ serviceCode, qualification: active })).toMatchObject({ eligible: false, code: 'SERVICE_UNKNOWN' });
  });
  it('cargo approval cannot authorize passenger transport', () => {
    expect(evaluateServiceQualification({ serviceCode: 'GUEST_TRANSPORT', qualification: active })).toMatchObject({ eligible: false, code: 'QUALIFICATION_REQUIRED' });
  });
  it.each([null, { ...active, status: 'SUSPENDED' }, { ...active, status: 'REVOKED' }])('rejects missing or inactive approval', qualification => {
    expect(evaluateServiceQualification({ serviceCode: 'HOTEL_SUPPLY_TRANSFER', qualification }).eligible).toBe(false);
  });
  it.each([{ verified_by: null }, { verified_by: 0 }, { verified_by: 1.2 }, { verified_at: null }, { verified_at: 'bad date' }, { policy_version: '' }, { policy_version: ' ' }])('rejects incomplete provenance %j', missing => {
    expect(evaluateServiceQualification({ serviceCode: 'HOTEL_SUPPLY_TRANSFER', qualification: { ...active, ...missing } })).toMatchObject({ eligible: false, code: 'QUALIFICATION_UNVERIFIED' });
  });
  it('allows each independently approved group on the same driver', () => {
    const records = [active, { ...active, group: 'PASSENGER' }];
    for (const [serviceCode, group] of [['GUEST_TRANSPORT', 'PASSENGER'], ['HOTEL_SUPPLY_TRANSFER', 'CARGO']]) {
      expect(evaluateServiceQualification({ serviceCode, qualification: records.find(record => record.group === group) }).eligible).toBe(true);
    }
  });
});
