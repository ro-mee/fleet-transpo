import { apiFetch } from '@/lib/api/client';

export function createInternalCargoReservation(payload) {
  return apiFetch('/api/reservations', { method: 'POST', body: payload });
}
