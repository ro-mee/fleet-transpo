import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/lib/db';
import { listInternalCargoReviews } from './cargo-review.service';

describe('internal Cargo review queue', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([{ page: '0' }, { page: '1.5' }, { limit: '101' }, { stage: 'unknown' }, { search: 'x'.repeat(101) }, {trip_id:'2147483648'}])('refuses invalid queue bounds: %j', async filters => {
    await expect(listInternalCargoReviews(filters)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });
  it('keeps total count even when the requested page is empty', async () => {
    query.mockImplementation(async sql => ({ rows: /COUNT\(\*\)/.test(sql) ? [{ total: 23 }] : [] }));
    expect(await listInternalCargoReviews({ page: '3', limit: '20' })).toMatchObject({ rows: [], total: 23, page: 3, limit: 20 });
    expect(query.mock.calls.every(([sql]) => sql.includes("source_system='INTERNAL'") && sql.includes("load_type='Cargo'"))).toBe(true);
  });
  it('parameterizes search, limits the page, and never returns private evidence in queue rows', async () => {
    query.mockImplementation(async sql => ({ rows: /COUNT\(\*\)/.test(sql) ? [{ total: 1 }] : [{ request_id: 7, reservation_number: 'RS-7', trip_id: 9, stage: 'pickup', pickup_location: 'Hotel', signature: 'private', password_hash: 'private' }] }));
    const result = await listInternalCargoReviews({ search: "hotel' OR 1=1 --", limit: '10' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).not.toHaveProperty('signature');
    expect(result.rows[0]).not.toHaveProperty('password_hash');
    expect(query.mock.calls.every(([sql]) => !sql.includes("hotel' OR 1=1"))).toBe(true);
    expect(query.mock.calls.some(([, args]) => args.includes("%hotel' OR 1=1 --%"))).toBe(true);
  });
});
