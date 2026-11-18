// These source checks pin CI build/test ordering and built-output guard wiring
// (#8690, section 2).
// The spawned probes exercise guard behavior, but cannot verify workflow ordering.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const workflowPath = resolve(repoRoot, '.github/workflows/ci.yml');
const guardModuleUrl = pathToFileURL(resolve(repoRoot, 'tests/_lib/built-output-guard.mjs')).href;

const guardProbeSource = [
  "import { describe, it } from 'node:test';",
  "import { writeFileSync } from 'node:fs';",
  `import { guardBuiltOutput, shouldSkipBuiltOutput } from ${JSON.stringify(guardModuleUrl)};`,
  "const dashboardHtml = process.env.WM_DASHBOARD_GUARD_DASHBOARD;",
  "const expectBuiltOutput = process.env.WM_EXPECT_BUILT_OUTPUT === '1';",
  "writeFileSync(process.env.WM_DASHBOARD_GUARD_LOADED, 'loaded');",
  "describe('built-output guard probe', { skip: shouldSkipBuiltOutput(dashboardHtml, expectBuiltOutput) }, () => {",
  "  writeFileSync(process.env.WM_DASHBOARD_GUARD_SUITE, 'entered');",
  "  guardBuiltOutput(dashboardHtml, expectBuiltOutput);",
  "  it('executes the built-output assertion', () => {",
  "    writeFileSync(process.env.WM_DASHBOARD_GUARD_ASSERTION, 'ran');",
  "  });",
  "});",
].join('\n');

function runGuardProbe(expectBuiltOutput) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'worldmonitor-built-output-guard-'));
  const probePath = join(fixtureRoot, 'guard-probe.test.mjs');
  const dashboardHtml = join(fixtureRoot, 'dist', 'dashboard.html');
  const loadedMarker = join(fixtureRoot, 'loaded');
  const suiteMarker = join(fixtureRoot, 'suite');
  const assertionMarker = join(fixtureRoot, 'assertion');

  try {
    writeFileSync(probePath, guardProbeSource);
    const env = {
      ...process.env,
      WM_DASHBOARD_GUARD_DASHBOARD: dashboardHtml,
      WM_DASHBOARD_GUARD_LOADED: loadedMarker,
      WM_DASHBOARD_GUARD_SUITE: suiteMarker,
      WM_DASHBOARD_GUARD_ASSERTION: assertionMarker,
    };
    delete env.NODE_OPTIONS;
    delete env.NODE_TEST_CONTEXT;
    if (expectBuiltOutput) env.WM_EXPECT_BUILT_OUTPUT = '1';
    else delete env.WM_EXPECT_BUILT_OUTPUT;

    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', probePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
    });

    return {
      ...result,
      output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      loaded: existsSync(loadedMarker),
      suite: existsSync(suiteMarker),
      assertion: existsSync(assertionMarker),
    };
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

describe('built-output guard contract', () => {
  it('keeps the Lite build immediately before the marker-enabled built-output test in CI', () => {
    const workflow = readFileSync(workflowPath, 'utf8').replaceAll('\r\n', '\n');
    // The built-output suites must run against the dist the step above just
    // built (or restored from the turbo cache, outputs dist/**), with nothing
    // between them that could leave dist/ stale or absent.
    const expectedSequence = [
      '      - run: npx turbo run build',
      '      - run: WM_EXPECT_BUILT_OUTPUT=1 npm run test:data -- --built-output=only --concurrency=4',
    ].join('\n');

    assert.ok(
      workflow.includes(expectedSequence),
      'the build job must run npx turbo run build, then the built-output test:data run with WM_EXPECT_BUILT_OUTPUT=1 immediately after',
    );
    assert.equal(
      workflow.match(/WM_EXPECT_BUILT_OUTPUT=1 npm run test:data/g)?.length ?? 0,
      1,
      'the CI built-output command should remain a single, explicit build-job contract',
    );
  });

  it('skips the built-output suite when the marker is absent and output is missing', () => {
    const result = runGuardProbe(false);

    assert.equal(result.status, 0, result.output);
    assert.equal(result.loaded, true, 'the probe module should load');
    assert.equal(result.suite, false, 'node:test should skip the built-output suite');
    assert.equal(result.assertion, false, 'the built-output assertion must not run');
  });

  it('fails the built-output suite when CI expects output but it is missing', () => {
    const result = runGuardProbe(true);

    // CI uses Node 24: a guard failure must fail the process as well as the
    // suite. The probe selects TAP explicitly because Node 24 defaults to spec.
    assert.notEqual(result.status, 0, result.output);
    assert.match(
      result.output,
      /^not ok 1 - built-output guard probe$/m,
      `the probe suite must be reported as failed:\n${result.output}`,
    );
    assert.match(
      result.output,
      /missing but WM_EXPECT_BUILT_OUTPUT=1 indicates CI expected a build/,
      `the failure must come from the guard, not an unrelated crash:\n${result.output}`,
    );
    assert.notEqual(result.status, null, 'the probe process must not have been killed by a signal');
    assert.equal(result.loaded, true, 'the probe module should load');
    assert.equal(result.suite, true, 'the suite callback should run when CI expects built output');
    assert.equal(result.assertion, false, 'the assertion must not run after the guard fails');
  });
});
