import { serviceLoadFor } from '@/lib/integration/contracts';

export function groupForService(serviceCode) {
  const load = serviceLoadFor(serviceCode);
  return load === 'Passenger' ? 'PASSENGER' : load === 'Cargo' ? 'CARGO' : null;
}

export function evaluateServiceQualification({ serviceCode, qualification } = {}) {
  const group = groupForService(serviceCode);
  const reject = code => ({ eligible: false, code, group });
  if (!group) return reject('SERVICE_UNKNOWN');
  if (!qualification || qualification.group !== group) return reject('QUALIFICATION_REQUIRED');
  if (qualification.status !== 'ACTIVE') return reject('QUALIFICATION_INACTIVE');
  if (!Number.isSafeInteger(qualification.verified_by) || qualification.verified_by <= 0
    || !(qualification.verified_at instanceof Date || typeof qualification.verified_at === 'string')
    || !Number.isFinite(new Date(qualification.verified_at).getTime())
    || typeof qualification.policy_version !== 'string' || !qualification.policy_version.trim()) {
    return reject('QUALIFICATION_UNVERIFIED');
  }
  return { eligible: true, code: null, group };
}
