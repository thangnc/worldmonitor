// Enforces the engineering knowledge-base contract (docs/engineering/README.md):
// lesson and plan frontmatter follow scripts/lib/engineering-docs.mjs, the
// generated indexes are current, links inside the tree resolve, the harness
// only names engineering paths that exist, and nothing lands back in the old
// documentation roots.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ENGINEERING_DIR,
  PROBLEM_TYPES,
  listLooseSolutions,
  listPlans,
  listSolutionCategories,
  listSolutions,
  readRecord,
  validatePlan,
  validateSolution,
} from '../scripts/lib/engineering-docs.mjs';
import { engineeringIndexes } from '../scripts/generate-engineering-index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = (...pathspecs) => execFileSync('git', ['ls-files', '--', ...pathspecs], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
const failures = (paths, validate) => paths.flatMap((path) => validate(ROOT, readRecord(ROOT, path)).map((p) => `${path}: ${p}`));

describe('engineering knowledge base', () => {
  it('files every lesson under a known category directory', () => {
    assert.deepEqual(listLooseSolutions(ROOT), [], 'lessons belong in docs/engineering/solutions/<category>/');
    const unknown = listSolutionCategories(ROOT).filter((category) => !(category in PROBLEM_TYPES));
    assert.deepEqual(unknown, [], 'add a new category to PROBLEM_TYPES in scripts/lib/engineering-docs.mjs');
    assert.ok(listSolutions(ROOT).length > 100, 'the lesson scan found the solutions tree');
  });

  it('keeps every lesson on the frontmatter schema', () => {
    assert.deepEqual(failures(listSolutions(ROOT), validateSolution), []);
  });

  it('keeps every plan on the frontmatter schema', () => {
    assert.ok(listPlans(ROOT).length > 5, 'the plan scan found the plans tree');
    assert.deepEqual(failures(listPlans(ROOT), validatePlan), []);
  });

  it('rejects the schema violations it claims to catch', () => {
    const lesson = (frontmatter) => ({ path: `${ENGINEERING_DIR}/solutions/logic-errors/x.md`, frontmatter, error: null });
    const valid = { title: 'A lesson', date: '2026-11-07', area: 'seeders', problem_type: 'logic_error', tags: ['retry'] };
    assert.deepEqual(validateSolution(ROOT, lesson(valid)), []);
    const cases = [
      [{ ...valid, area: 'backend' }, /unknown area backend/],
      [{ ...valid, problem_type: 'ui_bug' }, /does not match directory logic-errors/],
      [{ ...valid, tags: [] }, /tags must be a non-empty list/],
      [{ ...valid, tags: ['Not Kebab'] }, /not kebab-case/],
      [{ ...valid, date: '7 Nov 2026' }, /YYYY-MM-DD/],
      [{ ...valid, component: 'background_job' }, /unknown key component/],
      [{ ...valid, status: 'superseded' }, /needs superseded_by/],
      [{ ...valid, status: 'superseded', superseded_by: 'docs/engineering/solutions/missing.md' }, /does not exist/],
      [(({ title, ...rest }) => rest)(valid), /missing title/],
    ];
    for (const [frontmatter, expected] of cases) {
      assert.ok(validateSolution(ROOT, lesson(frontmatter)).some((p) => expected.test(p)), `expected ${expected}`);
    }
    const plan = { path: `${ENGINEERING_DIR}/plans/x.md`, frontmatter: { title: 'P', date: '2026-11-07', status: 'shipped' }, error: null };
    assert.ok(validatePlan(ROOT, plan).some((p) => /unknown status shipped/.test(p)));
  });

  it('keeps the generated indexes current', () => {
    for (const [path, content] of engineeringIndexes(ROOT)) {
      assert.equal(readFileSync(resolve(ROOT, path), 'utf8'), content, `${path} is stale: run npm run generate`);
    }
  });

  it('resolves every relative Markdown link outside the archive', () => {
    const LINK = /\]\((?!https?:|mailto:|#|\/|<)([^)\s]+)\)/g;
    const broken = [];
    for (const path of tracked(`${ENGINEERING_DIR}/*.md`).filter((p) => !p.startsWith(`${ENGINEERING_DIR}/archive/`))) {
      const text = readFileSync(resolve(ROOT, path), 'utf8').replace(/```[\s\S]*?```/g, '');
      for (const [, target] of text.matchAll(LINK)) {
        const file = decodeURI(target.split(/[#?]/)[0]);
        if (file && !existsSync(resolve(ROOT, posix.join(posix.dirname(path), file)))) broken.push(`${path}: ${target}`);
      }
    }
    assert.deepEqual(broken, []);
  });

  it('names only engineering paths that exist from CLAUDE.md, rules and skills', () => {
    const guides = ['CLAUDE.md', ...tracked('.claude/rules/*.md', '.claude/skills/*.md', '.claude/agents/*.md')];
    const missing = [];
    for (const guide of guides) {
      for (const [path] of readFileSync(resolve(ROOT, guide), 'utf8').matchAll(/docs\/engineering\/[\w./-]*[\w/]/g)) {
        if (!existsSync(resolve(ROOT, path))) missing.push(`${guide}: ${path}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('keeps tracked records out of the old documentation roots', () => {
    // Planning tools default to these paths; docs/engineering/ is canonical.
    const OLD_ROOTS = ['solutions', 'architecture', 'operations', 'plans', 'brainstorms', 'internal', 'Docs_To_Review',
      'archive', 'audits', 'perf', 'investigations', 'validation', 'reports', 'analytics', 'security',
      'residual-review-findings', 'content', 'implementation', 'decisions', 'evidence', 'dev-artifacts'];
    assert.deepEqual(tracked(...OLD_ROOTS.map((dir) => `docs/${dir}/`)), []);
  });
});
