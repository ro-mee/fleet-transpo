import { assertTripOwnership } from '@/lib/api/ownership';
import { query } from '@/lib/db';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn(),withTransaction:vi.fn(async write=>write({query}))}));
vi.mock('@/lib/api/utils',()=>({requirePermission:vi.fn(async()=>({user:{employeeId:1}})),requireDriver:vi.fn(async()=>({user:{employeeId:1}})),parseBody:vi.fn(async req=>req.json()),ok:body=>Response.json(body),err:(error,status)=>Response.json({error},{status}),handleError:e=>Response.json({error:e.message},{status:e.status??500}),AuthError:class extends Error {constructor(message,status){super(message);this.status=status;}}}));
vi.mock('@/lib/api/ownership',()=>({assertTripOwnership:vi.fn(async()=>({trip_id:7,trip_status:'Assigned',driver_id:2,vehicle_id:3}))}));
vi.mock('@/services/trip-lifecycle.service',()=>({cancelTrip:vi.fn(async()=>({trip_status:'Cancelled'}))}));
vi.mock('@/services/driver-qualification-boundaries.service',()=>({guardDriverQualification:vi.fn(async()=>null)}));
vi.mock('@/services/transition.service',()=>({setTripStatus:vi.fn(async ({to,beforeWrite})=>{if(beforeWrite) await beforeWrite({query});return (await query('UPDATE trips SET trip_status = $1 RETURNING *',[to])).rows[0];})}));
import { PUT } from './route';
let assignment;
beforeEach(()=>{vi.clearAllMocks();assignment={trip_status:'Assigned',load_type:'Passenger',operational_use:'Passenger',driver_type:'Passenger'};query.mockImplementation(async sql=>({rows:sql.startsWith('UPDATE')?[{trip_status:'Driver Accepted'}]:[assignment]}));});
const run=(accept=true,extra={})=>PUT(new Request('http://localhost/accept',{method:'PUT',body:JSON.stringify({accept,...extra})}),{params:Promise.resolve({id:'7'})});
it.each([['Passenger','Passenger'],['Cargo','Cargo'],[null,'Passenger']])('accepts %s with %s',async(load_type,operational_use)=>{assignment={...assignment,load_type,operational_use,driver_type:operational_use};expect((await run()).status).toBe(200);expect(query.mock.calls.some(([sql])=>sql.includes('v.operational_use')&&sql.includes('tr.load_type'))).toBe(true);});
it.each([['Cargo','Passenger'],['Passenger','Cargo'],[null,'Cargo'],['Unknown','Passenger'],['Passenger',null],['Passenger','Unknown']])('rejects %s with %s before changes',async(load_type,operational_use)=>{assignment={...assignment,load_type,operational_use,driver_type:operational_use};const response=await run();expect(response.status).toBe(409);expect((await response.json()).error).toMatch(/dispatch|fleet/i);expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);});
it('checks before bridging a legacy status',async()=>{assignment={trip_status:'Dispatched',load_type:'Cargo',operational_use:'Passenger'};assertTripOwnership.mockResolvedValueOnce({trip_status:'Dispatched',driver_id:2,vehicle_id:3});expect((await run()).status).toBe(409);expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);});
it('still permits declining an incompatible assignment',async()=>{assignment={...assignment,load_type:'Cargo',operational_use:'Passenger'};expect((await run(false)).status).toBe(200);});

it('allows the legacy bridge only after compatibility is checked',async()=>{
 assignment={trip_status:'Dispatched',driver_type:'Passenger',load_type:'Passenger',operational_use:'Passenger'};
 assertTripOwnership.mockResolvedValueOnce({trip_status:'Dispatched',driver_id:2,vehicle_id:3});
 expect((await run()).status).toBe(200);
 const writes=query.mock.calls.filter(([sql])=>sql.startsWith('UPDATE'));expect(writes).toHaveLength(2);
 expect(query.mock.calls.findIndex(([sql])=>sql.includes('v.operational_use'))).toBeLessThan(query.mock.calls.findIndex(([sql])=>sql.startsWith('UPDATE')));
});

it.each([
 ['Passenger','Cargo','Cargo','Cargo'],
 ['Cargo','Passenger','Passenger','Passenger'],
 [null,'Passenger','Passenger','Passenger'],
])('rejects saved %s on %s despite a forged client type %s',async(driver_type,operational_use,load_type,clientType)=>{
 assignment={trip_status:'Assigned',driver_type,load_type,operational_use};
 const response=await run(true,{driverType:clientType});
 expect(response.status).toBe(409);
 expect((await response.json()).error).toMatch(/driver|vehicle|dispatch|fleet/i);
 const compatibilityQuery=query.mock.calls.find(([sql])=>sql.includes('v.operational_use'));
 expect(compatibilityQuery[0]).toContain('d.driver_type');
 expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it.each([
 ['Heavy','an unsupported',/not supported/i],
 ['','an empty',/needs setup/i],
])('rejects %s saved driver type before changes',async(driver_type,label,message)=>{
 assignment={trip_status:'Assigned',driver_type,load_type:'Cargo',operational_use:'Cargo'};
 const response=await run();
 expect(response.status).toBe(409);
 expect((await response.json()).error).toMatch(message);
 expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
