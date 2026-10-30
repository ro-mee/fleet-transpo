import * as database from '@/lib/db';
import { createCargoExecutionCore } from './cargo-execution.core';
import { INTERNAL_CARGO_CONFIG } from '@/lib/cargo/internal-policy';
import { assertInternalCargoTrip } from './cargo-internal-authority';
import { cargoError } from './cargo-manifest.service';

export function createInternalCargoExecutionService({ db = database } = {}) {
  if (db === database && !process.env.DATABASE_URL) throw cargoError('CARGO_CONFIGURATION_REQUIRED','Internal cargo database is not configured.',503);
  const authorize = async ({ session, trip, tripId, tx }) => {
    await assertInternalCargoTrip(tripId ?? trip.trip_id, session, tx);
    return true;
  };
  return createCargoExecutionCore({ db, config: INTERNAL_CARGO_CONFIG, internal: true,
    authorizeFleet: authorize, authorizeStaffRead: authorize, authorizeLifecycle: async ({ session, trip, tx }) => { await assertInternalCargoTrip(trip.trip_id,session,tx,{lifecycle:true}); return true; } });
}

let runtime;
export const getInternalCargoExecutionService = () => runtime ??= createInternalCargoExecutionService();
