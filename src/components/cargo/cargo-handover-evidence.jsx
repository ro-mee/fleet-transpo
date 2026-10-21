"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { cargoSignaturePaths, validateCargoHandover } from "../../../shared/cargo-handover";
import { getCargoHandovers } from "@/services/cargo-execution.client";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";

const STAGES = [{ key: "pickup", label: "Pickup", stage: "PICKUP" }, { key: "delivery", label: "Delivery", stage: "DELIVERY" }];
const EMPTY = { opened: false, handovers: null, loading: false, error: false };

export function CargoHandoverEvidence({ tripId, manifest, pickupRecorded = false, deliveryRecorded = false }) {
  const { data: session, status } = useSession();
  const user = session?.user;
  const allowed = status === "authenticated" && !!user?.employeeId && !!user?.sessionId;
  const scope = `${tripId}:${allowed ? `${user.employeeId}:${user.sessionId}:${user.role}` : "no-session"}`;
  return <CargoHandoverEvidenceLoader key={scope} tripId={tripId} manifest={manifest} allowed={allowed} pickupRecorded={pickupRecorded} deliveryRecorded={deliveryRecorded} />;
}

function CargoHandoverEvidenceLoader({ tripId, manifest, allowed, pickupRecorded, deliveryRecorded }) {
  const [state, setState] = useState(EMPTY);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  async function load() {
    if (!allowed) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState(current => ({ ...current, opened: true, loading: true, error: false }));
    try {
      const handovers = await getCargoHandovers(tripId, { signal: controller.signal });
      if (!controller.signal.aborted) setState({ opened: true, handovers, loading: false, error: false });
    } catch (error) {
      if (!controller.signal.aborted) {
        const revoked = error?.status === 401 || error?.status === 403 || error?.status === 404;
        const message = error?.code === "CARGO_CONFIGURATION_REQUIRED"
          ? "Cargo signature records are unavailable until cargo operations are configured."
          : revoked ? "Signature access was refused. Refresh this trip and confirm your sign-in before retrying."
            : "Signatures could not be refreshed.";
        setState(current => ({ ...current, handovers: revoked ? null : current.handovers, loading: false, error: message }));
      }
    }
  }

  function hide() {
    request.current?.abort();
    setState(EMPTY);
  }

  return <CargoHandoverEvidenceContent tripId={tripId} manifest={manifest} {...state} disabled={!allowed} onView={load} onHide={hide} pickupRecorded={pickupRecorded} deliveryRecorded={deliveryRecorded} />;
}

function EvidenceTime({ label, value }) {
  const valid = value && Number.isFinite(new Date(value).getTime());
  return <div className="min-w-0"><dt className="text-foreground-secondary">{label}</dt><dd className="mt-1 break-words font-data tabular-nums">{valid ? <time dateTime={value}>{formatDateTime(value)}</time> : "Not recorded"}</dd></div>;
}

function HandoverStage({ label, stage, record, recorded, manifest }) {
  let handover = null;
  let paths = null;
  try {
    if (record?.handover && record.stage === stage) {
      handover = validateCargoHandover(record.handover);
      paths = cargoSignaturePaths(handover.signature);
    }
  } catch { handover = null; }
  const unavailable = !!record?.handover && !handover;
  const empty = record || recorded ? "No signature recorded for this receipt" : `No ${label.toLowerCase()} receipt recorded`;
  const matchingManifest = manifest?.manifest_ref && record?.manifest_ref &&
    ["kind", "id", "revision", "hash"].every(key => manifest.manifest_ref[key] != null && manifest.manifest_ref[key] === record.manifest_ref[key]);

  return (
    <section aria-label={`${label} handover`} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-base font-semibold text-foreground">{label}</h4>
        <Badge variant="secondary">{handover ? "Signature recorded" : unavailable ? "Signature unavailable" : record || recorded ? "No signature" : "No receipt"}</Badge>
      </div>
      <div className="flex aspect-[5/2] items-center justify-center overflow-hidden rounded-xl bg-hover p-3 text-foreground">
        {handover ? (
          <svg viewBox="0 0 600 240" role="img" aria-label={`${label} signature by ${handover.signer_name}`} className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            {paths.map((path, index) => <path key={index} d={path} />)}
          </svg>
        ) : <p role="status" className="text-center text-sm text-foreground-secondary">{unavailable ? "Saved signature is unavailable" : empty}</p>}
      </div>
      {handover && <>
        <div className="break-words"><p className="text-base font-semibold text-foreground">{handover.signer_name}</p><p className="mt-1 text-sm text-foreground-secondary">{handover.signer_role_or_dept}</p></div>
        <dl className="grid gap-3 text-xs text-foreground sm:grid-cols-2">
          <EvidenceTime label="Device capture" value={handover.captured_at} />
          <EvidenceTime label="Server received" value={record.received_at} />
        </dl>
      </>}
      {record && (
        <>
          {!handover && <dl className="text-xs text-foreground"><EvidenceTime label="Server received" value={record.received_at} /></dl>}
          <div className="border-t border-border pt-4">
            <h5 className="text-sm font-semibold text-foreground">Acknowledged item counts</h5>
            <ul className="mt-1 divide-y divide-border text-sm text-foreground-secondary">
              {(record.lines || []).map(line => {
                const item = matchingManifest ? manifest.lines?.find(item => item.line_id === line.line_id) : null;
                return <li key={line.line_id} className="min-w-0 space-y-2 break-words py-3">
                  <p className="font-medium text-foreground">{item?.name || line.line_id} · <span className="font-data tabular-nums">{line.observed_quantity}</span>{item?.unit ? ` ${item.unit}` : ""}</p>
                  <div className="flex flex-wrap items-center gap-2"><span>Condition:</span><Badge variant={line.condition === "DAMAGED" ? "warning" : "secondary"} className={line.condition === "DAMAGED" ? "text-warning-700" : undefined}>{line.condition === "INTACT" ? "Intact" : line.condition === "DAMAGED" ? "Damaged" : line.condition || "Not recorded"}</Badge></div>
                  <p>Issue: {line.issue_code || "Not recorded"}</p>
                  {line.remarks && <p className="leading-relaxed">{line.remarks}</p>}
                </li>;
              })}
            </ul>
          </div>
          <details className="group border-t border-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md py-2 text-sm font-medium text-foreground-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              {label} receipt details<ChevronDown className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform" aria-hidden="true" />
            </summary>
            <div className="space-y-4 pb-2 pt-2 text-xs text-foreground-secondary">
              <div className="space-y-2"><p>Receipt <span className="break-all font-data text-foreground">{record.receipt_id}</span></p><p>Manifest revision {record.manifest_ref?.revision ?? "not recorded"}</p></div>
              <dl className="text-foreground"><EvidenceTime label="Cargo observed" value={record.observed_at} /></dl>
              {handover && <div className="space-y-2">
                {handover.location ? <><p className="break-words font-data tabular-nums">Location: {handover.location.latitude}, {handover.location.longitude}</p><p>Reported accuracy: {handover.location.accuracy_m} m</p><dl><EvidenceTime label="Location captured" value={handover.location.captured_at} /></dl></> : <p>Location not recorded</p>}
              </div>}
            </div>
          </details>
        </>
      )}
    </section>
  );
}

export function CargoHandoverEvidenceContent({ opened = false, handovers, manifest, loading = false, error = false, disabled = false, onView, onHide, pickupRecorded = false, deliveryRecorded = false }) {
  const titleId = useId();
  const regionId = useId();
  const buttonClass = "min-h-11 w-full sm:min-h-9 sm:w-auto";
  return (
    <Card id="cargo-chain-of-custody" tabIndex={-1} className="scroll-mt-24 rounded-card border-border bg-surface shadow-none outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2" aria-labelledby={titleId}>
      <CardContent className="space-y-5 p-4 md:p-6">
        <div className="flex flex-col items-start justify-between gap-4 lg:flex-row">
          <div className="min-w-0"><h3 id={titleId} className="text-base font-semibold text-foreground">Cargo chain of custody</h3><p className="mt-1 max-w-prose text-sm leading-relaxed text-foreground-secondary">Pickup and delivery acknowledgments stay tied to their exact saved item counts.</p></div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
            <Button type="button" size="sm" variant="outline" className={buttonClass} aria-expanded={opened} aria-controls={regionId} disabled={disabled} onClick={opened ? onHide : onView}>{opened ? "Hide signatures" : "View signatures"}</Button>
            {opened && <Button type="button" size="sm" variant="outline" className={buttonClass} disabled={disabled || loading} onClick={onView}>{loading ? "Refreshing signatures…" : error ? "Retry" : "Refresh signatures"}</Button>}
          </div>
        </div>
        {disabled && <p className="text-sm text-foreground-secondary">Your sign-in must be confirmed before viewing private signatures.</p>}
        <p role="status" aria-live="polite" className="sr-only">{opened && (loading ? "Loading signatures…" : handovers ? "Saved signatures loaded." : "")}</p>
        <div id={regionId} hidden={!opened} className="space-y-5">
          {opened && <>
            {error && <p role="alert" className="rounded-control border border-border bg-hover/40 p-3 text-sm leading-relaxed text-foreground">{typeof error === "string" ? error : "Signatures could not be refreshed."} {handovers ? "Previously loaded receipt details are still shown. " : ""}Retry to request the private record again.</p>}
            <div aria-busy={loading}>
              {loading && !handovers && <div aria-hidden="true" className="grid grid-cols-1 gap-6 md:grid-cols-2">{STAGES.map(({ key }) => <div key={key} className="space-y-4"><Skeleton className="h-5 w-28" /><Skeleton className="aspect-[5/2] w-full rounded-xl" /><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-28" /></div>)}</div>}
              {handovers && <div className="grid grid-cols-1 gap-6 md:grid-cols-2">{STAGES.map(({ key, ...stage }) => <HandoverStage key={key} {...stage} record={handovers[key]} manifest={manifest} recorded={key === "pickup" ? pickupRecorded : deliveryRecorded} />)}</div>}
            </div>
            <p className="max-w-prose border-t border-border pt-4 text-xs leading-relaxed text-foreground-secondary">A drawn signature is a human acknowledgment of the saved counts and condition. It does not verify identity, provide server receiving proof, or grant source approval or Fleet clearance.</p>
          </>}
        </div>
      </CardContent>
    </Card>
  );
}
