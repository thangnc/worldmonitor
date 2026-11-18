import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listTrackedApiSourceFiles } from '../scripts/check-edge-function-bundles.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const apiDir = join(root, 'api');
const sharedDir = join(root, 'packages', 'shared');
const scriptsSharedDir = join(root, 'scripts', 'shared');

const trackedApiSources = listTrackedApiSourceFiles(root);

// Both api-wide guards below register one `it()` PER DISCOVERED FILE, so an
// empty discovery makes them emit zero assertions and this suite reports green
// while checking nothing — a `node:` import smuggled into an edge function
// would ship unnoticed. `git ls-files` exits 0 with empty output whenever the
// pathspec matches nothing, so that is reachable; the previous readdirSync
// implementation threw instead. Fail closed, mirroring the checker's own
// zero-entry guard.
describe('tracked api/ discovery', () => {
  it('finds at least one tracked api/ source', () => {
    assert.ok(
      trackedApiSources.length > 0,
      'listTrackedApiSourceFiles returned nothing — the guards below would pass vacuously',
    );
  });
});

// Legacy JS entrypoints at api/ and api/oauth/ have stricter isolation rules.
const allEdgeFunctions = trackedApiSources
  .filter((file) => file.endsWith('.js'))
  .filter((file) => dirname(file) === 'api')
  .map((file) => ({ name: file.slice('api/'.length), path: join(root, file) }));

// All tracked .js and .ts files under api/ are used for node: built-in checks.
// Note: .ts edge functions are intentionally excluded from the
// module-isolation describe below because Vercel bundles them at build time, so
// imports from '../packages/server/' are valid. The node: built-in check still applies
// regardless of depth, since Vercel Edge Runtime rejects node: imports at runtime.
const allApiFiles = trackedApiSources.map((file) => ({
  name: file.slice('api/'.length),
  path: join(root, file),
}));

describe('scripts/shared/ stays in sync with packages/shared/', () => {
  // Historical scope: .json (data) + .cjs (helpers).
  // Explicit additions (must be mirrored): edge-safe modules the cron consumes
  // (e.g. brief-llm-core.js + its .d.ts). Other .js files in shared/ are
  // client-only and intentionally NOT mirrored — grow this list only when a
  // new file is imported from `scripts/`.
  const explicitMirroredFiles = new Set([
    'brief-llm-core.js',
    'brief-llm-core.d.ts',
    'correlation-runtime-mode.js',
    'physical-divergence-contract.js',
    'physical-divergence-contract.d.ts',
    'physical-divergence-staleness.js',
    'physical-divergence-staleness.d.ts',
    // #6428: publisher-family resolution for corroboration counting, consumed
    // by scripts/_clustering.mjs (Railway rootDirectory=scripts) and by the
    // edge digest. Must stay byte-identical.
    'publisher-families.js',
    'publisher-families.d.ts',
    // U6/U7: pure URL classifier consumed by the brief filter (edge) AND
    // by the audit script under scripts/. Must stay byte-identical.
    'url-classifier.js',
    // Railway seed-wb-indicators.mjs writes the same v2 keys the Edge RPC reads.
    'world-bank-rpc-cache.js',
    // #8867: market-alert detectors and their import graph, consumed by
    // scripts/seed-market-alert-ledger.mjs (Railway nixpacks-root-scripts).
    'text-analysis-core.js',
    'entity-registry.js',
    'entity-extraction-core.js',
    'market-alert-core.js',
    'news-clustering-core.js',
  ]);
  // The attribution manifest is canonical at packages/shared/ and is consumed by
  // repository-rooted build tooling. It is not a scripts-runtime input, so a
  // second committed copy would recreate the shared-file merge hotspot.
  // package.json is the @wm/shared workspace manifest; scripts/shared/ keeps its
  // own one-line module-type marker instead.
  const canonicalOnlyFiles = new Set(['source-attribution-manifest.json', 'package.json']);
  const sharedFiles = readdirSync(sharedDir).filter(
    (f) => !canonicalOnlyFiles.has(f)
      && (f.endsWith('.json') || f.endsWith('.cjs') || explicitMirroredFiles.has(f)),
  );
  for (const file of sharedFiles) {
    it(`scripts/shared/${file} matches packages/shared/${file}`, () => {
      const srcPath = join(scriptsSharedDir, file);
      assert.ok(existsSync(srcPath), `scripts/shared/${file} is missing — run: cp packages/shared/${file} scripts/shared/`);
      const original = readFileSync(join(sharedDir, file), 'utf8');
      const copy = readFileSync(srcPath, 'utf8');
      assert.strictEqual(copy, original, `scripts/shared/${file} is out of sync with packages/shared/${file} — run: cp packages/shared/${file} scripts/shared/`);
    });
  }
});

describe('Edge Function shared helpers resolve', () => {
  it('_rss-allowed-domains.js re-exports shared domain list', async () => {
    const mod = await import(pathToFileURL(join(apiDir, '_rss-allowed-domains.js')).href);
    const domains = mod.default;
    assert.ok(Array.isArray(domains), 'Expected default export to be an array');
    // Content parity, not just a smoke check. api/_rss-allowed-domains.js is a
    // hand-maintained literal mirror of the shared JSON (Vercel edge esbuild
    // cannot import JSON via import attributes, and api/*.js cannot import from
    // ../shared), so this assertion is the only thing stopping it drifting from
    // the source of truth. A domain added to shared/ but missed here 403s in the
    // edge proxy while every other consumer works — the same silent-drift class
    // the scripts/shared/ check above already guards against.
    const shared = JSON.parse(readFileSync(join(sharedDir, 'rss-allowed-domains.json'), 'utf8'));
    assert.deepStrictEqual(
      domains,
      shared,
      'api/_rss-allowed-domains.js is out of sync with packages/shared/rss-allowed-domains.json — ' +
        'update the literal array in api/_rss-allowed-domains.js to match',
    );
  });
});

describe('Edge Function no node: built-ins', () => {
  for (const { name, path } of allApiFiles) {
    it(`${name} does not import node: built-ins (unsupported in Vercel Edge Runtime)`, () => {
      const src = readFileSync(path, 'utf-8');
      const match = src.match(/from\s+['"]node:(\w+)['"]/);
      assert.ok(
        !match,
        `${name}: imports node:${match?.[1]} — Vercel Edge Runtime does not support node: built-in modules. Use an edge-compatible alternative.`,
      );
    });
  }
});

// Vercel's Node runtime compiles each file on its own and loads the result as
// native ESM ("type": "module"), so a relative import must name the file it
// resolves to. An extensionless `../packages/server/_shared/x` bundles fine on Edge and
// runs fine under tsx, then fails at module load in production with
// ERR_MODULE_NOT_FOUND on every request. That is what reverted #7578 (GHSA-887j).
// Walk each Node-runtime route's whole local import graph and require it.
describe('Node-runtime routes load as native ESM', () => {
  const nodeRuntimeRoutes = trackedApiSources
    .filter((file) => dirname(file) === 'api')
    .filter((file) => !/export\s+const\s+config\s*=\s*\{[^}]*\bruntime\s*:\s*['"]edge['"]/.test(readFileSync(join(root, file), 'utf-8')));

  it('scans the route files, and knows which ones run on Node', () => {
    // api/story.js was the last Node-runtime route; it left with the public
    // story pages in refactor 1c-3. A new one is walked by the loop below and
    // must be listed here, so the guard cannot quietly scan nothing.
    assert.ok(trackedApiSources.some((file) => dirname(file) === 'api'), 'the route scan found no api/ entries');
    assert.deepEqual(nodeRuntimeRoutes, []);
  });

  for (const route of nodeRuntimeRoutes) {
    it(`${route} names the file of every relative import in its graph`, async () => {
      const { build } = await import('esbuild');
      const { metafile } = await build({
        entryPoints: [join(root, route)],
        absWorkingDir: root,
        bundle: true,
        write: false,
        metafile: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        logLevel: 'silent',
      });
      const unresolvable = [];
      for (const [file, input] of Object.entries(metafile.inputs)) {
        for (const { original, external } of input.imports) {
          if (!external && original?.startsWith('.') && !/\.(?:m?js|cjs)$/.test(original)) {
            unresolvable.push(`${file}: '${original}'`);
          }
        }
      }
      assert.deepEqual(unresolvable, [], 'give each relative import its .js file name; a .ts source is imported as .js');
    });
  }
});

// CLAUDE.md: legacy JS entries share code only through `_*.js` helpers or
// packages. Importing another route entry couples two deployables and bundles
// the whole sibling handler (#8305 briefly had authorize.js import register.js).
describe('Legacy JS entries import only _-prefixed relative modules', () => {
  for (const { name, path } of allEdgeFunctions) {
    it(`${name} imports no sibling route entry`, () => {
      const src = readFileSync(path, 'utf-8');
      const specs = [...src.matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
      const routes = specs.filter((spec) => !spec.split('/').pop().startsWith('_'));
      assert.deepEqual(routes, [], `${name}: move shared code into a _-prefixed helper`);
    });
  }
});

// The legacy api/*.js allowlist that previously lived here was replaced by
// api/api-route-exceptions.json + scripts/enforce-sebuf-api-contract.mjs (see
// docs/engineering/architecture/adding-endpoints.md). The new check covers nested paths and .ts files,
// which this block missed.

describe('Edge Function module isolation', () => {
  for (const { name, path } of allEdgeFunctions) {
    it(`${name} does not import from ../packages/ (Edge Functions cannot resolve cross-directory TS)`, () => {
      const src = readFileSync(path, 'utf-8');
      assert.ok(
        !src.includes("from '../packages/"),
        `${name}: imports from ../packages/ (packages/server, packages/shared, packages/contracts) — Vercel Edge Functions cannot resolve cross-directory TS imports. Inline the code or move to a same-directory .js helper.`,
      );
    });

    it(`${name} does not import from ../src/ (Edge Functions cannot resolve TS aliases)`, () => {
      const src = readFileSync(path, 'utf-8');
      assert.ok(
        !src.includes("from '../src/"),
        `${name}: imports from ../src/ — Vercel Edge Functions cannot resolve @/ aliases or cross-directory TS. Inline the code instead.`,
      );
    });
  }
});

// Scenario endpoints (run / status / templates) were migrated from literal-filename
// edge functions to ScenarioService RPCs in PR #3207 commit 7. See
// tests/scenario-handler.test.mjs for the handler-level coverage that preserves
// the security invariants (405/POST guard via sebuf service-config, scenarioId +
// iso2 validation, JOB_ID_RE path-traversal guard, per-IP 10/min rate limit via
// gateway, queue-depth backpressure, AbortSignal.timeout on Redis pipelines).
