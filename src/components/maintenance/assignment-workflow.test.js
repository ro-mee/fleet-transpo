import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cells: [], cursor: 0, role: "fleet_manager", directory: null, vehicles: [] }));
// Preserve form state between event-handler calls without introducing a DOM dependency.
vi.mock("react", async (original) => ({ ...await original(),
  useState: (initial) => {
    const i = state.cursor++;
    if (!(i in state.cells)) state.cells[i] = typeof initial === "function" ? initial() : initial;
    return [state.cells[i], (next) => { state.cells[i] = typeof next === "function" ? next(state.cells[i]) : next; }];
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }) => queryKey[0] === "mechanics-for-maintenance"
    ? state.directory
    : { data: state.vehicles },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ employee: { roles: { role_name: state.role } } }) }));
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn(async () => ({ maintenance_id: 44 })) }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from "@/lib/api/client";
import MaintenanceFormDialog from "@/app/(dashboard)/fleet/maintenance/components/MaintenanceFormDialog";
import MaintenanceRegister from "@/app/(dashboard)/fleet/maintenance/components/MaintenanceRegister";
import { repairPerformerLabel } from "@/lib/maintenance/performer";

function find(node, predicate) {
  if (predicate(node)) return node;
  return React.Children.toArray(node?.props?.children).map((child) => find(child, predicate)).find(Boolean);
}
function form(initialData) {
  state.cursor = 0;
  return MaintenanceFormDialog({ isOpen: true, onClose: vi.fn(), initialData });
}
function control(tree) {
  const field = find(tree, (node) => node?.type?.name === "MechanicAssignmentField");
  expect(field, "the actual form must use a working shared assignment control").toBeDefined();
  return field.props;
}
function textContent(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return React.Children.toArray(node?.props?.children).map(textContent).join(" ");
}
async function save(tree) {
  await find(tree, (node) => node?.type === "form").props.onSubmit({ preventDefault() {} });
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  state.cells = []; state.cursor = 0; state.role = "fleet_manager"; state.vehicles = [];
  state.directory = { data: [{ employee_id: 77, first_name: "Rosa", last_name: "Diaz" }, { employee_id: 78, first_name: "Amy", last_name: "Santiago" }] };
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

it("creates with the selected mechanic, reopens, preserves, reassigns and unassigns", async () => {
  const draft = { vehicle_id: 12, maintenance_date: "2026-10-09", maintenance_type: "Inspection" };
  control(form(draft)).onValueChange("77");
  await save(form(draft));
  expect(apiFetch).toHaveBeenLastCalledWith("/api/vehicle-maintenance", expect.objectContaining({ method: "POST", body: expect.objectContaining({ assigned_mechanic_id: 77 }) }));

  state.cells = [];
  const assigned = { ...draft, maintenance_id: 44, assigned_mechanic_id: 77 };
  expect(control(form(assigned)).value).toBe("77");
  await save(form(assigned));
  expect(apiFetch.mock.calls.at(-1)[1].body).not.toHaveProperty("assigned_mechanic_id");

  control(form(assigned)).onValueChange("78");
  await save(form(assigned));
  expect(apiFetch.mock.calls.at(-1)[1].body.assigned_mechanic_id).toBe(78);
  state.cells = [];
  const reassigned = { ...assigned, assigned_mechanic_id: 78 };
  expect(control(form(reassigned)).value).toBe("78");
  control(form(reassigned)).onValueChange("unassigned");
  await save(form(reassigned));
  expect(apiFetch.mock.calls.at(-1)[1].body.assigned_mechanic_id).toBeNull();
});

it("does not expose assignment controls to a mechanic", () => {
  state.role = "mechanic";
  expect(find(form({}), (node) => node?.type?.name === "MechanicAssignmentField")).toBeUndefined();
});

it("allows choosing a vehicle through an actual form control before assignment", async () => {
  const vehicle = find(form({}), (node) => node?.type === "select" && node.props.name === "vehicle_id");
  expect(vehicle).toBeDefined();
  vehicle.props.onChange({ target: { name: "vehicle_id", value: "12" } });
  control(form({})).onValueChange("77");
  await save(form({}));
  expect(apiFetch.mock.calls.at(-1)[1].body.vehicle_id).toBe("12");
});

it("fills the editable service mileage from the selected vehicle and submits it", async () => {
  state.vehicles = [{ vehicle_id: 12, plate_number: "ABC 1234", vehicle_name: "Van", mileage: 54820 }];
  const draft = { status: "Completed", completed_date: "2026-10-08" };
  const vehicle = find(form(draft), (node) => node?.type === "select" && node.props.name === "vehicle_id");

  vehicle.props.onChange({ target: { name: "vehicle_id", value: "12" } });
  const updatedForm = form(draft);
  const mileage = find(updatedForm, (node) => node?.props?.name === "mileage_at_service");

  expect(mileage.props.value).toBe("54820");
  mileage.props.onChange({ target: { name: "mileage_at_service", value: "54825" } });
  await save(form(draft));

  expect(apiFetch.mock.calls.at(-1)[1].body).toMatchObject({
    vehicle_id: "12",
    mileage_at_service: "54825",
  });
});

it("removes provider and service-center inputs and register details", async () => {
  const dialog = form({ status: "Completed" });
  expect(find(dialog, (node) => ["service_provider", "service_center"].includes(node?.props?.name))).toBeUndefined();
  await save(dialog);
  expect(apiFetch.mock.calls.at(-1)[1].body).not.toHaveProperty("service_provider");

  const register = MaintenanceRegister({
    records: [
      { maintenance_id: 1, maintenance_type: "Repair", maintenance_date: "2026-10-08", repair_completed_by_name: "Nico Santos", service_provider: "Old garage" },
      { maintenance_id: 2, maintenance_type: "Inspection", maintenance_date: "2026-10-08", repair_completed_by_name: null },
    ],
    onEdit: vi.fn(),
  });
  expect(textContent(register)).not.toContain("Service Provider");
  expect(textContent(register)).not.toContain("Old garage");
  expect(textContent(register)).toContain("Mechanic");
  expect(textContent(register)).toContain("Nico Santos");
  expect(textContent(register)).toContain("Not recorded");
  expect(repairPerformerLabel({ repair_completed_by_name: "  Nico Santos  " })).toBe("Nico Santos");
  expect(repairPerformerLabel({ repair_completed_by_name: null })).toBe("Not recorded");
});

it("preserves the existing assignment when directory loading fails", async () => {
  state.directory = { isError: true, data: undefined, refetch: vi.fn() };
  const assigned = { vehicle_id: 12, maintenance_id: 44, assigned_mechanic_id: 77 };
  expect(control(form(assigned)).directory.isError).toBe(true);
  await save(form(assigned));
  expect(apiFetch.mock.calls.at(-1)[1].body).not.toHaveProperty("assigned_mechanic_id");
});

it("submits the reviewed task identity and version from the existing scheduling form", async () => {
 const draft={vehicle_id:12,service_plan_id:4,expected_version:2,service_code:"brakes",maintenance_type:"Preventive"};
 await save(form(draft));
 expect(apiFetch.mock.calls.at(-1)[1].body).toMatchObject({vehicle_id:12,service_plan_id:4,expected_version:2});
 expect(find(form(draft),node=>node?.type==="select" && node.props.name==="vehicle_id").props.disabled).toBe(true);
});
