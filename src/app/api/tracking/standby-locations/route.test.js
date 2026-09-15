import { it, expect, vi } from 'vitest';
vi.mock('@/lib/api/utils',()=>({requirePermission:vi.fn(),handleError:error=>Response.json({error:error.message},{status:403})}));
vi.mock('@/services/standby.service',()=>({standbyLocations:vi.fn(async()=>[])}));
import { requirePermission } from '@/lib/api/utils';
import { standbyLocations } from '@/services/standby.service';
import { GET } from './route';

it('requires fleet read permission before reading standby GPS and prevents caching',async()=>{
 const response=await GET({});
 expect(requirePermission).toHaveBeenCalledWith({},'trips','read_all');
 expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 expect(await response.json()).toEqual([]);
 standbyLocations.mockClear();
 requirePermission.mockRejectedValueOnce(new Error('Forbidden'));
 expect((await GET({})).status).toBe(403);
 expect(standbyLocations).not.toHaveBeenCalled();
});
