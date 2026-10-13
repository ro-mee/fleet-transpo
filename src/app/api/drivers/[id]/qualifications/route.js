import { AuthError, requirePermission, handleError } from '@/lib/api/utils';

const retired = () => new AuthError('The separate service qualification roster has been retired. Manage the saved driver classification in Driver Details.', 503, 'QUALIFICATION_ROSTER_RETIRED');

export async function GET(req) {
  try {
    await requirePermission(req, 'driver_qualifications', 'read');
    throw retired();
  } catch (error) { return handleError(error, { req }); }
}

export async function PUT(req) {
  try {
    await requirePermission(req, 'driver_qualifications', 'manage');
    throw retired();
  } catch (error) { return handleError(error, { req }); }
}
