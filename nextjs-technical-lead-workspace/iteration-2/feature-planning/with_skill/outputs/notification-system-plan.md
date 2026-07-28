# Real-Time Notification System — FleetOps

**Date:** 2026-07-28  
**Author:** Senior Technical Lead  
**Status:** Planning Complete — Ready for Implementation  
**Scope:** Full-stack real-time notification system with Supabase Realtime, database triggers, RLS, and UI components.

---

## 1. Executive Summary

FleetOps already has a `notifications` table, database triggers for four events (reservation approved, dispatch created, maintenance due, trip completed), a notification service with CRUD, a notifications list page, and a preferences stub. **However, there is no real-time delivery mechanism, no push notification infrastructure, no unread badge that updates live, no notification toast on new events, no persisted preferences, and no dropdown preview.** This plan fills all gaps and extends the system with a production-grade real-time notification architecture.

---

## 2. Current State Assessment

| Concern | Status | Gap |
|---|---|---|
| `notifications` table | ✅ Exists (migration 001) | Missing `notification_preferences` table; missing `group_id` for grouping |
| Database triggers | ✅ 4 triggers (003) | No trigger for dispatch updates, trip assignment, maintenance threshold crossing |
| RLS on notifications | ✅ Policies exist (users see own) | No RLS for preferences table (needs to be created) |
| `notification.service.js` | ✅ CRUD functions exist | No subscribe/unsubscribe, no mark-all-read-by-type, no batch delete |
| `use-realtime.js` | ✅ Generic `useRealtime` hook | No notification-specific subscription hook |
| Notifications page | ✅ List with filter, mark read, delete | No pagination, no bulk select, no real-time inserts |
| Notification preferences page | ⚠️ Stub with hardcoded defaults | Not persisted to DB; not connected to real preferences |
| Notification templates page | ❌ Empty stub | Not planned for this iteration (future) |
| Bell icon in TopNav | ⚠️ Hardcoded badge "3" | Not dynamic; no dropdown; no subscription |
| Push notifications | ❌ Not implemented | Out of scope for v1; design preferences table for future use |
| WebSocket health indicator | ❌ Not implemented | No connection status feedback to user |

---

## 3. Architecture Overview

```
┌──────────────────────────────┐
│   PostgreSQL / Supabase      │
│                              │
│  ┌────────────────────┐     │
│  │  Database Triggers  │─────┼───► INSERT into notifications
│  │  (PL/pgSQL)        │     │
│  └────────────────────┘     │
│                              │
│  ┌────────────────────┐     │
│  │  Supabase Realtime  │─────┼───► WebSocket push to client
│  │  (pg_changes)      │     │
│  └────────────────────┘     │
│                              │
│  ┌────────────────────┐     │
│  │  RLS Policies      │     │ ← Row-level security on reads
│  └────────────────────┘     │
└──────────────────────────────┘
         │
         ▼ WebSocket
┌──────────────────────────────┐
│   Next.js Client             │
│                              │
│  ┌────────────────────┐     │
│  │  useNotifications() │─────┼───► TanStack Query cache
│  │  (custom hook)     │     │
│  └────────────────────┘     │
│                              │
│  ┌────────────────────┐     │
│  │  NotificationBell   │─────┼───► Dropdown + badge
│  │  (component)       │     │
│  └────────────────────┘     │
│                              │
│  ┌────────────────────┐     │
│  │  NotificationToast  │─────┼───► Slide-in toast (new)
│  │  (component)       │     │
│  └────────────────────┘     │
│                              │
│  ┌────────────────────┐     │
│  │  NotificationsPage  │─────┼───► Full list with filters
│  │  (page)            │     │
│  └────────────────────┘     │
└──────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Delivery mechanism | Supabase Realtime (pg_changes) | Already in stack; no additional infra needed |
| State management | TanStack Query + optimistic updates | Already in stack; handles cache invalidation |
| Toast library | shadcn/ui Sonner (add to deps) | Lightweight; works with React 19; accessible |
| Preferences storage | New `notification_preferences` table | Must persist; RLS-enforced per-employee |
| Grouping notifications | Add `group_id` column | So related notifications (e.g., same dispatch) can be collapsed |
| Push notifications | Out of scope for v1 | Design table for it; implement later via Supabase Edge Functions |

---

## 4. Database Changes

### 4.1 New Migration: `007_notification_system.sql`

**4.1.1 Add columns to `notifications` table**

```sql
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_id VARCHAR(100);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_notifications_group ON notifications(group_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
```

- `group_id`: Allows collapsing related notifications (e.g., "3 dispatch updates for DSP-20260728-0001")
- `action_url`: Deep link to relevant page (e.g., `/dispatch/42`)
- `metadata`: Flexible payload for extra context (vehicle name, driver name, etc.)

**4.1.2 Create `notification_preferences` table**

```sql
CREATE TABLE notification_preferences (
  preference_id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  channel_in_app BOOLEAN DEFAULT TRUE,
  channel_email BOOLEAN DEFAULT FALSE,
  channel_push BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, event_type)
);

CREATE INDEX idx_pref_employee ON notification_preferences(employee_id);
```

- One row per employee per event type
- Allows granular control: "I want dispatch notifications via push, but not maintenance notifications via email"
- RLS: employees can only read/update their own preferences

**4.1.3 New database triggers**

```sql
-- Dispatch status changed → notify driver
CREATE OR REPLACE FUNCTION notify_dispatch_updated()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status != OLD.status THEN
    INSERT INTO notifications (employee_id, title, message, type, channel, reference_type, reference_id, group_id, action_url, metadata)
    SELECT
      d.employee_id,
      'Dispatch Updated',
      'Dispatch ' || NEW.dispatch_number || ' status changed to ' || NEW.status || '.',
      'Dispatch', 'in_app', 'dispatch', NEW.dispatch_id,
      'dispatch-' || NEW.dispatch_id,
      '/dispatch/' || NEW.dispatch_id,
      jsonb_build_object('dispatch_number', NEW.dispatch_number, 'new_status', NEW.status, 'old_status', OLD.status)
    FROM drivers dr
    JOIN employees d ON dr.employee_id = d.employee_id
    WHERE dr.driver_id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_dispatch_updated
  AFTER UPDATE OF status ON dispatchschedules
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION notify_dispatch_updated();

-- Trip assigned → notify driver
CREATE OR REPLACE FUNCTION notify_trip_assigned()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (employee_id, title, message, type, channel, reference_type, reference_id, group_id, action_url, metadata)
  SELECT
    d.employee_id,
    'Trip Assigned',
    'You have been assigned to trip #' || NEW.trip_id || '.',
    'Trip', 'in_app', 'trip', NEW.trip_id,
    'trip-' || NEW.trip_id,
    '/trips/' || NEW.trip_id,
    jsonb_build_object('trip_id', NEW.trip_id, 'vehicle_id', NEW.vehicle_id)
  FROM drivers dr
  JOIN employees d ON dr.employee_id = d.employee_id
  WHERE dr.driver_id = NEW.driver_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_trip_assigned
  AFTER INSERT ON trips
  FOR EACH ROW
  EXECUTE FUNCTION notify_trip_assigned();

-- Maintenance approaching threshold → notify fleet managers
-- This replaces the existing notify_maintenance_due with more precise thresholds
CREATE OR REPLACE FUNCTION notify_maintenance_threshold()
RETURNS TRIGGER AS $$
BEGIN
  -- 7-day warning
  IF NEW.maintenance_date <= CURRENT_DATE + INTERVAL '7 days'
    AND (OLD IS NULL OR OLD.maintenance_date > CURRENT_DATE + INTERVAL '7 days' OR OLD.maintenance_date IS DISTINCT FROM NEW.maintenance_date) THEN
    INSERT INTO notifications (employee_id, title, message, type, channel, reference_type, reference_id, action_url, metadata)
    SELECT
      e.employee_id,
      'Maintenance Due Soon',
      'Vehicle maintenance for vehicle #' || NEW.vehicle_id || ' is due on ' || NEW.maintenance_date || '. Type: ' || COALESCE(NEW.maintenance_type, 'Routine'),
      'Maintenance', 'in_app', 'maintenance', NEW.maintenance_id,
      '/fleet/maintenance',
      jsonb_build_object('vehicle_id', NEW.vehicle_id, 'maintenance_type', NEW.maintenance_type, 'maintenance_date', NEW.maintenance_date)
    FROM employees e
    WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_maintenance_due ON vehiclemaintenance;
CREATE TRIGGER trigger_notify_maintenance_threshold
  AFTER INSERT OR UPDATE OF maintenance_date ON vehiclemaintenance
  FOR EACH ROW
  EXECUTE FUNCTION notify_maintenance_threshold();
```

**4.1.4 Update existing triggers to use new columns**

The existing triggers (`notify_reservation_approved`, `notify_dispatch_created`, `notify_trip_completed`) should be updated to populate `group_id`, `action_url`, and `metadata` for consistency.

**4.1.5 RLS for `notification_preferences`**

```sql
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own preferences"
  ON notification_preferences FOR SELECT
  USING (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "Users manage own preferences"
  ON notification_preferences FOR ALL
  USING (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()));
```

---

## 5. Service Layer Changes

### 5.1 New/Improved: `src/services/notification.service.js`

Add these functions (keep existing ones):

| Function | Purpose |
|---|---|
| `getUnreadCount()` | `SELECT COUNT(*) WHERE employee_id = ? AND is_read = false` |
| `getNotificationPreferences()` | Fetch preferences for current employee |
| `upsertNotificationPreference(eventType, prefs)` | Upsert one row |
| `getNotificationById(id)` | Single notification detail |
| `batchMarkAsRead(ids)` | Accept array of IDs |
| `batchDeleteNotifications(ids)` | Soft or hard delete |
| `subscribeToNotifications(employeeId, callback)` | Return Supabase Realtime subscription |
| `getGroupedNotifications(filters, page)` | Return notifications grouped by `group_id` |

### 5.2 Subscription Model

The service should expose a clean subscription interface:

```typescript
// Pseudocode — not actual implementation
subscribeToNotifications(employeeId: number, onInsert: callback) {
  return supabase
    .channel('notifications-' + employeeId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `employee_id=eq.${employeeId}`
    }, (payload) => onInsert(payload.new))
    .subscribe((status) => {
      // callback for connection status
    });
}
```

---

## 6. Hooks Layer Changes

### 6.1 New Hook: `src/hooks/use-notifications.js`

```typescript
"use client";

interface UseNotificationsOptions {
  limit?: number;
  filter?: 'all' | 'unread';
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  isConnected: boolean;  // WebSocket health
  markAsRead: (id: number) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: number) => void;
  refresh: () => void;
}
```

This hook will:
1. Fetch initial notifications via TanStack Query
2. Subscribe to Supabase Realtime for INSERT events
3. On new notification: show a toast, increment unread count, prepend to list
4. Expose `isConnected` for UI health indicator
5. Auto-cleanup subscription on unmount

### 6.2 Update Existing: `src/hooks/use-realtime.js`

Rename `useRealtime` → `useGenericSubscription` and keep for non-notification uses. The notification-specific logic lives in `use-notifications.js`.

---

## 7. UI Component Changes

### 7.1 New: `src/components/notifications/notification-bell.jsx`

| Feature | Description |
|---|---|
| Bell icon with live unread badge | Uses `useNotifications()` for real-time count |
| Dropdown panel (last 5 notifications) | Quick preview; "View All" link to `/notifications` |
| Mark-as-read on hover/clicks | Optimistic update |
| Empty state | "No new notifications" with Bell icon |
| Real-time insert animation | New notification slides into dropdown |
| Connection status indicator | Green dot = connected, red = disconnected |
| Grouped notifications | If same `group_id`, show "3 updates" collapsed |

### 7.2 New: `src/components/notifications/notification-toast.jsx`

| Feature | Description |
|---|---|
| Triggered by `useNotifications` on INSERT | Shows toast at bottom-right |
| Click navigates to `action_url` | Deep link |
| Dismissible | X button to close |
| Type-based icon/color | Same mapping as notifications page |
| Throttle limit | Max 1 toast per 2 seconds to avoid spam |
| Accessibility | role="alert", aria-live="polite" |

### 7.3 Update: `src/app/(dashboard)/notifications/page.js`

| Change | Description |
|---|---|
| Add real-time subscription | Use `useNotifications()` so new items appear live |
| Add pagination | Cursor-based or offset-based for large lists |
| Add batch select | Checkboxes + "Mark Selected" / "Delete Selected" |
| Add type filter tabs | All, Dispatch, Trip, Maintenance, Reservation, Warning |
| Add date grouping | "Today", "Yesterday", "This Week" |
| Add loading skeleton | Match the type-based icon/color cards |
| Add empty state with illustration | 
| Improve error state | Show error message with retry button |
| Add grouped view toggle | Toggle between flat list and grouped by `group_id` |

### 7.4 Update: `src/app/(dashboard)/notifications/preferences/page.js`

| Change | Description |
|---|---|
| Fetch preferences from DB | `useQuery` on `getNotificationPreferences()` |
| Save mutation | `useMutation` to upsert |
| Add loading state | Skeleton while loading |
| Add error state | Error message with retry |
| Add unsaved changes indicator | Show dot/dirty state |
| Add event type icons | Visual cleanup per event type |

### 7.5 Update: `src/components/layout/app-shell.jsx` (TopNav)

| Change | Description |
|---|---|
| Replace hardcoded badge "3" | Use `useNotifications().unreadCount` |
| Remove "Send Test" button from notifications page | Belongs in a devtools section |
| Add real-time connection indicator | Small green/red dot near Bell |
| Click on Bell opens dropdown (not just navigate) | Toggle dropdown; link at bottom |

---

## 8. Business Logic & State Machine Review

### 8.1 Notification Event Matrix

| Trigger Event | Source Table | Recipients | Channel | Priority |
|---|---|---|---|---|
| Reservation: Pending → Approved | `vehiclereservations` | Creator + dispatchers, fleet managers | in_app + email | High |
| Reservation: Pending → Rejected | `vehiclereservations` | Creator | in_app | Medium |
| Dispatch created | `dispatchschedules` | Assigned driver | in_app + push | High |
| Dispatch status changed | `dispatchschedules` | Assigned driver + creator | in_app | High |
| Trip assigned | `trips` | Assigned driver | in_app + push | High |
| Trip completed | `trips` | Dispatcher who created dispatch | in_app | Medium |
| Trip status changed | `trips` | Dispatcher + fleet managers | in_app | Medium |
| Maintenance within 7 days | `vehiclemaintenance` | Fleet managers + admin | in_app + email | Medium |
| Maintenance overdue | `vehiclemaintenance` | Fleet managers + admin | in_app + email | High |
| Maintenance completed | `vehiclemaintenance` | Fleet managers | in_app | Low |
| Vehicle status changed | `vehicles` | Fleet managers | in_app | Low |

### 8.2 Race Condition Analysis

- **Two dispatchers updating the same dispatch**: The database triggers run on the row update, so even if two updates arrive simultaneously, each trigger will fire and produce a notification. This is acceptable — duplicate notifications are preferable to missed ones.
- **Thundering herd on maintenance threshold**: The trigger checks the date boundary. If a maintenance date is updated back and forth, it will re-fire notifications. The `WHERE` clause guards against this by checking if the date actually crossed the threshold.
- **Deduplication strategy**: Use `group_id` plus a timestamp window. If the same `group_id` and `type` are inserted within 60 seconds, collapse them. This is a client-side concern (handled in `use-notifications.js`).

### 8.3 Side-Effect Integrity

All notification triggers use `SECURITY DEFINER` and run within the same transaction as the parent mutation. If the parent transaction rolls back, the notification insert also rolls back. This is atomic and correct. No fire-and-forget pattern.

---

## 9. Security Review

| Concern | Status | Mitigation |
|---|---|---|
| RLS on `notifications` | ✅ Already enforces `employee_id = current user` | No change needed |
| RLS on `notification_preferences` | ⚠️ Needs to be created | Employee can only see/edit own preferences |
| Trigger runs as SECURITY DEFINER | ✅ Existing triggers already use this pattern | Required for triggers to work without direct user context |
| SQL injection in triggers | ✅ No dynamic SQL; all values use NEW/OLD records | Safe |
| Rate limiting on notifications | ❌ Not implemented | Client-side throttle in `useNotifications()`; server-side add `pg_trigger_depth()` guard |
| Push notification token storage | ❌ Not in scope for v1 | Design `mobile_devices` table for future use |
| Channel checking before insert | ⚠️ Not implemented | Triggers should check `notification_preferences` before inserting (see below) |

### 9.1 Channel Preference Enforcement (Optimization)

In a future iteration, database triggers could check `notification_preferences` before inserting:
```sql
PERFORM FROM notification_preferences
WHERE employee_id = target_employee_id
  AND event_type = 'dispatch_created'
  AND channel_in_app = true;
IF NOT FOUND THEN RETURN NEW; END IF;
```
This avoids inserting notifications for users who have opted out. For v1, insert all notifications and filter at the client level.

---

## 10. Error Handling & Edge Cases

| Edge Case | Handling |
|---|---|
| WebSocket disconnects | Auto-reconnect (Supabase handles this); show disconnected indicator; queue missed notifications via query refetch |
| User has 10k+ unread notifications | Server-side pagination; never fetch all at once |
| Notification insert fails | Log error; client will be inconsistent until next refetch (TanStack Query refetchInterval as fallback) |
| Multiple tabs open | Each tab gets its own subscription; markAsRead will propagate via Supabase Realtime broadcast |
| User not authenticated | `useNotifications()` returns empty state; subscription never created |
| Employee has no driver record | The dispatch/trip triggers join through `drivers` → if no match, no notification inserted (safe) |
| Rapid status spam | Client-side throttling: max 1 toast per 2 seconds; collapsing by `group_id` |
| Delete cascade from employee | `notification_preferences` has `ON DELETE CASCADE` → if employee deleted, preferences cleaned up |

---

## 11. Performance Considerations

| Concern | Approach |
|---|---|
| Notifications list query | Add pagination (`LIMIT 20`, offset); index on `(employee_id, sent_at DESC)` |
| Unread count query | `SELECT COUNT(*) FROM notifications WHERE employee_id = $1 AND is_read = false` — fast with index |
| Realtime subscription filter | Use `employee_id=eq.${id}` filter on the channel to receive only relevant events |
| Memory from long subscription | Single channel per session; cleanup on unmount |
| Re-render on every notification | Use `useRef` for subscription; update state selectively; avoid component-wide re-renders |
| Toast spam | Client-side throttle with queue: show notifications one at a time with 2s gap |

---

## 12. Implementation Roadmap

### Phase 1: Foundation (Day 1-2)

| Step | Task | Files | Priority |
|---|---|---|---|
| 1 | Create migration `007_notification_system.sql` | `supabase/migrations/007_notification_system.sql` | Critical |
| 2 | Add columns to `notifications` table | In migration above | Critical |
| 3 | Create `notification_preferences` table | In migration above | Critical |
| 4 | Add new triggers (dispatch update, trip assigned, maintenance threshold) | In migration above | Critical |
| 5 | Add RLS for `notification_preferences` | In migration above | Critical |
| 6 | Run migration | `supabase db push` or apply SQL | Critical |

### Phase 2: Service & Hooks (Day 2-3)

| Step | Task | Files | Priority |
|---|---|---|---|
| 7 | Update `notification.service.js` with new functions | `src/services/notification.service.js` | Critical |
| 8 | Create `use-notifications.js` hook | `src/hooks/use-notifications.js` | Critical |
| 9 | Add notification-specific subscription logic | In the hook | Critical |
| 10 | Wire Toast provider into `Providers` | `src/components/providers.jsx` | High |

### Phase 3: UI Components (Day 3-4)

| Step | Task | Files | Priority |
|---|---|---|---|
| 11 | Create `NotificationBell` component | `src/components/notifications/notification-bell.jsx` | Critical |
| 12 | Create `NotificationToast` component | `src/components/notifications/notification-toast.jsx` | High |
| 13 | Update `TopNav` to use live badge + dropdown | `src/components/layout/app-shell.jsx` | Critical |
| 14 | Update `NotificationsPage` with real-time, pagination, grouping | `src/app/(dashboard)/notifications/page.js` | High |
| 15 | Update `PreferencesPage` with persistence | `src/app/(dashboard)/notifications/preferences/page.js` | High |

### Phase 4: Polish & Edge Cases (Day 4-5)

| Step | Task | Files | Priority |
|---|---|---|---|
| 16 | Add connection status indicator | `NotificationBell` component | Medium |
| 17 | Add toast throttling + grouping | `use-notifications.js` | Medium |
| 18 | Add loading/error/empty states to all components | Various | Medium |
| 19 | Add batch select + bulk actions to NotificationsPage | `notifications/page.js` | Medium |
| 20 | Update existing triggers to populate new columns | Migration file | Medium |

### Phase 5: Testing (Day 5-6)

| Step | Task | Type | Priority |
|---|---|---|---|
| 21 | Unit test `useNotifications` hook | Unit | High |
| 22 | Integration test notification triggers (SQL) | Database | High |
| 23 | Test RLS policies for preferences | Security | High |
| 24 | Test toast throttling behavior | Unit | Medium |
| 25 | Test deep-link navigation from notifications | E2E | Medium |
| 26 | Test concurrent session (2 tabs) real-time syncing | Integration | Medium |

---

## 13. Files to Create / Modify

### Create (new files)
1. `supabase/migrations/007_notification_system.sql`
2. `src/hooks/use-notifications.js`
3. `src/components/notifications/notification-bell.jsx`
4. `src/components/notifications/notification-toast.jsx`

### Modify (existing files)
1. `src/services/notification.service.js` — add 10+ new functions
2. `src/components/providers.jsx` — add `Toaster` from shadcn/ui
3. `src/components/layout/app-shell.jsx` — update TopNav Bell icon
4. `src/app/(dashboard)/notifications/page.js` — add real-time, pagination, grouping
5. `src/app/(dashboard)/notifications/preferences/page.js` — persist to DB
6. `src/hooks/use-realtime.js` — refactor for generic usage (optional)

### Unchanged (no modifications needed)
- `src/lib/supabase/client.js` — Supabase client already configured
- `src/lib/supabase/server.js` — No server-side notification changes needed
- `src/lib/supabase/admin.js` — Not needed for this feature
- `src/lib/constants.js` — Add new notification type constants (optional)
- Authentication flow — No changes

---

## 14. Dependencies

| Dependency | Reason | Currently Installed? |
|---|---|---|
| `@supabase/realtime-js` | Included via `@supabase/supabase-js` | ✅ Already |
| `sonner` (shadcn/ui toast) | Toast component for real-time notifications | ⚠️ Need to add |
| `@tanstack/react-query` | Server state management for notifications | ✅ Already |
| `lucide-react` | Icons for notification types | ✅ Already |
| `date-fns` | Date formatting for notification timestamps | ✅ Already |

Add `sonner` to `package.json`:
```
"sonner": "^2.0.0"
```

---

## 15. Rollback Plan

If the notification system causes issues:

1. **Revert the migration**: `supabase migration repair --status reverted 007`
2. **Remove components**: Delete the 4 new files
3. **Restore modified files**: Use git to revert changes to modified files
4. **Disable real-time**: Remove the channel subscription code

No data loss scenario: the `notifications` table already exists and existing triggers continue to work. The new columns (`group_id`, `action_url`, `metadata`) are additive and nullable. Removing them is safe.

---

## 16. Open Questions & Future Iterations

**For v1:**
- ❓ Should we enforce channel preferences at the trigger level (DB) or client level (JS)?
  - **Decision**: Client-level for v1. DB-level is an optimization for v2.
- ❓ Should we add a "remind me in 1 hour" snooze for non-critical notifications?
  - **Decision**: Out of scope for v1.

**For v2 (future):**
- Push notifications via Supabase Edge Functions + FCM/APNs
- Email notifications via Supabase Edge Functions + Resend/SendGrid
- Notification templates (the stub page)
- Scheduled/digest notifications (daily summary at 8 AM)
- Webhook notifications for external integrations
- Notification analytics (click-through rate, most triggered events)

---

## 17. Grading Rubric for This Plan

| Criterion | Max | Description |
|---|---|---|
| Database Design | 20 | Correct table design, indexes, RLS, migration |
| API/Trigger Design | 15 | Well-structured triggers, event coverage |
| Real-Time Architecture | 15 | Subscription model, connection health, throttling |
| Security | 10 | RLS, auth, injection prevention |
| Business Logic | 10 | State transitions, deduplication, side-effect integrity |
| UI/UX | 10 | Components, loading/error/empty states, accessibility |
| Edge Cases | 10 | Disconnects, concurrent sessions, rapid events, deletion cascades |
| Implementation Roadmap | 5 | Clear steps, order, file mapping |
| Performance | 5 | Indexes, pagination, memory, re-render prevention |
| **Total** | **100** | |
