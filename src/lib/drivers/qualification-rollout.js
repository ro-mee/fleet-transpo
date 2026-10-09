import { evaluateServiceQualification, groupForService } from './service-qualifications';

export function qualificationRollout(env = process.env) {
  const mode = env.DRIVER_QUALIFICATION_MODE || 'OFF';
  const policyVersion = env.DRIVER_QUALIFICATION_POLICY_VERSION?.trim() || null;
  const configured = ['OFF', 'SHADOW'].includes(mode) || (mode === 'ENFORCE' && !!policyVersion
    && !!env.DRIVER_QUALIFICATION_ROSTER_REVIEW?.trim()
    && env.DRIVER_QUALIFICATION_EXISTING_TRIPS === 'RECHECK');
  return { mode, policyVersion, configured };
}

export function qualificationFinding({ serviceCode, qualifications = [], rollout = qualificationRollout() } = {}) {
  if (rollout.mode === 'OFF') return null;
  const group = groupForService(serviceCode);
  const qualification = qualifications.find(row => row.group === group);
  const verdict = evaluateServiceQualification({ serviceCode, qualification });
  const policyMatches = !!rollout.policyVersion && qualification?.policy_version === rollout.policyVersion;
  if (rollout.configured && verdict.eligible && policyMatches) return null;
  const disabled = !rollout.configured;
  return {
    type: 'driver_service_qualification',
    code: disabled ? 'QUALIFICATION_POLICY_DISABLED' : 'DRIVER_SERVICE_QUALIFICATION_REQUIRED',
    severity: rollout.mode === 'SHADOW' ? 'warning' : 'blocking',
    message: disabled ? 'Driver qualification enforcement requires an approved policy, reviewed roster and existing-trip decision.'
      : group ? `The driver needs a current ${group === 'CARGO' ? 'Cargo Logistics' : 'Passenger'} approval for this service.`
        : 'The stored service must be identified before driver qualification can be checked.',
    detail: { required_group: group, service_code: serviceCode ?? null, qualification_version: qualification?.version ?? 0,
      qualification_code: !policyMatches && verdict.eligible ? 'QUALIFICATION_POLICY_STALE' : verdict.code, mode: rollout.mode },
  };
}
