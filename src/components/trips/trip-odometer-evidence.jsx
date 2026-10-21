"use client";

import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api/client";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const STAGES = [{ key: "start", label: "Starting odometer" }, { key: "end", label: "Ending odometer" }];

function numeric(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function distanceLabel(source) {
  if (source === "odometer") return "From odometer readings";
  if (source === "gps-trail") return "GPS distance";
  if (source === "trip-distance") return "Saved trip distance";
  return "Source not recorded";
}

export function TripOdometerEvidence({ trip }) {
  const { employee } = useAuth();
  const actorId = employee?.employee_id ?? null;
  return <TripOdometerEvidenceQuery key={`${actorId}:${trip.trip_id}`} trip={trip} actorId={actorId} />;
}

function TripOdometerEvidenceQuery({ trip, actorId }) {
  const id = Number(trip.trip_id);
  const query = useQuery({
    queryKey: ["trip-odometer-evidence", actorId, id],
    queryFn: ({ signal }) => apiFetch(`/api/trips/${id}/odometer`, { signal }),
    enabled: actorId != null && Number.isSafeInteger(id) && id > 0,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    meta: { persist: false },
  });
  return <TripOdometerEvidenceContent trip={trip} data={actorId == null ? undefined : query.data} loading={query.isLoading} error={query.isError} refreshing={query.isFetching} onRetry={query.refetch} />;
}

export function TripOdometerEvidenceContent({ trip, data, loading = false, error = false, refreshing = false, onRetry }) {
  const [preview, setPreview] = useState(null);
  const [failedPhotos, setFailedPhotos] = useState({});
  const opener = useRef(null);
  const descriptionId = useId();
  const plate = trip.vehicles?.plate_number || "Vehicle plate not recorded";
  const active = !["Completed", "Cancelled"].includes(trip.trip_status);
  const distance = numeric(data?.distance_km) ?? numeric(trip.distance);
  const source = data ? data.distance_source : trip.distance_provenance;
  const sides = STAGES.map(stage => {
    const evidence = data?.[stage.key];
    const reading = numeric(evidence?.reading_km) ?? numeric(trip[`${stage.key}_odometer`]);
    const failed = failedPhotos[stage.key];
    let photoMessage = "No photo recorded";
    if (!data) photoMessage = loading ? "Loading photo..." : "Photos could not be loaded";
    else if (failed || evidence?.photo_state === "unavailable") photoMessage = "Photo unavailable";
    else if (stage.key === "end" && active && reading == null) photoMessage = "Not recorded yet";
    return { ...stage, evidence, reading, photoMessage, showPhoto: !!evidence?.photo_url && !failed };
  });
  const selected = sides.find(side => side.key === preview);
  const unavailable = sides.some(side => failedPhotos[side.key] || side.evidence?.photo_state === "unavailable");

  function openPhoto(side, event) {
    opener.current = event.currentTarget;
    setPreview(side.key);
  }

  function photoFailed(stage) {
    setFailedPhotos(current => ({ ...current, [stage]: true }));
  }

  async function retry() {
    const result = await onRetry?.();
    if (result?.isSuccess) setFailedPhotos({});
  }

  return (
    <Card className="rounded-3xl border-0 bg-surface shadow-xs">
      <CardContent className="p-4 md:p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Odometer evidence</h2>
          <div>
            <p className="text-sm text-foreground-secondary">Distance travelled</p>
            <p className="text-xl font-semibold tabular-nums text-foreground">{distance == null ? "Not recorded" : <>{distance.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="text-sm font-normal">km</span></>}</p>
            {distance != null && <p className="mt-1 text-xs text-foreground-secondary">{distanceLabel(source)}</p>}
          </div>
        </div>

        {(error || unavailable) && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-hover/40 p-3">
            <p role="status" className="text-sm text-foreground-secondary">{error ? "Odometer photos could not be loaded. Saved readings are still shown." : "A photo is unavailable. Retry to refresh photo access."}</p>
            <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={retry}>{refreshing ? "Refreshing..." : "Retry"}</Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {sides.map(side => {
            const photoName = `View ${side.label.toLowerCase()} photo for ${plate}`;
            const hasPhotoEvidence = !!side.evidence?.photo_url || side.evidence?.photo_state === "unavailable";
            return (
              <section key={side.key} aria-label={side.label} className="min-w-0 space-y-3">
                <h3 className="text-sm font-medium text-foreground-secondary">{side.label}</h3>
                {hasPhotoEvidence ? (
                  <Button type="button" variant="ghost" aria-label={photoName} onClick={event => openPhoto(side, event)} className="aspect-[16/10] h-auto w-full overflow-hidden rounded-xl bg-hover p-0">
                    {side.showPhoto ? <img src={side.evidence.photo_url} alt={`${side.label} dashboard photo for ${plate}`} className="h-full w-full object-contain" onError={() => photoFailed(side.key)} /> : <span className="text-sm text-foreground-secondary">Photo unavailable</span>}
                  </Button>
                ) : (
                  <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 rounded-xl bg-hover text-foreground-secondary" role="status">
                    <Camera className="h-6 w-6" aria-hidden="true" />
                    <p className="text-sm">{side.photoMessage}</p>
                  </div>
                )}
                <div>
                  <p className="text-[28px] font-semibold leading-tight tabular-nums text-foreground">{side.reading == null ? <span className="text-base font-normal text-foreground-secondary">{active && side.key === "end" ? "Not recorded yet" : "Not recorded"}</span> : <>{side.reading.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="text-sm font-normal text-foreground-secondary">km</span></>}</p>
                  {side.evidence?.recorded_at && <p className="mt-1 text-xs text-foreground-secondary">Recorded {formatDateTime(side.evidence.recorded_at)}</p>}
                </div>
                {hasPhotoEvidence && <Button type="button" variant="outline" size="sm" aria-label={photoName} onClick={event => openPhoto(side, event)}>View photo</Button>}
              </section>
            );
          })}
        </div>

        <Dialog open={!!selected} onOpenChange={open => { if (!open) setPreview(null); }}>
          <DialogContent className="w-[calc(100%-2rem)] min-w-0 max-w-4xl" aria-describedby={descriptionId} onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}>
            <DialogHeader>
              <DialogTitle>{selected?.label || "Odometer photo"} · {plate}</DialogTitle>
              <div id={descriptionId}><DialogDescription>Full dashboard photo saved with this trip&apos;s {selected?.key === "end" ? "ending" : "starting"} odometer reading.</DialogDescription></div>
            </DialogHeader>
            <div className="m-4 flex min-h-40 items-center justify-center rounded-xl bg-hover p-2 md:m-6">
              {selected?.showPhoto ? <img src={selected.evidence.photo_url} alt={`${selected.label} dashboard photo for ${plate}, full view`} className="max-h-[60dvh] w-full object-contain" onError={() => photoFailed(selected.key)} /> : <div className="space-y-3 p-6 text-center"><p role="status" className="text-sm text-foreground-secondary">Photo unavailable</p><Button type="button" variant="outline" onClick={retry} disabled={refreshing}>{refreshing ? "Refreshing..." : "Retry"}</Button></div>}
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setPreview(null)}>Close</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
