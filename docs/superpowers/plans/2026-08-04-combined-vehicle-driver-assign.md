# Combined Vehicle + Driver Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two linked Vehicle and Driver dropdowns in the Assign Resources dialog with one combined dropdown of custodial pairs, plus a collapsed escape hatch for substituting a driver on a single trip.

**Architecture:** Purely client-side. The dialog already runs three queries — available vehicles, available drivers, active custodial pairings. A `useMemo` joins them into pair options instead of feeding two selects and an auto-fill linker. The submitted payload is unchanged, so no endpoint, schema, or migration is touched.

**Tech Stack:** Next.js (App Router), React 19, TanStack Query v5, shadcn/ui `Select`, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-04-combined-vehicle-driver-assign-design.md`

## Global Constraints

- **Only one file changes:** `src/components/reservations/assign-dialog.jsx`. If a task appears to need another file, stop and re-read the spec.
- **No test framework exists.** `package.json` has `lint` only — no jest, vitest, or testing-library. Do not add one; it is explicitly out of scope. Verification is `npx eslint` plus the manual checks listed per task.
- **The submitted payload must not change.** `onSubmit` receives exactly `{ request, vehicleId, driverId, force }`, each id a `Number` or `null`.
- **Never write to `driver_vehicle_assignments`.** The escape hatch changes only what this trip records. Custody is edited on the vehicle/driver detail pages, not here.
- **No effect-based state syncing.** The form is keyed by `request.request_id` and seeds through `useState` initializers. Adding a `useEffect` that calls `setState` violates `react-hooks/set-state-in-effect` and the existing comment at lines 46-49.
- **Exact copy strings**, used verbatim:
  - Off-duty option suffix: `driver needed`
  - Off-duty explanation: `joseph lims is off duty. Pick a driver for this trip — the permanent assignment doesn't change.` (name substituted at runtime)
  - Escape hatch trigger: `Use a different driver`
  - Hidden footnote: `2 available vehicles have no assigned driver and aren't listed.` (count substituted)
- **Do not commit anything, and do not stage anything.** The custodial pairing feature this change sits on top of is itself uncommitted — `HEAD`'s copy of this file is 145 lines and has none of it. Committing the dialog without the untracked `src/services/driver-assignment.service.js` it imports would leave the repo unbuildable at that commit. Implementers edit the file and stop there. Per-task diffs are captured as file snapshots under `.superpowers/sdd/2026-08-04-combined-vehicle-driver-assign/`. The user reviews and commits everything at the end.
- **Do not run the manual checks.** They need a browser, a running dev server, and a seeded database. Each task's automated gate is `npx eslint` alone. The manual checks are recorded in each task for the user, who runs them in one pass after all five tasks land.

---

## Before Task 1: Working Tree — resolved

The working tree has 17 dirty entries on `main`, including the whole migration-017 feature set and this file's own uncommitted pairing logic.

**Decision made: nothing is committed during execution.** A worktree was ruled out because branching from `main` or `origin/main` would produce the 145-line committed copy of this file, which contains none of the code Task 1 deletes. Committing the dialog alone was ruled out because its import of the untracked `driver-assignment.service` would break the build at that commit.

Work proceeds in place, uncommitted. The user commits when the five tasks are done and they have run the manual checks.

---

## File Structure

`src/components/reservations/assign-dialog.jsx` — one file, two components:

- `AssignForm` — all changes land here. Owns selection state, derives options, renders the select, escape hatch, warning, and conflict block.
- `AssignDialog` — unchanged wrapper. Keeps `key={request.request_id}`.

The file is ~280 lines and stays comfortably under that after the change: roughly 30 lines are deleted and roughly 45 added. No split is warranted.

---

### Task 1: Combined dropdown for the normal case

Replace the two selects with one, listing pairs whose vehicle and driver are both available. Deletes the auto-fill linking machinery.

**Files:**
- Modify: `src/components/reservations/assign-dialog.jsx:53-265`

**Interfaces:**
- Consumes: existing `personName(r)` helper at line 30; the three `useQuery` results (`vehicles`, `drivers`, `pairingData`).
- Produces: `options` array where each entry is
  `{ value: string, vehicleId: number, driverId: number, plate: string, driverName: string, driverAvailable: boolean, label: string }`,
  and `hiddenCount: number`. Tasks 2, 3, and 4 all build on these exact names.

- [ ] **Step 1: Replace the three state values with one**

Delete the `vehicleId`, `driverId`, and `autoFilled` `useState` calls (lines 54-63). Replace with:

```jsx
  // "<vehicleId>:<driverId>" — the custodial pair chosen. Seeded from whatever is
  // already on the request; the form is keyed by request id so a remount reseeds.
  const [selection, setSelection] = useState(
    request?.vehicle_id || request?.driver_id
      ? `${request.vehicle_id ?? ""}:${request.driver_id ?? ""}`
      : ""
  );
```

- [ ] **Step 2: Replace the byVehicle/byDriver memo with an options memo**

Delete the `useMemo` at lines 80-86 and the `driverListed` / `vehicleListed` helpers at lines 90-91. Replace with:

```jsx
  // One option per custodial pairing whose vehicle is available. Driver
  // availability is a flag, not a filter — see Task 2. Filtering on it would make
  // an available car vanish whenever its custodian took a day off.
  const { options, hiddenCount } = useMemo(() => {
    const rows = pairingData?.assignments ?? [];
    const vById = new Map(vehicles.map((v) => [v.vehicle_id, v]));
    const onDuty = new Set(drivers.map((d) => d.driver_id));

    const built = rows
      .filter((a) => vById.has(a.vehicle_id))
      .map((a) => {
        const v = vById.get(a.vehicle_id);
        const driverAvailable = onDuty.has(a.driver_id);
        const driverName = personName(a);
        return {
          value: `${a.vehicle_id}:${a.driver_id}`,
          vehicleId: a.vehicle_id,
          driverId: a.driver_id,
          plate: v.plate_number,
          driverName,
          driverAvailable,
          label:
            `${v.plate_number}` +
            (v.seating_capacity ? ` · ${v.seating_capacity} seats` : "") +
            (v.model ? ` · ${v.model}` : "") +
            ` · ${driverAvailable ? driverName : "driver needed"}`,
        };
      })
      .sort((a, b) => a.plate.localeCompare(b.plate));

    const offered = new Set(built.map((o) => o.vehicleId));
    return {
      options: built,
      hiddenCount: vehicles.filter((v) => !offered.has(v.vehicle_id)).length,
    };
  }, [vehicles, drivers, pairingData]);
```

- [ ] **Step 3: Delete the auto-fill linkers and the four-branch pairing block**

Delete `pickVehicle` (lines 93-102), `pickDriver` (lines 104-113), the `vSel`/`dSel`/`vMate`/`dMate` derivations (lines 115-118), and the entire `pairing` computation (lines 120-146). Task 2 reintroduces a single-condition replacement.

Step 4 also deletes the `pairing` render block, which is the only consumer of the `Link2` and `Info` icons. Both become unused in this task, so narrow the import at line 26:

```jsx
import { Send } from "lucide-react";
```

Task 2 re-adds `Info` when the notice returns. `Link2` never comes back — the "permanently paired" confirmation it decorated is gone, because a paired option no longer needs to announce that it is paired.

Update the header comment at lines 44-52 — it describes the two-select linkage that no longer exists:

```jsx
// The dispatcher picks a vehicle and its custodial driver (migration 017) as one
// choice, because that is how the yard actually works: a car comes with the person
// responsible for it. Substituting a different driver for a single trip is a
// deliberate, secondary action — see the escape hatch below — and it never touches
// the permanent pairing, only what this trip records.
```

- [ ] **Step 4: Replace the two selects with one**

Delete both `<div>` blocks at lines 167-213. Replace with:

```jsx
        <div>
          <label className="text-sm font-medium text-foreground">Vehicle &amp; Driver</label>
          <Select value={selection} onValueChange={setSelection}>
            <SelectTrigger className="mt-1.5">
              <SelectValue
                placeholder={
                  loadingVehicles || loadingDrivers ? "Loading…" : "Select a vehicle"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {request.passenger_count > 1 && (
            <p className="mt-1 text-xs text-foreground-muted">
              Needs seating for {request.passenger_count}.
            </p>
          )}
        </div>
```

- [ ] **Step 5: Update submit and the disabled condition**

Replace `submit` (lines 149-155):

```jsx
  const submit = (force) => {
    const [v, d] = selection.split(":");
    onSubmit?.({
      request,
      vehicleId: v ? Number(v) : null,
      driverId: d ? Number(d) : null,
      force,
    });
  };
```

Change the Assign button's `disabled` (line 258) from `!vehicleId && !driverId` to `!selection`:

```jsx
        <Button disabled={isPending || !selection} onClick={() => submit(false)}>
```

- [ ] **Step 6: Verify**

Run: `npx eslint src/components/reservations/assign-dialog.jsx`
Expected: no errors. Specifically no `react-hooks/set-state-in-effect` and no unused-variable warnings — an unused `byDriver`, `autoFilled`, `Link2`, or `Info` means Step 3 missed a deletion.

**Manual checks — the user runs these after all five tasks land. Do not attempt them.** Start the dev server (`npm run dev`), open a pending request, and click Assign:
- One field labelled **Vehicle & Driver**, not two.
- Options read like `ABC 1454 · 2 seats · SVJ · joseph lims`.
- Selecting one and pressing Assign completes without error.
- A request with `passenger_count > 1` still shows the seating hint, now under the single field.
- Set a paired vehicle's status to `Under Maintenance`. Its pairing disappears from the list entirely — the `vById.has(...)` filter drops it, and unlike the off-duty case there is no escape hatch for a vehicle that cannot be driven.

- [ ] **Step 7: Stop — do not commit**

Leave the change in the working tree, unstaged. Do not run `git add`, `git commit`, or `git stash`. Report DONE; the controller snapshots the diff for review.

---

### Task 2: Off-duty options and the driver escape hatch

Make a pair selectable when its custodian is off duty, and allow substituting a driver for this trip only.

**Files:**
- Modify: `src/components/reservations/assign-dialog.jsx`

**Interfaces:**
- Consumes: `options`, `hiddenCount` from Task 1; the `drivers` query result.
- Produces: `selectedOpt` (the matching option object or `null`), `effectiveDriverId: number | null`, and `needsDriver: boolean`. Task 3 extends `selectedOpt` to cover the pinned entry.

- [ ] **Step 1: Add override state and a pick handler**

Below the `selection` state from Task 1:

```jsx
  // "" follows the selected pair's own driver; otherwise a driver_id substituted
  // for this trip only. Never written to driver_vehicle_assignments.
  const [driverOverride, setDriverOverride] = useState("");
  const [showOverride, setShowOverride] = useState(false);
```

After the `options` memo:

```jsx
  const selectedOpt = options.find((o) => o.value === selection) ?? null;

  // Changing the pair drops any override: a substitution is meaningful only
  // against the pair it departs from. Carrying it across would silently apply a
  // substitute driver to a vehicle nobody chose them for.
  const pick = (next) => {
    setSelection(next);
    setDriverOverride("");
    const opt = options.find((o) => o.value === next);
    setShowOverride(opt ? !opt.driverAvailable : false);
  };

  const effectiveDriverId = driverOverride
    ? Number(driverOverride)
    : (selectedOpt?.driverId ?? null);

  const needsDriver = Boolean(selectedOpt && !selectedOpt.driverAvailable && !driverOverride);
```

Change the select's handler from `onValueChange={setSelection}` to `onValueChange={pick}`.

- [ ] **Step 2: Render the escape hatch**

Directly after the closing `</Select>` of the combined field, before the seating hint:

```jsx
          {selectedOpt && !showOverride && (
            <button
              type="button"
              onClick={() => setShowOverride(true)}
              className="mt-2 text-xs text-foreground-secondary hover:text-foreground transition-colors"
            >
              Use a different driver
            </button>
          )}

          {selectedOpt && showOverride && (
            <div className="mt-2">
              <label className="text-xs font-medium text-foreground-secondary">
                Driver for this trip
              </label>
              <Select value={driverOverride} onValueChange={setDriverOverride}>
                <SelectTrigger className="mt-1">
                  <SelectValue
                    placeholder={loadingDrivers ? "Loading…" : "Select a driver"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => (
                    <SelectItem key={d.driver_id} value={String(d.driver_id)}>
                      {d.employees?.first_name || d.first_name || "Driver"}{" "}
                      {d.employees?.last_name || d.last_name || `#${d.driver_id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
```

- [ ] **Step 3: Add the single-condition departure notice**

Where the deleted `pairing` block used to render (before `<ConflictBlock>`):

```jsx
        {selectedOpt && (needsDriver || effectiveDriverId !== selectedOpt.driverId) && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="min-w-0 text-sm text-foreground-secondary">
                {needsDriver
                  ? `${selectedOpt.driverName} is off duty. Pick a driver for this trip — the permanent assignment doesn't change.`
                  : `${selectedOpt.plate} is normally driven by ${selectedOpt.driverName}. This trip is recorded as a departure from the permanent assignment, not blocked.`}
              </p>
            </div>
          </div>
        )}
```

The notice reintroduces the `Info` icon that Task 1 removed. Restore it at line 26:

```jsx
import { Send, Info } from "lucide-react";
```

- [ ] **Step 4: Wire the override into submit**

```jsx
  const submit = (force) => {
    const [v] = selection.split(":");
    onSubmit?.({
      request,
      vehicleId: v ? Number(v) : null,
      driverId: effectiveDriverId,
      force,
    });
  };
```

And block submission while a driver is still owed:

```jsx
        <Button disabled={isPending || !selection || needsDriver} onClick={() => submit(false)}>
```

- [ ] **Step 5: Verify**

Run: `npx eslint src/components/reservations/assign-dialog.jsx`
Expected: no errors, and no unused-import warning — `Info` is imported again in Step 3 and used by the notice.

**Manual checks — the user runs these. Do not attempt them.** In the dev app, set a paired driver's status to something other than `Available`, then open Assign:
- Their vehicle still appears, ending in `· driver needed`.
- Selecting it opens the driver picker automatically and Assign is disabled.
- The notice reads `<name> is off duty. Pick a driver for this trip — the permanent assignment doesn't change.`
- Choosing a driver enables Assign; submitting succeeds.
- The vehicle's detail page still shows the original custodian — the pairing is unchanged.
- On an available pair, `Use a different driver` is collapsed; opening it and choosing someone shows the departure notice.
- Override a driver, then switch to a different pair: the override clears and the picker collapses.

- [ ] **Step 6: Stop — do not commit**

Leave the change unstaged. Do not run `git add`, `git commit`, or `git stash`.

---

### Task 3: Pin a pre-existing non-pair assignment

A request already assigned to a combination that is not a current pair must still show what it is.

**Files:**
- Modify: `src/components/reservations/assign-dialog.jsx`

**Interfaces:**
- Consumes: `options` (Task 1), `selectedOpt` / `pick` (Task 2).
- Produces: `allOptions` — the array actually rendered. Task 4 counts against `options`, not `allOptions`.

- [ ] **Step 1: Build the pinned entry**

After the `options` memo:

```jsx
  // A request may already hold a combination that is not a current pairing — made
  // before this dialog changed, or through the API. Show it rather than silently
  // dropping it. Labels resolve through a fallback chain so they are never blank:
  // available lists → pairing rows → the request → bare ids.
  const pinned = useMemo(() => {
    if (!request?.vehicle_id && !request?.driver_id) return null;
    const key = `${request.vehicle_id ?? ""}:${request.driver_id ?? ""}`;
    if (options.some((o) => o.value === key)) return null;

    const rows = pairingData?.assignments ?? [];
    const v = vehicles.find((x) => x.vehicle_id === request.vehicle_id);
    const d = drivers.find((x) => x.driver_id === request.driver_id);
    const vRow = rows.find((a) => a.vehicle_id === request.vehicle_id);
    const dRow = rows.find((a) => a.driver_id === request.driver_id);

    const plate =
      v?.plate_number ||
      vRow?.plate_number ||
      request.plate_number ||
      (request.vehicle_id ? `Vehicle #${request.vehicle_id}` : "No vehicle");
    const driverName = request.driver_id
      ? personName(d) !== "another driver"
        ? personName(d)
        : personName(dRow)
      : "No driver";

    return {
      value: key,
      vehicleId: request.vehicle_id ?? null,
      driverId: request.driver_id ?? null,
      plate,
      driverName,
      driverAvailable: true,
      isPinned: true,
      label: `${plate} · ${driverName} · current — not paired`,
    };
  }, [request, options, vehicles, drivers, pairingData]);

  const allOptions = pinned ? [pinned, ...options] : options;
```

- [ ] **Step 2: Render from allOptions and look up against it**

Change the select body to map `allOptions` instead of `options`, and change both lookups in Task 2 (`selectedOpt` and the one inside `pick`) to search `allOptions`.

- [ ] **Step 3: Give the pinned entry its own notice**

Extend the notice condition so a pinned selection explains itself:

```jsx
        {selectedOpt && (needsDriver || selectedOpt.isPinned || effectiveDriverId !== selectedOpt.driverId) && (
```

and add the branch, ordered before the departure text:

```jsx
                {needsDriver
                  ? `${selectedOpt.driverName} is off duty. Pick a driver for this trip — the permanent assignment doesn't change.`
                  : selectedOpt.isPinned && effectiveDriverId === selectedOpt.driverId
                    ? `${selectedOpt.plate} and ${selectedOpt.driverName} are not a permanent pairing. This assignment is kept as it is.`
                    : `${selectedOpt.plate} is normally driven by ${selectedOpt.driverName}. This trip is recorded as a departure from the permanent assignment, not blocked.`}
```

- [ ] **Step 4: Verify**

Run: `npx eslint src/components/reservations/assign-dialog.jsx`
Expected: no errors.

**Manual checks — the user runs these. Do not attempt them.** In the dev app, find or create a request assigned to a vehicle and driver that are not paired:
- Reopening Assign shows it first in the list, ending `· current — not paired`, and pre-selected.
- The notice explains it is not a permanent pairing.
- Selecting a real pair instead replaces it, and the pinned entry disappears from the list on the next open.
- A request with a vehicle but no driver shows `… · No driver · current — not paired` and still submits, sending `driverId: null`.

- [ ] **Step 5: Stop — do not commit**

Leave the change unstaged. Do not run `git add`, `git commit`, or `git stash`.

---

### Task 4: Hidden-vehicle footnote and empty state

Vehicles with no custodial pairing are omitted. Say so rather than letting them vanish.

**Files:**
- Modify: `src/components/reservations/assign-dialog.jsx`

**Interfaces:**
- Consumes: `hiddenCount` (Task 1). The empty-state check in Step 2 also exercises `allOptions` (Task 3), but no code here reads it — with nothing to render, the footnote is the only thing on screen.

- [ ] **Step 1: Render the footnote**

Immediately after the seating hint, inside the same `<div>`:

```jsx
          {hiddenCount > 0 && (
            <p className="mt-1 text-xs text-foreground-muted">
              {hiddenCount} available {hiddenCount === 1 ? "vehicle has" : "vehicles have"} no
              assigned driver and {hiddenCount === 1 ? "isn't" : "aren't"} listed. Assign a driver
              on the vehicle&apos;s page to make {hiddenCount === 1 ? "it" : "them"} available here.
            </p>
          )}
```

- [ ] **Step 2: Verify**

Run: `npx eslint src/components/reservations/assign-dialog.jsx`
Expected: no errors. Note `&apos;` — a bare apostrophe in JSX text trips `react/no-unescaped-entities`.

**Manual checks — the user runs these. Do not attempt them.** In the dev app:
- Release a vehicle's pairing on its detail page. The Assign dialog drops it from the list and the count rises by one.
- Singular reads `1 available vehicle has no assigned driver and isn't listed.`
- With every vehicle paired, the footnote does not render at all.
- With no pairings at all, the select is empty, the footnote explains why, and Assign is disabled.

- [ ] **Step 3: Stop — do not commit**

Leave the change unstaged. Do not run `git add`, `git commit`, or `git stash`.

---

### Task 5: Whole-dialog regression pass — user-run, not dispatched

Nothing new is written. This confirms the parts the spec lists as unchanged really are. Every step needs a browser, a seeded database, or live env credentials, so no subagent runs this task. It is the checklist the user works through once Tasks 1-4 land.

**Files:** none modified.

- [ ] **Step 1: Confirm conflicts and override still work**

Assign a vehicle and driver already committed to an overlapping trip:
- The server answers 409 and `ConflictBlock` lists the reasons.
- **Override & Assign** appears and completes the assignment.
- The dispatch timeline records the override.

Restricting the list to pairs does not reduce conflicts — double-booking, expired license, expired registration, maintenance, and capacity are a separate axis and must all still fire.

- [ ] **Step 2: Confirm the custodial pairing is untouched**

After a trip assigned through the escape hatch, open both the driver's and the vehicle's detail pages. The pairing card shows the original custodian, the same `Since` date, and no new history row. If a new row appeared, the escape hatch wrote to `driver_vehicle_assignments` and Task 2 is wrong.

- [ ] **Step 3: Confirm the dialog reseeds per request**

Open Assign on request A, select a pair, cancel. Open request B. The field shows B's own assignment or an empty placeholder — never A's selection. This is the `key={request.request_id}` remount at line 272 doing its job.

- [ ] **Step 4: Run the existing server verification**

```bash
node --import ./scripts/route-harness-loader.mjs scripts/verify-driver-assignments.mjs
```

Expected: passes exactly as before. The submitted payload is unchanged, so this coverage should be unaffected. A failure here means something outside this file was touched.

- [ ] **Step 5: Final lint**

```bash
npx eslint src/components/reservations/assign-dialog.jsx
```

Expected: clean.
