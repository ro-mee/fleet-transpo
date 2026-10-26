"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { dueLabel, outlookRows, outlookPermissions, workOrderHref } from "@/lib/maintenance/outlook-display";
import ServiceOutlookDetail from "./service-outlook-detail";
import ServiceOutlookActions from "./service-outlook-actions";

export default function ServiceOutlook({ data, isLoading, isError, onRetry }) {
  const { employee } = useAuth();
  const permissions = outlookPermissions(employee);
  const [selectedKey, setSelectedKey] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState(null);
  const detailRef = useRef(null);
  const openerRef = useRef(null);
  const [actionOpener, setActionOpener] = useState(null);
  function openAction(value) { setActionOpener(document.activeElement); setAction(value); }
  function closeAction() { setAction(null); requestAnimationFrame(() => actionOpener?.focus()); }
  const rows = outlookRows(data?.predictions || []);
  const filtered = rows.filter(row => `${row.vehicle.plate_number} ${row.vehicle.vehicle_name} ${row.label}`.toLowerCase().includes(search.toLowerCase()));
  const selected = filtered.find(row => row.key === selectedKey) || filtered[0];
  const mutable = !isError;
  function review(row, event) {
    openerRef.current = event.currentTarget;
    setSelectedKey(row.key); setMobileDetail(true);
    requestAnimationFrame(() => detailRef.current?.focus());
  }
  function nextAction(row) {
    const href = workOrderHref(row.order, permissions);
    if (href) return <Button asChild variant="outline" className="min-h-11"><Link href={href}>View work order</Link></Button>;
    if (row.order) return <span className="text-xs text-foreground-secondary">Work order: {row.order.status}</span>;
    if (!mutable) return null;
    if (row.kind === "setup" && permissions.configure) return <Button variant="outline" className="min-h-11" onClick={() => openAction({kind: "plan", row})}>Set schedule</Button>;
    if (row.kind === "service" && row.service.dataIssues?.includes("missing_mileage") && permissions.odometer) return <Button variant="outline" className="min-h-11" onClick={() => openAction({kind: "odometer", row})}>Record odometer</Button>;
    if (row.kind === "service" && row.service.plan_id && permissions.schedule) return <Button variant="outline" className="min-h-11" onClick={() => openAction({kind: "schedule", row})}>Schedule service</Button>;
    return null;
  }
  if (isLoading && !data) return <Card aria-busy="true"><CardContent className="space-y-4 p-6"><p role="status">Loading service outlook</p><div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[0,1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div><Skeleton className="h-64" /></CardContent></Card>;
  if (isError && !data) return <Card><CardContent className="p-6 space-y-3"><h2 className="text-lg font-semibold">Service outlook unavailable</h2><p role="alert" className="text-sm text-foreground-secondary">Could not load service evidence. Try again.</p><Button onClick={onRetry}>Retry</Button></CardContent></Card>;
  const services = rows.filter(row => row.kind === "service");
  const orders = new Set(rows.flatMap(row => row.order?.maintenance_id ? [row.order.maintenance_id] : []));
  const counts = [
    ["Overdue services", services.filter(row => row.service.serviceStatus === "overdue").length, "services"],
    ["Due within 7 days", services.filter(row => row.service.effectiveDays != null && row.service.effectiveDays >= 0 && row.service.effectiveDays <= 7).length, "services"],
    ["Needs data", services.filter(row => row.service.serviceStatus === "needs_data").length + rows.filter(row => row.kind === "setup").length, "service tasks"],
    ["Linked open work orders", orders.size, "work orders"],
  ];
  return <div className="space-y-4">
    {isError && <div role="alert" className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground"><p>Service evidence may be outdated. Refresh before making changes.</p><Button variant="outline" className="mt-2 min-h-11" onClick={onRetry}>Retry</Button></div>}
    <Card><CardContent className="p-4 sm:p-6"><dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">{counts.map(([label,count,unit]) => <div key={label}><dt className="text-xs font-medium text-foreground-secondary">{label}</dt><dd className="mt-1 font-data text-2xl font-semibold">{count}<span className="block text-xs font-normal text-foreground-secondary">{unit}</span></dd></div>)}</dl><p className="mt-4 text-xs text-foreground-secondary">Counts may overlap. Service timing does not establish vehicle availability or completed work.</p></CardContent></Card>
    {!rows.length ? <Card><CardContent className="p-6"><h2 className="text-lg font-semibold">No eligible vehicles to assess</h2><p className="mt-2 text-sm text-foreground-secondary">Service plans appear here when eligible vehicles are recorded. Maintenance work orders are counted separately in the register.</p></CardContent></Card> : <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
      <Card className={mobileDetail ? "hidden xl:block min-w-0" : "min-w-0"}><CardContent className="p-0"><div className="space-y-3 border-b border-border p-4"><h2 className="text-lg font-semibold">Service priority list</h2><Input aria-label="Search services" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search vehicle or service" className="min-h-11" /></div>
        {!filtered.length ? <div className="p-6 space-y-3"><p>No services match this search.</p><Button variant="outline" onClick={() => setSearch("")}>Clear search</Button></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Vehicle service plans and reported inspection findings</caption><thead className="bg-hover text-xs text-foreground-secondary"><tr>{["Vehicle","Service","Due status","Reason / evidence","Next action"].map(label => <th key={label} scope="col" className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{filtered.map(row => <tr key={row.key} className={`border-t border-border ${selected?.key === row.key ? "bg-hover/60" : ""}`}>
          <td className="p-3 align-top"><span className="font-data font-semibold whitespace-nowrap">{row.vehicle.plate_number}</span><span className="block text-xs text-foreground-secondary">{row.vehicle.vehicle_name}</span></td>
          <td className="p-3 align-top font-medium">{row.label}{row.signal && <span className="block text-xs font-normal text-foreground-secondary">{row.signal.checklist_item_id.replaceAll("_", " ")}</span>}</td>
          <td className="p-3 align-top"><Badge className={row.service?.serviceStatus === "overdue" ? "text-danger-700 dark:text-foreground" : ""} variant={row.service?.serviceStatus === "overdue" ? "danger" : "secondary"}>{row.kind === "setup" ? "No schedule" : row.signal ? "Needs review" : dueLabel(row.service)}</Badge>{row.order && <p className="mt-2 text-xs text-foreground-secondary">Work order: {row.order.status}</p>}</td>
          <td className="p-3 align-top text-xs text-foreground-secondary">{row.service?.recommendation || (row.signal ? `${row.signal.count} inspections report this item. Review original evidence.` : "No service interval has been assumed.")}<Button variant="ghost" className="mt-1 min-h-11 px-0 underline underline-offset-4" aria-label={`Review ${row.vehicle.plate_number} ${row.label}`} onClick={event => review(row,event)}>Review</Button></td>
          <td className="p-3 align-top">{nextAction(row)}</td>
        </tr>)}</tbody></table></div>}
      </CardContent></Card>
      {selected && <section ref={detailRef} tabIndex={-1} aria-label="Selected service evidence" className={`${mobileDetail ? "block" : "hidden xl:block"} min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl`}>
        <Button variant="outline" className="mb-3 min-h-11 xl:hidden" onClick={() => {setMobileDetail(false); requestAnimationFrame(() => openerRef.current?.focus());}}>Back to service list</Button>
        <ServiceOutlookDetail row={selected} permissions={permissions} nextAction={nextAction(selected)} onAction={mutable ? kind => openAction({kind,row:selected}) : null} />
      </section>}
    </div>}
    {action && <ServiceOutlookActions action={action} onClose={closeAction} />}
  </div>;
}
