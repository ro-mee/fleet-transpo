import { expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@/lib/db', () => db);
import { loadDriverQualifications, setDriverQualification } from './driver-qualification.service';
// Migration 162 removed this roster. Its former SQL fixture must not recreate
// it and claim that the installed runtime can still use that model.
it('refuses retired roster access without connecting, reading or writing', async () => {
  await expect(loadDriverQualifications([7], db)).rejects.toMatchObject({ status: 503, code: 'QUALIFICATION_ROSTER_RETIRED' });
  await expect(setDriverQualification({ driverId: 7 })).rejects.toMatchObject({ status: 503, code: 'QUALIFICATION_ROSTER_RETIRED' });
  expect(db.query).not.toHaveBeenCalled();
  expect(db.withTransaction).not.toHaveBeenCalled();
});
