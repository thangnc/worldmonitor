import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const canonical = JSON.parse(
  await readFile(resolve(REPO_ROOT, 'packages/shared/diplomacy-keywords.json'), 'utf8'),
);

function readFromRoot(relPath) {
  return readFile(resolve(REPO_ROOT, relPath), 'utf8');
}

function literalBlock(src, constName) {
  const re = new RegExp(
    `const\\s+${constName}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as\\s+const\\s*)?;`,
  );
  const m = src.match(re);
  assert.ok(m, `expected to find \`const ${constName} = [ ... ]\` in source`);
  return m[1];
}

function parseStringArrayLiteral(src, constName) {
  const block = literalBlock(src, constName);
  const items = [...block.matchAll(/'([^']+)'/g)].map((g) => g[1]);
  assert.ok(items.length > 0, `expected at least one string in ${constName}`);
  return items;
}

function parsePairArrayLiteral(src, constName) {
  const block = literalBlock(src, constName);
  const pairs = [...block.matchAll(/\['([^']+)'\s*,\s*'([^']+)'\]/g)].map((g) => [g[1], g[2]]);
  assert.ok(pairs.length > 0, `expected at least one pair in ${constName}`);
  return pairs;
}

test('canonical JSON has the expected shape', () => {
  assert.ok(Array.isArray(canonical.diplomacyKeywords));
  assert.ok(canonical.diplomacyKeywords.length >= 10);
  assert.ok(Array.isArray(canonical.flashpointKeywords));
  assert.ok(canonical.flashpointKeywords.length >= 15);
  assert.ok(Array.isArray(canonical.diplomacyFlashpointPairs));
  assert.ok(canonical.diplomacyFlashpointPairs.length >= 15);
  for (const pair of canonical.diplomacyFlashpointPairs) {
    assert.ok(Array.isArray(pair) && pair.length === 2, 'each pair must be [string, string]');
    assert.strictEqual(typeof pair[0], 'string');
    assert.strictEqual(typeof pair[1], 'string');
  }
});

test('scripts/_clustering.mjs sources keywords from canonical JSON', async () => {
  const src = await readFromRoot('scripts/_clustering.mjs');
  // Either `./shared/diplomacy-keywords.json` (scripts/shared mirror)
  // or `../packages/shared/diplomacy-keywords.json` (root) is acceptable.
  // _clustering.mjs uses the mirror because seed-insights.mjs deploys
  // via nixpacks with rootDirectory=scripts. The mirror is enforced
  // byte-identical by tests/edge-functions.test.mjs.
  assert.match(
    src,
    /require\(\s*['"](?:\.\/|\.\.\/packages\/)shared\/diplomacy-keywords\.json['"]\s*\)/,
    '_clustering.mjs must require the canonical JSON',
  );
  assert.doesNotMatch(
    src,
    /export\s+const\s+DIPLOMACY_KEYWORDS\s*=\s*\[\s*'ceasefire'/,
    '_clustering.mjs must not redefine DIPLOMACY_KEYWORDS inline',
  );
  assert.doesNotMatch(
    src,
    /export\s+const\s+ENTITY_BIGRAMS\s*=\s*\[\s*\[\s*'iran'/,
    '_clustering.mjs must not redefine ENTITY_BIGRAMS inline',
  );
});

test('packages/server/worldmonitor/news/v1/list-feed-digest.ts sources keywords from canonical JSON', async () => {
  const src = await readFromRoot('packages/server/worldmonitor/news/v1/list-feed-digest.ts');
  assert.match(
    src,
    /import\s+diplomacyKeywordsData\s+from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/shared\/diplomacy-keywords\.json['"]/,
    'list-feed-digest.ts must import the canonical JSON',
  );
  assert.doesNotMatch(
    src,
    /const\s+DIPLOMACY_KEYWORDS\s*=\s*\[\s*'ceasefire'/,
    'list-feed-digest.ts must not redefine DIPLOMACY_KEYWORDS inline',
  );
});

// Drift guards for the two intentionally-untouched mirror sites.
// ais-relay.cjs is the Railway-deployed monolith (refactoring it
// would break its bundled deploy assumptions); parallel-analysis.ts
// is a client-side ML helper with a narrower scope (flashpoint only).
// They keep their inline literals — but the literals MUST match the
// canonical JSON, so future edits in either file fail this test
// unless the JSON is updated in lockstep.

test('scripts/ais-relay.cjs RELAY_* literals match canonical JSON', async () => {
  const src = await readFromRoot('scripts/ais-relay.cjs');
  assert.deepEqual(
    parseStringArrayLiteral(src, 'RELAY_DIPLOMACY_KEYWORDS'),
    canonical.diplomacyKeywords,
    'RELAY_DIPLOMACY_KEYWORDS drifted from packages/shared/diplomacy-keywords.json',
  );
  assert.deepEqual(
    parseStringArrayLiteral(src, 'RELAY_FLASHPOINT_SCORING_KEYWORDS'),
    canonical.flashpointKeywords,
    'RELAY_FLASHPOINT_SCORING_KEYWORDS drifted from packages/shared/diplomacy-keywords.json',
  );
  assert.deepEqual(
    parsePairArrayLiteral(src, 'RELAY_DIPLOMACY_FLASHPOINT_PAIRS'),
    canonical.diplomacyFlashpointPairs,
    'RELAY_DIPLOMACY_FLASHPOINT_PAIRS drifted from packages/shared/diplomacy-keywords.json',
  );
});
