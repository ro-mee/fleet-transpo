import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ list: {}, detail: {}, buttons: [] }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({queryKey}) => queryKey[0] === "maintenance-record" ? state.detail : queryKey[0] === "maintenance" ? state.list : {data:[]},
  useQueryClient: () => ({invalidateQueries:vi.fn()}),
  useMutation: () => ({mutate:vi.fn(),isPending:false}),
  keepPreviousData: value => value,
}));
vi.mock("next/navigation", () => ({useSearchParams:()=>new URLSearchParams("work_order=44")}));
vi.mock("next/link", () => ({default:({children,...props})=>React.createElement("a",props,children)}));
vi.mock("@/lib/auth/role-guard", () => ({useRequireRole:()=>({role:"fleet_manager",authorized:true})}));
vi.mock("@/hooks/use-theme", () => ({useTheme:()=>({theme:"light"})}));
vi.mock("@/components/ui/toast", () => ({toast:{success:vi.fn(),error:vi.fn()}}));
// Keep the real button and its production click handler; expose it without adding a DOM dependency.
vi.mock("@/components/ui/button", async original => {
  const actual=await original();
  return {...actual,Button:props=>{state.buttons.push(props);return React.createElement(actual.Button,props);}};
});
vi.stubGlobal("React",React);
const {default:MaintenancePage}=await import("./page");
beforeEach(()=>{
 state.buttons=[];
 state.list={data:{rows:[],total:0,counts:{total:0,scheduled:0,overdue:0,inProgress:0,totalCost:0}},isLoading:false,isError:false,refetch:vi.fn()};
 state.detail={isLoading:false,isError:true,refetch:vi.fn()};
});
it("keeps a successful register visible when its linked work order fails and retries only the detail",()=>{
 const html=renderToStaticMarkup(React.createElement(MaintenancePage));
 expect(html).toContain("Fleet Maintenance Register");expect(html).toContain("Could not open this work order");expect(html).toContain('role="alert"');
 const retry=state.buttons.find(props=>props.children==="Retry work order");expect(retry).toBeDefined();retry.onClick();
 expect(state.detail.refetch).toHaveBeenCalledOnce();expect(state.list.refetch).not.toHaveBeenCalled();
});
it("also exposes the linked failure independently when the register request fails",()=>{
 state.list={...state.list,isError:true,error:new Error("Register unavailable")};
 const html=renderToStaticMarkup(React.createElement(MaintenancePage));
 expect(html).toContain("Could not load maintenance records");expect(html).toContain("Could not open this work order");
 const retry=state.buttons.find(props=>props.children==="Retry work order");expect(retry).toBeDefined();retry.onClick();expect(state.detail.refetch).toHaveBeenCalledOnce();expect(state.list.refetch).not.toHaveBeenCalled();
});
