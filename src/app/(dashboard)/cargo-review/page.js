'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Plus, RefreshCw } from 'lucide-react';
import { useRequireRole } from '@/lib/auth/role-guard';
import { getInternalCargoReviews } from '@/services/cargo-review.client';
import { DataTable } from '@/components/tables/data-table';
import { HeroHeader } from '@/components/ui/hero-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDateTime } from '@/lib/utils';

const STAGES = { all: 'All Cargo jobs', unassigned: 'Awaiting dispatch', pickup: 'Pickup and departure', delivery: 'Delivery and receiving', completed: 'Completed' };

export default function CargoReviewPage() {
  useRequireRole();
  const { data: session, status } = useSession();
  const [stage, setStage] = useState('all'), [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const user = session?.user;
  const scope = `${user?.employeeId || ''}:${user?.sessionId || ''}:${user?.role || ''}`;
  const query = useQuery({ queryKey: ['internal-cargo-review',scope,stage,search,page],
    queryFn: ({ signal }) => getInternalCargoReviews({ stage, search, page: page + 1, limit: 20 }, { signal }),
    enabled: status === 'authenticated', retry: false, staleTime: 0, gcTime: 0, refetchInterval: 20000 });
  const columns = useMemo(() => [
    { key: 'reservation_number', label: 'Cargo job', render: (value,row) => <div className="min-w-40"><p className="font-medium">{value || `Request #${row.request_id}`}</p><p className="mt-1 max-w-72 whitespace-normal text-xs text-foreground-secondary">{row.cargo_description}</p></div> },
    { key: 'pickup_datetime', label: 'Pickup schedule', render: value => <span className="font-data tabular-nums">{formatDateTime(value)}</span> },
    { key: 'pickup_location', label: 'Route', render: (value,row) => <div className="max-w-64 whitespace-normal"><p>{value}</p><p className="mt-1 text-xs text-foreground-secondary">To {row.dropoff_location || 'Destination unavailable'}</p></div> },
    { key: 'driver_name', label: 'Driver / vehicle', render: (value,row) => <div><p>{value || 'Not assigned'}</p><p className="mt-1 text-xs text-foreground-secondary">{row.plate_number || row.vehicle_name || 'No vehicle assigned'}</p></div> },
    { key: 'stage', label: 'Review stage', render: (value,row) => <div className="space-y-1"><Badge variant="outline">{STAGES[value] || 'Check record'}</Badge><p className="text-xs text-foreground-secondary">{row.trip_status || row.fleet_status}</p></div> },
    { key: 'actions', label: 'Action', render: (_,row) => <Button asChild variant="outline" size="sm"><Link href={row.trip_id ? `/cargo-review/${row.trip_id}` : `/reservations/${row.request_id}`}>{row.trip_id ? 'Review Cargo' : 'Open reservation'}</Link></Button> },
  ], []);
  return <div className="space-y-6">
    <HeroHeader icon={ClipboardCheck} title="Cargo Review" description="Inspect driver observations and evidence, then record pickup, departure and receiving decisions." actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className="mr-2 size-4" aria-hidden="true" />Refresh</Button><Button asChild><Link href="/reservations/new"><Plus className="mr-2 size-4" aria-hidden="true" />Add reservation</Link></Button></div>} />
    <div className="max-w-sm space-y-2"><Label htmlFor="cargo-review-stage">Review stage</Label><Select value={stage} onValueChange={value => { setStage(value); setPage(0); }}><SelectTrigger id="cargo-review-stage"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STAGES).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    {query.isError ? <div role="alert" className="space-y-3 rounded-2xl border border-border bg-surface p-6"><h2 className="font-semibold">Cargo jobs could not be loaded</h2><p className="text-sm text-foreground-secondary">{query.error?.message || 'Check your connection and try again.'}</p><Button variant="outline" onClick={() => query.refetch()}>Retry loading jobs</Button></div> : <DataTable columns={columns} data={query.data?.rows || []} isLoading={query.isLoading} title="Internal Cargo jobs" description="Open a trip to inspect its actual observations. Jobs awaiting dispatch open their reservation." searchPlaceholder="Search request, location, driver or plate…" searchValue={search} onSearchChange={value => { setSearch(value); setPage(0); }} manualPagination pageIndex={page} onPageChange={setPage} pageSize={20} rowCount={query.data?.total || 0} emptyTitle="No Cargo jobs in this view" emptyDescription="Create a Cargo reservation with its items, or change the stage and search filters." isFiltered={stage !== 'all' || !!search} onResetFilters={() => { setStage('all'); setSearch(''); setPage(0); }} />}
  </div>;
}
