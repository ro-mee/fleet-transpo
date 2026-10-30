import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api/utils', () => ({ requirePermission: vi.fn(async () => ({ user: { role: 'fleet_manager', employeeId: 2 } })), ok: data => Response.json(data), err: (error,status=400) => Response.json({error},{status}), handleError: e => Response.json({ error: e.message }, { status: e.status || 500 }) }));
vi.mock('@/services/cargo-review.service', () => ({ listInternalCargoReviews: vi.fn(async () => ({ rows: [], total: 0, page: 1, limit: 20 })) }));
import { GET } from './route';
import { requirePermission } from '@/lib/api/utils';
import { listInternalCargoReviews } from '@/services/cargo-review.service';

describe('Cargo manager queue boundary', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses the manager-only permission and prevents caching private review data', async () => {
    const response = await GET(new Request('http://localhost/api/cargo-review?page=2&stage=pickup'));
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(expect.any(Request), 'cargo', 'review_internal');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listInternalCargoReviews).toHaveBeenCalledWith(expect.objectContaining({ page: '2', stage: 'pickup' }));
  });
  it('does not read any records after access is refused', async () => {
    requirePermission.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    expect((await GET(new Request('http://localhost/api/cargo-review'))).status).toBe(403);
    expect(listInternalCargoReviews).not.toHaveBeenCalled();
  });
  it('returns an actionable validation error for invalid queue filters', async () => {
    listInternalCargoReviews.mockRejectedValueOnce(Object.assign(new Error('Choose a valid Cargo stage.'), { status: 400 }));
    const response = await GET(new Request('http://localhost/api/cargo-review?stage=unknown'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Choose a valid Cargo stage.' });
  });
});
