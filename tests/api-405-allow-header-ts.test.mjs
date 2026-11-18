// RUN WITH: `npm run test:data` OR `node --import=tsx --test tests/api-405-allow-header-ts.test.mjs`.
//
// RFC 9110 §15.5.6: a 405 response MUST carry an `Allow` header naming the
// methods the resource supports. This suite pins the TypeScript handlers
// whose method guard reached 405 without it. Each case sends a method the
// handler refuses and checks `Allow` against the handler's declared method
// list; where the handler answers OPTIONS with the same list, the preflight
// is checked too so the two cannot drift.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.WM_SESSION_SECRET ||= 'test-secret-must-be-at-least-32-chars-long-xxx';
process.env.UPSTASH_REDIS_REST_URL ||= 'https://example.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'test-token';

const ORIGIN = 'https://worldmonitor.app';
const load = async (path) => (await import(path)).default;

const CASES = [
  { name: 'skills/fetch-agentskills', path: '/api/skills/fetch-agentskills', module: '../api/skills/fetch-agentskills.ts', allow: 'POST, OPTIONS', refused: 'GET', preflight: false },
];

const ctx = { waitUntil() {} };

describe('TypeScript handler 405 responses carry an Allow header', () => {
  for (const { name, path, module, allow, refused, preflight, headers = {}, prepare } of CASES) {
    it(`${name}: ${refused} is refused with Allow: ${allow}`, async () => {
      const handler = await load(module);
      await prepare?.();
      const res = await handler(new Request(`${ORIGIN}${path}`, {
        method: refused,
        headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
        ...(refused === 'GET' || refused === 'HEAD' ? {} : { body: '{}' }),
      }), ctx);
      assert.equal(res.status, 405, `${name} must answer 405 to ${refused}`);
      assert.equal(res.headers.get('allow'), allow, `${name} must name its supported methods`);
    });

    if (preflight) {
      it(`${name}: Allow matches the preflight method list`, async () => {
        const handler = await load(module);
        const res = await handler(new Request(`${ORIGIN}${path}`, {
          method: 'OPTIONS',
          headers: { origin: ORIGIN, 'access-control-request-method': allow.split(',')[0].trim() },
        }), ctx);
        assert.equal(res.status, 204);
        assert.equal(res.headers.get('access-control-allow-methods'), allow);
      });
    }
  }
});
