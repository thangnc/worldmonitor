import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFERRED_GENERATED_SERVICES } from '../scripts/lib/sebuf-deferred-services.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/**
 * #5907: every sebuf route family under server/worldmonitor/ needs an explicit
 * local-api path decision. A v1 family is served from api/{domain}/v1/[rpc].ts.
 * A versioned family (api/v{N}/{domain}/[rpc].ts) must be routed to the cloud
 * on purpose by the local-api server — otherwise it only reaches the cloud
 * through the 404 "handler missing" fallback, which is an accident, and a dead
 * end when cloudFallback is off. A family whose gateway was retired on purpose
 * (a DEFERRED_GENERATED_SERVICES entry: server helpers kept, no api/ entry) is
 * deliberately unreachable and needs no decision.
 */

const sidecar = readFileSync(resolve(root, 'docker/local-api/local-api-server.mjs'), 'utf-8');

function listFromSource(source, name) {
  const match = source.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `${name} not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const sidecarCloudOnlyPrefixes = listFromSource(sidecar, 'cloudOnlyRouteFamilyPrefixes');

/** Every {domain, version} pair under server/worldmonitor/, with its api entry. */
function serverFamilies() {
  const serverRoot = resolve(root, 'server/worldmonitor');
  const families = [];
  for (const domain of readdirSync(serverRoot).sort()) {
    const domainDir = join(serverRoot, domain);
    if (!statSync(domainDir).isDirectory()) continue;
    for (const version of readdirSync(domainDir).sort()) {
      if (!/^v\d+$/.test(version)) continue;
      const bundledEntry = `api/${domain}/v1/[rpc].ts`;
      const versionedEntry = `api/${version}/${domain}/[rpc].ts`;
      families.push({
        domain,
        version,
        key: `${version}/${domain}`,
        bundled: version === 'v1' && existsSync(resolve(root, bundledEntry)),
        versioned: existsSync(resolve(root, versionedEntry)),
        urlPrefix: version === 'v1' ? `/api/${domain}/v1/` : `/api/${version}/${domain}/`,
        deferred: DEFERRED_GENERATED_SERVICES.has(`${domain.replaceAll('-', '_')}/${version}`),
      });
    }
  }
  return families;
}

describe('local-api path decision per server/worldmonitor route family (#5907)', () => {
  const families = serverFamilies();

  it('finds the families the repo is known to have', () => {
    // The 13 RPC gateways the Lite UI calls. Retired families (deferred
    // services) add to the directory count until Phase 2 removes their helpers.
    const served = families.filter((f) => f.bundled || f.versioned);
    assert.ok(served.length >= 13, `expected the kept sebuf domains, saw ${served.length}`);
  });

  it('a retired family has no api entry left behind', () => {
    for (const f of families.filter((x) => x.deferred)) {
      assert.ok(!f.bundled && !f.versioned, `${f.key}: is a deferred service but still has an api entry`);
    }
  });

  it('every family has exactly one api entry the local-api server can reason about', () => {
    for (const f of families.filter((x) => !x.deferred)) {
      assert.ok(
        f.bundled || f.versioned,
        `${f.key}: no api/${f.domain}/v1/[rpc].ts and no api/${f.version}/${f.domain}/[rpc].ts — the local-api server cannot see this family at all`,
      );
      assert.ok(!(f.bundled && f.versioned), `${f.key}: bundled and versioned entries both exist`);
    }
  });

  it('every versioned family is routed to the cloud by the local-api server', () => {
    for (const f of families.filter((x) => x.versioned)) {
      assert.ok(
        sidecarCloudOnlyPrefixes.includes(f.urlPrefix),
        `${f.key}: the local-api server has no '${f.urlPrefix}' in cloudOnlyRouteFamilyPrefixes — it would reach the cloud only via the 404 fallback`,
      );
    }
  });

  it('the cloud-only prefix list has no stale entries', () => {
    for (const prefix of sidecarCloudOnlyPrefixes) {
      const match = prefix.match(/^\/api\/(v\d+)\/([^/]+)\/$/);
      assert.ok(match, `${prefix} is not an /api/v{N}/{domain}/ family prefix`);
      const key = `${match[1]}/${match[2]}`;
      assert.ok(existsSync(resolve(root, 'api', key, '[rpc].ts')), `${prefix} is declared cloud-only but api/${key}/[rpc].ts no longer exists`);
    }
  });

  it('the sidecar consults the family prefixes inside isCloudPreferred', () => {
    const fn = sidecar.slice(sidecar.indexOf('function isCloudPreferred(pathname)'));
    const body = fn.slice(0, fn.indexOf('\n}') + 2);
    assert.match(body, /cloudOnlyRouteFamilyPrefixes\.some\(p => pathname\.startsWith\(p\)\)/);
  });
});

/**
 * Plan 2026-11-04-001 (KTD6): in docker mode a premium path carrying the
 * browser's desktop-key cookie is relayed to the cloud. The relay set is its
 * own decision, not cloudFallback, and it must never cover a family the
 * desktop key is denied (REST v2 is cloud-only AND API-only).
 */
describe('self-host relay path decision', async () => {
  const { SELFHOST_RELAY_PATHS } = await import('../packages/shared/selfhost-relay-paths.js');
  const dispatchBody = sidecar.slice(sidecar.indexOf('async function dispatch('));

  it('relays no path of a cloud-only route family', () => {
    for (const p of SELFHOST_RELAY_PATHS) {
      for (const prefix of sidecarCloudOnlyPrefixes) {
        assert.ok(!p.startsWith(prefix), `${p} is relayed but belongs to cloud-only family ${prefix}`);
      }
    }
  });

  it('decides the relay ahead of local handler dispatch, gated on the operator switch', () => {
    const relayAt = dispatchBody.indexOf('isSelfHostRelayPath(requestUrl.pathname)');
    const localAt = dispatchBody.indexOf('const modulePath = pickModule(');
    assert.ok(relayAt > 0, 'dispatch consults the relay set');
    assert.ok(relayAt < localAt, 'the relay decision precedes local handlers');
    assert.match(dispatchBody.slice(0, relayAt), /context\.selfHostRelay\s*&&\s*selfHostKey !== null\s*&&\s*$/);
  });

  it('removes the desktop-key cookie before anything else in dispatch reads the request', () => {
    const firstStatement = dispatchBody.slice(dispatchBody.indexOf('{') + 1).trim();
    assert.match(firstStatement, /^\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*const selfHostKey = takeSelfHostKeyCookie\(req\);/);
  });

  it('keeps cloudFallback forced off in docker mode', () => {
    assert.match(sidecar, /const cloudFallback = mode === 'docker' \? false : requestedFallback;/);
  });
});
