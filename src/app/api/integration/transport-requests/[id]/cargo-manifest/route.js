import { AuthError, requirePermission, ok, handleError } from '@/lib/api/utils';
import { readRequestCargoManifests } from '@/services/cargo-physical.service';
import { adaptRequestManifest } from '@/services/cargo-manifest.service';

// Source manifest metadata only. Receipt/evidence/private-image access still
// uses the separately scoped, currently unavailable cargo execution API.
export async function GET(req, { params }) {
  try {
    await requirePermission(req, 'reservations', 'read');
    const raw = (await params).id;
    const id = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw new AuthError('A valid request ID is required.', 400);
    const [row] = await readRequestCargoManifests([id]);
    if (!row) throw new AuthError('Transportation request not found.', 404);
    if (row.load_type !== 'Cargo' || !row.manifest_snapshot) return ok({ data: { manifest: null, availability: 'MISSING' } });
    const source = adaptRequestManifest(row, row);
    const manifest = { ...source, lines: source.lines.map(line => ({ ...line, reference_image_ref: null })) };
    return ok({ data: { manifest, availability: 'AVAILABLE' } });
  } catch (error) {
    if (error.code?.startsWith('CARGO_')) return handleError(new AuthError(error.message, error.status ?? 409, error.code), { req });
    return handleError(error, { req });
  }
}
