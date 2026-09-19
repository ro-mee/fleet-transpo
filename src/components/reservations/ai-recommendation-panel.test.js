import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ query: {}, mutation: {}, chat: null, keys: [], queries: [], messages: vi.fn(), selection: null, persisted: [], cleared: [] }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options) => { state.keys.push(options.queryKey); state.queries.push(options); return state.query; },
  useMutation: () => state.mutation,
  useQueryClient: () => ({setQueryData:vi.fn(),invalidateQueries:vi.fn()}),
}));
vi.mock('@/hooks/use-role-access', () => ({useRoleAccess:()=>({can:()=>true})}));
vi.mock('@/components/reservations/trip-summary', () => ({useNow:()=>Date.parse('2026-09-15T00:00:00Z')}));
vi.mock('./copilot-conversation', () => ({
  setReservationMessages: state.messages,
  getReservationSelection: () => state.selection,
  setReservationSelection: (requestId, selection) => { state.persisted.push({requestId, selection}); },
  clearReservationSelection: (requestId) => { state.cleared.push(requestId); },
  CopilotConversation:({children,reply,selectedReply,...props})=>{state.chat=props;return React.createElement(React.Fragment,null,children,selectedReply,reply);},
}));
import { AiRecommendationPanel } from './ai-recommendation-panel';

const a={vehicle_id:1,driver_id:2,vehicle:{plate_number:'PAIR-A'},driver:{driver_name:'Driver A'},score:87,
  checks:[{id:'capacity',label:'Capacity',status:'verified'}],readiness:'VERIFIED',feasibility:{verdict:'SAFE'},reasons:[]};
const b={...a,vehicle_id:3,driver_id:4,vehicle:{plate_number:'PAIR-B'},driver:{driver_name:'Driver B'}};
beforeEach(()=>{
  // This repo's Vitest JSX transform uses the classic React runtime.
  vi.stubGlobal('React',React);
  state.keys=[];
  state.queries=[];
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

it('speaks gating statuses in the thread and surfaces blocked evidence on the card',()=>{
  // First load speaks its own line; there is no pair yet to be confirming.
  state.query.isLoading=true;
  let html=render();
  expect(html).toContain('I am checking the eligible pairs and their schedules.');
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
  // Blocked evidence is presented on the option card, not as a footer status.
  state.query.isFetching=false;
  state.query.data={pair:{recommended:{...a,hardConflicts:[{message:'Vehicle overlap'}]}}};
  html=render();
  expect(html).toContain('Blocked');
  expect(html).toContain('Vehicle overlap');
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
  expect(html).toContain('I found 2 options for this reservation.');
  expect(html).toContain('Option 1 — Recommended');
  expect(html).toContain('Option 2 — Alternative');
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
it('presents the queue proposal as Option 1 with both cards and a choose prompt',()=>{
  const plan={planToken:'signed',expiresAt:'2026-09-15T00:01:00Z'};
  const html=render({queueMode:true,plan,planProposal:{pair:b,outcome:'VERIFIED'},planToken:'signed',planExpiresAt:plan.expiresAt,planValidation:{isSuccess:true}});
  expect(html).toContain('Option 1 — Recommended');
  expect(html).toContain('PAIR-B'); // proposal pair is Option 1
  expect(html).toContain('PAIR-A'); // engine candidate is Option 2
  expect(html).not.toContain('Read-only comparison');
});
it('keeps the reviewable pair compact before a choice',()=>{
  const r={...a,readiness:'REVIEWABLE',reviewable:true,feasibility:{verdict:'TIGHT',reasons:['Tight pickup buffer']}};
  state.query.data={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:r,candidates:[r]}};
  const html=render();
  expect(html).toContain('I found 1 option for this reservation.');
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
it('wraps unavailable assignment and exclusion reasons inside a CopilotBubble',()=>{
  state.query.data={evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:null,candidates:[],none_reasons:[{reason:'Vehicle status is Under Maintenance.'}]}};
  const html=render();
  expect(html).toContain('No eligible assignment is currently available.');
  expect(html).toContain('Vehicle status is Under Maintenance.');
  expect(html).toContain('data-copilot-message="true"');
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
  expect(html).not.toContain('I found 2 options for this reservation.');
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
  expect(html).not.toContain('I found 2 options for this reservation.');
  expect(html).not.toContain('Choose Option 1');
});
