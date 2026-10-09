import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ states: [], cursor: 0, query: {}, queryOptions: null, canRead: true }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal(),
  useState: initial => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial;
    return [harness.states[index], value => { harness.states[index] = typeof value === 'function' ? value(harness.states[index]) : value; }];
  },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: options => { harness.queryOptions = options; return harness.query; } }));
vi.mock('@/hooks/use-role-access', () => ({ useRoleAccess: () => ({ can: () => harness.canRead }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }) => React.createElement('section', null, children),
  CardHeader: ({ children }) => React.createElement('header', null, children),
  CardContent: ({ children }) => React.createElement('div', null, children),
  CardTitle: ({ children }) => React.createElement('h2', null, children),
  CardDescription: ({ children }) => React.createElement('p', null, children),
}));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }) => React.createElement('button', props, children) }));
vi.mock('@/components/ui/input', () => ({ Input: props => React.createElement('input', props) }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }) => React.createElement('label', props, children) }));
import { apiFetch } from '@/lib/api/client';
import { QualificationReview, ServiceQualifications } from './service-qualifications';

const cargo = { group: 'CARGO', status: 'NOT_APPROVED', version: 0 };
const props = { qualification: cargo, history: [], canManage: true, configuredPolicy: 'approved-v2', onSave: vi.fn() };
function review(override = {}) { harness.cursor = 0; return QualificationReview({ ...props, ...override }); }
function find(node, predicate) {
  if (!React.isValidElement(node)) return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) { const result = find(child, predicate); if (result) return result; }
  return null;
}
const form = tree => find(tree, node => node.type === 'form');
const field = (tree, name) => find(tree, node => node.props.name === name);
beforeEach(() => {
  vi.clearAllMocks();
  harness.states = [];
  harness.cursor = 0;
  harness.canRead = true;
  harness.query = { data: { groups: [cargo], history: [], can_manage: true, configured_policy_version: 'approved-v2' }, isLoading: false, isError: false, refetch: vi.fn(async () => ({ data: { groups: [{ ...cargo, status: 'ACTIVE', version: 1 }] } })) };
});

describe('qualification profile display', () => {
  it('shows services and honest missing approval without granting it', () => {
    const html = renderToStaticMarkup(review({ canManage: false }));
    expect(html).toContain('Cargo Logistics Driver');
    expect(html).toContain('Restaurant Supply Pickup');
    expect(html).toContain('Restaurant Food Delivery');
    expect(html).toContain('Hotel Supply Transfer');
    expect(html).toContain('Not approved');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Save review');
  });
  it('shows passenger services, stored reviewer and history', () => {
    const html = renderToStaticMarkup(review({ qualification: { group: 'PASSENGER', status: 'ACTIVE', version: 2, reviewer_name: 'Alex Reviewer', verified_at: '2026-10-09T00:00:00Z', policy_version: 'approved-v1' }, canManage: false, history: [{ event_id: 'event', new_group: 'PASSENGER', new_status: 'ACTIVE', actor_name: 'Alex Reviewer', occurred_at: '2026-10-09T00:00:00Z', reason: 'Training checked.', policy_version: 'approved-v1', version: 2 }] }));
    expect(html).toContain('Passenger Driver');
    expect(html).toContain('Guest Transport');
    expect(html).toContain('VIP Guest Transport');
    expect(html).toContain('Alex Reviewer');
    expect(html).toContain('approved-v1');
    expect(html).toContain('Training checked.');
  });
  it('disables Active when an approved policy is missing', () => {
    const tree = review({ configuredPolicy: null });
    const active = find(tree, node => node.type === 'option' && node.props.value === 'ACTIVE');
    expect(active.props.disabled).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain('Approval is unavailable');
  });
  it('does not load or show qualifications without read permission', () => {
    harness.canRead = false;
    expect(ServiceQualifications({ driverId: 87 })).toBeNull();
    expect(harness.queryOptions.enabled).toBe(false);
  });
  it('shows a retry state instead of missing approval after read failure', () => {
    harness.query.isError = true;
    const html = renderToStaticMarkup(ServiceQualifications({ driverId: 87 }));
    expect(html).toContain('Reload qualifications');
    expect(html).not.toContain('Not approved');
  });
});

describe('qualification review interactions', () => {
  it('retains selected status and reason when the server rejects the save', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('This qualification changed. Reload before reviewing it.'));
    let tree = review({ onSave });
    field(tree, 'status').props.onChange({ target: { value: 'ACTIVE' } });
    field(tree, 'reason').props.onChange({ target: { value: 'Training checked.' } });
    tree = review({ onSave });
    await form(tree).props.onSubmit({ preventDefault() {} });
    tree = review({ onSave });
    expect(field(tree, 'status').props.value).toBe('ACTIVE');
    expect(field(tree, 'reason').props.value).toBe('Training checked.');
    expect(renderToStaticMarkup(tree)).toContain('Reload before reviewing');
  });
  it('sends stored version and waits for authoritative refresh before clearing the reason', async () => {
    let finishRefresh;
    harness.query.refetch.mockImplementation(() => new Promise(resolve => { finishRefresh = resolve; }));
    apiFetch.mockResolvedValueOnce({ data: { ...cargo, status: 'ACTIVE', version: 1 } });
    const section = ServiceQualifications({ driverId: 87 });
    const reviewElement = find(section, node => node.type === QualificationReview);
    let tree = review(reviewElement.props);
    field(tree, 'status').props.onChange({ target: { value: 'ACTIVE' } });
    field(tree, 'reason').props.onChange({ target: { value: 'Training checked.' } });
    tree = review(reviewElement.props);
    const save = form(tree).props.onSubmit({ preventDefault() {} });
    await vi.waitFor(() => expect(harness.query.refetch).toHaveBeenCalledWith({ throwOnError: true }));
    expect(apiFetch).toHaveBeenCalledWith('/api/drivers/87/qualifications', { method: 'PUT', body: { group: 'CARGO', status: 'ACTIVE', policy_version: 'approved-v2', reason: 'Training checked.', expected_version: 0 } });
    expect(field(review(reviewElement.props), 'reason').props.value).toBe('Training checked.');
    finishRefresh({ data: { groups: [{ ...cargo, status: 'ACTIVE', version: 1 }] } });
    await save;
    expect(field(review(reviewElement.props), 'reason').props.value).toBe('');
    harness.query.data.groups = [{ ...cargo, status: 'ACTIVE', version: 1, reviewer_name: 'Staff' }];
    expect(renderToStaticMarkup(ServiceQualifications({ driverId: 87 }))).toContain('Active');
  });
  it('does not announce success when a committed save cannot be refreshed', async () => {
    apiFetch.mockResolvedValueOnce({ data: { version: 1 } });
    harness.query.refetch.mockRejectedValueOnce(new Error('Connection lost.'));
    const section = ServiceQualifications({ driverId: 87 });
    const reviewElement = find(section, node => node.type === QualificationReview);
    let tree = review(reviewElement.props);
    field(tree, 'status').props.onChange({ target: { value: 'SUSPENDED' } });
    field(tree, 'reason').props.onChange({ target: { value: 'Needs review.' } });
    tree = review(reviewElement.props);
    await form(tree).props.onSubmit({ preventDefault() {} });
    const html = renderToStaticMarkup(review(reviewElement.props));
    expect(html).toContain('saved');
    expect(html).toContain('reload');
    expect(html).not.toContain('Review saved.');
    expect(field(review(reviewElement.props), 'reason').props.value).toBe('Needs review.');
  });
});
