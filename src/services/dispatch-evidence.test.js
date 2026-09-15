import { it,expect,vi } from 'vitest';
vi.mock('@/lib/api/utils',()=>({AuthError:class extends Error {}}));
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db',()=>({query:mocks.query,withTransaction:vi.fn(fn=>fn({query:mocks.query}))}));
import { query } from '@/lib/db';
import { commitDispatchEvidence } from './dispatch-evidence.service';

it('commits only unchanged, unexpired evidence while holding the write lock',async()=>{
  query.mockResolvedValue({rows:[{revision:'current'}]});
  const write=vi.fn(async()=>({saved:true}));
  const token={revision:'current',driverId:1,vehicleId:2,expiresAt:new Date(Date.now()+30_000).toISOString()};
  expect(await commitDispatchEvidence(token,write)).toEqual({saved:true});
  expect(query.mock.calls[0][0]).toContain('LOCK TABLE');
  write.mockClear();
  await expect(commitDispatchEvidence({...token,revision:'old'},write)).rejects.toThrow('changed');
  await expect(commitDispatchEvidence({...token,expiresAt:new Date(0)},write)).rejects.toThrow('changed');
  expect(write).not.toHaveBeenCalled();
});
