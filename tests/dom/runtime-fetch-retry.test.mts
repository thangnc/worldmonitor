import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://api.worldmonitor.app';
const ORIGIN = 'https://worldmonitor.app';
const PATH = '/api/health';
const originalFetch = window.fetch;
const state = window as unknown as Record<string, unknown>;

type Form = 'relative' | 'absolute' | 'url' | 'request' | 'api-url' | 'api-request';
function inputFor(form: Form, method: string): [RequestInfo | URL, RequestInit?] {
  const init = { method, ...(method === 'POST' ? { body: 'payload' } : {}) };
  if (form === 'relative') return [PATH, init];
  if (form === 'absolute') return [API + PATH, init];
  if (form === 'url') return [new URL(ORIGIN + PATH), init];
  if (form === 'api-url') return [new URL(API + PATH), init];
  return [new Request((form === 'request' ? ORIGIN : API) + PATH, init)];
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_WS_API_URL', API);
  vi.stubGlobal('location', { hostname: 'worldmonitor.app', host: 'worldmonitor.app', protocol: 'https:', origin: ORIGIN, href: ORIGIN + '/' });
});
afterEach(() => {
  window.fetch = originalFetch;
  delete state.__wmWebRedirectPatched;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function web(failure: number | 'network', abort?: AbortController) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    abort?.abort();
    if (failure === 'network') throw new TypeError('network failure');
    return new Response('failure', { status: failure });
  });
  window.fetch = fetch;
  (await import('@wm/client/services/runtime')).installWebApiRedirect();
  return fetch;
}

describe('web generic fallback', () => {
  for (const form of ['relative', 'absolute', 'url', 'request', 'api-url', 'api-request'] as const) {
    for (const failure of [404, 405, 501, 502, 503, 'network'] as const) {
      it(`does not replay POST ${form} after ${failure}`, async () => {
        const native = await web(failure);
        const [input, init] = inputFor(form, 'POST');
        const result = window.fetch(input, init);
        if (failure === 'network') await expect(result).rejects.toThrow('network failure');
        else expect((await result).status).toBe(failure);
        expect(native).toHaveBeenCalledTimes(1);
      });
    }
  }
  for (const method of ['GET', 'HEAD']) {
    for (const form of ['relative', 'absolute', 'url', 'request'] as const) {
      it(`retains ${method} ${form} recovery`, async () => {
        const native = await web(502);
        native.mockResolvedValueOnce(new Response(null, { status: 502 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
        expect((await window.fetch(...inputFor(form, method))).status).toBe(200);
        expect(native).toHaveBeenCalledTimes(2);
      });
    }
  }
  for (const form of ['relative', 'request'] as const) {
    for (const failure of [502, 'network'] as const) {
      it(`does not recover cancelled ${form} after ${failure}`, async () => {
        const controller = new AbortController();
        const native = await web(failure, controller);
        const input = form === 'request' ? new Request(ORIGIN + PATH, { signal: controller.signal }) : PATH;
        await window.fetch(input, form === 'relative' ? { signal: controller.signal } : undefined).catch(() => {});
        expect(native).toHaveBeenCalledTimes(1);
      });
    }
  }
  it('uses init method over Request method', async () => {
    const native = await web(502);
    await window.fetch(new Request(ORIGIN + PATH), { method: 'PATCH', body: 'change' });
    expect(native).toHaveBeenCalledTimes(1);
  });
  it('allows an effective GET overriding a bodyless POST Request', async () => {
    const native = await web(502);
    await window.fetch(new Request(ORIGIN + PATH, { method: 'POST' }), { method: 'GET' });
    expect(native).toHaveBeenCalledTimes(2);
  });
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    it(`does not replay ${method} on a rejected fetch`, async () => {
      const native = await web('network');
      await expect(window.fetch(PATH, { method })).rejects.toThrow('network failure');
      expect(native).toHaveBeenCalledTimes(1);
    });
  }
  it('preserves caller credentials and headers through safe recovery', async () => {
    const native = await web(502);
    await window.fetch(PATH, { credentials: 'omit', headers: { 'X-Test': 'retained' } });
    expect(native).toHaveBeenCalledTimes(2);
    for (const [, init] of native.mock.calls) {
      expect(init?.credentials).toBe('omit');
      expect(new Headers(init?.headers).get('X-Test')).toBe('retained');
    }
  });
  it('retains explicit billing denial retry for POST', async () => {
    vi.useFakeTimers();
    const native = await web(503);
    native.mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'X-Billing-Verification': 'entitlement_verification_unavailable', 'Retry-After': '1' } })).mockResolvedValueOnce(new Response('ok'));
    const request = window.fetch(PATH, { method: 'POST', body: 'payload' });
    await vi.runAllTimersAsync();
    expect((await request).status).toBe(200);
    expect(native).toHaveBeenCalledTimes(2);
    expect(native.mock.calls.map(call => String(call[0]))).toEqual([API + PATH, API + PATH]);
  });
});
