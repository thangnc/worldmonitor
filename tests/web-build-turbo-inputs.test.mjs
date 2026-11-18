// turbo restores dist/ from cache when the hash of @wm/web#build's inputs is
// unchanged, so every repository file the build reads must match one of those
// inputs. Otherwise an edit that changes or breaks the build is hidden by a
// cache hit. The build reads three file sets outside node_modules:
// - the Vite config bundle: esbuild bundles apps/web/vite.config.ts with
//   string-literal dynamic imports, which pulls the dev API handlers and the
//   api/ and scripts/ helpers they import;
// - the tsc program of apps/web/tsconfig.json;
// - the files Tailwind scans, which is apps/web (source() in lite.css).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const inputs = JSON.parse(readFileSync(resolve(root, 'turbo.json'), 'utf8')).tasks['@wm/web#build'].inputs;

// Turbo globs, rewritten relative to the repository root. $TURBO_DEFAULT$ is
// every file of the package itself.
const globs = inputs.map((input) => input.replace('$TURBO_DEFAULT$', 'apps/web/**').replace('$TURBO_ROOT$/', ''));
const include = globs.filter((glob) => !glob.startsWith('!'));
const exclude = globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));

function hashed(file) {
  return include.some((glob) => matchesGlob(file, glob)) && !exclude.some((glob) => matchesGlob(file, glob));
}

function notHashed(files) {
  return files.filter((file) => !file.split('/').includes('node_modules') && !hashed(file));
}

async function configBundleInputs() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['apps/web/vite.config.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  return Object.keys(result.metafile.inputs);
}

// The same tsc binary the build script runs (TypeScript 7, @typescript/native).
function tscProgramFiles() {
  const output = execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', 'apps/web/tsconfig.json', '--listFilesOnly'], {
    cwd: root,
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean).map((file) => relative(root, file));
}

describe('@wm/web#build turbo inputs', () => {
  it('match the files they name and nothing outside them (positive control)', () => {
    assert.ok(hashed('apps/web/src/lite/App.tsx'));
    assert.ok(hashed('packages/server/router.ts'));
    assert.ok(hashed('scripts/shared/un-to-iso2.json'));
    assert.ok(hashed('.env.local'));
    assert.ok(!hashed('tests/lite-ui.test.mts'));
    assert.ok(!hashed('scripts/seed-insights.mjs'));
    assert.ok(!hashed('docs/engineering/README.md'));
    assert.deepEqual(notHashed(['node_modules/vite/index.js', 'tests/x.mjs']), ['tests/x.mjs']);
  });

  it('cover every file the Vite config bundle reads', async () => {
    const files = await configBundleInputs();
    assert.ok(files.length > 100, `expected the dev API handler graph, got ${files.length} files`);
    assert.ok(files.some((file) => file.startsWith('scripts/shared/')), 'expected scripts/shared helpers in the config bundle');
    assert.deepEqual(notHashed(files), [], 'add these paths to the @wm/web#build inputs in turbo.json');
  });

  it('cover every file of the apps/web tsc program', () => {
    const files = tscProgramFiles();
    assert.ok(files.some((file) => file.startsWith('apps/web/src/lite/')), 'expected the Lite sources in the tsc program');
    assert.deepEqual(notHashed(files), [], 'add these paths to the @wm/web#build inputs in turbo.json');
  });

  it('cover the files Tailwind scans', () => {
    const css = readFileSync(resolve(root, 'apps/web/src/lite/lite.css'), 'utf8');
    const source = css.match(/@import "tailwindcss" source\("([^"]+)"\)/)?.[1];
    assert.ok(source, 'lite.css must set an explicit Tailwind source()');
    const scanned = relative(root, resolve(root, 'apps/web/src/lite', source)) || '.';
    assert.equal(scanned, 'apps/web', 'Tailwind must scan apps/web only; a wider source needs wider turbo inputs');
    assert.doesNotMatch(css, /@source\s/, 'an @source directive adds scanned files that turbo does not hash');
  });
});
