# Driver Address Verification Runbook

**Status: partly verified.** Steps 5–8 were run against the running app on 2026-09-25 and every
one passed as expected — recorded in `Capstone/07 - Development/Bugs.md`. **Steps 1–4 and 9–11
are still owed** — with the caveat that three of step 11's four states are unreachable with
the data that exists, measured rather than assumed; see section D. The automated layer is green.
Before that pass nothing here had been exercised
in a browser since the 2026-09-24 attempt failed at step 1 and produced the fix in Bugs.md,
"Address B must never be submitted with Latitude A".

This is the procedure for task #27. It replaces the four-step version embedded in
`Capstone/10 - Project Journal/Daily Notes/2026-09-24.md:224` — that list is still the spine
of steps 1–4 below, but it predates the atomic `POST`, the pre-fill loader, the discard prompt
and the pin notice, so it no longer covers what this migration can now get wrong.

## Why a runbook and not more tests

The route tests double `saveAddress` and the PSGC resolver. That is the right choice — it is
what lets them assert control flow without a database — but it means **no test in this repo
shows a driver row reaching Postgres, a pin landing as a real coordinate pair, or
`/drivers/<id>` rendering.** "The route tests are green" and "the feature works" are two
different claims, and only one of them has been checked.

The database half of that gap is closed by `scripts/verify-driver-addresses.mjs`. The half
that needs a person — the cascade interaction, the dialog's exit paths, the rendered page —
is this document.

## Before you start

**Step 1 writes to the live database.** It creates an employee, a driver and two `addresses`
rows in the project the app actually uses (`dnxuphhxlzidvwtdqqkq`, db `postgres`). There is no
scratch database and no clean undo: the employee and driver can be soft-deleted, but
`addresses` rows are append-only by design and are never edited. Confirm you want that before
running it, and prefer a driver you would not mind existing.

**Restart the dev server first.** A route directory added while the server is running is never
registered, and the symptom is an **HTML 404 body** — not a JSON error from a handler. The
2026-09-24 pass lost time to exactly this: `PUT /api/drivers/59/account` 404'd, and it was not
a code defect. If a request 404s with an HTML body, restart before reading the handler.

**Stop the dev server before any `npm run build`.** The worker pool OOMs with it running
(task #17).

Everything below except step 1 is read-only — **provided every picker is closed with Discard.**
Two steps write if it is not: step 6's round trip and step 9's save. Both are called out where
they occur.

## The automated layer — already green, re-run if you have touched the code

| Gate | Command | Last result |
|---|---|---|
| Address suites | `npx vitest run --no-file-parallelism src/lib/address/structured.test.js src/lib/address/validate-structured.test.js src/services/address.service.test.js "src/app/api/drivers/route.test.js" "src/app/api/drivers/[id]/route.test.js" "src/app/api/locations/[id]/route.test.js"` | 147 passed, 4 files |
| Lint | `npx eslint` on the changed files | clean |
| Build | `CIRCLE_NODE_TOTAL=2 npm run build` | compiled in 42s, 212/212 pages |

`CIRCLE_NODE_TOTAL=2` is not cargo cult: a bare build panicked with `os error 1450` under
Turbopack, and halving the worker count cleared it. If the suite aborts with a heap error
rather than a test failure, that is the OOM, not a red test.

---

## A. The migration's own claims — steps 1–4

### 1. Create the driver — the only writing step

At `/drivers/new`:

- Pick **both** addresses through the cascade — residential and emergency contact.
- Drop a **pin** on the residential one.
- Submit.

Do the cascade first, then the detail fields, then the pin. That is the only order that works
today, and step 7 is why.

### 2. The database half

```
npm run verify:driver-addresses -- --latest
```

Pass `--driver=<id>` if you know the id; do **not** read a number off the list UI — it shows row
positions, not primary keys, and that mistake has already cost one run.

**`--latest` means newest, not newest-of-this-pass.** It resolves the highest `driver_id`, which
is the driver you just made *only if you made one*. Run it without creating a driver first and it
silently targets whatever the newest row happens to be — and a failed pass writes nothing, so the
old row stays newest. The FAILs then read like a regression when they are a baseline.

**Read the resolved line before the verdicts.** It prints the row it chose and when that row was
written:

```
--latest resolved to driver_id 59 (created 2026-09-25T01:52:02.669Z).
If that is not the driver you just created, re-run with --driver=<id>.
```

Compare that instant against when the change you are testing landed:

```
git log -1 --format='%ad' --date=iso <sha>
```

Measured 2026-09-25: a run resolved to driver 59 at `created 2026-09-25T01:52:02.669Z` (+0800
that is 09:52), while the two fixes under test had landed at **11:36** — an hour and forty-four
minutes *after* the row was written. Four checks failed, and all four were the two
already-documented defects: the emergency pick lost client-side, and the pin lost before submit.
None was new. **A row older than the fix cannot confirm or refute the fix** — it only re-measures
the bug that produced it.

That run was still worth something, and the distinction is the point: the residential row passed
everything the migration stores — the PSGC fingerprint, the ZIP and its `manual` source, the
composed `formatted_address`, the mirror into `drivers.address` — and failed only on the pin.
Storage worked before the fixes; what was being lost was client-side.

If you meant to verify a specific row rather than the newest, pass `--driver=<id>` and say so in
what you write up. `--latest` is a convenience for the common case, not a statement about which
row you tested.

Add `--pin=no` if you deliberately dropped no pin. Add `--quiet` if the output is going
anywhere but your terminal — see the privacy note below.

**What must PASS**, and why each one is not padding:

| Check | What a failure means |
|---|---|
| both ids set, distinct, resolvable | the partial success the atomic `POST` removed — an operator who picked two addresses must not end up with a driver holding NULL |
| both rows: `provider='manual'`, `verified=false` | a dropped pin is an operator's claim about where a door is, not a provider verification |
| both rows: `psgc_barangay_code` set | the cascade's fingerprint. NULL means the address arrived as free text, which would make every other PASS here misleading |
| both rows: ZIP present, `postal_code_source='manual'` | the source column is what distinguishes a typed ZIP from a provider's |
| residential: a real lat/lng pair | the first live exercise of `chk_addresses_coords_pair`'s both-present branch — every row written before this migration is NULL/NULL, because the location and hotel dialogs pass `showPinMap={false}` |
| `drivers.address` = the row's `formatted_address` | the mirror. If it drifts, the page shows one place while the registry points at another |

Exit codes: **0** every check passed, **1** at least one failed, **3** the script could not run
(usually a missing `DATABASE_URL`).

### 3. The detail page renders

Open `/drivers/<id>`. Both addresses should render. This should be unchanged — the text
columns are mirrored, which is what keeps every pre-existing reader working — but "should be
unchanged" is a prediction, and this step is what tests it.

### 4. Rename only — the omitted-field rule

Edit that driver and change **only the name**. Do not open the pickers. Save.

Then re-run step 2 and compare the **fingerprint line** at the end of the output: same two
address ids, same `created_at` on both rows. It must be byte-identical.

- A **different id** means a new registry row was appended — the omitted-vs-empty rule
  leaking, turning a rename into a re-pick.
- A **different `created_at`** would mean a row was rewritten, which the registry never does.

`--latest` is safe for this comparison because renaming does not create a driver.

---

## B. The 2026-09-25 fixes — steps 5–8

Both halves of Bugs.md "two ways the address form discards work without saying so" are fixed
with their browser check owed. These are that check.

### 5. The discard prompt

Open `/drivers/<id>/edit` and open the residential picker. Change **nothing**, then close it —
try each exit in turn: Cancel, Escape, the backdrop, the X.

**Expected: no prompt, every time.** The picker compares the working value against the seed
field by field, so a form nobody touched is not a form with unsaved work. An `initialValue`
arriving short an optional text field must not trip it either — blank, `null` and a missing
key all mean "no value here".

Now change something and close.

**Expected: a prompt, every time.** All four exits funnel through one confirm.

Then a third case: change something and **submit**. **Expected: no prompt** — a successful
save never prompts, because the picker closes the dialog itself after handing the value up.
A submit in flight should refuse the close rather than strand its result.

### 6. Pre-fill on an existing address

Still on `/drivers/<id>/edit`, re-open the residential picker for the driver whose address was
captured through the cascade in the 2026-09-24 pass (`addresses` row 4, driver 59).

**Expected:** the cascade shows the stored region/province/city/barangay — Caloocan with
**no province line** — and the detail fields are populated.

**The pin, on this row, is correctly absent.** Driver 59's `latitude`/`longitude` are NULL — row 4
is the very row whose missing pin produced the 2026-09-25 report — so an empty map here is the
right answer, not a regression. On a row that does have a pin, expect to find it where it was
placed.

**The round-trip half writes** — it is one of two writes in sections B and C, step 9's save
being the other. Change exactly
**one** detail field, save, reload, re-open — every other field must have survived, and
`drivers.address` must equal the new row's `formatted_address`. Expect the save to add a **new**
`addresses` row and move `drivers.address_id` off 4: `saveAddress` always inserts and repoints,
and the registry is append-only by design. If this pass needs to stay read-only, close with
Discard after the pre-fill check and skip the round trip — say which you did when you write it up,
because a moved `address_id` changes the fingerprint in step 2.

This is the check that closes the gap recorded in
`Capstone/03 - Database/Tables/addresses.md`: the picker used to open blank because
`GET /api/locations` returned an `address_id` with no detail behind it.

### 7. The pin-clearing notice

With the picker open, drop a pin, then edit a street detail field or re-select the barangay.

**Expected:** the pin is **cleared** — that rule is required and stays, since Address B must
never be submitted with Latitude A — and a notice beside the map says so.

This is the defect's real shape: the pin survives only if it is the **last** action on the
form. The rule was never the bug; the invisibility was. Confirm the notice appears here and
does **not** appear when you use the explicit "Clear pin" button — warning someone about the
thing they just asked for is noise — and does not appear when you change the address *type*,
which does not move the address and keeps the pin.

### 8. The empty pin reads as empty

Open a picker with **no** pin placed.

**Expected:** the map opens at country zoom over the Philippines, **no marker**, no "Clear
pin" button, and the line reads *"Click the map to drop a pin. The address saves without one."*

A marker in the Gulf of Guinea at zoom 16, a "Pin at 0.00000, 0.00000" line, or an offered
"Clear pin" button all mean the `Number(null) === 0` defect has returned. Confirm too that the
map does **not** capture the page scroll until you press **"Enable wheel zoom"** — the wheel
is handed over on request, not on focus, because a wheel-capturing map traps the page scroll
mid-form.

---

## C. The other surfaces — steps 9–10

The driver surface is the one with the pin and the two addresses; these two share the same
dialog and the same loader, and neither has been opened in a browser either.

### 9. Locations — `/routes/locations`

Open a row with an `address_id` and re-open its picker.

**Expected:** pre-filled the same way as step 6. Three of the eleven locations are linked and
those are the candidates here; the other eight are legacy, which is step 11's subject. The
button reads **"Replace address"** on any row with an address and **"Pick address"** on one
without, which tells you which you are looking at before you open anything.

**This surface loads its detail lazily, and the second argument of
`useStructuredAddress(location_id, pickOpen)` is `enabled` — nothing is fetched until the dialog
opens.** Two consequences, both of which read as defects if you are not expecting them:

- **On the first open the cascade paints blank and then fills**, because `initialValue` is
  `undefined` until the fetch resolves and the dialog re-seeds during render. A brief blank is
  the fetch; a blank that stays blank is the bug.
- **The "Saved as a structured address" line appears only *after* that first open**, since it
  renders on `savedAddress`, which is `undefined` while the hook is disabled. So **absence of the
  line on an unopened form is not evidence that a row is legacy** — judge legacy only by whether
  the picker comes back blank.

**Saving here writes**, making it the second of sections B and C's two writes. Changing a field
and saving appends a new `addresses` row and moves `locations.address_id` — the same
append-and-repoint as step 6 — and takes `addr_total` from 4 to 5, so section D's counts stop
matching. Close with **Discard** to keep this step read-only. A save that does land replaces the
muted line with the green one:

> Picked from the Philippine address cascade. Saving replaces this location's stored address.

Note what this route carries: `GET /api/locations/[id]` gained `structured_address`, and it is
the route the hotel base reads **through**, while gated on `settings: read` rather than the
route's own `routes: read`. That reuse is safe only while every role holding `settings: read`
also holds `routes: read` — true today (only `admin` and `super_admin`, and `admin` holds
both). It is a dependency, not a coincidence, and a test now pins it.

### 10. Hotel base — `/settings/general`

Same expectation as step 9, sourced from `settings.location_id` — the same lazy first-open
blank, the same deferred hint line, the same write if you save, and one differing phrase:

> Picked from the Philippine address cascade. Saving replaces the hotel base address.

Whether the hotel base is one of the three linked rows is not known without opening it; the
first open tells you. This is the cross-resource read named above; if it breaks while the
locations page works, the permission matrix moved, not the address code.

---

## D. The boundary — step 11

### 11. A legacy address still refuses — and the reachable case is silent

**Measured 2026-09-25** (`scratch/probe-addresses.mjs`, counts only, no row contents): of the
4 `addresses` rows, **0** has a NULL `psgc_barangay_code`. **55 of 56 drivers** and **8 of 11
locations** have a NULL `address_id`, and 4 of those 8 locations carry display text.

That matters, because the four states resolve to five screens and only one of them is
reachable:

| Referrer state | Reason | What the screen shows |
|---|---|---|
| `address_id` NULL, text present | `no-address-id` | stored text read-only, **no reason line** |
| `address_id` NULL, no text | `no-address-id` | empty field, **no reason line** |
| `address_id` set, row's code NULL | `no-psgc-code` | "Saved before the address cascade existed…" |
| `address_id` set, code no longer resolves | `unknown-barangay` | "The barangay it was saved with is no longer…" |
| the read itself failed | `unavailable` | "The saved address could not be loaded just now…" |

**The reachable case is the one that says nothing, and that is correct.** `no-address-id` is
deliberately absent from `PREFILL_REASON_MESSAGES` — there is no failure to explain — and a
test asserts the key stays out. A row that never had a structured address has not been
refused by anything.

**What to actually do.** Open `/drivers/<id>/edit` for **any driver other than 59** — 55 of 56
are legacy, so almost any row will do — and open the residential picker. Expect it **blank**,
the stored text still shown, and **no reason line**. Then repeat on a legacy locations row;
four of the eight show text, four show an empty field, and neither shows a reason.

**A reason line on either of those screens is the bug.** Absence is the expected result, which
is the reverse of what this step said before it was measured.

**The other three reasons cannot be reached without writing.** `no-psgc-code` needs an
`addresses` row with a NULL code and none exists; `unknown-barangay` needs a stored code that
no longer resolves; `unavailable` needs a read that fails. Those paths are covered by
`structured.test.js` at the unit level and **not exercised in a browser** — this step should
not pretend otherwise. Reaching them for real means inserting an `addresses` row in a state no
operator can produce, into the live project, where `addresses` is append-only. Ask first and
say what it is for; it is not implied by "run the runbook".

**Reconstructing a barangay from stored text is the one thing this design refuses**, and it is
the reason the gap existed. If a legacy row ever opens pre-filled, that refusal has been
crossed and the fix is a regression, not a feature.

---

## Reading the output — and where it may not go

**The verifier prints a real person's home address.** That is deliberate: the operator has to
confirm the stored place is the one they picked. It also means the output **must not be pasted
into the Capstone vault, a report, or any committed file.** Use `--quiet` whenever the output
leaves your terminal.

**`--quiet` was broken, and the direction of the break is worth keeping.** Until 2026-09-25 it
suppressed the stored-rows block and the warning, then printed the address anyway — twice —
inside the PASS detail strings, because the report loop appended every check's detail
unconditionally. The script's own header promised "verdicts only, no values", and the first
version of this note repeated that promise without reading the loop that implements it. Following
it would have put a real home address into whatever the output was pasted into.

It is fixed by marking the three checks whose detail quotes a stored column (`sensitive: true`)
and withholding those under `--quiet`, printing `(withheld: --quiet)` in their place. Ids, PSGC
codes, `manual` sources and booleans still print — none is personal, and they are most of what
makes a failed run diagnosable from its output alone. **A new check that echoes a stored column
must be marked**, or the flag quietly stops meaning what it says.

The script is read-only by construction — every statement is a `SELECT` on `drivers`,
`employees` and `addresses`, there is no DML or DDL in the file, and it never prints a
credential or connection string. It deliberately does not `SELECT *`: `raw_input`, the most
sensitive column on that table, is left out rather than fetched and discarded.

## What this runbook cannot cover

- **Anything about a database other than live.** Every check reads the project the app uses.
- **The geocoder path.** The TomTom provider layer is unreferenced and stays unmounted; every
  address here is `provider = 'manual'`. Centring the pin map on an entered address is blocked
  on the same portal permission (tasks #29, #31).
- **That a rebuilt database matches.** That is migration `130_ledger_gap_reconstruction.sql`'s
  claim, verified by `npm run db:dump` producing an empty diff — not by anything in a browser.

## Recording the result

If every step passes, task #27 closes and the "browser check owed" notes in
`Capstone/07 - Development/Bugs.md` can be marked done, citing this run. If a step fails, it
goes in the same file as an entry with the **observed** behaviour, the **expected** behaviour,
and the stored row that separates them — which is how the 2026-09-25 pair was split into two
defects with different mechanisms and different fixes.
