import { getDriverGuide } from './driver-guides';
import { tripActionLabel } from './load-presentation';
import { checklistForMode } from './inspection-checklist';
import cargoDemoFixtures from './cargo-demo-fixtures';
import { buildCargoReceipt } from './cargo-view-model';
import { validateCargoHandover } from '../../shared/cargo-handover';

export const PRACTICE_TOPICS = Object.freeze(['passenger.pickup', 'passenger.dropoff', 'inspection.quick', 'inspection.daily', 'odometer.start', 'odometer.end', 'fuel.request', 'fuel.receipt', 'incident.report', 'cargo.manifest', 'cargo.issue', 'cargo.pickup_signature', 'cargo.departure', 'cargo.delivery']);
function sampleCargoExecution(delivery = false) {
  const fixture = cargoDemoFixtures.buildCargoDemoFixtures().find(item => item.id === 'accepted-shortage').execution;
  return { manifest: fixture.manifest, capabilities: { observe: true }, lines: [{ line_id: fixture.manifest.lines[0].line_id, pickup_quantity: '9', delivered_quantity: delivery ? '9' : null, order_shortage: '1', delivery_shortage: delivery ? '0' : null }], pickup_state: 'NOT_RECORDED', delivery_state: 'NOT_RECORDED', securement_confirmed: false, receiver_confirmed: false, can_depart: false, can_complete: false, feedback: { state: 'NOT_QUEUED' }, blockers: [] };
}

export const PRACTICE_DURATION_MS = 10 * 60 * 1000;
const passengerStatuses = ['Trip Started', 'At Pickup', 'Passenger Onboard', 'Drop-off'];

export function createPracticeSession({ id, epoch, actorId, topic, variant, now, eligibility } = {}) {
  const guide = getDriverGuide(topic, variant);
  if (!eligibility?.allowed || !id || !Number.isInteger(epoch) || !String(actorId ?? '').trim() || !Number.isFinite(now) || now < 0 || !guide) return null;
  if (!PRACTICE_TOPICS.includes(topic) || (topic.startsWith('cargo.') && variant !== 'cargo') || (topic.startsWith('passenger.') && variant !== 'passenger')) return null;
  return {
    id, epoch, actorId: String(actorId), topic, variant, createdAt: now,
    expiresAt: now + PRACTICE_DURATION_MS, knownMotionAtEntry: eligibility.reason === 'stationary',
    phase: 'active', step: 0,
    data: { trip: { trip_status: topic === 'passenger.dropoff' ? 'Passenger Onboard' : 'Trip Started', load_type: variant === 'cargo' ? 'Cargo' : 'Passenger', origin: 'Sample pickup', destination: 'Sample hotel', guest_name: 'Sample guest' }, printedTotal: '2911.25', extractedTotal: '2911.75', items: checklistForMode(topic === 'inspection.daily' ? 'preshift' : 'pretrip', variant === 'cargo' ? 'Cargo' : 'Passenger'), execution: topic.startsWith('cargo.') ? sampleCargoExecution(topic === 'cargo.delivery') : null, signedReceipt: null },
  };
}

export function getPracticeStep(session) {
  if (!session || session.phase !== 'active') return null;
  const type = session.topic.startsWith('passenger.') ? 'swipe'
    : session.topic.startsWith('inspection.') ? 'inspection.review'
    : session.topic.startsWith('odometer.') ? 'odometer.review'
    : session.topic.startsWith('cargo.') ? ['cargo.review', 'cargo.sign', 'cargo.wait', 'cargo.recount', 'cargo.securement', 'cargo.authority'][session.step]
    : session.topic === 'fuel.receipt' ? 'receipt.review' : session.topic;
  return { id: `${session.topic}.${session.step}`, type, label: type === 'swipe' ? tripActionLabel(session.data.trip.trip_status, 'Passenger') : 'Review sample' };
}

export function reducePractice(session, event, now) {
  if (!session || !Number.isFinite(now) || now < session.createdAt || now >= session.expiresAt) return null;
  const step = getPracticeStep(session);
  if (!step || event?.sessionId !== session.id || event.epoch !== session.epoch || event.stepId !== step.id || (event.type !== step.type && event.type !== 'cargo.edit' && event.type !== 'cargo.case')) return session;
  const finish = data => ({ ...session, phase: 'complete', step: session.step + 1, data: { ...session.data, ...data } });
  const advance = data => ({ ...session, step: session.step + 1, data: { ...session.data, ...data } });
  const payload = event.payload || {};
  if (event.type === 'cargo.case') {
    if (!session.topic.startsWith('cargo.') || !['clean', 'shortage', 'measured', 'unsynced', 'unavailable'].includes(payload.case)) return session;
    const execution = sampleCargoExecution(session.topic === 'cargo.delivery');
    if (payload.case === 'measured') execution.manifest = { ...execution.manifest, lines: execution.manifest.lines.map(line => ({ ...line, name: 'Sample measured cargo', quantity_basis: 'STOCK_UNIT', expected_quantity: '10.5', unit: 'kg' })) };
    if (payload.case === 'clean') execution.lines = execution.lines.map(line => ({ ...line, pickup_quantity: '10', order_shortage: '0' }));
    return { ...session, step: 0, data: { ...session.data, cargoCase: payload.case, execution, signedReceipt: null, receipt: null, recount: false } };
  }
  if (event.type === 'cargo.edit') return session.topic.startsWith('cargo.') ? { ...session, step: 0, data: { ...session.data, signedReceipt: null, receipt: null } } : session;
  if (step.type === 'inspection.review') {
    const valid = session.data.items.every(item => ['PASS', 'FAIL'].includes(payload.answers?.[item.id]) && (item.kind !== 'acknowledgment' || payload.answers[item.id] === 'PASS') && (payload.answers[item.id] !== 'FAIL' || String(payload.remarks?.[item.id] || '').trim().length >= 8));
    const foundFault = session.data.items.some(item => item.kind !== 'acknowledgment' && payload.answers?.[item.id] === 'FAIL');
    return valid && foundFault ? finish({}) : session;
  }
  if (step.type === 'odometer.review') return payload.photo === true && Number(payload.reading) === 12345 ? finish({}) : session;
  if (step.type === 'fuel.request') return payload.photo === true && String(payload.percent).trim() !== '' && Number(payload.percent) === 25 && String(payload.purpose || '').trim() ? finish({ requestStatus: 'Pending' }) : session;
  if (step.type === 'incident.report') return payload.valid === true ? finish({}) : session;
  if (step.type === 'cargo.review') {
    if (['unsynced', 'unavailable'].includes(session.data.cargoCase)) return session;
    try {
      if (session.data.recount && session.data.execution.manifest.lines.some(line => String(payload.counts?.[line.line_id]) !== '10')) return session;
      const receipt = buildCargoReceipt(session.data.execution, { stage: session.topic === 'cargo.delivery' ? 'DELIVERY' : 'PICKUP', counts: payload.counts, issues: payload.issues });
      return advance({ receipt, signedReceipt: null });
    } catch { return session; }
  }
  if (step.type === 'cargo.sign') {
    try { const handover = validateCargoHandover(payload.handover); return { ...advance({ signedReceipt: { ...session.data.receipt, handover }, execution: { ...session.data.execution, pickup_receipt: { payload: session.data.receipt, simulated: true }, pickup_state: 'AWAITING_DECISION', source_decision: session.data.recount || ['clean', 'measured'].includes(session.data.cargoCase) ? null : { action: 'WAIT', simulated: true }, feedback: { state: 'ACKNOWLEDGED', simulated: true } } }), step: session.topic === 'cargo.delivery' ? 5 : session.data.recount || session.data.cargoCase === 'clean' || session.data.cargoCase === 'measured' ? 4 : 2 }; }
    catch { return session; }
  }
  if (step.type === 'cargo.wait') return payload.action === 'wait' ? advance({ execution: { ...session.data.execution, pickup_state: 'AWAITING_DECISION', source_decision: { action: 'WAIT' }, feedback: { state: 'ACKNOWLEDGED' } } }) : session;
  if (step.type === 'cargo.recount') return payload.action === 'recount' ? { ...session, step: 0, data: { ...session.data, recount: true, previousObservations: [...(session.data.previousObservations || []), session.data.signedReceipt].filter(Boolean), signedReceipt: null, receipt: null, execution: { ...session.data.execution, pickup_state: 'NOT_RECORDED', source_decision: null } } } : session;
  if (step.type === 'cargo.securement') return payload.answer === 'separate' ? advance({}) : session;
  if (step.type === 'cargo.authority') return payload.answer === 'server' ? finish({}) : session;
  if (step.type === 'receipt.review') {
    if (String(event.payload?.total || '').trim() !== session.data.printedTotal || Number(event.payload?.liters) !== 45.5) return session;
    return { ...session, phase: 'complete', step: session.step + 1, data: { ...session.data, extractedTotal: session.data.printedTotal } };
  }
  if (event.payload?.success !== true) return session;
  const index = passengerStatuses.indexOf(session.data.trip.trip_status);
  const nextStatus = passengerStatuses[index + 1];
  return { ...session, step: session.step + 1, phase: nextStatus ? 'active' : 'complete', data: { ...session.data, trip: { ...session.data.trip, trip_status: nextStatus || 'Completed' } } };
}
