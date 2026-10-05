import { beforeEach,it,expect,vi } from 'vitest';
vi.mock('@/lib/api/utils',()=>({AuthError:class extends Error { constructor(message,status,code){ super(message);this.status=status;this.code=code; } }}));
vi.mock('@/lib/db',()=>{const query=vi.fn();return {query,withTransaction:vi.fn(fn=>fn({query}))};});
vi.mock('@/services/driver-schedule.service',()=>({loadDriverScheduleContext:vi.fn(async()=>({schedules:new Map(),leave:new Map()}))}));
// The roster gate itself is covered in driver-schedule.test.js. Here it is
// stubbed open so the start-duty gates behind it can be reached at all.
vi.mock('@/lib/scheduling/driver-schedule',()=>({driverBlockReason:vi.fn(()=>null)}));
vi.mock('@/lib/ai/pair-scoring',()=>({resolveVehiclePairing:()=>({ok:true,driver:{driver_id:7}}),vehicleOperationallyAvailable:()=>true}));
import { query } from '@/lib/db';
import { publishStandby,setDuty,standbyLocations,endDutyWithReport } from './standby.service';
const user={driverId:7,employeeId:4,familyId:'11111111-1111-1111-1111-111111111111'};
const submission=(ch)=>ch.repeat(20);
let state;
beforeEach(()=>{
 state={checked_in:true,consented:true,busy:false,standby_tracking_enabled:true,preshift_baseline:true,duty_started_at:new Date(Date.now()-60_000)};
 query.mockReset().mockImplementation(async(sql)=>{
   if(sql.includes('FROM vehicles WHERE'))return {rows:[{vehicle_id:2}]};
   if(sql.includes('SELECT d.*'))return {rows:[state]};
   if(sql.includes('SELECT 1 FROM mobile_refresh_tokens'))return {rows:[{exists:true}]};
   if(sql.includes('UPDATE drivers SET standby_latitude'))return {rows:[{location_observed_at:new Date()}]};
   // Ending duty resolves the day before it closes anything, and the lateness
   // query is answered here rather than reimplementing date arithmetic in JS —
   // the database stays the clock.
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
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

it('orders the start-duty gates: roster, then consent, then the pre-shift baseline',async()=>{
 const {driverBlockReason}=await import('@/lib/scheduling/driver-schedule');
 // A rest day or approved leave outranks everything else: the driver is not
 // working, so asking them for a vehicle check would be nonsense. This is the
 // ordering the mobile app depends on — DUTY_UNAVAILABLE is the answer that
 // means "not today", PRESHIFT_REQUIRED the one that means "go do the check".
 driverBlockReason.mockReturnValueOnce({blocked:true,reason:'Rest day'});
 state={...state,consented:false,preshift_baseline:false};
 await expect(setDuty(7,true)).rejects.toMatchObject({status:409,code:'DUTY_UNAVAILABLE'});
 // Consent outranks the checklist: it is a privacy obligation, not a task.
 await expect(setDuty(7,true)).rejects.toMatchObject({status:403});
 state={...state,consented:true};
 await expect(setDuty(7,true)).rejects.toMatchObject({status:409,code:'PRESHIFT_REQUIRED'});
 // Nothing was written on any of the three failures.
 expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO driverattendance'))).toBe(false);
});

it('starts duty once the baseline exists and the roster allows it',async()=>{
  // The attendance write is the authority for `changed`: the duty route uses it
  // to audit a new start only once. Model a successful UPSERT with pg's rowCount
  // rather than the default empty query response (which means no-op).
  const implementation=query.getMockImplementation();
  query.mockImplementation(async(sql,...args)=>sql.includes('INSERT INTO driverattendance')
    ? {rows:[{attendance_id:42}],rowCount:1}
    : implementation(sql,...args));
  expect(await setDuty(7,true)).toEqual({checkedIn:true,changed:true});
  expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO driverattendance'))).toBe(true);
});

it('does not report a second duty start when the attendance upsert changes no row',async()=>{
  const implementation=query.getMockImplementation();
  query.mockImplementation(async(sql,...args)=>sql.includes('INSERT INTO driverattendance')
    ? {rows:[],rowCount:0}
    : implementation(sql,...args));
  expect(await setDuty(7,true)).toEqual({checkedIn:true,changed:false});
});

it('clears the stale outcome when setDuty reopens a closed day',async()=>{
 // Defect 1 (Task 4's fix round 5). `end_duty_outcome` describes how a CLOSED duty ended,
 // so a reopened duty has no outcome — and leaving the stale marker behind costs two
 // things at once. Migration 126's sweep requires `end_duty_outcome IS NULL`, so the row
 // could never be auto-closed and the driver stayed shown on duty forever with nothing to
 // rescue them; and `endDutyWithReport`'s no-vehicle fixed point reads that marker, so a
 // driver who reopened a 'NoVehicle' day and later filed a real report had it silently
 // dropped — a 200 with `recorded: false`, no Post-Shift row, no work order, and no
 // `time_out`. Shown RED by deleting the fragment from the service.
 await setDuty(7,true);
 const [sql]=query.mock.calls.find(([sql])=>sql.includes('INSERT INTO driverattendance'));
 expect(sql).toContain('end_duty_outcome=NULL');
 // …on the DO UPDATE arm, and only there: the INSERT cannot set a column it does not
 // name, so the fragment is exactly the reopen's.
 expect(sql).toContain('ON CONFLICT (driver_id,date) DO UPDATE');
});

it('files the report and the time_out in one transaction, and records "none" as a pass',async()=>{
 query.mockImplementation(async(sql)=>{
   if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
   if(sql.includes('SELECT d.*'))return {rows:[state]};
   // The duty day is resolved before anything is closed, so this fixture answers
   // the open-row lookup and the lateness query — the latter rather than
   // reimplementing date arithmetic in JS, which keeps the database the clock.
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
   return {rows:[]};
 });
 const result=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('a')});
 expect(result).toMatchObject({checkedIn:false,inspectionId:88,reported:false,recorded:true});
 const [sql,values]=query.mock.calls.find(([sql])=>sql.includes('INSERT INTO vehicleinspection'));
 expect(sql).toContain("'Post-Shift'");
 expect(sql).toContain('ON CONFLICT (driver_id, client_submission_id)');
 // The driver asserted they found nothing, so severity is their own "None" —
 // not a level anybody assessed.
 expect(values).toContain('None');
 expect(values).toContain('Passed');
 // The close records how the duty ended as well as its time_out, so match on the
 // outcome. `time_out=NOW()` is no longer a substring of it: the statement now
 // writes COALESCE(time_out,NOW()) so an already-auto-closed row keeps the
 // time_out the sweep gave it.
 const [closeSql]=query.mock.calls.find(([sql])=>sql.includes("end_duty_outcome='Reported'"));
 expect(closeSql).toContain('time_out=COALESCE(time_out,NOW())');
});

it('stores a reported defect with no severity, and recovers a retried submission',async()=>{
 query.mockImplementation(async(sql)=>{
   if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[]};
   // The recovery's text, keyed on the statement itself. It carries `inspection_date`
   // as well as `inspection_id` since round 4 — the row's own day is what the retry
   // closes — so a key on the old `SELECT inspection_id FROM vehicleinspection` no
   // longer matches anything and this test would quietly measure the refusal instead.
   if(sql.includes('SELECT inspection_id, inspection_date FROM vehicleinspection'))return {rows:[{inspection_id:88,inspection_date:'2026-09-23'}]};
   if(sql.includes('SELECT d.*'))return {rows:[state]};
   // Answered for the same reason as the fixture above: the close is now
   // date-scoped and reads `late` from SQL before it runs.
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
   return {rows:[]};
 });
 const result=await endDutyWithReport({driverId:7,vehicleId:2,report:{findings:'sira ang preno'},clientSubmissionId:submission('b')});
 expect(result).toMatchObject({inspectionId:88,reported:true,recorded:true});
 const [sql,values]=query.mock.calls.find(([sql])=>sql.includes('INSERT INTO vehicleinspection'));
 // NULL, not a guessed level: one question was asked, so no severity exists.
 expect(values).toContain(null);
 expect(values).toContain('Reported');
 // The retry still ends duty — it must not strand the driver because the first
 // attempt got through.
 const [closeSql]=query.mock.calls.find(([sql])=>sql.includes("end_duty_outcome='Reported'"));
 expect(closeSql).toContain('time_out=COALESCE(time_out,NOW())');
});

it('appends the late remark on the first report and not on a retry of the same submission',async()=>{
 // Task 4's guard now ACCEPTS a replayed late report, so this UPDATE is reachable a
 // second time for the same (driver, submission). The remark says when the report was
 // FIRST received; appending it again would stamp a later time on every retry until
 // the row read as a history of its own retries.
 let inserts=0;
 query.mockImplementation(async(sql)=>{
   if(sql.includes('INSERT INTO vehicleinspection')){
     // The first call creates the Post-Shift row; the retry hits the unique index and
     // returns nothing, so the recovery branch above takes over — the exact signal
     // `appendLateRemark` keys on.
     inserts+=1;
     return inserts===1?{rows:[{inspection_id:88}]}:{rows:[]};
   }
   if(sql.includes('SELECT inspection_id, inspection_date FROM vehicleinspection'))return {rows:[{inspection_id:88,inspection_date:'2026-09-23'}]};
   if(sql.includes('SELECT d.*'))return {rows:[state]};
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
   return {rows:[]};
 });
 const first=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('e')});
 const retry=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('e')});
 expect(inserts).toBe(2);
 // `late` is true for BOTH, remark or no remark: the client is told the report was
 // late either way, and that answer comes from SQL, which `verify-duty-autoclose.mjs`
 // block (c) pins against live. This test pins the REMARK decision instead, which is
 // JS and therefore visible here — the reason the decision was put in JS at all
 // rather than in the CASE.
 expect(first.late).toBe(true);
 expect(retry.late).toBe(true);
 const closes=query.mock.calls.filter(([sql])=>sql.includes("end_duty_outcome='Reported'"));
 expect(closes).toHaveLength(2);
 // values[2] is the $3 bound into the remark CASE. Asserted as the BOUND PARAMETER
 // rather than through the remark's text, because the decision is JS: the statement's
 // text is deliberately unchanged, so that the copy of it held by
 // verify-duty-autoclose.mjs stays faithful to the service.
 expect(closes[0][1][2]).toBe(true);
 expect(closes[1][1][2]).toBe(false);
});

it('does not stamp the late remark on an on-time report',async()=>{
 // The reciprocal of the retry case above, and the reason it is not optional: every
 // other lateness mock in this file answers `{yes:true}`, so `late:false` is never
 // exercised. Dropping the `late &&` conjunct therefore passes lint, the whole suite
 // and both live scripts while stamping 'Late End Duty report received <now>' onto
 // EVERY on-time report — permanently, and unrecoverably; the neighbouring comment
 // says it: a mislabelled row cannot be told from a real one afterwards.
 query.mockImplementation(async(sql)=>{
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
   if(sql.includes('AS yes'))return {rows:[{yes:false}]};
   if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
   return {rows:[]};
 });
 const result=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('j')});
 expect(result).toMatchObject({late:false,recorded:true});
 const [sql,values]=query.mock.calls.find(([sql])=>sql.includes("end_duty_outcome='Reported'"));
 expect(sql).toContain('CASE WHEN $3::boolean');
 expect(values[2]).toBe(false);
});

it('closes a no-vehicle day once, and returns the recorded outcome on a replay',async()=>{
 // Task 4's route ADMITS a replay of a day this branch closed (there is no Post-Shift
 // row for `reportAlreadyFiled` to find), and round 4 moved the write-once from the
 // statement to the read above it: a day already closed 'NoVehicle' returns the
 // recorded outcome BEFORE a vehicle is consulted, so the close is reached only once
 // and no `$3` guard is needed — or reachable. Without the early return a replay takes
 // the reported branch, which is what round 3's "the branch is a fixed point"
 // justification missed.
 let prior=null;
 query.mockImplementation(async(sql)=>{
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
   if(sql.includes('SELECT end_duty_outcome FROM driverattendance'))return {rows:prior?[{end_duty_outcome:prior}]:[]};
   return {rows:[]};
 });
 const first=await endDutyWithReport({driverId:7,vehicleId:null,report:{nothing_unusual:true},clientSubmissionId:submission('k')});
 prior='NoVehicle';   // what the read above finds on the second attempt
 const replay=await endDutyWithReport({driverId:7,vehicleId:null,report:{nothing_unusual:true},clientSubmissionId:submission('k')});
 expect(first).toMatchObject({recorded:false,inspectionId:null,reported:false});
 expect(replay).toMatchObject({recorded:false,inspectionId:null,reported:false});
 const closes=query.mock.calls.filter(([sql])=>sql.includes("end_duty_outcome='NoVehicle'"));
 // ONE close, not two: the replay returned before it. This is the assertion the `$3`
 // parameter used to carry, and it is stronger — a guard that could never be false
 // could not stop the second write, and only this can.
 expect(closes).toHaveLength(1);
 // The bound id is the submission's, so the fixed point's id arm has something to match
 // (round 5). The day is still `$2`, and it is still the resolved one.
 expect(closes[0][1]).toEqual([7,'2026-09-23',submission('k')]);
 expect(closes[0][0]).toContain('time_out=COALESCE(time_out,NOW())');
});

it('refuses a submission id that is already spent, and writes nothing',async()=>{
 // The INSERT conflicted on the unique index (it already holds this id) and the recovery
 // found no Post-Shift row — so the row the index holds is another KIND of record, or a
 // report for a day the CLIENT named and the record contradicts. Recovering it would close
 // this day as 'Reported' with no record for it and hand the caller another day's
 // inspection id. One reason covers both shapes: the caller's action is identical.
 query.mockImplementation(async(sql)=>{
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
   if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[]};
   if(sql.includes('SELECT inspection_id, inspection_date FROM vehicleinspection'))return {rows:[]};
   return {rows:[]};
 });
 const result=await endDutyWithReport({driverId:7,vehicleId:2,report:{findings:'sira ang preno'},clientSubmissionId:submission('l')});
 expect(result).toMatchObject({recorded:false,inspectionId:null,reported:false,reason:'submission_id_already_used'});
 // The load-bearing half, and the reason it is asserted separately: a check on the
 // return value alone would pass against a refusal that closed the day first.
 expect(query.mock.calls.some(([sql])=>sql.includes('UPDATE driverattendance'))).toBe(false);
});

it('returns the recorded no-vehicle outcome on a replay, even when a vehicle resolves',async()=>{
 // The route half of this pairing is in `route.test.js`; neither half can see the defect
 // alone. `vehicleId` arrives here ALREADY RESOLVED, and the route's `resolveReportVehicle`
 // falls back to the date-blind `effectiveStandbyVehicle` — "the pairing you have now" — so
 // on a replay of a day the no-vehicle path closed, a pairing that has since become
 // resolvable makes `vehicleId` non-null. Without the early return this takes the REPORTED
 // branch: a Post-Shift row filed against a vehicle never driven that day, and
 // `end_duty_outcome` flipped from 'NoVehicle' to 'Reported'. That is why round 3's
 // "the branch is a fixed point" justification was false, and the mock below is built so
 // the wrong branch SUCCEEDS — a real vehicle id and an INSERT that returns a row.
 query.mockImplementation(async(sql)=>{
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
   if(sql.includes('SELECT end_duty_outcome FROM driverattendance'))return {rows:[{end_duty_outcome:'NoVehicle'}]};
   if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
   return {rows:[]};
 });
 const result=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('m')});
 expect(result).toMatchObject({checkedIn:false,recorded:false,reported:false,inspectionId:null,late:true});
 // "Returns the recorded outcome" is only half of it: it must write NOTHING, or the
 // returned shape would just be a description of what it declined to report.
 expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO vehicleinspection'))).toBe(false);
  expect(query.mock.calls.some(([sql])=>sql.includes('UPDATE driverattendance'))).toBe(false);
});

it('fires the fixed point when the NoVehicle row is the SECOND of two',async()=>{
  // The coverage gap that let round 5's blocker stay green: every other mock answers the
  // fixed-point read with 0 or 1 row, while the read is ONE statement with two OR arms and
  // no ORDER BY — the id arm is day-blind, the day arm carries no outcome predicate — so a
  // single read can return the NoVehicle close of one day AND another day's already-closed
  // row, in an order nothing controls. Deciding on `priorRows[0]` therefore made the row
  // order decide whether the early return fired, and with the NoVehicle row SECOND the
  // request fell through to the reported branch: this report filed, the day closed
  // 'Reported'. Shown RED by restoring `priorRows[0]`.
  //
  // Both halves — the write that must not happen and the shape that must come back — are
  // asserted in ONE comparison so that the RED run reports BOTH instead of stopping at the
  // first failed expect.
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('SELECT end_duty_outcome FROM driverattendance'))
      return {rows:[{end_duty_outcome:'Reported'},{end_duty_outcome:'NoVehicle'}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  const result=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('q')});
  const wroteAnUpdate=query.mock.calls.some(([sql])=>sql.includes('UPDATE driverattendance'));
  expect({result,wroteAnUpdate}).toEqual({
    result:{checkedIn:false,inspectionId:null,reported:false,recorded:false,changed:false,late:true},
    wroteAnUpdate:false,
  });
});

it('runs past the fixed point when neither of the two rows is a no-vehicle close',async()=>{
  // The symmetric half: two rows back, neither 'NoVehicle'. The early return must NOT fire —
  // a driver filing a real report must not be handed `recorded: false` because some
  // unrelated row came back first. Execution proceeds past the fixed point all the way to
  // the reported branch: the Post-Shift row is written and the day is closed 'Reported'.
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('SELECT end_duty_outcome FROM driverattendance'))
      return {rows:[{end_duty_outcome:'Reported'},{end_duty_outcome:'AutoClosed'}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  const result=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('r')});
  expect(result).toMatchObject({checkedIn:false,inspectionId:88,reported:false,recorded:true});
  expect(query.mock.calls.some(([sql])=>sql.includes("end_duty_outcome='Reported'"))).toBe(true);
});

it('recognises a midnight retry by its submission id, on a day the marker is not',async()=>{
  // Defect 2 (Task 4's fix round 5), and the case a day-anchored read cannot see. A shift
  // closed at 00:05 on the 24th closes the 23rd; the retry at 00:10 resolves the 24th. The
 // day arm looks at the 24th, finds no marker, and the request takes the REPORTED branch:
 // a fresh Post-Shift row dated the 24th against a vehicle that was never driven that day,
 // a work order that can ground the wrong vehicle, and a 200 `recorded: true` that stops
 // the client retrying. The id arm spans the two days — that is what it is for.
 //
 // The mock models the row as DATA rather than as text: the close left it on the 23rd
 // under THIS submission id, so only a read that carries the id can find it. Shown RED by
 // making the read day-only (`end_duty_submission_id=$2` removed): the day in the
 // parameters is the 24th, the row is not found, and the reported branch runs.
 const ID=submission('o');
 const closed={date:'2026-09-23',submissionId:ID,outcome:'NoVehicle'};
 query.mockImplementation(async(sql,values)=>{
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-24'}]};
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
   if(sql.includes('SELECT end_duty_outcome FROM driverattendance')){
     // The id matches only if the statement CARRIES the id arm. `values` holds the id
     // either way — it is the same parameter array — so keying on `values` alone would
     // answer "found" for a day-only read and this test could not fail. The day arm is
     // gated the same way and for the same reason.
     const matched=(sql.includes('end_duty_submission_id=$2')&&values.includes(closed.submissionId))
       ||(sql.includes('date=$3::date')&&values.includes(closed.date));
     return {rows:matched?[{end_duty_outcome:closed.outcome}]:[]};
   }
   if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
   return {rows:[]};
 });
 const result=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:ID});
 expect(result).toMatchObject({checkedIn:false,inspectionId:null,reported:false,recorded:false});
 // The load-bearing half: it must write NOTHING. The returned shape alone would be a
 // description of what it declined to do, while the Post-Shift row and the work order hang
 // off the branch this keeps it out of.
 expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO vehicleinspection'))).toBe(false);
 expect(query.mock.calls.some(([sql])=>sql.includes('UPDATE driverattendance'))).toBe(false);
});

it('does not read a reopened day as closed without a report',async()=>{
 // The other half of defect 1, and the reason the day arm carries `time_out IS NOT NULL`.
 // A row reopened BEFORE this round's fix still carries the stale 'NoVehicle' marker while
 // being open again — `time_out` NULL. The mock models that row as data, one row projected
 // through the statement's own predicates: the day matches, and the row's `time_out` is
 // NULL, so a day arm that does not require one reads the row as "closed this way" and
 // strands the driver on a duty they restarted — the consequence `setDuty`'s reopen is
 // supposed to prevent, and the one the sweep cannot rescue them from either. Shown RED by
 // dropping `time_out IS NOT NULL` from the statement.
 const DAY='2026-09-23';
 query.mockImplementation(async(sql,values)=>{
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:DAY}]};
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
   if(sql.includes('SELECT end_duty_outcome FROM driverattendance')){
     const byDay=values.includes(DAY)&&!sql.includes('time_out IS NOT NULL');
     return {rows:byDay?[{end_duty_outcome:'NoVehicle'}]:[]};
   }
   if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
   return {rows:[]};
 });
 const result=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('p')});
 // The reported branch runs, and that is the assertion: the duty is live, and this is a
 // report being filed on it rather than a replay of a close.
 expect(result).toMatchObject({recorded:true,inspectionId:88});
 expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO vehicleinspection'))).toBe(true);
});

it('accepts a retry whose recorded row is dated another day, unless the client names a contradicting one',async()=>{
 // The midnight-crossing retry, and the case round 3 regressed. On the ordinary path the
 // client names no day, so the server resolves one PER REQUEST: a shift closed at 00:05 on
 // the 24th carries a Post-Shift row dated the 23rd, and the retry resolves the 24th. A
 // date predicate in the recovery refused that — a 409 for a report that WAS recorded. The
 // recorded row's own `inspection_date` is authoritative instead, so only a day the CLIENT
 // named can contradict it.
 const recorded=new Date(2026,8,23);   // pg hands a `date` column back as a JS Date
 query.mockImplementation(async(sql)=>{
   if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-24'}]};  // the retry resolves the 24th
   if(sql.includes('AS yes'))return {rows:[{yes:true}]};
   if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[]};                          // the unique index holds the id
   if(sql.includes('SELECT inspection_id, inspection_date FROM vehicleinspection'))return {rows:[{inspection_id:88,inspection_date:recorded}]};
   return {rows:[]};
 });
 const accepted=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('n')});
 expect(accepted).toMatchObject({inspectionId:88,recorded:true});
 // And it re-asserts the day the REPORT belongs to, not the one the retry resolved:
 // closing the 24th would close a day that has no report against it.
 const [,closeValues]=query.mock.calls.find(([sql])=>sql.includes("end_duty_outcome='Reported'"));
 expect(closeValues[1]).toBe('2026-09-23');

 // The same request with the recorded day NAMED is still a retry.
 const matching=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('n'),dutyDate:'2026-09-23'});
 expect(matching).toMatchObject({inspectionId:88,recorded:true});

 // A client-named day that contradicts the record is the one case that is refused — and
 // it is refused without writing, so the day it names is left exactly as it was.
 const before=query.mock.calls.length;
 const refused=await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('n'),dutyDate:'2026-09-22'});
 expect(refused).toMatchObject({recorded:false,inspectionId:null,reported:false,reason:'submission_id_already_used'});
 expect(query.mock.calls.slice(before).some(([sql])=>sql.includes('UPDATE driverattendance'))).toBe(false);
});

it('rejects an end-duty report that answers neither way or both, before writing anything',async()=>{
 for(const report of [{},{nothing_unusual:true,findings:'may problema sa preno'},{nothing_unusual:'false'}]){
   await expect(endDutyWithReport({driverId:7,vehicleId:2,report,clientSubmissionId:submission('c')}))
     .rejects.toMatchObject({status:400,code:'REPORT_INVALID'});
 }
 expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO vehicleinspection'))).toBe(false);
 // This asserted on a `time_out=NOW()` needle, and that needle cannot match any statement
 // this path could reach (round 4 repair): every close in the service reads
 // `time_out=COALESCE(time_out,NOW())`, and the only statement left in the file that
 // literally says `time_out=NOW()` is `setDuty`'s, which this test never calls. So the
 // assertion could not fail however much the invalid-report path wrote — a check that has
 // never been able to fail is not evidence. What "before writing anything" means here is
 // stronger and exactly true: the report is validated before the transaction is opened,
 // so a rejected payload issues no statement at all, not merely no write.
 expect(query).not.toHaveBeenCalled();
});

it('ends duty with no report when the driver has no vehicle, and records the gap',async()=>{
 const result=await endDutyWithReport({driverId:7,vehicleId:null,report:{nothing_unusual:true},clientSubmissionId:submission('d')});
 expect(result).toMatchObject({inspectionId:null,recorded:false});
 // vehicleinspection.vehicle_id is NOT NULL, so a report cannot be filed — and
 // ending duty must not depend on one. The gap goes on the attendance row
 // instead of being faked into an inspection against a vehicle they never had.
 expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO vehicleinspection'))).toBe(false);
 // Matched on the close itself, not on a bare `end_duty_outcome`: the prior-outcome read
 // above it carries that column too, so a loose key would find the READ and then assert
 // about a statement that writes nothing. The remark is no longer behind a guard at all
 // (round 4) — the replay that used to be stopped by `$3` is now stopped by the early
 // return, asserted in 'closes a no-vehicle day once…' below.
 const [sql]=query.mock.calls.find(([sql])=>sql.includes("end_duty_outcome='NoVehicle'"));
 expect(sql).toContain('no End Duty report recorded');
 // COALESCE, not a bare NOW(): the first close's time is the row's record of when the
 // duty ended, so the read-then-return early return keeps it rather than letting a
 // second request restamp it.
 expect(sql).toContain('time_out=COALESCE(time_out,NOW())');
});

it('closes the row the report belongs to, not every open row',async()=>{
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    // The resolved date is compared against today's Manila date in SQL. The mock
    // answers that query rather than reimplementing the comparison in JS.
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('e')});
  // Repointed (round 4): the day's recorded outcome is now read before anything else,
  // so a bare `includes('end_duty_outcome')` finds the prior-outcome read first and
  // asserts the wrong statement. Keyed on the close's own text instead.
  const [sql,values]=query.mock.calls.find(([sql])=>sql.includes('Late End Duty report received'));
  expect(sql).toContain("end_duty_outcome='Reported'");
  // Date-scoped, and the outcome is written by the same statement that closes
  // the row — a second statement could land without the first.
  expect(sql).toContain('date=$2::date');
  expect(values[1]).toBe('2026-09-23');
  // Found by the REMARK text and not by the outcome it asserts (round 5 repair). The
  // line that used to stand here — `find(sql => sql.includes("end_duty_outcome='Reported'"))`
  // followed by `toContain("end_duty_outcome='Reported'")` — could not fail: the needle
  // WAS the asserted substring, so it was true by construction whatever the statement
  // said. `Late End Duty report received` appears in exactly one statement in the
  // service (grep it before relying on that), so it identifies the close just as
  // precisely and leaves the outcome assertion with something to test.
});

it('files the inspection on the duty date, not on today',async()=>{
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('f')});
  const [sql,values]=query.mock.calls.find(([sql])=>sql.includes('INSERT INTO vehicleinspection'));
  expect(sql).toContain('$7::date');
  expect(values[6]).toBe('2026-09-23');
});

it('marks a report as late and says so on the row it amends',async()=>{
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    // The lateness comparison lives in SQL, so the mock supplies its answer. This
    // test covers the plumbing: `late` reaches the remark, and the resolved date
    // is the one passed in rather than the open row's.
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  const result=await endDutyWithReport({
    driverId:7,vehicleId:2,report:{findings:'sira ang preno'},clientSubmissionId:submission('g'),dutyDate:'2026-09-23',
  });
  expect(result).toMatchObject({late:true,reported:true});
  // Repointed for the same reason as the test above: the prior-outcome read matches
  // `end_duty_outcome` first now, so the close has to be found by its own text.
  const [sql]=query.mock.calls.find(([sql])=>sql.includes("end_duty_outcome='Reported'"));
  // Both facts survive: the sweep's close AND the late report. Overwriting the
  // remark would erase the evidence that this duty was ever abandoned.
  expect(sql).toContain('Late End Duty report received');
});

it('records the no-vehicle outcome rather than leaving the duty open',async()=>{
  // No vehicle skips the report path, but the day still has to resolve, its recorded
  // outcome has to be read, and the lateness still has to be computed — so all three
  // queries need answers here.
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:'2026-09-23'}]};
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('SELECT end_duty_outcome FROM driverattendance'))return {rows:[]};
    return {rows:[]};
  });
  await endDutyWithReport({driverId:7,vehicleId:null,report:{nothing_unusual:true},clientSubmissionId:submission('h')});
  const [sql,values]=query.mock.calls.find(([sql])=>sql.includes("end_duty_outcome='NoVehicle'"));
  // This used to assert `toContain("end_duty_outcome='NoVehicle'")` against a `find`
  // keyed on that same text — the needle WAS the asserted substring, so the line carried
  // no information (round 4 repair). The statement's date scope and its bound parameters
  // are what is actually worth pinning: the close must land on the day that was resolved,
  // or it closes a row that has no report against it. The arity is pinned too — three
  // parameters since round 5, the third being the submission id the fixed point matches
  // on (`COALESCE(end_duty_submission_id,$3)`), which is asserted on its own below.
  expect(sql).toContain('date=$2::date');
  expect(values).toEqual([7,'2026-09-23',submission('h')]);
  expect(sql).toContain('COALESCE(end_duty_submission_id,$3)');
});

it('resolves the day from a real Date, which is what pg actually returns',async()=>{
  // The other tests mock `date` as a 'YYYY-MM-DD' string, so they pass whether or
  // not the service can handle the value production really gets. `driverattendance.date`
  // is a Postgres `date`, and pg's default parser (OID 1082) hands back a JS Date
  // built at local midnight — never a string. A `String(v).slice(0,10)` on that
  // yields "Tue Sep 23" and the ::date cast below throws, so every real End Duty
  // call 500s while the whole suite stays green. This test is the one that fails.
  // `new Date(2026, 8, 23)` reproduces pg's value exactly: month is 0-indexed.
  query.mockImplementation(async(sql)=>{
    if(sql.includes('SELECT date FROM driverattendance'))return {rows:[{date:new Date(2026,8,23)}]};
    if(sql.includes('AS yes'))return {rows:[{yes:true}]};
    if(sql.includes('INSERT INTO vehicleinspection'))return {rows:[{inspection_id:88}]};
    return {rows:[]};
  });
  await endDutyWithReport({driverId:7,vehicleId:2,report:{nothing_unusual:true},clientSubmissionId:submission('i')});
  // Repointed: a bare `includes('end_duty_outcome')` now matches the prior-outcome read,
  // whose `values[1]` is the same day — so it passed for the wrong statement. The close
  // is found by its own text, which is the statement that actually casts the day.
  const [,values]=query.mock.calls.find(([sql])=>sql.includes("end_duty_outcome='Reported'"));
  expect(values[1]).toBe('2026-09-23');
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
