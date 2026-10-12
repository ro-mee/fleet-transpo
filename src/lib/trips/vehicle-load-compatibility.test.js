import { expect, it } from 'vitest';
import { checkVehicleLoadCompatibility } from './vehicle-load-compatibility';
it.each([['Passenger','Passenger'],['Cargo','Cargo'],[null,'Passenger'],[undefined,'Passenger']])('allows %s with %s', (loadType,operationalUse)=>{
 expect(checkVehicleLoadCompatibility({loadType,operationalUse})).toEqual({ok:true,reason:null});
});
it.each([['Cargo','Passenger','type_mismatch'],['Passenger','Cargo','type_mismatch'],[null,'Cargo','cargo_requires_typed_load'],['Parcel','Cargo','unknown_load_type'],['','Passenger','unknown_load_type'],['constructor','Passenger','unknown_load_type'],['Passenger',null,'missing_operational_use'],['Passenger','Other','missing_operational_use']])('rejects %s with %s', (loadType,operationalUse,reason)=>{
 expect(checkVehicleLoadCompatibility({loadType,operationalUse})).toEqual({ok:false,reason});
});
