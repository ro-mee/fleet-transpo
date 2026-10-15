import { withTransaction } from '@/lib/db';
import { requireAuth, parseBody, ok, err, handleError } from '@/lib/api/utils';
import { writeAuditRequired } from '@/lib/audit';
import { loadRoadReadiness } from '@/lib/vehicles/readiness-server';
import { evaluateVehicleCapacity } from '@/lib/scheduling/load-capacity';
import { deriveUsablePayload } from '@/lib/cargo/physical-load';
import { SUPPORTED_LICENSE_CLASSES } from '@/lib/drivers/license-eligibility';

// A Cargo vehicle commissions on measured-profile evidence only: legacy kg
// stays a display fallback and never commissions one. The provenance bar
// mirrors the supply cargo-profile writer (measured fields present, recorded
// by staff, reference present, verification unexpired).
function cargoProfileCommissionBlocker(profile, now) {
  const usable = profile?.supports_supply_delivery === true ? deriveUsablePayload(profile) : null;
  if (!Number.isFinite(usable) || usable <= 0)
    return 'Record a verified measured cargo profile with positive usable payload before verification.';
  const verifiedBy = Number(profile.verified_by);
  const verifiedAt = +new Date(profile.verified_at);
  const validUntil = +new Date(profile.verification_valid_until);
  if (!Number.isSafeInteger(verifiedBy) || verifiedBy <= 0 ||
      typeof profile.verification_reference !== 'string' || !profile.verification_reference.trim() ||
      !Number.isFinite(verifiedAt) || verifiedAt > now.getTime() ||
      !Number.isFinite(validUntil) || validUntil <= now.getTime())
    return 'Record a verified measured cargo profile with positive usable payload before verification.';
  return null;
}

// An explicit staff attestation, never a general-purpose vehicle write.
export async function POST(req, {params}) {
  try {
    const session = await requireAuth(req, ['admin','super_admin']);
    const vehicleId = Number((await params).id);
    const body = await parseBody(req);
    const ids = body?.document_ids;
    const employeeId = session?.user?.employeeId;
    if (!Number.isSafeInteger(vehicleId) || vehicleId <= 0) return err('Invalid vehicle.',400);
    if (!employeeId) return err('The verifier could not be identified.',403);
    if (body?.confirm !== true || !Array.isArray(ids) || ids.length !== 2 || new Set(ids).size !== 2 || ids.some(id=>!Number.isSafeInteger(id) || id<=0))
      return err('Confirm the saved OR/CR and insurance scans and provide their two document IDs.',400);
    const result = await withTransaction(async tx=>{
      await tx.query('LOCK TABLE vehicles,vehicledocuments,vehiclemaintenance,driverincidents IN SHARE ROW EXCLUSIVE MODE');
      const {rows:vehicles} = await tx.query('SELECT * FROM vehicles WHERE vehicle_id=$1 AND deleted_at IS NULL FOR UPDATE',[vehicleId]);
      const vehicle = vehicles[0];
      if (!vehicle) return {error:'Vehicle not found.',status:404};
      if (!String(vehicle.fleet_asset_code ?? '').trim() || !vehicle.category_id || !SUPPORTED_LICENSE_CLASSES.includes(vehicle.required_license_class))
        return {error:'Record the fleet asset code, category and supported registration license class before verification.',status:400};
      if (!['Passenger','Cargo'].includes(vehicle.operational_use))
        return {error:'Record the operational use and positive usable capacity before verification.',status:400};
      const now = new Date();
      let capacity;
      if (vehicle.operational_use === 'Cargo') {
        const {rows:profiles} = await tx.query(`SELECT * FROM vehicle_cargo_profiles WHERE vehicle_id=$1 FOR UPDATE`,[vehicleId]);
        const blocker = cargoProfileCommissionBlocker(profiles[0] ?? null, now);
        if (blocker) return {error:blocker,status:409};
        const usable = deriveUsablePayload(profiles[0]);
        capacity = evaluateVehicleCapacity({load_type:'Cargo',cargo_weight_kg:usable},{...vehicle,cargo_capacity_kg:usable});
      } else {
        capacity = evaluateVehicleCapacity({load_type:vehicle.operational_use,passenger_count:1,cargo_weight_kg:Number(vehicle.cargo_capacity_kg)},vehicle);
      }
      if (!capacity.eligible)
        return {error:'Record the operational use and positive usable capacity before verification.',status:400};
      const {rows:documents} = await tx.query(`SELECT document_id,document_type,document_number,file_url,expiry_date::text AS expiry_date
        FROM vehicledocuments WHERE vehicle_id=$1 AND deleted_at IS NULL AND document_type IN ('OR_CR','Insurance') FOR UPDATE`,[vehicleId]);
      if (documents.length !== 2 || documents.filter(d=>d.document_type==='OR_CR').length !== 1 || documents.filter(d=>d.document_type==='Insurance').length !== 1 || documents.some(d=>!ids.includes(Number(d.document_id))))
        return {error:'Saved documents changed or contain competing records. Refresh and review them.',status:409};
      if (documents.some(d=>!String(d.file_url ?? '').trim() || !String(d.document_number ?? '').trim()))
        return {error:'Each document needs its saved scan and official document number.',status:400};
      // Assess the proposed attestation before writing it. The queries still
      // supply actual live maintenance and incidents under the same locks.
      const verifiedDocs = documents.map(d=>({...d,verification_status:'Verified',verified_by:employeeId,verified_at:now}));
      const proposedQuery = async (sql,params)=>sql.includes('FROM vehicledocuments') ? {rows:verifiedDocs} : tx.query(sql,params);
      const readiness = await loadRoadReadiness({vehicleRow:{...vehicle,commissioning_status:'Ready'},pickupAt:now,returnAt:now,now,query:proposedQuery});
      if (!readiness.ready) return {error:`Vehicle cannot be commissioned: ${readiness.blockers.join(', ')}.`,status:409};
      await tx.query(`UPDATE vehicledocuments SET verification_status='Verified',verified_by=$3,verified_at=NOW(),updated_at=NOW()
        WHERE vehicle_id=$1 AND document_id=ANY($2::int[]) AND deleted_at IS NULL`,[vehicleId,ids,employeeId]);
      const {rows:updated} = await tx.query(`UPDATE vehicles SET commissioning_status='Ready',updated_at=NOW()
        WHERE vehicle_id=$1 AND deleted_at IS NULL RETURNING *`,[vehicleId]);
      await writeAuditRequired(tx,req,session,{action:'verify',resource:'vehicles',resourceId:vehicleId,
        oldValues:{commissioning_status:vehicle.commissioning_status},newValues:{commissioning_status:'Ready',document_ids:ids,verified_by:employeeId,outcome:'commissioned'}});
      return {vehicle:updated[0]};
    });
    return result.error ? err(result.error,result.status) : ok(result.vehicle);
  } catch (error) { return handleError(error); }
}
