import React, { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../../lib/theme-context';
import { getDriverGuide } from '../../lib/driver-guides';
import { getPracticeStep } from '../../lib/driver-practice';
import { buildCargoReceipt, buildCargoViewModel, validateCargoCounts } from '../../lib/cargo-view-model';
import { recommendIncidentSeverity, validateIncidentSeverityAssessment } from '../../../shared/incidents/severity';
import { ClayButton } from '../clay';
import PracticeBanner from './PracticeBanner';
import PassengerMapSummary from '../map/PassengerMapSummary';
import MapControlCluster from '../map/MapControlCluster';
import SwipeButton from '../SwipeButton';
import InspectionChecklist from '../inspection/InspectionChecklist';
import OdometerReview from '../trips/OdometerReview';
import FuelRequestForm from '../fuel/FuelRequestForm';
import FuelReceiptReview from '../fuel/FuelReceiptReview';
import IncidentCriticalConfirmation from '../incidents/IncidentCriticalConfirmation';
import IncidentReportForm, { IncidentSubmitButton } from '../incidents/IncidentReportForm';
import { CargoWorkflowContent } from '../cargo/CargoWorkflowContent';
import { CargoDecisionStatus } from '../cargo/CargoDecisionStatus';
import { CargoSignatureModal } from '../cargo/CargoSignatureModal';

const sampleUri = name => Image.resolveAssetSource({ odometer: require('../../assets/driver-practice/odometer.png'), gauge: require('../../assets/driver-practice/gauge.png'), receipt: require('../../assets/driver-practice/receipt.png') }[name]).uri;

// Only presentation components are mounted here. Every callback stays in memory.
// The route owner supplies the current, identity-bound session capability.
export default function DriverPracticeHost({ session, onEvent, onExit }) {
  const { colors, type } = useTheme();
  if (!session) return <View style={{ padding: 24, gap: 16 }}><Text style={type.bodyMd}>Practice has ended or is unavailable. Return to Help to start a new sample while safely parked.</Text><ClayButton label="Back to Help" onPress={onExit} /></View>;
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <PracticeBanner onExit={onExit} />
    <PracticeBody key={session.id} session={session} onEvent={onEvent} onExit={onExit} />
  </View>;
}

export function PracticeBody({ session, onEvent, onExit }) {
  const { colors, type } = useTheme();
  const [form, setForm] = useState({ answers: {}, remarks: {}, counts: {}, issues: {}, cost: '2911.75', liters: '45.5', station: 'Sample station', fuelDate: '2026-10-20', percent: '', purpose: '', photo: session.topic.startsWith('odometer.'), reading: null, type: null, severityAnswers: {}, description: '', assistance: [], expense: '', photos: [] });
  const [notice, setNotice] = useState('');
  const [criticalReview, setCriticalReview] = useState(false);
  const [showCases, setShowCases] = useState(false);
  const [review, setReview] = useState(false), [issueLine, setIssueLine] = useState(null), [signing, setSigning] = useState(false);
  const guide = getDriverGuide(session.topic, session.variant), step = getPracticeStep(session);
  const set = key => value => setForm(previous => ({ ...previous, [key]: typeof value === 'function' ? value(previous[key]) : value }));
  const send = payload => {
    const accepted = onEvent({ sessionId: session.id, epoch: session.epoch, stepId: step?.id, type: step?.type, payload });
    if (!accepted) setNotice('Check the sample instructions and the required fields, then try again.');
    else setNotice('');
    return accepted;
  };
  const instruction = session.data.recount ? 'Sample recount: Fleet asks you to count again and all 10 fictional boxes are now present. Enter the new actual count and get a fresh fictional staff signature. The earlier signature is discarded. No clearance is granted.' : session.topic.startsWith('inspection.') ? 'Fictional finding: the first check has a fault. Mark that item as failed and describe it in your own words. Answer every other check individually. Real checks must describe your actual vehicle.'
    : session.topic.startsWith('odometer.') ? 'Use the fictional current photo below. Read 012345 km. Retake if the reading is wrong; GPS distance never replaces an odometer photo. Cargo and Passenger follow the same required evidence step.'
    : session.topic === 'fuel.receipt' ? 'The sample receipt says PHP 2,911.25. The extracted total is wrong. Correct it before using Save Fuel Entry. Sample buttons never open your camera or gallery.'
    : session.topic === 'fuel.request' ? 'Add a sample gauge photo, enter 25% and describe this fictional fuel request. The sample remains Pending; approval must come from Fleet in real work.'
    : session.topic === 'incident.report' ? 'Fictional vehicle issue: safely parked, no immediate danger, vehicle cannot safely continue, trip stopped, no hazard to others. Answer the four questions and describe the sample fault. No report, SOS or assistance request will be sent.'
    : session.topic.startsWith('cargo.') && session.data.cargoCase && session.data.cargoCase !== 'shortage' ? 'This is a fictional sample case. Follow its units and status below. Use fictional staff names and drawings only; no real approval, signature or submission is created.' : session.topic.startsWith('cargo.') ? 'Fictional cargo: expected 10 boxes; only 9 are present at pickup. Record the shortage and a reason. At delivery all 9 picked-up boxes arrive: order shortage 1, delivery shortage 0. Use a fictional staff name and drawing, never a real signature.'
    : 'Use the real trip summary and swipe control below. Only the sample trip changes. In real work, confirm arrival and guest handover only when they actually happen.';
  const recommendation = recommendIncidentSeverity(form.severityAnswers);
  const finalSeverity = form.severityOverride || recommendation?.severity;
  const updateSeverityAnswer = (key, value) => setForm(previous => ({ ...previous, severityAnswers: { ...previous.severityAnswers, [key]: value } }));
  const cargoTrip = { ...session.data.trip, load_type: 'Cargo', operational_use: 'Cargo', vehicle_id: 'sample-vehicle', trip_status: session.topic === 'cargo.delivery' ? 'Drop-off' : 'At Pickup' };
  const cargoView = session.data.execution ? buildCargoViewModel(session.data.cargoCase === 'unavailable' ? null : session.data.execution, { trip: cargoTrip, driverType: 'Cargo', syncState: session.data.cargoCase === 'unsynced' ? 'DEVICE_SAVED' : 'NONE' }) : null;
  const selectCargoCase = value => {
    onEvent({ sessionId: session.id, epoch: session.epoch, stepId: step.id, type: 'cargo.case', payload: { case: value } });
    set('counts')({}); set('issues')({}); setReview(false); setIssueLine(null); setNotice('');
  };
  const cargoReview = value => {
    if (value) {
      try { buildCargoReceipt(session.data.execution, { stage: session.topic === 'cargo.delivery' ? 'DELIVERY' : 'PICKUP', counts: form.counts, issues: form.issues }); }
      catch (error) { setNotice(error.message); return; }
    }
    setReview(value); setNotice('');
  };
  const submitIncident = confirmed => {
    const assessment = validateIncidentSeverityAssessment({ severity: finalSeverity, assessment: { version: 1, answers: form.severityAnswers, override_reason_code: form.overrideReason, lower_severity_confirmed: !!form.lowerCriticalConfirmed, critical_confirmed: confirmed }, severitySource: null });
    send({ valid: !!form.type && form.description.trim().length >= 10 && assessment.ok });
  };
  const content = () => {
    if (session.phase === 'complete') return <><Text accessibilityRole="header" style={type.headlineMd}>Sample complete</Text><Text style={type.bodyMd}>{session.topic === 'fuel.request' ? 'Sample request: Pending. No approval was created.' : 'You finished this local example. No operational record was created or changed.'}</Text><ClayButton label="Return to Help" onPress={onExit} /></>;
    if (session.topic.startsWith('passenger.')) return <>
      <PassengerMapSummary activeTrip={session.data.trip} destName={session.data.trip.trip_status === 'Trip Started' ? 'Sample pickup' : 'Sample hotel'} isState1={session.data.trip.trip_status === 'Trip Started'} isState2={session.data.trip.trip_status === 'At Pickup'} isState3={session.data.trip.trip_status === 'Passenger Onboard'} isState4={session.data.trip.trip_status === 'Drop-off'} profile={{ driverType: 'Passenger' }} routeDisabledReason="Sample route only. No live route is requested." />
      <MapControlCluster controls={[{ id: 'recenter', label: 'Recenter map', icon: 'locate', onPress: () => setNotice('Sample map centered. No location was requested.') }, { id: 'route', label: 'Route options', icon: 'options', onPress: () => setNotice('Route options explain available routes. This sample does not calculate or launch navigation.') }, { id: 'external', label: 'Open navigation', icon: 'navigate', onPress: () => setNotice('External navigation stays closed in practice. In real work, open it only when safe.') }, { id: 'overview', label: 'Route overview', icon: 'map', onPress: () => setNotice('Sample overview: pickup to hotel. No live route was requested.') }]} />
      <SwipeButton key={step.id} title={step.label} onSwipeSuccess={() => send({ success: true })} />
    </>;
    if (session.topic.startsWith('inspection.')) return <><InspectionChecklist items={session.data.items} answers={form.answers} remarks={form.remarks} onAnswer={(id, value) => setForm(previous => ({ ...previous, answers: { ...previous.answers, [id]: value } }))} onRemarks={set('remarks')} isCargoPreTrip={session.variant === 'cargo' && session.topic === 'inspection.quick'} screenMode={session.topic === 'inspection.daily' ? 'preshift' : 'pretrip'} /><ClayButton label="Review sample inspection" onPress={() => send({ answers: form.answers, remarks: form.remarks })} /></>;
    if (session.topic.startsWith('odometer.')) return <OdometerReview stage={session.topic === 'odometer.end' ? 'end' : 'start'} phase={form.reading == null ? 'captured' : 'review'} asset={form.photo ? { uri: sampleUri('odometer') } : null} reading={form.reading} previousReading={12300} colors={colors} type={type} onRead={() => { if (!form.photo) { set('photo')(true); setNotice('Current fictional photo loaded. Read it to check every digit.'); } else set('reading')(12345); }} onRetake={() => { setForm(previous => ({ ...previous, photo: true, reading: null })); setNotice('New fictional photo loaded. No camera or file access.'); }} onConfirm={() => send({ photo: form.photo, reading: form.reading })} label="Sample photo only. Retake photo loads the local example." />;
    if (session.topic === 'fuel.request') return <FuelRequestForm fuelLevelPercent={form.percent} setFuelLevelPercent={set('percent')} gaugePhotoUrl={form.photo ? sampleUri('gauge') : null} setGaugePhotoUrl={value => set('photo')(!!value)} gaugeScanEstimate={null} setGaugeScanEstimate={() => {}} requestPurpose={form.purpose} setRequestPurpose={set('purpose')} hasAssignedVehicle onCaptureGauge={() => { set('photo')(true); setNotice('Fictional gauge photo loaded. Read its 25% level.'); }} requestFuel={() => send({ percent: form.percent, photo: form.photo, purpose: form.purpose })} />;
    if (session.topic === 'fuel.receipt') return <><Image source={{ uri: sampleUri('receipt') }} accessibilityLabel="Sample receipt total PHP 2911.25" style={{ width: '100%', height: 160 }} resizeMode="contain" /><FuelReceiptReview entryMethod="scan" liters={form.liters} setLiters={set('liters')} cost={form.cost} setCost={set('cost')} setPricePerLiter={() => {}} station={form.station} setStation={set('station')} fuelDate={form.fuelDate} setFuelDate={set('fuelDate')} pricePerLiter="63.98" receiptAsset={{ uri: sampleUri('receipt') }} openReceiptCamera={() => setNotice('Fictional receipt loaded; camera stays closed.')} pickReceipt={() => setNotice('Fictional receipt loaded; gallery stays closed.')} scanReceipt={() => set('cost')('2911.75')} canSubmit handleSubmit={() => send({ total: form.cost, liters: form.liters })} /></>;
    if (session.topic === 'incident.report') return <>
      <IncidentReportForm values={{ ...form, recommendation, finalSeverity, vehicleId: 'Sample vehicle' }} actions={{ onCategory: set('type'), updateSeverityAnswer, setShowSeverityChoices: set('showSeverityChoices'), setSeverityOverride: set('severityOverride'), setOverrideReason: set('overrideReason'), setLowerCriticalConfirmed: set('lowerCriticalConfirmed'), setDescription: set('description'), toggleAssistance: value => set('assistance')(form.assistance.includes(value) ? form.assistance.filter(item => item !== value) : [...form.assistance, value]), setExpense: set('expense'), removePhoto: () => set('photos')([]), pickImage: () => setNotice('Sample practice does not access your camera or gallery.') }} />
      <IncidentSubmitButton onSubmit={() => { if (finalSeverity === 'Critical') setCriticalReview(true); else submitIncident(false); }} />
      <IncidentCriticalConfirmation visible={criticalReview} recommendation={recommendation} practiceLabel onExit={onExit} onClose={() => setCriticalReview(false)} onConfirm={() => { setCriticalReview(false); submitIncident(true); }} />
    </>;
    if (session.topic.startsWith('cargo.')) return <>
      {session.step === 0 ? <View style={{ gap: 8 }}><ClayButton label={showCases ? "Hide other sample cases" : "Choose a different sample case"} variant="tonal" onPress={() => setShowCases(value => !value)} />{showCases ? [['shortage', '9 of 10 boxes'], ['clean', 'Clean pickup: 10 boxes'], ['measured', 'Measured amount: 9.25 of 10.5 kg'], ['unsynced', 'Saved on device; not received'], ['unavailable', 'Cargo service unavailable']].map(([id, label]) => <ClayButton key={id} label={label} variant="tonal" onPress={() => { selectCargoCase(id); setShowCases(false); }} />) : null}<Text style={type.supporting}>{session.data.cargoCase === 'measured' ? 'Use kilograms with up to three decimal places. Record 9.25 kg and explain the 1.25 kg shortage.' : session.data.cargoCase === 'clean' ? 'All 10 fictional boxes are present. Count and review before signing.' : session.data.cargoCase === 'unsynced' ? 'Saved on this device does not mean Fleet received it. The saved receipt is locked for retry; reconnect and review its status before departure.' : session.data.cargoCase === 'unavailable' ? 'No provider or server clearance is available. Wait and contact Fleet; practice cannot enable the service.' : 'Only nine fictional boxes are present. Record what you counted and explain the shortage.'}</Text></View> : <CargoDecisionStatus view={cargoView} />}
      {session.step === 0 ? <CargoWorkflowContent canOperate mode={session.topic === 'cargo.delivery' ? 'delivery' : 'pickup'} execution={session.data.execution} trip={cargoTrip} view={cargoView} form={form} errors={validateCargoCounts(session.data.execution.manifest, form.counts).errors} issueLine={issueLine} review={review} onRefresh={() => setNotice('Sample refreshed locally. No server request was made.')} onChange={(id, value) => { setForm(previous => ({ ...previous, counts: { ...previous.counts, [id]: value } })); setReview(false); }} onIssue={setIssueLine} onIssueChange={value => setForm(previous => ({ ...previous, issues: { ...previous.issues, [issueLine]: { ...previous.issues[issueLine], ...value } } }))} onPhoto={() => setNotice('Describe the fictional issue. Evidence upload stays off in practice.')} onCloseIssue={() => setIssueLine(null)} onReview={cargoReview} onSubmit={() => send({ counts: form.counts, issues: form.issues })} onRecount={() => { set('counts')({}); setReview(false); }} /> : session.step === 1 ? <><Text style={type.bodyMd}>Review the same count with fictional staff. A signature acknowledges the count and condition; it grants no clearance.</Text><ClayButton label="Review and sign sample count" onPress={() => setSigning(true)} /><CargoSignatureModal visible={signing} stage={session.topic === 'cargo.delivery' ? 'DELIVERY' : 'PICKUP'} getLocation={async () => null} practiceLabel onExit={onExit} onCancel={() => setSigning(false)} onConfirm={handover => { if (send({ handover })) setSigning(false); }} /></> : <>
        <Text style={type.bodyMd}>{session.step === 2 ? 'Saved on device, saved to Fleet, partner receipt, source decision and clearance are separate states. The sample partner acknowledged receipt, but the source says WAIT. Stay at pickup.' : session.step === 3 ? 'Fleet asks for a recount. Begin a new count; the old signature cannot sign a changed count or revision.' : session.step === 4 ? 'A signed count and even an accepted shortage do not prove that the loaded vehicle is safe. Post-load securement is a separate check before Fleet clearance.' : 'At delivery, staff acknowledgment does not establish receiving authority. The current server must confirm receiving authority before completion. Unavailable or unsynced authority means wait and contact Fleet.'}</Text>
        <ClayButton label={session.step === 2 ? 'Wait for the source decision' : session.step === 3 ? 'Begin a new count; discard sample signature' : session.step === 4 ? 'Securement is a separate safety check' : 'Wait for server-confirmed receiving authority'} onPress={() => { if (send(session.step === 2 ? { action: 'wait' } : session.step === 3 ? { action: 'recount' } : { answer: session.step === 4 ? 'separate' : 'server' }) && session.step === 3) { set('counts')({}); set('issues')({}); setReview(false); } }} />
      </>}
    </>;
    return <Text style={type.bodyMd}>This topic has reading guidance only.</Text>;
  };
  return <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 20 }} keyboardShouldPersistTaps="handled"><Text accessibilityRole="header" style={type.headlineMd}>{guide.title}</Text><Text style={type.bodyMd}>{instruction}</Text>{notice ? <Text accessibilityLiveRegion="polite" style={[type.bodyMd, { color: colors.primary }]}>{notice}</Text> : null}{content()}</ScrollView>;
}
