import { withTransaction } from '@/lib/db';
import { createAdminClient } from '@/lib/supabase/admin';
import { CARGO_EVIDENCE_BUCKET } from '@/lib/storage/key-format';
import { cargoError } from '@/services/cargo-manifest.service';
import { createInternalCargoEvidenceStore } from './evidence-storage';

const unavailable = () => { throw cargoError('CARGO_UPLOAD_UNAVAILABLE', 'Private cargo photos are unavailable. Retry this request.', 503); };

export function createInternalCargoStorageAdapter(client = createAdminClient) {
  function bucket(options) {
    if (typeof window !== 'undefined' || options?.bucket !== CARGO_EVIDENCE_BUCKET) unavailable();
    return client().storage.from(CARGO_EVIDENCE_BUCKET);
  }
  return {
    async upload(key, bytes, options) {
      if (!['image/jpeg', 'image/png'].includes(options?.contentType) || options.upsert !== true) unavailable();
      const { error } = await bucket(options).upload(key, bytes, { contentType: options.contentType, upsert: true });
      if (error) unavailable();
    },
    async sign(key, options) {
      if (options?.expiresIn !== 300) unavailable();
      const { data, error } = await bucket(options).createSignedUrl(key, 300);
      if (error || !data?.signedUrl) unavailable();
      return { url: data.signedUrl, expires_in: 300 };
    },
  };
}

// Lazy clients: importing a route never opens a connection or storage session.
function runtime() {
  return createInternalCargoEvidenceStore({ db: { withTransaction }, storage: createInternalCargoStorageAdapter() });
}
export function storeInternalCargoEvidence(input, session) {
  return runtime().storeCargoEvidence(input, session);
}
export function signInternalCargoEvidence({ evidenceId, tripId, session }) {
  return runtime().signCargoEvidence(evidenceId, session, { tripId });
}
