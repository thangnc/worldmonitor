import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

import { createDomainGateway } from '../packages/server/gateway.ts';
import {
  appendDeprecationPolicyLink,
  appendDeprecationPolicyLinkToRecord,
  DEPRECATION_POLICY_LINK,
  DEPRECATION_POLICY_URL,
} from '../packages/server/_shared/deprecation-policy.ts';
import handler from '../api/not-found.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const DEPRECATION_TEST_KEY = 'deprecation-policy-test-operator-key';
const htmlPolicyUrl = 'https://www.worldmonitor.app/docs/api-versioning';
const staticPolicyUrl = 'https://www.worldmonitor.app/api-versioning.md';

describe('REST API versioning and deprecation policy', () => {
  it('keeps the policy discoverable from the OpenAPI generator and source bundle', () => {
    for (const path of [
      'packages/contracts/proto/buf.gen.yaml',
      'packages/contracts/openapi/worldmonitor.openapi.yaml',
    ]) {
      const source = read(path);
      assert.match(source, new RegExp(htmlPolicyUrl.replaceAll('.', '\\.')));
      assert.match(source, /api-versioning\.md/);
    }
  });

});

describe('appendDeprecationPolicyLink', () => {
  it('sets the RFC 9745 policy-discovery Link and is idempotent', () => {
    const headers = new Headers();
    appendDeprecationPolicyLink(headers);
    assert.equal(headers.get('Link'), DEPRECATION_POLICY_LINK);
    appendDeprecationPolicyLink(headers);
    assert.equal(headers.get('Link'), DEPRECATION_POLICY_LINK);
    assert.equal(DEPRECATION_POLICY_URL, staticPolicyUrl);
  });

  it('appends beside an existing canonical Link on a record', () => {
    const headers = { Link: '</twin.md>; rel="canonical"' };
    appendDeprecationPolicyLinkToRecord(headers);
    assert.match(headers.Link, /rel="canonical"/);
    assert.match(headers.Link, /rel="deprecation"/);
    appendDeprecationPolicyLinkToRecord(headers);
    assert.equal(headers.Link.match(/rel="deprecation"/g)?.length, 1);
  });
});

describe('deprecation policy Link on live API handlers', () => {
  const originalValidKeys = process.env.WORLDMONITOR_VALID_KEYS;

  afterEach(() => {
    if (originalValidKeys == null) delete process.env.WORLDMONITOR_VALID_KEYS;
    else process.env.WORLDMONITOR_VALID_KEYS = originalValidKeys;
  });

  it('gateway success and OPTIONS responses carry rel="deprecation"', async () => {
    const gateway = createDomainGateway([
      {
        method: 'GET',
        path: '/api/seismology/v1/list-earthquakes',
        handler: async () => Response.json({ source: 'rpc' }),
      },
    ]);

    process.env.WORLDMONITOR_VALID_KEYS = DEPRECATION_TEST_KEY;
    const ok = await gateway(new Request('https://worldmonitor.app/api/seismology/v1/list-earthquakes', {
      headers: { 'X-WorldMonitor-Key': DEPRECATION_TEST_KEY },
    }));
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('link') ?? '', /rel="deprecation"/);
    assert.match(ok.headers.get('link') ?? '', /api-versioning\.md/);

    const options = await gateway(new Request('https://worldmonitor.app/api/seismology/v1/list-earthquakes', {
      method: 'OPTIONS',
      headers: { Origin: 'https://worldmonitor.app' },
    }));
    assert.equal(options.status, 204);
    assert.match(options.headers.get('link') ?? '', /rel="deprecation"/);
  });

  it('unmatched /api catch-all 404s advertise the same policy Link', async () => {
    const res = await handler(new Request('https://worldmonitor.app/api/definitely-missing'));
    assert.equal(res.status, 404);
    assert.match(res.headers.get('link') ?? '', /rel="deprecation"/);
    assert.match(res.headers.get('link') ?? '', /api-versioning\.md/);
  });
});
