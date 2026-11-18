/**
 * Product catalog tests.
 *
 * The canonical Convex catalog, its generator and the Edge product-catalog
 * route are gone (Lite Phase 1c). packages/shared/product-catalog.generated.json stays
 * as a committed artifact that scripts/ais-relay.cjs still serves, so pin its
 * shape and the relay's wiring, and keep raw Dodo product ids out of source.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PRODUCT_ID_ALLOWED_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];
const PRODUCT_ID_EXCLUDE_PATTERNS = [
  'node_modules',
  'dist/',
  '.git',
  '.claude/worktrees/',
  'tests/',
  'e2e/',
];

function isMissingPathError(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT';
}

function collectRawProductIds(root, filesystem = {}) {
  const {
    readdir = readdirSync,
    stat = statSync,
    readFile = readFileSync,
  } = filesystem;
  const results = [];

  function walk(currentDir) {
    let entries;
    try {
      entries = readdir(currentDir);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const relPath = relative(root, fullPath).replace(/\\/g, '/');
      let fileStat;
      try {
        fileStat = stat(fullPath);
      } catch (error) {
        if (isMissingPathError(error)) continue;
        throw error;
      }
      const checkPath = fileStat.isDirectory() ? `${relPath}/` : relPath;

      if (PRODUCT_ID_EXCLUDE_PATTERNS.some((pattern) => checkPath.includes(pattern))) {
        continue;
      }

      if (fileStat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const extIdx = entry.lastIndexOf('.');
      const ext = extIdx !== -1 ? entry.substring(extIdx) : '';
      if (!PRODUCT_ID_ALLOWED_EXTENSIONS.includes(ext) || entry.includes('.test.')) continue;

      let content;
      try {
        content = readFile(fullPath, 'utf8');
      } catch (error) {
        if (isMissingPathError(error)) continue;
        throw error;
      }
      if (!content.includes('pdt_')) continue;

      content.split(/\r?\n/).forEach((line, index) => {
        if (line.includes('pdt_')) {
          results.push(`${relPath}:${index + 1}:${line}`);
        }
      });
    }
  }

  walk(root);
  return results;
}

describe('Generated product catalog', () => {
  const generatedCatalog = JSON.parse(readFileSync(join(ROOT, 'packages/shared/product-catalog.generated.json'), 'utf8'));

  it('generated tier config exposes plan limits for public plans', () => {
    const { pro, pro_business: proBusiness, api_starter: api, enterprise: ent } = generatedCatalog.tierConfig;
    assert.equal(pro?.planLimits?.mcpCallsPerDay, 50, 'Pro MCP daily limit should be visible');
    assert.equal(pro?.planLimits?.dashboardAiCallsPerDay, 500, 'Pro dashboard-AI daily limit should be visible');
    assert.equal(proBusiness?.planLimits?.mcpCallsPerDay, 250, 'Pro Business MCP daily limit should be visible');
    assert.equal(proBusiness?.planLimits?.dashboardAiCallsPerDay, 2500, 'Pro Business dashboard-AI daily limit should be visible');
    assert.equal(api?.planLimits?.apiRequestsPerDay, 1000, 'API Starter daily limit should be visible');
    assert.equal(api?.planLimits?.dashboardAiCallsPerDay, 1000, 'API Starter dashboard-AI daily limit should be visible');
    assert.equal(ent?.planLimits?.apiRequestsPerDay, 100000, 'Enterprise daily ceiling should be visible');
    assert.equal(ent?.planLimits?.dashboardAiCallsPerDay, 25000, 'Enterprise dashboard-AI ceiling should be visible');
  });

  it('the Railway relay consumes the generated tier config', () => {
    const expectedFeature = generatedCatalog.tierConfig.pro.features.find((f) => /\bMCP\b/.test(f));
    assert.equal(
      expectedFeature,
      'MCP + SDK access for Claude Desktop & other AI clients (50 calls/day)',
      'generated Pro MCP feature changed unexpectedly',
    );

    assert.deepEqual(
      generatedCatalog.publicTierGroups,
      ['free', 'pro', 'pro_business', 'api_starter', 'api_business', 'enterprise'],
    );

    const relaySrc = readFileSync(join(ROOT, 'scripts/ais-relay.cjs'), 'utf8');
    assert.match(relaySrc, /requireShared\('product-catalog\.generated\.json'\)/);
    assert.match(relaySrc, /requireShared\('inventory-facts\.generated\.json'\)/);
    assert.doesNotMatch(relaySrc, /MANUAL MIRROR/);

    const dockerfile = readFileSync(join(ROOT, 'Dockerfile.relay'), 'utf8');
    assert.match(dockerfile, /^RUN node scripts\/generate-inventory-facts\.mjs$/m);
    assert.match(
      dockerfile,
      /^COPY --from=inventory-builder \/workspace\/scripts\/shared\/inventory-facts\.generated\.json \.\/scripts\/shared\/inventory-facts\.generated\.json$/m,
    );
    const dockerignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
    assert.match(dockerignore, /^\.env\*$/m, 'Docker build context must exclude local environment files');

    const relayService = JSON.parse(
      readFileSync(join(ROOT, 'scripts/railway-services.json'), 'utf8'),
    ).find((entry) => entry.entry === 'scripts/ais-relay.cjs');
    for (const requiredWatch of [
      'scripts/generate-inventory-facts.mjs',
      'packages/shared/source-attribution-manifest.json',
    ]) {
      assert.ok(relayService.watchPatterns.includes(requiredWatch), `ais-relay must watch ${requiredWatch}`);
    }
  });

  // The license chips travel in `highlightFeatures`; the Railway relay serves
  // them from the generated JSON bundle via requireShared.
  it('license chips (highlightFeatures) stay on the four sellable paid tiers', () => {
    const bundle = generatedCatalog;
    const bundleHighlights = {};
    for (const [group, config] of Object.entries(bundle.tierConfig)) {
      if (Array.isArray(config.highlightFeatures)) bundleHighlights[group] = config.highlightFeatures;
    }
    assert.deepEqual(
      Object.keys(bundleHighlights).sort(),
      ['api_business', 'api_starter', 'pro', 'pro_business'],
      'the four sellable paid tier groups must retain their named license-chip contracts',
    );
  });
});

describe('Product ID guard', () => {
  it('ignores a file deleted after directory enumeration', () => {
    const missing = Object.assign(new Error('gone'), { code: 'ENOENT' });
    const results = collectRawProductIds(ROOT, {
      readdir: () => ['gone.mjs'],
      stat: () => { throw missing; },
    });

    assert.deepEqual(results, []);
  });

  it('does not suppress stable-source read errors', () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    assert.throws(
      () => collectRawProductIds(ROOT, {
        readdir: () => ['unreadable.mjs'],
        stat: () => ({ isDirectory: () => false }),
        readFile: () => { throw denied; },
      }),
      /permission denied/,
    );
  });

  it('ignores generated build artifacts', () => {
    const distDir = join(ROOT, 'dist');
    const builtAsset = join(distDir, 'panel.js');
    const results = collectRawProductIds(ROOT, {
      readdir: (path) => path === ROOT ? ['dist'] : ['panel.js'],
      stat: (path) => ({ isDirectory: () => path === distDir }),
      readFile: (path) => {
        assert.equal(path, builtAsset);
        return "const productId = 'pdt_built_artifact';";
      },
    });

    assert.deepEqual(results, []);
  });

  it('no raw pdt_ strings outside allowed paths', () => {
    const results = collectRawProductIds(ROOT);

    if (results.length > 0) {
      assert.fail(
        `Found pdt_ strings outside allowed paths. These should import from the catalog:\n${results.join('\n')}`,
      );
    }
  });
});
