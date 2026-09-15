import { beforeEach,it,expect,vi } from 'vitest';
vi.mock('@/lib/api/utils',()=>({AuthError:class extends Error { constructor(message,status){ super(message);this.status=status; } }}));
vi.mock('@/lib/db',()=>{const query=vi.fn();return {query,withTransaction:vi.fn(fn=>fn({query}))};});
vi.mock('@/services/driver-schedule.service',()=>({loadDriverScheduleContext:vi.fn(async()=>({schedules:new Map(),leave:new Map()}))}));
vi.mock('@/lib/ai/pair-scoring',()=>({resolveVehiclePairing:()=>({ok:true,driver:{driver_id:7}}),vehicleOperationallyAvailable:()=>true}));
import { query } from '@/lib/db';
import { publishStandby,setDuty,standbyLocations } from './standby.service';
const user={driverId:7,employeeId:4,familyId:'11111111-1111-1111-1111-111111111111'};
let state;
beforeEach(()=>{
 state={checked_in:true,consented:true,busy:false,standby_tracking_enabled:true,duty_started_at:new Date(Date.now()-60_000)};
 query.mockReset().mockImplementation(async(sql)=>{
   if(sql.includes('FROM vehicles WHERE'))return {rows:[{vehicle_id:2}]};
   if(sql.includes('SELECT d.*'))return {rows:[state]};
   if(sql.includes('SELECT 1 FROM mobile_refresh_tokens'))return {rows:[{exists:true}]};
   if(sql.includes('UPDATE drivers SET standby_latitude'))return {rows:[{location_observed_at:new Date()}]};
   return {rows:[]};
 });
});
const body=()=>({latitude:14.6,longitude:121,accuracy:10,recorded_at:new Date().toISOString(),driver_id:99,vehicle_id:99});
it('uses server identity/pairing and conditionally updates only newer observations',async()=>{
 expect((await publishStandby(user,body())).updated).toBe(true);
 const [sql,values]=query.mock.calls.find(([sql])=>sql.includes('UPDATE drivers SET standby_latitude'));
 expect(values[0]).toBe(7);expect(values[5]).toBe(2);expect(sql).toContain('location_observed_at<$4::timestamptz');
 expect(sql).not.toContain('current_latitude');
});
it('rejects stale, inaccurate, unchecked-in, opted-out and rescue-busy observations',async()=>{
 for(const change of [{recorded_at:new Date(Date.now()-91_000).toISOString()},{accuracy:101},{latitude:true}])
   await expect(publishStandby(user,{...body(),...change})).rejects.toThrow();
 for(const change of [{checked_in:false},{consented:false},{busy:true},{standby_tracking_enabled:false}]){
   const previous=state;state={...previous,...change};await expect(publishStandby(user,body())).rejects.toThrow();state=previous;
 }
 expect(query.mock.calls.some(([sql])=>sql.includes('UPDATE drivers SET standby_latitude'))).toBe(false);
});
it('ending duty invalidates standby presence in the attendance transaction',async()=>{
 await setDuty(7,false);
 expect(query.mock.calls.some(([sql])=>sql.includes('time_out=NOW()'))).toBe(true);
 expect(query.mock.calls.some(([sql])=>sql.includes('standby_tracking_enabled=false, standby_session_family=NULL'))).toBe(true);
});

it('exposes only fresh consented on-duty standby positions, with no fake trip or private storage fields',async()=>{
 const implementation=query.getMockImplementation();
 query.mockImplementation(async(sql,...args)=>sql.includes('SELECT d.driver_id, e.first_name')
   ? {rows:[{driver_id:7,first_name:'Test',last_name:'Driver',plate_number:'TEST'}]}
   : implementation(sql,...args));
 state={...state,session_live:true,location_vehicle_id:2,standby_latitude:14.6,standby_longitude:121,
   location_accuracy_m:10,location_observed_at:new Date()};
 const positions=await standbyLocations();
 expect(positions).toHaveLength(1);
 expect(positions[0]).toMatchObject({tracking_id:'standby-7',vehicle_status:'Standby',latitude:14.6,driver_name:'Test Driver'});
 expect(positions[0]).not.toHaveProperty('trip_id');
 expect(positions[0]).not.toHaveProperty('standby_latitude');
 for(const change of [{checked_in:false},{consented:false},{busy:true},{session_live:false},
   {standby_tracking_enabled:false},{location_vehicle_id:3},{location_accuracy_m:101},
   {standby_latitude:null},{location_observed_at:new Date(Date.now()-91_000)},
   {duty_started_at:new Date(Date.now()+10_000)}]) {
   const original=state;state={...state,...change};
   expect(await standbyLocations()).toEqual([]);state=original;
 }
});
