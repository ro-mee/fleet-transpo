import { cargoApi } from '@/lib/cargo/api';

export async function POST(req, context) {
  return cargoApi.clearance(req, context);
}
