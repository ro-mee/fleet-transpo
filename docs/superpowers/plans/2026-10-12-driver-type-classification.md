# Driver Type Classification & Removal of Initial Duty Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove "Initial Duty Status" from the Add Driver page, set default status to `Available`, and introduce `driver_type` ("Passenger" or "Cargo") across driver registration, editing, directory, details, and API.

**Architecture:** Add `driver_type` column to `drivers` table with `CHECK (driver_type IN ('Passenger', 'Cargo'))` and default `'Passenger'`. Update `driverSchema` validation, `POST /api/drivers`, `GET /api/drivers`, and `PUT /api/drivers/[id]`. Update `/drivers/new` form to remove duty status and present a driver classification selector. Update `/drivers/[id]/edit` to allow updating driver type. Add visual badges in `/drivers` directory and `/drivers/[id]` detail overview.

**Tech Stack:** Next.js (App Router), React 19, React Hook Form, Zod, PostgreSQL / `pg`, Lucide Icons, Tailwind CSS.

## Global Constraints
- Do NOT run `npm run db:up` because draft migrations 158-161 are pending and lack approval. Use idempotent `ensureDriverColumnsExist()` via `pg` in the API layer.
- Driver status must default to `'Available'` upon driver creation.
- Allowed `driver_type` values are strictly `'Passenger'` and `'Cargo'`.
- Preserve all existing validation and mandatory transaction handling in `POST /api/drivers`.

---

### Task 1: Database & API Layer for `driver_type`

**Files:**
- Modify: `src/lib/validation/schemas.js:148-215`
- Modify: `src/app/api/drivers/route.js:25-45, 60-100, 260-320, 480-520`
- Modify: `src/app/api/drivers/[id]/route.js:150-250`
- Test: `src/lib/validation/schemas.test.js` or `src/app/api/drivers/driver-type.test.js`

**Interfaces:**
- Produces: `driver_type` in `driverSchema` (`z.enum(["Passenger", "Cargo"]).default("Passenger")`)
- Produces: `d.driver_type` projected in `GET /api/drivers` and accepted in `POST /api/drivers` and `PUT /api/drivers/[id]`

- [ ] **Step 1: Write tests for driver_type validation and default duty status**

Create test verifying `driverSchema` validates `driver_type` and defaults `driver_status` to `"Available"`.

```javascript
import { describe, it, expect } from "vitest";
import { driverSchema } from "@/lib/validation/schemas";

describe("driverSchema with driver_type", () => {
  it("defaults driver_type to Passenger and driver_status to Available", () => {
    const validData = {
      first_name: "Juan",
      last_name: "Dela Cruz",
      license_number: "N01-12-345678",
      license_expiry: "2028-12-31",
      license_type: "Professional",
      license_class: "B",
      birthdate: "1990-01-01",
    };
    const parsed = driverSchema.parse(validData);
    expect(parsed.driver_type).toBe("Passenger");
    expect(parsed.driver_status).toBe("Available");
  });

  it("accepts Cargo as driver_type", () => {
    const validData = {
      first_name: "Pedro",
      last_name: "Santos",
      license_number: "N01-12-345679",
      license_expiry: "2028-12-31",
      license_type: "Professional",
      license_class: "B",
      birthdate: "1990-01-01",
      driver_type: "Cargo",
    };
    const parsed = driverSchema.parse(validData);
    expect(parsed.driver_type).toBe("Cargo");
  });

  it("rejects invalid driver_type", () => {
    const invalidData = {
      first_name: "Pedro",
      last_name: "Santos",
      license_number: "N01-12-345679",
      license_expiry: "2028-12-31",
      license_type: "Professional",
      license_class: "B",
      birthdate: "1990-01-01",
      driver_type: "Motorcycle",
    };
    expect(() => driverSchema.parse(invalidData)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/drivers/driver-type.test.js`
Expected: FAIL (driver_type not yet on schema).

- [ ] **Step 3: Update `src/lib/validation/schemas.js`**

Add `driver_type` to `driverSchema`:
```javascript
  driver_type: z.enum(["Passenger", "Cargo"]).default("Passenger"),
  driver_status: z.string().default("Available"),
```

- [ ] **Step 4: Update `src/app/api/drivers/route.js`**

1. In `ensureDriverColumnsExist()`:
```javascript
      ALTER TABLE drivers
      ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS emergency_contact_address TEXT,
      ADD COLUMN IF NOT EXISTS license_image_url TEXT,
      ADD COLUMN IF NOT EXISTS license_back_image_url TEXT,
      ADD COLUMN IF NOT EXISTS driver_type VARCHAR(50) DEFAULT 'Passenger';

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_driver_type') THEN
          ALTER TABLE drivers ADD CONSTRAINT chk_driver_type CHECK (driver_type IN ('Passenger', 'Cargo'));
        END IF;
      END $$;
```

2. In `GET`: Add `d.driver_type` to the `SELECT` projection.
3. In `POST`:
   - Extract `driver_type = "Passenger"` from `body`.
   - Validate `driver_type: { label: "Driver classification" }`.
   - In `INSERT INTO drivers`: add `driver_type` column and bind value `$19` (`driver_type || "Passenger"`).
   - In audit log `newValues`: include `driver_type`.

- [ ] **Step 5: Update `src/app/api/drivers/[id]/route.js`**

1. In `GET`: Ensure `d.driver_type` is projected in the detailed driver response.
2. In `PUT`: Allow updating `driver_type`. If present in body, validate it is `'Passenger'` or `'Cargo'` and update `drivers.driver_type = $...`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/app/api/drivers/driver-type.test.js`
Expected: PASS.

---

### Task 2: Update Add Driver (`/drivers/new`) and Edit Driver (`/drivers/[id]/edit`)

**Files:**
- Modify: `src/app/(dashboard)/drivers/new/page.js:75-100, 260-295, 470-480, 565-590`
- Modify: `src/app/(dashboard)/drivers/[id]/edit/page.js:85-110, 260-290, 550-565, 635-650`

**Interfaces:**
- Consumes: `driverSchema`, `createDriver`, `updateDriver`
- Produces: Form fields with `driver_type` selector and no "Initial Duty Status" selector.

- [ ] **Step 1: Update Add Driver Form (`src/app/(dashboard)/drivers/new/page.js`)**

1. In `form` defaultValues:
   - Add `driver_type: "Passenger"`.
   - Keep `driver_status: "Available"`.
2. In `onSubmit`:
   - Include `driver_type: data.driver_type || "Passenger"`.
   - Ensure `driver_status: "Available"`.
3. In JSX Card 2 Header:
   - Change title from:
     ```jsx
     Driver&apos;s License &amp; Duty Status
     ```
     To:
     ```jsx
     Driver&apos;s License &amp; Classification
     ```
4. In JSX Card 2 Inputs:
   - Remove the `driver_status` `<Controller>` ("Initial Duty Status").
   - Replace with the `driver_type` `<Controller>`:
     ```jsx
     <Controller
       control={form.control}
       name="driver_type"
       render={({ field }) => (
         <FloatingSelect
           label="Driver Classification"
           icon={Briefcase}
           className="md:col-span-2"
           id="driver_type"
           value={field.value}
           onValueChange={field.onChange}
           error={form.formState.errors.driver_type?.message}
         >
           <SelectItem value="Passenger">Passenger Driver (Guest &amp; VIP Transport)</SelectItem>
           <SelectItem value="Cargo">Cargo Logistics Driver (Supply &amp; Deliveries)</SelectItem>
         </FloatingSelect>
       )}
     />
     ```

- [ ] **Step 2: Update Edit Driver Form (`src/app/(dashboard)/drivers/[id]/edit/page.js`)**

1. In `form` defaultValues:
   - Add `driver_type: "Passenger"`.
2. In seeding `useEffect`:
   - Set `driver_type: driver.driver_type || "Passenger"`.
3. In `onSubmit`:
   - Include `driver_type: data.driver_type || "Passenger"`.
4. In Card 2 Header:
   - Update title to `"Driver's License & Classification"`.
5. In Card 2 Inputs:
   - Add the `driver_type` `<Controller>` matching `/drivers/new/page.js`.

- [ ] **Step 3: Verify syntax and linting**

Run: `npx eslint src/app/\(dashboard\)/drivers/new/page.js src/app/\(dashboard\)/drivers/\[id\]/edit/page.js`
Expected: 0 errors.

---

### Task 3: Update Drivers Directory (`/drivers`) & Driver Details (`/drivers/[id]`)

**Files:**
- Modify: `src/app/(dashboard)/drivers/page.js:150-170, 195-225, 270-280`
- Modify: `src/app/(dashboard)/drivers/[id]/page.js:435-465`

**Interfaces:**
- Consumes: `driver.driver_type` from `GET /api/drivers` and `GET /api/drivers/[id]`
- Produces: Visual indicators (badges/tags) for Passenger vs Cargo drivers.

- [ ] **Step 1: Update Drivers Directory (`src/app/(dashboard)/drivers/page.js`)**

1. In `name` column or adjacent:
   Render a badge for driver classification under the driver's name or as a distinct element:
   ```jsx
   <div className="flex items-center gap-2 mt-0.5">
     <span className={cn(
       "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase",
       row.driver_type === "Cargo"
         ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30"
         : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30"
     )}>
       {row.driver_type === "Cargo" ? "Cargo Logistics" : "Passenger"}
     </span>
     <span className="text-xs text-foreground-muted font-medium">• Driver</span>
   </div>
   ```
2. In `handleExport`:
   Include `{ label: "Driver Type", key: "driver_type" }` in the CSV export fields.

- [ ] **Step 2: Update Driver Details (`src/app/(dashboard)/drivers/[id]/page.js`)**

1. In the **Personal Information** or **Credentials** summary list, add a row for **Driver Classification**:
   ```jsx
   <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:px-6 hover:bg-muted/10 transition-colors">
     <span className="text-xs font-semibold text-foreground-muted flex items-center gap-2 mb-1 sm:mb-0">
       <Briefcase className="w-3.5 h-3.5" /> Driver Classification
     </span>
     <Badge variant={driver.driver_type === "Cargo" ? "warning" : "default"} className="font-bold text-xs rounded-full">
       {driver.driver_type === "Cargo" ? "Cargo Logistics Driver" : "Passenger Driver"}
     </Badge>
   </div>
   ```

- [ ] **Step 3: Verify syntax and linting**

Run: `npx eslint src/app/\(dashboard\)/drivers/page.js src/app/\(dashboard\)/drivers/\[id\]/page.js`
Expected: 0 errors.

---

### Task 4: Documentation & Vault Synchronization

**Files:**
- Modify: `Capstone/02 - Features/Driver Management.md`
- Modify: `Capstone/03 - Database/Tables/drivers.md`
- Modify: `SYSTEM.md`

- [ ] **Step 1: Update `Capstone/02 - Features/Driver Management.md`**

Document the removal of Initial Duty Status in Add Driver, defaulting to `Available`, and the addition of `driver_type` classification (`Passenger` vs `Cargo`).

- [ ] **Step 2: Update `Capstone/03 - Database/Tables/drivers.md`**

Add `driver_type VARCHAR(50) DEFAULT 'Passenger'` to the column table and document the `chk_driver_type` constraint.

- [ ] **Step 3: Update `SYSTEM.md`**

Append entry for Driver Type Classification and Initial Duty Status removal under recent changes.

- [ ] **Step 4: Run full verification suite**

Run:
```bash
npx vitest run src/app/api/drivers/driver-type.test.js
npm run lint:ci # or focused eslint
```
Expected: All checks pass.
