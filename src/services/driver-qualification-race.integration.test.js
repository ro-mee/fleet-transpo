import { expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@/lib/db', () => db);
import { loadDriverQualifications, setDriverQualification } from './driver-qualification.service';
it('concurrent retired-roster callers all refuse without acquiring database resources', async () => {
  const results = await Promise.allSettled([loadDriverQualifications([7]), setDriverQualification({ driverId: 7 }), loadDriverQualifications([7])]);
  expect(results.every(result => result.status === 'rejected' && result.reason.code === 'QUALIFICATION_ROSTER_RETIRED')).toBe(true);
  expect(db.query).not.toHaveBeenCalled(); expect(db.withTransaction).not.toHaveBeenCalled();
});
