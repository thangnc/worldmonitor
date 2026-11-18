#!/usr/bin/env node
// Regenerates every committed derived file (product facts, docs stats, llms,
// AI search, catalogs, locales, legal digests, …) whose freshness check
// fails. Stale derived files were over half of CI test failures, and fixing
// one meant finding which of these generators the failing test wanted.
//
//   npm run generate          # rewrite whatever is stale
//   npm run generate:check    # exit 1 and list the stale steps
//
// Each step runs its own --check first and writes only when that fails, so
// generators that stamp today's date or rebuild PDFs do not churn files that
// are already current. Generators read each other's outputs, so passes repeat
// until every check is green.
//
// Not covered: `make generate` (proto + OpenAPI; the pre-push hook runs it)
// and app translations (scripts/translate-locales.mjs needs ANTHROPIC_API_KEY).
// Frozen until 1c, because their generators read the deleted crawlable corpus:
// api/_country-corpus-slugs.generated.js (its one reader, api/story.js, goes in
// 1c) and the resilience coverage counts in the public docs.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const TSX = [NODE, '--import', 'tsx'];
const MAX_PASSES = 3;

// [name, command, write flag]. Every command also accepts --check.
export const STEPS = [
  ['browser news catalog', [...TSX, 'scripts/generate-browser-news-catalog.mjs']],
  ['entitlement crosswalk', [NODE, 'scripts/generate-entitlement-crosswalk.mjs']],
  ['agent skills index', [NODE, 'scripts/build-agent-skills-index.mjs']],
  ['engineering index', [NODE, 'scripts/generate-engineering-index.mjs']],
  ['source attribution', [NODE, 'scripts/source-attribution.mjs'], '--write'],
  ['bootstrap tier keys', [NODE, 'scripts/sync-bootstrap-tier-keys.mjs']],
  ['live video channels', [...TSX, 'scripts/sync-live-video-refresh-channels.mjs']],
  ['sandbox fixtures', [NODE, 'scripts/generate-sandbox-fixtures.mjs']],
  ['scorecard edge mirrors', [NODE, 'scripts/generate-scorecard-edge-mirrors.mjs']],
  ['Sentry Convex probe filters', [NODE, 'scripts/sync-sentry-convex-probe-filters.mjs'], '--write'],
  ['legal digests', [NODE, 'scripts/legal-digests.mjs']],
  ['legal PDFs', [NODE, 'scripts/build-legal-pdfs.mjs']],
  ['story phase fading study', [NODE, 'scripts/study-story-phase-fading.mjs']],
];

function run([cmd, ...args], flag) {
  const result = spawnSync(cmd, flag ? [...args, flag] : args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`.trim() };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  // The product config has no --check; it is cheap and deterministic, so the
  // write mode always runs it.
  if (!checkOnly) {
    const config = run([...TSX, 'scripts/generate-product-config.mjs']);
    if (!config.ok) {
      console.error(`generate: product config failed:\n${config.output}`);
      return 1;
    }
  }
  const steps = STEPS;

  const regenerated = new Set();
  for (let pass = 0; ; pass++) {
    // Inventory facts are gitignored, read by later steps, and derived from the
    // product facts, so every pass refreshes them before checking.
    const inventory = run([NODE, 'scripts/generate-inventory-facts.mjs']);
    if (!inventory.ok) {
      console.error(`generate: inventory facts failed:\n${inventory.output}`);
      return 1;
    }
    const stale = [];
    for (const [name, command, writeFlag] of steps) {
      const { ok, output } = run(command, '--check');
      if (!ok) stale.push([name, command, writeFlag, output]);
    }
    if (stale.length === 0) {
      console.log(regenerated.size ? `generate: regenerated ${[...regenerated].join(', ')}` : 'generate: all derived files are current');
      return 0;
    }
    if (checkOnly) {
      for (const [name, , , output] of stale) console.error(`generate: ${name} is stale:\n${output}\n`);
      console.error('Run `npm run generate` and commit the result.');
      return 1;
    }
    if (pass === MAX_PASSES) {
      console.error(`generate: still stale after ${MAX_PASSES} passes: ${stale.map(([name]) => name).join(', ')}`);
      return 1;
    }
    for (const [name, command, writeFlag] of stale) {
      const result = run(command, writeFlag);
      if (!result.ok) {
        console.error(`generate: ${name} failed:\n${result.output}`);
        return 1;
      }
      regenerated.add(name);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
