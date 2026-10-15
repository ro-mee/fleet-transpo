"use client";

import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export function MechanicAssignmentField({ value, onValueChange, directory }) {
  const mechanics = Array.isArray(directory.data) ? directory.data : [];
  const selected = value && value !== "unassigned" ? String(value) : "unassigned";
  const missingAssignee = selected !== "unassigned" && !mechanics.some((m) => String(m.employee_id) === selected);
  return (
    <Field label="Assign Mechanic">
      <Select value={selected} onValueChange={onValueChange} disabled={directory.isLoading || directory.isError}>
        <SelectTrigger aria-label="Assign Mechanic">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {missingAssignee && <SelectItem value={selected} disabled>Current mechanic #{selected} (unavailable)</SelectItem>}
          {mechanics.map((m) => (
            <SelectItem key={m.employee_id} value={String(m.employee_id)}>
              {m.first_name} {m.last_name}{m.email ? ` — ${m.email}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {directory.isLoading && <p role="status" className="text-xs text-foreground-muted">Loading mechanics…</p>}
      {directory.isError && (
        <Button type="button" size="sm" variant="outline" onClick={() => directory.refetch()} disabled={directory.isFetching}>
          Could not load mechanics — retry
        </Button>
      )}
      {!directory.isLoading && !directory.isError && mechanics.length === 0 && (
        <p role="status" className="text-xs text-foreground-muted">No active mechanics available. The work order can remain unassigned.</p>
      )}
    </Field>
  );
}
