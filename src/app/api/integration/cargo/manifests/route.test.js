import { it, expect } from 'vitest';
import { POST } from './route';
it('refuses unconfigured cargo writes without reading a body or treating source JSON as authentication', async () => {
  const response = await POST(new Request('http://localhost/api/integration/cargo/manifests', { method: 'POST', headers: { authorization: 'Bearer anything' }, body: '{invalid' }));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'CARGO_CONFIGURATION_REQUIRED' });
});
