import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state=vi.hoisted(()=>({handlers:null}));
const accessState=vi.hoisted(()=>({canAccess:()=>true}));
vi.mock('@/hooks/use-role-access',()=>({useRoleAccess:()=>({canAccess:accessState.canAccess})}));
vi.mock('@tanstack/react-query',()=>({useMutation:options=>{state.handlers=options;return {isPending:false,mutate:vi.fn()};}}));
vi.mock('@/lib/api/client',()=>({apiFetch:vi.fn(async()=>({answer:'Checked'}))}));
import { apiFetch } from '@/lib/api/client';
import { CopilotConversation, clearAllReservationMessages, getReservationMessages, setReservationMessages, latestClearanceFor, latestComparisonFor, recoveryHref, getReservationSelection, setReservationSelection, clearReservationSelection, clearReservationMessages } from './copilot-conversation';
import { DispatchPlanPanel } from './dispatch-plan-panel';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { EvidenceDrawer } from './evidence-drawer';
import { readFileSync } from 'node:fs';

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
     useMemo:fn=>fn(),
     useCallback:fn=>fn,
  };
});

beforeEach(()=>{hookState.slots=[];hookState.cursor=0;vi.stubGlobal('React',React);vi.clearAllMocks();clearAllReservationMessages();accessState.canAccess=()=>true;});
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
const mobilePanelTree=props=>{hookState.slots=[];hookState.cursor=0;return DispatchPlanPanel(props);};
const queuePageSource=readFileSync(new URL('../../app/(dashboard)/reservations/queue/page.js',import.meta.url),'utf8');
const treeText=node=>{
  if(Array.isArray(node)) return node.map(treeText).join(' ');
  if(typeof node==='string'||typeof node==='number') return String(node);
  if(!React.isValidElement(node)) return '';
  return treeText(node.props?.children);
};

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
  // Status-only route: must not promise details/next-step answers it cannot give.
  expect(html).not.toContain('What details are recorded?');
  expect(html).not.toContain('What happens next?');
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
it('renders no composer markup for a completed (terminal) trip and renders it for an active one',()=>{
  const terminalHtml=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:16,completed:true,hasPair:false}));
  expect(terminalHtml).not.toContain('<form');
  expect(terminalHtml).not.toContain('copilot-question');
  expect(terminalHtml).not.toContain('Send message');
  const activeHtml=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:17,completed:false,hasPair:false}));
  expect(activeHtml).toContain('<form');
  expect(activeHtml).toContain('copilot-question');
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
    // The dock region itself is not a tab stop; its Confirm/Change controls are.
    expect(html).toContain('role="region" aria-label="Current dispatch decision"');
    expect(html).not.toContain('aria-label="Current dispatch decision" tabindex');
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
  expect(log.props.ref.current.scrollTop).toBe(900);
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
it('keeps the inspector dialog open beneath a nested proof and restores the exact Review row on Back',()=>{
  const requestId=47;
  const selectedPair={vehicleId:3,driverId:4};
  const withClearance={vehicleId:3,driverId:4,clearance:[{checkId:'capacity',label:'Seating capacity',status:'verified',proof:{type:'capacity',ref:'ev_c'}}],meta:{horizon:'SCHEDULED'}};
  setReservationMessages(requestId,[{role:'assistant',content:'Evidence is available.',pairRecovery:[withClearance],at:1}]);
  const props={requestId,selectedPair,hasPair:true};
  hookState.slots=[];
  hookState.cursor=0;
  const initial=CopilotConversation(props);
  const reviewTrigger={focus:vi.fn()};
  const openInspector=findNode(initial,node=>node.type==='button'&&node.props.children==='Review eligibility');

  expect(openInspector).not.toBeNull();
  openInspector.props.onClick({currentTarget:reviewTrigger});
  const inspectorView=conversationTree(props);
  const inspector=findNode(inspectorView,node=>node.type===EvidenceDrawer&&node.props.inspector);
  expect(inspector?.props.openerRef.current).toBe(reviewTrigger);

  const rowReviewTrigger={focus:vi.fn()};
  inspector.props.onReviewProof({type:'capacity',ref:'ev_c'},rowReviewTrigger);
  const nestedView=conversationTree(props);
  const openInspectorLayer=findNode(nestedView,node=>node.type===EvidenceDrawer&&node.props.inspector);
  const proofLayer=findNode(nestedView,node=>node.type===EvidenceDrawer&&node.props.nested);
  expect(openInspectorLayer).not.toBeNull();
  expect(proofLayer).not.toBeNull();
  expect(proofLayer.props.openerRef.current).toBe(rowReviewTrigger);
  expect(proofLayer.props.closeFocusRef.current).toBe(rowReviewTrigger);

  proofLayer.props.onBack();
  expect(proofLayer.props.closeFocusRef.current).toBe(rowReviewTrigger);
  const checklistView=conversationTree(props);
  expect(findNode(checklistView,node=>node.type===EvidenceDrawer&&node.props.inspector)).not.toBeNull();
  expect(findNode(checklistView,node=>node.type===EvidenceDrawer&&node.props.nested)).toBeNull();
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

it('marks repeated assistant transcript avatars as decorative',()=>{
  setReservationMessages(24,[{role:'assistant',content:'Recorded findings',at:Date.now()}]);
  const html=render(24);
  expect(html).not.toContain('copilot-avatar-blinking.gif');
  const avatars=[...html.matchAll(/<img\b[^>]*src="\/images\/copilot-avatar\.png"[^>]*>/g)].map(match=>match[0]);
  expect(avatars).toHaveLength(1);
  expect(avatars[0]).toMatch(/alt=""/);
});

it('uses a modal Radix dialog for mobile Copilot and restores the exact opener on dismiss',()=>{
  const opener={current:{focus:vi.fn()}};
  const onCloseMobileDrawer=vi.fn();
  const tree=mobilePanelTree({isDesktop:false,isMobileDrawerOpen:true,mobileOpenerRef:opener,onCloseMobileDrawer});
  const root=findNode(tree,node=>node.type===Dialog);
  const content=findNode(tree,node=>node.type===DialogContent);
  const close=findNode(tree,node=>node.type===Button&&treeText(node.props.children).includes('Close'));

  expect(root).not.toBeNull();
  expect(root.props.open).toBe(true);
  expect(root.props.modal).not.toBe(false);
  expect(content?.props.onOpenAutoFocus).toBeTypeOf('function');
  expect(content?.props.onCloseAutoFocus).toBeTypeOf('function');
  expect(close).not.toBeNull();
  const closeFocus=vi.fn();
  const closeRef=close.props.ref??close.ref;
  expect(closeRef).toBeDefined();
  closeRef.current={focus:closeFocus};
  const openEvent={preventDefault:vi.fn()};
  content.props.onOpenAutoFocus(openEvent);
  expect(openEvent.preventDefault).toHaveBeenCalledOnce();
  expect(closeFocus).toHaveBeenCalledOnce();
  const escapeEvent={preventDefault:vi.fn()};
  content.props.onEscapeKeyDown(escapeEvent);
  expect(escapeEvent.preventDefault).not.toHaveBeenCalled();

  root.props.onOpenChange(false);
  expect(onCloseMobileDrawer).toHaveBeenCalledOnce();
  const closeEvent={preventDefault:vi.fn()};
  content.props.onCloseAutoFocus(closeEvent);
  expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
  expect(opener.current.focus).toHaveBeenCalledOnce();
});

it('keeps busy mobile Close visibly disabled and explains why dismissal is unavailable',()=>{
  const onCloseMobileDrawer=vi.fn();
  const tree=mobilePanelTree({isDesktop:false,isMobileDrawerOpen:true,isBusy:true,onCloseMobileDrawer});
  const root=findNode(tree,node=>node.type===Dialog);
  const content=findNode(tree,node=>node.type===DialogContent);
  const close=findNode(tree,node=>node.type===Button&&treeText(node.props.children).includes('Close'));

  expect(close?.props.disabled).toBe(true);
  expect(treeText(tree)).toMatch(/in progress|must finish/i);
  const escapeEvent={preventDefault:vi.fn()};
  content?.props.onEscapeKeyDown?.(escapeEvent);
  expect(escapeEvent.preventDefault).toHaveBeenCalledOnce();
  root?.props.onOpenChange(false);
  expect(onCloseMobileDrawer).not.toHaveBeenCalled();
});

it('captures the queue row or Open Copilot control as the mobile dialog opener',()=>{
  expect(queuePageSource).toContain('mobileDrawerOpenerRef');
  expect(queuePageSource).toContain('document.activeElement');
  expect(queuePageSource).toContain('activeElement?.hasAttribute?.("aria-pressed")');
  expect(queuePageSource).toContain('event.currentTarget');
  expect(queuePageSource).toContain('mobileOpenTriggerRef.current');
  expect(queuePageSource).toContain('mobileOpenerRef={mobileDrawerOpenerRef}');
});

it('does not fetch evidence when the mobile Copilot or conversation merely mounts',()=>{
  apiFetch.mockClear();
  const mobileTree=mobilePanelTree({requestId:24,isDesktop:false,isMobileDrawerOpen:true,selectedRequest:{request_id:24}});
  hookState.slots=[];
  hookState.cursor=0;
  const conversation=CopilotConversation({requestId:24,hasPair:true});

  expect(findNode(mobileTree,node=>node.type===Dialog)?.props.open).toBe(true);
  expect(findNode(mobileTree,node=>node.type===EvidenceDrawer)).toBeNull();
  expect(findNode(conversation,node=>node.type===EvidenceDrawer)).toBeNull();
  expect(apiFetch).not.toHaveBeenCalled();
});

// Task 7 (P1-08): recovery links must target routes that exist.
it('maps recovery records to real in-app routes only',()=>{
  expect(recoveryHref({record:'vehicle',id:17})).toBe('/fleet/vehicles/17');
  expect(recoveryHref({record:'driver',id:4})).toBe('/drivers/4');
  expect(recoveryHref({record:'maintenance',id:21})).toBe('/maintenance');
  expect(recoveryHref({record:'schedule',id:null})).toBeNull();
  expect(recoveryHref({record:'schedule',code:'DRIVER_UNAVAILABLE',id:4})).toBe('/drivers/4');
  expect(recoveryHref({record:'schedule',code:'PAIRING',id:9})).toBeNull();
  expect(recoveryHref({record:'request',id:502})).toBe('/reservations/502');
  expect(recoveryHref({record:'request',id:null})).toBeNull();
  expect(recoveryHref({record:'unknown',id:1})).toBeNull();
  expect(recoveryHref(null)).toBeNull();
});

it('never points recovery at removed dashboard routes',()=>{
  const hrefs=[
    recoveryHref({record:'vehicle',id:17}),
    recoveryHref({record:'driver',id:4}),
    recoveryHref({record:'maintenance',id:21}),
    recoveryHref({record:'schedule',code:'DRIVER_UNAVAILABLE',id:4}),
    recoveryHref({record:'request',id:502}),
    recoveryHref({record:'vehicle',id:null}),
    recoveryHref({record:'driver',id:null}),
  ].filter(Boolean);
  expect(hrefs.length).toBeGreaterThan(0);
  for(const href of hrefs){
    expect(href).not.toMatch(/^\/vehicles(\/|$)/);
    expect(href).not.toMatch(/^\/schedules(\/|$)/);
    expect(href).not.toContain('?vehicleId=');
  }
});

it('never interpolates unsafe ids into recovery routes',()=>{
  expect(recoveryHref({record:'vehicle',id:'17;DROP'})).toBe('/fleet/vehicles');
  expect(recoveryHref({record:'vehicle',id:-3})).toBe('/fleet/vehicles');
  expect(recoveryHref({record:'vehicle',id:0})).toBe('/fleet/vehicles');
  expect(recoveryHref({record:'vehicle',id:1.5})).toBe('/fleet/vehicles');
  expect(recoveryHref({record:'driver',id:'abc'})).toBe('/drivers');
  expect(recoveryHref({record:'driver',id:{}})).toBe('/drivers');
  expect(recoveryHref({record:'schedule',code:'DRIVER_UNAVAILABLE',id:'4;DROP'})).toBe('/drivers');
  expect(recoveryHref({record:'request',id:'502;DROP'})).toBeNull();
  expect(recoveryHref({record:'request',id:NaN})).toBeNull();
});
it('falls back to the drivers directory for a DRIVER_UNAVAILABLE block with no driver id',()=>{
  expect(recoveryHref({record:'schedule',code:'DRIVER_UNAVAILABLE',id:null})).toBe('/drivers');
});

it('renders recovery links only for routes the role may access',()=>{
  const actions=[
    {code:'MAINTENANCE_CONFLICT',label:'Check maintenance record',record:'maintenance',id:21},
    {code:'LICENSE_EXPIRED',label:'Renew driver license',record:'driver',id:4},
  ];
  setReservationMessages(61,[{role:'assistant',content:'Blocked.',at:1,recoveryActions:actions}]);
  accessState.canAccess=()=>true;
  hookState.slots=[];hookState.cursor=0;
  const allowedHtml=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:61,hasPair:true}));
  expect(allowedHtml).toContain('href="/maintenance"');
  expect(allowedHtml).toContain('href="/drivers/4"');

  accessState.canAccess=()=>false;
  hookState.slots=[];hookState.cursor=0;
  const deniedHtml=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:61,hasPair:true}));
  expect(deniedHtml).not.toContain('href="/maintenance"');
  expect(deniedHtml).not.toContain('href="/drivers/4"');
  expect(deniedHtml).not.toContain('<a ');
  expect(deniedHtml).toContain('Check maintenance record');
  expect(deniedHtml).toContain('Renew driver license');
});
it('gives an allowed recovery anchor a 44px target',()=>{
  setReservationMessages(63,[{role:'assistant',content:'Blocked.',at:1,recoveryActions:[
    {code:'MAINTENANCE_CONFLICT',label:'Check maintenance record',record:'maintenance',id:21},
  ]}]);
  accessState.canAccess=()=>true;
  hookState.slots=[];hookState.cursor=0;
  const html=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:63,hasPair:true}));
  const anchor=html.match(/<a\b[^>]*href="\/maintenance"[^>]*>/)?.[0] ?? '';
  expect(anchor).toContain('min-h-[44px]');
});
it('fails closed when the role checker itself is unavailable',()=>{
  const actions=[
    {code:'LICENSE_EXPIRED',label:'Renew driver license',record:'driver',id:4},
  ];
  setReservationMessages(62,[{role:'assistant',content:'Blocked.',at:1,recoveryActions:actions}]);
  accessState.canAccess=undefined;
  hookState.slots=[];hookState.cursor=0;
  const html=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:62,hasPair:true}));
  expect(html).not.toContain('href="/drivers/4"');
  expect(html).not.toContain('<a ');
  expect(html).toContain('Renew driver license');
});

it('never links a pairing schedule block to a driver record',()=>{
  // PAIRING carries the vehicle id, so interpolating it into /drivers/:id
  // would open the wrong record. It stays guidance text even when allowed.
  setReservationMessages(62,[{role:'assistant',content:'Blocked.',at:1,
    recoveryActions:[{code:'PAIRING',label:'Check substitute schedule',record:'schedule',id:9}]}]);
  accessState.canAccess=()=>true;
  const html=renderToStaticMarkup(React.createElement(CopilotConversation,{requestId:62,hasPair:true}));
  expect(html).not.toContain('<a ');
  expect(html).toContain('Check substitute schedule');
});
