# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hotel fleet-operations staff at a single organization, in four daily-use roles on the web dashboard:

- **Dispatchers** — live in the reservation queue and dispatch board all day (primary power users).
- **Fleet managers** — own vehicles, drivers, documents, fuel, maintenance.
- **Admins / system admins** — configuration, users, system console.
- **Management** — read-only operational/executive boards.

Drivers are a secondary audience on a separate Expo mobile companion app (out of scope for current design priority, which is the web dashboard).

## Product Purpose

FleetOps runs the full lifecycle of a hotel's guest transportation: requests arrive from an external Booking subsystem, enter a smart priority queue, get scheduled onto an eligible driver+vehicle pair, execute as GPS-tracked trips, and close with fuel and maintenance consequences. Success means a dispatcher can move a request from arrival to completed trip with correct eligibility decisions, and management can see the operation's cost and compliance picture at a glance.

## Positioning

One continuous chain — Transportation Request → Reservation → Dispatch → Trip → resource re-evaluation — instead of separate modules: eligibility is evaluated against the requested time window (TomTom travel time + derived safety buffer, hard-blocking at assign), a deterministic priority engine orders the queue (VIP/emergency aware, admin-tunable thresholds), and AI vehicle–driver recommendations are stored as immutable snapshots. A generic fleet tracker could not truthfully claim the window-aware dispatch gate combined with the Booking-integration anti-corruption layer.

## Operating Context

- Hotel guest transport for a single organization (hotel name is a placeholder; "CoCo Star Hotel" appears in docs only as an example).
- Philippine operating setting: UVVRP number-coding policy module is built in.
- Requests arrive by push/pull integration from an external Booking subsystem (`BOOKING_GATEWAY=mock` until the real one is connected).
- Drivers in the field use the Expo mobile app (Home / Live Map / scan FAB / Trips / Profile) with GPS, camera capture, and push notifications.
- Status today: academic capstone (evaluated as a school deliverable); intended to be pitched to real hotel clients afterward — so demos must hold up against plausible operational data.

## Capabilities and Constraints

- Six roles (`system_admin`, `admin`, `fleet_manager`, `dispatcher`, `driver`, `management`), each with its own workspace, nav, and home route.
- Authorization is enforced in the application layer only (RLS intentionally inert — both DB connections bypass it).
- Database changes go through `npm run db:up` (Supabase CLI and SQL editor are unreliable in this repo).
- Smart-queue thresholds, travel-buffer settings, and UVVRP policy are admin-configurable (`/settings/dispatch`).
- Incidents ground vehicles and interrupt dispatch automatically; fuel requests enforce monthly allocations with Gemini gauge scans; driver work schedules and approved leave hard-block dispatch eligibility.
- Web stack (existing codebase): Next.js 16 App Router, React 19, Tailwind v4, shadcn-style Radix components, TanStack Query/Table, recharts, leaflet, framer-motion.
- Explicitly undecided: final product name; real client hotel identity.

## Brand Commitments

None binding. "FleetOps" and "CoCo Star Hotel" are working placeholders and may both be replaced before pitching.

## Evidence on Hand

- SYSTEM.md (authoritative system reference), README.md, docs/rbac-model.md, docs/design-system.md, Obsidian vault `Capstone/` (architecture, features, database, decisions, journal).
- Live Supabase schema captured in generated `schema.sql`; 73 applied migrations; seed/demo tooling (`npm run seed:*`).
- No real customers, testimonials, case studies, or deployment metrics exist — future work must not fabricate any.

## Product Principles

1. **Operational truth wins** — every surface mirrors the real state machines; never fake or soften a status.
2. **One chain, not modules** — request → dispatch → trip continuity stays visible as work moves across screens.
3. **Fail closed** — blocked eligibility is stated explicitly with its reason, never silently hidden.
4. **Role clarity** — each role gets its own workspace; shared boards remain read-only where the spec says so.
5. **Pitch-grade credibility** — every screen must survive being shown to a real hotel decision-maker.
