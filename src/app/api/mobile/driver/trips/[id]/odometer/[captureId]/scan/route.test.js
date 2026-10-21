import { beforeEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { NextRequestAdapter } from 'next/dist/server/web/spec-extension/adapters/next-request';
import { NodeNextRequest } from 'next/dist/server/base-http/node';
const deps = vi.hoisted(() => ({ guard: vi.fn(), service: vi.fn() }));
vi.mock('@/lib/api/utils', () => ({
  requireDriver: deps.guard,
  AuthError: class extends Error { constructor(message,status,code) { super(message); this.status=status; this.code=code; } },
  ok: (value,status=200) => Response.json(value,{status}),
  handleError: error => Response.json({error:error.message,code:error.code},{status:error.status || 500}),
}));
vi.mock('@/services/trip-odometer.service', () => ({ scanOdometerCapture: deps.service }));
import { POST } from './route';
const context = { params: Promise.resolve({id:'7',captureId:'12345678-1234-4234-8234-123456789abc'}) };
beforeEach(() => { vi.clearAllMocks(); deps.guard.mockResolvedValue({user:{driverId:4}}); deps.service.mockResolvedValue({state:'ready'}); });
const request = () => {
  return new Request('http://local',{method:'POST'});
};
it('authorizes before accessing capture data', async () => {
  deps.guard.mockRejectedValue(Object.assign(new Error('Unauthorized'),{status:401}));
  expect((await POST(request(),context)).status).toBe(401);
  expect(deps.service).not.toHaveBeenCalled();
});
it('awaits params and returns private noncached evidence', async () => {
  const response=await POST(request(),context);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(deps.service).toHaveBeenCalledWith(expect.objectContaining({tripId:'7'}));
  
});
it('rejects client supplied URLs or readings', async () => {
  const req=new Request('http://local',{method:'POST',body:JSON.stringify({reading_km:999,image_url:'https://attacker'})});
  expect((await POST(req,context)).status).toBe(400);
  expect(deps.service).not.toHaveBeenCalled();
});
it('rejects whitespace bodies without buffering them as text', async () => {
  const req = new Request('http://local',{method:'POST',body:'   '});
  const read = vi.spyOn(req,'text');
  expect((await POST(req,context)).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
  expect(deps.service).not.toHaveBeenCalled();
});
it('rejects the first chunk without waiting for stream completion', async () => {
  const read = vi.fn().mockRejectedValue(new Error('Body must not be read'));
  const cancel = vi.fn();
  const req = { body: new ReadableStream({ start: controller => controller.enqueue(new Uint8Array([32])), cancel }), text: read };
  expect((await POST(req,context)).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalled();
  expect(deps.service).not.toHaveBeenCalled();
});
it('accepts a real Next Node adapter empty POST with Content-Length zero', async () => {
  const incoming = Object.assign(Readable.from([], { objectMode: false }), { method: 'POST', url: 'http://local/api/scan', headers: { 'content-length': '0' } });
  const req = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), new AbortController().signal);
  expect(req.body).not.toBeNull();
  expect((await POST(req,context)).status).toBe(200);
  expect(deps.service).toHaveBeenCalledOnce();
});
it('accepts the real mobile scan wrapper through apiFetch and the Next Node adapter', async () => {
  const controller = new AbortController();
  const session = { actorId: '10', signal: controller.signal };
  const cargo = { isCurrentCargoSession: s => s === session && !s.signal.aborted, isCurrentCargoActor: id => id === '10', getCargoActorSignal: () => session.signal };
  async function evaluate(path, imports, globals = {}) {
    const { code } = await transform(readFileSync(path, 'utf8'), { format: 'cjs' });
    const scope = { exports: {} };
    runInNewContext(code, { module: scope, exports: scope.exports, FormData, AbortController, setTimeout, clearTimeout, console, ...globals, require: name => {
      if (!imports[name]) throw Error(`Unexpected dependency ${name}`);
      return imports[name];
    } });
    return scope.exports;
  }
  const transport = async (url, init) => {
    const bytes = init.body == null ? [] : [Buffer.from(init.body)];
    const incoming = Object.assign(Readable.from(bytes, { objectMode: false }), { method: init.method, url, headers: { ...init.headers, 'content-length': String(bytes.reduce((n, chunk) => n + chunk.length, 0)) } });
    const req = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), init.signal);
    return POST(req, context);
  };
  const api = await evaluate('mobile/lib/api.js', {
    './storage': { getAccessToken: async () => 'fixture-token' }, './offline-cache': {},
    './sync': { setApiFetch() {}, hasPendingWork: () => false },
    './connectivity-state': {}, './cargo-sync': cargo,
  }, { process: { env: { EXPO_PUBLIC_API_URL: 'http://local' } }, fetch: transport });
  const { odometerApi } = await evaluate('mobile/lib/trip-odometer.js', { './api': api, './cargo-sync': cargo });
  await expect(odometerApi.scan('7', '12345678-1234-4234-8234-123456789abc', session)).resolves.toEqual({ state: 'ready' });
  expect(deps.service).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tripId: '7', captureId: '12345678-1234-4234-8234-123456789abc' }));
});
it('bounds waiting for an endless empty stream and cancels it', async () => {
  vi.useFakeTimers();
  try {
    const cancel = vi.fn();
    const req = { body: new ReadableStream({ cancel }) };
    const result = POST(req,context);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).status).toBe(400);
    expect(cancel).toHaveBeenCalled();
    expect(deps.service).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it('cancels a pending empty-stream check when the caller aborts', async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const req = { body: new ReadableStream({ cancel }), signal: controller.signal };
  const result = POST(req,context);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  expect((await result).status).toBe(400);
  expect(cancel).toHaveBeenCalled();
  expect(deps.service).not.toHaveBeenCalled();
});
