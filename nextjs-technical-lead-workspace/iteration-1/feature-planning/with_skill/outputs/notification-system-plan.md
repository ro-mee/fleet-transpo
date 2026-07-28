# Real-Time Notification System — Feature Plan

## 1. Executive Summary

Add a real-time notification system to FleetOps covering **trip assignments**, **vehicle maintenance alerts**, and **dispatch changes**. The system builds on existing infrastructure (`notifications` table, Supabase Realtime, TanStack Query) but extends it with full real-time push, a notification bell + dropdown, per-user preferences, and Toast integration.

---

## 2. Current State Analysis

| Aspect | Status |
|--------|--------|
| `notifications` table | Exists in `001_schema.sql`, has basic columns |
| DB triggers (reservation, dispatch, maintenance, trip) | Exist in `003_notification_triggers.sql`, updated in `005_schema_cleanup.sql` |
| RLS on notifications | Exists in `002_rls_policies.sql` — users can SELECT/UPDATE own |
| `notification.service.js` | Exists — `getNotifications`, `markAsRead`, `markAllAsRead`, `deleteNotification`, `sendNotification` |
| `use-realtime.js` hook | Exists — generic `useRealtime` and specific `useTrackingRealtime` |
| `use-auth.js` | Exists — provides `user` + `employee` context |
| UI: Notifications page | Exists at `/(dashboard)/notifications/page.js` — lists all, filter by unread, mark/delete |
| UI: Preferences page | Exists at `/(dashboard)/notifications/preferences/page.js` — **but hardcoded mock**, no Supabase table backing it |
| UI: Templates page | Placeholder at `/(dashboard)/notifications/templates/page.js` |
| Notification bell in TopNav | Exists in `app-shell.jsx` — **but hardcoded badge count of "3"** |
| Toast library | `@radix-ui/react-toast` already in `package.json` — not wired up |
| TanStack Query | Already in use — used in notifications page |

**Gaps identified:**
- No `notification_preferences` table in the database
- Preferences page uses hardcoded mock data, no backend
- Bell badge count is hardcoded (shows "3")
- No real-time subscription hook for notifications specifically
- No Toast notifications for real-time alerts
- No per-user notification preferences enforcement in DB triggers
- Missing notification types: `dispatch_updated`, `trip_assigned`, `maintenance_overdue`, `vehicle_assigned`
- No pagination/cursor for notifications list
- No push notification infrastructure (device tokens, FCM/APNs)

---

## 3. Database Schema Design

### 3.1 New Table: `notification_preferences`

```sql
CREATE TABLE notification_preferences (
  preference_id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,    -- e.g. 'dispatch_created', 'maintenance_due', 'trip_assigned'
  channel_in_app BOOLEAN DEFAULT TRUE,
  channel_email BOOLEAN DEFAULT FALSE,
  channel_push BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, event_type)
);

CREATE INDEX idx_pref_employee ON notification_preferences(employee_id);
```

**Seed defaults** — every new employee gets a row per event type with sensible defaults.

### 3.2 Enhance `notifications` Table

Add columns for better routing and grouping:

```sql
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS employee_id_to INT[],         -- for batch targeting
  ADD COLUMN IF NOT EXISTS action_url TEXT,               -- deep-link to relevant page
  ADD COLUMN IF NOT EXISTS group_key VARCHAR(100),        -- for grouping (e.g. 'dispatch:42')
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;        -- auto-cleanup
```

### 3.3 New Table: `notification_webhooks` (future)

For third-party integrations (Slack, webhook). Not in scope for v1.

### 3.4 Indexes

```sql
CREATE INDEX idx_notifications_employee_read ON notifications(employee_id, is_read, sent_at DESC);
CREATE INDEX idx_notifications_expires ON notifications(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_pref_event ON notification_preferences(event_type);
```

### 3.5 RLS Policies

```sql
-- notification_preferences
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
  ON notification_preferences FOR SELECT
  USING (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own preferences"
  ON notification_preferences FOR ALL
  USING (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()));

-- Extend existing notifications RLS (already exists, ensure it's correct)
-- Already: "Users can view own notifications" on employee_id OR user_id match
-- Already: "Users can update own notifications" for mark as read
```

### 3.6 Update Existing DB Triggers

The triggers in `003_notification_triggers.sql` / `005_schema_cleanup.sql` need these updates:

1. **`notify_dispatch_created`** — Already sends to driver. Add: also send to fleet_manager/admin roles. Add `action_url`.
2. **`notify_maintenance_due`** — Sends to fleet_manager/admin. Add `action_url`. Add `group_key` for maintenance grouping.
3. **`notify_trip_completed`** — Sends to dispatch creator. Add `action_url`.
4. **`notify_reservation_approved`** — Already sends to creator + dispatchers/fleet_manager. Add `action_url`.

**New triggers needed:**

5. **`notify_dispatch_updated`** — On `dispatchschedules` UPDATE (status, driver_id, vehicle_id changes).
6. **`notify_trip_assigned`** — On `trips` INSERT where driver_id is set.
7. **`notify_maintenance_overdue`** — Scheduled check (via pg_cron or a cron job) for maintenance where `completed_date IS NULL AND maintenance_date < CURRENT_DATE`.
8. **`notify_vehicle_maintenance_needed`** — On `vehicles` UPDATE when `vehicle_status` changes to `'Under Maintenance'`, notify assigned drivers.

All triggers must check `notification_preferences` before inserting:

```sql
-- Pattern for preference-aware triggers
IF EXISTS (
  SELECT 1 FROM notification_preferences
  WHERE employee_id = target_employee_id
    AND event_type = 'dispatch_created'
    AND channel_in_app = TRUE
) THEN
  INSERT INTO notifications (...);
END IF;
```

---

## 4. API Design

### 4.1 Server Actions (mutation layer)

| Action | Method | Purpose |
|--------|--------|---------|
| `markNotificationRead(id)` | Server Action | Mark single notification as read |
| `markAllNotificationsRead()` | Server Action | Mark all as read for current user |
| `deleteNotification(id)` | Server Action | Delete a notification |
| `getNotificationPreferences()` | Server Action | Fetch current user's preferences |
| `updateNotificationPreferences(prefs)` | Server Action | Batch update preferences |
| `getUnreadCount()` | Server Action | Get unread count for badge |

### 4.2 Route Handlers (external/webhook)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/notifications/send` | POST | Admin-only: manually send notification |
| `/api/notifications/stats` | GET | Notification analytics (admin) |

### 4.3 Real-Time Subscriptions (Client)

| Channel | Filter | Purpose |
|---------|--------|---------|
| `notifications:{employee_id}` | `INSERT` on `notifications` where `employee_id = current` | New notification arrives |
| `notifications:{employee_id}` | `UPDATE` on `notifications` where `employee_id = current` | Mark-as-read sync across tabs |

### 4.4 TanStack Query Keys

```js
["notifications", { filter, page }]
["notifications", "unread-count"]
["notification-preferences"]
["notification", id]
```

---

## 5. UI Component Hierarchy

```
components/notifications/
├── notification-bell.jsx          — Bell icon + unread badge in TopNav
├── notification-dropdown.jsx      — Dropdown panel (last 5 unread)
├── notification-toast.jsx         — Real-time toast popup
├── notification-item.jsx          — Single notification row
├── notification-list.jsx          — Full list with pagination
├── notification-preferences.jsx   — Preferences form
└── notification-provider.jsx      — Context provider for real-time state
```

### 5.1 Component Responsibilities

**`notification-provider.jsx`**
- Wraps app (inserted into `Providers.jsx`)
- Subscribes to Supabase Realtime channel `notifications:{employee_id}`
- Maintains a count of unread notifications
- Exposes `{ unreadCount, notifications, addNotification, markRead }` via context

**`notification-bell.jsx`**
- Replaces hardcoded bell in `TopNav` (`app-shell.jsx:320`)
- Shows `unreadCount` from context
- Click toggles `notification-dropdown.jsx`

**`notification-dropdown.jsx`**
- Popover/DropdownMenu showing last 5 unread
- Each item has mark-read action + link to resource
- "View All" link → `/notifications`
- "Mark all as read" button at bottom

**`notification-toast.jsx`**
- Uses `@radix-ui/react-toast` (already in deps)
- When a new notification arrives via Realtime:
  - If app is in foreground → show Toast
  - If app is in background → update badge only
- Different toast styles per notification type (success/warning/info/error)

**`notification-item.jsx`**
- Shared component used by both dropdown and full list
- Icon based on type, title, message, timestamp, click handler

**`notification-list.jsx`**
- Used in `/notifications` page
- Replaces inline rendering in `page.js`
- Adds cursor-based pagination

**`notification-preferences.jsx`**
- Backed by `notification_preferences` table
- Real save via Server Action

### 5.2 Updated Files

| File | Change |
|------|--------|
| `components/providers.jsx` | Add `<NotificationProvider>` |
| `components/layout/app-shell.jsx` | Replace hardcoded bell with `<NotificationBell>` |
| `app/(dashboard)/notifications/page.js` | Refactor to use `<NotificationList>` |
| `app/(dashboard)/notifications/preferences/page.js` | Connect to real data via Server Actions |
| `hooks/use-realtime.js` | Add `useNotificationsRealtime()` hook |

---

## 6. Integration with Existing System

### 6.1 Auth Integration
- Notifications are user-scoped via `employee_id` from `useAuth().employee`
- RLS enforces user can only see own notifications
- Unauthenticated users get no real-time channel

### 6.2 Service Layer
- `notification.service.js` — already exists, will extend with:
  - `getUnreadCount()`
  - `getPreferences()`
  - `updatePreferences(prefs)`

### 6.3 Layout Integration
- `NotificationProvider` wraps children in `Providers.jsx` (client-side)
- `NotificationBell` replaces the hardcoded bell in `TopNav`
- Toast container added to root layout

### 6.4 Existing Pages
- The notifications page at `/(dashboard)/notifications` already uses TanStack Query — will add real-time subscription to auto-refresh
- The preferences page currently mock — will be fully wired

---

## 7. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| User sees others' notifications | RLS: `employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid())` |
| User marks others' as read | RLS: same filter on UPDATE |
| Real-time channel leakage | Supabase Realtime channels filtered by `employee_id` — only the authenticated user's channel receives their notifications |
| SQL injection in triggers | All trigger functions use parameterized queries (plpgsql variables, not string interpolation) |
| Preferences tampering | RLS on `notification_preferences` restricts to own employee_id |
| Unbounded notification growth | `expires_at` + cleanup cron job deleting notifications older than 90 days |
| Rate limiting on Server Actions | Apply standard rate limiting to `markAllRead` to prevent abuse |
| Trigger infinite loops | Triggers check `TG_OP` and status transitions to avoid re-triggering |

---

## 8. Edge Cases

| Edge Case | Handling |
|-----------|----------|
| User opens notification dropdown while offline | Use TanStack Query's `staleTime` + `networkMode: 'offlineFirst'` |
| Multiple browser tabs open | Realtime subscription fires in all tabs; use a shared notification ID cache to avoid duplicate toasts |
| Notification arrives for deleted user | Trigger checks `employee_id` exists before insert (FK handles this at DB level) |
| Maintenance trigger fires for past date | Only fires when `maintenance_date <= CURRENT_DATE + 7` and status is `'Scheduled'` |
| Dispatch re-assigned to different driver | Old driver's notification is standalone; new driver gets their own via the trigger on UPDATE |
| Bulk notification (e.g. all fleet managers) | Use `employee_id_to[]` array column with batch insert |
| Notification preferences not yet set | Default to `channel_in_app = TRUE` for all event types (seed on employee creation) |
| Real-time channel disconnect / reconnect | Supabase client auto-reconnects; queue any missed notifications via a `last_seen_at` timestamp check on reconnect |
| Very long notification list (>10K) | Cursor-based pagination with `notification_id` + `sent_at` cursor; soft-delete old notifications via cleanup job |
| Toast when user is on notifications page | Suppress toast if user is currently viewing `/notifications` — they see it in the list |
| Race condition: mark read + new notification | Optimistic update on mark-read; server is source of truth via TanStack Query invalidation |

---

## 9. Implementation Sequence

### Phase 1: Foundation (DB + Service Layer)

| Step | Task | Files | Est. |
|------|------|-------|------|
| 1.1 | Create migration `007_notification_preferences.sql` — new table, indexes, RLS | `supabase/migrations/` | 2h |
| 1.2 | Create migration `008_update_notifications.sql` — add columns (`action_url`, `group_key`, `expires_at`, `employee_id_to`), indexes | `supabase/migrations/` | 1h |
| 1.3 | Update DB triggers to check preferences, add `dispatch_updated`, `trip_assigned`, `maintenance_overdue` triggers | `supabase/migrations/` | 3h |
| 1.4 | Seed default notification preferences for existing employees | `supabase/seed.sql` | 1h |
| 1.5 | Extend `notification.service.js` — add `getUnreadCount`, `getPreferences`, `updatePreferences` | `src/services/notification.service.js` | 1h |
| 1.6 | Add Server Actions for notifications | `src/app/(dashboard)/notifications/actions.js` | 2h |

### Phase 2: Real-Time Infrastructure

| Step | Task | Files | Est. |
|------|------|-------|------|
| 2.1 | Create `useNotificationsRealtime(employeeId)` hook | `src/hooks/use-realtime.js` | 1h |
| 2.2 | Create `NotificationProvider` context | `src/components/notifications/notification-provider.jsx` | 2h |
| 2.3 | Integrate into `Providers.jsx` | `src/components/providers.jsx` | 0.5h |

### Phase 3: UI Components

| Step | Task | Files | Est. |
|------|------|-------|------|
| 3.1 | Create `NotificationBell` component | `src/components/notifications/notification-bell.jsx` | 1.5h |
| 3.2 | Create `NotificationDropdown` component | `src/components/notifications/notification-dropdown.jsx` | 2h |
| 3.3 | Create `NotificationItem` shared component | `src/components/notifications/notification-item.jsx` | 1h |
| 3.4 | Create `NotificationToast` with Radix Toast | `src/components/notifications/notification-toast.jsx` | 2h |
| 3.5 | Create `NotificationList` with pagination | `src/components/notifications/notification-list.jsx` | 2h |
| 3.6 | Create `NotificationPreferences` component | `src/components/notifications/notification-preferences.jsx` | 1.5h |
| 3.7 | Create barrel export `index.js` | `src/components/notifications/index.js` | 0.5h |

### Phase 4: Integration into Existing Pages

| Step | Task | Files | Est. |
|------|------|-------|------|
| 4.1 | Replace hardcoded bell in `TopNav` with `<NotificationBell>` | `src/components/layout/app-shell.jsx` | 0.5h |
| 4.2 | Refactor notifications page to use `<NotificationList>` | `src/app/(dashboard)/notifications/page.js` | 1h |
| 4.3 | Wire preferences page to real data + Server Action | `src/app/(dashboard)/notifications/preferences/page.js` | 1h |
| 4.4 | Add Toast container to root layout | `src/app/layout.js` | 0.5h |

### Phase 5: Polish & Testing

| Step | Task | Est. |
|------|------|------|
| 5.1 | Test all DB triggers with seed data | 2h |
| 5.2 | Test RLS policies with different roles | 1h |
| 5.3 | Test real-time subscription across browser tabs | 1h |
| 5.4 | Test pagination with 100+ notifications | 1h |
| 5.5 | Test offline/reconnect behavior | 1h |
| 5.6 | Lighthouse audit for performance | 0.5h |

### Phase 6: (Future) Push Notifications

| Step | Task | Est. |
|------|------|------|
| 6.1 | Add `device_tokens` table | 1h |
| 6.2 | Edge function for FCM/APNs push | 3h |
| 6.3 | Mobile app integration | varies |

---

## 10. Data Flow Diagram

```
[Dispatch Update / Trip Assignment / Maintenance Due]
        │
        ▼
[PostgreSQL Trigger Function]
        │
        ├─► Checks notification_preferences for target
        ├─► INSERT INTO notifications (with action_url, group_key)
        │
        ▼
[Supabase Realtime: postgres_changes channel]
        │
        ▼
[Client: NotificationProvider subscribes]
        │
        ├─► Increments unreadCount in context
        ├─► Shows Radix Toast (if not on /notifications)
        └─► Updates TanStack Query cache for badge/list
```

---

## 11. Notification Type Matrix

| Event | Trigger On | Targets | Priority | Toast Style |
|-------|-----------|---------|----------|-------------|
| `trip_assigned` | `trips` INSERT | Assigned driver | High | Info |
| `dispatch_created` | `dispatchschedules` INSERT | Assigned driver, fleet_manager | High | Info |
| `dispatch_updated` | `dispatchschedules` UPDATE (status change) | Assigned driver | Medium | Warning |
| `dispatch_cancelled` | `dispatchschedules` UPDATE → cancelled | Assigned driver, created_by | High | Alert |
| `maintenance_due` | `vehiclemaintenance` INSERT/UPDATE within 7 days | fleet_manager, admin | Medium | Warning |
| `maintenance_overdue` | Cron check (daily) | fleet_manager, admin | High | Alert |
| `vehicle_maintenance_needed` | `vehicles` UPDATE → 'Under Maintenance' | Assigned drivers, fleet_manager | High | Alert |
| `reservation_approved` | `vehiclereservations` UPDATE → Approved | Creator, dispatcher | Medium | Success |
| `trip_completed` | `trips` UPDATE → Completed | Dispatch creator | Low | Success |

---

## 12. Rollout Strategy

1. **Phase 1 & 2** — No visible UI changes (DB + infrastructure)
2. **Phase 3** — Components built but not connected to UI
3. **Phase 4, step 1** — Bell badge becomes live (biggest user-facing change)
4. **Phase 4, step 2** — Notifications page fully real-time
5. **Phase 4, step 3** — Preferences become functional
6. **Monitoring period** — 1 week to observe DB trigger performance, real-time channel load

**Rollback plan:** If real-time subscriptions cause performance issues, disable the subscription in `NotificationProvider` and fall back to TanStack Query polling with 30s `refetchInterval`.
