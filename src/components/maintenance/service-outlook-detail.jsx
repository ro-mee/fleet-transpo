import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { dueLabel } from "@/lib/maintenance/outlook-display";
import { formatDate, formatNumber } from "@/lib/utils";

const km = value => value == null ? "Not recorded" : `${formatNumber(value)} km`;
function Fact({label,children}) { return <div className="space-y-1"><dt className="text-xs text-foreground-secondary">{label}</dt><dd className="text-sm font-medium break-words">{children}</dd></div>; }
export default function ServiceOutlookDetail({row, permissions, nextAction, onAction}) {
  const {vehicle, service, signal, order} = row;
  const evidence = service?.evidence || vehicle.evidence;
  return <Card><CardHeader><p className="font-data text-sm font-semibold">{vehicle.plate_number}</p><CardTitle>{row.label}</CardTitle><p className="text-sm text-foreground-secondary">{service ? dueLabel(service) : signal ? "Reported finding requiring review" : "No schedule configured"}</p></CardHeader><CardContent className="space-y-5">
    {nextAction && <div>{nextAction}</div>}
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
      <Fact label="Service urgency">{service?.recommendation || (signal ? `${signal.count} inspections reported ${signal.checklist_item_id.replaceAll("_", " ")}. This is not a confirmed diagnosis.` : "Set a service interval or explicit due threshold. No manufacturer interval is assumed.")}</Fact>
      <Fact label="Work-order progress">{order ? `#${order.maintenance_id} · ${order.status}` : "No linked open work order"}</Fact>
      <Fact label="Vehicle availability">{vehicle.vehicle_status || "Check the vehicle record and existing dispatch checks. Service urgency alone does not establish availability."}</Fact>
      {service && <><Fact label="Due thresholds">{service.next_service_date ? formatDate(service.next_service_date) : "No calendar threshold"}<span className="block">{service.next_service_mileage == null ? "No mileage threshold" : km(service.next_service_mileage)}</span></Fact><Fact label="Schedule basis">{service.schedule_mode === "interval" ? `${service.interval_days == null ? "No day interval" : `${service.interval_days} days`} / ${service.interval_km == null ? "No km interval" : km(service.interval_km)}` : "Explicit manual due threshold"}</Fact><Fact label="Last qualifying service">{service.last_service_date ? formatDate(service.last_service_date) : "Date not recorded"}<span className="block">{km(service.last_service_mileage)}</span></Fact>
      {service.deferred_until && <Fact label="Deferred for review">{formatDate(service.deferred_until)}<span className="block">{service.deferral_reason}</span><span className="block font-normal">The original due facts still apply.</span></Fact>}</>}
    </dl>
    {evidence && <details className="border-t border-border pt-3" open><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg">Supporting evidence</summary><dl className="space-y-4 pt-2">
      <Fact label="Current odometer">{km(service?.mileage ?? vehicle.mileage)}<span className="block font-normal">{evidence.latestReadingSource === "manual_observation" ? "Manual observation (not photo verified)" : evidence.latestReadingSource === "trip_odometer_photo" ? "Committed trip odometer photo" : evidence.latestReadingSource === "trip_odometer" ? "Trip odometer" : "Source not recorded"}</span><span className="block font-normal">{evidence.latestReadingAt ? new Date(evidence.latestReadingAt).toLocaleString("en-PH", {timeZone: "Asia/Manila"}) + " (Manila)" : "Observation time not recorded"}</span></Fact>
      <Fact label="Measured trip coverage">{evidence.validSampleCount ?? 0} of {evidence.totalSampleCount ?? 0} qualifying completed trips<span className="block">{km(evidence.measuredKm)} over {evidence.observationPeriod?.calendarDays == null ? "an unknown period" : `${Number(evidence.observationPeriod.calendarDays.toFixed(1))} observed calendar days, including idle days`}</span></Fact>
      <Fact label="Mileage forecast basis">{evidence.quality === "sufficient" && evidence.kmPerDay != null ? `About ${Math.round(evidence.kmPerDay)} km/day from measured coverage` : "Limited measured coverage. No mileage day estimate is assumed."}</Fact>
    </dl></details>}
    {signal && <div className="space-y-2"><h3 className="text-sm font-semibold">Original inspections</h3><p className="text-xs text-foreground-secondary">{signal.dates?.map(formatDate).join(", ")}</p>{permissions.staff && signal.sources?.map(source => <Button key={source.inspection_id} asChild variant="outline" className="min-h-11 mr-2"><Link href={source.href}>Review inspection #{source.inspection_id}</Link></Button>)}</div>}
    {onAction && <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      {permissions.odometer && <Button variant="outline" className="min-h-11" onClick={() => onAction("odometer")}>Record odometer</Button>}
      {permissions.configure && !order && !signal && <Button variant="outline" className="min-h-11" onClick={() => onAction("plan")}>{service ? "Edit schedule" : "Set schedule"}</Button>}
      {permissions.configure && service?.plan_id && !order && <Button variant="ghost" className="min-h-11" onClick={() => onAction("defer")}>Defer for review</Button>}
    </div>}
  </CardContent></Card>;
}
