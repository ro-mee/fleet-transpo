import { useEffect, useRef, useState } from 'react';
import { isCurrentCargoSession } from './cargo-sync';
import { captureReady, newOdometerCaptureId, odometerApi, odometerFailureMessage } from './trip-odometer';

function errorText(error, fallback) {
  if (error.message?.includes('Upload was not queued')) return 'Odometer photo upload was not confirmed. Reconnect and retry.';
  if (error.message?.includes('Nothing was queued')) return 'Connection lost. This trip update was not confirmed. Reconnect and retry.';
  return error.message || fallback;
}

/** Screen-owned, in-memory draft. No signed URL, file or command is persisted. */
export function useTripOdometer({ tripId, stage, session, disabledReason, onConfirm }) {
  const [view, setView] = useState({ phase: 'camera', asset: null, reading: null, error: null, retakeRequired: false });
  const draft = useRef(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const clear = () => {
      generation.current += 1;
      draft.current = null;
      busy.current = false;
      setView({ phase: 'camera', asset: null, reading: null, error: null, retakeRequired: false });
    };
    clear();
    session?.signal?.addEventListener('abort', clear);
    return () => { mounted.current = false; generation.current += 1; draft.current = null; session?.signal?.removeEventListener('abort', clear); };
  }, [tripId, stage, session]);
  useEffect(() => {
    const record = draft.current?.record;
    if (view.phase !== 'review' || !record || record.state === 'committed') return;
    const token = generation.current;
    const remaining = Math.max(0, Date.parse(record.uploaded_at) + 30 * 60 * 1000 - Date.now());
    const timer = setTimeout(() => {
      if (mounted.current && token === generation.current && isCurrentCargoSession(session)) {
        const uncertain = draft.current?.confirmationUncertain === true;
        setView(v => ({ ...v, phase: 'error', error: uncertain ? 'The trip update was not confirmed. Reconnect and tap Retry to check this same photo.' : 'This photo has expired. Retake it before continuing.', retakeRequired: !uncertain }));
      }
    }, remaining);
    return () => clearTimeout(timer);
  }, [view.phase, session]);

  const current = token => mounted.current && generation.current === token && isCurrentCargoSession(session);
  const onCapture = asset => {
    if (busy.current || disabledReason || !isCurrentCargoSession(session)) return;
    generation.current += 1;
    draft.current = { asset, captureId: newOdometerCaptureId(), attempted: false, uploadConfirmed: false, record: null };
    setView({ phase: 'preview', asset, reading: null, error: null, retakeRequired: false });
  };
  const onRetake = () => {
    if (busy.current) return;
    generation.current += 1;
    draft.current = null;
    setView({ phase: 'camera', asset: null, reading: null, error: null, retakeRequired: false });
  };
  const onRead = async () => {
    if (busy.current || disabledReason || !draft.current || !isCurrentCargoSession(session)) return;
    if (draft.current.confirmationUncertain) return confirm();
    busy.current = true;
    const token = generation.current;
    const saved = draft.current;
    try {
      let record = saved.record;
      // After a lost response, reconcile this exact image before retrying.
      if (saved.attempted) {
        setView(v => ({ ...v, phase: 'scanning', error: null }));
        try { record = await odometerApi.read(tripId, saved.captureId, session); }
        catch (error) {
          if (saved.uploadConfirmed || !(Number(error.status) === 404 || error.code === 'ODOMETER_CAPTURE_MISMATCH')) throw error;
          record = null;
        }
        if (!current(token)) return;
      }
      if (!record || (!saved.uploadConfirmed && !['ready', 'committed'].includes(record.state))) {
        saved.attempted = true;
        setView(v => ({ ...v, phase: 'uploading', error: null }));
        record = await odometerApi.upload(tripId, { stage, captureId: saved.captureId, asset: saved.asset }, session);
        if (!current(token)) return;
        saved.uploadConfirmed = true;
      }
      saved.record = record;
      if (!['ready', 'committed', 'unreadable'].includes(record.state)) {
        setView(v => ({ ...v, phase: 'scanning', error: null }));
        record = await odometerApi.scan(tripId, saved.captureId, session);
        if (!current(token)) return;
        saved.record = record;
      }
      if (record.state === 'scanning') {
        setView(v => ({ ...v, phase: 'error', error: 'Reading is still in progress. Keep this photo and tap Retry in a moment.', retakeRequired: false }));
        return;
      }
      if (!captureReady(record, tripId, stage, saved.captureId)) {
        const error = new Error(record.state === 'ready' ? 'This photo is no longer current. Retake it before continuing.' : odometerFailureMessage(record));
        error.retakeRequired = true;
        throw error;
      }
      setView(v => ({ ...v, phase: 'review', reading: Number(record.reading_km), error: null }));
    } catch (error) {
      if (current(token)) setView(v => ({ ...v, phase: 'error', error: errorText(error, 'Could not read this photo. Retry online or retake it.'), retakeRequired: error.retakeRequired === true || ['ODOMETER_CAPTURE_EXPIRED', 'ODOMETER_RETAKE_REQUIRED', 'ODOMETER_UNIT_UNSUPPORTED'].includes(error.code) }));
    } finally { if (current(token)) busy.current = false; }
  };
  const confirm = async () => {
    if (busy.current || disabledReason || !isCurrentCargoSession(session)) return;
    const saved = draft.current;
    if (!saved || (!saved.confirmationUncertain && !captureReady(saved.record, tripId, stage, saved.captureId))) {
      setView(v => ({ ...v, phase: 'error', error: 'Retake the photo to confirm a current odometer reading.', retakeRequired: true }));
      return;
    }
    busy.current = true;
    const token = generation.current;
    setView(v => ({ ...v, phase: 'saving', error: null }));
    try {
      // A failed confirmation may already have committed. Check this exact ID
      // online before local age can require a retake or another transition.
      if (saved.confirmationUncertain) {
        const record = await odometerApi.read(tripId, saved.captureId, session);
        if (!current(token)) return;
        saved.record = record;
        if (!captureReady(record, tripId, stage, saved.captureId)) throw Object.assign(new Error('This photo has expired or changed. Retake it before continuing.'), { code: 'ODOMETER_CAPTURE_EXPIRED' });
      }
      saved.confirmationUncertain = true;
      await onConfirm(saved.captureId);
      if (current(token)) { saved.confirmationUncertain = false; setView(v => ({ ...v, phase: 'review', retakeRequired: false })); }
    } catch (error) {
      if (['ODOMETER_CAPTURE_EXPIRED', 'ODOMETER_CAPTURE_MISMATCH'].includes(error.code)) saved.confirmationUncertain = false;
      if (current(token)) setView(v => ({ ...v, phase: ['ODOMETER_CAPTURE_EXPIRED', 'ODOMETER_CAPTURE_MISMATCH'].includes(error.code) ? 'error' : 'review', error: errorText(error, 'The trip update was not confirmed. Retry online.'), retakeRequired: ['ODOMETER_CAPTURE_EXPIRED', 'ODOMETER_CAPTURE_MISMATCH'].includes(error.code) }));
    } finally { if (current(token)) busy.current = false; }
  };
  return { ...view, onCapture, onRead, onRetake, onConfirm: confirm };
}
