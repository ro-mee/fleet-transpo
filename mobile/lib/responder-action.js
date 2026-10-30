import { api } from './api';
import { captureCargoSession, isCurrentCargoSession } from './cargo-sync';

/** Bind the latest-assignment endpoints to the incident the driver reviewed. */
export async function runResponderAction({ incidentId, actorId, action, isCurrent }) {
  const session = captureCargoSession(actorId);
  const current = () => session && isCurrentCargoSession(session) && isCurrent();
  if (!['arrived', 'resolve'].includes(action) || !/^\d+$/.test(String(incidentId)) || !current()) throw new Error('Refresh this mission online before continuing.');
  const options = { queueOnFailure: false, cargoActorId: actorId, signal: session.signal };
  const missions = await api.get('/api/driver/incidents?role=responder', options);
  if (!current()) throw new Error('Your session or mission changed. Refresh before continuing.');
  const mission = Array.isArray(missions) ? missions[0] : null;
  if (String(mission?.incident_id) !== String(incidentId)) throw new Error('Your responder assignment changed. Refresh this incident before continuing.');
  const result = await api.post(`/api/driver/responder/${action}`, { incident_id: Number(incidentId) }, options);
  if (!current()) throw new Error('Your session or mission changed. Refresh before continuing.');
  if (result?.queued || String(result?.incident_id) !== String(incidentId)) throw new Error('The server has not confirmed this mission update. Refresh before retrying.');
  return result;
}
