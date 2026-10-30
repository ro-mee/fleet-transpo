'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { submitInternalCargoReview } from '@/services/cargo-review.client';
import { createCargoDecisionCommandManager } from './cargo-decision-command';

const OPTIONS = {
  SOURCE: { title: 'Review pickup', receipt: 'pickup_receipt', choices: [['ACCEPT_OBSERVED','Accept observed quantities'],['WAIT','Hold for review or recount'],['REJECT_PICKUP','Reject this pickup']] },
  SECUREMENT: { title: 'Clear departure', receipt: 'pickup_receipt', choices: [['CLEAR','Confirm safe loading and clear departure'],['WAIT','Hold departure']] },
  RECEIVER: { title: 'Review delivery', receipt: 'delivery_receipt', choices: [['ACCEPT_DELIVERY','Accept this delivery'],['WAIT','Hold delivery for review']] },
};
const CHECKS = [['load_secured','The load is secured for travel.'],['vehicle_safe','The vehicle is safe to depart with this load.'],['counts_reviewed','I reviewed the counts, acknowledgment and available photos.']];

export function InternalCargoReviewActions({ tripId, tripStatus, view, onSaved }) {
  const [kind, setKind] = useState(null), [action, setAction] = useState('');
  const [reason, setReason] = useState(''), [checks, setChecks] = useState({}), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), opener = useRef(null);
  const [target, setTarget] = useState(null);
  const [commands] = useState(() => createCargoDecisionCommandManager({
    createId: () => crypto.randomUUID(),
    send: (id, payload) => { const { event_id, ...body } = payload; return submitInternalCargoReview(id, { ...body, submission_id: event_id }); },
  }));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (view?.manifest?.source_ref?.system !== 'INTERNAL') return null;
  const pickup = view.pickup_receipt, delivery = view.delivery_receipt;
  const beforeDeparture = ['Trip Started','At Pickup'].includes(tripStatus);
  const receiving = ['Drop-off','Arrived'].includes(tripStatus);
  const accepted = pickup && view.source_decision?.receipt_id === pickup.receipt_id && view.source_decision?.action === 'ACCEPT_OBSERVED';
  const available = [beforeDeparture && pickup ? 'SOURCE' : null, beforeDeparture && accepted ? 'SECUREMENT' : null, receiving && delivery ? 'RECEIVER' : null].filter(Boolean);
  const selected = OPTIONS[kind], receipt = selected ? view[selected.receipt] : null;
  const evidenceIds = target?.evidenceIds || [];
  const requiresChecks = kind === 'SECUREMENT' && action === 'CLEAR';
  const changed = !!kind && target?.version !== view.version;
  const ready = Boolean(receipt && !changed && action && reason.trim() && reviewed && (!requiresChecks || CHECKS.every(([key]) => checks[key] === true)));

  function open(next, trigger) {
    opener.current = trigger;
    const selectedReceipt = view[OPTIONS[next].receipt];
    setTarget({ receiptId: selectedReceipt.receipt_id, version: view.version, evidenceIds: [...new Set((selectedReceipt.payload?.lines || []).flatMap(line => line.evidence_ids || []))] });
    setKind(next); setAction(OPTIONS[next].choices[0][0]); setReason(''); setChecks({}); setReviewed(false); setError(''); setNotice('');
  }
  async function submit() {
    if (busy || (!uncertain && !ready)) return;
    setBusy(true); setError(''); setNotice('');
    const result = await commands.submit({ tripId: Number(tripId), createPayload: event_id => ({
      event_id, receipt_id: target.receiptId, expected_version: target.version, kind, action, reason: reason.trim(), reviewed_evidence_ids: target.evidenceIds,
      ...(kind === 'SECUREMENT' ? { securement_checks: { load_secured: !!checks.load_secured, vehicle_safe: !!checks.vehicle_safe, counts_reviewed: !!checks.counts_reviewed } } : {}),
    }) });
    if (!alive.current) return;
    setBusy(false);
    if (result.status === 'accepted') {
      setUncertain(false); setKind(null); setNotice('Manager review saved. The current trip permissions will refresh.');
      try { await onSaved?.(); } catch { if (alive.current) setError('Review saved, but refresh failed. Refresh the record before another decision.'); }
    } else {
      setUncertain(result.status === 'uncertain');
      setError(result.status === 'uncertain' ? 'The save result is unknown. Retry this same review before starting a different decision.' : result.error?.message || 'The review could not be saved. Refresh the record and check its current stage.');
    }
  }

  return <Card><CardHeader><CardTitle>Manager review</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-foreground-secondary">Review the actual counts, photos and signatures above. Pickup acceptance, safe departure and receiving are separate decisions.</p>
    {available.length ? <div className="flex flex-wrap gap-2">{available.map(value => <Button key={value} variant={value === 'SOURCE' ? 'default' : 'outline'} onClick={event => open(value, event.currentTarget)} disabled={busy || uncertain}>{OPTIONS[value].title}</Button>)}</div> : <p className="text-sm text-foreground-secondary">{tripStatus === 'Completed' ? 'This trip is complete. Saved review history remains available below.' : 'Waiting for the driver to submit the next observation at the appropriate trip stage.'}</p>}
    {notice ? <p role="status" className="text-sm text-success-700">{notice}</p> : null}
    {!kind && error ? <p role="alert" className="text-sm text-danger-700">{error}</p> : null}
    {view.internal_reviews?.length ? <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4">Saved manager reviews</summary><ol className="mt-3 space-y-3">{view.internal_reviews.map((item, index) => <li key={item.review_id || index} className="text-sm"><p className="font-medium">{OPTIONS[item.kind]?.title || item.kind}: {String(item.action || '').replaceAll('_',' ')}</p><p className="break-words text-foreground-secondary">{item.reason}</p></li>)}</ol></details> : null}
    <Dialog open={!!kind} onOpenChange={value => { if (!value && !busy && !uncertain) setKind(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}><DialogHeader><DialogTitle>{selected?.title || 'Cargo review'}</DialogTitle><DialogDescription>This records your review of the exact current observation. A new count needs a new review.</DialogDescription></DialogHeader>
      <div className="space-y-4 px-6 pb-6">
        <div className="space-y-2"><Label htmlFor="internal-review-action">Decision</Label><Select value={action} onValueChange={setAction} disabled={busy || uncertain}><SelectTrigger id="internal-review-action"><SelectValue /></SelectTrigger><SelectContent>{selected?.choices.map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="internal-review-reason">Review note <span className="text-danger-700">*</span></Label><textarea id="internal-review-reason" className="min-h-28 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} disabled={busy || uncertain} placeholder="Explain what you checked and why this decision is appropriate." /></div>
        <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={busy || uncertain} /><span>I reviewed the counts, acknowledgment and all {evidenceIds.length} attached {evidenceIds.length === 1 ? 'photo' : 'photos'}. {evidenceIds.length === 0 ? 'No receipt photos were supplied; my note explains the review basis.' : 'Use View photo above to inspect the evidence before accepting.'}</span></label>
        {requiresChecks ? <fieldset className="space-y-2 rounded-xl border border-border p-4"><legend className="px-1 text-sm font-medium">Departure safety confirmation</legend>{CHECKS.map(([key,label]) => <label key={key} className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={!!checks[key]} onChange={event => setChecks(current => ({ ...current, [key]: event.target.checked }))} disabled={busy || uncertain} /><span>{label}</span></label>)}</fieldset> : null}
        {error ? <p role="alert" className="text-sm text-danger-700">{error}</p> : null}
        {changed && !uncertain ? <p role="alert" className="text-sm text-warning-700">The record changed while this review was open. Close this dialog and review the latest counts before deciding.</p> : null}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setKind(null)} disabled={busy || uncertain}>Cancel</Button><Button onClick={submit} disabled={busy || (!uncertain && !ready)}>{busy ? 'Saving review…' : uncertain ? 'Retry same review' : 'Save manager review'}</Button></div>
      </div>
    </DialogContent></Dialog>
  </CardContent></Card>;
}
