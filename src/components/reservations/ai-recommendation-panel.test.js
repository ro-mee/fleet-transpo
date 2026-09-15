import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ query: {}, mutation: {}, chat: null, keys: [] }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({queryKey}) => { state.keys.push(queryKey); return state.query; },
  useMutation: () => state.mutation,
  useQueryClient: () => ({setQueryData:vi.fn(),invalidateQueries:vi.fn()}),
}));
vi.mock('@/hooks/use-role-access', () => ({useRoleAccess:()=>({can:()=>true})}));
vi.mock('@/components/reservations/trip-summary', () => ({useNow:()=>Date.parse('2026-09-15T00:00:00Z')}));
vi.mock('./copilot-conversation', () => ({setReservationMessages:vi.fn(),CopilotConversation:({children,reply,...props})=>{state.chat=props;return React.createElement(React.Fragment,null,children,reply);}}));
import { AiRecommendationPanel } from './ai-recommendation-panel';

const a={vehicle_id:1,driver_id:2,vehicle:{plate_number:'PAIR-A'},driver:{driver_name:'Driver A'},score:87,
  checks:[{id:'capacity',label:'Capacity',status:'verified'}],readiness:'VERIFIED',feasibility:{verdict:'SAFE'},reasons:[]};
const b={...a,vehicle_id:3,driver_id:4,vehicle:{plate_number:'PAIR-B'},driver:{driver_name:'Driver B'}};
beforeEach(()=>{
  // This repo's Vitest JSX transform uses the classic React runtime.
  vi.stubGlobal('React',React);
  state.keys=[];
  state.query={data:{evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:a,candidates:[a,b]}},refetch:vi.fn()};
  state.mutation={isPending:false,mutate:vi.fn()};
});
afterEach(()=>vi.unstubAllGlobals());
const render=props=>renderToStaticMarkup(React.createElement(AiRecommendationPanel,{requestId:1,canAssign:true,...props}));

it('speaks gating statuses in the thread and surfaces blocked evidence on the card',()=>{
  state.query.isFetching=true;
  let html=render();
  expect(html).toContain('id="dispatch-confirmation-status"');
  expect(html).toContain('Checking current availability');
  expect(render({canAssign:false})).toContain('You do not have permission to assign resources.');
  // Blocked evidence is presented on the option card, not as a footer status.
  state.query.isFetching=false;
  state.query.data={pair:{recommended:{...a,hardConflicts:[{message:'Vehicle overlap'}]}}};
  html=render();
  expect(html).toContain('Blocked');
  expect(html).toContain('Vehicle overlap');
});
it('shows the option flow inside the conversation thread by default',()=>{
  const html=render();
  expect(html).toContain('I found 2 options for this reservation.');
  expect(html).toContain('Option 1 — Recommended');
  expect(html).toContain('Option 2 — Alternative');
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
