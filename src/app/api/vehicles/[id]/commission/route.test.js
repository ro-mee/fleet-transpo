import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({requireAuth:vi.fn(),query:vi.fn(),audit:vi.fn()}));
vi.mock('@/lib/db',()=>({withTransaction:fn=>fn({query:mocks.query})}));
vi.mock('@/lib/audit',()=>({writeAuditRequired:mocks.audit}));
vi.mock('@/lib/api/utils',async()=>({...await vi.importActual('@/lib/api/utils'),requireAuth:mocks.requireAuth}));
import { POST } from './route';
const vehicle={vehicle_id:7,plate_number:'ABC1234',fleet_asset_code:'FLT-007',operational_use:'Cargo',cargo_capacity_kg:1000,required_license_class:'B',category_id:1,commissioning_status:'Pending'};
const docs=['OR_CR','Insurance'].map((document_type,i)=>({document_id:i+1,document_type,file_url:'/evidence/scan.pdf',document_number:'DOCUMENT-'+i,expiry_date:'2028-01-01'}));
const call=body=>POST(new Request('https://fleet.test/api/vehicles/7/commission',{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}}),{params:Promise.resolve({id:'7'})});
beforeEach(()=>{
 vi.clearAllMocks();mocks.requireAuth.mockResolvedValue({user:{employeeId:8,role:'admin'}});
 mocks.query.mockImplementation(async sql=>({rows:sql.includes('FROM vehicles')?[vehicle]:sql.includes('FROM vehicledocuments')?docs:sql.includes('UPDATE vehicles')?[{...vehicle,commissioning_status:'Ready'}]:[]}));
});
it('requires admin/super_admin authorization and an explicit confirmation', async()=>{
 expect((await call({document_ids:[1,2]})).status).toBe(400);
 expect(mocks.requireAuth).toHaveBeenCalledWith(expect.anything(),['admin','super_admin']);
});
it('attests stored evidence and commissions inside the audited transaction',async()=>{
 const res=await call({confirm:true,document_ids:[1,2]});
 expect(res.status).toBe(200);
 expect(mocks.query.mock.calls.find(([sql])=>sql.includes('UPDATE vehicledocuments'))[1]).toEqual([7,[1,2],8]);
 expect(mocks.audit).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.anything(),expect.objectContaining({action:'verify',resource:'vehicles',resourceId:7}));
});
it('rejects stale selection, missing scans and missing static vehicle evidence',async()=>{
 expect((await call({confirm:true,document_ids:[3,4]})).status).toBe(409);
 mocks.query.mockImplementation(async sql=>({rows:sql.includes('FROM vehicles')?[vehicle]:sql.includes('FROM vehicledocuments')?docs.map(d=>({...d,file_url:null})):[]}));
 expect((await call({confirm:true,document_ids:[1,2]})).status).toBe(400);
 mocks.query.mockImplementation(async sql=>({rows:sql.includes('FROM vehicles')?[{...vehicle,required_license_class:null}]:sql.includes('FROM vehicledocuments')?docs:[]}));
 expect((await call({confirm:true,document_ids:[1,2]})).status).toBe(400);
 expect(mocks.query.mock.calls.some(([sql])=>sql.includes('UPDATE vehicles'))).toBe(false);
});
it('refuses commissioning during blocking maintenance and fails if audit fails',async()=>{
 mocks.query.mockImplementation(async sql=>({rows:sql.includes('FROM vehicles')?[vehicle]:sql.includes('FROM vehicledocuments')?docs:sql.includes('FROM vehiclemaintenance')?[{maintenance_id:2}]:[]}));
 expect((await call({confirm:true,document_ids:[1,2]})).status).toBe(409);
 mocks.query.mockImplementation(async sql=>({rows:sql.includes('FROM vehicles')?[vehicle]:sql.includes('FROM vehicledocuments')?docs:sql.includes('UPDATE vehicles')?[vehicle]:[]}));
 mocks.audit.mockRejectedValueOnce(new Error('audit offline'));
 expect((await call({confirm:true,document_ids:[1,2]})).status).toBe(500);
});
