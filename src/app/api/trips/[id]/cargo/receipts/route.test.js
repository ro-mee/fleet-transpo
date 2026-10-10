import { it, expect, vi } from 'vitest';
vi.mock('@/lib/api/utils',()=>({resolveIdentity:vi.fn(async()=>({user:{role:'driver',driverId:1,employeeId:1}})),AuthError:class extends Error {constructor(message,status,code){super(message);Object.assign(this,{status,code});}},ok:data=>Response.json(data),handleError:error=>Response.json({error:error.message,code:error.code},{status:error.status??500})}));
vi.mock('@/lib/api/ownership',()=>({assertTripOwnership:async()=>({trip_id:7,driver_id:1})}));
import { POST } from './route';
import { resolveIdentity } from '@/lib/api/utils';
const input={submission_id:'11111111-1111-4111-8111-111111111111',manifest_ref:{kind:'REQUEST',id:'11111111-1111-4111-8111-111111111111',revision:1,hash:'a'.repeat(64)},stage:'PICKUP',observed_at:'2026-10-09T08:00:00Z',lines:[{line_id:'oil',observed_quantity:'9',condition:'INTACT',issue_code:null,remarks:'',evidence_ids:[]}],receiver_confirmation_ref:null};
const run=()=>POST(new Request('http://localhost/api/trips/7/cargo',{method:'POST',...('POST'==='POST'?{body:JSON.stringify(input)}:{})}),{params:Promise.resolve({id:'7'})});
it('authenticates and returns stable disabled configuration error',async()=>{const response=await run();expect(response.status).toBe(503);expect((await response.json()).code).toBe('CARGO_CONFIGURATION_REQUIRED');});
it('refuses an unauthenticated request',async()=>{resolveIdentity.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'),{status:401,code:'SESSION_INVALID'}));expect((await run()).status).toBe(401);});