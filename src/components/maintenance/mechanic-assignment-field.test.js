import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MechanicAssignmentField } from "./mechanic-assignment-field";
import { Select, SelectTrigger } from "@/components/ui/select";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
const props = { value: "77", onValueChange: vi.fn(), directory: { data: [{ employee_id: 77, first_name: "Rosa", last_name: "Diaz" }] } };
function find(node, type) {
  return node?.type === type ? node : React.Children.toArray(node?.props?.children).map((child) => find(child, type)).find(Boolean);
}
it("renders an accessible Radix trigger and connects selection to the form", () => {
  const change = vi.fn();
  const tree = MechanicAssignmentField({ ...props, onValueChange: change });
  expect(find(tree, SelectTrigger)).toBeDefined();
  expect(renderToStaticMarkup(tree)).toContain('role="combobox"');
  find(tree, Select).props.onValueChange("78");
  expect(change).toHaveBeenCalledWith("78");
});
it("disables assignment while loading and exposes loading status", () => {
  const tree = MechanicAssignmentField({ ...props, directory: { isLoading: true } });
  expect(find(tree, Select).props.disabled).toBe(true);
  expect(renderToStaticMarkup(tree)).toContain("Loading mechanics");
});
it("shows failed directory state and retries without clearing the assignment", () => {
  const retry = vi.fn();
  const tree = MechanicAssignmentField({ ...props, directory: { isError: true, refetch: retry } });
  expect(find(tree, Select).props.value).toBe("77");
  expect(find(tree, Select).props.disabled).toBe(true);
  expect(renderToStaticMarkup(tree)).toContain("Could not load mechanics");
  const button = React.Children.toArray(tree.props.children).find((child) => child?.props?.onClick);
  button.props.onClick();
  expect(retry).toHaveBeenCalledOnce();
});
it("explains an empty directory while retaining an existing assignee", () => {
  const tree = MechanicAssignmentField({ ...props, directory: { data: [] } });
  expect(find(tree, Select).props.value).toBe("77");
  expect(renderToStaticMarkup(tree)).toContain("No active mechanics available");
});
