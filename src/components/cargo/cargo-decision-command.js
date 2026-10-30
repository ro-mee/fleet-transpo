function freezePayload(payload) {
  const frozen = { ...payload };
  for (const key of ['communication_evidence_ids', 'reviewed_evidence_ids']) {
    if (Array.isArray(payload[key])) frozen[key] = Object.freeze([...payload[key]]);
  }
  if (payload.securement_checks) frozen.securement_checks = Object.freeze({ ...payload.securement_checks });
  return Object.freeze(frozen);
}

function isUncertain(error) {
  const status = error?.status;
  return !Number.isInteger(status) || status < 400 || status >= 500;
}

export function createCargoDecisionCommandManager({ send, createId }) {
  const pendingByTrip = new Map();

  return {
    hasPending(tripId) {
      return pendingByTrip.has(tripId);
    },

    async submit({ tripId, createPayload }) {
      if (!Number.isSafeInteger(tripId) || tripId < 1) return { status: "invalid" };

      let pending = pendingByTrip.get(tripId);
      if (!pending) {
        const eventId = createId();
        if (!eventId) return { status: "invalid" };
        const payload = createPayload(eventId);
        if (!payload || payload.event_id !== eventId) return { status: "invalid" };
        pending = { payload: freezePayload(payload) };
        pendingByTrip.set(tripId, pending);
      }

      const command = pending;
      try {
        const response = await send(tripId, command.payload);
        if (pendingByTrip.get(tripId) === command) pendingByTrip.delete(tripId);
        return { status: "accepted", response };
      } catch (error) {
        const uncertain = isUncertain(error);
        if (!uncertain && pendingByTrip.get(tripId) === command) pendingByTrip.delete(tripId);
        return { status: uncertain ? "uncertain" : "rejected", error };
      }
    },
  };
}
