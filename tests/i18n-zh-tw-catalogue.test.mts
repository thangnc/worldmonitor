// C2 from #6555.
//
// `ENGLISH_CEILING` measures English-identical strings, so a wholesale
// Simplified regression in `zh-TW.json` passes every existing gate. These two
// assertions close that, and the second also closes the section-A phrasing gap.
//
// WHY NOT THE ROUND TRIP AS SPECIFIED. The issue (and my own comment on it)
// proposed flagging any value where `s2t(value) !== value`. Measured, that is
// not usable in either direction:
//
//   * False positives. Feeding already-Traditional text to a Simplified→
//     Traditional converter is not idempotent — OpenCC applies its orthodox
//     variant preferences. Over the committed catalogues it rewrites 表→錶,
//     干→幹, 峰→峯, 群→羣, 核→覈, 床→牀, 才→纔 and flags 61 correct values
//     (47 with `to: 'tw'`). 儀表板 and GPS干擾 are not Simplified residue.
//   * False negatives. `s2t('許可權') === '許可權'`. Every section-A term is
//     spelled in Traditional characters — they are Mainland *vocabulary*, not
//     Simplified script — so no character-level converter can see them.
//
// So the converter is applied to the Simplified SOURCE, which is what it is for
// and where it is well-defined, and vocabulary is checked separately against the
// decisions already recorded in the generator.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import * as OpenCC from 'opencc-js';
import { GENERATED_LOCALES, LOCALES, TRANSLATABLE_LOCALES } from '../scripts/translate-locales.mjs';

const repoPath = (rel: string): string => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const s2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });

const CATALOGUES = [
  { name: 'pro-test', simplified: 'pro-test/src/locales/zh.json', traditional: 'pro-test/src/locales/zh-TW.json' },
];

/**
 * Every test this file is supposed to register, written out.
 *
 * Most of the tests below are registered from data — one per entry in
 * CATALOGUES, one per catalogue named in EXPECTED_KEY_RULES — and a loop over
 * an empty list registers nothing at all. That is not a red build: a runner
 * reports the tests it was given, so emptying CATALOGUES deletes both copies of
 * `no value is left in Simplified` and the suite passes with fewer tests than
 * it had. `--check` does not cover the gap either, because it regenerates from
 * the same tables these tests are auditing.
 *
 * So registration goes through `test()` below, which records the name, and the
 * census at the bottom compares what was recorded against this list. Removing a
 * test is then an edit in two places rather than a deletion that leaves no
 * trace. What it cannot defend is its own deletion, or the file's — nothing
 * inside a file can.
 */
const EXPECTED_TESTS = [
  'pro-test: no value is left in Simplified',
  'catches a Simplified value planted in the Traditional catalogue',
  'pro-test: carries none of the rejected terms',
  'every per-entry source term has a decided allow-list',
  'pro-test: every per-entry override is applied',
  'keeps generated locales inside LOCALES',
  'runs the unit job at all when a catalogue input changes',
  'requires the unit job before deploying',
];

const registered: string[] = [];

/** `it`, plus the census entry that makes its absence visible. */
const test = (name: string, fn: () => void): void => {
  registered.push(name);
  it(name, fn);
};

/**
 * The rejected terms, written out here. The sweep below runs off this literal,
 * so a term coming back into a Traditional catalogue fails the suite.
 */
const EXPECTED_BANNED = [
  '實時',
  '攝像頭',
  '賬戶',
  '自定義',
  '小部件',
  '小元件',
  '許可權',
  '高階',
  '訪問',
  '曆史',
  '髮生',
  '隻基金',
  '列錶',
];

/** Flatten to dotted paths, descending into arrays — the plan-feature bullets live there. */
function flatten(node: unknown, path = '', out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(node)) {
    node.forEach((value, index) => flatten(value, `${path}[${index}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, path ? `${path}.${key}` : key, out);
    }
  } else if (typeof node === 'string') {
    out.set(path, node);
  }
  return out;
}

const load = (rel: string): Map<string, string> =>
  flatten(JSON.parse(readFileSync(repoPath(rel), 'utf8')));

interface KeyRule {
  catalogue: string;
  path: string;
  from: string;
  to: string;
}

/** The per-entry rules, written out for the same reason as EXPECTED_BANNED. */
const EXPECTED_KEY_RULES: KeyRule[] = [
  { catalogue: 'src', path: 'popups.techEvent.days.inDays', from: '天后', to: '天後' },
  { catalogue: 'pro-test', path: 'faq.q5', from: '這隻', to: '這只' },
];

/**
 * Dotted paths where a KEY_OVERRIDES source term is the right answer rather than
 * residue, per term. 天后 is a deity and a diva, 這隻 is correct before an
 * animal — that ambiguity is why those rules are per-entry rather than global.
 *
 * The lists are nonetheless empty, because neither sense occurs in either
 * catalogue: the terms are banned everywhere until one does. Scoping the guard
 * to the three entries the rules name instead leaves every other entry open —
 * a new key holding "3天后" converts to 天后 and the suite stays green — and
 * scoping it to the sense the entry has is not something a substring can do.
 * A future entry that legitimately needs one of these adds its path here.
 */
const KEY_OVERRIDE_ALLOWED_PATHS = new Map<string, readonly string[]>([
  ['天后', []],
  ['這隻', []],
]);

describe('zh-TW catalogues — Simplified script drift', () => {
  // The guard is only meaningful over values whose Simplified source actually
  // changes under conversion. Values that are identical in both scripts (地震,
  // 港口, 首都) legitimately match and are skipped rather than whitelisted.
  for (const catalogue of CATALOGUES) {
    test(`${catalogue.name}: no value is left in Simplified`, () => {
      const simplified = load(catalogue.simplified);
      const traditional = load(catalogue.traditional);

      const mustDiffer: string[] = [];
      const unconverted: string[] = [];

      for (const [key, source] of simplified) {
        const target = traditional.get(key);
        if (target === undefined) continue;
        if (s2tw(source) === source) continue;
        mustDiffer.push(key);
        if (target === source) unconverted.push(key);
      }

      // Without this the assertion below would pass vacuously if the catalogues
      // ever failed to load or the key paths stopped lining up.
      assert.ok(
        mustDiffer.length > 400,
        `expected hundreds of script-sensitive values, found ${mustDiffer.length}`,
      );
      assert.deepEqual(
        unconverted,
        [],
        `${unconverted.length} value(s) still carry the Simplified source verbatim`,
      );
    });
  }

  test('catches a Simplified value planted in the Traditional catalogue', () => {
    // Proves the rule above has teeth, without mutating a committed file.
    const planted = '实时更新已就绪';
    assert.notEqual(s2tw(planted), planted, 'fixture must be script-sensitive');
  });
});

describe('zh-TW catalogues — settled vocabulary', () => {
  for (const catalogue of CATALOGUES) {
    test(`${catalogue.name}: carries none of the rejected terms`, () => {
      const traditional = load(catalogue.traditional);
      const hits: string[] = [];

      for (const [key, value] of traditional) {
        for (const term of EXPECTED_BANNED) {
          if (value.includes(term)) hits.push(`${key}: ${term}`);
        }
        for (const [term, allowedPaths] of KEY_OVERRIDE_ALLOWED_PATHS) {
          if (value.includes(term) && !allowedPaths.includes(key)) hits.push(`${key}: ${term}`);
        }
      }

      assert.deepEqual(hits, [], `rejected terms found in ${catalogue.traditional}`);
    });
  }
});

describe('zh-TW catalogues — per-entry overrides', () => {
  test('every per-entry source term has a decided allow-list', () => {
    // Without this a rule could be added to both tables above and still reach
    // no catalogue-wide ban, which is the gap the per-entry checks leave open.
    assert.deepEqual(
      [...KEY_OVERRIDE_ALLOWED_PATHS.keys()].sort(),
      [...new Set(EXPECTED_KEY_RULES.map((rule) => rule.from))].sort(),
      'each per-entry source term needs an entry in KEY_OVERRIDE_ALLOWED_PATHS, empty if no path is exempt',
    );
  });

  for (const catalogue of CATALOGUES) {
    // Scoped off the literal, not the parse, so a parser that finds nothing
    // registers a failing test rather than no test.
    const scoped = EXPECTED_KEY_RULES.filter((rule) => rule.catalogue === catalogue.name);

    test(`${catalogue.name}: every per-entry override is applied`, () => {
      // Registered whether or not there are rules to check. Skipping
      // registration on an empty list is how the last rule for a catalogue
      // stops being enforced without anything going red, and an empty loop
      // below would report no failures for the same reason.
      assert.ok(
        scoped.length > 0,
        `no per-entry rule is declared for ${catalogue.name}; if that is intended, drop it from EXPECTED_TESTS too`,
      );

      const traditional = load(catalogue.traditional);
      const failures: string[] = [];

      for (const rule of scoped) {
        const value = traditional.get(rule.path);
        // A rule whose entry no longer exists is a rule nobody is enforcing.
        if (value === undefined) {
          failures.push(`${rule.path}: entry is gone, so "${rule.from}" is unguarded`);
          continue;
        }
        if (value.includes(rule.from)) failures.push(`${rule.path}: still carries "${rule.from}"`);
        // Checked positively too: absence of the source term is also what a
        // rewritten or deleted string looks like.
        if (!value.includes(rule.to)) failures.push(`${rule.path}: missing "${rule.to}"`);
      }

      assert.deepEqual(failures, [], `per-entry overrides missing from ${catalogue.traditional}`);
    });
  }
});

// A generated catalogue is not translated from en.json, so the EN baseline in
// translate-locales.mjs cannot say whether it is current. These assertions keep
// the generated locales registered and keep the checks above blocking in CI.
describe('zh-TW catalogues — CI gate', () => {
  interface WorkflowStep {
    id?: string;
    name?: string;
    run?: string;
    if?: string;
    'continue-on-error'?: unknown;
  }
  interface WorkflowJob {
    if?: string;
    'continue-on-error'?: unknown;
    steps?: WorkflowStep[];
  }

  const workflow = loadYaml(readFileSync(repoPath('.github/workflows/test.yml'), 'utf8')) as {
    jobs: Record<string, WorkflowJob | undefined>;
  };
  const unit = workflow.jobs['unit-built-output'];
  const stepsOf = (job: WorkflowJob | undefined): WorkflowStep[] => job?.steps ?? [];

  test('keeps generated locales inside LOCALES', () => {
    assert.ok(GENERATED_LOCALES.size > 0, 'GENERATED_LOCALES is empty, so nothing below is checking anything');
    for (const locale of GENERATED_LOCALES) {
      // Dropping it from LOCALES would also drop it from the freshness gate and
      // the end-of-run scan, which is what `tracks every shipped locale` in
      // tests/pro-locale-freshness.test.mjs already refuses.
      assert.ok(LOCALES.includes(locale), `${locale} must stay in LOCALES; only the write path excludes it`);
      assert.ok(!TRANSLATABLE_LOCALES.includes(locale), `${locale} must not be in TRANSLATABLE_LOCALES`);
    }
  });

  test('runs the unit job at all when a catalogue input changes', () => {
    // The third leg, and the one presence-plus-gate-membership misses entirely.
    // deploy-gate.yml reads a skipped required job as passing (docs-only PRs
    // skip the code checks by design), so `unit` being required is worth
    // exactly what the condition on `unit` is worth: if a PR touching the
    // catalogues sets code=false, the job skips, the gate counts a pass, and
    // the staleness check never ran.
    assert.ok(unit, 'no unit job in .github/workflows/test.yml');
    assert.equal(
      unit.if,
      "needs.changes.outputs.code == 'true'",
      'the unit job runs on a different condition now, and the filter read below is no longer the one that decides',
    );

    const diff = stepsOf(workflow.jobs.changes).find((step) => step.id === 'diff');
    assert.ok(diff?.run, 'could not find the diff step of the changes job');
    const program = diff.run.match(/CODE=\$\(printf '%s\\n' "\$FILES" \| awk '([\s\S]*?)'\)/);
    assert.ok(program, 'could not read the CODE filter out of the changes job');
    const body = program[1]!;

    // The filter is an exclusion list: an unmatched path falls through to a
    // bare `{ count++ }` and sets code=true. Everything below reasons from
    // that, so it is asserted rather than assumed.
    assert.match(
      body,
      /^\s*\{ count\+\+ \}\s*$/m,
      'the CODE filter no longer counts unmatched paths, so it is not an exclusion list and this test cannot read it',
    );

    // Only rules whose whole action is `next` exclude; `{ count++; next }` is a
    // carve-back that counts. A compound rule contributes its leading pattern
    // only, which matches a superset of what awk excludes — proving a path is
    // outside the superset proves it is outside the real exclusion set.
    const exclusions = body
      .split(/\r?\n/)
      .filter((line) => /\{\s*next\s*\}\s*$/.test(line))
      .map((line) => line.match(/\/((?:[^/\\]|\\.)+)\//))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => new RegExp(match[1]!));

    assert.ok(exclusions.length >= 5, `parsed ${exclusions.length} exclusion rule(s), so the parse is broken`);
    assert.ok(
      exclusions.some((pattern) => pattern.test('README.md')),
      'the parsed rules exclude nothing at all, so the assertion below would pass on any input',
    );

    // The catalogues and this suite. A PR that only touches
    // these has to reach the unit job.
    const inputs = [
      'pro-test/src/locales/zh.json',
      'pro-test/src/locales/zh-TW.json',
      'tests/i18n-zh-tw-catalogue.test.mts',
    ];
    assert.deepEqual(
      inputs.filter((path) => exclusions.some((pattern) => pattern.test(path))),
      [],
      'a PR touching only these paths sets code=false, so unit skips and the deploy gate counts the skip as a pass',
    );
  });

  test('requires the unit job before deploying', () => {
    const gate = readFileSync(repoPath('.github/scripts/deploy-gate.sh'), 'utf8');
    const required = gate.match(/required='(\[[^']*\])'/);
    assert.ok(required, 'could not read the required-job list from deploy-gate.sh');
    assert.ok(
      (JSON.parse(required[1]!) as string[]).includes('unit'),
      'the unit job is no longer gate-required, so the catalogue check stopped blocking merges',
    );
  });
});

describe('zh-TW catalogues — the tests above are all still here', () => {
  it('registers every test it is supposed to', () => {
    // Runs after the whole file has been evaluated, so `registered` is complete
    // by now regardless of where this sits.
    assert.deepEqual(
      [...registered].sort(),
      [...EXPECTED_TESTS].sort(),
      'the set of registered tests changed — a data-driven loop registered nothing, or a test was added or removed without updating EXPECTED_TESTS',
    );
  });
});
