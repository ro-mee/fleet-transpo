import { expect, it } from 'vitest';
import * as shared from '../../../shared/privacy-policy';
import * as web from './policies';

it('exposes the same immutable policy data and version through existing web imports', () => {
  expect(web.PRIVACY_POLICY).toBe(shared.PRIVACY_POLICY);
  expect(web.CURRENT_PRIVACY_POLICY_VERSION).toBe(shared.CURRENT_PRIVACY_POLICY_VERSION);
  expect(shared.PRIVACY_POLICY.version).toBe(shared.CURRENT_PRIVACY_POLICY_VERSION);
  expect(shared.PRIVACY_POLICY.sections).toHaveLength(5);
});
