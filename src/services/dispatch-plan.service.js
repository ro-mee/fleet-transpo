import { derivePriority, priorityRank } from '@/lib/scheduling/priority';
import { dispatchPlanWindow } from '@/lib/dispatch/plan-window';
import { getDispatchPolicy } from '@/services/dispatch-settings.service';
import { query } from '@/lib/db';
import { prepareDispatchRecommendation } from '@/services/dispatch-recommendation-preparation.service';
import { evaluateDispatchCandidate, serviceEnd } from '@/services/dispatch-radar.service';
import { comparePairEvidence } from '@/lib/dispatch/recommendation-ranking';
import { dispatchDecision } from '@/lib/dispatch/decision';
import { DEFAULT_DISPATCH_POLICY } from '@/lib/dispatch-policy';

export const PLAN_REQUEST_CAP = 30;
async function withinDeadline(work,deadline) {
  let timer;
  try { return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Plan deadline reached')),Math.max(0,deadline-Date.now()));})]); }
  finally {clearTimeout(timer);}
}
const priority = r => -priorityRank(r.derived_priority);
export const planPriority = (request,now,thresholds) => derivePriority({pickupDatetime:request.pickup_datetime ?? undefined,fleetStatus:request.fleet_status,isVip:request.is_vip===true,isEmergency:request.is_emergency===true,now,thresholds,timeZone:'Asia/Manila'});
const stablePair = (a,b) => Number(a.vehicle_id)-Number(b.vehicle_id) || Number(a.driver_id)-Number(b.driver_id);
const outcome = evidence => evidence?.feasibility?.verdict === 'INFEASIBLE' ? 'HARD_CONFLICT'
  : evidence?.readiness === 'VERIFIED' && evidence?.feasibility?.verdict === 'SAFE' ? 'VERIFIED' : 'REVIEW_REQUIRED';
export function manilaWindowEnd(now) {
  const day = new Date(+new Date(now)+8*3600_000).toISOString().slice(0,10);
  return new Date(+new Date(day+'T00:00:00+08:00')+86400_000).toISOString();
}
const publicRequest = r => Object.fromEntries(['request_id','reservation_number','pickup_datetime','pickup_location','dropoff_location','passenger_count','priority','derived_priority','fleet_status','requested_vehicle_type'].map(k=>[k,r[k]]));
const commitment = row => ({request_id:row.request.request_id, dispatch_id:`plan-${row.request.request_id}`,tentative:true,
  driver_id:row.pair.driver_id,vehicle_id:row.pair.vehicle_id,status:'Scheduled',scheduled_departure:row.request.pickup_datetime,
  scheduled_arrival:serviceEnd(row.request,row.estimate)?.toISOString(),pickup_location:row.request.pickup_location,dropoff_location:row.request.dropoff_location});

// ponytail: bounded greedy plus single replacement; no claim of a globally optimal fleet schedule.
export async function planPreparedRequests(prepared, { now = new Date(), deadline = Date.now()+25_000,
  routeMemo = new Map(), evaluate = evaluateDispatchCandidate, clock = Date.now, selection = null, policy = DEFAULT_DISPATCH_POLICY } = {}) {
  const selected = [], results = new Map();
  let incompleteReason = null;
  const ordered = [...prepared].sort((a,b)=>priority(b.request)-priority(a.request)
    || a.candidates.length-b.candidates.length || new Date(a.request.pickup_datetime)-new Date(b.request.pickup_datetime)
    || Number(a.request.request_id)-Number(b.request.request_id));
  const scarcity = pair => prepared.reduce((cost,row)=>cost + (row.candidates.some(p=>p.vehicle_id===pair.vehicle_id || p.driver_id===pair.driver_id) ? 1/Math.max(1,row.candidates.length) : 0),0);
  const check = async rows => {
    const commitments = rows.map(commitment), checked=[];
    for (const row of rows) {
      if (clock() >= deadline) { incompleteReason='DEADLINE'; return null; }
      try {
        const evidence=await withinDeadline(evaluate({request:row.request,estimate:row.estimate,vehicleId:row.pair.vehicle_id,driverId:row.pair.driver_id,
          now,deadline,routeMemo,tentativeCommitments:commitments,policy}),deadline);
        if (clock() >= deadline) { incompleteReason='DEADLINE'; return null; }
        checked.push({...row,pair:{...row.pair,...evidence},outcome:outcome(evidence)});
      } catch { incompleteReason ||= clock() >= deadline ? 'DEADLINE' : 'EVIDENCE_FAILURE'; checked.push({...row,outcome:'REVIEW_REQUIRED',pair:{...row.pair,feasibility:{verdict:'UNKNOWN',reasons:['Current evidence could not be verified.']}}}); }
    }
    return checked;
  };
  const selectedRequest = row => Number(row.request.request_id) === selection?.requestId;
  const acceptable = rows => rows.every(row => row.outcome === 'VERIFIED' ||
    (selectedRequest(row) && dispatchDecision(row.pair, {now:clock()}).canReview));
  for (const row of ordered) {
    if (clock() >= deadline) { incompleteReason='DEADLINE'; results.set(row.request.request_id,{...row,outcome:'NOT_EVALUATED'}); continue; }
    if (row.error === 'PICKUP_TIME_UNKNOWN') {
      results.set(row.request.request_id,{...row,outcome:'REVIEW_REQUIRED',reasons:['Confirm a valid pickup time before planning this request.']}); continue;
    }
    if (row.error) { incompleteReason ||= 'EVIDENCE_FAILURE'; results.set(row.request.request_id,{...row,outcome:'NOT_EVALUATED'}); continue; }
    let best=null, accepted=false, bestChecked=null, fullyEvaluated=true;
    const pairs=[...row.candidates].filter(p => !selectedRequest(row) || (p.vehicle_id === selection.vehicleId && p.driver_id === selection.driverId))
      .sort((a,b)=>scarcity(a)-scarcity(b) || comparePairEvidence(a,b,policy).order);
    for (const pair of pairs) {
      const checked=await check([...selected,{...row,pair}]);
      if (!checked) {fullyEvaluated=false;break;}
      const candidate=checked.at(-1);
      if (!best || (best.outcome==='HARD_CONFLICT' && candidate.outcome!=='HARD_CONFLICT')) best=candidate;
      if (acceptable(checked)) {
        const previous=bestChecked?.at(-1)?.pair;
        const compare=previous ? scarcity(candidate.pair)-scarcity(previous)
          || comparePairEvidence(candidate.pair,previous,policy).order : -1;
        if (compare<0) bestChecked=checked;
      }
    }
    if (bestChecked) {bestChecked.at(-1).candidateEvaluationComplete=fullyEvaluated;selected.splice(0,selected.length,...bestChecked);accepted=true;}
    if (!fullyEvaluated) {
      incompleteReason ||= 'DEADLINE';
      if (!accepted) best={...row,outcome:'NOT_EVALUATED'};
    }
    // Try moving one prior proposal to another eligible pair, then revalidate every leg.
    if (!accepted && !incompleteReason) for (let i=0;i<selected.length && !accepted;i++) {
      const prior=selected[i];
      if (selectedRequest(prior)) continue;
      for (const alternative of [...prior.candidates].sort((a,b)=>comparePairEvidence(a,b,policy).order)) {
        if (alternative.vehicle_id===prior.pair.vehicle_id && alternative.driver_id===prior.pair.driver_id) continue;
        for (const pair of pairs) {
          const trial=selected.map((r,j)=>j===i?{...r,pair:alternative}:r);
          const checked=await check([...trial,{...row,pair}]);
          if (!checked) break;
          if (acceptable(checked)) { selected.splice(0,selected.length,...checked); accepted=true;break; }
        }
        if (accepted || incompleteReason) break;
      }
    }
    if (!accepted) {
      if (incompleteReason === 'DEADLINE') best = {...row,outcome:'NOT_EVALUATED',candidateEvaluationComplete:false};
      if (best?.outcome === 'VERIFIED') best={...best,outcome:'REVIEW_REQUIRED',pair:{...best.pair,readiness:'REVIEW_REQUIRED',feasibility:{verdict:'UNKNOWN',reasons:['This candidate would invalidate another proposed leg; no complete safe placement was found.']}}};
      results.set(row.request.request_id,best ?? {...row,outcome:incompleteReason==='DEADLINE'?'NOT_EVALUATED':'HARD_CONFLICT'});
    }
  }
  for (const row of selected) {
    const other = row.candidates.find(p => stablePair(p,row.pair) !== 0);
    const comparison = other ? comparePairEvidence(row.pair,other,policy) : null;
    row.pair.decisionEvidence = {code:'QUEUE_CHECKED',label:'Queue schedule fit',reliability:row.pair.feasibility?.verdict,
      explanation:comparison?.order < 0 ? comparison.explanation : 'This pair was checked with the other queue proposals and fixed bookings. Queue coverage can differ from individual ranking.'};
    const expiry=Math.min(...[row.pair.evidenceExpiresAt,row.pair.proximity?.expiresAt,row.pair.dispatchContext?.evidenceExpiresAt].filter(Boolean).map(x=>+new Date(x)));
    if (expiry<=clock()) {
      row.outcome='REVIEW_REQUIRED';row.pair={...row.pair,readiness:'REVIEW_REQUIRED',feasibility:{verdict:'UNKNOWN',reasons:['Route or location evidence expired during analysis.']}};
      incompleteReason ||= 'EVIDENCE_EXPIRED';
    }
    results.set(row.request.request_id,row);
  }
  for (const row of [...selected].sort((a,b)=>new Date(a.request.pickup_datetime)-new Date(b.request.pickup_datetime))) {
    if (selected.some(previous => previous.outcome !== 'VERIFIED'
      && new Date(previous.request.pickup_datetime) < new Date(row.request.pickup_datetime)
      && (previous.pair.driver_id === row.pair.driver_id || previous.pair.vehicle_id === row.pair.vehicle_id))) {
      row.outcome = 'REVIEW_REQUIRED';
      row.pair = {...row.pair,readiness:'REVIEW_REQUIRED',feasibility:{verdict:'UNKNOWN',reasons:['A preceding proposed trip lost verified evidence. Analyze again.']}};
    }
  }
  const proposals=[...results.values()].sort((a,b)=>new Date(a.request.pickup_datetime)-new Date(b.request.pickup_datetime)||Number(a.request.request_id)-Number(b.request.request_id)).map(row=>({
    requestId:row.request.request_id,proposalId:String(row.request.request_id),request:publicRequest(row.request),outcome:row.outcome,
    candidateEvaluationComplete:row.outcome !== 'NOT_EVALUATED' && row.candidateEvaluationComplete !== false,pair:row.pair ?? null,reasons:row.reasons ?? row.pair?.feasibility?.reasons ?? [row.outcome==='NOT_EVALUATED'?'Analysis budget or evidence unavailable.':'No eligible pair.'],
    confirmationMode:selected.includes(row) && selectedRequest(row) && row.outcome==='REVIEW_REQUIRED' && dispatchDecision(row.pair,{now:clock()}).canReview ? 'manual' : 'verified',
    dependsOnRequestIds:['VERIFIED','REVIEW_REQUIRED'].includes(row.outcome)?selected.filter(other=>other!==row && +new Date(other.request.pickup_datetime)<+new Date(row.request.pickup_datetime)
      && (other.pair.driver_id===row.pair.driver_id || other.pair.vehicle_id===row.pair.vehicle_id)).map(other=>other.request.request_id):[],
    contention: row.pair ? prepared.filter(other=>other.request.request_id!==row.request.request_id && other.candidates.some(p=>p.driver_id===row.pair.driver_id || p.vehicle_id===row.pair.vehicle_id))
      .map(other=>({requestId:other.request.request_id,relation:'shared_option',message:'Shares an eligible resource option; this alone does not prove a conflict.'})) : [],
  }));
  return {proposals,incompleteReason,evaluatedRequests:proposals.filter(r=>r.outcome!=='NOT_EVALUATED' && r.candidateEvaluationComplete).length,servedCount:proposals.filter(r=>r.outcome==='VERIFIED').length};
}

export async function buildDispatchPlan({now=new Date(),date,deadline=Date.now()+25_000,routeMemo=new Map(),selection=null}={}) {
  const window=dispatchPlanWindow(date,now);
  const end=window.end;
  const policy=await getDispatchPolicy();
  const {rows:metadata}=await query(`SELECT tr.request_id,tr.pickup_datetime,tr.fleet_status,tr.is_vip,tr.is_emergency
    FROM transportation_requests tr WHERE tr.deleted_at IS NULL AND tr.fleet_status IN ('Pending','Scheduled')
      AND tr.vehicle_id IS NULL AND tr.driver_id IS NULL AND (tr.pickup_datetime < $1::timestamptz OR tr.pickup_datetime IS NULL)
      AND ($3::boolean OR tr.pickup_datetime >= $2::timestamptz)
      AND NOT EXISTS (SELECT 1 FROM dispatchschedules ds WHERE ds.request_id=tr.request_id AND ds.deleted_at IS NULL AND ds.status IN ('Scheduled','In Progress'))`,[end,window.start,window.includesOverdue]);
  const ranked=metadata.map(r=>({...r,derived_priority:planPriority(r,now,policy)})).sort((a,b)=>priority(b)-priority(a)
    || (+new Date(a.pickup_datetime)||Infinity)-(+new Date(b.pickup_datetime)||Infinity) || Number(a.request_id)-Number(b.request_id));
  const {rows:loaded}=ranked.length ? await query('SELECT * FROM transportation_requests WHERE request_id=ANY($1::int[])',[ranked.slice(0,PLAN_REQUEST_CAP).map(r=>r.request_id)]) : {rows:[]};
  const rows=ranked.slice(0,PLAN_REQUEST_CAP).map(r=>({...loaded.find(l=>Number(l.request_id)===Number(r.request_id)),...r}));
  const prepared=[];
  for (const request of rows) {
    if(!request.pickup_datetime || !Number.isFinite(+new Date(request.pickup_datetime))) {prepared.push({request,candidates:[],error:'PICKUP_TIME_UNKNOWN'});continue;}
    if(Date.now()>=deadline){prepared.push({request,candidates:[],error:true});continue;}
    try { const result=await withinDeadline(prepareDispatchRecommendation(request,{now,persistRoute:false}),deadline); prepared.push({...result,candidates:result.recommendation.pair?.candidates ?? []}); }
    catch {prepared.push({request,candidates:[],error:true});}
  }
  const result=await planPreparedRequests(prepared,{now,deadline,routeMemo,selection,policy});
  const totalRequests=metadata.length;
  const incompleteReason=totalRequests>PLAN_REQUEST_CAP?'REQUEST_CAP':result.incompleteReason;
  const evidenceExpiries=result.proposals.flatMap(r=>[r.pair?.evidenceExpiresAt,r.pair?.proximity?.expiresAt,r.pair?.dispatchContext?.evidenceExpiresAt,r.pair?.temporalContext?.nextBoundaryAt]).filter(Boolean).map(x=>+new Date(x)).filter(Number.isFinite);
  return {...result,totalRequests,incompleteReason,analysisComplete:!incompleteReason && result.evaluatedRequests===totalRequests,
    generatedAt:new Date(now).toISOString(),expiresAt:new Date(Math.min(+new Date(now)+60_000,...evidenceExpiries)).toISOString(),
    bounded:true,requestCap:PLAN_REQUEST_CAP,window};
}
