import { expect, it } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';
import { createPracticeSession, reducePractice } from './driver-practice';
import * as guides from './driver-guides';
import * as practice from './driver-practice';
import * as cargo from './cargo-view-model';
import * as severity from '../../shared/incidents/severity';

async function host(topic, variant = 'passenger') {
  let session = createPracticeSession({ id: 's', epoch: 1, actorId: '17', topic, variant, now: 1000, eligibility: { allowed: true, reason: 'stationary' } });
  const deps = {
    'react-native': { ...nativeViews, Image: { resolveAssetSource: () => ({ uri: 'data:sample' }) } },
    '../../lib/theme-context': nativeTheme, '../../lib/driver-guides': guides, '../../lib/driver-practice': practice,
    '../../lib/cargo-view-model': cargo, '../../../shared/incidents/severity': severity,
    '../incidents/IncidentCriticalConfirmation': { default: 'CriticalConfirmation' },
    '../clay': { ClayButton: 'Button' }, './PracticeBanner': { default: 'Banner' },
    '../map/PassengerMapSummary': { default: 'PassengerSummary' }, '../map/MapControlCluster': { default: 'MapControls' },
    '../SwipeButton': { default: 'Swipe' }, '../inspection/InspectionChecklist': { default: 'Inspection' },
    '../trips/OdometerReview': { default: 'Odometer' }, '../fuel/FuelRequestForm': { default: 'FuelRequest' },
    '../fuel/FuelReceiptReview': { default: 'FuelReceipt' }, '../incidents/IncidentReportForm': { default: 'Incident', IncidentSubmitButton: 'IncidentSubmit' },
    '../cargo/CargoDecisionStatus': { CargoDecisionStatus: 'DecisionStatus' },
    '../cargo/CargoWorkflowContent': { CargoWorkflowContent: 'Cargo' }, '../cargo/CargoSignatureModal': { CargoSignatureModal: 'Signature' },
    '../../assets/driver-practice/odometer.png': 1, '../../assets/driver-practice/gauge.png': 2, '../../assets/driver-practice/receipt.png': 3,
  };
  for (const value of Object.values(deps)) if (value && typeof value === 'object' && 'default' in value) value.__esModule = true;
  // Strict module map: any API, outbox, upload, camera, location, storage or launcher
  // dependency fails component loading instead of silently replacing a mutation.
  const h = await nativeRender(new URL('../components/coachmarks/DriverPracticeHost.jsx', import.meta.url), {
    name: 'PracticeBody', deps, props: { session, onEvent: event => { const next = reducePractice(session, event, 1001); const changed = next !== session; session = next; return changed; }, onExit() {} },
  });
  return { h, node: name => h.find(n => n.component === name)?.props, refresh: () => h.render({ session }), current: () => session };
}

it('runs real Passenger labels and local control callbacks without operational modules', async () => {
  const t = await host('passenger.pickup');
  for (const button of t.node('MapControls').controls) button.onPress();
  expect(t.current().data.trip.trip_status).toBe('Trip Started');
  expect(t.node('Swipe').title).toBe('ARRIVED AT PICKUP');
  t.node('Swipe').onSwipeSuccess(); t.refresh();
  expect(t.node('Swipe').title).toBe('PICKED UP GUEST');
});

it('uses inspection state setters exactly as the production view does', async () => {
  const t = await host('inspection.quick');
  for (const [index, item] of t.node('Inspection').items.entries()) t.node('Inspection').onAnswer(item.id, index === 0 ? 'FAIL' : 'PASS');
  t.node('Inspection').onRemarks(previous => ({ ...previous, [t.node('Inspection').items[0].id]: 'Fictional damaged tire' }));
  t.refresh();
  t.h.find(n => n.props.label === 'Review sample inspection').props.onPress();
  expect(t.current().phase).toBe('complete');
});

it('loads only sample odometer/gauge/receipt evidence and never creates approval', async () => {
  const odo = await host('odometer.start', 'cargo');
  odo.node('Odometer').onRetake(); odo.refresh(); odo.node('Odometer').onRead(); odo.refresh(); odo.node('Odometer').onConfirm();
  expect(odo.current().phase).toBe('complete');
  const fuel = await host('fuel.request');
  fuel.node('FuelRequest').onCaptureGauge(); fuel.node('FuelRequest').setFuelLevelPercent('25'); fuel.node('FuelRequest').setRequestPurpose('Fictional shift'); fuel.refresh(); fuel.node('FuelRequest').requestFuel();
  expect(fuel.current().data.requestStatus).toBe('Pending');
  const receipt = await host('fuel.receipt');
  receipt.node('FuelReceipt').openReceiptCamera(); receipt.node('FuelReceipt').pickReceipt(); receipt.node('FuelReceipt').setCost('2911.25'); receipt.refresh(); receipt.node('FuelReceipt').handleSubmit();
  expect(receipt.current().phase).toBe('complete');
});

it('validates incident answers in the shared assessment before local completion', async () => {
  const t = await host('incident.report');
  t.node('Incident').actions.onCategory('breakdown');
  for (const [key, value] of Object.entries({ immediateDanger: 'no', vehicleSafety: 'unsafe', tripImpact: 'stopped', hazardToOthers: 'no' })) t.node('Incident').actions.updateSeverityAnswer(key, value);
  t.node('Incident').actions.setDescription('Fictional damaged tire. Parked safely.'); t.refresh();
  expect(t.node('Incident').values.recommendation.severity).toBe('Major');
  t.node('IncidentSubmit').onSubmit(); expect(t.current().phase).toBe('complete');
});

it('rejects invalid Cargo counts and injects a local no-location signature callback', async () => {
  const t = await host('cargo.manifest', 'cargo'), id = t.current().data.execution.manifest.lines[0].line_id;
  t.node('Cargo').onChange(id, '9'); t.refresh(); t.node('Cargo').onSubmit(); expect(t.current().step).toBe(0);
  t.node('Cargo').onIssue(id); t.refresh(); t.node('Cargo').onIssueChange({ remarks: 'Only nine fictional boxes present' }); t.refresh();
  t.node('Cargo').onSubmit(); t.refresh();
  expect(t.current().step).toBe(1);
  expect(await t.node('Signature').getLocation()).toBeNull();
  expect(t.current().data.execution.can_depart).toBe(false);
});
