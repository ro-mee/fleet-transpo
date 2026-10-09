import { safeEqual } from '@/lib/api/service-auth';

function bearer(req) {
  const header = req.headers.get('authorization') || '';
  return { header, token: header.startsWith('Bearer ') ? header.slice(7).trim() : '' };
}

// The legacy request injector remains session-capable; cargo never uses this fallback.
export async function authorizeRequestSource(req, { staffFallback } = {}) {
  const { header, token } = bearer(req);
  const pms = process.env.BOOKING_WEBHOOK_SECRET, pos = process.env.POS_WEBHOOK_SECRET;
  if (pms && pos && safeEqual(pms, pos)) return null;
  for (const [source, secret] of [['PMS', pms], ['POS', pos]]) {
    if (secret?.trim() && token && safeEqual(token, secret)) return { actor: 'service', session: null, source };
  }
  if (header) return null;
  return staffFallback ? staffFallback(req) : null;
}

// Credentials must come from trusted server configuration, never request JSON.
// No production or sandbox mappings are installed by this development slice.
export async function authorizeCargoSource(req, { allowSandbox = false, credentials = [], environment = process.env.NODE_ENV } = {}) {
  const { token } = bearer(req);
  if (!token || !Array.isArray(credentials)) return null;
  // Ambiguous credentials fail the whole mapping, including aliases across organizations.
  const secrets = credentials.map(item => item?.secret);
  if (secrets.some(secret => typeof secret !== 'string' || !secret.trim()) || new Set(secrets).size !== secrets.length) return null;
  const entry = credentials.find(item => safeEqual(token, item.secret));
  const nonblank = value => typeof value === 'string' && value.trim().length > 0;
  if (!entry || !['PMS', 'POS', 'SCM'].includes(entry.system) || !nonblank(entry.organization_id) || !nonblank(entry.subject) || !nonblank(entry.approval_ref)) return null;
  if (entry.simulated && (!allowSandbox || environment === 'production' || !['test', 'development'].includes(environment))) return null;
  if (!Array.isArray(entry.capabilities) || !entry.capabilities.every(value => ['cargo:manifest:write', 'cargo:decision:write'].includes(value))) return null;
  return { system: entry.system, organization_id: entry.organization_id, subject: entry.subject, capabilities: [...entry.capabilities] };
}
