# Driver Information Edit and Profile Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate silent data-loss when editing driver records, enable field clearing, and bring missing database fields (Position, License Verification, Address, Birthdate, Sex, Nationality, Emergency Contact) onto web detail, web self-profile, and mobile profile screens.

**Architecture:** 
1. Fix client-side payload creation in `drivers/[id]/edit/page.js` so cleared/empty values pass as `null` rather than being dropped by falsy checks.
2. Display `Position Title` and `License Verification Status` in `drivers/[id]/page.js`.
3. Expand `GET /api/driver/me` to select and return personal information (`address`, `birthdate`, `sex`, `nationality`, `emergency_contact_*`).
4. Update web `/driver/profile` and mobile `personal.js` to render the newly exposed personal data.
5. Maintain documentation in `Capstone/02 - Features/Driver Management.md`, `Capstone/03 - Database/Tables/drivers.md`, and `SYSTEM.md`.

**Tech Stack:** Next.js 16 (App Router), React 19, React Hook Form, Zod, TanStack Query, React Native (Expo), Tailwind CSS, PostgreSQL (`pg`), Vitest.

## Global Constraints
- Preserve existing security controls, permission gates (`drivers:update`, `requireDriver`), and storage canonicalization (`toStoredMediaRef`).
- Keep license masking intact: routine responses mask the license number; explicit eye-reveal remains gated on `drivers.update`.
- Do not bypass `withTransaction` for address writes or break `validateLicenseDetails`.
- Server timezone is `Asia/Manila`.
- All tests must pass: `npx vitest run`. ESLint must be clean: `npm run lint`.

---

### Task 1: Fix Driver Edit Payload & Field Clearing in Edit Form & API

**Files:**
- Modify: `src/app/(dashboard)/drivers/[id]/edit/page.js:348-380`
- Modify: `src/app/api/drivers/[id]/route.js:225-255`
- Test: `src/app/api/drivers/[id]/route.test.js`

**Interfaces:**
- Consumes: `updateDriver(id, payload)` in `src/services/driver.service.js`
- Produces: `PUT /api/drivers/[id]` payload supporting `null` values for optional fields (`phone`, `address`, `sex`, `birthdate`, `nationality`, `emergency_contact_name`, `emergency_contact_phone`, `emergency_contact_address`).

- [ ] **Step 1: Write a failing unit test for clearing optional driver fields in `route.test.js`**

Add a test in `src/app/api/drivers/[id]/route.test.js`:
```javascript
  it("clears optional fields when null or empty strings are passed in PUT", async () => {
    const existing = {
      driver_id: DRIVER_ID,
      employee_id: 99,
      email: "driver@example.com",
      license_number: "N01-12-345678",
      license_expiry: "2030-01-01",
      license_type: "Professional",
      license_class: "B",
      license_image_url: null,
      license_back_image_url: null,
      emergency_contact_phone: "09171234567",
      nationality: "FILIPINO",
    };

    let updatedDriverPayload = null;
    let updatedEmployeePayload = null;

    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes("FROM drivers d") && sql.includes("WHERE d.driver_id = $1")) {
        return { rows: [existing] };
      }
      if (sql.includes("UPDATE drivers SET")) {
        updatedDriverPayload = { sql, params };
        return { rows: [{ driver_id: DRIVER_ID }] };
      }
      if (sql.includes("UPDATE employees SET")) {
        updatedEmployeePayload = { sql, params };
        return { rows: [{ employee_id: 99 }] };
      }
      return { rows: [] };
    });

    const req = {
      url: `http://localhost/api/drivers/${DRIVER_ID}`,
      json: async () => ({
        first_name: "Juan",
        last_name: "Dela Cruz",
        license_number: "N01-12-345678",
        license_expiry: "2030-01-01",
        license_type: "Professional",
        license_class: "B",
        emergency_contact_phone: null,
        nationality: null,
      }),
    };

    const res = await PUT(req, { params: Promise.resolve({ id: String(DRIVER_ID) }) });
    expect(res.status).toBe(200);
    expect(updatedDriverPayload).not.toBeNull();
    // Verify emergency_contact_phone and nationality are set to null in the SQL params
    expect(updatedDriverPayload.sql).toContain("emergency_contact_phone =");
    expect(updatedDriverPayload.sql).toContain("nationality =");
  });
```

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `npx vitest run src/app/api/drivers/[id]/route.test.js`

- [ ] **Step 3: Fix `onSubmit` in `src/app/(dashboard)/drivers/[id]/edit/page.js`**

Replace lines 348-379 in `src/app/(dashboard)/drivers/[id]/edit/page.js`:
```javascript
  const onSubmit = (data) => {
    const payload = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      license_number: data.license_number.trim(),
      years_of_experience: data.years_of_experience ?? 0,
      position: data.position?.trim() || "Driver",
      license_image_url: licenseImagePreview || data.license_image_url || null,
      license_back_image_url: licenseBackImagePreview || data.license_back_image_url || null,
      // Pass null when cleared so backend clears the column rather than ignoring it
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      license_expiry: data.license_expiry || null,
      license_type: data.license_type || null,
      license_class: data.license_class || null,
      sex: data.sex?.trim() || null,
      birthdate: data.birthdate || null,
      nationality: data.nationality?.trim() || null,
      emergency_contact_name: data.emergency_contact_name?.trim() || null,
      emergency_contact_phone: data.emergency_contact_phone?.trim() || null,
      address: data.address?.trim() || null,
      emergency_contact_address: data.emergency_contact_address?.trim() || null,
    };

    // If driver_status was not modified on this screen, do not send it so the
    // backend's automatic reinstatement check is not bypassed.
    if (data.driver_status && data.driver_status !== driver?.driver_status) {
      payload.driver_status = data.driver_status;
    }

    if (pickedAddress) payload.structured_address = pickedAddress;
    if (pickedEmergencyAddress) payload.emergency_structured_address = pickedEmergencyAddress;

    updateMutation.mutate(payload);
  };
```

- [ ] **Step 4: Update validation specs in `src/app/api/drivers/[id]/route.js` if needed to accept null**

Ensure `validateBody` in `PUT` handles `null` values gracefully for optional fields (`email`, `phone`, `birthdate`, `nationality`, `sex`, etc.).

- [ ] **Step 5: Run tests and verify**

Run: `npx vitest run src/app/api/drivers/[id]/route.test.js`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add src/app/\(dashboard\)/drivers/\[id\]/edit/page.js src/app/api/drivers/\[id\]/route.js src/app/api/drivers/\[id\]/route.test.js
git commit -m "fix(drivers): send null for cleared fields and avoid status override on edit"
```

---

### Task 2: Render Position Title and License Verification Status on Driver Detail Page

**Files:**
- Modify: `src/app/(dashboard)/drivers/[id]/page.js:220-275, 452-510`

**Interfaces:**
- Consumes: `driver.employees.position`, `driver.license_verified_at`, `driver.license_verified_by`, `driver.license_verification_method` from `getDriver(id)`.
- Produces: Visual indicators in the Driver Detail UI for position title and staff review status.

- [ ] **Step 1: Add Position Title to Header Identity Block**

In `src/app/(dashboard)/drivers/[id]/page.js`:
In the driver name and identity section:
```jsx
<div className="flex items-center gap-3 flex-wrap">
  <h1 className="text-3xl font-bold text-foreground tracking-tight">
    {emp.first_name} {emp.last_name}
  </h1>
  <Badge variant="outline" className="rounded-full px-3 py-0.5 text-xs font-semibold border-border/80 text-foreground-secondary">
    {emp.position || "Driver"}
  </Badge>
  <StatusBadge
    status={driver.driver_status || "Available"}
    entity="driver"
    className="rounded-full px-3.5 py-1 text-xs font-bold shadow-none border-transparent uppercase tracking-wider"
  />
</div>
```

- [ ] **Step 2: Add License Verification Card / Status Badge**

In the "License & Credentials" Card header and content:
```jsx
{/* Verification Attestation Badge */}
<div className="flex items-center gap-2">
  {driver.license_verified_at ? (
    <Badge variant="success" className="rounded-full px-2.5 py-0.5 text-[11px] font-bold flex items-center gap-1">
      <CheckCircle2 className="w-3 h-3" />
      Verified ({driver.license_verification_method === "physical_card" ? "Physical Card" : "LTO Digital ID"})
    </Badge>
  ) : (
    <Badge variant="warning" className="rounded-full px-2.5 py-0.5 text-[11px] font-bold flex items-center gap-1">
      <AlertCircle className="w-3 h-3" />
      Staff Review Required
    </Badge>
  )}
  ...
</div>
```

- [ ] **Step 3: Run ESLint to verify no lint errors**

Run: `npx eslint "src/app/(dashboard)/drivers/[id]/page.js"`
Expected: No errors

- [ ] **Step 4: Commit changes**

```bash
git add src/app/\(dashboard\)/drivers/\[id\]/page.js
git commit -m "feat(drivers): display position title and license verification status on detail page"
```

---

### Task 3: Expose Personal Details in `GET /api/driver/me` and Web Driver Profile

**Files:**
- Modify: `src/app/api/driver/me/route.js:49-65, 150-195`
- Modify: `src/app/(dashboard)/driver/profile/page.js:250-280`
- Create: `src/app/api/driver/me/route.test.js`

**Interfaces:**
- Consumes: `drivers` row (`address`, `birthdate`, `sex`, `nationality`, `emergency_contact_*`)
- Produces: `GET /api/driver/me` JSON response containing `personal: { address, sex, birthdate, nationality, emergencyContact: { name, phone, address } }`

- [ ] **Step 1: Write a unit test for `GET /api/driver/me` returning personal fields**

Create `src/app/api/driver/me/route.test.js`:
```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/drivers/media", () => ({
  signDriverMedia: vi.fn(async (row) => row),
  toStoredMediaRef: vi.fn((v) => v),
}));
vi.mock("@/services/status.service", () => ({ syncDriverStatus: vi.fn() }));

import { GET } from "./route";
import * as db from "@/lib/db";

describe("GET /api/driver/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns full personal details including address and emergency contact", async () => {
    const mockDriver = {
      employee_id: 10,
      email: "driver@fleetops.ph",
      first_name: "Threestan",
      last_name: "Bingona",
      phone: "09560344827",
      avatar_url: null,
      position: "Driver",
      driver_id: 59,
      driver_status: "Available",
      license_number: "A01-23-424229",
      license_type: "Professional",
      license_class: "B",
      license_expiry: "2029-09-25",
      years_of_experience: 4,
      face_image_url: null,
      license_image_url: null,
      license_back_image_url: null,
      address: "29 Ninang Virginia, Caloocan",
      sex: "M",
      birthdate: "2005-01-03",
      nationality: "FILIPINO",
      emergency_contact_name: "Maricel Bingona",
      emergency_contact_phone: "09245631640",
      emergency_contact_address: "Caloocan",
    };

    db.query.mockImplementation(async (sql) => {
      if (sql.includes("FROM employees e")) {
        return { rows: [mockDriver] };
      }
      return { rows: [] };
    });

    const req = {
      url: "http://localhost/api/driver/me",
      headers: new Headers({
        "x-test-user": JSON.stringify({ employeeId: 10, role: "driver" }),
      }),
    };

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.address).toBe("29 Ninang Virginia, Caloocan");
    expect(body.data.emergencyContact.name).toBe("Maricel Bingona");
    expect(body.data.birthdate).toBe("2005-01-03");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/driver/me/route.test.js`
Expected: FAIL (missing fields in response)

- [ ] **Step 3: Update `src/app/api/driver/me/route.js`**

Update query (lines 49-60) to select personal fields:
```sql
SELECT e.employee_id, e.email, e.first_name, e.last_name, e.phone, e.position, e.avatar_url,
       d.driver_id, d.driver_status, d.license_number, d.license_type,
       d.license_class, d.license_expiry, d.years_of_experience,
       d.face_image_url, d.license_image_url, d.license_back_image_url,
       d.address, d.sex, d.birthdate, d.nationality,
       d.emergency_contact_name, d.emergency_contact_phone, d.emergency_contact_address
  FROM employees e
  JOIN drivers d ON d.employee_id = e.employee_id AND d.deleted_at IS NULL
 WHERE e.employee_id = $1 AND e.deleted_at IS NULL
 LIMIT 1
```

And in `return ok({ ... })`:
```javascript
      position: driver.position || "Driver",
      address: driver.address || null,
      sex: driver.sex || null,
      birthdate: driver.birthdate || null,
      nationality: driver.nationality || null,
      emergencyContact: {
        name: driver.emergency_contact_name || null,
        phone: driver.emergency_contact_phone || null,
        address: driver.emergency_contact_address || null,
      },
```

- [ ] **Step 4: Update Web Driver Profile (`src/app/(dashboard)/driver/profile/page.js`)**

Render Address, Birthdate, Nationality, and Emergency Contact in the Contact/Personal section of the driver self-service page.

- [ ] **Step 5: Run tests and verify**

Run: `npx vitest run src/app/api/driver/me/route.test.js`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add src/app/api/driver/me/route.js src/app/api/driver/me/route.test.js src/app/\(dashboard\)/driver/profile/page.js
git commit -m "feat(driver-profile): expose address, birthdate, and emergency contact in /api/driver/me"
```

---

### Task 4: Display Stored Personal Information in Mobile Driver Profile

**Files:**
- Modify: `mobile/app/(app)/profile/personal.js:80-160`

**Interfaces:**
- Consumes: `profile.address`, `profile.birthdate`, `profile.sex`, `profile.nationality`, `profile.emergencyContact` from `useDriverProfile()`.
- Produces: Visual InfoRows in the Mobile Personal Information screen.

- [ ] **Step 1: Add Personal Details and Emergency Contact Section to `personal.js`**

In `mobile/app/(app)/profile/personal.js`:
Add InfoRows for:
- Birthdate (`profile?.birthdate`)
- Sex (`profile?.sex === 'M' ? 'Male' : profile?.sex === 'F' ? 'Female' : profile?.sex`)
- Nationality (`profile?.nationality || 'Filipino'`)
- Residential Address (`profile?.address`)

And an "Emergency Contact" Card:
```jsx
{profile?.emergencyContact?.name && (
  <ClayCard variant="standard" style={styles.sectionCard}>
    <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Emergency Contact</Text>
    <InfoRow label="Contact Name" value={profile.emergencyContact.name} colors={colors} isDark={isDark} />
    <InfoRow label="Phone Number" value={profile.emergencyContact.phone} colors={colors} isDark={isDark} />
    <InfoRow label="Address" value={profile.emergencyContact.address} colors={colors} isDark={isDark} isLast />
  </ClayCard>
)}
```

- [ ] **Step 2: Verify mobile tests and syntax**

Run: `npx vitest run mobile/lib/` or relevant mobile test suite.
Expected: PASS

- [ ] **Step 3: Commit changes**

```bash
git add mobile/app/\(app\)/profile/personal.js
git commit -m "feat(mobile): display stored address, birthdate, and emergency contact in mobile personal info"
```

---

### Task 5: End-to-End Verification & Documentation Sync

**Files:**
- Modify: `Capstone/02 - Features/Driver Management.md`
- Modify: `Capstone/03 - Database/Tables/drivers.md`
- Modify: `SYSTEM.md`

- [ ] **Step 1: Run comprehensive tests across the project**

Run: `npx vitest run`
Expected: All suites green.

- [ ] **Step 2: Run linter and route auth verification**

Run: `npm run lint`
Run: `npm run verify:auth`

- [ ] **Step 3: Update documentation in Capstone and SYSTEM.md**

Document:
1. Fix for optional fields clearing in driver edit form (`onSubmit`).
2. Inclusion of `position` and `license_verified` status on the Driver Detail UI.
3. Exposing personal attributes (`address`, `birthdate`, `sex`, `nationality`, `emergency_contact_*`) through `/api/driver/me` and mobile profile.

- [ ] **Step 4: Commit documentation updates**

```bash
git add "Capstone/02 - Features/Driver Management.md" "Capstone/03 - Database/Tables/drivers.md" SYSTEM.md
git commit -m "docs: record driver edit saving fix and profile sync across web and mobile"
```

