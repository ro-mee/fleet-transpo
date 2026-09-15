"use client";
import { dispatchDecision } from '@/lib/dispatch/decision';
import { optionKey } from './copilot-options';
import { Button } from '@/components/ui/button';

export function CopilotBubble({children}) {
  return <div className="flex items-start gap-2" data-copilot-message="true">
    <img src="/images/copilot-avatar.png" alt="Copilot" className="mt-0.5 size-6 shrink-0 rounded-full"/>
    <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-border bg-surface p-3 text-sm leading-relaxed text-foreground">{children}</div>
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
export function CopilotOptionFlow({options, exclusionReason, busy, onChoose, now}) {
  return <div className="space-y-3">
    <p className="text-sm">{options.length ? `I found ${options.length} option${options.length === 1 ? '' : 's'} for this reservation.` : 'No eligible assignment is currently available.'}</p>
    {!options.length && <p className="text-sm text-foreground-secondary">{exclusionReason?.reason || 'Required evidence needs verification. Recheck this reservation.'}</p>}
    {options.map((option, index) => {
      const p = option.pair, decision = dispatchDecision(p, {now});
      return <CopilotBubble key={optionKey(p)}><section className="space-y-2" aria-label={`Option ${index+1}`}>
        <p className="text-xs font-semibold">Option {index+1} — {option.recommended ? 'Recommended' : 'Alternative'}</p>
        <h3 className="text-sm font-semibold">{p.driver?.driver_name || `Driver #${p.driver_id}`} · {p.vehicle?.vehicle_name} · {p.vehicle?.plate_number || `Vehicle #${p.vehicle_id}`}</h3>
        <p className="text-xs font-medium">{decision.canConfirm ? p.decisionEvidence?.label || 'Best schedule fit' : decision.label}</p>
        <PairTemporalFacts pair={p} now={now}/>
        <ul className="text-xs text-foreground-secondary space-y-1">{(p.checks ?? []).filter(c => c.status === 'verified' && ['capacity','schedule','maintenance','pairing'].includes(c.id)).map(c => <li key={c.id}>{c.label}: {c.message || 'Verified for the booking window'}</li>)}</ul>
        {!decision.canConfirm && decision.reasons[0] && <p className="text-xs text-warning">{decision.reasons[0]}</p>}
        {p.unavailable && <p className="text-xs text-warning">This option is no longer available.</p>}
        <Button variant="outline" size="sm" disabled={busy || p.unavailable || decision.stale || decision.state === 'BLOCKED'} onClick={() => onChoose(option)}>Choose Option {index+1}</Button>
      </section></CopilotBubble>;
    })}
    {options.some(o => ['FUTURE','SAME_DAY'].includes(o.pair.temporalContext?.horizon)) && <p className="text-xs text-foreground-secondary">Based on the current schedule. Rechecked before assignment and dispatch. Live pickup ETA is not shown yet because the vehicle&apos;s location near departure is not known.</p>}
  </div>;
}
