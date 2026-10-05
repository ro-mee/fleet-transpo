import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ query: {}, mutation: {}, chat: null, keys: [], queries: [], buttons: [], messages: vi.fn(), selection: null, persisted: [], cleared: [] }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options) => { state.keys.push(options.queryKey); state.queries.push(options); return state.query; },
  useMutation: () => state.mutation,
  useQueryClient: () => ({setQueryData:vi.fn(),invalidateQueries:vi.fn()}),
}));
vi.mock('@/components/ui/button', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    Button: props => {
      state.buttons.push(props);
      return React.createElement(actual.Button, props);
    },
  };
});
vi.mock('@/hooks/use-role-access', () => ({useRoleAccess:()=>({can:()=>true})}));
vi.mock('@/components/reservations/trip-summary', () => ({useNow:()=>Date.parse('2026-09-15T00:00:00Z')}));
vi.mock('./copilot-conversation', () => ({
  setReservationMessages: state.messages,
  getReservationSelection: () => state.selection,
  setReservationSelection: (requestId, selection) => { state.persisted.push({requestId, selection}); },
  clearReservationSelection: (requestId) => { state.cleared.push(requestId); },
  CopilotConversation:({children,reply,selectedReply,...props})=>{state.chat={...props,children,reply,selectedReply};return React.createElement(React.Fragment,null,children,selectedReply,reply);},
}));
import { AiRecommendationPanel } from './ai-recommendation-panel';
import {
  canRestoreRememberedSelection,
  canStartSelectionCheck,
  recommendationStatusLabel,
  recheckSelectedRecommendation,
} from './recommendation-panel-state';

const a={vehicle_id:1,driver_id:2,vehicle:{plate_number:'PAIR-A'},driver:{driver_name:'Driver A'},score:87,
  checks:[{id:'capacity',label:'Capacity',status:'verified'}],readiness:'VERIFIED',feasibility:{verdict:'SAFE'},reasons:[]};
const b={...a,vehicle_id:3,driver_id:4,vehicle:{plate_number:'PAIR-B'},driver:{driver_name:'Driver B'}};
beforeEach(()=>{
  // This repo's Vitest JSX transform uses the classic React runtime.
  vi.stubGlobal('React',React);
  state.keys=[];
  state.queries=[];
  state.buttons=[];
  // A fresh store per test: no remembered selection, nothing written, nothing cleared.
  state.messages.mockClear();
  state.selection=null;
  state.persisted=[];
  state.cleared=[];
  state.query={data:{evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:a,candidates:[a,b]}},refetch:vi.fn()};
  state.mutation={isPending:false,mutate:vi.fn()};
});
afterEach(()=>vi.unstubAllGlobals());
const render=props=>renderToStaticMarkup(React.createElement(AiRecommendationPanel,{requestId:1,canAssign:true,...props}));
// React puts disabled="" before title; the class list always contains
// disabled:pointer-events-none, so the attribute check must be exact.
const recheckButton=html=>html.match(/<button[^>]*title="Recheck evidence for this reservation"[^>]*>/)?.[0]??'';
const findElement = (node, predicate) => {
  if (Array.isArray(node)) return node.map(child => findElement(child, predicate)).find(Boolean) ?? null;
  if (!React.isValidElement(node)) return null;
  if (predicate(node)) return node;
  return findElement(node.props?.children, predicate);
};
const findElementByText = (node, text) => findElement(node, element => element.props?.children === text);

it('disables free-text chat while the first recommendation is loading',()=>{
  state.query={data:undefined,isLoading:true,isFetching:true,isError:false,refetch:vi.fn()};
  render();
  expect(state.chat?.disabled).toBe(true);
  expect(state.chat?.hasPair).toBe(false);
  expect(state.chat?.displayedOptions).toEqual([]);
});

it('speaks gating statuses in the thread and surfaces blocked evidence on the card',()=>{
  // First load speaks its own line; there is no pair yet to be confirming.
  state.query.isLoading=true;
  let html=render();
  expect(html).toContain('Checking the eligible options and their schedules.');
  // Permission gating is spoken in the thread once there is evidence to act on.
  state.query.isLoading=false;
  html=render({canAssign:false});
  expect(html).toContain('id="dispatch-confirmation-status"');
  expect(html).toContain('You do not have permission to assign resources.');
  // A background refresh is not something the dispatcher is waiting on, so it must
  // not re-speak "Checking current availability…". That gate keyed on isFetching,
  // which is also true for every 30s poll, so the primary Assign action greyed out
  // on a timer and on every window focus.
  state.query.isFetching=true;
  html=render();
  expect(html).not.toContain('Checking current availability');
  // Same rule for the three ambient header surfaces: a background poll keeps the
  // chip on Evidence, leaves Recheck enabled and does not animate its spinner.
  // Keying them on isFetching made every 30s timer look like a reload.
  expect(html).toContain('Evidence');
  expect(html).not.toContain('Checking…');
  expect(recheckButton(html)).not.toContain('disabled=""');
  // Blocked evidence is presented on the option card, not as a footer status.
  state.query.isFetching=false;
  const blocked={...a,hardConflicts:[{message:'Vehicle overlap'}]}; state.query.data={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:blocked,candidates:[blocked]}};
  html=render();
  expect(html).toContain('Blocked');
  expect(html).toContain('Vehicle overlap');
});
it('reports Checking only for a first load or an explicit recheck, never a background poll',()=>{
  // First load: no result yet, so the chip says Checking and Recheck is inert.
  // isLoading with data present never happens in React Query (isPending means
  // no data), so the fixture drops data to match that contract.
  state.query.data=undefined;
  state.query.isLoading=true;
  state.query.isFetching=true;
  let html=render();
  expect(html).toContain('Checking');
  expect(html).toContain('Evaluating pair options');
  expect(html).not.toContain('Evidence evaluated');
  expect(recheckButton(html)).toContain('disabled=""');
  // Background poll with data on screen: Evidence stays, Recheck stays usable.
  state.query.data={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:a,candidates:[a,b]}};
  state.query.isLoading=false;
  state.query.isFetching=true;
  html=render();
  expect(html).toContain('Evidence');
  expect(html).not.toContain('>Checking<');
  expect(html).not.toContain('Checking…');
  expect(recheckButton(html)).not.toContain('disabled=""');
  // An error outranks an in-flight refresh on the chip.
  state.query.isError=true;
  state.query.error=new Error('network');
  html=render();
  expect(html).toContain('Unavailable');
  state.query.isError=false;
  state.query.error=null;
});
it('keeps the recommendation query on the app-wide freshness policy',()=>{
  render();
  const q=state.queries.find(o=>o.queryKey?.[0]==='reservation-recommendation');
  // A 30s re-check cadence, and no per-query override that turns every remount or
  // focus change into a real re-evaluation. staleTime:0 + refetchOnMount/
  // refetchOnWindowFocus "always" was the cause of the reload-on-every-movement.
  expect(q.staleTime).toBe(30_000);
  expect(q.refetchInterval).toBe(30_000);
  expect(q.refetchIntervalInBackground).toBe(false);
  expect(q.refetchOnWindowFocus).toBeUndefined();
  expect(q.refetchOnMount).toBeUndefined();
});
it('shows the option flow inside the conversation thread by default',()=>{
  const html=render();
  expect(html).toContain('2 eligible options found for this reservation.');
  expect(html).toContain('Option 1 — Recommended option');
  expect(html).toContain('Option 2 — Alternate option');
  expect(html).toContain('role="button"');
  expect(html).toContain('Schedule &amp; workload details');
  expect(html).toContain('Choose Option 1');
  expect(html).toContain('Choose Option 2');
  // Hidden from the default view but still available under the disclosure.
  expect(html).not.toContain('View technical evidence');
  expect(html).not.toMatch(/<details[^>]*\sopen/);
  // The conversation is always mounted and carries the displayed option as context.
  expect(state.chat?.hasPair).toBe(true);
  expect(state.chat?.selectedPair).toBeNull();
  expect(state.chat?.displayedOptions).toEqual([{vehicleId:1,driverId:2},{vehicleId:3,driverId:4}]);
  expect(state.keys.every(key=>key[0]==='reservation-recommendation')).toBe(true);
});
it('withholds a VERIFIED queue proposal whose candidate evaluation is incomplete',()=>{
  const plan={planToken:'signed',expiresAt:'2026-09-15T00:01:00Z'};
  const onReanalyze=vi.fn();
  state.selection={key:'1:2',pinnedKeys:['1:2','3:4']};
  const html=render({queueMode:true,plan,planProposal:{pair:b,outcome:'VERIFIED',candidateEvaluationComplete:false},planToken:'signed',planExpiresAt:plan.expiresAt,planValidation:{isSuccess:true},onReanalyze});
  expect(html).toContain('Queue analysis incomplete');
  expect(html).toContain('Retry queue analysis');
  expect(html).toContain('Change selection');
  expect(html).not.toContain('Choose Option 1');
  expect(html).not.toContain('Confirm assignment');
  expect(state.chat?.disabled).toBe(true);
  expect(state.chat?.hasPair).toBe(false);
  expect(state.chat?.displayedOptions).toEqual([]);
  expect(state.chat?.selectedPair).toBeNull();
  expect(state.chat?.planToken).toBeNull();
  expect(state.chat?.selectedReply).toBeNull();
  expect(state.chat?.onCommand('Option 1')).toBe('The queue analysis is incomplete. Reanalyze before choosing an option.');
});

it('presents the queue proposal as Option 1 with both cards and a choose prompt',()=>{
  const plan={planToken:'signed',expiresAt:'2026-09-15T00:01:00Z'};
  const html=render({queueMode:true,plan,planProposal:{pair:b,outcome:'VERIFIED'},planToken:'signed',planExpiresAt:plan.expiresAt,planValidation:{isSuccess:true}});
  expect(html).toContain('Option 1 — Recommended option');
  expect(html).toContain('PAIR-B'); // proposal pair is Option 1
  expect(html).toContain('PAIR-A'); // engine candidate is Option 2
  expect(html).not.toContain('Read-only comparison');
});
it('keeps the reviewable pair compact before a choice',()=>{
  const r={...a,readiness:'REVIEWABLE',reviewable:true,feasibility:{verdict:'TIGHT',reasons:['Tight pickup buffer']}};
  state.query.data={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:r,candidates:[r]}};
  const html=render();
  expect(html).toContain('1 eligible option found for this reservation.');
  expect(html).toContain('Review'); // state chip on the option card
  // The Assign action and the reason textarea only appear after choosing, inside the reply.
  expect(html).not.toMatch(/>Assign/);
  expect(html).not.toContain('Review Manual Confirmation');
  expect(html).not.toContain('dispatch-manual-reason');
});
it('preserves terminal and empty-selection views without confirmation controls',()=>{
  expect(render({alreadyAssigned:true})).not.toContain('dispatch-confirmation-status');
  expect(render({requestId:null})).not.toContain('dispatch-confirmation-status');
});
it('limits a completed no-match result to the current evaluation',()=>{
  state.query.data={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:null,candidates:[],none_reasons:[{reason:'Vehicle status is Under Maintenance.'}]}};
  const html=render();
  expect(html).toContain('No eligible option was found in this evaluation for this reservation.');
  expect(html).toContain('Vehicle status is Under Maintenance.');
  expect(html).toContain('data-copilot-message="true"');
});
it('does not invent a verification requirement when the evaluation has no exclusion detail',()=>{
   state.query.data={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:null,candidates:[],none_reasons:[]}};
   const html=render();
   expect(html).toContain('No additional exclusion detail was returned in this evaluation.');
   expect(html).not.toContain('Required evidence needs verification');
 });
 it('does not describe a failed recommendation fetch as a completed no-match',()=>{
   state.query={data:undefined,isLoading:true,isFetching:true,isError:true,error:new Error('network'),refetch:vi.fn()};
   const html=render();
   expect(html).not.toContain('No eligible option');
   expect(html).toContain('Recommendation evidence unavailable');
   expect(html).toContain('role="alert"');
   expect(html).toContain('Retry evidence');
   expect(html).toContain('Unavailable');
   expect(html).not.toContain('Choose Option 1');
 });
 it('withholds current options after a recommendation refresh failure and still clears a saved choice',()=>{
    state.selection={key:'1:2',pinnedKeys:['1:2','3:4']};
   state.query={data:{evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:a,candidates:[a,b],none_reasons:[]}},isLoading:false,isFetching:true,isError:true,error:new Error('network'),refetch:vi.fn()};
   const html=render();
   expect(html).toContain('Historic findings');
    expect(html).toContain('Historic evaluation details');
    expect(html).toContain('PAIR-A');
    expect(html).toContain('Driver A');
    expect(html).toContain('Capacity: verified');
    expect(html).not.toContain('Option 1 — Recommended option');
   expect(html).toContain('Unavailable');
    expect(html).not.toContain('Choose Option 1');
    expect(html).not.toContain('eligible options found for this reservation');
    expect(html).not.toContain('No eligible option');
    expect(state.chat?.selectedReply).toBeNull();
    expect(state.chat?.hasPair).toBe(false);
    expect(state.chat?.displayedOptions).toEqual([]);

   expect(state.chat?.selectedPair).toBeNull();
    const clearSelection=findElementByText(state.chat?.reply,'Change selection');
    expect(clearSelection).not.toBeNull();
    expect(clearSelection.props.disabled).not.toBe(true);
    clearSelection.props.onClick();
    expect(state.cleared).toEqual([1]);
   expect(html).not.toContain('Checking…');
   expect(state.chat?.disabled).toBe(true);
 });
 it('blocks remembered selection checks for incomplete evaluations with populated candidates',()=>{
   state.selection={key:'1:2',pinnedKeys:['1:2','3:4']};
    state.query.data={evaluatedAt:'2026-09-15T00:00:00Z',candidateEvaluationComplete:false,pair:{recommended:a,candidates:[a,b],none_reasons:[{reason:'Analysis budget ended.'}]}};
   const html=render();
   expect(html).toContain('Eligibility unknown');
   expect(html).not.toContain('No eligible option');
   expect(html).toContain('Recheck reservation');
    expect(html).not.toContain('Choose Option 1');
    expect(state.chat?.selectedReply).toBeNull();
    expect(state.chat?.hasPair).toBe(false);
    expect(state.chat?.displayedOptions).toEqual([]);
    expect(canRestoreRememberedSelection({requestId:1,isClosed:false,queryError:false,completedRecommendation:false,optionCount:2})).toBe(false);
    expect(state.chat?.disabled).toBe(true);
     expect(state.chat?.onCommand('Option 1')).toBe('The recommendation evaluation is incomplete. Recheck before choosing an option.');
    expect(state.query.refetch).not.toHaveBeenCalled();
    expect(state.messages).not.toHaveBeenCalled();
 });
 it('preserves cached candidate facts without rerunning current eligibility rules',()=>{
    const historicBlocked={...a,vehicle:{plate_number:'PAIR-HISTORIC'},checks:[{id:'capacity',label:'Capacity',status:'blocking',message:'Capacity failed in the saved evaluation.'}]};
    state.query={data:{evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:historicBlocked,candidates:[historicBlocked]}},isError:true,error:new Error('network'),refetch:vi.fn()};
    const html=render();
    expect(html).toContain('Historic evaluation details');
    expect(html).toContain('PAIR-HISTORIC');
    expect(html).toContain('Capacity: Capacity failed in the saved evaluation.');
    expect(html).not.toContain('Eligible');
    expect(html).not.toContain('Choose Option 1');
  });
  it('ignores malformed cached candidate rows in the historic summary',()=>{
    state.query={data:{evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:null,candidates:[null]}},isError:true,error:new Error('network'),refetch:vi.fn()};
    expect(()=>render()).not.toThrow();
    expect(render()).not.toContain('Historic candidate pair');
  });
  it('keeps saved-selection clearing available when evidence is incomplete',()=>{
    state.selection={key:'1:2',pinnedKeys:['1:2','3:4']};
    state.query.data={evaluatedAt:'2026-09-15T00:00:00Z',candidateEvaluationComplete:false,pair:{recommended:a,candidates:[a,b]}};
    render();
    const clearSelection=findElementByText(state.chat?.reply,'Change selection');
    expect(clearSelection).not.toBeNull();
    clearSelection.props.onClick();
    expect(state.cleared).toEqual([1]);

    state.cleared=[];
    expect(state.chat?.onCommand('Change selection')).toBe('Selection cleared. Recheck before choosing another option.');
    expect(state.cleared).toEqual([1]);
  });
  it('allows fresh recommendation evidence through the selection-check gate despite a stale render snapshot',()=>{
    const canStart = canStartSelectionCheck;
    const freshOption = {currentRecommendation:false,recommendationRefreshed:true,assignmentPending:false,failureChecking:false,unavailable:false,blocked:false};
    expect(canStart?.(freshOption)).toBe(true);
    for (const blockedCase of [
      {recommendationRefreshed:false},
      {assignmentPending:true},
      {failureChecking:true},
      {unavailable:true},
      {blocked:true},
    ]) expect(canStart?.({...freshOption,...blockedCase})).toBe(false);
  });
  it.each(['error', 'incomplete'])('rechecks a saved pair after prior %s evidence recovers',async priorState=>{
    const events=[];
    const freshRecommendation={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:a,candidates:[a]}};
    const previousState=priorState==='error'
      ? {isError:true,error:new Error('previous request failed')}
      : {isError:false,data:{evaluatedAt:'2026-09-14T00:00:00Z',candidateEvaluationComplete:false,pair:{candidates:[a]}}};
    const query={...previousState,refetch:vi.fn(async()=>{events.push('refetch');return {isError:false,data:freshRecommendation};})};
    const invalidateSelectionCheck=vi.fn(()=>events.push('invalidate'));
    const resolveCurrentOption=vi.fn((data,selectionKey)=>{events.push('resolve');expect(data).toBe(freshRecommendation);expect(selectionKey).toBe('1:2');return {option:{pair:a},pinnedKeys:['1:2']};});
    const chooseOption=vi.fn((option,message,options)=>{events.push('check');return {option,message,options};});
    await recheckSelectedRecommendation({query,selectionKey:'1:2',invalidateSelectionCheck,isCurrent:()=>true,resolveCurrentOption,chooseOption});
    expect(events).toEqual(['invalidate','refetch','resolve','check']);
    expect(chooseOption).toHaveBeenCalledWith({pair:a},'Recheck selected option',{pin:['1:2'],recommendationRefreshed:true});
  });
  it('does not check when the refreshed recommendation request fails',async()=>{
    const events=[];
    const query={refetch:vi.fn(async()=>{events.push('refetch');return {isError:true,data:{evaluatedAt:'2026-09-15T00:00:00Z',pair:{candidates:[a]}}};})};
    const invalidateSelectionCheck=vi.fn(()=>events.push('invalidate'));
    const resolveCurrentOption=vi.fn(()=>{events.push('resolve');return {option:{pair:a},pinnedKeys:['1:2']};});
    const chooseOption=vi.fn(()=>events.push('check'));
    await recheckSelectedRecommendation({query,selectionKey:'1:2',invalidateSelectionCheck,isCurrent:()=>true,resolveCurrentOption,chooseOption});
    expect(events).toEqual(['invalidate','refetch']);
    expect(resolveCurrentOption).not.toHaveBeenCalled();
    expect(chooseOption).not.toHaveBeenCalled();
  });
  it('refetches then rederives a current option before checking it',async()=>{
    const events=[];
    const freshRecommendation={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:a,candidates:[a]}};
    const freshOption={pair:a};
    const query={refetch:vi.fn(async()=>{events.push('refetch');return {isError:false,data:freshRecommendation};})};
    const invalidateSelectionCheck=vi.fn(()=>events.push('invalidate'));
    const resolveCurrentOption=vi.fn((data,selectionKey)=>{events.push('resolve');expect(data).toBe(freshRecommendation);expect(selectionKey).toBe('1:2');return {option:freshOption,pinnedKeys:['1:2']};});
    const chooseOption=vi.fn((option,message,options)=>{events.push('check');return {option,message,options};});
    await recheckSelectedRecommendation({query,selectionKey:'1:2',invalidateSelectionCheck,isCurrent:()=>true,resolveCurrentOption,chooseOption});
    expect(events).toEqual(['invalidate','refetch','resolve','check']);
    expect(chooseOption).toHaveBeenCalledWith(freshOption,'Recheck selected option',{pin:['1:2'],recommendationRefreshed:true});
  });
  it('does not check when the refreshed recommendation is incomplete',async()=>{
    const events=[];
    const incomplete={evaluatedAt:'2026-09-15T00:00:00Z',candidateEvaluationComplete:false,pair:{candidates:[a]}};
    const query={refetch:vi.fn(async()=>{events.push('refetch');return {isError:false,data:incomplete};})};
    const invalidateSelectionCheck=vi.fn(()=>events.push('invalidate'));
    const resolveCurrentOption=vi.fn(()=>{events.push('resolve');return null;});
    const chooseOption=vi.fn(()=>events.push('check'));
    await recheckSelectedRecommendation({query,selectionKey:'1:2',invalidateSelectionCheck,isCurrent:()=>true,resolveCurrentOption,chooseOption});
    expect(events).toEqual(['invalidate','refetch']);
    expect(resolveCurrentOption).not.toHaveBeenCalled();
    expect(chooseOption).not.toHaveBeenCalled();
  });
  it('does not check when the refreshed recommendation no longer offers a selectable pair',async()=>{
    const events=[];
    const freshRecommendation={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:a,candidates:[a]}};
    const query={refetch:vi.fn(async()=>{events.push('refetch');return {isError:false,data:freshRecommendation};})};
    const invalidateSelectionCheck=vi.fn(()=>events.push('invalidate'));
    const resolveCurrentOption=vi.fn((data,selectionKey)=>{events.push('resolve');expect(data).toBe(freshRecommendation);expect(selectionKey).toBe('3:4');return null;});
    const chooseOption=vi.fn(()=>events.push('check'));
    await recheckSelectedRecommendation({query,selectionKey:'3:4',invalidateSelectionCheck,isCurrent:()=>true,resolveCurrentOption,chooseOption});
    expect(events).toEqual(['invalidate','refetch','resolve']);
    expect(chooseOption).not.toHaveBeenCalled();
  });
  it('does not revive a selection cleared while the recommendation refresh is in flight',async()=>{
    const events=[];
    const query={refetch:vi.fn(async()=>{events.push('refetch');return {isError:false,data:{evaluatedAt:'2026-09-15T00:00:00Z',pair:{candidates:[a]}}};})};
    const invalidateSelectionCheck=vi.fn(()=>events.push('invalidate'));
    const isCurrent=vi.fn(()=>{events.push('is-current');return false;});
    const resolveCurrentOption=vi.fn(()=>events.push('resolve'));
    const chooseOption=vi.fn(()=>events.push('check'));
    await recheckSelectedRecommendation({query,selectionKey:'1:2',invalidateSelectionCheck,isCurrent,resolveCurrentOption,chooseOption});
    expect(events).toEqual(['invalidate','refetch','is-current']);
    expect(resolveCurrentOption).not.toHaveBeenCalled();
    expect(chooseOption).not.toHaveBeenCalled();
  });
  it('reports Checking while an explicit retry is in progress despite the prior error',()=>{
    expect(recommendationStatusLabel({queryError:true,stale:false,checking:true})).toBe('Checking');
    expect(recommendationStatusLabel({queryError:true,stale:false,checking:false})).toBe('Unavailable');
    expect(recommendationStatusLabel({queryError:false,stale:false,checking:false,incomplete:true})).toBe('Incomplete');
  });
  it('gives failed queue analysis an alert and a reanalysis action',()=>{
   const html=render({queueMode:true,planError:'network',onReanalyze:vi.fn()});
   expect(html).toContain('Queue analysis failed');
   expect(html).toContain('role="alert"');
   expect(html).toContain('Retry queue analysis');
 });
 it('keeps saved selection clearable when failed analysis hides the incomplete-proposal status',()=>{
   state.selection={key:'1:2',pinnedKeys:['1:2','3:4']};
   const html=render({
     queueMode:true,
     planProposal:{pair:b,outcome:'VERIFIED',candidateEvaluationComplete:false},
     planError:'network',
     onReanalyze:vi.fn(),
   });
   expect(html).toContain('Queue analysis failed');
   expect(html).toContain('Retry queue analysis');
   expect(html).toContain('Change selection');
    const clearButton=state.buttons.find(button=>button.children==='Change selection');
    expect(clearButton).toBeDefined();
    expect(clearButton.disabled).not.toBe(true);
    clearButton.onClick();
    expect(state.cleared).toEqual([1]);
  });
  it('renders only one saved-selection clear action when request and queue analysis both fail',()=>{
   state.selection={key:'1:2',pinnedKeys:['1:2','3:4']};
   state.query={
     data:{evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:a,candidates:[a,b]}},
     isError:true,
     error:new Error('recommendation network'),
     refetch:vi.fn(),
   };
   const html=render({
     queueMode:true,
     planProposal:{pair:b,outcome:'VERIFIED',candidateEvaluationComplete:false},
     planError:'queue network',
     onReanalyze:vi.fn(),
   });
   expect(html.match(/Change selection/g)).toHaveLength(1);
  });
  it('presents trip details in a CopilotBubble without recommendation options when completed or cancelled',()=>{
  const completedReq={
    request_id:1,
    fleet_status:'Completed',
    guest_name:'Maria Santos',
    pickup_location:'Hotel Lobby',
    dropoff_location:'NAIA Terminal 3',
    passenger_count:2,
    pickup_datetime:'2026-09-15T08:00:00Z',
    vehicles:{plate_number:'ABC-1234',model:'Toyota HiAce'},
    drivers:{first_name:'Juan',last_name:'Dela Cruz',driver_id:12},
  };
  let html=render({selectedRequest:completedReq});
  expect(html).toContain('Trip Completed');
  expect(html).toContain('Completed');
  expect(html).toContain('Maria Santos');
  expect(html).toContain('ABC-1234');
  expect(html).toContain('Juan Dela Cruz');
  expect(html).toContain('Hotel Lobby');
  expect(html).toContain('NAIA Terminal 3');
  expect(html).not.toContain('eligible option found for this reservation.');
  expect(html).not.toContain('Choose Option 1');

  const cancelledReq={
    request_id:2,
    fleet_status:'Cancelled',
    guest_name:'Pedro Penduko',
    status_reason:'Guest requested flight cancellation',
    pickup_location:'City Center',
    dropoff_location:'Grand Hotel',
  };
  html=render({selectedRequest:cancelledReq});
  expect(html).toContain('Reservation Cancelled');
  expect(html).toContain('Cancelled');
  expect(html).toContain('Guest requested flight cancellation');
  expect(html).toContain('Pedro Penduko');
  expect(html).not.toContain('eligible option found for this reservation.');
  expect(html).not.toContain('Choose Option 1');
});
