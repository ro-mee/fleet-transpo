# Driver Type Classification & Removal of Initial Duty Status Design Spec

## 1. Overview
Currently, the "Add Driver" onboarding page (`/drivers/new`) contains an "Initial Duty Status" dropdown allowing staff to set the new driver's status to `Available`, `On Trip`, `Off Duty`, `On Leave`, or `Suspended`. In fleet operations, newly created driver accounts should always start with the default status of `Available` (ready for assignment) rather than setting duty statuses during registration.

Furthermore, with fleet operations divided into **Passenger** and **Cargo Logistics** workflows (matching vehicle `operational_use`), dispatchers and fleet administrators need to classify each driver as either a **Passenger Driver** or a **Cargo Logistics Driver** upon registration and be able to manage this classification.

This document specifies the removal of "Initial Duty Status" from the driver registration form, the introduction of the `driver_type` classification across driver onboarding, editing, directory listing, and details, and the database & API schema changes required.

---

## 2. Requirements & User Stories

### User Story 1: Register Driver with Driver Type
- As a fleet manager registering a new driver (`/drivers/new`),
- I should **not** see an "Initial Duty Status" field because the driver will automatically default to `Available`.
- I should be able to select the driver's **Driver Type / Classification**:
  - `Passenger` (Passenger Driver: Guest & VIP transport)
  - `Cargo` (Cargo Logistics Driver: Hotel & Restaurant supply/deliveries)
- The form should default to `Passenger`.

### User Story 2: Update Driver Type
- As a fleet manager editing an existing driver (`/drivers/[id]/edit`),
- I should be able to update the driver's `driver_type` between `Passenger` and `Cargo`.

### User Story 3: View Driver Type in Directory & Profile
- As a dispatcher or manager viewing the driver directory (`/drivers`),
- I should clearly see each driver's classification badge (`Passenger Driver` or `Cargo Logistics Driver`) alongside their profile details.
- As a dispatcher or manager viewing the driver profile (`/drivers/[id]`),
- I should see the `driver_type` in the driver's overview details.

---

## 3. Architecture & Technical Design

### 3.1 Database Layer (`drivers` Table)
1. Add column `driver_type VARCHAR(50) DEFAULT 'Passenger' NOT NULL` to the `drivers` table with a check constraint:
   ```sql
   ALTER TABLE drivers ADD COLUMN IF NOT EXISTS driver_type VARCHAR(50) DEFAULT 'Passenger';
   -- Check constraint ensuring valid values:
   DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'chk_driver_type'
     ) THEN
       ALTER TABLE drivers ADD CONSTRAINT chk_driver_type CHECK (driver_type IN ('Passenger', 'Cargo'));
     END IF;
   END $$;
   ```
2. Update `ensureDriverColumnsExist()` in `src/app/api/drivers/route.js` to ensure `driver_type` is added idempotently if missing.
3. Update migrations / documentation accordingly.

### 3.2 Validation Schemas (`src/lib/validation/schemas.js`)
- In `driverSchema` and `driverEditSchema`:
  - `driver_type`: `z.enum(["Passenger", "Cargo"]).default("Passenger")`
  - `driver_status`: Retain `.default("Available")` so any call without an explicit status defaults cleanly to "Available".

### 3.3 Backend API Endpoints

#### `POST /api/drivers` (`src/app/api/drivers/route.js`)
- Accept `driver_type` from request body (defaults to `'Passenger'`).
- Set `driver_status` default to `'Available'`.
- Insert `driver_type` into `drivers` table:
  ```sql
  INSERT INTO drivers (..., driver_type, driver_status, ...)
  VALUES (..., $19, $20, ...)
  ```
- Return `driver_type` in response projection.

#### `GET /api/drivers` and `GET /api/drivers/[id]`
- Project `d.driver_type` in SQL query and select lists.

#### `PUT /api/drivers/[id]` (`src/app/api/drivers/[id]/route.js`)
- Support updating `driver_type` when provided.
- Persist `driver_type` to `drivers` table.

### 3.4 Frontend Components & Pages

#### 1. Add Driver Page (`src/app/(dashboard)/drivers/new/page.js`)
- **Remove:** The `driver_status` "Initial Duty Status" `<Controller>` dropdown.
- **Card 2 Header:** Rename title from `"Driver's License & Duty Status"` to `"Driver's License & Classification"`.
- **Add:** FloatingSelect `<Controller>` for `driver_type`:
  ```jsx
  <Controller
    control={form.control}
    name="driver_type"
    render={({ field }) => (
      <FloatingSelect
        label="Driver Classification"
        icon={Briefcase}
        id="driver_type"
        value={field.value}
        onValueChange={field.onChange}
        error={form.formState.errors.driver_type?.message}
      >
        <SelectItem value="Passenger">Passenger Driver (Guest & VIP Transport)</SelectItem>
        <SelectItem value="Cargo">Cargo Logistics Driver (Supply & Deliveries)</SelectItem>
      </FloatingSelect>
    )}
  />
  ```
- Form default values: `{ ... driver_type: "Passenger", driver_status: "Available" }`.

#### 2. Edit Driver Page (`src/app/(dashboard)/drivers/[id]/edit/page.js`)
- **Card 2 Header:** Rename to `"Driver's License & Classification"`.
- **Add:** FloatingSelect `<Controller>` for `driver_type`, seeded from `driver.driver_type || "Passenger"`.
- Include `driver_type` in `onSubmit` payload.

#### 3. Drivers Directory Page (`src/app/(dashboard)/drivers/page.js`)
- In `columns`:
  - Under Driver Name or in a dedicated badge column, display a themed badge:
    - `Passenger`: Blue badge with tag `Passenger Driver`
    - `Cargo`: Amber/violet badge with tag `Cargo Logistics Driver`
  - Include `driver_type` in CSV export options.

#### 4. Driver Details Page (`src/app/(dashboard)/drivers/[id]/page.js`)
- In the Personal Information or Credentials section, render a row for:
  - **Classification**: `Passenger Driver` or `Cargo Logistics Driver` with appropriate badge/styling.

---

## 4. Error Handling & Edge Cases
- **Legacy Records:** Existing drivers without `driver_type` in the database will be treated as `'Passenger'` via `COALESCE(d.driver_type, 'Passenger')` and the column default.
- **Validation:** Only `'Passenger'` and `'Cargo'` are permitted values. Any other string fails client-side zod schema and server-side validation.
- **Duty Status:** Omission of `driver_status` on create safely falls back to `'Available'`.

---

## 5. Testing & Verification Plan
1. **Database & API Verification:**
   - Verify `driver_type` column is created in PostgreSQL with check constraint.
   - Verify `POST /api/drivers` creates a driver with `driver_type = 'Cargo'` and `driver_status = 'Available'`.
   - Verify `PUT /api/drivers/[id]` updates `driver_type`.
2. **UI Verification:**
   - Check `/drivers/new`: confirm "Initial Duty Status" is absent, "Driver Classification" dropdown is present with Passenger and Cargo options.
   - Check `/drivers/[id]/edit`: confirm Driver Classification dropdown appears and populates with current value.
   - Check `/drivers`: confirm Driver Type badge renders in directory.
   - Check `/drivers/[id]`: confirm Driver Type displays in overview.
3. **Automated Tests & Linting:**
   - Run relevant test suites and eslint to ensure zero regressions.
