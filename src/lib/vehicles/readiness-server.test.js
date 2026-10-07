import { expect, it, vi } from 'vitest';
import { loadRoadReadiness } from './readiness-server';

const vehicle = {vehicle_id:7, plate_number:'ABC1234', commissioning_status:'Ready',fleet_asset_code:'FLT-007',category_id:1,required_license_class:'B'};
const now = new Date('2026-10-07T08:00:00+08:00');
const documents = ['OR_CR','Insurance'].map(document_type=>({document_type, verification_status:'Verified',verified_by:1,verified_at:'2026-10-01T00:00:00Z',expiry_date:'2028-01-01'}));

it('uses recorded documents and actual maintenance/incidents, never forged vehicle flags', async () => {
 const query = vi.fn(async sql=>({rows:sql.includes('FROM vehicledocuments')?documents:[]}));
 expect((await loadRoadReadiness({vehicleRow:vehicle,pickupAt:now,returnAt:now,now,query})).ready).toBe(true);
 query.mockImplementation(async sql=>({rows:sql.includes('FROM vehicledocuments')?documents:sql.includes('FROM vehiclemaintenance')?[{maintenance_id:1}]:sql.includes('FROM driverincidents')?[{incident_type:'Breakdown',severity:'Major',vehicle_id:7}]:[]}));
 expect((await loadRoadReadiness({vehicleRow:{...vehicle,maintenance_clear:true,safety_clear:true},pickupAt:now,returnAt:now,now,query})).blockers).toEqual(expect.arrayContaining(['MAINTENANCE_NOT_CLEARED','SAFETY_NOT_CLEARED']));
});

it('fails closed on document query errors and expired documents over the service window', async()=>{
 const query = vi.fn(async sql=>({rows:sql.includes('FROM vehicledocuments')?documents.map(d=>({...d,expiry_date:'2026-10-07'})):[]}));
 expect((await loadRoadReadiness({vehicleRow:vehicle,pickupAt:now,returnAt:new Date('2026-10-08T09:00:00+08:00'),now,query})).blockers).toContain('REGISTRATION_EXPIRED');
 query.mockRejectedValue(new Error('offline'));
 await expect(loadRoadReadiness({vehicleRow:vehicle,pickupAt:now,returnAt:now,now,query})).rejects.toThrow('offline');
});

it('rejects static identity gaps on an otherwise commissioned vehicle',async()=>{
 const query = vi.fn(async sql=>({rows:sql.includes('FROM vehicledocuments')?documents:[]}));
 const result=await loadRoadReadiness({vehicleRow:{...vehicle,fleet_asset_code:null,category_id:null,required_license_class:null},pickupAt:now,returnAt:now,now,query});
 expect(result.blockers).toEqual(expect.arrayContaining(['ASSET_CODE_MISSING','CATEGORY_MISSING','LICENSE_CLASS_MISSING']));
});

it('grounds overdue unresolved scheduled maintenance even outside a future booking window',async()=>{
 const query=vi.fn(async sql=>({rows:sql.includes('FROM vehicledocuments')?documents:[]}));
 await loadRoadReadiness({vehicleRow:vehicle,pickupAt:new Date('2027-02-01T02:00:00Z'),returnAt:new Date('2027-02-01T03:00:00Z'),now,query});
 const call=query.mock.calls.find(([sql])=>sql.includes('FROM vehiclemaintenance'));
 expect(call[0]).toContain('maintenance_date <= $4::date');
 expect(call[1][3]).toBe('2026-10-07');
});
