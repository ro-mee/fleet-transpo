import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state=vi.hoisted(()=>({handlers:null}));
vi.mock('@tanstack/react-query',()=>({useMutation:options=>{state.handlers=options;return {isPending:false,mutate:vi.fn()};}}));
vi.mock('@/lib/api/client',()=>({apiFetch:vi.fn(async()=>({answer:'Checked'}))}));
import { apiFetch } from '@/lib/api/client';
import { CopilotConversation, clearAllReservationMessages, getReservationMessages, setReservationMessages, latestClearanceFor, latestComparisonFor, getReservationSelection, setReservationSelection, clearReservationSelection, clearReservationMessages } from './copilot-conversation';

const hookState=vi.hoisted(()=>({slots:[],cursor:0}));
vi.mock('react',async importOriginal=>{
  const actual=await importOriginal();
  return {
    ...actual,
    useState:initial=>{
      const index=hookState.cursor++;
      if(!(index in hookState.slots)) hookState.slots[index]={value:typeof initial==='function'?initial():initial};
      const slot=hookState.slots[index];
      return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];
    },
    useRef:initial=>{
      const index=hookState.cursor++;
      if(!(index in hookState.slots)) hookState.slots[index]={value:{current:initial}};
      return hookState.slots[index].value;
    },
    useEffect:()=>{},
  };
});

beforeEach(()=>{hookState.slots=[];hookState.cursor=0;vi.stubGlobal('React',React);vi.clearAllMocks();clearAllReservationMessages();});
afterEach(()=>vi.unstubAllGlobals());
const sent={requestId:1,message:'Why this pair?',history:[],planToken:'old-plan',selectedPair:{vehicleId:3,driverId:4},selectedPairLabel:'PAIR-B + Driver B',displayedEvaluatedAt:'2026-09-15T00:00:00Z'};
const render=requestId=>{hookState.slots=[];hookState.cursor=0;return renderToStaticMarkup(React.createElement(CopilotConversation,{requestId,selectedPair:{vehicleId:8,driverId:9},planToken:'new-plan',hasPair:true}));};
const findNode=(node,predicate)=>{
  if(Array.isArray(node)) return node.map(child=>findNode(child,predicate)).find(Boolean)??null;
  if(!React.isValidElement(node)) return null;
  if(predicate(node)) return node;
  return findNode(node.props?.children,predicate);
};
const conversationTree=props=>{hookState.cursor=0;return CopilotConversation(props);};

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
it('keeps scope-only replies conversational without replacing options or the current decision dock',()=>{
  const options=[{vehicleId:1,driverId:2},{vehicleId:3,driverId:4}];
  const scopeOnly={answer:'Hi. How can I help with this reservation or fleet operation?',mode:'scope-only',choiceOptions:[],snapshot:null,selection:null,coverage:null};
  const selected={vehicleId:3,driverId:4};
  const decisionDock=React.createElement('p',null,'Selected review');
  const selectedView=()=>{hookState.slots=[];hookState.cursor=0;return renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:1,selectedPair:selected,decisionDock,displayedOptions:options,planToken:'plan',planStatus:{isInvalid:false},hasPair:true}));};
  selectedView();
  state.handlers.onSuccess(scopeOnly,{requestId:1,selectedPair:selected,selectedPairLabel:'Option 2',displayedOptions:options,planToken:'plan'});
  expect(selectedView()).toContain('Selected review');
  expect(getReservationMessages(1)[0]).toMatchObject({mode:'scope-only',selectedPair:selected});

  const optionsView=()=>{hookState.slots=[];hookState.cursor=0;return renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:2,selectedPair:null,displayedOptions:options,hasPair:true}));};
  optionsView();
  state.handlers.onSuccess(scopeOnly,{requestId:2,selectedPair:null,displayedOptions:options});
  const html=optionsView();
  expect(html).toContain('Choose Option 1');
  expect(html).toContain('Choose Option 2');
});

it('keeps committed-trip chat read-only and sends no client assignment evidence',async()=>{
  const pair={vehicleId:900,driverId:901};
  setReservationMessages(15,[{
    role:'assistant',content:'Historic option recommendation',at:1,evaluatedAt:'2026-09-15T00:00:00Z',
    recoveryActions:[{code:'OLD',label:'Review Evidence',proof:{type:'capacity',ref:'proof-old'}}],
    pairRecovery:[{vehicleId:900,driverId:901,clearance:[{checkId:'capacity',label:'Capacity',status:'verified'}],meta:{horizon:'SCHEDULED'}}],
    comparisonProof:{type:'comparison',ref:'comparison-old'},
  }]);
  const props={requestId:15,readOnlyCommitted:true,disabled:false,hasPair:true,
    selectedPair:pair,selectedPairLabel:'Forged pair',displayedOptions:[pair],
    displayedEvaluatedAt:'2026-09-15T00:00:00Z',planToken:'forged-plan'};
  const html=renderToStaticMarkup(React.createElement(CopilotConversation,props));
  expect(html).toContain('Historic option recommendation');
  expect(html).toContain('Earlier conversation is history');
  expect(html).not.toContain('Choose Option 1');
  expect(html).not.toContain('Which would you like to choose');
  expect(html).not.toContain('Review eligibility');
  expect(html).not.toContain('Compare options');
  expect(html).not.toContain('Review Evidence');
  expect(html).toContain('What is the current trip status?');
  expect(html).not.toContain('Why this option?');
  expect(html).not.toContain('Any conflicts?');
  expect(html).not.toContain('Other options?');
  expect(html).toContain('Message Copilot');
  expect(html.match(/<textarea[^>]*id="copilot-question"[^>]*>/)?.[0]).not.toMatch(/\sdisabled(?:\s|=|>)/);

  await state.handlers.mutationFn({requestId:15,message:'Where is the current trip?',history:[],
    planToken:'forged-plan',selectedPair:pair,displayedEvaluatedAt:props.displayedEvaluatedAt,displayedOptions:[pair]});
  const body=apiFetch.mock.calls.at(-1)[1].body;
  expect(body).not.toHaveProperty('planToken');
  expect(body).not.toHaveProperty('selectedPair');
  expect(body).not.toHaveProperty('displayedEvaluatedAt');
  expect(body).not.toHaveProperty('displayedOptions');
  expect(body).not.toHaveProperty('baseline');
});
it('mounts the current decision once after the log and before the composer through long Q&A and pruning',()=>{
 const selectedPair={vehicleId:3,driverId:4};
 const messages=[
   {role:'user',content:'Choose option two',action:'select-pair',selectedPair,at:1},
   ...Array.from({length:40},(_,index)=>({role:index%2?'assistant':'user',content:`Conversation message ${index+1}`,at:index+2})),
 ];
 const decisionDock=React.createElement('section',{'data-current-decision':'true'},'Selected review');
 const view=()=>{hookState.slots=[];hookState.cursor=0;return renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:1,selectedPair,decisionDock}));};
 const assertDockOutsideLog=html=>{
   const logStart=html.indexOf('<div role="log"');
   const tags=/<\/?div\b[^>]*>/g;
   tags.lastIndex=logStart;
   let depth=0;
   let logEnd=-1;
   for(let match=tags.exec(html);match;match=tags.exec(html)){
     depth+=match[0].startsWith('</')?-1:1;
     if(depth===0){logEnd=tags.lastIndex;break;}
   }
   const dockStart=html.indexOf('data-current-decision');
   const composerStart=html.indexOf('<form');
   expect(html.match(/data-current-decision/g)).toHaveLength(1);
   expect(html).toContain('role="region" aria-label="Current dispatch decision" tabindex="0"');
   expect(dockStart).toBeGreaterThan(logEnd);
   expect(dockStart).toBeLessThan(composerStart);
 };
 setReservationMessages(1,messages);
 let html=view();
 assertDockOutsideLog(html);
 expect(html.indexOf('Selected review')).toBeGreaterThan(html.indexOf('Conversation message 40'));
 setReservationMessages(1,messages.slice(-8));
 html=view();
 assertDockOutsideLog(html);
 expect(html.match(/Selected review/g)).toHaveLength(1);
});

it('resets the current Copilot memory through the explicit reset control',()=>{
 const requestId=31;
 const onResetDecision=vi.fn(()=>clearReservationSelection(requestId));
 setReservationMessages(requestId,[{role:'assistant',content:'Older answer',at:1}]);
 setReservationSelection(requestId,{key:'3:4',pinnedKeys:['3:4']});
 const props={requestId,selectedPair:{vehicleId:3,driverId:4},decisionDock:React.createElement('p',null,'Selected review'),onResetDecision};
 const tree=conversationTree(props);
 const reset=findNode(tree,node=>node.type==='button'&&React.Children.toArray(node.props.children).includes('Reset Copilot'));
 expect(reset).not.toBeNull();
 reset.props.onClick();
 expect(onResetDecision).toHaveBeenCalledTimes(1);
 expect(getReservationMessages(requestId)).toEqual([]);
 expect(getReservationSelection(requestId)).toBeNull();
 expect(renderToStaticMarkup(conversationTree(props))).not.toContain('Older answer');
  const disabledTree=conversationTree({...props,resetDisabled:true});
  const disabledReset=findNode(disabledTree,node=>node.type==='button'&&React.Children.toArray(node.props.children).includes('Reset Copilot'));
  expect(disabledReset.props.disabled).toBe(true);
});

it('offers a keyboard-operable jump to latest when a reply arrives during paused follow-scroll',()=>{
 hookState.slots=[];hookState.cursor=0;
 const props={requestId:21,hasPair:true};
 const firstTree=conversationTree(props);
 const log=findNode(firstTree,node=>node.props?.role==='log');
 expect(log).not.toBeNull();
 log.props.ref.current={scrollHeight:900,scrollTop:0,clientHeight:200};
 log.props.onScroll();
 state.handlers.onSuccess({answer:'A new answer arrived.'},{requestId:21,message:'Why?',selectedPair:null,displayedOptions:[]});

 const nextTree=conversationTree(props);
 const jump=findNode(nextTree,node=>node.type==='button'&&node.props.children==='New reply — jump to latest');
 expect(jump).not.toBeNull();
 expect(jump.props.type).toBe('button');
 expect(renderToStaticMarkup(nextTree)).toContain('New reply — jump to latest');
 jump.props.onClick();
 expect(renderToStaticMarkup(conversationTree(props))).not.toContain('New reply — jump to latest');
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
// The chosen pair is component state inside the panel, and the panel is remounted
// per request (`key={selectedRequest?.request_id}`), so the choice has to live
// outside React to survive a move to another section and back. It lives here,
// beside the transcript, and shares its lifetime.
it('remembers a chosen pair per reservation and forgets it only for that reservation',()=>{
  expect(getReservationSelection(1)).toBeNull();
  expect(setReservationSelection(1,{key:'3:4',pinnedKeys:['1:2','3:4']})).toEqual({key:'3:4',pinnedKeys:['1:2','3:4']});
  setReservationSelection(2,{key:'5:6',pinnedKeys:['5:6']});
  expect(getReservationSelection(2)).toEqual({key:'5:6',pinnedKeys:['5:6']});
  // "Change selection" must forget, not merely hide: the panel is remounted on
  // every return, so a surviving record would resurrect an abandoned choice.
  expect(clearReservationSelection(1)).toBeNull();
  expect(getReservationSelection(1)).toBeNull();
  expect(getReservationSelection(2)).toEqual({key:'5:6',pinnedKeys:['5:6']});
  expect(getReservationSelection(null)).toBeNull();
});
it('refuses to remember a record it could not restore',()=>{
  // A remembered selection is read back as {key, pinnedKeys}; anything else would
  // resolve to nothing on return and is not worth storing.
  expect(setReservationSelection(3,{key:42})).toBeNull();
  expect(setReservationSelection(3,null)).toBeNull();
  expect(getReservationSelection(3)).toBeNull();
  expect(setReservationSelection(4,{key:'7:8'})).toEqual({key:'7:8',pinnedKeys:[]});
  expect(getReservationSelection(4)).toEqual({key:'7:8',pinnedKeys:[]});
});
it('clears the remembered pair with the conversation it belongs to',()=>{
  setReservationMessages(1,[{role:'user',content:'Option 1'}]);
  setReservationSelection(1,{key:'1:2',pinnedKeys:['1:2']});
  setReservationSelection(2,{key:'3:4',pinnedKeys:['3:4']});
  clearReservationMessages(1);
  expect(getReservationMessages(1)).toEqual([]);
  expect(getReservationSelection(1)).toBeNull();
  expect(getReservationSelection(2)).toEqual({key:'3:4',pinnedKeys:['3:4']});
  clearAllReservationMessages();
  expect(getReservationSelection(2)).toBeNull();
});
it('clears Copilot baseline snapshots together with conversation state',()=>{
  const stored = new Map([
    ['fleetops_dispatch_baseline_1', 'private snapshot'],
    ['unrelated_app_state', 'keep'],
  ]);
  const sessionStorage = {
    get length() { return stored.size; },
    key: index => [...stored.keys()][index] ?? null,
    getItem: key => stored.has(key) ? stored.get(key) : null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: key => stored.delete(key),
  };
  vi.stubGlobal('window', { sessionStorage });
  clearAllReservationMessages();
  expect(sessionStorage.getItem('fleetops_dispatch_baseline_1')).toBeNull();
  expect(sessionStorage.getItem('unrelated_app_state')).toBe('keep');
});
it('reads the remembered pair back out of the session, not out of module memory',async()=>{
  // The in-memory cache above cannot be what survives a navigation — sessionStorage
  // is. A fresh module instance is what a remount after leaving the route looks
  // like: empty cache, value has to come back out of storage.
  const stored=new Map();
  vi.stubGlobal('window',{sessionStorage:{getItem:k=>stored.has(k)?stored.get(k):null,setItem:(k,v)=>stored.set(k,String(v))}});
  vi.resetModules();
  const first=await import('./copilot-conversation');
  first.setReservationSelection(11,{key:'3:4',pinnedKeys:['1:2','3:4']});
  vi.resetModules();
  const remounted=await import('./copilot-conversation');
  expect(remounted.getReservationSelection(11)).toEqual({key:'3:4',pinnedKeys:['1:2','3:4']});
  expect(stored.size).toBe(1);
  // Unusable content in the key is ignored rather than thrown: a stale or
  // hand-edited entry must not break the dispatch screen.
  stored.set('fleetops_dispatch_copilot_selection_map','{"12":42}');
  vi.resetModules();
  const corrupted=await import('./copilot-conversation');
  expect(corrupted.getReservationSelection(12)).toBeNull();
  stored.set('fleetops_dispatch_copilot_selection_map','not json');
  vi.resetModules();
  const unparseable=await import('./copilot-conversation');
  expect(unparseable.getReservationSelection(11)).toBeNull();
});
