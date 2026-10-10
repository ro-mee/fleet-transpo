import { cargoApi } from '@/lib/cargo/api';

export async function GET(req, context) {
  return cargoApi.get(req, context);
}
