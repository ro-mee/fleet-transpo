import React from 'react';
import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({cells:[],cursor:0,query:null,mutation:null,handlers:null,persisted:vi.fn(),cleared:vi.fn()}));
// Exercise the panel's event handlers and subsequent renders without a DOM dependency.
vi.mock('react',async original=>({...await original(),
  useState:initial=>{const i=state.cursor++;if(!(i in state.cells))state.cells[i]=typeof initial==='function'?initial():initial;return [state.cells[i],value=>{state.cells[i]=typeof value==='function'?value(state.cells[i]):value;}];},
  useRef:initial=>{const i=state.cursor++;return state.cells[i]??(state.cells[i]={current:initial});},useEffect:()=>{},
}));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>state.query,useMutation:handlers=>{state.handlers=handlers;return state.mutation;},useQueryClient:()=>({setQueryData:vi.fn(),invalidateQueries:vi.fn()})}));
vi.mock('@/hooks/use-role-access',()=>({useRoleAccess:()=>({can:()=>true})}));
vi.mock('@/components/reservations/trip-summary',()=>({useNow:()=>Date.parse('2026-09-15T00:00:00Z')}));
vi.mock('./copilot-conversation',()=>({CopilotConversation:()=>null,setReservationMessages:vi.fn(),getReservationSelection:()=>null,setReservationSelection:(...args)=>state.persisted(...args),clearReservationSelection:(...args)=>state.cleared(...args)}));
import {AiRecommendationPanel} from './ai-recommendation-panel';
import {CopilotConversation} from './copilot-conversation';
const find=(node,type)=>node?.type===type?node:React.Children.toArray(node?.props?.children).map(child=>find(child,type)).find(Boolean);
const render=(props={})=>{state.cursor=0;return find(AiRecommendationPanel({requestId:1,canAssign:true,...props}),CopilotConversation).props;};
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
  expect(render().onCommand('Assign it')).toContain('double-checking');
  expect(state.mutation.mutate).not.toHaveBeenCalled();
  resolve({isError:false});await Promise.resolve();await Promise.resolve();
  expect(render().onCommand('Assign it')).toEqual({handled:true});
  expect(state.mutation.mutate).toHaveBeenCalledWith(expect.objectContaining({vehicle_id:2,driver_id:2,force:false}));
  render().onCommand('Assign it');expect(state.mutation.mutate).toHaveBeenCalledTimes(1);
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
  expect(render().onCommand('change selection')).toBe('Choose a current option below.');
  expect(state.cleared).toHaveBeenCalledWith(1);
  expect(render().selectedPair).toBeNull();
});
