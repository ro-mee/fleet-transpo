import { apiFetch, buildQuery } from '@/lib/api/client';

export const getInternalCargoReviews = (filters, { signal } = {}) => apiFetch(`/api/cargo-review${buildQuery(filters)}`, { signal, cache: 'no-store' });
export const submitInternalCargoReview = (tripId, payload, { signal } = {}) => apiFetch(`/api/trips/${Number(tripId)}/cargo/internal-review`, { method: 'POST', body: payload, signal });
