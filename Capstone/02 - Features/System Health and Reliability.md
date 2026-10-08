---
type: feature
title: System Health and Reliability
tags: [feature, system, health, monitoring, reliability, super-admin, telemetry]
source:
  - src/app/(dashboard)/system/health/page.js
  - src/app/api/system/health/route.js
  - src/lib/system-health.js
  - src/services/system-health.service.js
tables:
  - system_health_snapshots
  - app_errors
  - push_outbox
  - integration_log
  - ailogs
  - audit_logs
  - system_settings
last_verified: 2026-10-03
---

# System Health and Reliability

## 1. Architectural Boundary & Separation of Concerns

A core architectural tenet of the FleetOps platform is the strict separation between:
1. **Platform / System Health (`/system/health`)**: Intended strictly for **Super Admin and IT Administration**. Monitors server runtime, database latency, storage buckets, external integration queues, push delivery pipelines, AI provider outages, authentication failure spikes, and cron schedulers.
2. **Fleet Operations / Vehicle Health (`/fleet/*`, `/maintenance/*`)**: Owned by **Fleet Managers and Operations**. Tracks vehicle availability, PMS intervals, breakdowns, downtime, LTO/LTFRB document expirations, and GPS hardware telemetry.

Conflating these two layers creates an unmaintainable "dashboard junk drawer." Separating them aligns FleetOps with enterprise telematics and fleet standards (e.g., Geotab Maintenance Overview vs. Samsara Device & Platform Health) and provides clear architectural defense to the academic panel.

---

## 2. The Nine Monitored Technical Subsystems

The module gathers live signals across nine technical components. Every probe is isolated; an outage in one subsystem never crashes the health evaluation for the others.

| Subsystem | Signal Probed | Thresholds / Semantic States | Safe Remediation Action |
|---|---|---|---|
| **Application Runtime** | `app_errors` in last 15 min | `0`: Operational · `1–4`: Attention · `5+`: Degraded | Link to `/system/errors` (Error Log) |
| **Database** | `SELECT 1` + execution latency | `<300ms`: Operational · `300–1000ms`: Attention · `>1000ms` or unreachable: Degraded | Retry Probe |
| **Integrations** | `integration_log` outbound status in 24h | `0` pending & `0` failed: Operational · `pending > 0`: Attention · `failed > 0`: Degraded | `POST /api/system/health/integration-retry` |
| **Push Notifications** | `push_outbox` status & age | `0` stale/error: Operational · `pending > 5m`: Attention · `error > 0`: Degraded | `POST .../push-retry` or `POST .../push-review` |
| **AI Services** | `ailogs` errors in last 24h | `0`: Operational · `1–4`: Attention · `5+`: Degraded | Link to `/settings/ai/logs` or `POST .../ai-review` |
| **Authentication** | `audit_logs` login failures in 24h | `0–4`: Operational · `5–19`: Attention · `20+`: Degraded | Link to `/system/audit` (Security Audit) |
| **Scheduled Jobs** | `system_settings` cron heartbeat | `≤24h`: Operational · `24–26h`: Attention · `>26h`/missing: Degraded | `POST /api/system/health/sync-now` |
| **File Storage** | Supabase Storage bucket listing | All buckets reachable: Operational · Failure/error: Degraded | Retry Probe |
| **Maps & Routing** | TomTom Routing API connectivity | Key active & `<1000ms`: Operational · Key missing: Attention (Heuristic) · Timeout/error: Degraded | Retry Probe |

### Remediation Routing Invariant
System Health owns **detection** and **remediation routing**. The specialized modules own the actual repair. Nothing in System Health automatically applies destructive fixes.

---

## 3. Real Telemetry Engine & Mathematics

The system uses observed health checks and timestamped tables. A health request records one real snapshot before reading history. Earlier generated rows with empty `subsystems` JSON are excluded from historical calculations; they must not be interpreted as measured checks. Missing samples display as unavailable.

### KPI Formulas
1. **Sampled Availability (%)**: the fraction of observed health checks that were not degraded. Attention counts as available; unknown samples are excluded. This is a sampled health signal, not a continuous uptime SLA.
2. **App Errors**: the actual count of `app_errors` in the selected period. No API error rate is shown because the application does not measure a reliable total request denominator.
3. **Push Delivery Rate (%)**:
   $$\text{Push Delivery Rate} = \frac{\text{Sent}}{\text{Total Outbox Rows in Window}} \times 100$$
   The outbox schema has `pending`, `sent`, and `error` statuses; there is no `delivered` status. If there are no rows, the rate is unavailable.
4. **Database Latency Analytics**:
   - `Current`: Real-time probe response in milliseconds, or unavailable if the probe failed.
   - `Average`: Arithmetic mean across recorded snapshot points in timeframe.
   - `P95`: 95th percentile latency from sorted array.
   - `Peak`: Maximum latency recorded in the active timeframe.
5. **Active Incidents**:
   Real-time count of subsystems currently in `attention` or `degraded` state.

---

## 4. Database Schema: `system_health_snapshots` (Migration 142)

```sql
CREATE TABLE public.system_health_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recorded_at timestamptz DEFAULT now() NOT NULL,
  overall_status text NOT NULL CHECK (overall_status IN ('operational', 'attention', 'degraded', 'unknown')),
  availability_pct numeric(5,2) NOT NULL DEFAULT 100.00,
  db_latency_ms integer NOT NULL DEFAULT 0,
  app_errors_count integer NOT NULL DEFAULT 0,
  active_incidents_count integer NOT NULL DEFAULT 0,
  subsystems jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);
```

### Security & Access Control
- **RLS Enabled**: `ALTER TABLE system_health_snapshots ENABLE ROW LEVEL SECURITY;`
- **Privileges**: Explicitly revoked from `anon` and `authenticated`. Accessible only through backend database connection pool over `DATABASE_URL` (`BYPASSRLS`).
- **PostgREST Probe**: Verified via `npm run verify:anon` (HTTP 401/42501 refused — PASS).
- **Catalog Registry**: Registered in `scripts/lib/schema-contract.mjs` with 0 contract violations.

---

## 5. UI Architecture: Command Center Experience

The frontend at `/system/health` (`src/app/(dashboard)/system/health/page.js`) features:
1. **Header Controls**: Period toggles (`24H`, `7D`, `30D`), manual Refresh button with spinner, and status pills.
2. **Top KPI Strip**: 5 stat cards featuring sampled availability, App Errors, DB Response (Current + P95), Push Delivery Rate, and Active Incidents.
3. **Dual Interactive Charts**:
   - **System Reliability Trend**: Interactive Recharts AreaChart with metric switcher (Combined, Availability %, DB Latency ms).
   - **Errors & Failures Over Time**: Stacked BarChart categorizing errors across Application, Integration, Push Queue, AI Services, and Authentication.
4. **Active Platform Incidents Triage**: Real-time cards displaying root cause, affected subsystem, severity, and instant remediation triggers. In calm state, renders a zero-incident assurance medallion.
5. **Subsystem Registry**: Complete table with squircle icon medallions, status badges, expandable diagnostic summaries, error samples, and safe action buttons.

---

## 6. Verification & Acceptance Record

- **Unit & Integration Tests**:
  - `src/lib/system-health.test.js`: row evaluations and telemetry cases cover empty history, measured latency, and actual push denominator.
  - `src/app/api/system/health/route.test.js`: 2/2 tests passing (permission guards, full telemetry payload, timeframe routing).
  - `src/components/dashboard/system-admin-cards.test.js`: 7/7 tests passing (cards render without synthetic fallbacks).
- **Security & Schema Suite**:
  - `npm run db:check`: 141 migrations valid, frozen duplicates honored.
  - The 2026-10-03 read-only live review confirmed `db:status` at 141 applied / 0 pending / 0 changed, `db:contract` at 68 classified relations / 0 violations, and `verify:anon` explicitly refused `system_health_snapshots` (HTTP 401/42501). The anon probe had zero exposed relations; 48 empty responses remain inconclusive from outside and are resolved by the RLS catalog.
  - All four telemetry SELECT queries were run in one read-only live transaction (25 error buckets, 1 snapshot bucket, 6 latency rows, 1 push aggregate). The live table contained 58 snapshots, including 52 old rows with empty `subsystems` JSON; the corrected queries exclude those 52 rows. No live row was deleted or inserted during this review.
  - `npx eslint`: 0 errors, 0 warnings across all touched files.
