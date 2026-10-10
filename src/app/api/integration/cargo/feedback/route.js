import { z } from 'zod';
import { requirePermission, ok, handleError, AuthError } from '@/lib/api/utils';
import { listCargoFeedback, retryCargoFeedback } from '@/services/cargo-feedback.service';

const scopeSchema = z.object({ trip_id: z.coerce.number().int().positive(), source_system: z.enum(['PMS','POS','SCM']), organization_id: z.string().trim().min(1).max(128), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const retrySchema = scopeSchema.extend({ event_id: z.string().uuid() }).strict();
const invalid = () => new AuthError('Invalid cargo feedback request.', 400, 'CARGO_INVALID_INPUT');
async function boundedBody(req) {
  const reader=req.body?.getReader(); if(!reader) return {};
  const chunks=[]; let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();throw invalid();}chunks.push(value);} }
  finally { reader.releaseLock(); }
  if(!size)return {};
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw invalid();}
}

export async function GET(req) {
  try {
    const session = await requirePermission(req, 'integrations', 'read');
    const params = new URL(req.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw invalid();
    const raw = Object.fromEntries(params.entries());
    const parsed = scopeSchema.safeParse(raw);
    if (!parsed.success) throw invalid();
    const { trip_id: tripId, source_system: sourceSystem, organization_id: organizationId, limit } = parsed.data;
    const rows = await listCargoFeedback({ req, session, tripId, sourceSystem, organizationId, limit });
    return ok({ data: rows });
  } catch (error) { return handleError(error); }
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, 'integrations', 'execute');
    const parsed = retrySchema.safeParse(await boundedBody(req));
    if (!parsed.success) throw invalid();
    const { trip_id: tripId, source_system: sourceSystem, organization_id: organizationId, event_id: eventId } = parsed.data;
    return ok({ data: await retryCargoFeedback({ req, session, tripId, sourceSystem, organizationId, eventId }) });
  } catch (error) { return handleError(error); }
}
