import { apiFetch } from './api';
import { isCurrentCargoSession } from './cargo-sync';

export function odometerRequestOptions(session) {
  if (!isCurrentCargoSession(session)) throw new Error('Your account changed. Reopen the current trip.');
  return { queueOnFailure: false, cargoActorId: session.actorId, signal: session.signal };
}

export const odometerApi = {
  upload(tripId, { stage, captureId, asset }, session) {
    const body = new FormData();
    body.append('stage', stage);
    body.append('capture_id', captureId);
    body.append('image', { uri: asset.uri, name: 'odometer.jpg', type: 'image/jpeg' });
    return apiFetch(`/api/mobile/driver/trips/${tripId}/odometer`, { method: 'POST', body, ...odometerRequestOptions(session) });
  },
  scan(tripId, captureId, session) {
    return apiFetch(`/api/mobile/driver/trips/${tripId}/odometer/${captureId}/scan`, { method: 'POST', ...odometerRequestOptions(session) });
  },
  read(tripId, captureId, session) {
    return apiFetch(`/api/mobile/driver/trips/${tripId}/odometer/${captureId}`, odometerRequestOptions(session));
  },
};

export function odometerStartRoute(trip) {
  if (trip?.odometer_photo_required_at_start !== true) return null;
  return trip.pre_trip_status === 'Passed'
    ? { pathname: '/trip/odometer', params: { tripId: String(trip.trip_id), stage: 'start' } }
    : { pathname: '/inspection', params: { tripId: String(trip.trip_id), continuation: 'odometer-start' } };
}

// Same UUID-v4 convention as cargo drafts; the server owns evidence authority.
export function newOdometerCaptureId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
}

export function captureReady(record, tripId, stage, captureId) {
  const age = Date.now() - Date.parse(record?.uploaded_at);
  return Boolean(record && record.capture_id === captureId && String(record.trip_id) === String(tripId)
    && record.stage === stage && ['ready', 'committed'].includes(record.state)
    && record.unit === 'km' && Number(record.reading_km) > 0 && Number(record.reading_km) <= 2000000
    && Number.isFinite(age) && age >= 0 && (record.state === 'committed' || age <= 30 * 60 * 1000));
}

export function odometerFailureMessage(record) {
  if (record?.failure_code === 'ODOMETER_UNIT_UNSUPPORTED') return 'This display is not supported. Photograph the total odometer with its km unit visible.';
  return 'The total odometer could not be read clearly. Retake the photo with all digits and the km unit visible.';
}
