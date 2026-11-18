import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import YAML from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = resolve(root, '.github/workflows');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const packageScripts = packageJson.scripts ?? {};
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const securityAuditWorkflow = read(resolve(workflowsDir, 'security-audit.yml'));
const securityAuditScript = read(resolve(root, '.github/scripts/audit-production-dependencies.mjs'));
const ciWorkflow = read(resolve(workflowsDir, 'ci.yml'));
const protoCheckWorkflow = read(resolve(workflowsDir, 'proto-check.yml'));

describe('root dependency cache (#8710)', () => {
  const actionPath = resolve(root, '.github/actions/install-root-deps/action.yml');
  const readAction = () => {
    assert.ok(existsSync(actionPath), 'root installs must share the dependency cache action');
    return YAML.parse(read(actionPath));
  };

  it('uses an exact install-input, platform and Node key without partial restores', () => {
    const action = readAction();
    assert.equal(action.runs.using, 'composite');
    const cache = action.runs.steps.find((step) => step.id === 'node-modules');
    assert.match(cache.uses, /^actions\/cache\/restore@[a-f0-9]{40}$/);
    assert.equal(cache.with.path, 'node_modules');
    assert.equal(cache.with.key, "node-modules-v3-${{ runner.os }}-${{ runner.arch }}-node24-${{ hashFiles('package-lock.json', '.npmrc', 'vendor/braces/**', 'vendor/stream-json/**', 'vendor/vercel-og/**') }}-${{ steps.install-inputs.outputs.hash }}");
    assert.equal(cache.with['restore-keys'], undefined);
  });

  // The key hashes only the package.json fields an install reads. Hashing the
  // whole file made every scripts-only edit a miss in every job: run
  // 41229529882 reinstalled in 16 jobs for one changed test:e2e command. The
  // dependency fields stay in the key so a hit cannot mask a manifest that is
  // out of sync with the lockfile (#8716): that edit still misses, and npm ci
  // then fails on the mismatch.
  describe('install-input hash', () => {
    const hashStep = () => {
      const steps = readAction().runs.steps;
      const step = steps.find((s) => s.id === 'install-inputs');
      assert.ok(step, 'the action must hash the install inputs of package.json');
      assert.equal(step.shell, 'bash');
      assert.ok(steps.indexOf(step) < steps.findIndex((s) => s.id === 'node-modules'), 'the hash must exist before the restore reads it');
      return step;
    };
    const hashOf = (manifest: Record<string, unknown>) => {
      const dir = mkdtempSync(resolve(tmpdir(), 'wm-install-inputs-'));
      try {
        const output = resolve(dir, 'github-output');
        writeFileSync(resolve(dir, 'package.json'), JSON.stringify(manifest, null, 2));
        writeFileSync(output, '');
        execFileSync('bash', ['-c', hashStep().run], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: output } });
        const match = /^hash=([a-f0-9]{64})$/m.exec(readFileSync(output, 'utf8'));
        assert.ok(match, 'the step must publish a sha256 hash output');
        return match[1];
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const base = {
      name: 'fixture',
      version: '1.0.0',
      scripts: { postinstall: 'npm run inventory:facts', test: 'node --test' },
      dependencies: { a: '^1.0.0', b: '^2.0.0' },
      devDependencies: { c: '^3.0.0' },
      overrides: { d: '4.0.0' },
    };

    it('ignores edits that cannot change node_modules', () => {
      const same = hashOf(base);
      assert.equal(hashOf({ ...base, scripts: { ...base.scripts, test: 'node --test --shard=1/2', lint: 'biome lint' } }), same);
      assert.equal(hashOf({ ...base, version: '1.0.1', description: 'changed' }), same);
      assert.equal(hashOf({ ...base, dependencies: { b: '^2.0.0', a: '^1.0.0' } }), same, 'key order is not an input');
    });

    it('changes when a dependency field or an install lifecycle script changes', () => {
      const same = hashOf(base);
      const variants: Record<string, unknown>[] = [
        { ...base, dependencies: { ...base.dependencies, a: '^1.1.0' } },
        { ...base, devDependencies: {} },
        { ...base, optionalDependencies: { e: '1.0.0' } },
        { ...base, peerDependencies: { f: '1.0.0' } },
        { ...base, overrides: { d: '4.0.1' } },
        { ...base, peerDependenciesMeta: { f: { optional: true } } },
        { ...base, workspaces: ['packages/*'] },
        { ...base, bundleDependencies: ['a'] },
        { ...base, bundledDependencies: ['b'] },
        // npm ci reads allowScripts to decide which dependency install scripts run.
        { ...base, allowScripts: { esbuild: false } },
        { ...base, devEngines: { runtime: { name: 'node', version: '24' } } },
        // Every event npm ci runs for the root package (npm lib/commands/ci.js).
        ...['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare']
          .map((hook) => ({ ...base, scripts: { ...base.scripts, [hook]: 'node changed.mjs' } })),
      ];
      const hashes = variants.map(hashOf);
      for (const hash of hashes) assert.notEqual(hash, same);
      assert.equal(new Set(hashes).size, hashes.length);
    });
  });

  it('saves the clean install immediately on a successful miss, before consumers run', () => {
    const steps = readAction().runs.steps;
    const restore = steps.find((step) => step.id === 'node-modules');
    const installIndex = steps.findIndex((step) => step.run === 'npm ci');
    const save = steps[installIndex + 1];
    assert.equal(save?.uses, restore.uses.replace('/restore@', '/save@'));
    assert.match(save.uses, /^actions\/cache\/save@[a-f0-9]{40}$/);
    assert.equal(save.if, "steps.node-modules.outputs.cache-hit != 'true'");
    assert.equal(save.with.path, restore.with.path);
    assert.equal(save.with.key, '${{ steps.node-modules.outputs.cache-primary-key }}');
    assert.equal(steps[installIndex]['continue-on-error'], undefined);
    assert.equal(steps.some((step) => step.uses?.startsWith('actions/cache@')), false);
  });

  it('installs on a miss and regenerates repository inventory on an exact hit', () => {
    const steps = readAction().runs.steps;
    const cacheIndex = steps.findIndex((step) => step.id === 'node-modules');
    const install = steps.find((step) => step.run === 'npm ci');
    const inventory = steps.find((step) => step.run === 'npm run inventory:facts');
    assert.equal(install?.if, "steps.node-modules.outputs.cache-hit != 'true'");
    assert.equal(inventory?.if, "steps.node-modules.outputs.cache-hit == 'true'");
    assert.equal(packageScripts.postinstall, inventory.run);
    for (const step of [install, inventory]) {
      assert.equal(step.shell, 'bash');
      assert.ok(steps.indexOf(step) > cacheIndex);
    }
  });

  // The npm download cache is the fallback for a node_modules miss, so the
  // action restores it only then; restoring it in setup-node cost every job
  // 4-12s on hits that never read it.
  it('restores the npm download cache only on a miss, before npm ci, and saves it after the clean install', () => {
    const steps = readAction().runs.steps;
    const restore = steps.find((step) => step.id === 'npm-cache');
    const installIndex = steps.findIndex((step) => step.run === 'npm ci');
    assert.ok(restore, 'the action must restore the npm download cache on a miss');
    assert.match(restore.uses, /^actions\/cache\/restore@[a-f0-9]{40}$/);
    assert.equal(restore.if, "steps.node-modules.outputs.cache-hit != 'true' && inputs.npm-cache == 'true'");
    assert.equal(readAction().inputs['npm-cache'].default, 'true');
    assert.equal(restore.with.path, '~/.npm');
    assert.equal(restore.with.key, "npm-cache-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('package-lock.json') }}");
    assert.ok(steps.indexOf(restore) < installIndex);
    const save = steps.find((step) => step.uses?.startsWith('actions/cache/save@') && step.with?.path === '~/.npm');
    assert.ok(steps.indexOf(save) > installIndex + 1, 'the clean node_modules save stays first after npm ci');
    assert.equal(save.if, "steps.node-modules.outputs.cache-hit != 'true' && inputs.npm-cache == 'true' && steps.npm-cache.outputs.cache-hit != 'true'");
    assert.equal(save.with.key, '${{ steps.npm-cache.outputs.cache-primary-key }}');
  });

  // Every CI job installs through the action, leaves setup-node's cache off and
  // uses the action's miss-only npm fallback.
  for (const [workflowText, jobIds, setupCache] of [
    [ciWorkflow, ['checks', 'unit', 'build', 'dom', 'server', 'health-probe-cutovers'], undefined],
  ] as const) {
    for (const jobId of jobIds) {
      it(`${jobId} uses the shared action after Node 24 setup with npm fallback`, () => {
        // A `parallel:` group holds its steps in a list; expand it in place so
        // the action is still found, and the order check still holds.
        const steps = YAML.parse(workflowText).jobs[jobId].steps
          .flatMap((step: { parallel?: unknown[] }) => step.parallel ?? [step]);
        const setup = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
        const install = steps.find((step) => step.uses === './.github/actions/install-root-deps');
        assert.ok(install, `${jobId} must use the shared root dependency action`);
        assert.equal(setup.with['node-version'], '24');
        assert.equal(setup.with.cache, setupCache);
        assert.equal(install.with?.['npm-cache'], setupCache === 'npm' ? 'false' : undefined);
        assert.ok(steps.indexOf(setup) < steps.indexOf(install));
        assert.equal(steps.some((step) => step.run === 'npm ci'), false);
      });
    }
  }
});

const workflowText = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => read(resolve(workflowsDir, name)))
  .join('\n');

const REQUIRED_PR_SCRIPTS = [
  'test:data',
  'test:dom',
  'test:sidecar',
  'test:server',
] as const;



// The workflows whose checks gate a pull request (ci.yml replaced the Test,
// Typecheck and Lint Code workflows and their deploy gate).
const PR_GATE_WORKFLOWS = [
  'CI',
  'Security Audit',
  'Stacked Merge Guard',
  'Proto Generation Check',
] as const;

// The Lite gate's own jobs, then the gates of services outside the web app
// (consumer-prices-core, Umami, digest image) that Phase 2 decides.
const CI_JOBS = [
  'checks', 'unit', 'build', 'dom', 'server', 'health-probe-cutovers',
  'consumer-prices', 'umami-postgres', 'digest-image',
] as const;






function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function workflowJobBlock(workflow: string, job: string): string {
  const match = workflow.match(new RegExp(`\\n  ${escapeRegExp(job)}:\\n[\\s\\S]*?(?=\\n  [\\w-]+:\\n|\\n$)`));
  assert.ok(match, `workflow must define ${job}`);
  return match[0];
}

// On push, schedule, and workflow_dispatch, github.event.pull_request.number is
// empty. A group that interpolates only that field collapses to a shared prefix
// (`proto-freshness-`), and cancel-in-progress: true then evicts sibling
// mainline runs that still owe the deploy gate a verdict (#8445).
// The empty-on-non-PR operand must sit immediately before the unique fallback:
// `github.ref || github.sha` still matches a bare `|| github.sha` and still
// collapses every push to main onto one group.
const NON_PR_CONCURRENCY_FALLBACK =
  /github\.event\.pull_request\.number\s*\|\|\s*github\.(?:sha|run_id)\b/;
const PR_ONLY_CANCEL_IN_PROGRESS = "${{ github.event_name == 'pull_request' }}";

function workflowLevelConcurrency(source: string): {
  group?: unknown;
  'cancel-in-progress'?: unknown;
} | null {
  const concurrency = (YAML.parse(source) as { concurrency?: unknown }).concurrency;
  if (typeof concurrency !== 'object' || concurrency === null) return null;
  return concurrency as { group?: unknown; 'cancel-in-progress'?: unknown };
}

function cancelsUnconditionallyWithoutNonPrFallback(source: string): boolean {
  const concurrency = workflowLevelConcurrency(source);
  if (!concurrency) return false;
  const cancel = concurrency['cancel-in-progress'];
  // Boolean true always evicts. Any other expression does too, unless it is
  // exactly the #8443 PR-only form. `${{ true }}` used to skip this helper.
  const isUnconditionalCancel =
    cancel === true || (typeof cancel === 'string' && cancel !== PR_ONLY_CANCEL_IN_PROGRESS);
  if (!isUnconditionalCancel) return false;
  return typeof concurrency.group !== 'string' || !NON_PR_CONCURRENCY_FALLBACK.test(concurrency.group);
}

function workflowStepBlock(workflow: string, stepName: string): string {
  const marker = `\n      - name: ${stepName}\n`;
  const startIndex = workflow.indexOf(marker);
  assert.notEqual(startIndex, -1, `workflow must define step ${stepName}`);
  const nextStepIndex = workflow.indexOf('\n      - ', startIndex + marker.length);
  return workflow.slice(startIndex, nextStepIndex === -1 ? workflow.length : nextStepIndex);
}

function workflowStepBlocksByUses(workflow: string, action: string): string[] {
  const marker = new RegExp(`\\n      - uses: ${escapeRegExp(action)}@[^\\n]+\\n`, 'g');
  const blocks: string[] = [];
  for (const match of workflow.matchAll(marker)) {
    const startIndex = match.index ?? -1;
    assert.notEqual(startIndex, -1, `workflow must define ${action}`);
    const nextStepIndex = workflow.indexOf('\n      - ', startIndex + match[0].length);
    blocks.push(workflow.slice(startIndex, nextStepIndex === -1 ? workflow.length : nextStepIndex));
  }
  assert.ok(blocks.length > 0, `workflow must define ${action}`);
  return blocks;
}

function collectPackageLockfiles(): string[] {
  return execFileSync('git', ['ls-files', '*package-lock.json'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
}

function collectDockerfiles(): string[] {
  return execFileSync('git', ['ls-files', '*Dockerfile*'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /(^|\/)Dockerfile(\.|$)/.test(file))
    .sort();
}

function securityAuditSteps() {
  const job = YAML.parse(securityAuditWorkflow).jobs['audit-lockfile'];
  assert.equal(job.strategy, undefined, 'lockfile audits must share one job without matrix fan-out');
  return job.steps.filter((step: { run?: string }) => step.run?.includes('node .github/scripts/audit-production-dependencies.mjs'));
}

function securityAuditLockfiles(): string[] {
  return securityAuditSteps().map((step: { run: string }) => step.run.match(/--lockfile "([^"]+)"/)?.[1]).sort();
}

// #7593: a `deployment_status` trigger is privileged — repo secrets and a
// write-capable GITHUB_TOKEN are in scope — and these workflows check out
// `github.event.deployment.sha`, so a dependency install there would resolve
// THAT commit's lockfile and could write its package cache into the shared
// Actions cache scope that main-branch runs restore from. PR #7591 shipped
// exactly that shape (`cache: 'npm'` + `npm ci --ignore-scripts`) and the
// #7605 emergency revert removed it; this guard keeps it from coming back.
// Deliberately file-level and fail-closed: if a deployment_status workflow
// ever genuinely needs npm, extend this guard consciously with the
// event-scoping argument rather than special-casing around it.
describe('deployment_status triggers — npm cache scope hygiene (#7593)', () => {
  // Comment lines are not executable: the workflows themselves explain the
  // absence ("no npm ci", #7593) and must not self-trip the guard. Round-trip
  // through the YAML parser, which drops comments AND normalizes flow-map
  // inputs (with: {cache: 'npm'}) into the same block form the ban patterns
  // match, so neither spelling can hide behind syntax. If a future workflow
  // carries YAML this parser rejects, fall back to the plain comment-line
  // filter: weaker (comments survive), but the ban patterns themselves stay
  // fail-closed on whatever text remains.
  const executableText = (source: string): string =>
  {
    try {
      const doc = YAML.parse(source);
      return doc == null ? '' : YAML.stringify(doc);
    } catch {
      return source
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
    }
  }

  // Block-style (`on:\n  deployment_status:`) and flow-style (`on: [ … ]`)
  // triggers; the block is the `on:` value up to the next column-0 key. Both
  // forms tolerate a trailing YAML comment (`on: # ...`,
  // `deployment_status: # ...`) — the guard is fail-closed, so a comment must
  // never silently exclude a workflow from the sweep.
  const triggersOnDeploymentStatus = (source: string): boolean => {
    const flow = source.match(/^on:[ \t]*(?:#[^\n]*)?\s*\[([^\]]*)\]/m);
    if (flow) return /['"]?deployment_status['"]?/.test(flow[1]);
    const onIndex = source.search(/^on:(?:[ \t]*#[^\n]*)?\s*$/m);
    if (onIndex === -1) return false;
    const block = source.slice(onIndex).split(/\n(?=\S)/)[0];
    return /^ {2}deployment_status:(?:[ \t]*#[^\n]*)?\s*$/m.test(block);
  };

  // The two ban patterns and the single detection path both tests below read.
  // The sweep asserts real workflows stay clean; the self-test asserts the
  // patterns can still fire, so a corrupted pattern reddens this suite
  // instead of silently covering nothing.
  // After the YAML round-trip a truthy cache input always appears as a
  // block-mapping key, so the line-start anchor no longer depends on the
  // author's block vs flow-map spelling. Only falsy scalars (false, null, ~)
  // are exempt.
  const CACHE_BAN_PATTERN = /^[ \t]*cache:[ \t]*(?!false\b)(?!null\b)(?!~)[^\s#]/m;
  // `npm i` resolves the deployed SHA's lockfile exactly like `npm install`,
  // so the alias spelling is banned too, under any shell whitespace
  // (double space or a tab before the verb is the same command). The word
  // boundaries keep npm info, npm init and pnpm i out of the ban.
  const NPM_INSTALL_BAN_PATTERN = /\bnpm[ \t]+(?:ci|install|i)\b/;

  const deploymentCacheProblems = (executable: string): string[] => {
    const problems: string[] = [];
    if (CACHE_BAN_PATTERN.test(executable)) {
      problems.push(
        'a step carries a truthy `cache:` input, so a privileged deployment_status run could save a package cache resolved from github.event.deployment.sha',
      );
    }
    if (NPM_INSTALL_BAN_PATTERN.test(executable)) {
      problems.push("the job runs npm ci/install, resolving the deployed SHA's lockfile instead of main's");
    }
    return problems;
  };

  it('keeps every deployment_status-triggered workflow free of package-cache writes and lockfile installs (#7593)', () => {
    const scanned: string[] = [];
    const offenders: string[] = [];

    for (const file of readdirSync(workflowsDir)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .sort()) {
      const source = read(resolve(workflowsDir, file));
      if (!triggersOnDeploymentStatus(source)) continue;
      scanned.push(file);

      const problems = deploymentCacheProblems(executableText(source));
      if (problems.length > 0) offenders.push(`${file}\n    - ${problems.join('\n    - ')}`);
    }

    // No workflow triggers on deployment_status since mcp-live-smoke.yml and
    // live-api-cache-auth.yml were removed (Lite Phase 1c). Pin that so a new
    // one is noticed and reviewed against this guard; the self-test below
    // keeps the trigger parser and ban patterns able to fire.
    assert.deepEqual(
      scanned,
      [],
      'a workflow now triggers on deployment_status — confirm it passes the ban below, then update this expectation',
    );
    assert.deepEqual(
      offenders,
      [],
      '#7593: a deployment_status trigger is privileged (repo secrets, write-capable GITHUB_TOKEN) and these workflows check out github.event.deployment.sha, so resolving dependencies there could write a package cache built from a non-main lockfile into the shared scope main-branch runs restore from. PR #7591 shipped that shape and #7605 reverted it; if one of these workflows genuinely needs npm, extend this guard deliberately:\n' +
        offenders.join('\n'),
    );
  });

  // The sweep only asserts the absence of offenders, so a ban pattern that
  // stopped matching (lost indentation anchor, dropped alternation branch)
  // would keep this suite green while the guard detects nothing. This
  // self-test feeds inline sources through the same deploymentCacheProblems
  // path the sweep uses and pins the firing half of the guard.
  it('keeps the ban patterns load-bearing: offenders fire and safe look-alikes stay silent (#7593)', () => {
    const cacheProblem =
      'a step carries a truthy `cache:` input, so a privileged deployment_status run could save a package cache resolved from github.event.deployment.sha';
    const npmProblem = "the job runs npm ci/install, resolving the deployed SHA's lockfile instead of main's";

    const offender = [
      'name: offender',
      'on:',
      '  deployment_status:',
      'jobs:',
      '  smoke:',
      '    steps:',
      '      - uses: actions/setup-node@v4',
      '        with:',
      "          cache: 'npm'",
      '      - run: npm ci --ignore-scripts --omit=optional',
    ].join('\n');
    assert.deepEqual(deploymentCacheProblems(executableText(offender)), [cacheProblem, npmProblem]);

    // Flow-map syntax must trip the same bans: the parser normalizes the
    // mapping, so the block-style fixture reshaped into a flow map detects
    // identically (review finding: line-anchored pattern missed
    // with: {node-version: '24', cache: 'npm'}).
    const flowMapOffender = [
      "name: flow-map-offender",
      'on:',
      '  deployment_status:',
      'jobs:',
      '  smoke:',
      '    steps:',
      "      - uses: actions/setup-node@v4",
      "        with: { node-version: '24', cache: 'npm' }",
      "      - run: npm ci --ignore-scripts --omit=optional",
    ].join('\n');
    assert.deepEqual(deploymentCacheProblems(executableText(flowMapOffender)), [cacheProblem, npmProblem]);

    const aliasOffender = offender.replace(
      'npm ci --ignore-scripts --omit=optional',
      'npm i --omit=optional',
    );
    assert.ok(
      deploymentCacheProblems(executableText(aliasOffender)).includes(npmProblem),
      'npm i must be flagged the same as npm install',
    );

    // Shell whitespace between npm and the verb is legal and equally
    // dangerous: double space and tab must fire like the single-space form
    // (review finding: literal single space escaped detection).
    for (const spaced of ['npm  ci --ignore-scripts', 'npm\tinstall --no-audit', 'npm\ti']) {
      assert.ok(
        deploymentCacheProblems(executableText(offender.replace('npm ci --ignore-scripts --omit=optional', spaced)))
          .includes(npmProblem),
        'irregular shell whitespace before the npm verb must not escape the ban: ' + spaced,
      );
    }

    for (const safe of [
      '        with:\n          cache: false',
      "      # cache: 'npm'",
      '        with:\n          cache-dependency-path: package-lock.json',
      '      - run: npm run build',
      "      - run: pnpm i --frozen-lockfile",
      "      - run: npm info webpack",
    ]) {
      assert.deepEqual(deploymentCacheProblems(executableText(safe)), [], `must not flag safe input:\n${safe}`);
    }

    // Both trigger spellings must stay recognized through a trailing YAML
    // comment, and a flow list without deployment_status must not be swept.
    assert.equal(
      triggersOnDeploymentStatus('on: # deploy hook\n  deployment_status: # success only'),
      true,
      'a trailing comment on either trigger line must not hide a deployment_status trigger',
    );
    assert.equal(triggersOnDeploymentStatus('on: [push, deployment_status]'), true);
    assert.equal(triggersOnDeploymentStatus('on: [push, workflow_dispatch]'), false);
  });
});

describe('CI workflow coverage', () => {
  it('runs the proto breaking check against the full main history (#6114)', () => {
    const breakingJob = workflowJobBlock(protoCheckWorkflow, 'proto-breaking');
    assert.match(breakingJob, /^\s+needs: changes\s*$/m);
    assert.match(
      breakingJob,
      /^\s+if: needs\.changes\.outputs\.breaking == 'true'\s*$/m,
      'proto-breaking must run for schema changes from both internal and fork pull requests',
    );
    const [checkoutStep] = workflowStepBlocksByUses(breakingJob, 'actions/checkout');
    assert.match(
      checkoutStep,
      /\n\s+with:\n\s+fetch-depth: 0\n/,
      'proto-breaking must fetch full history so the main baseline is available',
    );
    const breakingStep = workflowStepBlock(protoCheckWorkflow, 'Check for breaking proto changes');
    assert.match(
      breakingStep,
      /^\s+run: make breaking\s*$/m,
      'proto-check.yml must run the canonical buf breaking target against the fetched origin/main proto baseline',
    );
    assert.doesNotMatch(breakingStep, /^\s+continue-on-error:/m);

    // Pin the shared Makefile baseline. `run: make breaking` alone stays green if the
    // recipe regresses to proto/.git#branch=main (no repo) or loses origin/main.
    const makefile = read(resolve(root, 'Makefile'));
    assert.match(
      makefile,
      /^breaking:[^\n]*\n\tcd \$\(PROTO_DIR\) && buf breaking --against '\.\.\/\.git#branch=origin\/main,subdir=proto'\s*$/m,
      "make breaking must use '../.git#branch=origin/main,subdir=proto' from PROTO_DIR",
    );

    // Pin the documented FILE/PACKAGE/WIRE_JSON policy (binary WIRE intentionally off).
    const bufYaml = read(resolve(root, 'proto/buf.yaml'));
    const breakingUse = bufYaml.match(/\nbreaking:\n(?:[^\n]*\n)*?[ \t]+use:\n((?:[ \t]+-[^\n]*\n)+)/);
    assert.ok(breakingUse, 'proto/buf.yaml must declare breaking.use');
    const rules = [...breakingUse[1].matchAll(/^[ \t]+-[ \t]+(\S+)\s*$/gm)].map((m) => m[1]).sort();
    assert.deepEqual(
      rules,
      ['FILE', 'PACKAGE', 'WIRE_JSON'].sort(),
      'breaking.use must be exactly FILE, PACKAGE, WIRE_JSON (binary WIRE intentionally omitted)',
    );
  });

  it('keeps required PR smoke scripts defined and wired into workflows', () => {
    for (const script of REQUIRED_PR_SCRIPTS) {
      assert.equal(typeof packageScripts[script], 'string', `package.json must define ${script}`);
      assert.match(
        workflowText,
        new RegExp(`npm\\s+run\\s+${escapeRegExp(script)}(?:\\s|$)`),
        `A workflow must run npm run ${script}`,
      );
    }
  });

  it('keeps every CI job, with no path filter that could skip it', () => {
    const workflow = YAML.parse(ciWorkflow) as { on: Record<string, unknown>; jobs: Record<string, { if?: unknown }> };
    assert.deepEqual(Object.keys(workflow.jobs).sort(), [...CI_JOBS].sort());
    for (const trigger of Object.values(workflow.on)) {
      assert.equal((trigger as { paths?: unknown } | null)?.paths, undefined, 'ci.yml must not path-filter its triggers');
      assert.equal((trigger as { 'paths-ignore'?: unknown } | null)?.['paths-ignore'], undefined, 'ci.yml must not path-filter its triggers');
    }
    for (const job of CI_JOBS) assert.equal(workflow.jobs[job].if, undefined, `${job} must run on every event`);
  });

  it('caps every CI job with an explicit timeout', () => {
    for (const job of CI_JOBS) {
      assert.match(workflowJobBlock(ciWorkflow, job), /\n {4}timeout-minutes: \d+\n/, `${job} must set timeout-minutes`);
    }
  });

  // The Redis-backed suites self-skip without the binaries, so the install must
  // fail loudly, and it must not wait on the Ubuntu mirror: a slow mirror put
  // 24-58s on the slowest unit shard in 9 of 12 runs (run 39922207309: 29s for
  // 1.5 MB at 51 kB/s).
  it('installs Redis in every unit shard from a package cache with dpkg, and fails without the binaries', () => {
    const unitSteps = YAML.parse(ciWorkflow).jobs.unit.steps
      .flatMap((step: { parallel?: unknown[] }) => step.parallel ?? [step]);
    const redis = unitSteps.find((step: { uses?: string }) => step.uses === './.github/actions/install-redis');
    assert.ok(redis, 'unit shards must install Redis through the cached action');
    assert.equal(redis['continue-on-error'], undefined, 'a failed Redis install must fail the shard');
    assert.equal(unitSteps.some((step: { run?: string }) => /apt-get install[^\n]*redis-server/.test(step.run ?? '')), false,
      'unit shards must not install Redis from the mirror directly');

    const steps = YAML.parse(read(resolve(root, '.github/actions/install-redis/action.yml'))).runs.steps;
    const restore = steps.find((step: { id?: string }) => step.id === 'redis-debs');
    assert.match(restore.uses, /^actions\/cache\/restore@[a-f0-9]{40}$/);
    const download = steps.find((step: { name?: string }) => step.name === 'Download Redis packages on cache miss');
    assert.equal(download.if, "steps.redis-debs.outputs.cache-hit != 'true'");
    assert.match(download.run, /--download-only/);
    // download() runs before ||, so without errexit: a failed dependency
    // download must fail the function, or the stale-index refresh is skipped.
    assert.match(download.run, /redis-server redis-tools \\\n\s*&& \(cd ~\/\.cache\/wm-redis-debs && sudo apt-get download redis-server redis-tools\)/);
    // ...and a failed download refreshes the stale index, then retries once.
    assert.match(download.run, /\ndownload \|\| \{ sudo apt-get update -qq && download; \}\n/);
    const install = steps.find((step: { name?: string }) => step.name === 'Install Redis packages');
    assert.match(install.run, /sudo dpkg -i "\$\{debs\[@\]\}"/);
    assert.doesNotMatch(install.run, /apt-get install[^\n]*\.deb/, 'apt-get must not install the cached .deb paths');
    assert.match(install.run, /redis-server --version/);
    assert.match(install.run, /redis-cli --version/);
    assert.equal(install['continue-on-error'], undefined);
    const save = steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/cache/save@'));
    assert.equal(save.if, download.if);
  });

  it('shares tracked edge bundle discovery with pre-push', () => {
    const edgeBundleStep = workflowStepBlock(ciWorkflow, 'Edge function bundle check');
    assert.match(
      edgeBundleStep,
      /^\s+run: node scripts\/check-edge-function-bundles\.mjs --caller=ci\s*$/m,
    );
    assert.doesNotMatch(edgeBundleStep, /find api\//);
  });

  it('runs scheduled and per-PR production dependency audits for every package lockfile', () => {
    const packageLockfiles = collectPackageLockfiles();

    assert.match(securityAuditWorkflow, /\n {2}pull_request:\n/, 'security-audit.yml must run on PRs');
    assert.match(securityAuditWorkflow, /\n {2}push:\n {4}branches: \[main\]\n/, 'security-audit.yml must run on main pushes');
    assert.match(securityAuditWorkflow, /\n {2}schedule:\n/, 'security-audit.yml must run on a schedule');
    assert.match(securityAuditWorkflow, /\n {2}security-audit:\n/, 'security-audit.yml must define the aggregate security-audit check');
    assert.match(securityAuditWorkflow, /\n {4}name: security-audit\n/, 'security-audit.yml must publish a security-audit check run');
    assert.match(
      securityAuditWorkflow,
      /if:\s*\$\{\{\s*\(always\(\)\)\s*&&\s*\(github\.event_name != 'schedule' \|\| github\.repository == 'koala73\/worldmonitor'\)\s*\}\}/,
      'security-audit.yml must always publish the aggregate check',
    );
    assert.match(
      securityAuditWorkflow,
      /AUDIT_RESULT"\s*=\s*"cancelled"/,
      'security-audit.yml must publish a failing aggregate check when the audit job is cancelled',
    );
    assert.match(
      securityAuditWorkflow,
      /node \.github\/scripts\/audit-production-dependencies\.mjs/,
      'security-audit.yml must run the production dependency audit gate',
    );
    assert.match(
      securityAuditScript,
      /npm['"],\s*\[\s*['"]audit['"],\s*['"]--omit=dev['"],\s*['"]--json['"]/,
      'the production dependency audit gate must run npm audit --omit=dev --json',
    );
    assert.match(
      securityAuditScript,
      /collectUnbaselinedFindings/,
      'the production dependency audit gate must fail on unbaselined high-severity production advisories',
    );
    assert.deepEqual(
      securityAuditLockfiles(),
      packageLockfiles,
      'security-audit.yml must cover exactly the repo package-lock.json files',
    );

    const auditSteps = securityAuditSteps();
    const auditJob = YAML.parse(securityAuditWorkflow).jobs['audit-lockfile'];
    assert.ok(
      auditJob['timeout-minutes'] >= auditSteps.length * 10 + 5,
      'the job must allow every audit its former budget plus setup and upload time',
    );
    for (const step of auditSteps) {
      assert.equal(step['timeout-minutes'], 10, 'a stalled audit must not consume later audits budgets');
      assert.equal(step.if, '${{ !cancelled() }}', 'later audits must run after a blocking finding');
      assert.notEqual(step['continue-on-error'], true, 'blocking audits must still fail the job');
      const lockfile = step.run.match(/--lockfile "([^"]+)"/)?.[1];
      assert.ok(lockfile, 'audit step must name its lockfile');
      assert.ok(step.run.includes(`--workspace "${dirname(lockfile)}"`), `audit must use the workspace for ${lockfile}`);
      const manifest = lockfile.replace('package-lock.json', 'package.json');
      assert.ok(step.run.includes(`--package-json "${manifest}"`), `audit must use the manifest for ${lockfile}`);
    }
  });

  it('includes every audited npm manifest and lockfile in the sparse checkout', () => {
    const checkout = YAML.parse(securityAuditWorkflow).jobs['audit-lockfile'].steps[0];
    assert.equal(checkout.with['sparse-checkout-cone-mode'], false);
    assert.equal(checkout.with.filter, undefined, 'an explicit filter overrides the checkout action sparse patterns');
    const paths = new Set(checkout.with['sparse-checkout'].trim().split('\n'));
    assert.ok(paths.has('/.github/scripts/audit-production-dependencies.mjs'));
    for (const step of securityAuditSteps()) {
      for (const option of ['package-json', 'lockfile']) {
        const path = step.run.match(new RegExp(`--${option} "([^"]+)"`))?.[1];
        assert.ok(paths.has(`/${path}`), `sparse checkout must include ${path}`);
      }
    }
  });

  it('preserves npm configuration for each sparse audit workspace', () => {
    const checkout = YAML.parse(securityAuditWorkflow).jobs['audit-lockfile'].steps[0];
    const paths = new Set(checkout.with['sparse-checkout'].trim().split('\n'));
    const configs = execFileSync('git', ['ls-files', '--', '.npmrc', '**/.npmrc'], { cwd: root, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const workspaces = new Set(securityAuditLockfiles().map(dirname));
    for (const config of configs.filter((path) => workspaces.has(dirname(path)))) {
      assert.ok(paths.has(`/${config}`), `sparse checkout must retain npm configuration ${config}`);
    }
  });

  it('loads audit modules and reads PR base objects from the configured sparse checkouts', () => {
    const jobs = YAML.parse(securityAuditWorkflow).jobs;
    const auditJobs = ['audit-lockfile'];
    const patterns = auditJobs.map((name) => jobs[name].steps[0].with['sparse-checkout'] as string);
    const dir = mkdtempSync(resolve(tmpdir(), 'wm-sparse-audit-'));
    const env = { ...process.env };
    for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], { cwd: root, encoding: 'utf8' }).trim().split('\n')) {
      delete env[name];
    }
    const git = (args: string[], input?: string) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', input });
    try {
      git(['init', '--quiet']);
      for (const path of new Set(patterns.flatMap((pattern) => pattern.trim().split('\n').map((line) => line.slice(1))))) {
        const target = resolve(dir, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(resolve(root, path)));
      }
      writeFileSync(resolve(dir, 'unrelated.txt'), 'base-only content\n');
      git(['add', '.']);
      git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Audit fixture',
        '-c', 'user.email=audit@example.invalid', 'commit', '--quiet', '-m', 'audit inputs']);
      for (const [index, name] of auditJobs.entries()) {
        git(['sparse-checkout', 'set', '--no-cone', '--stdin'], patterns[index]);
        assert.equal(existsSync(resolve(dir, 'unrelated.txt')), false);
        assert.equal(git(['show', 'HEAD:unrelated.txt']), 'base-only content\n');
        for (const path of patterns[index].trim().split('\n')) {
          assert.deepEqual(readFileSync(resolve(dir, path.slice(1))), readFileSync(resolve(root, path.slice(1))));
        }
        execFileSync(process.execPath, ['--input-type=module', '-e', "await import('./.github/scripts/audit-production-dependencies.mjs')"], { cwd: dir, env });
        if (name === 'audit-lockfile') {
          const baseLock = git(['show', 'HEAD:package-lock.json']);
          writeFileSync(resolve(dir, 'package-lock.json'), `${baseLock}\n`);
          assert.equal(spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'package-lock.json'], { cwd: dir, env }).status, 1);
          assert.equal(git(['show', 'HEAD:package-lock.json']), baseLock);
          writeFileSync(resolve(dir, 'package-lock.json'), baseLock);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the aggregate verdict list in step with the audit steps', () => {
    const names = securityAuditSteps().map((step: { env: { AUDIT_STATUS_FILE: string } }) =>
      step.env.AUDIT_STATUS_FILE.match(/audit-status\/([^/]+)\.txt$/)?.[1],
    ).sort();
    const aggregateNames = (securityAuditWorkflow.match(/^\s+AUDIT_NAMES:\s*'([^']+)'/m)?.[1] ?? '')
      .split(/\s+/).filter(Boolean).sort();
    assert.deepEqual(names, aggregateNames, 'every lockfile must publish a distinct required verdict');
    const upload = YAML.parse(securityAuditWorkflow).jobs['audit-lockfile'].steps.find(
      (step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact@'),
    );
    assert.equal(upload.if, 'always()');
    assert.equal(upload.with.name, 'audit-status-lockfiles');
    assert.equal(upload.with.path, '${{ runner.temp }}/audit-status/*.txt');
  });

  it('separates an unaudited lockfile from a real dependency finding', () => {
    // A GitHub Actions outage (2026-08-06: "Failed to resolve action download
    // info") kills the audit job before it audits anything. The aggregate must
    // report that as an incomplete run, not as "audits failed".
    assert.match(
      securityAuditWorkflow,
      /if-no-files-found: ignore/,
      'security-audit.yml must upload a per-lockfile verdict artifact',
    );
    assert.match(
      securityAuditWorkflow,
      /uses: actions\/download-artifact@[0-9a-f]{40}/,
      'the security-audit aggregate must download the per-lockfile verdicts',
    );
    assert.match(
      securityAuditWorkflow,
      /No audit verdict was produced for/,
      'the aggregate must name the lockfiles that produced no verdict',
    );
  });

  it('gives the audit gate the base ref it needs to attribute new advisories', () => {
    // Without a base ref every finding is "inherited", so a PR that genuinely
    // introduces a vulnerable dependency would only warn.
    assert.match(
      securityAuditWorkflow,
      /AUDIT_BASE_REF: \$\{\{ github\.event_name == 'pull_request'/,
      'security-audit.yml must pass the PR base sha to the audit gate',
    );
    assert.match(
      securityAuditWorkflow,
      /git fetch --no-tags --depth=1 origin \$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
      'security-audit.yml must fetch the base commit so the base lockfile is readable',
    );
    assert.match(
      securityAuditScript,
      /collectIntroducedIds/,
      'the audit gate must compute which advisories the change introduced',
    );
  });

  it('keeps Docker base images pinned to immutable digests', () => {
    const failures: string[] = [];

    for (const dockerfile of collectDockerfiles()) {
      const aliases = new Set<string>();
      const source = readFileSync(resolve(root, dockerfile), 'utf8');
      const lines = source.split('\n');

      lines.forEach((line, index) => {
        const match = line.match(/^FROM\s+(.+)$/i);
        if (!match) return;

        const parts = match[1].trim().split(/\s+/);
        while (parts[0]?.startsWith('--')) {
          parts.shift();
        }

        const image = parts[0];
        const asIndex = parts.findIndex((part) => part.toUpperCase() === 'AS');
        const alias = asIndex >= 0 ? parts[asIndex + 1] : undefined;
        const isKnownStage = image ? aliases.has(image) : false;
        if (alias) {
          aliases.add(alias);
        }

        if (!image || image === 'scratch' || isKnownStage) return;

        if (!/@sha256:[0-9a-f]{64}$/i.test(image)) {
          failures.push(`${dockerfile}:${index + 1} ${line.trim()}`);
        }
      });
    }

    assert.deepEqual(
      failures,
      [],
      `Docker FROM images must be pinned with full @sha256:<64 hex> digests:\n${failures.join('\n')}`,
    );
  });

  it('keeps GitHub Actions external uses pinned to commit SHAs', () => {
    const failures: string[] = [];
    const workflowFiles = readdirSync(workflowsDir)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .sort();

    for (const workflowFile of workflowFiles) {
      const source = readFileSync(resolve(workflowsDir, workflowFile), 'utf8');
      const lines = source.split('\n');

      lines.forEach((line, index) => {
        const match = line.match(/^\s*uses:\s*([^@\s#]+)@([^\s#]+)/);
        if (!match) return;

        const [, action, ref] = match;
        if (action.startsWith('./') || action.startsWith('docker://')) return;

        if (!/^[0-9a-f]{40}$/i.test(ref)) {
          failures.push(`${workflowFile}:${index + 1} ${line.trim()}`);
        }
      });
    }

    assert.deepEqual(
      failures,
      [],
      `GitHub Actions uses refs must be 40-character commit SHAs:\n${failures.join('\n')}`,
    );
  });
});

// Until #8443 these four workflows declared no concurrency group, so a new
// push never evicted the run it superseded. Across the last 300 runs of each,
// 177 (59%) ran to completion on a SHA that was already dead, 0 were
// cancelled. Those slots are not free. In the 06:20-07:40 window on
// 2026-09-20 the repo peaked at 43 concurrent jobs and live commits waited
// 200-327 s for a runner, turning a 7-minute check wall into 19-27 minutes.
//
// Eviction is safe here because a superseded PR run has no verdict anyone
// will read (unlike a live detection-net probe, where an evicted run reads as
// neither pass nor fail).
// Branch protection evaluates the head SHA only.
//
// Cancellation is scoped to pull_request. A push to main still owes a verdict,
// and the audit cron is a standalone detection net, so both keep a per-run
// group that nothing can evict.
describe('gated workflows evict superseded PR runs (#8443)', () => {
  const prScopedCancellers = [
    ['ci.yml', 'ci'],
    ['security-audit.yml', 'security-audit'],
  ] as const;

  for (const [file, group] of prScopedCancellers) {
    it(`${file} cancels a superseded pull_request run and nothing else`, () => {
      const workflow = YAML.parse(read(resolve(workflowsDir, file))) as {
        concurrency?: { group?: string; 'cancel-in-progress'?: string };
      };
      assert.ok(workflow.concurrency, `${file} must declare workflow-level concurrency`);
      assert.equal(
        workflow.concurrency.group,
        `${group}-\${{ github.event.pull_request.number || github.run_id }}`,
        `${file} must group by PR number, and fall back to a per-run id so a push or cron run is never evicted`,
      );
      assert.equal(
        workflow.concurrency['cancel-in-progress'],
        PR_ONLY_CANCEL_IN_PROGRESS,
        `${file} must cancel only pull_request runs — a superseded main push still owes a verdict`,
      );
    });
  }

  // PR_GATE_WORKFLOWS is the definition of "blocks a merge". A new
  // workflow added there without cancellation reintroduces the dead-SHA burn
  // silently, because nothing about a wasted runner is ever red.
  it('leaves no gate-triggering workflow without cancellation', () => {
    const gateWorkflows: readonly string[] = PR_GATE_WORKFLOWS;

    const byName = new Map<string, string>();
    for (const entry of readdirSync(workflowsDir)) {
      if (!entry.endsWith('.yml')) continue;
      const source = read(resolve(workflowsDir, entry));
      const name = (YAML.parse(source) as { name?: string }).name;
      if (name) byName.set(name, source);
    }

    // Text-matching `cancel-in-progress:` would accept a literal `false`, and
    // a job-level group evicts only its own job while the rest of the
    // superseded run keeps burning. A gated workflow has several jobs feeding
    // the gate by definition, so only a workflow-level group with cancellation
    // actually enabled retires the whole run.
    const uncancelled = gateWorkflows.filter((name) => {
      const source = byName.get(name);
      assert.ok(source, `PR gate workflow "${name}" is not defined by any workflow file`);
      const concurrency = workflowLevelConcurrency(source);
      if (!concurrency) return true;
      const { group, 'cancel-in-progress': cancel } = concurrency;
      if (typeof group !== 'string' || group.length === 0) return true;
      return !(cancel === true || (typeof cancel === 'string' && cancel.includes('${{')));
    });

    assert.deepEqual(
      uncancelled,
      [],
      `every PR gate workflow must evict superseded runs: ${uncancelled.join(', ')}`,
    );
  });

  // cancel === true used to pass the test above even when the group had no
  // fallback, so proto-check.yml's mainline collapse was invisible. Parse the
  // group: github.event.pull_request.number must sit immediately before
  // github.sha or github.run_id, the two unique identities the repo already
  // uses for this (#8444, stacked-merge-guard.yml). A string cancel other than
  // the #8443 PR-only form is also unconditional.
  it('requires a non-PR fallback when a gated workflow cancels unconditionally (#8445)', () => {
    const gateWorkflows: readonly string[] = PR_GATE_WORKFLOWS;

    const byName = new Map<string, string>();
    for (const entry of readdirSync(workflowsDir)) {
      if (!entry.endsWith('.yml')) continue;
      const source = read(resolve(workflowsDir, entry));
      const name = (YAML.parse(source) as { name?: string }).name;
      if (name) byName.set(name, source);
    }

    const collapsed = gateWorkflows.filter((name) => {
      const source = byName.get(name);
      assert.ok(source, `PR gate workflow "${name}" is not defined by any workflow file`);
      return cancelsUnconditionallyWithoutNonPrFallback(source);
    });
    assert.deepEqual(
      collapsed,
      [],
      `unconditional cancel on a gated workflow must keep a unique group off pull_request: ${collapsed.join(', ')}`,
    );
  });

  it('fails proto-check.yml when its concurrency group is mutated back to PR-number-only (#8445)', () => {
    const collapsedProto = protoCheckWorkflow.replace(
      /group:\s*[^\n]+/,
      'group: proto-freshness-${{ github.event.pull_request.number }}',
    );
    assert.notEqual(collapsedProto, protoCheckWorkflow, 'the collapsed-group mutation must change the live source');
    assert.match(
      collapsedProto,
      /group:\s*proto-freshness-\$\{\{ github\.event\.pull_request\.number \}\}/,
      'the collapsed-group mutation must apply',
    );
    assert.equal(
      cancelsUnconditionallyWithoutNonPrFallback(collapsedProto),
      true,
      'the tightened guard must fail proto-check.yml when the group interpolates only the PR number',
    );

    const uniqueProto = protoCheckWorkflow.replace(
      /group:\s*[^\n]+/,
      'group: proto-freshness-${{ github.event.pull_request.number || github.sha }}',
    );
    assert.equal(
      cancelsUnconditionallyWithoutNonPrFallback(uniqueProto),
      false,
      'a SHA fallback must satisfy the tightened guard',
    );

    const runIdProto = protoCheckWorkflow.replace(
      /group:\s*[^\n]+/,
      'group: proto-freshness-${{ github.event.pull_request.number || github.run_id }}',
    );
    assert.equal(
      cancelsUnconditionallyWithoutNonPrFallback(runIdProto),
      false,
      'a run_id fallback must also satisfy the tightened guard',
    );

    for (const collapsingOperand of [
      'github.ref',
      'github.event_name',
      'github.repository',
      'github.workflow',
    ] as const) {
      const collapsingProto = protoCheckWorkflow.replace(
        /group:\s*[^\n]+/,
        `group: proto-freshness-\${{ ${collapsingOperand} || github.sha }}`,
      );
      assert.notEqual(
        collapsingProto,
        protoCheckWorkflow,
        `${collapsingOperand} mutation must change the live source`,
      );
      assert.equal(
        cancelsUnconditionallyWithoutNonPrFallback(collapsingProto),
        true,
        `the guard must reject ${collapsingOperand} || github.sha — that operand is never empty on push`,
      );
    }

    const expressionCancelCollapsed = protoCheckWorkflow
      .replace(
        /group:\s*[^\n]+/,
        'group: proto-freshness-${{ github.event.pull_request.number }}',
      )
      .replace(/cancel-in-progress:\s*[^\n]+/, 'cancel-in-progress: ${{ true }}');
    assert.notEqual(
      expressionCancelCollapsed,
      protoCheckWorkflow,
      'the expression-cancel mutation must change the live source',
    );
    assert.match(
      expressionCancelCollapsed,
      /cancel-in-progress:\s*\$\{\{ true \}\}/,
      'the expression-cancel mutation must apply',
    );
    assert.equal(
      cancelsUnconditionallyWithoutNonPrFallback(expressionCancelCollapsed),
      true,
      'PR-number-only plus ${{ true }} must still fail the helper — expression cancel is unconditional unless it is the PR-only form',
    );
  });
});

// Which refs may publish the `latest` container tag is decided entirely by a
// GitHub expression. It is one edited character away from being much wider
// than intended, and a too-wide `latest` overwrites what self-hosters pull
// without leaving a trace. Evaluate the real expressions the way 'live cache
// sweep deployment timing' above does, rather than asserting on their text.
describe('docker-publish conditions', () => {
  // GitHub expressions are close enough to JavaScript to evaluate, with two
  // exceptions: kebab-case context keys parse as subtraction, and the built-in
  // functions do not exist.
  const evaluateExpression = (expression: string, context: Record<string, unknown>) =>
    runInNewContext(
      expression.replace(/\.([A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+)/g, "['$1']"),
      {
        startsWith: (haystack: unknown, needle: unknown) => String(haystack).startsWith(String(needle)),
        contains: (haystack: unknown, needle: unknown) => String(haystack).includes(String(needle)),
        format: (template: string, ...args: unknown[]) =>
          template.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])),
        cancelled: () => false,
        ...context,
      },
      { timeout: 1000 },
    );

  // GitHub runs a job or step whose `if` names no status function only while
  // everything before it succeeded (an implicit `success() &&`), and the
  // evaluator above cannot model that. The conditions that exist to run AFTER a
  // failure are therefore pinned by the function they must keep naming.
  const namesStatusFunction = (expression: unknown) => /\b(?:always|cancelled|failure|success)\(\)/.test(String(expression));

  // The environment a step really receives: its own `env:` block with every
  // `${{ ... }}` evaluated against the given context. A test that writes the
  // environment by hand cannot notice a mapping that is wrong or missing.
  const stepEnvironment = (step: { env?: Record<string, unknown> }, context: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(step.env ?? {}).map(([name, value]) => [
        name,
        String(value).replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression: string) =>
          String(evaluateExpression(expression, context)),
        ),
      ]),
    );

  const dockerPublish = YAML.parse(read(resolve(workflowsDir, 'docker-publish.yml')));
  const tagEnableExpressions = () => {
    const metaStep = dockerPublish.jobs.docker.steps.find(
      (step: { id?: string }) => step.id === 'meta',
    );
    assert.ok(metaStep, 'docker-publish.yml must keep the metadata-action step id `meta`');
    const enables = new Map<string, string>();
    for (const line of String(metaStep.with.tags).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const enable = trimmed.match(/enable=\$\{\{(.+?)\}\}/);
      // Keyed on the whole entry: the two semver patterns differ only after the
      // comma. A tag entry with no `enable=` is unconditional; record it as such
      // so a guard silently deleted from a gated entry fails below.
      enables.set(trimmed, enable ? enable[1] : 'true');
    }
    return enables;
  };

  it('moves `latest` only for a non-prerelease v* tag ref, never from a push, the cron or main', () => {
    const enables = tagEnableExpressions();

    const latest = [...enables.entries()].find(([key]) => key.includes('latest'));
    assert.ok(latest, 'docker-publish.yml must keep a type=raw latest tag entry');

    for (const [event_name, ref, latestExpected] of [
      // A release a person publishes by hand moves `latest`.
      ['release', 'refs/tags/v2.5.23', true],
      // build-desktop.yml publishes with GITHUB_TOKEN, which raises no release
      // event, so it dispatches the build on the tag instead. Gating on the
      // event rather than the ref would leave that build without `latest`.
      ['workflow_dispatch', 'refs/tags/v2.5.23', true],
      // A pre-release must not move what self-hosters pull.
      ['release', 'refs/tags/v2.6.0-rc.1', false],
      ['workflow_dispatch', 'refs/tags/v2.6.0-rc.1', false],
      // Main-side runs publish their sha tag alone. The push trigger fires on
      // every docker-relevant merge, so letting it move `latest` would re-point
      // what self-hosters pull to unreleased code several times an hour.
      ['push', 'refs/heads/main', false],
      ['schedule', 'refs/heads/main', false],
      ['workflow_dispatch', 'refs/heads/main', false],
      // The case that must never regress: a feature branch cannot move `latest`.
      ['workflow_dispatch', 'refs/heads/feature/x', false],
      // A tag not named v<version> is not a release.
      ['workflow_dispatch', 'refs/tags/nightly', false],
    ] as [string, string, boolean][]) {
      assert.equal(
        evaluateExpression(latest[1], { github: { event_name, ref } }),
        latestExpected,
        `latest on ${event_name}/${ref}`,
      );
    }

    // The semver entries need no gate of their own: metadata-action reads them
    // only from a tag ref and returns early otherwise. Everything else that
    // publishes must be gated, so that a stray unconditional `latest` line (or
    // any other tag a push could re-point) fails here. Only the sha entry and
    // the two semver ones may be unconditional.
    assert.deepEqual(
      [...enables.entries()].filter(([, expression]) => expression === 'true').map(([key]) => key).sort(),
      [
        'type=semver,pattern={{major}}.{{minor}}',
        'type=semver,pattern={{version}}',
        'type=sha,prefix=sha-',
      ],
      'every tag entry except the semver and sha ones must be gated',
    );
    assert.equal([...enables.keys()].filter((key) => key.includes('latest')).length, 1, 'exactly one entry may move latest');
    // And the build that pushes must consume those gated tags, not a literal.
    const publishing = (dockerPublish.jobs.docker.steps as { with?: Record<string, unknown> }[]).find(
      (step) => step.with?.push === true,
    );
    assert.equal(publishing?.with?.tags, '${{ steps.meta.outputs.tags }}');
  });

  it('keeps the triggers the ARCHITECTURE row promises', () => {
    const on = dockerPublish.on as { release?: { types?: string[] }; schedule?: { cron: string }[]; workflow_dispatch?: unknown };
    assert.deepEqual(on.release?.types, ['published']);
    assert.deepEqual(on.schedule, [{ cron: '19 2 * * *' }], 'one daily rebuild; a per-minute cron would queue a multi-arch build every minute');
    assert.ok('workflow_dispatch' in on, 'the repair path for a failed rebuild is a manual dispatch');
  });

  it('republishes on a push to main only when the image definition changes', () => {
    // `on.push` rather than a job-level `if:` -- docker-publish.yml publishes
    // no gate-required check, so the "never gate on a workflow's paths:"
    // convention (docs/engineering/solutions/conventions/…) does not apply here.
    const push = (dockerPublish as { on: { push?: { branches?: string[]; paths?: string[]; 'paths-ignore'?: string[] } } }).on.push;
    assert.ok(push, 'docker-publish.yml must trigger on push');
    assert.deepEqual(push.branches, ['main']);
    assert.equal(push['paths-ignore'], undefined);
    // Application changes are built before merge by CI's build
    // job and reach the image through the daily cron; a push rebuild is only
    // for the files nothing else builds.
    assert.deepEqual(push.paths, ['docker/**', '.dockerignore', '.github/workflows/docker-publish.yml']);
    // Every repo file the Dockerfile COPYs by name must sit under a push path,
    // or a change to it waits for the cron.
    const dockerfile = read(resolve(root, 'docker/Dockerfile'));
    const copied = Array.from(dockerfile.matchAll(/^COPY\s+(?!--from)(?:--\S+\s+)*(.+?)\s+\S+$/gm))
      .flatMap((match) => match[1].split(/\s+/))
      .filter((source) => source !== '.');
    assert.ok(copied.length > 0, 'the Dockerfile must still COPY its configs from docker/');
    for (const source of copied) assert.match(source, /^docker\//, `${source} is COPYed into the image but outside docker/**`);
    assert.match(ciWorkflow, /\n {6}- run: npx turbo run build\n/, 'the pre-merge build that covers application changes');
  });

  it('keeps everything that is not main out of the pending slot main rebuilds evict', () => {
    // One pending run per group, and a newer run evicts it. Right for main,
    // where the newest run builds the newest commit; wrong for anything else,
    // whose one shot at publishing (a release's version tags, a feature-branch
    // dispatch testing a Dockerfile change) no other run would take.
    const concurrency = dockerPublish.concurrency as { group: string; 'cancel-in-progress': boolean };
    assert.equal(concurrency['cancel-in-progress'], false, 'cancelling an in-progress push risks a half-published image');
    const group = (event_name: string, ref: string) =>
      evaluateExpression(concurrency.group.replace(/^\$\{\{(.+)\}\}$/s, '$1'), { github: { event_name, ref } });

    const main = group('push', 'refs/heads/main');
    assert.equal(group('schedule', 'refs/heads/main'), main);
    assert.equal(group('workflow_dispatch', 'refs/heads/main'), main);
    const release = group('release', 'refs/tags/v2.10.0');
    assert.notEqual(release, main, 'a release must not share main\'s pending slot');
    assert.equal(group('workflow_dispatch', 'refs/tags/v2.10.0'), release, 'a tag repair dispatch serializes with that tag\'s release');
    assert.notEqual(group('release', 'refs/tags/v2.10.1'), release);
    // Keying on "is this main" rather than "is this a tag" (CodeRabbit,
    // #7808): an earlier version keyed only on `refs/tags/`, so a dispatch
    // against a feature branch -- a supported repair/test path per the tags
    // block above -- still fell into main's group and could evict a pending
    // main rebuild.
    const featureBranch = group('workflow_dispatch', 'refs/heads/some-feature');
    assert.notEqual(featureBranch, main, 'a feature-branch dispatch must not share main\'s pending slot either');
  });

  it('leaves `latest` to the explicit raw entry rather than metadata-action\'s latest=auto', () => {
    const metaStep = dockerPublish.jobs.docker.steps.find((step: { id?: string }) => step.id === 'meta');
    // `latest=auto` is the default and appends `latest` whenever a semver tag
    // resolves, which would put it on any tag ref -- a pre-release included --
    // behind the back of the raw entry above.
    assert.match(String(metaStep.with.flavor ?? ''), /latest=false/);
  });

  it('smoke-tests the image before it is pushed, and caps the unattended job', () => {
    const job = dockerPublish.jobs.docker;
    assert.equal(typeof job['timeout-minutes'], 'number', 'the docker job must cap its own runtime');

    const steps = job.steps as { name?: string; with?: Record<string, unknown> }[];
    const loadIndex = steps.findIndex((step) => step.with?.load === true);
    const pushIndex = steps.findIndex((step) => step.with?.push === true);
    assert.ok(loadIndex >= 0, 'a build with load: true must exist for the smoke test to run the image');
    assert.ok(pushIndex >= 0, 'the publishing build must remain');
    assert.ok(loadIndex < pushIndex, 'the image must be smoke-tested before it is pushed, not after');

    const smoke = steps.slice(loadIndex + 1, pushIndex).map((step) => String((step as { run?: string }).run ?? '')).join('\n');
    assert.match(smoke, /docker run/, 'the smoke step must actually run the image');
    // The requested paths are the gate, so read the loop the way the live cache
    // sweep test reads its probe list: a path quietly dropped from here stops
    // being checked while the step still looks like it verifies the image.
    const pathLoop = smoke.match(/for path in ([^;]+); do/);
    assert.ok(pathLoop, 'the smoke step must enumerate the paths it requests');
    // `/lite` proves nginx rewrote to the SPA entry (lite.html) rather than that a
    // file is non-empty -- the assertion docker/Dockerfile cannot make (`/` only
    // redirects to it).
    assert.deepEqual(pathLoop[1].trim().split(/\s+/), ['/lite']);
    assert.match(smoke, /expected 200/, 'a non-200 must fail the job, not just print');
    // The empty-body guard must be scoped to the loop's `$path`, not hardcoded
    // to `/` alone (#8503 review, CodeRabbit) -- otherwise a 200-with-empty
    // response from a probed route would pass silently while `/` alone stayed
    // covered.
    assert.match(smoke, /returned 200 with an empty body/, 'a 200 with no body must also fail the job');
    const loopBody = smoke.slice(smoke.indexOf('for path in'));
    assert.match(
      loopBody,
      /elif \[ -z "\$\(curl -fsS "http:\/\/127\.0\.0\.1:8080\$\{path\}"\)" \]/,
      'the empty-body check must read $path, not a hardcoded route',
    );

    // Wiring: nothing may skip, soften or redirect the two builds and the gate
    // between them, and the gate must run the very image the first build loaded.
    const smokeStep = steps.slice(loadIndex + 1, pushIndex).find((step) => String((step as { run?: string }).run ?? '').includes('docker run')) as
      { run: string; if?: string; 'continue-on-error'?: unknown } | undefined;
    assert.ok(smokeStep, 'the smoke step must sit between the two builds');
    for (const step of [steps[loadIndex], smokeStep, steps[pushIndex]] as { if?: string; 'continue-on-error'?: unknown }[]) {
      assert.equal(step.if, undefined, 'no condition may skip a gate, or the build it guards');
      assert.equal(step['continue-on-error'], undefined, 'a failed gate must fail the job');
    }
    assert.equal(steps[loadIndex].with?.file, 'docker/Dockerfile');
    assert.equal(steps[pushIndex].with?.file, 'docker/Dockerfile');
    assert.ok(smokeStep.run.includes(String(steps[loadIndex].with?.tags)), 'the gate must run the image the first build loaded');
  });

  it('fails the smoke step, and so the push, when the image does not serve its routes', () => {
    // Execute the real step against fake docker and curl, because the property
    // that matters is its exit status: a green step here is what lets a broken
    // image reach `latest`, and matching the text of the script proves nothing
    // about that. The scenarios are the ones the step exists to catch.
    const steps = dockerPublish.jobs.docker.steps as { run?: string; with?: Record<string, unknown> }[];
    const smoke = steps.find((step) => String(step.run ?? '').includes('docker run'));
    assert.ok(smoke?.run, 'docker-publish.yml must keep the smoke step');

    const workDir = mkdtempSync(resolve(tmpdir(), 'wm-smoke-'));
    try {
      const callLog = resolve(workDir, 'calls');
      const fake = (name: string, body: string) => writeFileSync(resolve(workDir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
      fake('docker', `echo "docker $*" >> "${callLog}"
case "$1" in
  run) echo fake-container-id ;;
  logs) echo "nginx: fake log line" ;;
esac`);
      // sleep is a no-op so the 30-try readiness loop does not take 30 seconds.
      fake('sleep', 'exit 0');
      // curl answers per SCENARIO: -w asks for the status code, -o names a file
      // (nothing is written there), and -f turns a status of 400 or more into 22.
      fake('curl', `url="\${@:$#}"
path="\${url#http://127.0.0.1:8080}"
mode=body; out=stdout; prev=""
for arg in "$@"; do
  [ "$arg" = "-w" ] && mode=code
  [ "$prev" = "-o" ] && out="$arg"
  prev="$arg"
done
[ "$SCENARIO" = "down" ] && exit 7
code=200; body="<html>ok</html>"
[ "$SCENARIO" = "lite-404" ] && [ "$path" = "/lite" ] && { code=404; body="not found"; }
[ "$SCENARIO" = "lite-empty" ] && [ "$path" = "/lite" ] && body=""
if [ "$mode" = code ]; then printf '%s' "$code"; exit 0; fi
if [ "$code" -ge 400 ]; then exit 22; fi
[ "$out" = stdout ] && printf '%s' "$body"
exit 0`);

      const run = (scenario: string) =>
        spawnSync('bash', ['-c', smoke.run as string], {
          env: { PATH: `${workDir}:${process.env.PATH}`, SCENARIO: scenario },
          encoding: 'utf8',
        });

      assert.equal(run('ok').status, 0, 'a healthy image must pass the gate');
      assert.match(readFileSync(callLog, 'utf8'), /docker rm -f/, 'the container must be removed whatever the outcome');
      for (const [scenario, why] of [
        ['lite-404', '/lite answering 404 is the regression docker/Dockerfile cannot see'],
        ['lite-empty', '/lite answering 200 with no body is not a working page'],
        ['down', 'a server that never comes up must not pass'],
      ]) {
        assert.notEqual(run(scenario).status, 0, `${scenario}: ${why}`);
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('alarms when an unattended rebuild of main fails, because nothing else watches it', () => {
    // A separate job, not a same-job `if: failure()` step (CodeRabbit,
    // #7808): the build job's own 45-minute timeout ends it `cancelled`, not
    // `failed`, so `failure()` stays false and a step gated on it inside that
    // same job would never run for exactly the failure mode the timeout
    // exists to guard against. `needs:` plus `always()` observes the result
    // from outside the job, where a timeout is visible too.
    const reportJob = dockerPublish.jobs['report-failure'] as {
      needs?: string;
      if?: string;
      permissions?: Record<string, string>;
      steps: { run?: string }[];
    };
    assert.ok(reportJob, 'a failed unattended rebuild must report somewhere durable');
    assert.equal(reportJob.needs, 'docker');
    // Without a status function GitHub wraps the condition in `success() &&`,
    // which skips this job exactly when the build job failed or timed out.
    assert.match(String(reportJob.if), /\balways\(\)/, 'the alarm job must not be gated on the build job succeeding');
    assert.equal(dockerPublish.jobs.docker.permissions.issues, undefined, 'the build job itself no longer needs to open issues');
    assert.equal(reportJob.permissions?.issues, 'write');

    const fires = (event_name: string, result: string, repository = 'koala73/worldmonitor') =>
      evaluateExpression(String(reportJob.if), {
        always: () => true,
        github: { event_name, repository },
        needs: { docker: { result } },
      });
    // A push run's failure lands after the PR merged, and a cron run's
    // overnight, where nobody is looking.
    for (const event_name of ['push', 'schedule']) {
      assert.equal(fires(event_name, 'failure'), true, `${event_name} + failure must alarm`);
      assert.equal(fires(event_name, 'cancelled'), true, `${event_name} + a timeout (cancelled) must alarm too`);
      assert.equal(fires(event_name, 'success'), false);
    }
    // A release or manual dispatch has a human watching the run.
    assert.equal(fires('workflow_dispatch', 'failure'), false);
    assert.equal(fires('release', 'failure'), false);
    // A fork's own cron never runs here (the build job is skipped for it too),
    // so the alarm must not open issues in a fork either.
    assert.equal(fires('schedule', 'failure', 'someone/worldmonitor'), false);

    const alarm = reportJob.steps.find((step) => String(step.run ?? '').includes('gh issue create'));
    assert.ok(alarm, 'the report job must keep its issue-filing step');
    assert.match(String(alarm.run), /gh issue create/);
    assert.match(String(alarm.run), /gh issue comment/, 'a repeat failure must not open a duplicate issue');
  });

  it('gives the failure report the repository gh needs, because that job has no checkout', () => {
    // The report job has no checkout, so gh has no git remote to read the
    // repository from and stops at "not a git repository" unless GH_REPO (or
    // --repo) names it. The step used to sit in the build job, whose checkout
    // hid that, and the regex assertions above never run it. Execute the real
    // step against a fake gh that fails the way gh does without a repository.
    const reportJob = dockerPublish.jobs['report-failure'] as {
      steps: { run?: string; env?: Record<string, string> }[];
    };
    const report = reportJob.steps.find((step) => String(step.run ?? '').includes('gh issue create'));
    assert.ok(report?.run && report.env, 'the report job must keep its issue-filing step');
    assert.ok(
      !reportJob.steps.some((step) => String((step as { uses?: string }).uses ?? '').startsWith('actions/checkout')),
      'the report job is meant to stay checkout-free; if that changes, this test and GH_REPO can go',
    );

    const env = stepEnvironment(report, {
      github: {
        repository: 'koala73/worldmonitor',
        server_url: 'https://github.com',
        run_id: '123456',
        token: 'token',
      },
    });

    const workDir = mkdtempSync(resolve(tmpdir(), 'wm-report-'));
    try {
      const callLog = resolve(workDir, 'calls');
      writeFileSync(
        resolve(workDir, 'gh'),
        `#!/bin/bash
echo "$*" >> "${callLog}"
if [ -z "\${GH_REPO:-}" ] && [[ "$*" != *--repo* ]]; then
  echo "fatal: not a git repository (or any of the parent directories): .git" >&2
  exit 1
fi
if [ "$1 $2" = "issue list" ]; then printf '%s' "\${FAKE_EXISTING_ISSUE:-}"; fi
`,
        { mode: 0o755 },
      );
      const runReport = (existingIssue: string) => {
        writeFileSync(callLog, '');
        execFileSync('bash', ['-c', report.run as string], {
          cwd: workDir,
          env: {
            ...env,
            PATH: `${workDir}:${process.env.PATH}`,
            GITHUB_EVENT_NAME: 'push',
            GITHUB_SHA: 'abc1234',
            FAKE_EXISTING_ISSUE: existingIssue,
          },
          stdio: 'pipe',
        });
        return readFileSync(callLog, 'utf8');
      };

      const first = runReport('');
      assert.match(first, /^issue create --title Docker rebuild of main failed --body /m, 'the first failure opens the tracking issue');
      assert.doesNotMatch(first, /issue comment/);
      const repeat = runReport('42');
      assert.match(repeat, /^issue comment 42 --body /m, 'a repeat failure comments on the open issue');
      assert.doesNotMatch(repeat, /issue create/, 'a repeat failure must not open a duplicate');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe('scheduled workflows run only in the upstream repository', () => {
  // A public repo's forks inherit every cron. Forks that enable Actions then
  // probe production on our schedule: one day of MCP smoke traffic came from
  // ~1,600 runner IPs against ~17 upstream runs. Push, PR and manual runs in
  // forks stay allowed; only the fork's own schedule is skipped.
  const FORK_GUARD = "github.event_name != 'schedule' || github.repository == 'koala73/worldmonitor'";

  it('every job in a scheduled workflow carries the fork guard', () => {
    const missing: string[] = [];
    for (const name of readdirSync(workflowsDir).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))) {
      const workflow = YAML.parse(read(resolve(workflowsDir, name)));
      const on = workflow.on ?? workflow[true as unknown as string];
      if (!on || typeof on !== 'object' || !('schedule' in on)) continue;
      for (const [jobId, job] of Object.entries(workflow.jobs as Record<string, { if?: unknown }>)) {
        if (!String(job.if ?? '').includes(FORK_GUARD)) missing.push(`${name}#${jobId}`);
      }
    }
    assert.deepEqual(missing, [], `add \`(${FORK_GUARD})\` to the job-level if of: ${missing.join(', ')}`);
  });

  it('skips only a fork\'s own scheduled run', () => {
    const cases: Array<[string, string, boolean]> = [
      ['schedule', 'koala73/worldmonitor', true],
      ['schedule', 'someone/worldmonitor', false],
      ['push', 'someone/worldmonitor', true],
      ['pull_request', 'someone/worldmonitor', true],
      ['workflow_dispatch', 'someone/worldmonitor', true],
    ];
    for (const [event_name, repository, expected] of cases) {
      assert.equal(runInNewContext(FORK_GUARD, { github: { event_name, repository } }), expected, `${event_name} in ${repository}`);
    }
  });
});
