import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state=vi.hoisted(()=>({handlers:null}));
vi.mock('@tanstack/react-query',()=>({useMutation:options=>{state.handlers=options;return {isPending:false,mutate:vi.fn()};}}));
vi.mock('@/lib/api/client',()=>({apiFetch:vi.fn(async()=>({answer:'Checked'}))}));
import { apiFetch } from '@/lib/api/client';
import { CopilotConversation, clearAllReservationMessages, getReservationMessages, setReservationMessages } from './copilot-conversation';

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
