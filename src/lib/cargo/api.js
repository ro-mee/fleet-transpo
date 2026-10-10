import { z } from 'zod';
import { resolveIdentity, AuthError, ok, handleError } from '@/lib/api/utils';
import { assertTripOwnership } from '@/lib/api/ownership';
import { rolesFor } from '@/lib/auth/permissions';
import { authorizeCargoSource } from '@/lib/integration/source-auth';
import { receiptSchema, decisionSchema } from './contracts';
import { storeCargoEvidence } from './evidence-storage';
import * as execution from '@/services/cargo-execution.service';

const fail = (code, message, status) => { throw new AuthError(message, status, code); };
const unavailable = () => fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo authority is not configured.', 503);
const text = max => z.string().trim().min(1).max(max).refine(value => !/https?:\/\//i.test(value));
const clearanceSchema = z.object({receipt_id:z.string().uuid(),expected_version:z.number().int().positive(),reason:text(2000)}).strict();
const sourceSchema = decisionSchema.extend({external_request_id:text(255)}).strict();
const manualSchema = decisionSchema.extend({approver_identity:text(255),approver_reference:text(255),communicated_at:z.string().datetime({offset:true}),communication_evidence_ids:z.array(z.string().uuid()).min(1).max(5)}).strict();
const parse = (schema, body) => {const result=schema.safeParse(body);if(!result.success)fail('CARGO_INVALID_INPUT','Invalid cargo input.',400);return result.data;};
async function body(req) {
  if (Number(req.headers.get('content-length')) > 131072) fail('CARGO_INVALID_INPUT','Cargo input is too large.',400);
  const reader=req.body?.getReader(),decoder=new TextDecoder();
  let raw='',size=0;
  if(reader)try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>131072){await reader.cancel();fail('CARGO_INVALID_INPUT','Cargo input is too large.',400);}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock();}
  try{return JSON.parse(raw);}catch{fail('BAD_REQUEST','Invalid JSON body.',400);}
}
// Private read projection only. Never apply it to immutable mutation responses.
function privateRead(value) {
  if(Array.isArray(value))return value.map(privateRead);
  if(!value || typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=> !/url|contact|phone|email|receiver_name/i.test(key)).map(([key,item])=>[key,privateRead(item)]));
}
function pagination(req) {
  const sp=new URL(req.url).searchParams;
  if([...sp.keys()].some(key=>!['history_limit','history_offset','evidence_id'].includes(key)))fail('CARGO_INVALID_INPUT','Unknown cargo read option.',400);
  const limit=sp.get('history_limit')??'20',offset=sp.get('history_offset')??'0';
  if(!/^\d+$/.test(limit)||!/^\d+$/.test(offset)||Number(limit)<1||Number(limit)>50||!Number.isSafeInteger(Number(offset))||Number(offset)>10000)fail('CARGO_INVALID_INPUT','Invalid cargo history page.',400);
  const ids=sp.getAll('evidence_id');
  if(ids.length>5 || new Set(ids).size!==ids.length || ids.some(id=>!z.string().uuid().safeParse(id).success))fail('CARGO_INVALID_INPUT','Invalid cargo evidence selection.',400);
  return {limit:Number(limit),offset:Number(offset),evidenceIds:ids};
}

function handlers(deps) {
  const wrap = work => async (...args) => {try{
    if(deps.simulated && process.env.NODE_ENV==='production')unavailable();
    return await work(...args);
  }catch(error){
    if(!(error instanceof AuthError)&&/^CARGO_/.test(error?.code)&&[400,403,404,409,503].includes(error.status))error=new AuthError(error.message,error.status,error.code);
    return handleError(error);
  }};
  async function actor(req, context, action) {
    const session=await resolveIdentity(req), {id}=await context.params;
    if(!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<1)fail('CARGO_TRIP_NOT_FOUND','Cargo trip was not found.',404);
    const role=session.user.role;
    if(action==='observe' && role!=='driver')fail('CARGO_FORBIDDEN','Only the assigned driver may record cargo observations.',403);
    if(!rolesFor('cargo',action).includes(role))fail('CARGO_FORBIDDEN','Cargo action is not permitted.',403);
    await assertTripOwnership(session,Number(id));
    if(role!=='driver') {
      if(!deps.approvalRef)unavailable();
      if(await deps.authorizeStaff?.({session,tripId:Number(id),action,approvalRef:deps.approvalRef})!==true)fail('CARGO_FORBIDDEN','Approved cargo authority is required.',403);
    }
    return {session,tripId:Number(id)};
  }
  return {
    get:wrap(async (req,context)=>{
      const {session,tripId}=await actor(req,context,'read'),page=pagination(req);
      const view=await deps.service.getCargoExecution(tripId,session);
      if(!deps.readHistory)unavailable();
      const history=await deps.readHistory({tripId,session,limit:page.limit,offset:page.offset});
      if(!Array.isArray(history?.rows)||history.rows.length>page.limit)unavailable();
      const data=privateRead({...view,history:{rows:history.rows,has_more:history.has_more===true}});
      const approvedAction=async action=>session.user.role!=='driver' && rolesFor('cargo',action).includes(session.user.role) && Boolean(deps.approvalRef) && await deps.authorizeStaff?.({session,tripId,action,approvalRef:deps.approvalRef})===true;
      data.capabilities={read:true,observe:session.user.role==='driver',clearance:await approvedAction('clearance'),manual_decision:Boolean(deps.resolveManualAuthority && deps.recordManualDecision) && await approvedAction('manual_decision')};
      if(page.evidenceIds.length) {
        if(!deps.signEvidence)unavailable();
        data.evidence=[];
        for(const evidenceId of page.evidenceIds) {
          const signed=await deps.signEvidence({evidenceId,tripId,session,expiresIn:300,approvalRef:deps.approvalRef});
          if(!signed?.url||signed.expires_in!==300)unavailable();
          data.evidence.push({evidence_id:evidenceId,url:signed.url,expires_in:300});
        }
      }
      return ok({data});
    }),
    receipts:wrap(async(req,context)=>{const {session,tripId}=await actor(req,context,'observe');const input=parse(receiptSchema,await body(req));return ok({data:await deps.service.submitCargoReceipt(tripId,input,session)});}),
    evidence:wrap(async(req,context)=>{
      const {session,tripId}=await actor(req,context,'observe');
      // Refuse unavailable runtime before parsing uploaded bytes.
      if(!deps.simulated)unavailable();
      if(Number(req.headers.get('content-length'))>6*1024*1024)fail('CARGO_INVALID_IMAGE','Cargo image is too large.',400);
      const form=await req.formData();
      if([...form.keys()].some(key=>!['file','submission_id'].includes(key))||form.getAll('file').length!==1||form.getAll('submission_id').length!==1)fail('CARGO_INVALID_IMAGE','A single cargo file and submission are required.',400);
      const submissionId=parse(z.string().uuid(),form.get('submission_id')),file=form.get('file');
      if(!file||typeof file.arrayBuffer!=='function'||file.size>5*1024*1024)fail('CARGO_INVALID_IMAGE','Invalid cargo image.',400);
      return ok({data:await deps.storeEvidence({file,tripId,submissionId},session)});
    }),
    clearance:wrap(async(req,context)=>{const {session,tripId}=await actor(req,context,'clearance');const input=parse(clearanceSchema,await body(req));return ok({data:await deps.service.clearCargoDeparture(tripId,input,session)});}),
    manualDecision:wrap(async(req,context)=>{
      const {session,tripId}=await actor(req,context,'manual_decision'),input=parse(manualSchema,await body(req));
      if(!deps.resolveManualAuthority||!deps.recordManualDecision)unavailable();
      // Resolve actual communication and approver records independently. Never
      // call recordSourceDecision with an invented source principal.
      const authority=await deps.resolveManualAuthority({tripId,session,input,approvalRef:deps.approvalRef});
      if(authority?.authorized!==true)fail('CARGO_SOURCE_FORBIDDEN','Recorded source authority is required.',403);
      return ok({data:await deps.recordManualDecision({tripId,session,input,authority})});
    }),
    sourceDecision:wrap(async req=>{
      const principal=await authorizeCargoSource(req,{credentials:deps.credentials,allowSandbox:deps.simulated===true,environment:deps.environment});
      if(!principal)fail('SESSION_INVALID','Source credentials are required.',401);
      if(!principal.capabilities.includes('cargo:decision:write'))fail('CARGO_SOURCE_FORBIDDEN','Source decision authority is required.',403);
      const {external_request_id,...input}=parse(sourceSchema,await body(req));
      if(!deps.resolveSourceRequest)unavailable();
      const tripId=await deps.resolveSourceRequest({principal,externalRequestId:external_request_id,receiptId:input.receipt_id});
      if(!Number.isSafeInteger(tripId)||tripId<=0)fail('CARGO_RECEIPT_NOT_FOUND','Cargo receipt was not found.',404);
      return ok({data:await deps.service.recordSourceDecision(tripId,input,principal)});
    }),
  };
}
// No setter, runtime provider, credentials or factory is installed by routes.
export const cargoApi=handlers({service:execution,storeEvidence:storeCargoEvidence,credentials:[]});
export function createCargoApi(deps) {
  if(process.env.NODE_ENV==='production'||deps?.simulated!==true||!['test','development'].includes(deps.environment)||!deps.approvalRef?.trim())unavailable();
  return handlers({...deps,service:deps.service??execution,storeEvidence:deps.storeEvidence??storeCargoEvidence,credentials:deps.credentials??[]});
}
