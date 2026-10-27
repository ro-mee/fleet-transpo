'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { useRequireRole } from '@/lib/auth/role-guard';
import { getInternalCargoReviews } from '@/services/cargo-review.client';
import { getCargoExecution } from '@/services/cargo-execution.client';
import { CargoVerificationPanelContent } from '@/components/cargo/cargo-verification-panel';
import { CargoHandoverEvidence } from '@/components/cargo/cargo-handover-evidence';
import { InternalCargoReviewActions } from '@/components/cargo/internal-cargo-review-actions';
import { HeroHeader } from '@/components/ui/hero-header';
import { Button } from '@/components/ui/button';

export default function CargoReviewDetailPage() {
  useRequireRole();
  const params = useParams(), tripId = Number(params.id);
  const { data: session, status } = useSession(), client = useQueryClient();
  const user = session?.user, scope = `${tripId}:${user?.employeeId || ''}:${user?.sessionId || ''}:${user?.role || ''}`;
  const allowed = status === 'authenticated' && Number.isSafeInteger(tripId) && tripId > 0;
  const job = useQuery({ queryKey: ['internal-cargo-job',scope], queryFn: ({signal}) => getInternalCargoReviews({trip_id:tripId,limit:1},{signal}), enabled:allowed,retry:false,gcTime:0,refetchInterval:15000 });
  const row = allowed ? job.data?.rows?.[0] : null;
  const cargo = useQuery({ queryKey: ['internal-cargo-detail',scope], queryFn: ({signal}) => getCargoExecution(tripId,{signal}),enabled:allowed && !!row,retry:false,gcTime:0,staleTime:0,refetchInterval:15000 });
  const view = cargo.isError || !allowed ? null : cargo.data;
  async function refresh() {
    await Promise.all([job.refetch(),cargo.refetch(),client.invalidateQueries({queryKey:['internal-cargo-review']})]);
  }
  const error = job.error || cargo.error;
  return <div className="space-y-6">
    <Button asChild variant="ghost" size="sm"><Link href="/cargo-review"><ArrowLeft className="mr-2 size-4" aria-hidden="true" />Cargo review queue</Link></Button>
    <HeroHeader icon={ClipboardCheck} title={row?.reservation_number || `Cargo trip #${Number.isSafeInteger(tripId) ? tripId : 'unavailable'}`} description={row ? `${row.pickup_location} → ${row.dropoff_location || 'Destination unavailable'}` : 'Review the current Cargo observation and required next decision.'} actions={row ? <Button asChild variant="outline"><Link href={`/trips/${tripId}`}>Open trip details</Link></Button> : null} />
    {job.isLoading ? <p role="status" className="text-sm text-foreground-secondary">Loading Cargo job…</p> : null}
    {!job.isLoading && !job.isError && !row ? <p role="alert" className="rounded-2xl border border-border bg-surface p-6">This internal Cargo trip is unavailable or access has changed. Return to the queue and refresh.</p> : null}
    {error ? <div role="alert" className="space-y-3 rounded-2xl border border-border bg-surface p-6"><p className="font-medium">The current Cargo record could not be loaded</p><p className="text-sm text-foreground-secondary">{error.message}</p><Button variant="outline" onClick={refresh}>Refresh current record</Button></div> : null}
    {row ? <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-foreground-secondary"><p>Driver: <span className="font-medium text-foreground">{row.driver_name || 'Not assigned'}</span></p><p>Vehicle: <span className="font-medium text-foreground">{row.plate_number || row.vehicle_name || 'Unavailable'}</span></p><p>Trip: <span className="font-medium text-foreground">{row.trip_status}</span></p></div> : null}
    {row && !error ? <CargoVerificationPanelContent key={`evidence:${scope}`} tripId={tripId} linkedRequestId={row.request_id} view={view} isLoading={cargo.isLoading} onRefresh={refresh} handoverEvidence={<CargoHandoverEvidence tripId={tripId} manifest={view?.manifest} pickupRecorded={!!view?.pickup_receipt} deliveryRecorded={!!view?.delivery_receipt} />} /> : null}
    {view && row && !error ? <InternalCargoReviewActions key={`actions:${scope}`} tripId={tripId} tripStatus={row.trip_status} view={view} onSaved={refresh} /> : null}
  </div>;
}
