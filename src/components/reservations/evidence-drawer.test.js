import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const focusHooks=vi.hoisted(()=>({slots:[],cursor:0,effects:[]}));
vi.mock('react',async importOriginal=>{
  const actual=await importOriginal();
  return {
    ...actual,
    useState:initial=>{
      const index=focusHooks.cursor++;
      if(!(index in focusHooks.slots)) focusHooks.slots[index]={value:typeof initial==='function'?initial():initial};
      const slot=focusHooks.slots[index];
      return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;}];
    },
    useRef:initial=>{
      const index=focusHooks.cursor++;
      if(!(index in focusHooks.slots)) focusHooks.slots[index]={value:{current:initial}};
      return focusHooks.slots[index].value;
    },
    useEffect:effect=>{focusHooks.effects.push(effect);},
  };
});
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn(async () => ({})) }));
import { apiFetch } from '@/lib/api/client';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { fetchEvidence, EvidenceBody, EvidenceDrawer, EvidenceFailureMessage, EligibilityInspector, ComparisonCard, buildInspectorRows, inspectorConclusion } from './evidence-drawer';

beforeEach(() => { focusHooks.slots=[]; focusHooks.cursor=0; focusHooks.effects=[]; vi.stubGlobal('React', React); vi.clearAllMocks(); });

const leaveData = {
  title: 'Leave Evidence', managingModule: 'Attendance & Leave', checkedAt: '2026-09-17T17:42:10+08:00',
  facts: { driverName: 'Marco Santos', status: 'Approved', startDate: '2026-09-18', endDate: '2026-09-19', overlapsBooking: true, verdict: 'blocked' },
};
const renderBody = (data, planStatus) => renderToStaticMarkup(React.createElement(EvidenceBody, { data, proofType: 'leave', planStatus }));
const findNode=(node,predicate)=>{
  if(Array.isArray(node)) return node.map(child=>findNode(child,predicate)).find(Boolean)??null;
  if(!React.isValidElement(node)) return null;
  if(predicate(node)) return node;
  return findNode(node.props?.children,predicate);
};
const evidenceTree=(props={})=>{
  focusHooks.slots=[];
  focusHooks.cursor=0;
  focusHooks.effects=[];
  return EvidenceDrawer({requestId:502,proof:{type:'leave',ref:'ev_x'},onClose:()=>{},...props});
};
const treeText=node=>{
  if(Array.isArray(node)) return node.map(treeText).join(' ');
  if(typeof node==='string'||typeof node==='number') return String(node);
  if(!React.isValidElement(node)) return '';
  return treeText(node.props?.children);
};

it('fetches exactly one point-in-time snapshot per proof via GET', async () => {
  await fetchEvidence(502, 'ev_abc.123');
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(apiFetch).toHaveBeenCalledWith(
    '/api/integration/transport-requests/502/evidence?ref=ev_abc.123',
    { method: 'GET' }
  );
});

it('renders read-only proof with source, checked time and no mutation surface', () => {
  const html = renderBody(leaveData, null);
  expect(html).toContain('Marco Santos');
  expect(html).toContain('Attendance &amp; Leave');
  expect(html).toContain('read-only here');
  expect(html).not.toMatch(/<button|<input|<select|<form/);
  expect(html).not.toContain('Conditions have changed');
});

it('shows the stale warning without rewriting the snapshot when plan state is invalid', () => {
  const html = renderBody(leaveData, { isInvalid: true, invalidReason: 'Queue plan changed.' });
  expect(html).toContain('Conditions have changed since this evidence was checked');
  expect(html).toContain('Marco Santos');
  expect(html).toContain('Recheck reservation in the panel');
});

it('renders the conflict timeline for schedule conflicts', () => {
  const html = renderToStaticMarkup(React.createElement(EvidenceBody, {
    proofType: 'schedule_conflict', planStatus: null,
    data: { title: 'Schedule Conflict', managingModule: 'Fleet Management', facts: { existingDeparture: '2026-09-19T17:30:00+08:00', requestedPickup: '2026-09-19T18:00:00+08:00', verdict: 'blocked' } },
  }));
  expect(html).toContain('CONFLICT');
});

it('drawer shell renders loading state with close-only chrome', () => {
  const tree = evidenceTree({ requestId: 502, proof: { type: 'leave', ref: 'ev_x' }, planStatus: null });
  expect(treeText(tree)).toContain('Read-only evidence');
  expect(treeText(tree)).toContain('Loading verified evidence');
  expect(treeText(tree)).toContain('Close');
  expect(treeText(tree)).not.toMatch(/Edit|Delete|Approve/);
  expect(findNode(tree, node => node.type === DialogTitle)).not.toBeNull();
});

it('builds inspector rows with bounded copy and future GPS as not applicable', () => {
  const rows = buildInspectorRows(
    [{ checkId: 'capacity', label: 'Seating capacity', status: 'verified', proof: { type: 'capacity', ref: 'ev_c' } },
     { checkId: 'schedule', label: 'Duty, leave and resource schedule', status: 'blocking', proof: null }],
    { horizon: 'FUTURE', gpsHealth: null }
  );
  expect(rows[0]).toMatchObject({ label: 'Seating capacity', state: 'clear', proof: { type: 'capacity' } });
  expect(rows[1]).toMatchObject({ label: 'Duty, leave and resource schedule', state: 'blocked', proof: null });
  expect(rows.at(-1)).toMatchObject({ label: 'Current GPS', state: 'na' });
  const immediate = buildInspectorRows([], { horizon: 'IMMEDIATE', gpsHealth: 'Fresh' });
  expect(immediate.at(-1)).toMatchObject({ label: 'GPS Health', state: 'clear' });
});

it('inspector conclusion follows row state and stays bound to evaluated server evidence', () => {
  const clear = [{ label: 'Seating capacity', state: 'clear', note: 'No blocking issue found', proof: { type: 'capacity', ref: 'ev_c' } }];
  const html = renderToStaticMarkup(React.createElement(EligibilityInspector, {
    pairLabel: 'Marco Santos + ABC', horizon: 'SCHEDULED', rows: clear, onReviewProof: () => {},
  }));
  expect(inspectorConclusion(clear)).toMatch(/Eligible.*evaluated server evidence.*this booking/i);
  expect(html).toContain('Eligible');
  expect(html).toContain('SCHEDULED');
  expect(html).toContain('Review');
  expect(html).not.toMatch(/definitely|guarantee|all clear|therefore assign/i);
  expect(html).not.toMatch(/<input|<select|<form/);
});

it.each([
  ['blocking rows', [{ label: 'Schedule', state: 'blocked', note: 'Approved leave overlaps' }], /Blocking evidence/i],
  ['blocked and verification rows', [{ label: 'Schedule', state: 'blocked' }, { label: 'License', state: 'verify' }], /Blocking evidence/i],
  ['verification rows', [{ label: 'License', state: 'verify', note: 'Needs verification' }], /Eligibility is unknown/i],
  ['missing rows', [], /Eligibility is unknown/i],
  ['GPS-only rows', [{ label: 'GPS Health', state: 'clear', note: 'Fresh' }], /Eligibility is unknown/i],
  ['GPS clear with non-GPS not-applicable rows', [{ label: 'GPS Health', state: 'clear', note: 'Fresh' }, { label: 'Number coding', state: 'na', note: 'Not applicable' }], /Eligibility is unknown/i],
])('never calls %s eligible', (_name, rows, conclusion) => {
  const html = renderToStaticMarkup(React.createElement(EligibilityInspector, {
    pairLabel: 'Marco Santos + ABC', horizon: 'SCHEDULED', rows, onReviewProof: () => {},
  }));
  expect(inspectorConclusion(rows)).toMatch(conclusion);
  expect(html).toMatch(conclusion);
  expect(html).not.toContain('Eligible');
});

it('shows Retry and Close for an evidence-fetch failure', () => {
  const html = renderToStaticMarkup(React.createElement(EvidenceFailureMessage, {
    error: new Error('network'), onRetry: () => {}, onClose: () => {},
  }));
  expect(html).toContain('role="alert"');
  expect(html).toContain('Evidence unavailable');
  expect(html).toContain('Retry evidence');
  expect(html).toContain('Close evidence');
});

it('comparison card shows codes and facts without scores', () => {
  const html = renderToStaticMarkup(React.createElement(ComparisonCard, {
    planStatus: null,
    data: {
      title: 'Option Comparison', managingModule: 'Dispatch Copilot', checkedAt: '2026-09-17T17:42:10+08:00',
      facts: {
        optionA: { vehicleId: 1, reliability: 'SAFE', transferMinutes: 12, workload: { totalTrips: 4, serviceDate: '2026-09-19' }, standing: 'Standing pair' },
        optionB: { vehicleId: 3, reliability: 'SAFE', transferMinutes: 25, workload: { totalTrips: 2, serviceDate: '2026-09-19' }, standing: 'Non-standing' },
        hierarchy: ['Reliability', 'Efficiency'], verdict: 'clear',
      },
    },
  }));
  expect(html).toContain('Option 1');
  expect(html).toContain('Option 2');
  expect(html).toContain('Reliability');
  expect(html).not.toMatch(/score|87\/100|points/i);
  expect(html).not.toMatch(/<button|<input|<select|<form/);
});

it('renders an unevaluated pairing as no claim, never as a blocking result', () => {
  // resolvePairing returns null facts when there is no driver to look the pairing
  // up for, so the drawer must state neither a pairing state nor a result. Both
  // keys render through the existing null path as "—"; anything else here would
  // be the drawer asserting a check that never ran. Static markup only — this is
  // not a browser observation.
  const html = renderToStaticMarkup(React.createElement(EvidenceBody, {
    proofType: 'pairing', planStatus: null,
    data: { title: 'Pairing Evidence', managingModule: 'Fleet Management', facts: { plate: 'ABC 1234', pairingState: null, verdict: null } },
  }));
  expect(html).toContain('Pairing');
  expect(html).toContain('ABC 1234');
  expect(html).toContain('>—<');
  expect(html).not.toContain('Blocking');
  expect(html).not.toContain('none');
});

it('renders evidence as a named modal Radix dialog with the existing right-side placement',()=>{
  const tree=evidenceTree();
  const root=findNode(tree,node=>node.type===Dialog);
  const content=findNode(tree,node=>node.type===DialogContent);

  expect(root?.props.open).toBe(true);
  expect(root?.props.modal).not.toBe(false);
  expect(content).not.toBeNull();
  expect(content.props.className).toMatch(/right-0/);
  expect(findNode(tree,node=>node.type===DialogTitle)).not.toBeNull();
});

it('focuses Close on open and restores the exact Review opener without fetching on focus',()=>{
  const reviewTrigger={focus:vi.fn()};
  const openerRef={current:reviewTrigger};
  apiFetch.mockClear();
  const tree=evidenceTree({openerRef});
  const content=findNode(tree,node=>node.type===DialogContent);
  const close=findNode(tree,node=>node.type==='button'&&node.props['aria-label']==='Close evidence');

  expect(content?.props.onOpenAutoFocus).toBeTypeOf('function');
  expect(content?.props.onCloseAutoFocus).toBeTypeOf('function');
  expect(close).not.toBeNull();
  const closeFocus=vi.fn();
  const closeRef=close.props.ref??close.ref;
  expect(closeRef).toBeDefined();
  closeRef.current={focus:closeFocus};
  const openEvent={preventDefault:vi.fn()};
  content.props.onOpenAutoFocus(openEvent);
  expect(openEvent.preventDefault).toHaveBeenCalledOnce();
  expect(closeFocus).toHaveBeenCalledOnce();
  expect(apiFetch).not.toHaveBeenCalled();

  const closeEvent={preventDefault:vi.fn()};
  content.props.onCloseAutoFocus(closeEvent);
  expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
  expect(reviewTrigger.focus).toHaveBeenCalledOnce();
});

it('closes on Radix dismissal through the controlled dialog callback',()=>{
  const onClose=vi.fn();
  const tree=evidenceTree({onClose});
  const root=findNode(tree,node=>node.type===Dialog);

  root?.props.onOpenChange(false);
  expect(onClose).toHaveBeenCalledOnce();
});

it('returns from a proof drill-down to its exact Review trigger on Back',()=>{
  const onBack=vi.fn();
  const reviewTrigger={focus:vi.fn()};
  const tree=evidenceTree({onBack,backTo:{kind:'inspector'},openerRef:{current:reviewTrigger}});
  const content=findNode(tree,node=>node.type===DialogContent);
  const back=findNode(tree,node=>node.type==='button'&&treeText(node.props.children).includes('Back to checklist'));

  expect(back).not.toBeNull();
  back.props.onClick();
  expect(onBack).toHaveBeenCalledOnce();
  content.props.onCloseAutoFocus({preventDefault:vi.fn()});
  expect(reviewTrigger.focus).toHaveBeenCalledOnce();
});

it('makes one scope-bound GET for explicit proof open and none for the inspector',()=>{
  apiFetch.mockClear();
  evidenceTree({requestId:502,proof:{type:'leave',ref:'ev_abc.123'}});
  expect(focusHooks.effects).toHaveLength(1);
  focusHooks.effects[0]();
  expect(apiFetch).toHaveBeenCalledOnce();
  expect(apiFetch).toHaveBeenCalledWith(
    '/api/integration/transport-requests/502/evidence?ref=ev_abc.123',
    {method:'GET'},
  );

  apiFetch.mockClear();
  evidenceTree({requestId:502,proof:null,inspector:{pairLabel:'Maria Santos + ABC-1234',rows:[]}});
  expect(focusHooks.effects).toHaveLength(1);
  focusHooks.effects[0]();
  expect(apiFetch).not.toHaveBeenCalled();
});

it('passes the exact eligibility Review button to its nested proof dialog',()=>{
  const proof={type:'capacity',ref:'ev_c'};
  const onReviewProof=vi.fn();
  const tree=EligibilityInspector({
    pairLabel:'Maria Santos + ABC-1234',
    horizon:'SCHEDULED',
    rows:[{label:'Seating capacity',state:'clear',note:'No blocking issue found',proof}],
    onReviewProof,
  });
  const review=findNode(tree,node=>node.type==='button'&&treeText(node.props.children).includes('Review'));
  const trigger={focus:vi.fn()};

  review.props.onClick({currentTarget:trigger});
  expect(onReviewProof).toHaveBeenCalledWith(proof,trigger);
});
