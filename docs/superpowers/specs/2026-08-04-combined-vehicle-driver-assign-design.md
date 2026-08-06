# Combined Vehicle + Driver Selection in the Assign Dialog

**Date:** 2026-08-04
**Status:** Approved, ready for implementation planning
**Affects:** `src/components/reservations/assign-dialog.jsx` (only)

## Problem

The Assign Resources dialog presents two dropdowns, Vehicle and Driver, linked by
the custodial pairing from migration 017. Choosing one auto-fills the other via
`pickVehicle` / `pickDriver` and an `autoFilled` state flag that tracks which side
was filled in by the dialog rather than chosen by the dispatcher.

The result states the same fact three times. The vehicle option already reads
`ABC 1454 · 2 seats · SVJ · driver: joseph lims`; the Driver field then shows a
name; a warning box below explains how the two relate. The auto-fill machinery
exists only to paper over a problem the two-field layout created.

## Two histories that already exist

This design depends on a distinction the database already draws, and changes
neither side of it.

| | Answers | Table |
|---|---|---|
| **Custodial** | who is permanently responsible for this vehicle | `driver_vehicle_assignments` (017) |
| **Usage** | who actually drove it on a given day | `trips` (001) |

`trips` has carried `vehicle_id`, `driver_id`, `start_time`, and `end_time` since
migration 001. A one-off substitution therefore needs no new storage and must not
touch custody: the trip row is already the record of who drove what, and when.

This is why the dialog must be able to express a substitution directly. The only
alternative — re-pairing the vehicle on its detail page — ends one custody
interval and opens another, writing a permanent handover that never happened.

## Decisions

1. **One combined dropdown** listing vehicle + driver custodial pairs, with a
   collapsed **"Use a different driver"** escape hatch for substitutions.
2. **Permanent re-pairing happens elsewhere.** The existing pairing card
   (`src/components/drivers/assigned-vehicle-card.jsx`) handles assign, release,
   history, and 409 force-displace. No new module is built here, and the escape
   hatch never writes to `driver_vehicle_assignments`.
3. **Available vehicles with no active pairing are hidden**, with a footnote
   stating how many were omitted. Operationally every vehicle is expected to be
   paired, so this should approach zero.
4. **A pre-existing assignment that is not a pair is pinned** at the top of the
   list, tagged as current, and remains selectable.

## Approach

**Chosen: client-side join.** The three queries the dialog already runs supply
everything needed. One `useMemo` joins them into pair options. No new endpoint,
no server change, no migration.

**Rejected: a `/api/assignable-pairs` endpoint.** Would duplicate the availability
logic that already lives in `vehicle.service` and `driver.service`, creating two
places to break when "available" changes meaning.

**Rejected: an `assignable=1` filter on `getDriverAssignments`.** Would teach an
endpoint about vehicle status and driver duty when it should only know custodial
history, blurring a boundary migration 017 draws deliberately.

## Detailed design

### State

Three state values (`vehicleId`, `driverId`, `autoFilled`) are replaced by three
with clearer roles:

```
selection       string   // "<vehicleId>:<driverId>" — the pair chosen
driverOverride  string   // "" follows the pair; otherwise a driver_id
showOverride    boolean  // whether the driver picker is revealed
```

The effective driver is `driverOverride` when set, otherwise the pair's driver.

Seeded from `request.vehicle_id` / `request.driver_id` by the `useState`
initializer. The form remains keyed by `request.request_id` so a remount reseeds
it; syncing with an effect is deliberately avoided
(`react-hooks/set-state-in-effect`).

### Building the options

One `useMemo` over the three existing query results. Keep each active pairing
whose **vehicle** appears in the available-vehicles list. Driver availability does
**not** filter the list — it is recorded as a flag:

```
value:          `${vehicle_id}:${driver_id}`
driverAvailable boolean   // driver present in the available-drivers list
label:          `${plate_number}${seats}${model} · ${driverName}`
                 when driverAvailable
                `${plate_number}${seats}${model} · driver needed`
                 when not
```

The off-duty label states what the dispatcher must do rather than what is wrong.
`(off duty)` placed after a person's name inside a vehicle-subject option can bind
to either noun, and reads at a glance as "this vehicle is unavailable" — the
opposite of the truth. `driver needed` cannot be misread that way, and it points at
the field that opens below. The custodian's name is dropped from the label because
at scan time the dispatcher is choosing a vehicle; who normally drives it stops
mattering once they are known not to be driving today. The name reappears after
selection, in the departure line, where there is room for a full sentence.

Filtering on driver availability instead would remove a perfectly available
vehicle from the dispatcher's list whenever its custodian took a day off — the
vehicle would silently disappear with no way to reach it from this screen. That
is the single most likely real-world case for a substitution, so it must remain
selectable.

Seating and model come from the vehicles list; the driver name comes from the
pairing row via the existing `personName` helper, which reads both the nested
`employees` shape and the flattened one.

Options are sorted by `plate_number` ascending so ordering is stable across
renders.

### The escape hatch

Beneath the select, a quiet text button: **Use a different driver**. It is not
shown while no option is selected.

Pressing it sets `showOverride` and reveals a driver select listing all available
drivers. Choosing one sets `driverOverride`; clearing the field returns to the
pair's own driver.

Selecting an option whose `driverAvailable` is false sets `showOverride`
automatically and leaves `driverOverride` empty, so the picker is already open and
Assign stays disabled until a driver is chosen. The dispatcher is never left
looking at a selection that cannot be submitted without knowing why.

The escape hatch writes nothing to `driver_vehicle_assignments`. It changes only
what this trip records.

**Changing the pair resets the override.** Selecting a different option clears
`driverOverride` and collapses `showOverride` (unless the new option is off duty,
which re-opens it). An override is meaningful only against the pair it departs
from; carrying it across a change would silently apply a substitute driver to a
vehicle the dispatcher never chose them for.

### The pinned current option

If `request` carries an assignment whose `"<v>:<d>"` key is not among the built
options, prepend a synthetic option with that key, labelled with a muted
`current — not paired` tag.

This covers a partial assignment too (vehicle set, driver null, or the reverse);
the absent side is left empty in the key, and the payload sends `null` for it,
which the endpoint already accepts.

An already-assigned vehicle may not appear in the available-vehicles list at all,
so its label cannot be assumed present. Resolve each side through this chain,
stopping at the first hit:

1. the available-vehicles / available-drivers list
2. the pairing rows
3. fields on `request`, if present
4. `Vehicle #<id>` / `Driver #<id>`

A label is never blank.

### Hidden-vehicle footnote

`hiddenCount` = available vehicles holding no active pairing. Derive it by
subtracting the set of vehicle ids present in the built options from the
available-vehicles list, so any future reason an option is dropped is counted
automatically rather than silently.

When greater than zero, render one muted line beneath the select stating the count
and linking to the vehicle page, where `assigned-vehicle-card.jsx` performs the
pairing:

```
2 available vehicles have no assigned driver and aren't listed.
```

When there are no options and nothing pinned, that same line carries the
explanation and the Assign button stays disabled.

### Submit

`vehicleId` comes from `selection`. `driverId` is `driverOverride` when set,
otherwise the driver encoded in `selection`. Each is `Number(...)` or `null`:

```
{ request, vehicleId, driverId, force }
```

Byte-identical in shape to what the dialog sends today, so no server change is
required.

Assign is disabled while `selection` is empty, and while the selected option has
`driverAvailable: false` with no `driverOverride` chosen.

### Departure warning

The four-branch `pairing` computation collapses to one condition: does the
effective driver differ from the selected pair's driver? When it does, a single
line renders in the existing warning styling. This covers the escape hatch, the
off-duty case, and the pinned non-pair option.

The off-duty case carries the sentence the dropdown label deliberately omits — the
custodian's name, the reason, and the reassurance that custody is untouched:

```
joseph lims is off duty. Pick a driver for this trip — the permanent
assignment doesn't change.
```

A deliberate override of an available custodian reads as a departure instead,
naming who normally drives the vehicle and stating that the assignment is recorded
rather than blocked.

### Removed

`pickVehicle`, `autoFilled`, `driverListed`, `vehicleListed`, `byDriver`, the
four-branch `pairing` computation (L120-146), and its multi-line render block
(L215-244). `pickDriver` survives in reduced form as the override setter.

## Unchanged

**ConflictBlock and Override & Assign.** Server conflicts concern time and
eligibility — double-booking, expired license, expired registration, maintenance
windows, capacity. A correctly paired vehicle and driver can still be
double-booked. Restricting the list to pairs does not reduce conflicts; it is a
different axis. The 409 path, the override button, and the timeline record are
untouched.

**The seating hint.** Same text, same `passenger_count > 1` condition. It moves
beneath the combined select because the Vehicle select no longer exists.

**The three queries.** Same keys, same cache entries, same requests. Only the
derivation changes.

**The server-side `vehicle_not_assigned_to_driver` rule.** It stays, at WARNING
severity, and the escape hatch makes it routinely reachable again — which is its
purpose. Migration 017 requires it to stay non-blocking so a driver whose paired
car is in maintenance is still dispatchable.

**`trips`, `driver_vehicle_assignments`, and every API route.** No schema change,
no new endpoint, no migration.

## Out of scope

- Any change to `assigned-vehicle-card.jsx` or the `/api/driver-assignments` routes.
- Any change to conflict rules, severities, or the dispatch endpoint.
- Surfacing per-vehicle or per-driver usage history in the UI. The data exists in
  `trips`; presenting it is a separate piece of work.
- Introducing a test framework.

## Verification

The project has no test framework: `lint` is the only script in `package.json`,
and there is no jest, vitest, or testing-library dependency. Automated unit tests
are therefore not written as part of this change.

Automated: `npx eslint` must pass.

The server contract is already covered by `scripts/verify-driver-assignments.mjs`,
and because the submitted payload is unchanged, that coverage remains valid.

Manual checks in the dev app:

1. A paired, available vehicle and driver appear as one option and assign cleanly.
2. A pairing whose driver is off duty still appears, labelled `driver needed`, and
   selecting it opens the driver picker with Assign disabled until a driver is
   chosen. The custodian's name and the reason appear below, not in the label.
3. Choosing a substitute driver shows the departure line, assigns successfully, and
   leaves the pairing on the vehicle's detail page unchanged.
4. A pairing whose vehicle is unavailable does not appear.
5. Overriding the driver, then switching to a different pair, clears the override —
   the new pair's own driver is what gets submitted.
6. The hidden count equals available vehicles minus those offered as options.
7. Reopening a request assigned to a non-pair shows it pinned at top, tagged
   current, with the departure line beneath.
8. A request that triggers a blocking conflict still shows ConflictBlock and still
   assigns via Override & Assign.
9. With no pairings at all, the select is empty, the footnote explains why, and
   Assign is disabled.
