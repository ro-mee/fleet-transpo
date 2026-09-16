"use client";
import { dispatchDecision } from '@/lib/dispatch/decision';
import { optionKey } from './copilot-options';
import { Button } from '@/components/ui/button';
import { ArrowRight, CarFront, Check, ChevronDown, Circle, CircleAlert, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CopilotBubble({children}) {
  return <div className="flex items-start gap-2.5" data-copilot-message="true">
    <div className="relative mt-0.5 size-7 shrink-0 overflow-hidden rounded-full border border-emerald-500/30 bg-emerald-500/10 p-0.5 shadow-2xs">
      <img src="/images/copilot-avatar-blinking.gif" alt="Copilot" className="size-full rounded-full object-cover select-none pointer-events-none"/>
    </div>
    <div className="min-w-0 flex-1 rounded-2xl rounded-tl-xs border border-border/80 bg-surface p-3.5 text-sm leading-relaxed text-foreground shadow-xs">{children}</div>
  </div>;
}
const duration = n => n == null ? 'Unverified' : `${Math.floor(Math.abs(n) / 60) ? `${Math.floor(Math.abs(n) / 60)}h ` : ''}${Math.abs(n) % 60}m${n < 0 ? ' short' : ''}`;
export function PairTemporalFacts({pair, now}) {
  const context = pair.temporalContext;
  const planning = ['FUTURE','SAME_DAY'].includes(context?.horizon);
  const schedule = pair.scheduleEvidence;
  const workload = pair.workloadEvidence;
  const live = !planning && pair.dispatchContext?.liveLocationUsed && pair.proximity && +new Date(pair.proximity.expiresAt) > now;
  return <div className="space-y-1 text-xs text-foreground-secondary">
    {context && <p>{({FUTURE:'Future booking · Schedule fit',SAME_DAY:'Same-day planning',NEAR_DISPATCH:'Approaching pickup',LAST_MINUTE:'Pickup due soon',OVERDUE:'Pickup overdue',INACTIVE:'Not actionable'})[context.horizon]}</p>}
    {schedule?.releaseAt && <p>Previous {schedule.releaseSource === 'recorded completion' ? 'trip completed' : 'booking expected to finish'} at {new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(schedule.releaseAt))}</p>}
    {schedule?.gapMinutes != null && <p>{duration(schedule.gapMinutes)} gap after the preceding booking</p>}
    {schedule?.usableSlackMinutes != null && <p>{duration(schedule.usableSlackMinutes)} preparation slack after travel and required buffer</p>}
    {schedule?.uncertainty && <p>{schedule.uncertainty}</p>}
    {schedule?.nextSlackMinutes != null && <p>{duration(schedule.nextSlackMinutes)} slack before the next booking after transfer and buffer</p>}
    {live ? <p>Live ETA: {pair.proximity.etaMinutes} min{schedule?.pickupMarginMinutes != null && ` · ${duration(schedule.pickupMarginMinutes)} ${schedule.pickupMarginMinutes < 0 ? 'after' : 'before'} pickup`}</p>
      : context && !planning && <p>Live ETA unavailable{pair.expectedRoute?.etaMinutes != null && ` · Predicted transfer: ${pair.expectedRoute.etaMinutes} min`}</p>}
    {workload?.complete ? <p>{workload.serviceDate}: {workload.completedTrips} completed · {workload.activeTrips} active · {workload.scheduledTrips} scheduled trips</p> : <p>Service-date workload unavailable</p>}
    {pair.decisionEvidence?.alternativeAdvantage && <p>{pair.decisionEvidence.alternativeAdvantage}</p>}
  </div>;
}
export function SelectedPairSummary({pair, optionNumber, pending, now}) {
  const checks = pair.checks ?? [];
  const verified = checks.filter(c => c.status === 'verified');
  const attention = checks.filter(c => c.status !== 'verified');
  const schedule = pair.scheduleEvidence;
  const workload = pair.workloadEvidence;
  const checkRows = rows => <ul className="divide-y divide-border">{rows.map(c => {
    const message = c.message?.startsWith(`${c.label}:`) ? c.message.slice(c.label.length + 1).trim() : c.message;
    return <li key={c.id} className="flex items-start gap-2 py-2">
      {c.status === 'verified' ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true"/> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true"/>}
      <div className="min-w-0"><p className="text-sm font-medium">{c.label}</p><p className="text-xs text-foreground-secondary">{message || (c.status === 'verified' ? 'Verified' : 'Needs verification')}</p></div>
    </li>;
  })}</ul>;
  return <div className="space-y-4">
    <div className="flex items-center gap-2 text-sm font-semibold">
      <Check className="size-4 shrink-0" aria-hidden="true"/>
      <p>{optionNumber > 0 ? `Option ${optionNumber} selected` : 'Pair selected'}</p>
    </div>
    <dl className="space-y-2 border-b border-border pb-4">
      <div className="flex items-start gap-3"><CarFront className="mt-0.5 size-4 shrink-0 text-foreground-secondary" aria-hidden="true"/><div className="min-w-0"><dt className="text-xs text-foreground-secondary">Vehicle</dt><dd className="break-words text-base font-semibold">{pair.vehicle?.plate_number || `Vehicle #${pair.vehicle_id}`}</dd></div></div>
      <div className="flex items-start gap-3"><UserRound className="mt-0.5 size-4 shrink-0 text-foreground-secondary" aria-hidden="true"/><div className="min-w-0"><dt className="text-xs text-foreground-secondary">Driver</dt><dd className="break-words text-sm font-medium">{pair.driver?.driver_name || `Driver #${pair.driver_id}`}</dd></div></div>
    </dl>
    {pending ? <p role="status" className="text-sm text-foreground-secondary">I am double-checking this option against the current schedule and queue.</p> : <>
      <section aria-label="Schedule summary" className="space-y-3">
        <h3 className="text-sm font-semibold">Schedule &amp; workload</h3>
        {pair.temporalContext && <p className="text-xs text-foreground-secondary">{({FUTURE:'Future booking · Schedule fit',SAME_DAY:'Same-day planning',NEAR_DISPATCH:'Approaching pickup',LAST_MINUTE:'Pickup due soon',OVERDUE:'Pickup overdue',INACTIVE:'Not actionable'})[pair.temporalContext.horizon]}</p>}
        <dl className="space-y-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><dt className="text-foreground-secondary">Preparation slack</dt><dd className="font-semibold tabular-nums">{duration(schedule?.usableSlackMinutes)}</dd></div>
          {schedule?.releaseAt && Number.isFinite(+new Date(schedule.releaseAt)) && <div><dt className="text-xs text-foreground-secondary">{schedule.releaseSource === 'recorded completion' ? 'Previous trip completed' : 'Previous booking expected to finish'}</dt><dd className="mt-1 font-medium">{new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(schedule.releaseAt))}</dd></div>}
        </dl>
        <p className="text-xs text-foreground-secondary">After transfer time and the required buffer.</p>
        {schedule?.uncertainty && <p className="flex items-start gap-2 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true"/><span>{schedule.uncertainty}</span></p>}
        {!['FUTURE','SAME_DAY','INACTIVE'].includes(pair.temporalContext?.horizon) && pair.temporalContext && <p className="text-sm font-medium">{pair.dispatchContext?.liveLocationUsed && pair.proximity && +new Date(pair.proximity.expiresAt) > now ? `Live ETA: ${pair.proximity.etaMinutes} min` : 'Live ETA unavailable'}</p>}
        {workload?.complete ? <div>
          <p className="mb-2 text-xs text-foreground-secondary">Workload · {workload.serviceDate}</p>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[[workload.completedTrips,'Completed'],[workload.activeTrips,'Active'],[workload.scheduledTrips,'Scheduled']].map(([value,label]) => <div key={label}><dt className="text-xs text-foreground-secondary">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{value ?? 'Unknown'}</dd></div>)}
          </dl>
        </div> : <p className="text-sm text-foreground-secondary">Service-date workload unavailable</p>}
      </section>
      <details className="group border-t border-border pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">Schedule details &amp; recommendation<ChevronDown className="size-4 shrink-0 group-open:rotate-180" aria-hidden="true"/></summary>
        <div className="space-y-3 pb-2">
          {pair.decisionEvidence?.explanation && <p className="text-sm text-foreground-secondary">{pair.decisionEvidence.explanation}</p>}
          <PairTemporalFacts pair={pair} now={now}/>
        </div>
      </details>
      {attention.length > 0 && <section aria-label="Checks needing attention"><h3 className="text-sm font-semibold">Needs attention · {attention.length}</h3>{checkRows(attention)}</section>}
      {verified.length > 0 && <details className="group border-t border-border pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2"><Check className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true"/>{verified.length} of {checks.length} checks verified</span><ChevronDown className="size-4 shrink-0 group-open:rotate-180" aria-hidden="true"/></summary>
        {checkRows(verified)}
      </details>}
      {!checks.length && <p className="text-sm text-foreground-secondary">Checks are not available yet.</p>}
    </>}
  </div>;
}

export function CopilotOptionFlow({options, exclusionReason, busy, onChoose, now}) {
  return <div className="space-y-3">
    <CopilotBubble>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {options.length ? `I found ${options.length} option${options.length === 1 ? '' : 's'} for this reservation.` : 'No eligible assignment is currently available.'}
        </p>
        {!options.length && (
          <p className="text-xs text-foreground-secondary">
            {exclusionReason?.reason || 'Required evidence needs verification. Recheck this reservation.'}
          </p>
        )}
      </div>
    </CopilotBubble>
    {options.map((option, index) => {
      const p = option.pair, decision = dispatchDecision(p, {now});
      const pickup = p.temporalContext?.pickupAt;
      const checks = (p.checks ?? []).filter(c => ['capacity','schedule','maintenance','pairing'].includes(c.id));
      const disabled = busy || p.unavailable || decision.stale || decision.state === 'BLOCKED';
      return <section
        key={optionKey(p)}
        data-copilot-message="true"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Option ${index+1} — ${option.recommended ? 'Recommended' : 'Alternative'}`}
        aria-disabled={disabled}
        onClick={() => { if (!disabled) onChoose(option); }}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onChoose(option);
          }
        }}
        className={cn(
          'group/card rounded-lg border p-3 text-foreground transition-all duration-150',
          disabled
            ? 'cursor-not-allowed opacity-75'
            : 'cursor-pointer hover:border-emerald-600 hover:shadow-md focus-visible:outline-2 focus-visible:outline-emerald-600',
          option.recommended
            ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
            : 'border-border bg-surface'
        )}
      >
        <span className="sr-only">Copilot option</span>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {option.recommended && decision.canConfirm ? (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white shadow-sm">
                <Check className="size-4" aria-hidden="true"/>
              </span>
            ) : (
              <Circle className="size-6 shrink-0 text-foreground-muted stroke-1 transition-colors group-hover/card:text-foreground" aria-hidden="true"/>
            )}
            <span className="text-base font-semibold">Option {index+1}</span>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold',option.recommended ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200')}>
              {option.recommended ? 'Recommended' : 'Alternative'}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-[11px] text-foreground-secondary">Pickup</span>
            <span className="block font-data text-sm font-semibold">
              {pickup && Number.isFinite(+new Date(pickup)) ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(new Date(pickup)) : 'Unverified'}
            </span>
          </span>
        </div>
        <details className="group mt-2" onClick={(e) => e.stopPropagation()}>
          <summary title="Show schedule and workload details" className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] text-foreground-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
            <span className="underline underline-offset-2">Schedule &amp; workload details</span>
          </summary>
          <div className="mt-2 border-t border-border pt-2">
            <p className="mb-2 text-xs font-medium">{decision.canConfirm ? p.decisionEvidence?.label || 'Best schedule fit' : decision.label}</p>
            <PairTemporalFacts pair={p} now={now}/>
            {checks.slice(3).map(c=><p key={c.id} className="mt-1 text-xs text-foreground-secondary">{c.label}: {c.message || c.status}</p>)}
          </div>
        </details>
        <div className="my-3 grid grid-cols-[1.15fr_1fr] items-center rounded-md border-b border-border bg-surface/80 px-2 py-2.5">
          <div className="flex min-w-0 items-center gap-2 pr-2">
            {p.vehicle?.image_url ? <img src={p.vehicle.image_url} alt={p.vehicle.vehicle_name || 'Assigned vehicle option'} className="h-11 w-16 shrink-0 object-contain"/> : <CarFront className="h-11 w-14 shrink-0 text-foreground-muted" aria-hidden="true"/>}
            <div className="min-w-0">
              <p className="text-[11px] text-foreground-secondary">Vehicle</p>
              <p className="break-words font-data text-sm font-semibold leading-tight">{p.vehicle?.plate_number || `Vehicle #${p.vehicle_id}`}</p>
              <p className="mt-0.5 text-xs text-foreground-secondary">{[p.vehicle?.vehicle_name,p.vehicle?.seating_capacity != null ? `${p.vehicle.seating_capacity} seats` : null].filter(Boolean).join(' · ') || 'Details unavailable'}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 border-l border-border pl-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"><UserRound className="size-5" aria-hidden="true"/></span>
            <div className="min-w-0"><p className="text-[11px] text-foreground-secondary">Driver</p><p className="break-words text-sm font-semibold leading-tight">{p.driver?.driver_name || `Driver #${p.driver_id}`}</p><p className="mt-0.5 font-data text-xs text-foreground-secondary">ID {p.driver_id}</p></div>
          </div>
        </div>
        <ul className="mb-3 space-y-1.5 text-xs text-foreground-secondary">{checks.slice(0,3).map(c => <li key={c.id} className="flex items-start gap-2">
          {c.status === 'verified' ? <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white"><Check className="size-3" aria-hidden="true"/></span> : <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden="true"/>}
          <span>{c.label}: {c.message || (c.status === 'verified' ? 'Verified for the booking window' : 'Needs verification')}</span>
        </li>)}</ul>
        {!decision.canConfirm && <p className="mb-3 flex items-start gap-2 text-xs text-warning"><CircleAlert className="size-4 shrink-0" aria-hidden="true"/><span>{p.unavailable ? 'This option is no longer available.' : decision.reasons[0] || decision.label}</span></p>}
        <Button variant="outline" size="sm" className={cn('h-9 w-full rounded-md text-sm font-semibold',option.recommended ? 'border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800 hover:text-white' : 'border-slate-400 bg-transparent text-foreground hover:bg-hover')}
          disabled={disabled} onClick={(e) => { e.stopPropagation(); if (!disabled) onChoose(option); }}>Choose Option {index+1}<ArrowRight className="ml-1 size-4" aria-hidden="true"/></Button>
      </section>;
    })}
    {options.some(o => ['FUTURE','SAME_DAY'].includes(o.pair.temporalContext?.horizon)) && <p className="text-xs text-foreground-secondary">Based on the current schedule. Rechecked before assignment and dispatch. Live pickup ETA is not shown yet because the vehicle&apos;s location near departure is not known.</p>}
  </div>;
}
