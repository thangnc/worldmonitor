#!/usr/bin/env node
// Writes the engineering knowledge-base indexes from record frontmatter:
//   docs/engineering/solutions/INDEX.md  lessons grouped by area
//   docs/engineering/plans/INDEX.md      plans grouped by status
//
//   node scripts/generate-engineering-index.mjs          # rewrite
//   node scripts/generate-engineering-index.mjs --check  # exit 1 when stale
//
// npm run generate runs it through scripts/generate-derived.mjs. The schema
// lives in scripts/lib/engineering-docs.mjs; tests/engineering-docs.test.mjs
// enforces it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANS_INDEX, SOLUTIONS_INDEX, renderPlansIndex, renderSolutionsIndex } from './lib/engineering-docs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function engineeringIndexes(root = ROOT) {
  return [
    [SOLUTIONS_INDEX, renderSolutionsIndex(root)],
    [PLANS_INDEX, renderPlansIndex(root)],
  ];
}

function main() {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [path, content] of engineeringIndexes()) {
    const full = join(ROOT, path);
    const current = existsSync(full) ? readFileSync(full, 'utf8') : '';
    if (current === content) continue;
    stale.push(path);
    if (!check) writeFileSync(full, content);
  }
  if (check && stale.length) {
    console.error(`engineering index stale: ${stale.join(', ')}. Run \`npm run generate\`.`);
    return 1;
  }
  console.log(stale.length ? `engineering index: wrote ${stale.join(', ')}` : 'engineering index: current');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
