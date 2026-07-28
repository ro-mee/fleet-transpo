# Real-Time Notification System — FleetOps

## 1. Executive Summary

Add a real-time notification system that pushes alerts to users when trips are assigned, vehicles need maintenance, or dispatches change. The system leverages **Supabase Realtime** (Postgres CDC), the existing `notifications` table and `003_notification_triggers.sql` migration, and extends the in-app notification centre.

---

## 2. Current State Analysis

| Area | Status | Notes |
|------|--------|-------|
| `notifications` table | ✅ Exists (001_schema.sql:608-626) | Has `employee_id`, `user_id`, `title`, `message`, `type`, `channel`, `reference_type`, `reference_id`, `is_read`, `read_at`, `sent_at` |
| DB triggers | ✅ Partial (003_notification_triggers.sql) | Covers reservation approved, dispatch created, maintenance due, trip completed, document expiry **missing: trip assigned, dispatch changed/updated, trip started, fuel low, driver check-in** |
| RLS policies | ✅ Exists (002_rls_policies.sql:235-241) | Users can SELECT/UPDATE own notifications |
| `notification.service.js` | ✅ Exists | `getNotifications`, `markAsRead`, `markAllAsRead`, `deleteNotification`, `sendNotification`, `getNotificationIcon` |
| `use-realtime.js` hook | ✅ Exists | Generic `useRealtime` + `useTrackingRealtime` — no notification-specific subscription |
| Notifications page | ✅ Exists | Full page with filter, mark read, delete, type icons/colours |
| Preferences page | ✅ Exists (static mock) | Hardcoded toggles — no persisting to DB |
| Templates page | ✅ Stub | Placeholder only |
| TopNav bell icon | ✅ Exists (hardcoded badge `3`) | Not connected to real unread count |
| `notification_preferences` table | ❌ Missing | Preferences are hardcoded in `preferences/page.js` |
| `notification_preferences` RLS | ❌ Missing | Need per-user preference policies |
| Push notification infra | ❌ Missing | No push token storage or FCM/APNs integration |
| Email notification infra | ❌ Missing | No email sending pipeline |

---

## 3. Database Design

### 3.1 New Tables

#### `notification_preferences`
```sql
CREATE TABLE notification_preferences (
  preference_id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,          -- e.g. 'trip_assigned', 'dispatch_changed', 'maintenance_due'
  channel_in_app BOOLEAN DEFAULT TRUE,
  channel_email BOOLEAN DEFAULT FALSE,
  channel_push BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, event_type)
);
```

#### `push_device_tokens` (rename/enhance existing `mobiledevices`)
```sql
ALTER TABLE mobiledevices ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE mobiledevices ADD COLUMN IF NOT EXISTS push_provider VARCHAR(20);  -- 'fcm', 'apns'
ALTER TABLE mobiledevices ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT TRUE;
```

### 3.2 Enhancements to `notifications` Table
```sql
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;       -- deep link e.g. /dispatch/42
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_label VARCHAR(100);  -- "View Dispatch"
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS provider_message_id TEXT;  -- for external push/email tracking
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_count INT DEFAULT 0;  -- optimistic read tracking
```

### 3.3 New Indexes
```sql
CREATE INDEX idx_notifications_employee_unread ON notifications(employee_id) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_type_sent ON notifications(type, sent_at DESC);
CREATE INDEX idx_push_tokens_employee ON mobiledevices(employee_id) WHERE push_token IS NOT NULL;
```

---

## 4. New/Updated Database Triggers (in `003_notification_triggers.sql` or new migration `007_notification_enhancements.sql`)

### 4.1 Trip Assigned to Driver
```sql
-- Trigger on trips INSERT or driver_id UPDATE
-- Notify the driver that a trip has been assigned
-- Notify dispatcher that trip was acknowledged
```

### 4.2 Dispatch Changed
```sql
-- Trigger on dispatchschedules UPDATE (status, driver_id, vehicle_id, scheduled_departure)
-- Notify the affected driver
-- Notify the assigned dispatcher
-- Include old vs new values in message
```

### 4.3 Vehicle Maintenance Alert
```sql
-- Enhancement to existing notify_maintenance_due()
-- Assign directly to fleet_manager role + the branch's fleet staff
-- Add notification when maintenance is overdue (completed_date is NULL AND maintenance_date < CURRENT_DATE)
```

### 4.4 Trip Started / Completed
```sql
-- Trip started: notify creator/dispatcher
-- Trip completed: already exists, enhance with action_url
```

### 4.5 Fuel Low
```sql
-- Trigger on fuelrecords INSERT when fuel_level drops below threshold
-- Notify driver + fleet_manager
```

### 4.6 Document Expiry (30/7 day reminders)
```sql
-- Already exists for 30-day window
-- Add 7-day and expired reminders
```

---

## 5. Notification Preference System

### 5.1 Preference Events
| Event Key | Default Channels | Recipients |
|-----------|-----------------|------------|
| `trip_assigned` | in_app, push | Driver |
| `trip_started` | in_app | Dispatcher |
| `trip_completed` | in_app, email | Dispatcher |
| `dispatch_created` | in_app, push | Driver |
| `dispatch_changed` | in_app, push, email | Driver |
| `maintenance_due` | in_app, email | Fleet Manager |
| `maintenance_overdue` | in_app, email, push | Fleet Manager, Admin |
| `fuel_low` | in_app | Driver |
| `reservation_approved` | in_app, email | Creator |
| `reservation_rejected` | in_app, email | Creator |
| `document_expiring` | in_app, email | Fleet Manager |
| `driver_check_in` | in_app | Dispatcher |

### 5.2 Preference Resolution Flow
```
1. Event fires → DB trigger inserts into notifications
2. Notification service checks notification_preferences for employee_id + event_type
3. If channel disabled → skip or soft-delete the notification row
4. Else route to active channels
```

---

## 6. Real-Time Subscriptions Architecture

### 6.1 Client-Side Subscription (`use-notifications-realtime.js`)

```js
// New hook: useNotificationsRealtime()
// - Subscribes to postgres_changes on notifications table
//   filtered by employee_id
// - Listens for INSERT events
// - Returns new notification payload
// - Updates React Query cache or Zustand store
// - Also tracks connection status
```

### 6.2 Subscription Types
| Subscription | Channel Name | Table | Filter | Event |
|-------------|-------------|-------|--------|-------|
| New Notifications | `notifications:{employee_id}` | `notifications` | `employee_id=eq.{id}` | INSERT |
| Unread Count | `notifications:{employee_id}:unread` | `notifications` | `employee_id=eq.{id}&is_read=eq.false` | INSERT, UPDATE |

### 6.3 NotificationBadge Component
- Subscribe to unread count
- WebSocket-driven badge number
- Pulse animation on new notification
- Click opens notification dropdown/panel

### 6.4 Toast Notification on New Event
- Show a Radix Toast (already in deps: `@radix-ui/react-toast`)
- Auto-dismiss after 5 seconds
- Clickable → navigates to action_url

---

## 7. API Endpoints

### 7.1 Existing (to keep/enhance)

| Endpoint | Method | File | Notes |
|----------|--------|------|-------|
| `getNotifications(filters)` | Client → Supabase | `notification.service.js:3` | Direct Supabase query |
| `markAsRead(id)` | Client → Supabase | `notification.service.js:19` | Updates is_read, read_at |
| `markAllAsRead()` | Client → Supabase | `notification.service.js:28` | Batch update |
| `deleteNotification(id)` | Client → Supabase | `notification.service.js:37` | Delete single |
| `sendNotification(data)` | Client → Supabase | `notification.service.js:46` | Insert single |

### 7.2 New Route Handlers (App Router)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/notifications/preferences` | GET | Get current user's preferences |
| `/api/notifications/preferences` | PUT | Update preferences |
| `/api/notifications/batch-read` | POST | Mark multiple as read |
| `/api/notifications/register-device` | POST | Register push token |
| `/api/notifications/unregister-device` | POST | Remove push token |
| `/api/notifications/stats` | GET | Unread count, last 7 days trend |

### 7.3 Admin Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/notifications/broadcast` | POST | System-wide broadcast notification |
| `/api/notifications/templates` | GET | List email/push templates |
| `/api/notifications/templates` | PUT | Update template |

---

## 8. UI Components

### 8.1 Notification Center Dropdown (`NotificationDropdown.jsx`)
- Renders in `TopNav` beside bell icon
- Shows last 10 notifications
- "Mark all read" inline action
- Click notification → navigate + mark read
- "View all" link → `/notifications`
- Empty state

### 8.2 NotificationToast Container
- Wraps app in `ToastProvider` (Radix)
- Listens to real-time notifications
- Auto-shows toast on new INSERT
- Clickable with action_url navigation

### 8.3 Preferences Form (Update existing)
- Persist to `notification_preferences` table
- Save button actually sends PUT to API
- Loading/success states

### 8.4 NotificationBadge
- Replaces hardcoded `3` in `TopNav`
- Connected to unread count via real-time subscription
- Animated on change

### 8.5 Templates Manager (Update existing stub)
- List email templates
- Edit with preview
- Variables system: `{{driver_name}}`, `{{dispatch_number}}`, etc.

---

## 9. Data Flow Diagrams

### 9.1 Trip Assignment Flow
```
Dispatcher assigns trip
         ↓
trips INSERT (or UPDATE driver_id)
         ↓
Postgres trigger: notify_trip_assigned()
         ↓
Check notification_preferences for driver
         ↓
INSERT into notifications (employee_id=driver.employee_id)
         ↓
Supabase Realtime broadcasts INSERT on notifications
         ↓
Driver's client receives via useNotificationsRealtime()
         ↓
Toast notification appears + badge increments
         ↓
Driver clicks → navigates to /dispatch/{id}
```

### 9.2 Dispatch Change Flow
```
Dispatcher updates dispatchschedule
         ↓
Postgres trigger: notify_dispatch_changed()
         ↓
Compare OLD vs NEW (driver, vehicle, time, status)
         ↓
Build contextual message: "Departure moved from 2PM to 4PM"
         ↓
INSERT notification for driver + original dispatcher
         ↓
Realtime broadcast + toast
```

### 9.3 Maintenance Alert Flow
```
Cron job (pg_cron or Edge Function) runs daily
         ↓
Query: maintenance_date IN (7 days, 3 days, tomorrow, today, overdue)
         ↓
For each vehicle:
  - Check if notification already sent (dedup by reference_id + type + date)
  - INSERT notification for fleet_manager/ admin
         ↓
Alternative: Trigger on INSERT/UPDATE to vehiclemaintenance
  (already exists for new maintenance records)
```

---

## 10. Security & RLS

### 10.1 Existing RLS for Notifications
```sql
-- SELECT: employee_id = current user OR user_id = auth.uid()
-- UPDATE: same filter
-- No INSERT/ DELETE policies for regular users
```

### 10.2 New RLS for `notification_preferences`
```sql
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
  ON notification_preferences FOR SELECT
  USING (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage own preferences"
  ON notification_preferences FOR ALL
  USING (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()));
```

### 10.3 API Route Protection
- All `/api/notifications/*` routes check `createClient()` middleware
- `batch-read` validates notification IDs belong to requesting user
- `broadcast` restricted to `admin` / `system_admin` role
- Register device validates employee_id matches authenticated user

### 10.4 Trigger Security
- All trigger functions use `SECURITY DEFINER`
- Functions only insert notifications for the correct `employee_id`
- No user-supplied data in trigger parameters

---

## 11. Edge Cases

| Edge Case | Handling |
|-----------|----------|
| User not logged in | Skip real-time subscriptions; no badge |
| WebSocket disconnects | Supabase auto-reconnects; use `isConnected` state for indicator |
| Rapid duplicates | Trigger dedup: check existing notification with same `reference_type` + `reference_id` + `type` within last N hours |
| User has no employee_id | Fallback to `user_id` column; notifications to unknown users are skipped |
| Bulk notification on batch update | Trigger uses `FOR EACH ROW`; batch ops may create many rows — acceptable for fleet scale |
| Notification preference not set | Default to `in_app: true, email: false, push: false` |
| Push token expired | Mark device inactive; skip push; retry on next notification attempt |
| Email bounces | Log in `notification_logs`; decrement email preference after 3 bounces |
| User clears all notifications | `deleteNotification` soft-deletes by setting `deleted_at` or hard deletes (current) |
| Multiple browser tabs | Each tab subscribes independently; badge syncs from DB query + real-time |

---

## 12. Implementation Plan (14 Steps)

### Phase 1: Foundation (Steps 1–4)
1. **Migration `007_notification_enhancements.sql`**
   - Create `notification_preferences` table
   - Add columns to `notifications` (`action_url`, `action_label`, `expires_at`)
   - Add indexes for unread count queries
   - Add RLS policies for preferences

2. **Seed notification_preferences**
   - For all existing employees, insert default rows for each event type
   - Migration script with `INSERT ... ON CONFLICT DO NOTHING`

3. **Update `notification.service.js`**
   - Add `getPreferences()`, `updatePreferences()`, `getUnreadCount()`
   - Add `batchMarkAsRead(ids)`, `registerDevice()`, `unregisterDevice()`
   - Return unread count in a dedicated method

4. **New `use-notifications-realtime.js` hook**
   - Subscribe to `notifications` filtered by employee_id
   - Callback for new INSERTs
   - Return `{ newNotification, isConnected, unreadCount }`

### Phase 2: Real-Time & UI (Steps 5–9)
5. **Update `app-shell.jsx` TopNav**
   - Replace hardcoded badge with `NotificationBadge` component
   - Badge reads from real-time subscription
   - Bell icon opens `NotificationDropdown` panel

6. **Build `NotificationDropdown` component**
   - Dropdown panel with last 10 notifications
   - Mark read, mark all read, navigate to notification detail
   - Empty state design

7. **Build `NotificationToast` system**
   - Wrap app in `ToastProvider`
   - Subscribe to real-time inserts
   - Toast with title, message, action button
   - Auto-dismiss + manual dismiss

8. **Integrate with existing `NotificationsPage`**
   - Add real-time updates (invalidate query on new notification)
   - Add bulk actions (select multiple → mark read / delete)
   - Add infinite scroll (load more on scroll)

9. **Wire up Preferences page to backend**
   - Load preferences from API on mount
   - Save changes via PUT `/api/notifications/preferences`
   - Loading/saving/error states

### Phase 3: Triggers & Events (Steps 10–12)
10. **Enhance `003_notification_triggers.sql`** (or new migration)
    - Add trigger functions for: `trip_assigned`, `dispatch_changed`, `trip_started`, `fuel_low`, `maintenance_overdue`
    - Include dedup logic (same notification not sent twice within 1 hour)
    - Include preference check (skip if channel is all disabled)

11. **Build Edge Function for scheduled maintenance checks**
    - `supabase/functions/check-maintenance/index.ts`
    - Runs daily via pg_cron or cron trigger
    - Checks: due in 7 days, due tomorrow, overdue
    - Inserts notifications with dedup

12. **Build email notification pipeline**
    - Edge Function `send-email-notification` triggered on INSERT to notifications
    - Checks `notification_preferences` for email channel
    - Uses Supabase built-in email or Resend/SendGrid
    - Rate-limited (max 10 emails per user per hour)

### Phase 4: Polish (Steps 13–14)
13. **Push notifications**
    - Edge Function `send-push-notification`
    - Registry: store FCM/APNs tokens in `mobiledevices.push_token`
    - Send on new notification INSERT where push is enabled

14. **Testing & edge case hardening**
    - Test concurrent connections (multiple tabs)
    - Test notification delivery under load (100+ concurrent inserts)
    - Test preference toggles (disable all channels → no notifications)
    - Test email bounce handling
    - Test push token rotation
    - Write unit tests for service functions
    - Write integration test for real-time subscription flow

---

## 13. File Changes Summary

| File | Action |
|------|--------|
| `supabase/migrations/007_notification_enhancements.sql` | **CREATE** |
| `supabase/functions/check-maintenance/index.ts` | **CREATE** |
| `supabase/functions/send-email-notification/index.ts` | **CREATE** |
| `supabase/functions/send-push-notification/index.ts` | **CREATE** |
| `supabase/migrations/003_notification_triggers.sql` | **UPDATE** |
| `src/services/notification.service.js` | **UPDATE** |
| `src/hooks/use-realtime.js` | **UPDATE** (add notification-specific subscription) |
| `src/hooks/use-notifications-realtime.js` | **CREATE** |
| `src/components/layout/app-shell.jsx` | **UPDATE** (badge + dropdown) |
| `src/components/notifications/NotificationBadge.jsx` | **CREATE** |
| `src/components/notifications/NotificationDropdown.jsx` | **CREATE** |
| `src/components/notifications/NotificationToast.jsx` | **CREATE** |
| `src/components/providers.jsx` | **UPDATE** (add ToastProvider) |
| `src/app/(dashboard)/notifications/page.js` | **UPDATE** (add real-time, bulk actions) |
| `src/app/(dashboard)/notifications/preferences/page.js` | **UPDATE** (persist to backend) |
| `src/app/(dashboard)/notifications/templates/page.js` | **UPDATE** (functional editor) |
| `src/app/api/notifications/preferences/route.js` | **CREATE** |
| `src/app/api/notifications/batch-read/route.js` | **CREATE** |
| `src/app/api/notifications/register-device/route.js` | **CREATE** |
| `src/app/api/notifications/stats/route.js` | **CREATE** |
| `src/app/api/notifications/broadcast/route.js` | **CREATE** |
| `src/app/api/notifications/templates/route.js` | **CREATE** |

---

## 14. Dependencies

Already in `package.json` (no new deps needed):
- `@supabase/supabase-js` — Realtime subscriptions
- `@supabase/ssr` — Server/client Supabase
- `@radix-ui/react-toast` — Toast notifications
- `@tanstack/react-query` — Server state + cache invalidation
- `zustand` — Optional local state for notification badge
- `lucide-react` — Icons

New deps for push/email (evaluate at implementation):
- `firebase-admin` or `web-push` — Push notifications
- `@sendgrid/mail` or `resend` — Email delivery

---

## 15. Metrics & Success Criteria

| Metric | Target |
|--------|--------|
| Notification delivery latency | < 500ms (Realtime CDC -> client) |
| Unread badge accuracy | 100% (no stale count) |
| Preference save latency | < 200ms |
| Push notification delivery | < 5s |
| Email notification delivery | < 60s |
| Test coverage for notification service | > 80% |
| Concurrent WebSocket connections | Handle 100+ simultaneous users |
| Trigger execution time | < 10ms per row |
