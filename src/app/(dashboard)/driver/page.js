"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CarFront,
  Fuel,
  IdCard,
  MapPin,
  Navigation,
  ShieldAlert,
  ShieldCheck,
  Truck,
} from "lucide-react";
import {
  getMyDriverProfile,
  getMyLeaveRequests,
  getMyTrips,
  getMyVehicleInspection,
  getMyWorkSchedule,
} from "@/services/driver.service";
import { getFuelRequests } from "@/services/fuel.service";
import { getNotifications } from "@/services/notification.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";

const ACTIVE_TRIP_STATUSES = new Set([
  "Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned",
  "Dispatched", "Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard",
  "In Progress", "En Route", "Drop-off", "Arrived", "Scheduled",
]);

function formatDateTime(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function routeLabel(trip) {
  const request = trip?.transportation_requests;
  const route = trip?.routes;
  return {
    pickup: request?.pickup_location || route?.origin || "Pickup not recorded",
    dropoff: request?.dropoff_location || route?.destination || "Destination not recorded",
  };
}

function ActionLink({ href, icon: Icon, label, detail }) {
  return (
    <Link href={href} className="group flex min-h-16 items-center gap-3 rounded-[16px] border border-border/70 bg-surface px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all hover:bg-hover/80 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]">
      <Icon className="h-5 w-5 shrink-0 text-primary group-hover:scale-110 transition-transform" />
      <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold text-foreground tracking-tight">{label}</p><p className="mt-0.5 truncate text-[13px] text-foreground-secondary">{detail}</p></div>
      <ArrowRight className="h-5 w-5 text-foreground-muted transition-transform group-hover:text-foreground group-hover:translate-x-0.5" />
function FeedState({ queries, children, errorTitle = "This information is unavailable" }) {
  const feeds = Array.isArray(queries) ? queries : [queries];
  if (feeds.some((query) => query.isLoading)) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (feeds.some((query) => query.isError)) return <div className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700" role="alert">{errorTitle}. Use Retry in the alert above.</div>;
  return children;
}

export default function DriverHomePage() {
  useRequireRole();

  const profileQuery = useQuery({ queryKey: ["driver-me"], queryFn: getMyDriverProfile });
  const tripsQuery = useQuery({ queryKey: ["driver-trips", "dashboard"], queryFn: () => getMyTrips({ limit: 100 }), enabled: Boolean(profileQuery.data) });
  const scheduleQuery = useQuery({ queryKey: ["driver-work-schedule", "self"], queryFn: getMyWorkSchedule, enabled: Boolean(profileQuery.data) });
  const leaveQuery = useQuery({ queryKey: ["driver-leave", "self"], queryFn: getMyLeaveRequests, enabled: Boolean(profileQuery.data) });
  const inspectionQuery = useQuery({ queryKey: ["driver-vehicle-inspection"], queryFn: getMyVehicleInspection, enabled: Boolean(profileQuery.data) });
  const fuelQuery = useQuery({ queryKey: ["fuel-requests", "driver"], queryFn: () => getFuelRequests(), enabled: Boolean(profileQuery.data) });
  const notificationsQuery = useQuery({ queryKey: ["notifications", "driver-dashboard"], queryFn: () => getNotifications(), enabled: Boolean(profileQuery.data) });

  const profile = profileQuery.data;
  const activeTrips = useMemo(() => (tripsQuery.data || [])
    .filter((trip) => ACTIVE_TRIP_STATUSES.has(trip.trip_status))
    .sort((a, b) => new Date(a.dispatchschedules?.scheduled_departure || a.start_time || a.created_at) - new Date(b.dispatchschedules?.scheduled_departure || b.start_time || b.created_at)), [tripsQuery.data]);
  const currentTrip = activeTrips.find((trip) => ["Trip Started", "At Pickup", "Passenger Onboard", "In Progress", "En Route", "Drop-off", "Arrived"].includes(trip.trip_status)) || activeTrips[0] || null;
  const todaySchedule = scheduleQuery.data?.days?.find((day) => Number(day.day_of_week) === new Date().getDay());
  const currentLeave = (leaveQuery.data || []).find((item) => item.status === "Approved" || item.status === "Pending");
  const latestFuel = fuelQuery.data?.rows?.[0] || null;
  const importantNotifications = (notificationsQuery.data || []).filter((item) => !item.is_read || ["Alert", "Warning"].includes(item.type)).slice(0, 4);
  const tripRoute = routeLabel(currentTrip);

  if (profileQuery.isLoading) {
    return <div className="space-y-6"><Skeleton className="h-36 w-full rounded-2xl" /><Skeleton className="h-72 w-full rounded-2xl" /></div>;
  }

  if (profileQuery.isError || !profile) {
    return <EmptyState icon={ShieldCheck} title="Driver profile unavailable" description="We couldn't load your profile. Try again or contact your fleet administrator." />;
  }

  return (
    <DriverConsentGate>
      <div className="w-full space-y-6">
        <HeroHeader
          icon={Truck}
          title={`Hello, ${profile.firstName}`}
          badge="Driver Workspace"
          description="Welcome to your Driver Workspace. Pick a module below to get started."
        />

        {[tripsQuery, scheduleQuery, leaveQuery, inspectionQuery, fuelQuery, notificationsQuery].some((query) => query.isError) && (
          <div className="space-y-2">
            {[
              [tripsQuery, "Your trip list could not be loaded"],
              [scheduleQuery, "Your work schedule could not be loaded"],
              [leaveQuery, "Your leave status could not be loaded"],
              [inspectionQuery, "Your latest vehicle inspection could not be loaded"],
              [fuelQuery, "Your fuel request status could not be loaded"],
              [notificationsQuery, "Your notifications could not be loaded"],
            ].map(([query, title]) => <QueryErrorBanner key={title} query={query} title={title} description="Other self-service information remains available." />)}
          </div>
        )}

        {profile.driverStatus === "Suspended" && (
          <Link href="/driver/profile" className="flex items-center gap-3 rounded-2xl bg-danger-bg px-5 py-4 text-danger-700 transition-colors hover:bg-danger-bg/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div className="flex-1"><p className="text-sm font-semibold">Driving access suspended</p><p className="text-xs">Review your profile and license record, or contact Fleet Operations.</p></div>
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(19rem,0.65fr)]">
          <Card className="overflow-hidden rounded-2xl border-border/80">
            <CardHeader className="border-b border-border/70 p-5">
              <div className="flex items-start justify-between gap-4">
                <div><CardTitle className="text-base">{currentTrip ? "Current / next trip" : "Trip queue"}</CardTitle><p className="mt-1 text-xs text-foreground-secondary">Your own assignment, route and scheduled start.</p></div>
                {currentTrip && <StatusBadge status={currentTrip.trip_status} entity="trip" />}
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {tripsQuery.isError ? <div className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700" role="alert">Your trip queue is unavailable. Use Retry in the alert above.</div> : tripsQuery.isLoading ? <Skeleton className="h-44 w-full rounded-xl" /> : currentTrip ? (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><p className="text-xs text-foreground-secondary">Scheduled start</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatDateTime(currentTrip.dispatchschedules?.scheduled_departure || currentTrip.start_time)}</p></div>
                    <div><p className="text-xs text-foreground-secondary">Vehicle</p><p className="mt-1 text-lg font-semibold text-foreground">{currentTrip.vehicles?.plate_number || profile.assignedVehicle?.plateNumber || "Not assigned"}</p></div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[2rem_minmax(0,1fr)]">
                    <div className="flex flex-col items-center"><MapPin className="h-4 w-4 text-primary" /><span className="my-1 h-7 w-px bg-border" /><Navigation className="h-4 w-4 text-success" /></div>
                    <div className="space-y-4"><div><p className="text-xs text-foreground-secondary">Pickup</p><p className="text-sm font-medium text-foreground">{tripRoute.pickup}</p></div><div><p className="text-xs text-foreground-secondary">Destination</p><p className="text-sm font-medium text-foreground">{tripRoute.dropoff}</p></div></div>
                  </div>
                  <Link href="/driver/trips" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:text-slate-950">View my trips <ArrowRight className="h-4 w-4" /></Link>
                </div>
              ) : <EmptyState icon={Truck} title="No active trip assignment" description="New assignments appear here after Fleet Operations schedules them." action={<Link href="/driver/trips" className="text-sm font-semibold text-primary hover:underline">View trip history</Link>} className="py-10" />}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-border/80">
            <CardHeader className="border-b border-border/70 p-5"><CardTitle className="text-base">Today’s duty</CardTitle><p className="text-xs text-foreground-secondary">Work schedule and current leave request.</p></CardHeader>
            <CardContent className="space-y-5 p-5"><FeedState queries={[scheduleQuery, leaveQuery]} errorTitle="Today’s duty information is unavailable">
              <div><p className="text-xs text-foreground-secondary">Shift</p><p className="mt-1 text-base font-semibold text-foreground">{!todaySchedule ? "No schedule on file" : todaySchedule.is_rest_day ? "Rest day" : `${todaySchedule.shift_start?.slice(0, 5) || "—"}–${todaySchedule.shift_end?.slice(0, 5) || "—"}`}</p>{todaySchedule?.break_start && <p className="mt-1 text-xs text-foreground-secondary">Break {todaySchedule.break_start.slice(0, 5)}–{todaySchedule.break_end?.slice(0, 5)}</p>}</div>
              <div><p className="text-xs text-foreground-secondary">Leave</p>{currentLeave ? <div className="mt-2 flex items-center justify-between gap-3"><span className="text-sm text-foreground">{currentLeave.leave_type || "Leave request"}</span><StatusBadge status={currentLeave.status} entity="leave" /></div> : <p className="mt-1 text-sm font-medium text-foreground">No current request</p>}</div>
              <Link href="/driver/schedule" className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline">Open schedule and leave <ArrowRight className="h-3.5 w-3.5" /></Link>
            </FeedState></CardContent>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="rounded-2xl border-border/80"><CardHeader className="border-b border-border/70 p-5"><CardTitle className="flex items-center gap-2 text-sm"><CarFront className="h-4 w-4 text-primary" /> Vehicle readiness</CardTitle></CardHeader><CardContent className="space-y-4 p-5"><FeedState queries={inspectionQuery} errorTitle="The latest vehicle inspection is unavailable"><div><p className="text-lg font-semibold text-foreground">{profile.assignedVehicle?.plateNumber || "No vehicle assigned"}</p>{profile.assignedVehicle && <StatusBadge status={profile.assignedVehicle.vehicleStatus} entity="vehicle" className="mt-2" />}</div><div><p className="text-xs text-foreground-secondary">Latest inspection</p><p className="mt-1 text-sm font-medium text-foreground">{inspectionQuery.data ? `${inspectionQuery.data.inspection_type || "Inspection"} · ${formatDateTime(inspectionQuery.data.inspection_date)}` : "No inspection recorded"}</p>{inspectionQuery.data?.status && <StatusBadge status={inspectionQuery.data.status} className="mt-2" />}</div><Link href="/driver/vehicle" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open my vehicle <ArrowRight className="h-3.5 w-3.5" /></Link></FeedState></CardContent></Card>
          <Card className="rounded-2xl border-border/80"><CardHeader className="border-b border-border/70 p-5"><CardTitle className="flex items-center gap-2 text-sm"><Fuel className="h-4 w-4 text-primary" /> Fuel request</CardTitle></CardHeader><CardContent className="space-y-4 p-5"><FeedState queries={fuelQuery} errorTitle="Fuel request status is unavailable">{latestFuel ? <><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-foreground">Request #{latestFuel.fuel_request_id}</p><StatusBadge status={latestFuel.status} entity="fuel" /></div><p className="text-xs text-foreground-secondary">{latestFuel.requested_liters ? `${latestFuel.requested_liters} L requested` : "Requested amount not recorded"}</p></> : <p className="text-sm text-foreground-secondary">No fuel request recorded.</p>}<Link href="/driver/fuel" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open fuel workspace <ArrowRight className="h-3.5 w-3.5" /></Link></FeedState></CardContent></Card>
          <Card className="rounded-2xl border-border/80"><CardHeader className="border-b border-border/70 p-5"><CardTitle className="flex items-center gap-2 text-sm"><ShieldAlert className="h-4 w-4 text-danger" /> Safety action</CardTitle></CardHeader><CardContent className="space-y-4 p-5"><p className="text-sm leading-relaxed text-foreground-secondary">Report an incident, near miss or assistance request as soon as it is safe.</p><Link href="/driver/incidents" className="inline-flex items-center gap-2 rounded-xl bg-danger px-4 py-2.5 text-sm font-semibold text-white hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2">Report incident <ArrowRight className="h-4 w-4" /></Link></CardContent></Card>
        </div>
        <Card className="overflow-hidden rounded-2xl border-border/80"><CardHeader className="border-b border-border/70 p-5 bg-hover/30"><div className="flex items-center justify-between gap-4"><div><CardTitle className="text-[15px] font-semibold text-foreground tracking-tight">Important notifications</CardTitle><p className="mt-1 text-xs text-foreground-secondary">Unread items plus alerts and warnings for your account.</p></div><Link href="/notifications" className="text-xs font-semibold text-primary hover:underline">View all</Link></div></CardHeader><CardContent className="p-0"><FeedState queries={notificationsQuery} errorTitle="Important notifications are unavailable">{importantNotifications.length ? <div className="divide-y divide-border/40">{importantNotifications.map((item) => <div key={item.notification_id} className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-hover/40"><div className="relative mt-0.5"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" /><span className="absolute -top-1 -right-1 flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75"></span><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-warning"></span></span></div><div><p className="text-sm font-semibold text-foreground tracking-tight">{item.title || item.type || "Notification"}</p><p className="mt-0.5 text-[13px] text-foreground-secondary">{item.message || "No additional detail recorded"}</p></div></div>)}</div> : <EmptyState icon={ShieldCheck} title="No important notifications" description="You're caught up on unread items, alerts, and warnings." className="py-10" />}</FeedState></CardContent></Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionLink href="/driver/trips" icon={Truck} label="My trips" detail={`${profile.performance?.total_trips ?? 0} completed in performance history`} />
          <ActionLink href="/driver/schedule" icon={CalendarCheck} label="Schedule & leave" detail="Weekly duty and requests" />
          <ActionLink href="/driver/profile" icon={IdCard} label="Profile & license" detail={`Driver status: ${profile.driverStatus || "Unknown"}`} />
        </div>
      </div>
    </DriverConsentGate>
  );
}
