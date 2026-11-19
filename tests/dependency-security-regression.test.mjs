import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { it } from 'node:test';

const require = createRequire(import.meta.url);
const StreamValues = require('stream-json/streamers/StreamValues');
const katex = require('katex');
const semver = require('semver');

const inputs = [
  '{"__proto__":{"isAdmin":true},"name":"bob"}',
  '{"__proto__":null,"name":"bob"}',
  '{"user":{"__proto__":{"isAdmin":true},"name":"alice"}}',
  '{"__proto__":["admin"],"name":"bob"}',
  '{"__proto__":"value","name":"bob"}',
];

for (const input of inputs) {
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

function npmLockVersions(path, name) {
  const lock = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return Object.entries(lock.packages)
    .filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`))
    .map(([, entry]) => entry.version);
}

const patchedLocks = [
  ['sharp', '0.35.5', npmLockVersions, '../workers/railway-reconcile-control/package-lock.json'],
  ['markdown-it', '14.3.3', npmLockVersions, '../package-lock.json'],
  ['@vitest/mocker', '4.1.12', npmLockVersions, '../package-lock.json'],
  ['fast-uri', '3.1.9', npmLockVersions, '../package-lock.json'],
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

// November 2026 triage (docs/engineering/solutions/security-issues/dependabot-triage-2026-11-07.md).
// These packages keep older majors that were never in the advisory range
// (glob 7, minimatch 3 and 5), so the check is "no version inside the
// vulnerable range" rather than "every version >= patched".
const vulnerableRanges = [
  ['glob', '>=9.0.0 <=14.0.1', 'GHSA-3g3m-2fjr-6pw4', ['../package-lock.json']],
  ['minimatch', '>=7.0.0 <11.0.1', 'GHSA-g3hv-75wg-m249', ['../package-lock.json']],
  ['uuid', '<11.1.1 || >=12.0.0 <12.0.1 || >=13.0.0 <13.0.1', 'GHSA-w5hq-g745-h8pq', ['../package-lock.json', '../scripts/package-lock.json']],
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
