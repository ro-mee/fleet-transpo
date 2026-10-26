import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ query: {}, role: "fleet_manager" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => state.query, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({ authorized: true, role: state.role }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ employee: { roles: { role_name: state.role } } }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }) => React.createElement("a", props, children) }));
vi.mock("@/components/ui/toast", () => ({ toast: {success:vi.fn(), error:vi.fn()} }));
vi.stubGlobal("React", React);
import PredictiveMaintenancePage from "@/app/(dashboard)/maintenance/predictive/page";
import AiDashboardPage from "@/app/(dashboard)/ai/page";
import PredictiveOverview from "@/app/(dashboard)/fleet/maintenance/components/PredictiveOverview";
const service = (extra = {}) => ({ plan_id: 4, version: 2, service_code: "brakes", serviceStatus: "overdue", effectiveDays: null, kmToService: -125, mileage: 5125, next_service_mileage: 5000, dataIssues: [], recommendation: "Service mileage exceeded by 125 km.", evidence: { validSampleCount: 2, totalSampleCount: 3, measuredKm: 120, observationPeriod: { calendarDays: 14 }, quality: "limited", latestReadingSource: "manual_observation", latestReadingAt: "2026-10-23T02:00:00Z" }, ...extra });
const payload = () => ({ predictions: [
 { vehicle_id: 12, plate_number: "ABC-123", vehicle_name: "Van", services: [service(), service({ plan_id: 5, service_code: "tires", serviceStatus: "needs_data", next_service_mileage: 8000, mileage: null, kmToService: null, dataIssues: ["missing_mileage"], recommendation: "Record mileage.", active_work_order: { maintenance_id: 44, status: "Pending Inspection" } })], signals: [{ type: "recurring_inspection", checklist_item_id: "brakes_tires", count: 2, inspection_ids: [7, 8], dates: ["2026-10-20", "2026-10-21"], sources: [{inspection_id: 7, href: "/maintenance/problems?inspection_id=7"}], active_work_order: { maintenance_id: 45, status: "In Progress" } }] },
 { vehicle_id: 13, plate_number: "XYZ-456", vehicle_name: "Car", services: [], signals: [] }
], summary: { total: 2 } });
function renderFleet(props = {}) { return renderToStaticMarkup(<PredictiveOverview data={state.query.data} {...props} />); }
beforeEach(() => { state.role = "fleet_manager"; state.query = { data: payload(), isLoading: false, isError: false, refetch: vi.fn() }; });
describe("shared maintenance workspace routes", () => {
 it("shows identical service facts on both routes and retains per-item inspection work", () => {
  for (const html of [renderToStaticMarkup(<PredictiveMaintenancePage />), renderFleet()]) {
   expect(html).toContain("Mileage overdue by 125 km"); expect(html).toContain("Needs mileage"); expect(html).toContain("Brakes"); expect(html).toContain("Tires");
   expect(html).toContain("Recurring inspection finding"); expect(html).toContain("work_order=45"); expect(html).toContain("work_order=44");
   expect(html).not.toContain("/100"); expect(html).not.toContain("Fleet is Healthy"); expect(html).not.toContain("undefined days");
  }
 });
 it("exposes schedule, odometer and configuration actions only for authorized staff", () => {
  const staff = renderFleet(); expect(staff).toContain("Schedule service"); expect(staff).toContain("Record odometer"); expect(staff).toContain("Set schedule");
  state.role = "management"; const readonly = renderFleet(); expect(readonly).toContain("Review"); expect(readonly).not.toContain("Schedule service"); expect(readonly).not.toContain("Record odometer"); expect(readonly).not.toContain("Set schedule"); expect(readonly).not.toContain("work_order=");
  state.role = "mechanic"; expect(renderFleet()).toContain("/mechanic/work-orders/44"); expect(renderFleet()).not.toContain("Schedule service");
 });
 it("names loading and request failure without zero or healthy claims", () => {
  const loading = renderFleet({data: undefined, isLoading: true}); expect(loading).toContain("Loading service outlook"); expect(loading).not.toContain("0 services");
  const error = renderFleet({data: undefined, isError: true, onRetry: vi.fn()}); expect(error).toContain("Service outlook unavailable"); expect(error).toContain("Retry"); expect(error).not.toContain("No eligible vehicles");
  const stale = renderFleet({isError: true, onRetry: vi.fn()}); expect(stale).toContain("may be outdated"); expect(stale).not.toContain("Schedule service");
 });
 it("labels units and empty fleet honestly", () => {
  const html = renderFleet(); expect(html).toContain("Overdue services"); expect(html).toContain("Due within 7 days"); expect(html).toContain("Needs data"); expect(html).toContain("may overlap");
  const empty = renderFleet({data: {predictions: [], summary: {total: 0}}}); expect(empty).toContain("No eligible vehicles to assess"); expect(empty).not.toContain("healthy");
 });
});
it("keeps the AI maintenance preview free of physical health scores and labels request failures",()=>{
 const html=renderToStaticMarkup(<AiDashboardPage/>);expect(html).not.toContain("/100");expect(html).not.toContain("Maintenance Telemetry");
 state.query={isError:true,isLoading:false,refetch:vi.fn()};expect(renderToStaticMarkup(<AiDashboardPage/>)).toContain("Service outlook unavailable");
});

it("leads each vehicle with its authoritative primary service and keeps scheduled progress separate",()=>{
 const data=payload();data.predictions[0].primary_service_plan_id=5;
 data.predictions[0].services[0]={...service(),serviceStatus:"on_schedule",effectiveDays:60,kmToService:1000};
 data.predictions[0].services[1]={...service(),plan_id:5,service_code:"tires",active_work_order:{maintenance_id:44,status:"Scheduled"}};
 const html=renderFleet({data});const table=html.match(/<tbody>[\s\S]*?<\/tbody>/)[0];
 expect(table.indexOf("Tires")).toBeLessThan(table.indexOf("Brakes"));expect(table).toContain("Mileage overdue by 125 km");expect(table).toContain("Work order: Scheduled");
});
