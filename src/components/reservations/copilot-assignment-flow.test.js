import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({cells:[],cursor:0,query:null,mutation:null,handlers:null,chat:null,persisted:vi.fn(),cleared:vi.fn()}));
// Exercise the panel's event handlers and subsequent renders without a DOM dependency.
vi.mock('react',async original=>({...await original(),
  useState:initial=>{const i=state.cursor++;if(!(i in state.cells))state.cells[i]=typeof initial==='function'?initial():initial;return [state.cells[i],value=>{state.cells[i]=typeof value==='function'?value(state.cells[i]):value;}];},
  useRef:initial=>{const i=state.cursor++;return state.cells[i]??(state.cells[i]={current:initial});},useEffect:()=>{},
}));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>state.query,useMutation:handlers=>{state.handlers=handlers;return state.mutation;},useQueryClient:()=>({setQueryData:vi.fn(),invalidateQueries:vi.fn()})}));
vi.mock('@/hooks/use-role-access',()=>({useRoleAccess:()=>({can:()=>true})}));
vi.mock('@/components/reservations/trip-summary',()=>({useNow:()=>Date.parse('2026-09-15T00:00:00Z')}));
vi.mock('@/services/transport.service',async importOriginal=>({...await importOriginal(),getTransportRequest:vi.fn(async()=>{throw new Error('Could not verify request');})}));
vi.mock('./copilot-conversation',()=>({CopilotConversation:props=>{state.chat=props;return React.createElement(React.Fragment,null,props.children,props.decisionDock,props.reply);},setReservationMessages:vi.fn(),getReservationSelection:()=>null,setReservationSelection:(...args)=>state.persisted(...args),clearReservationSelection:(...args)=>state.cleared(...args)}));
import {AiRecommendationPanel} from './ai-recommendation-panel';
import {CopilotConversation} from './copilot-conversation';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getTransportRequest } from '@/services/transport.service';
const find=(node,type)=>node?.type===type?node:React.Children.toArray(node?.props?.children).map(child=>find(child,type)).find(Boolean);
const renderConversationElement=(props={})=>{state.cursor=0;return find(AiRecommendationPanel({requestId:1,canAssign:true,...props}),CopilotConversation);};
const render=(props={})=>renderConversationElement(props).props;
const renderHtml=(props={})=>{state.cursor=0;return renderToStaticMarkup(AiRecommendationPanel({requestId:1,canAssign:true,...props}));};
beforeEach(()=>{
  vi.stubGlobal('React',React);state.cells=[];state.cursor=0;
  state.persisted.mockClear();state.cleared.mockClear();
  const pair=id=>({vehicle_id:id,driver_id:id,vehicle:{plate_number:'PAIR-'+id},driver:{driver_name:'Driver '+id},checks:[{id:'capacity',status:'verified'}],readiness:'VERIFIED',feasibility:{verdict:'SAFE'}});
  const candidates=[pair(1),pair(2)];
  state.query={data:{evaluatedAt:'2026-09-15T00:00:00Z',pair:{recommended:candidates[0],candidates}},refetch:vi.fn(async()=>({isError:false}))};
  state.mutation={isPending:false,mutate:vi.fn()};
});
it('selects a typed option, waits for its recheck, then assigns on the first explicit confirmation',async()=>{
  let resolve;
  state.query.refetch=vi.fn(()=>new Promise(r=>{resolve=r;}));
  expect(render().onCommand('Assign it')).toContain('Choose an option first');
  expect(render().onCommand('Option 2')).toEqual({handled:true});
  expect(render().selectedPair).toEqual({vehicleId:2,driverId:2});
  expect(render().onCommand('Assign it')).toContain('Rechecking current assignment evidence');
  expect(state.mutation.mutate).not.toHaveBeenCalled();
  resolve({isError:false});await Promise.resolve();await Promise.resolve();
  const reviewed=render();
  expect(reviewed.decisionDock).not.toBeNull();
  const dockHtml=renderToStaticMarkup(reviewed.decisionDock);
  expect(dockHtml).toContain('Confirm assignment — PAIR-2 + Driver 2');
  expect(dockHtml).toContain('This option passed a fresh check');
  expect(dockHtml).toContain('Change selection');
  expect(dockHtml.match(/Confirm assignment —/g)).toHaveLength(1);
  expect(render().onCommand('Assign it')).toEqual({handled:true});
  expect(state.mutation.mutate).toHaveBeenCalledWith(expect.objectContaining({vehicle_id:2,driver_id:2,force:false}));
  render().onCommand('Assign it');expect(state.mutation.mutate).toHaveBeenCalledTimes(1);
});
it('remounts a single current decision dock when the selected reservation changes',async()=>{
  renderConversationElement().props.onCommand('Option 1');await Promise.resolve();await Promise.resolve();
  const requestOne=renderConversationElement();
  expect(requestOne.props.decisionDock).not.toBeNull();
  const switched=renderConversationElement({requestId:2});
  expect(switched.key).not.toBe(requestOne.key);
  expect(renderConversationElement({requestId:2}).props.selectedPair).toBeNull();
  renderConversationElement({requestId:2}).props.onCommand('Option 2');await Promise.resolve();await Promise.resolve();
  const current=renderConversationElement({requestId:2});
  expect(current.key).toBe(switched.key);
  expect(current.props.decisionDock).not.toBeNull();
  expect(renderToStaticMarkup(current).match(/Confirm assignment —/g)).toHaveLength(1);
});
it('keeps review reason and manual override reason in the current decision dock',async()=>{
  const reviewable={...state.query.data.pair.recommended,readiness:'REVIEWABLE',reviewable:true,feasibility:{verdict:'TIGHT',reasons:['Tight pickup buffer']},reasons:['Tight pickup buffer']};
  state.query.data={...state.query.data,pair:{recommended:reviewable,candidates:[reviewable]}};
  state.query.refetch=vi.fn(async()=>({isError:false}));
  render().onCommand('Option 1');await Promise.resolve();await Promise.resolve();
  const html=renderToStaticMarkup(render().decisionDock);
  expect(html).toContain('Tight pickup buffer');
  expect(html).toContain('dispatch-manual-reason');
  expect(html).toContain('Reason');
  expect(html).toContain('Confirm assignment — PAIR-1 + Driver 1');
});
it('shows the committed Assigned pair on the first render despite a stale Scheduled row',async()=>{
  const selectedRequest={request_id:1,reservation_number:'RS-1',fleet_status:'Scheduled'};
  render({selectedRequest}).onCommand('Option 1');
  await Promise.resolve();await Promise.resolve();
  const reviewed=render({selectedRequest});
  expect(reviewed.selectedPair).toEqual({vehicleId:1,driverId:1});
  reviewed.onCommand('Assign it');
  state.handlers.onSuccess({request_id:1,fleet_status:'Assigned',vehicle_id:1,driver_id:1});
  const html=renderHtml({selectedRequest});
  expect(html).toContain('>Assigned</span>');
  expect(html).not.toContain('>Scheduled</span>');
  expect(html).toContain('PAIR-1');
  expect(html).toContain('Driver 1');
});
it('keeps a failed check unassignable and questions do not select a pair',async()=>{
  expect(render().onCommand('Why Option 2?')).toBeNull();expect(render().selectedPair).toBeNull();
  state.query.refetch.mockRejectedValueOnce(new Error('Schedule changed'));
  render().onCommand('Option 1');await Promise.resolve();await Promise.resolve();
  expect(render().onCommand('Assign it')).toContain('Schedule changed');
  expect(state.mutation.mutate).not.toHaveBeenCalled();
});
it('remembers the chosen pair and the exact option list it was chosen from',async()=>{
  state.query.refetch=vi.fn(async()=>({isError:false}));
  render().onCommand('Option 2');await Promise.resolve();await Promise.resolve();
  // Both candidates are pinned in the order the dispatcher saw them, so the
  // restored card keeps its number even if the engine re-ranks before they return.
  expect(state.persisted).toHaveBeenCalledWith(1,{key:'2:2',pinnedKeys:['1:1','2:2']});
  // A question is not a choice, so nothing is remembered for one.
  state.persisted.mockClear();
  render().onCommand('Why Option 2?');
  expect(state.persisted).not.toHaveBeenCalled();
  expect(state.cleared).not.toHaveBeenCalled();
});
it('forgets the chosen pair when the dispatcher changes selection',async()=>{
  state.query.refetch=vi.fn(async()=>({isError:false}));
  render().onCommand('Option 2');await Promise.resolve();await Promise.resolve();
  expect(render().onCommand('change selection')).toBe('Selection cleared. Choose a current option below.');
  expect(state.cleared).toHaveBeenCalledWith(1);
  expect(render().selectedPair).toBeNull();
});
it('Reset Copilot immediately clears the local and persisted selected pair',async()=>{
  state.query.refetch=vi.fn(async()=>({isError:false}));
  render().onCommand('Option 2');await Promise.resolve();await Promise.resolve();
  expect(render().selectedPair).toEqual({vehicleId:2,driverId:2});
  expect(state.persisted).toHaveBeenCalledWith(1,{key:'2:2',pinnedKeys:['1:1','2:2']});
  render().onResetDecision();
  expect(state.cleared).toHaveBeenCalledWith(1);
  expect(render().selectedPair).toBeNull();
  expect(render().decisionDock).toBeNull();
});
it('keeps Reset Copilot unavailable while assignment outcome is uncertain',async()=>{
  state.query.refetch=vi.fn(async()=>({isError:false}));
  render().onCommand('Option 1');await Promise.resolve();await Promise.resolve();
  render().onCommand('Assign it');
  await state.handlers.onError(new Error('network timeout'),{label:'PAIR-1',vehicle_id:1,driver_id:1});
  const uncertain=render();
  expect(uncertain.resetDisabled).toBe(true);
  uncertain.onResetDecision();
  expect(state.cleared).not.toHaveBeenCalled();
  expect(render().selectedPair).toEqual({vehicleId:1,driverId:1});
});
it('surfaces a 409 conflict with its server findings and marks the queue plan stale without a second commit',async()=>{
  // Integrated 409 path: the assign write is refused (stale plan / live
  // conflict), the panel shows the server-worded findings, the queue plan is
  // marked stale for reanalysis, and the dispatcher cannot recommit blindly.
  const plan={planToken:'signed',expiresAt:'2026-09-15T00:01:00Z'};
  const onPlanStale=vi.fn();
  const queueProps={queueMode:true,plan,planProposal:{pair:{vehicle_id:3,driver_id:4,vehicle:{plate_number:'PAIR-B'},driver:{driver_name:'Driver B'},checks:[{id:'capacity',status:'verified'}],readiness:'VERIFIED',feasibility:{verdict:'SAFE'}},outcome:'VERIFIED'},planToken:'signed',planExpiresAt:plan.expiresAt,planValidation:{isSuccess:true},onPlanStale};
  state.query.refetch=vi.fn(async()=>({isError:false}));
  render(queueProps).onCommand('Option 1');await Promise.resolve();await Promise.resolve();
  render(queueProps).onCommand('Assign it');
  expect(state.mutation.mutate).toHaveBeenCalledTimes(1);
  const conflict=new Error('Queue plan changed.');
  conflict.status=409;
  conflict.data={conflicts:[{type:'driver_conflict',message:'Driver reassigned to another request.'}]};
  await state.handlers.onError(conflict,{label:'PAIR-B',vehicle_id:3,driver_id:4});
  expect(onPlanStale).toHaveBeenCalledTimes(1);
  // ConflictChips renders Radix tooltips, which require the provider the real
  // app tree supplies; the static harness wraps just this render with it.
  state.cursor=0;
  const html=renderToStaticMarkup(React.createElement(TooltipProvider,null,AiRecommendationPanel({requestId:1,canAssign:true,...queueProps})));
  expect(html).toContain('Queue plan changed.');
  expect(html).toContain('role="alert"');
  expect(html).toContain('Assignment blocked by 1 conflict');
  expect(html).toContain('Driver reassigned to another request.');
  // The failed choice is retained for review, but a bare retry is refused:
  // only one commit ever left this panel.
  expect(render(queueProps).selectedPair).toEqual({vehicleId:3,driverId:4});
  render(queueProps).onCommand('Assign it');
  expect(state.mutation.mutate).toHaveBeenCalledTimes(1);
});
it('reconciles a network-ambiguous commit against the live request and completes when the pair is assigned',async()=>{
  // Integrated ambiguity path, success side: the commit may have landed despite
  // the transport failure, so the panel re-reads the request. The live record
  // shows the same pair Assigned, so the panel completes exactly as a direct
  // success would — one commit, committed status over the stale row, selection
  // spent, assignment recorded on the transcript.
  const selectedRequest={request_id:1,reservation_number:'RS-1',fleet_status:'Scheduled'};
  state.query.refetch=vi.fn(async()=>({isError:false}));
  render({selectedRequest}).onCommand('Option 1');await Promise.resolve();await Promise.resolve();
  render({selectedRequest}).onCommand('Assign it');
  expect(state.mutation.mutate).toHaveBeenCalledTimes(1);
  getTransportRequest.mockResolvedValueOnce({request_id:1,fleet_status:'Assigned',vehicle_id:1,driver_id:1});
  await state.handlers.onError(new Error('network timeout'),{label:'PAIR-1',vehicle_id:1,driver_id:1});
  expect(getTransportRequest).toHaveBeenCalledWith(1);
  const html=renderHtml({selectedRequest});
  expect(html).toContain('>Assigned</span>');
  expect(html).not.toContain('>Scheduled</span>');
  expect(html).toContain('PAIR-1');
  expect(state.cleared).toHaveBeenCalledWith(1);
  expect(state.mutation.mutate).toHaveBeenCalledTimes(1);
});
it('keeps the selection reviewable when reconciliation shows the ambiguous commit did not land',async()=>{
  // Integrated ambiguity path, mismatch side: the live record is still
  // unassigned, so the panel says exactly that, keeps the checked selection
  // for a deliberate retry, and still records only the single original commit.
  state.query.refetch=vi.fn(async()=>({isError:false}));
  render().onCommand('Option 1');await Promise.resolve();await Promise.resolve();
  render().onCommand('Assign it');
  expect(state.mutation.mutate).toHaveBeenCalledTimes(1);
  getTransportRequest.mockResolvedValueOnce({request_id:1,fleet_status:'Scheduled',vehicle_id:1,driver_id:2});
  await state.handlers.onError(new Error('network timeout'),{label:'PAIR-1',vehicle_id:1,driver_id:1});
  const reviewed=render();
  expect(reviewed.selectedPair).toEqual({vehicleId:1,driverId:1});
  expect(reviewed.resetDisabled).toBe(false);
  expect(renderHtml()).toContain('Current request loaded. Review the record and recheck before retrying.');
  expect(state.mutation.mutate).toHaveBeenCalledTimes(1);
});
