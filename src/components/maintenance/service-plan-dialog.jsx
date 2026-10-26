"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { apiFetch } from "@/lib/api/client";
import { validateIntervals, validateOdometerObservation } from "@/lib/maintenance/service-catalog";
import { refreshMaintenance } from "@/lib/maintenance/outlook-display";

export default function ServicePlanDialog({action,onClose}) {
  const {kind,row} = action;
  const service = row.service;
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const [values,setValues] = useState(() => ({interval_days:service?.interval_days ?? "",interval_km:service?.interval_km ?? "",last_service_date:service?.last_service_date ?? "",last_service_mileage:service?.last_service_mileage ?? "",next_service_date:service?.next_service_date ?? "",next_service_mileage:service?.next_service_mileage ?? "",deferred_until:service?.deferred_until ?? "",defer_reason:service?.deferral_reason ?? "",reading_km:"",observed_at:"",reason:""}));
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  const [conflicted,setConflicted] = useState(false);
  const title = kind === "odometer" ? "Record odometer" : kind === "defer" ? "Defer for review" : service ? "Edit schedule" : "Set schedule";
  const change = (name,value) => setValues(previous => ({...previous,[name]:value}));
  async function save(event) {
    event.preventDefault();
    if (submitting.current || conflicted) return;
    setError("");
    const identity = {vehicle_id:row.vehicle.vehicle_id,service_code:service?.service_code || row.service_code || "routine",expected_version:service?.version ?? 0};
    let body;
    if (kind === "odometer") {
      const time = values.observed_at ? new Date(values.observed_at) : null;
      const valid = validateOdometerObservation({...values,observed_at:time && Number.isFinite(time.getTime()) ? time.toISOString() : ""});
      if (!valid.ok) {setError(Object.values(valid.errors)[0]);return;}
      if (row.vehicle.mileage != null && valid.data.reading_km < row.vehicle.mileage) {setError("Reading is below the current odometer. Enter the current reading or a higher value.");return;}
      body = valid.data;
    } else if (kind === "defer") {
      if (!values.deferred_until || !values.defer_reason.trim()) {setError("Enter a review date and reason. The original due facts still apply.");return;}
      body = {...identity,deferred_until:values.deferred_until,defer_reason:values.defer_reason.trim()};
    } else {
      const valid = validateIntervals({...values,service_code:identity.service_code});
      if (!valid.ok) {setError(Object.values(valid.errors)[0]);return;}
      body = {...identity,...valid.data};
    }
    submitting.current = true; setSaving(true);
    try {
      await apiFetch(kind === "odometer" ? `/api/vehicles/${row.vehicle.vehicle_id}/odometer` : "/api/maintenance/service-plans",{method:kind === "odometer" ? "POST" : "PUT",body});
      await refreshMaintenance(queryClient);
      onClose();
    } catch (failure) {
      setError(failure.message || "Could not save. Your entries have been kept.");
      if (failure.status === 409) {setConflicted(true);await refreshMaintenance(queryClient);}
    } finally {submitting.current=false;setSaving(false);}
  }
  const number = (name,label,min=0) => <Field key={name} label={label}><Input aria-label={label} name={name} type="number" min={min} step={name === "interval_days" ? "1" : "any"} value={values[name]} onChange={event => change(name,event.target.value)} className="min-h-11" /></Field>;
  const date = (name,label) => <Field key={name} label={label}><DatePicker label={label} value={values[name]} onChange={value => change(name,value)} /></Field>;
  return <Dialog open onOpenChange={open => {if(!open && !saving)onClose();}}><DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto"><form onSubmit={save} className="space-y-4"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{row.vehicle.plate_number} · {kind === "odometer" ? "Manual observation, not photo verification." : row.label}</DialogDescription></DialogHeader>
    {kind === "odometer" ? <>
      <p className="text-sm text-foreground-secondary">Current saved reading: {row.vehicle.mileage == null ? "Not recorded" : `${Number(row.vehicle.mileage).toLocaleString()} km`}</p>
      {number("reading_km","Odometer reading (km)")}
      <Field label="Observation date and time" hint="Choose the time in this device's timezone. The saved evidence is displayed in Manila time."><DateTimePicker disablePast={false} disableFuture label="Observation date and time" value={values.observed_at} onChange={value => change("observed_at",value)} /></Field>
      <Field label="Reason" required><Input aria-label="Reason" name="reason" value={values.reason} maxLength={1000} onChange={event => change("reason",event.target.value)} className="min-h-11" /></Field>
    </> : kind === "defer" ? <>
      <p className="text-sm text-foreground-secondary">This sets a review day. It does not change service due status or vehicle availability.</p>
      {date("deferred_until","Review date")}
      <Field label="Reason" required><Input aria-label="Deferral reason" name="defer_reason" value={values.defer_reason} maxLength={1000} onChange={event => change("defer_reason",event.target.value)} className="min-h-11" /></Field>
    </> : <>
      <p className="text-sm text-foreground-secondary">Use your approved interval or an explicit manual due threshold. No manufacturer interval is assumed.</p>
      <div className="grid gap-4 sm:grid-cols-2">{number("interval_days","Interval (days)",1)}{number("interval_km","Interval (km)",1)}{date("next_service_date","Next due date")}{number("next_service_mileage","Next due odometer (km)")}{date("last_service_date","Last qualifying service date")}{number("last_service_mileage","Last qualifying service odometer (km)")}</div>
      <p className="text-xs text-foreground-secondary">Leaving both intervals blank uses manual thresholds. Missing service history stays unknown.</p>
    </>}
    {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-bg p-3 text-sm text-danger-700 dark:text-foreground">{error}{conflicted && <span className="block mt-1">The outlook has been refreshed. Close this draft and review the latest evidence before reopening. Your entries remain here.</span>}</p>}
    <DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" className="min-h-11" disabled={saving || conflicted}>{saving ? "Saving..." : title}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}
