# Database Layer — RLS Policy Migration

This reference file provides patterns and templates for generating a Supabase migration that implements the RLS policies defined in `docs/rbac-model.md` Section 5.

## Prerequisites

- Read `docs/rbac-model.md` Section 5 (per-table policies) and Section 5.1 (helper functions)
- Read the existing migration `supabase/migrations/002_rls_policies.sql` to match the coding style
- Check which helper functions already exist (`get_current_employee_role`, `has_role`) vs what's missing

## Standard Patterns

### Pattern 1: Admin-Only Table

Tables that only system_admin or admin should access (roles, permissions, system_config):

```sql
CREATE POLICY "Admin view {table}"
  ON {table} FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin manage {table}"
  ON {table} FOR ALL
  USING (has_role(ARRAY['system_admin']));
```

### Pattern 2: All Authenticated Read + Role-Based Write

Tables where all staff can view but only specific roles can modify (vehicles, routes, drivers):

```sql
CREATE POLICY "All auth view {table}"
  ON {table} FOR SELECT
  USING (auth.role() = 'authenticated' AND deleted_at IS NULL);

CREATE POLICY "Fleet managers manage {table}"
  ON {table} FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));
```

### Pattern 3: Self-Scoped (Own Data)

Tables where drivers or employees should only see their own records (attendance, incidents, their trips):

```sql
CREATE POLICY "Users view own {table}"
  ON {table} FOR SELECT
  USING (driver_id = get_current_driver_id());

CREATE POLICY "Admin view all {table}"
  ON {table} FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));
```

### Pattern 4: Branch-Scoped

Tables where reception_staff, concierge, restaurant_staff should see only their branch's data:

```sql
CREATE POLICY "Staff view own branch {table}"
  ON {table} FOR SELECT
  USING (
    branch_id = get_current_employee_branch()
    OR created_by = get_current_employee_id()
  );

CREATE POLICY "Management view scoped {table}"
  ON {table} FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher']));
```

### Pattern 5: Read-Only for management

Tables that management should see but never modify:

```sql
-- management is already included in the SELECT policy
-- but excluded from ALL policies
CREATE POLICY "Management read-only supplement"
  ON {table} FOR SELECT
  USING (has_role(ARRAY['management']));
```

## Helper Functions to Create

If they don't exist yet, create these in the migration before the policy statements:

1. **`get_current_employee_branch()`** — Returns the branch_id of the employee linked to the current auth user.

```sql
CREATE OR REPLACE FUNCTION get_current_employee_branch()
RETURNS INT AS $$
DECLARE
  emp_branch INT;
BEGIN
  SELECT e.branch_id INTO emp_branch
  FROM employees e
  WHERE e.user_id = auth.uid()
  LIMIT 1;
  RETURN emp_branch;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

2. **`get_current_employee_id()`** — Returns the employee_id of the current auth user.

```sql
CREATE OR REPLACE FUNCTION get_current_employee_id()
RETURNS INT AS $$
DECLARE
  emp_id INT;
BEGIN
  SELECT e.employee_id INTO emp_id
  FROM employees e
  WHERE e.user_id = auth.uid()
  LIMIT 1;
  RETURN emp_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

3. **`get_current_driver_id()`** — Returns the driver_id for the current auth user's employee record, or NULL if they are not a driver.

```sql
CREATE OR REPLACE FUNCTION get_current_driver_id()
RETURNS INT AS $$
DECLARE
  d_id INT;
BEGIN
  SELECT d.driver_id INTO d_id
  FROM drivers d
  JOIN employees e ON d.employee_id = e.employee_id
  WHERE e.user_id = auth.uid()
  LIMIT 1;
  RETURN d_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Migration Structure

Create a new file `supabase/migrations/008_rbac_policies.sql` with this order:

1. Helper functions (if not already in 002)
2. Fix existing policies (management over-permission, fleet_manager gap in reservations)
3. New policies for tables with none currently
4. DELETE policies for tables that need them

## Fixes to Existing Policies

### Fix 1: Remove management from employees SELECT

In `002_rls_policies.sql`, the `employees` SELECT policy for admin currently includes `management`. Replace or update it:

```sql
-- Drop the overly broad policy
DROP POLICY IF EXISTS "Admin can view all employees" ON employees;

-- Recreate without management
CREATE POLICY "Admin can view all employees"
  ON employees FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager']));
```

### Fix 2: Add fleet_manager to reservations UPDATE

```sql
DROP POLICY IF EXISTS "Dispatchers and admin can update reservations" ON vehiclereservations;

CREATE POLICY "Dispatchers and admin can update reservations"
  ON vehiclereservations FOR UPDATE
  USING (has_role(ARRAY['admin', 'system_admin', 'dispatcher', 'fleet_manager']));
```

### Fix 3: Add DELETE policies

Many tables have INSERT/UPDATE policies but no DELETE policy. Add one for admin/system_admin:

```sql
CREATE POLICY "Admin can soft-delete {table}"
  ON {table} FOR UPDATE
  USING (has_role(ARRAY['admin', 'system_admin']))
  WITH CHECK (has_role(ARRAY['admin', 'system_admin']) AND deleted_at IS NOT NULL);
```

Better approach: add a dedicated DELETE policy since Supabase RLS checks DELETE separately from UPDATE:

```sql
CREATE POLICY "Admin can delete {table}"
  ON {table} FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));
```

## Tables Requiring New Policies

Refer to `docs/rbac-model.md` Section 5 for the full per-table policy specification. These tables currently have RLS enabled with zero policies:

- roles, permissions, role_permissions
- routes
- vehicleinspection
- vehicledocuments
- vehicleassignment
- fuelstations, fuelconsumption, fuelrequests, fuelallocations
- driverincidents
- ai_insights
- automation_rules, automation_logs
- scheduled_tasks, scheduled_reports
- mobiledevices
- offlinesync

For each, apply the matching pattern from above based on the policy table in Section 5.

## Verification

After writing the migration, run this query to identify tables still missing policies:

```sql
SELECT relname AS table_without_rls
FROM pg_class
WHERE relkind = 'r'
  AND relhaspolicies = false
  AND relname NOT IN ('spatial_ref_sys');
```

Return an empty set.
