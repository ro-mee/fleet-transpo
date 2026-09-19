import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state=vi.hoisted(()=>({handlers:null}));
vi.mock('@tanstack/react-query',()=>({useMutation:options=>{state.handlers=options;return {isPending:false,mutate:vi.fn()};}}));
vi.mock('@/lib/api/client',()=>({apiFetch:vi.fn(async()=>({answer:'Checked'}))}));
import { apiFetch } from '@/lib/api/client';
import { CopilotConversation, clearAllReservationMessages, getReservationMessages, setReservationMessages, latestClearanceFor, latestComparisonFor } from './copilot-conversation';

beforeEach(()=>{vi.stubGlobal('React',React);vi.clearAllMocks();clearAllReservationMessages();});
afterEach(()=>vi.unstubAllGlobals());
const sent={requestId:1,message:'Why this pair?',history:[],planToken:'old-plan',selectedPair:{vehicleId:3,driverId:4},selectedPairLabel:'PAIR-B + Driver B',displayedEvaluatedAt:'2026-09-15T00:00:00Z'};
const render=requestId=>renderToStaticMarkup(React.createElement(CopilotConversation,{requestId,selectedPair:{vehicleId:8,driverId:9},planToken:'new-plan',hasPair:true}));

it('sends captured request/pair/token context even if the component now has another selection',async()=>{
 render(2);
 await state.handlers.mutationFn(sent);
 expect(apiFetch).toHaveBeenCalledWith('/api/integration/transport-requests/1/conversation',{
   method:'POST',body:{message:sent.message,history:[],planToken:'old-plan',selectedPair:{vehicleId:3,driverId:4},displayedEvaluatedAt:sent.displayedEvaluatedAt},
 });
});
it('stores a delayed answer under the originating reservation and retains its asked-about pair',()=>{
 render(2);
 state.handlers.onSuccess({answer:'Pair B needs verification.',evaluatedAt:'2026-09-15T00:00:10Z'},sent);
 expect(getReservationMessages(2)).toEqual([]);
 expect(getReservationMessages(1)[0]).toMatchObject({requestId:1,selectedPair:sent.selectedPair,selectedPairLabel:sent.selectedPairLabel});
 const html=render(1);
 expect(html).toContain('Asked about PAIR-B + Driver B');
 expect(html).toContain('Pair B needs verification.');
});
it('keeps option replies, answers and confirmation inside one log before the composer',()=>{
  const html=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:1,hasPair:true,
    reply:React.createElement('p',null,'Checked pairing reply')},React.createElement('p',null,'Option messages')));
 const start=html.indexOf('role="log"'),composer=html.indexOf('<form');
 expect(html.indexOf('Option messages')).toBeGreaterThan(start);
 expect(html.indexOf('Checked pairing reply')).toBeGreaterThan(html.indexOf('Option messages'));
 expect(html.indexOf('Checked pairing reply')).toBeLessThan(composer);
 expect(html).not.toContain('max-h-96');
});
it('answers without a selection and ends with the current option choice prompt',()=>{
 renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:1,hasPair:true,selectedPair:null}));
 state.handlers.onSuccess({answer:'Option 1 has more preparation time.',choiceOptions:[1,2]},{requestId:1,selectedPair:null,displayedOptions:[{vehicleId:1,driverId:2},{vehicleId:3,driverId:4}]});
 expect(getReservationMessages(1)[0].content).toContain('Which would you like to choose: Option 1 or Option 2?');
});
it('does not invite selection when fresh evidence contains no selectable option',()=>{
  renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:1,hasPair:true,selectedPair:null}));
  state.handlers.onSuccess({answer:'The vehicle is under maintenance.',choiceOptions:[]},{requestId:1,selectedPair:null,displayedOptions:[{vehicleId:1,driverId:2}]});
  expect(getReservationMessages(1)[0].content).toBe('The vehicle is under maintenance.');
});
it('keeps scope-only replies conversational without replacing options or selected review',()=>{
  const options=[{vehicleId:1,driverId:2},{vehicleId:3,driverId:4}];
  const scopeOnly={answer:'Hi. How can I help with this reservation or fleet operation?',mode:'scope-only',choiceOptions:[],snapshot:null,selection:null,coverage:null};
  const selected={vehicleId:3,driverId:4};
  const selectedView=()=>renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:1,selectedPair:selected,selectedReply:React.createElement('p',null,'Selected review'),displayedOptions:options,planToken:'plan',planStatus:{isInvalid:false},hasPair:true}));
  selectedView();
  state.handlers.onSuccess(scopeOnly,{requestId:1,selectedPair:selected,selectedPairLabel:'Option 2',displayedOptions:options,planToken:'plan'});
  expect(selectedView()).toContain('Selected review');
  expect(getReservationMessages(1)[0]).toMatchObject({mode:'scope-only',selectedPair:selected});

  const optionsView=()=>renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:2,selectedPair:null,displayedOptions:options,hasPair:true}));
  optionsView();
  state.handlers.onSuccess(scopeOnly,{requestId:2,selectedPair:null,displayedOptions:options});
  const html=optionsView();
  expect(html).toContain('Choose Option 1');
  expect(html).toContain('Choose Option 2');
});

it('keeps the selected review before later questions and answers, including after memory pruning',()=>{
 const selectedPair={vehicleId:3,driverId:4};
 const messages=[
   {role:'user',content:'Choose option two',action:'select-pair',selectedPair,at:1},
   {role:'user',content:'My latest question',at:2},
   {role:'assistant',content:'The latest answer',at:3},
 ];
 const view=()=>renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:1,selectedPair,selectedReply:React.createElement('p',null,'Selected review')}));
 setReservationMessages(1,messages);
 let html=view();
 expect(html.indexOf('Selected review')).toBeGreaterThan(html.indexOf('Choose option two'));
 expect(html.indexOf('Selected review')).toBeLessThan(html.indexOf('My latest question'));
 expect(html.indexOf('The latest answer')).toBeGreaterThan(html.indexOf('My latest question'));
  setReservationMessages(1,messages.slice(1));
  html=view();
  expect(html.indexOf('Selected review')).toBeLessThan(html.indexOf('My latest question'));
  expect(html.match(/Selected review/g)).toHaveLength(1);
});
it('resolves clearance for the selected pair and offers eligibility review',()=>{
  const selectedPair={vehicleId:3,driverId:4};
  const other={vehicleId:9,driverId:9,pairRecovery:[]};
  const withClearance={vehicleId:3,driverId:4,clearance:[{checkId:'capacity',label:'Seating capacity',status:'verified',proof:{type:'capacity',ref:'ev_c'}}],meta:{horizon:'SCHEDULED'}};
  const messages=[
    {role:'assistant',content:'Old answer',pairRecovery:[withClearance],at:1},
    {role:'assistant',content:'New answer',pairRecovery:[other,withClearance],at:2},
  ];
  const found=latestClearanceFor(messages,selectedPair);
  expect(found.pair).toEqual(selectedPair);
  expect(found.clearance).toHaveLength(1);
  expect(latestClearanceFor(messages,{vehicleId:1,driverId:1}).pair).toEqual({vehicleId:3,driverId:4});
  expect(latestClearanceFor([{role:'assistant',content:'No evidence'}],selectedPair)).toBeNull();
  setReservationMessages(7,messages);
  const html=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:7,selectedPair,hasPair:true}));
  expect(html).toContain('Review eligibility');
});
it('offers option comparison only when a comparison proof exists',()=>{
  expect(latestComparisonFor([{role:'assistant',content:'Hi'}])).toBeNull();
  const comparison={type:'comparison',ref:'ev_cmp'};
  expect(latestComparisonFor([{role:'assistant',content:'Hi',comparisonProof:comparison}])).toEqual(comparison);
  setReservationMessages(8,[{role:'assistant',content:'Two options',comparisonProof:comparison,at:1}]);
  const html=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:8,hasPair:true}));
  expect(html).toContain('Compare options');
});
