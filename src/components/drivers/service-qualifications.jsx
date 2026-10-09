"use client";

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { useRoleAccess } from '@/hooks/use-role-access';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const groups = {
  PASSENGER: { title: 'Passenger Driver', services: ['Guest Transport', 'VIP Guest Transport'] },
  CARGO: { title: 'Cargo Logistics Driver', services: ['Restaurant Supply Pickup', 'Restaurant Food Delivery', 'Hotel Supply Transfer'] },
};
const statuses = { NOT_APPROVED: 'Not approved', ACTIVE: 'Active', SUSPENDED: 'Suspended', REVOKED: 'Revoked' };
const controlClass = 'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
function reviewDate(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(value));
}

export function QualificationReview({ qualification, history, canManage, configuredPolicy, reviewDisabled = false, onSave }) {
  const { group, status, version, policy_version, reviewer_name, verified_by, verified_at } = qualification;
  const [nextStatus, setNextStatus] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const prefix = `qualification-${group}`;

  async function submit(event) {
    event.preventDefault();
    if (saving || reviewDisabled || !nextStatus || !reason.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ group, status: nextStatus, policy_version: nextStatus === 'ACTIVE' ? configuredPolicy : policy_version ?? null, reason: reason.trim(), expected_version: version });
      setReason('');
      setMessage({ error: false, text: 'Review saved.' });
    } catch (error) {
      setMessage({ error: true, text: error.message || 'Could not save this review. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby={`${prefix}-title`} className="space-y-4 py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${prefix}-title`} className="text-base font-semibold text-foreground">{groups[group].title}</h3>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground">{statuses[status] ?? status}</span>
      </div>
      <p className="text-sm text-foreground-secondary">Allowed services after approval: {groups[group].services.join(' · ')}</p>
      {status === 'NOT_APPROVED' && <p className="text-sm text-foreground-secondary">No approval has been recorded for this group.</p>}
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-foreground-secondary">Last approval reviewer</dt><dd className="mt-1 font-medium">{reviewer_name || (verified_by ? `Staff #${verified_by}` : 'Not recorded')}</dd></div>
        <div><dt className="text-foreground-secondary">Approval date (Manila)</dt><dd className="mt-1 font-medium">{reviewDate(verified_at)}</dd></div>
        <div><dt className="text-foreground-secondary">Policy version</dt><dd className="mt-1 break-words font-medium">{policy_version || 'Not recorded'}</dd></div>
      </dl>
      {canManage && (
        <form onSubmit={submit} className="space-y-3">
          {!configuredPolicy && <p className="text-sm text-foreground-secondary">Approval is unavailable until an approved policy is configured. Existing reviews may still be suspended or revoked.</p>}
          {configuredPolicy && <p className="text-sm text-foreground-secondary">Policy for new approval: <span className="break-words font-medium text-foreground">{configuredPolicy}</span></p>}
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor={`${prefix}-status`}>Review action</Label>
            <select id={`${prefix}-status`} name="status" value={nextStatus} onChange={event => setNextStatus(event.target.value)} required disabled={saving || reviewDisabled} className={controlClass}>
              <option value="">Choose an action</option>
              <option value="ACTIVE" disabled={!configuredPolicy}>Approve as Active</option>
              <option value="SUSPENDED">Suspend</option>
              <option value="REVOKED">Revoke</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-reason`}>Reason for review</Label>
            <textarea id={`${prefix}-reason`} name="reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required rows={3} disabled={saving || reviewDisabled} className={controlClass} aria-describedby={`${prefix}-reason-help`} />
            <p id={`${prefix}-reason-help`} className="text-xs text-foreground-secondary">Record the checks or circumstances behind this decision. This review does not approve cargo shortages or replace license and safety checks.</p>
          </div>
          <Button type="submit" disabled={saving || reviewDisabled || !nextStatus || !reason.trim() || (nextStatus === 'ACTIVE' && !configuredPolicy)}>{saving ? 'Saving and reloading…' : 'Save review'}</Button>
          {message && <p role={message.error ? 'alert' : 'status'} className="text-sm text-foreground">{message.text}</p>}
        </form>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer rounded-lg py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Review history ({history.length})</summary>
        {history.length === 0 ? <p className="py-2 text-foreground-secondary">No reviews recorded.</p> : (
          <ol className="divide-y divide-border">
            {history.map(event => <li key={event.event_id} className="space-y-1 py-3">
              <p className="font-medium">{statuses[event.new_status]} · {event.actor_name || `Staff #${event.actor_id}`}</p>
              <p className="text-xs text-foreground-secondary">{reviewDate(event.occurred_at)} (Manila) · Version {event.version} · Policy {event.policy_version || 'not recorded'}</p>
              <p className="whitespace-pre-wrap break-words text-foreground-secondary">{event.reason}</p>
            </li>)}
          </ol>
        )}
      </details>
    </section>
  );
}

export function ServiceQualifications({ driverId }) {
  const { can } = useRoleAccess();
  const canRead = can('driver_qualifications', 'read');
  const path = `/api/drivers/${driverId}/qualifications`;
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['driver-qualifications', driverId],
    queryFn: async () => (await apiFetch(path)).data,
    enabled: canRead && Boolean(driverId),
    retry: false,
  });
  if (!canRead) return null;

  async function save(body) {
    await apiFetch(path, { method: 'PUT', body });
    try {
      await refetch({ throwOnError: true });
    } catch {
      throw new Error('The review was saved, but the current state could not be loaded. Please reload qualifications before reviewing again.');
    }
  }

  return (
    <Card className="rounded-2xl border-border/60 shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Service qualifications</CardTitle>
          <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>Reload qualifications</Button>
        </div>
        <CardDescription>Passenger and cargo approval are reviewed separately. A driver may hold both.</CardDescription>
      </CardHeader>
      <CardContent>
        {!data ? (isLoading ? <p role="status" className="text-sm text-foreground-secondary">Loading qualifications…</p>
          : <p role="alert" className="text-sm text-foreground-secondary">Qualifications could not be loaded. Reload qualifications to try again.</p>)
          : <div className="space-y-4">
            {isError && <p role="alert" className="text-sm text-foreground-secondary">Showing the last loaded qualifications. Reload qualifications successfully before reviewing again. Your draft has been kept.</p>}
            <div className="divide-y divide-border">{data.groups.map(qualification => (
              <QualificationReview key={`${driverId}-${qualification.group}-${qualification.version}`} qualification={qualification}
                history={data.history.filter(event => event.new_group === qualification.group)} canManage={data.can_manage}
                configuredPolicy={data.configured_policy_version} reviewDisabled={isError} onSave={save} />
            ))}</div>
          </div>}
      </CardContent>
    </Card>
  );
}
