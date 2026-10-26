import { withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, AuthError, handleError } from "@/lib/api/utils";
import { writeAuditRequired } from "@/lib/audit";
import { recordOdometerObservation } from "@/services/maintenance-plans.service";
export async function POST(req,{params}) {
 try {
  const session=await requirePermission(req,"vehicles","update");
  const id=(await params).id; const body=await parseBody(req);
  if (!body || typeof body!=="object" || Array.isArray(body)) throw new AuthError("An odometer observation is required",400);
  const observation=await withTransaction(async tx=>{
   const recorded=await recordOdometerObservation(tx,id,body,session.user.employeeId);
   await writeAuditRequired(tx,req,session,{action:"create",resource:"vehicle_odometer_observations",resourceId:recorded.observation_id,newValues:{...recorded,evidence_type:"manual_observation"}});
   return recorded;
  });
  return ok(observation,201);
 } catch(e) { return handleError(e); }
}
