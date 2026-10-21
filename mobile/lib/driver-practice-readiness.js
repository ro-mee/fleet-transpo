// Recheck live work before practice; these existing endpoints are read-only.
export async function loadPracticeReadiness({ actorId, isCurrent, getItem, read, now = Date.now }) {
  try {
    if (actorId == null || !String(actorId).trim() || !isCurrent()) return { available: false };
    const raw = await Promise.all(['@offline_queue', '@offline_dead_letter_incidents', `@cargo_drafts:${actorId}`].map(getItem));
    if (!isCurrent()) return { available: false };
    const queues = raw.map(value => value === null ? [] : JSON.parse(value));
    if (!queues.every(Array.isArray)) return { available: false };
    const pending = queues[0].length > 0 || queues[1].length > 0 || queues[2].some(row => row?.syncState !== 'FLEET_SAVED');
    if (pending) return { available: true, hasPendingSubmission: true, hasAssignment: true, emergency: undefined, responderWork: undefined, checkedAt: now() };
    const options = { queueOnFailure: false, skipQueueDrain: true, cargoActorId: String(actorId) };
    const [trips, submissions, missions] = await Promise.all(['/api/mobile/driver/trips', '/api/mobile/driver/submissions', '/api/driver/incidents?role=responder'].map(path => read(path, options)));
    if (!isCurrent() || ![trips, submissions, missions].every(Array.isArray)) return { available: false };
    return {
      available: true, checkedAt: now(),
      hasAssignment: trips.some(trip => !['Completed', 'Cancelled'].includes(trip?.trip_status)),
      // A full capped history cannot prove the absence of an older open report.
      emergency: submissions.filter(row => row?.category === 'Incident').length >= 50 || submissions.some(row => row?.category === 'Incident' && row.status !== 'Resolved'),
      responderWork: missions.length > 0, hasPendingSubmission: false,
    };
  } catch { return { available: false }; }
}
