import React from "react";
import {beforeEach, expect, it, vi} from "vitest";
const state=vi.hoisted(()=>({cells:[],cursor:0}));
vi.mock("react",async original=>({...await original(), useRef: initial => {const i=state.cursor++;if (!(i in state.cells)) state.cells[i]={current:initial};return state.cells[i];},useState:initial=>{const i=state.cursor++;if(!(i in state.cells))state.cells[i]=typeof initial==="function"?initial():initial;return [state.cells[i],next=>{state.cells[i]=typeof next==="function"?next(state.cells[i]):next;}];}}));
vi.mock("@tanstack/react-query",()=>({useQueryClient:()=>({invalidateQueries:vi.fn()})}));
vi.mock("@/lib/api/client",()=>({apiFetch:vi.fn()}));
import {apiFetch} from "@/lib/api/client";
import ServicePlanDialog from "./service-plan-dialog";
const row={vehicle:{vehicle_id:12,plate_number:"ABC-123",mileage:5000},service:{plan_id:4,version:3,service_code:"brakes",next_service_mileage:6000,schedule_mode:"manual"},label:"Brakes"};
function find(node,predicate){if(predicate(node))return node;return React.Children.toArray(node?.props?.children).map(child=>find(child,predicate)).find(Boolean);}
function text(node){if(typeof node==="string"||typeof node==="number")return String(node);return React.Children.toArray(node?.props?.children).map(text).join(" ");}
function render(kind="plan",r=row){state.cursor=0;return ServicePlanDialog({action:{kind,row:r},onClose:vi.fn()});}
function set(name,value,kind="plan"){const input=find(render(kind),n=>n?.props?.name===name);expect(input).toBeDefined();input.props.onChange({target:{value}});}
async function save(kind="plan",r=row){const form=find(render(kind,r),n=>n?.type==="form");expect(form).toBeDefined();await form.props.onSubmit({preventDefault(){}});}
beforeEach(()=>{vi.stubGlobal("React",React);state.cells=[];state.cursor=0;vi.clearAllMocks();apiFetch.mockResolvedValue({version:4});});
it("saves the exact reviewed plan/version and retains fields plus persistent errors after conflict",async()=>{
 set("next_service_mileage","6500");apiFetch.mockRejectedValueOnce(Object.assign(new Error("Service plan changed. Reload before saving."),{status:409}));await save();
 expect(text(render())).toContain("Service plan changed");expect(find(render(),n=>n?.props?.name==="next_service_mileage").props.value).toBe("6500");
 expect(apiFetch).toHaveBeenCalledWith("/api/maintenance/service-plans",expect.objectContaining({method:"PUT",body:expect.objectContaining({vehicle_id:12,service_code:"brakes",expected_version:3,next_service_mileage:6500})}));
});
it("requires a review date and reason for deferral and keeps due thresholds out of its patch",async()=>{
 await save("defer");expect(text(render("defer"))).toContain("review date and reason");expect(apiFetch).not.toHaveBeenCalled();
 const picker=find(render("defer"),n=>n?.type?.name==="DatePicker");picker.props.onChange("2026-11-01");set("defer_reason","Awaiting parts","defer");await save("defer");
 expect(apiFetch.mock.calls[0][1].body).toEqual({vehicle_id:12,service_code:"brakes",expected_version:3,deferred_until:"2026-11-01",defer_reason:"Awaiting parts"});
});
it("rejects decreasing/future readings before sending and submits a timezone-bearing manual observation",async()=>{
 set("reading_km","4999","odometer");set("reason","Fleet check","odometer");const picker=find(render("odometer"),n=>n?.type?.name==="DateTimePicker");picker.props.onChange("2026-10-01T12:00");await save("odometer");expect(text(render("odometer"))).toContain("below the current");expect(apiFetch).not.toHaveBeenCalled();
 set("reading_km","5100","odometer");await save("odometer");expect(apiFetch.mock.calls[0][0]).toBe("/api/vehicles/12/odometer");expect(apiFetch.mock.calls[0][1].body).toMatchObject({reading_km:5100,reason:"Fleet check"});expect(apiFetch.mock.calls[0][1].body.observed_at).toMatch(/Z$/);
});
it("creates the selected missing service with version zero without suggested manufacturer values",async()=>{
 const missing={...row,service:undefined,service_code:"tires",kind:"setup",label:"Tires"};
 const input=find(render("plan",missing),n=>n?.props?.name==="next_service_mileage");expect(input).toBeDefined();input.props.onChange({target:{value:"7000"}});await save("plan",missing);
 expect(apiFetch.mock.calls[0][1].body).toMatchObject({vehicle_id:12,service_code:"tires",expected_version:0,next_service_mileage:7000});
});

it("uses the shared picker for historical observations and blocks future times at submission",async()=>{
 const picker=find(render("odometer"),n=>n?.type?.name==="DateTimePicker");
 expect(picker.props.disablePast).toBe(false);expect(picker.props.disableFuture).toBe(true);
 set("reading_km","5100","odometer");set("reason","Fleet check","odometer");picker.props.onChange("2099-01-01T12:00");await save("odometer");
 expect(text(render("odometer"))).toContain("future readings are not allowed");expect(apiFetch).not.toHaveBeenCalled();
});
