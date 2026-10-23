import { withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, AuthError, handleError } from "@/lib/api/utils";
import { writeAuditRequired } from "@/lib/audit";
import { assertPlanConfigurationRole, listServicePlans, saveServicePlan } from "@/services/maintenance-plans.service";
export async function GET(req) {
 try {
  const session=await requirePermission(req,"maintenance","read");
  const id=new URL(req.url).searchParams.get("vehicle_id");
  return ok(await listServicePlans(session.user,id));
 } catch(e) { return handleError(e); }
}
export async function PUT(req) {
 try {
  const session=await requirePermission(req,"maintenance","update"); assertPlanConfigurationRole(session.user);
  const body=await parseBody(req);
  if (!body || typeof body!=="object" || Array.isArray(body)) throw new AuthError("A service plan object is required",400);
  const result=await withTransaction(async tx=>{
   const {before,plan}=await saveServicePlan(tx,body.vehicle_id,body.service_code,body,body.expected_version,session.user.employeeId);
   await writeAuditRequired(tx,req,session,{action:before?"update":"create",resource:"vehicle_service_plans",resourceId:plan.plan_id,oldValues:before,newValues:plan});
   return plan;
  });
  return ok(result);
 } catch(e) { return handleError(e); }
}
