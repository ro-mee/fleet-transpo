import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn()}));
vi.mock('@/lib/api/utils',()=>({requirePermission:vi.fn(),ok:body=>Response.json(body),handleError:e=>Response.json({error:e.message},{status:500})}));
vi.mock('@/lib/uvvrp/uvvrp.service',()=>({loadVehicleTravelContext:vi.fn(async()=>({date:new Date('2027-02-01T02:00:00Z'),policy:{enabled:false}})),vehicleCanTravel:vi.fn((v,_ctx,request)=>request?.load_type==='Cargo'||v.registration_expiry!=='2000-01-01')}));
vi.mock('@/services/driver-schedule.service',()=>({loadDriverScheduleContext:vi.fn(async()=>({}))}));
vi.mock('@/lib/scheduling/driver-schedule',()=>({driverBlockReason:vi.fn(()=>null)}));
import {query} from '@/lib/db';
import {vehicleCanTravel} from '@/lib/uvvrp/uvvrp.service';
import {GET} from './route';
let docs;
const vehicle={vehicle_id:2,plate_number:'TRK5678',fleet_asset_code:'FLT-002',category_id:1,required_license_class:'B',commissioning_status:'Ready',operational_use:'Cargo',cargo_capacity_kg:1000,vehicle_status:'Registration Expired',registration_expiry:'2000-01-01'};
beforeEach(()=>{
 vi.clearAllMocks();
 docs=['OR_CR','Insurance'].map(document_type=>({document_type,verification_status:'Verified',verified_at:'2026-09-01T00:00:00Z',verified_by:8,expiry_date:'2028-01-01'}));
 query.mockImplementation(async sql=>({rows:sql.includes('FROM vehicledocuments')?docs:sql.includes('FROM vehicles v')?[vehicle]:[]}));
});
const run=()=>GET(new Request('http://localhost/api/vehicles/available?operational_use=Cargo&min_cargo_kg=650&pickup_at=2027-02-01T02:00:00Z&return_at=2027-02-01T04:00:00Z'));
it('lists renewed typed docs despite stale registration projection only after actual road readiness',async()=>{
 expect(await (await run()).json()).toEqual([vehicle]);
 expect(query.mock.calls[0][0]).toContain("'Registration Expired'");
 expect(vehicleCanTravel).toHaveBeenCalledWith(vehicle,expect.anything(),{load_type:'Cargo'});
});
it('never lists typed vehicles without verified documents',async()=>{
 docs=[];
 expect(await (await run()).json()).toEqual([]);
 expect(vehicleCanTravel).not.toHaveBeenCalled();
});
