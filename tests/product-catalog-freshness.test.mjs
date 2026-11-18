/**
 * Product catalog freshness tests.
 *
 * Verifies that the generated catalog files (the shared catalog JSON and the
 * Edge module emitted from it) match the canonical catalog in
 * convex/config/productCatalog.ts.
 * Bidirectional: checks generated→catalog AND catalog→generated.
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
  'convex/_generated/',
  'convex/config/productCatalog',
  'api/product-catalog',
  'api/_product-catalog.generated',
  'api/_product-fallback-prices',
  'src/config/products.generated',
  'src/config/product-ids.generated',
  'tests/',
  'convex/__tests__/',
  'e2e/',
  // Zero-import leaf: statically imported by the eager dashboard code, so it
  // cannot import the catalog without breaking the eager-chunk budget. It
  // mirrors the Pro-family ids as literals; its drift-guard test asserts them
  // against the generated catalog, giving the same catalog-sync this guard wants.
  'src/services/pro-activation-state',
  'scripts/generate-product-config',
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

describe('Product catalog freshness', () => {
  const generatedCatalog = JSON.parse(readFileSync(join(ROOT, 'shared/product-catalog.generated.json'), 'utf8'));

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

  it('every publicVisible catalog tier group appears in the generated public tier groups', () => {
    const catalogSrc = readFileSync(join(ROOT, 'convex/config/productCatalog.ts'), 'utf8');
    const blocks = catalogSrc.split(/\n\s*\w+:\s*\{/).slice(1);
    const visibleGroups = new Set();
    for (const block of blocks) {
      if (block.includes('publicVisible: true')) {
        const groupMatch = block.match(/tierGroup:\s*["']([^"']+)["']/);
        if (groupMatch) visibleGroups.add(groupMatch[1]);
      }
    }
    assert.ok(visibleGroups.size > 0, 'expected to read publicVisible tier groups from the catalog');
    for (const group of visibleGroups) {
      assert.ok(
        generatedCatalog.publicTierGroups.includes(group) && generatedCatalog.tierConfig[group],
        `Catalog tier group "${group}" is publicVisible but missing from shared/product-catalog.generated.json`,
      );
    }
  });

  it('Edge and Railway catalogs consume the generated canonical tier config', () => {
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

    const edgeSrc = readFileSync(join(ROOT, 'api/product-catalog.js'), 'utf8');
    const relaySrc = readFileSync(join(ROOT, 'scripts/ais-relay.cjs'), 'utf8');
    assert.match(edgeSrc, /from '\.\/_product-catalog\.generated\.js'/);
    assert.match(edgeSrc, /from '\.\/_inventory-facts\.generated\.js'/);
    assert.match(relaySrc, /requireShared\('product-catalog\.generated\.json'\)/);
    assert.match(relaySrc, /requireShared\('inventory-facts\.generated\.json'\)/);
    assert.doesNotMatch(edgeSrc, /MANUAL MIRROR/);
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
      'shared/source-attribution-manifest.json',
      'public/.well-known/mcp/server-card.json',
    ]) {
      assert.ok(relayService.watchPatterns.includes(requiredWatch), `ais-relay must watch ${requiredWatch}`);
    }
  });

  // The license chips travel in `highlightFeatures`. The generated JSON bundle
  // is what BOTH consumers (Railway seeder via requireShared, edge endpoint via
  // _product-catalog.generated.js) serve from, so pin each chip into both.
  it('license chips (highlightFeatures) match across the generated bundle and edge module', () => {
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

    // The edge module is a second emitted artifact of the same generator run;
    // a partial regen could leave it stale, so pin each chip string into it.
    const edgeGenerated = readFileSync(join(ROOT, 'api/_product-catalog.generated.js'), 'utf8');

    for (const [group, highlights] of Object.entries(bundleHighlights)) {
      for (const chip of highlights) {
        assert.ok(edgeGenerated.includes(JSON.stringify(chip).slice(1, -1)),
          'api/_product-catalog.generated.js is missing chip "' + chip + '" for ' + group + ' — partial regen?');
      }
    }
  });

  it('every currentForCheckout catalog entry appears in generated products', () => {
    // Reverse check: catalog → generated. Catches generator silently dropping entries.
    const freshCatalog = JSON.parse(readFileSync(join(ROOT, 'shared/product-catalog.generated.json'), 'utf8'));
    const allGeneratedIds = Object.keys(freshCatalog.products);

    // Read catalog entries that should be in generated (currentForCheckout with a dodoProductId)
    // Parse from the catalog source file since we can't import TS
    const catalogSrc = readFileSync(join(ROOT, 'convex/config/productCatalog.ts'), 'utf8');
    const checkoutBlocks = catalogSrc.split(/\n\s*\w+:\s*\{/).slice(1);
    for (const block of checkoutBlocks) {
      const hasCheckout = block.includes('currentForCheckout: true');
      const idMatch = block.match(/dodoProductId:\s*["']([^"']+)["']/);
      if (hasCheckout && idMatch) {
        assert.ok(
          allGeneratedIds.includes(idMatch[1]),
          `Catalog entry with dodoProductId ${idMatch[1]} has currentForCheckout=true but is missing from shared/product-catalog.generated.json`,
        );
      }
    }
  });

  it('generated fallback prices have entries for all self-serve products', () => {
    const fallbackIds = Object.keys(generatedCatalog.fallbackPrices);

    // Every self-serve product with a price should have a fallback
    const catalogSrc = readFileSync(join(ROOT, 'convex/config/productCatalog.ts'), 'utf8');
    const blocks = catalogSrc.split(/\n\s*\w+:\s*\{/).slice(1);
    for (const block of blocks) {
      const isSelfServe = block.includes('selfServe: true');
      const idMatch = block.match(/dodoProductId:\s*["']([^"']+)["']/);
      const priceMatch = block.match(/priceCents:\s*(\d+)/);
      if (isSelfServe && idMatch && priceMatch && Number(priceMatch[1]) > 0) {
        assert.ok(
          fallbackIds.includes(idMatch[1]),
          `Self-serve product ${idMatch[1]} missing from generated fallback prices`,
        );
      }
    }
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
