import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { it } from 'node:test';

const require = createRequire(import.meta.url);
const jayson = require('jayson');
const StreamValues = require('stream-json/streamers/StreamValues');
const katex = require('katex');
const { load } = require('js-yaml');
const semver = require('semver');

const inputs = [
  '{"__proto__":{"isAdmin":true},"name":"bob"}',
  '{"__proto__":null,"name":"bob"}',
  '{"user":{"__proto__":{"isAdmin":true},"name":"alice"}}',
  '{"__proto__":["admin"],"name":"bob"}',
  '{"__proto__":"value","name":"bob"}',
];

for (const input of inputs) {
  it(`jayson preserves JSON.parse semantics for ${input}`, async () => {
    const value = await new Promise((resolve, reject) => {
      jayson.Utils.parseStream(Readable.from([...input]), {}, (error, value) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
    assert.deepEqual(value, JSON.parse(input));
    const object = value.user ?? value;
    assert.equal(Object.getPrototypeOf(object), Object.prototype);
    assert.equal(Object.hasOwn(object, '__proto__'), true);
    assert.equal(object.isAdmin, undefined);
  });

  it(`stream-json preserves own keys with a reviver for ${input}`, async () => {
    const values = [];
    await pipeline(
      Readable.from([input]),
      StreamValues.withParser({ reviver: (_key, value) => value }),
      async (source) => { for await (const item of source) values.push(item.value); },
    );
    assert.deepEqual(values, [JSON.parse(input)]);
  });
}

it('stream-json respects reviver deletion and parses consecutive values', async () => {
  const values = [];
  await pipeline(
    Readable.from(['{"__proto__":null,"keep":1} {"keep":2}']),
    StreamValues.withParser({ reviver: (key, value) => key === '__proto__' ? undefined : value }),
    async (source) => { for await (const item of source) values.push(item.value); },
  );
  assert.deepEqual(values, [{ keep: 1 }, { keep: 2 }]);
});

it('KaTeX ignores inherited trust while preserving explicit trusted rendering', () => {
  const expression = '\\href{javascript:alert(1)}{click}';
  assert.equal(katex.renderToString(expression, Object.create({ trust: true })).includes('href="javascript:alert(1)"'), false);
  assert.equal(katex.renderToString(expression, { trust: true }).includes('href="javascript:alert(1)"'), true);
  assert.match(katex.renderToString('x^2 + 1'), /katex/);
});

it('Umami selects only Hono versions with the JSX escaping fix', () => {
  const lock = load(readFileSync(new URL('../docker/umami/runtime/pnpm-lock.yaml', import.meta.url), 'utf8'));
  const versions = Object.keys(lock.packages).filter((key) => key.startsWith('hono@')).map((key) => key.slice(5));
  // @prisma/dev 0.24.17 (November 2026 triage) dropped Hono, so the runtime may
  // carry none. The `hono` override stays so any future copy is still patched.
  for (const version of versions) assert.ok(semver.gte(version, '4.13.7'), `hono@${version}`);
});

function npmLockVersions(path, name) {
  const lock = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return Object.entries(lock.packages)
    .filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`))
    .map(([, entry]) => entry.version);
}

function pnpmLockVersions(path, name) {
  const lock = load(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return Object.keys(lock.packages).filter((key) => key.startsWith(`${name}@`)).map((key) => key.slice(name.length + 1));
}

const patchedLocks = [
  ['sharp', '0.35.5', npmLockVersions, '../package-lock.json'],
  ['sharp', '0.35.5', npmLockVersions, '../blog-site/package-lock.json'],
  ['sharp', '0.35.5', npmLockVersions, '../workers/railway-reconcile-control/package-lock.json'],
  ['shell-quote', '1.11.0', npmLockVersions, '../package-lock.json'],
  ['shell-quote', '1.11.0', npmLockVersions, '../pro-test/package-lock.json'],
  ['shell-quote', '1.11.0', pnpmLockVersions, '../docker/umami/runtime/pnpm-lock.yaml'],
  ['markdown-it', '14.3.3', npmLockVersions, '../package-lock.json'],
  ['@vitest/mocker', '4.1.12', npmLockVersions, '../package-lock.json'],
  ['@vitest/mocker', '4.1.12', npmLockVersions, '../consumer-prices-core/package-lock.json'],
  ['simple-git', '4.0.1', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['@simple-git/argv-parser', '2.0.1', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['adm-zip', '0.6.1', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['tar', '7.5.18', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['tmp', '0.2.6', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['sigstore', '4.1.1', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['@sigstore/core', '3.2.1', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['yeoman-environment', '6.0.1', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['serialize-javascript', '7.0.5', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['postcss-selector-parser', '7.1.6', npmLockVersions, '../integrations/zapier/package-lock.json'],
  ['fast-uri', '3.1.9', npmLockVersions, '../package-lock.json'],
  ['fast-uri', '3.1.9', pnpmLockVersions, '../docker/umami/runtime/pnpm-lock.yaml'],
  ['undici', '7.30.1', npmLockVersions, '../workers/api-cors-preflight/package-lock.json'],
  ['undici', '7.30.1', npmLockVersions, '../workers/railway-reconcile-control/package-lock.json'],
];

for (const [name, patched, versionsOf, path] of patchedLocks) {
  it(`${path.slice(3)} selects only ${name} >= ${patched}`, () => {
    const versions = versionsOf(path, name);
    assert.ok(versions.length > 0);
    for (const version of versions) assert.ok(semver.gte(version, patched), `${name}@${version}`);
  });
}

// November 2026 triage (docs/solutions/security-issues/dependabot-triage-2026-11-07.md).
// These packages keep older majors that were never in the advisory range
// (glob 7, minimatch 3 and 5), so the check is "no version inside the
// vulnerable range" rather than "every version >= patched".
const vulnerableRanges = [
  ['glob', '>=9.0.0 <=14.0.1', 'GHSA-3g3m-2fjr-6pw4', ['../package-lock.json', '../pro-test/package-lock.json', '../integrations/zapier/package-lock.json']],
  ['minimatch', '>=7.0.0 <11.0.1', 'GHSA-g3hv-75wg-m249', ['../package-lock.json', '../pro-test/package-lock.json', '../integrations/zapier/package-lock.json']],
  ['uuid', '<11.1.1 || >=12.0.0 <12.0.1 || >=13.0.0 <13.0.1', 'GHSA-w5hq-g745-h8pq', ['../package-lock.json', '../scripts/package-lock.json', '../pro-test/package-lock.json']],
];

for (const [name, range, advisory, paths] of vulnerableRanges) {
  for (const path of paths) {
    it(`${path.slice(3)} has no ${name} in ${advisory} range ${range}`, () => {
      const versions = npmLockVersions(path, name);
      assert.ok(versions.length > 0);
      for (const version of versions) assert.ok(!semver.satisfies(version, range), `${name}@${version}`);
    });
  }
}

const umamiLock = '../docker/umami/runtime/pnpm-lock.yaml';

it('docker/umami/runtime/pnpm-lock.yaml selects no hono below 4.13.11', () => {
  // Absence is the expected state since @prisma/dev 0.24.17 dropped Hono.
  for (const version of pnpmLockVersions(umamiLock, 'hono')) assert.ok(semver.gte(version, '4.13.11'), `hono@${version}`);
});
for (const [name, patched] of [['mysql2', '3.24.4'], ['deepmerge-ts', '8.0.2'], ['valibot', '1.4.2']]) {
  it(`docker/umami/runtime/pnpm-lock.yaml selects only ${name} >= ${patched}`, () => {
    const versions = pnpmLockVersions(umamiLock, name);
    assert.ok(versions.length > 0);
    for (const version of versions) assert.ok(semver.gte(version, patched), `${name}@${version}`);
  });
}

it('docker/umami/runtime/pnpm-lock.yaml no longer carries @hono/node-server (GHSA-rmxm-3fg6-px4f)', () => {
  // @prisma/dev 0.24.17 dropped the local HTTP server dependency entirely.
  assert.deepEqual(pnpmLockVersions(umamiLock, '@hono/node-server'), []);
});

it('sdk/rust/Cargo.lock selects rustls-webpki >= 0.103.16 (RUSTSEC-2026-0382)', () => {
  const lock = readFileSync(new URL('../sdk/rust/Cargo.lock', import.meta.url), 'utf8');
  const versions = [...lock.matchAll(/name = "rustls-webpki"\nversion = "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(versions.length > 0);
  for (const version of versions) assert.ok(semver.gte(version, '0.103.16'), `rustls-webpki@${version}`);
});

it('shell-quote rejects a line terminator after a comment token', () => {
  const { quote } = require('shell-quote');
  assert.throws(() => quote(['echo', 'ok', { comment: 'x' }, 'a\nid;#']), TypeError);
  assert.equal(quote(['echo', 'a b']), "echo 'a b'");
});
