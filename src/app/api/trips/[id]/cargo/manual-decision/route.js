import { cargoApi } from '@/lib/cargo/api';

export async function POST(req, context) {
  return cargoApi.manualDecision(req, context);
}
