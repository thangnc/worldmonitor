// Schema, parser and index renderers for the engineering knowledge base
// (docs/engineering/). scripts/generate-engineering-index.mjs writes the
// indexes; tests/engineering-docs.test.mjs enforces the schema. The schema is
// documented for authors in docs/engineering/solutions/README.md and
// docs/engineering/plans/README.md: change those with this file.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';

export const ENGINEERING_DIR = 'docs/engineering';
export const SOLUTIONS_DIR = `${ENGINEERING_DIR}/solutions`;
export const PLANS_DIR = `${ENGINEERING_DIR}/plans`;
export const SOLUTIONS_INDEX = `${SOLUTIONS_DIR}/INDEX.md`;
export const PLANS_INDEX = `${PLANS_DIR}/INDEX.md`;
const NON_RECORDS = new Set(['README.md', 'INDEX.md']);

// Where a lesson's fix lives. Order is the order of the index sections.
export const AREAS = {
  'edge-api': 'Vercel Edge routes, server handlers, gateway, middleware, Redis reads, auth sessions',
  mcp: 'MCP server, OAuth, tool registry, agent-facing surfaces',
  seeders: 'Railway seeders, relays, upstream sources, cron and Redis writes',
  intelligence: 'Briefs, digests, LLM prompts and grounding, scoring, forecasts, classifiers',
  browser: 'Dashboard SPA: panels, map, styles, boot, i18n, client services',
  lite: 'World Monitor Lite profile and the /lite UI',
  proto: 'Proto contracts, sebuf codegen, OpenAPI',
  convex: 'Convex functions, auth, user state',
  payments: 'Checkout, billing, entitlements, Pro activation, product catalog',
  desktop: 'Tauri desktop app and Node sidecar',
  observability: 'Sentry, health grading, analytics, telemetry',
  ci: 'GitHub Actions, git hooks, deploy gates, Railway and Vercel operations',
  tests: 'Test harnesses, fixtures, goldens, test doubles',
  tooling: 'Dependencies, builds, bundling, lint',
  docs: 'Documentation, derived files, source attribution, claim gates',
  'public-site': 'Pro site, blog, crawlable corpus, SEO and agent discovery',
};

// Category directory → problem_type value.
export const PROBLEM_TYPES = {
  'architecture-patterns': 'architecture_pattern',
  'best-practices': 'best_practice',
  'build-errors': 'build_error',
  conventions: 'convention',
  'database-issues': 'database_issue',
  'design-patterns': 'design_pattern',
  'integration-issues': 'integration_issue',
  'logic-errors': 'logic_error',
  'performance-issues': 'performance_issue',
  reliability: 'reliability_issue',
  'runtime-errors': 'runtime_error',
  'security-issues': 'security_issue',
  'test-failures': 'test_failure',
  'tooling-decisions': 'tooling_decision',
  'ui-bugs': 'ui_bug',
  'workflow-issues': 'workflow_issue',
};

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const SOLUTION_STATUSES = ['active', 'superseded'];
export const SOLUTION_REQUIRED = ['title', 'date', 'area', 'problem_type', 'tags'];
export const SOLUTION_OPTIONAL = ['severity', 'module', 'symptoms', 'root_cause', 'resolution_type', 'applies_when',
  'related', 'issue', 'status', 'superseded_by', 'last_updated'];

export const PLAN_STATUSES = ['active', 'done', 'abandoned', 'superseded'];
export const PLAN_REQUIRED = ['title', 'date', 'status'];
export const PLAN_OPTIONAL = ['type', 'origin', 'topic', 'evidence', 'superseded_by', 'artifact_contract',
  'artifact_readiness', 'execution', 'product_contract_source'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function readRecord(root, path) {
  const text = readFileSync(join(root, path), 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { path, frontmatter: null, error: 'missing YAML frontmatter' };
  try {
    return { path, frontmatter: YAML.parse(match[1]) ?? {}, error: null };
  } catch (error) {
    return { path, frontmatter: null, error: `invalid YAML: ${error.message.split('\n')[0]}` };
  }
}

function listMarkdown(root, dir) {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !NON_RECORDS.has(entry.name))
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}

export function listSolutionCategories(root) {
  return readdirSync(join(root, SOLUTIONS_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function listSolutions(root) {
  return listSolutionCategories(root).flatMap((category) => listMarkdown(root, `${SOLUTIONS_DIR}/${category}`));
}

export function listLooseSolutions(root) {
  return listMarkdown(root, SOLUTIONS_DIR);
}

export function listPlans(root) {
  return [...listMarkdown(root, PLANS_DIR), ...listMarkdown(root, `${PLANS_DIR}/requirements`)];
}

function checkKeys(frontmatter, required, optional) {
  const problems = [];
  for (const key of required) {
    if (frontmatter[key] === undefined || frontmatter[key] === null || frontmatter[key] === '') problems.push(`missing ${key}`);
  }
  for (const key of Object.keys(frontmatter)) {
    if (!required.includes(key) && !optional.includes(key)) problems.push(`unknown key ${key}`);
  }
  return problems;
}

function checkSupersededBy(root, record, status) {
  const target = record.frontmatter.superseded_by;
  if (status === 'superseded' && !target) return ['status superseded needs superseded_by'];
  if (target && status !== 'superseded') return ['superseded_by is set but status is not superseded'];
  if (target && !existsSync(join(root, String(target)))) return [`superseded_by does not exist: ${target}`];
  return [];
}

export function validateSolution(root, record) {
  if (record.error) return [record.error];
  const fm = record.frontmatter;
  const problems = checkKeys(fm, SOLUTION_REQUIRED, SOLUTION_OPTIONAL);
  const category = record.path.split('/').at(-2);
  if (fm.title !== undefined && typeof fm.title !== 'string') problems.push('title must be a string');
  if (fm.date !== undefined && !DATE.test(String(fm.date))) problems.push(`date must be YYYY-MM-DD, got ${fm.date}`);
  if (fm.area !== undefined && !(fm.area in AREAS)) problems.push(`unknown area ${fm.area}`);
  if (fm.problem_type !== undefined && fm.problem_type !== PROBLEM_TYPES[category]) {
    problems.push(`problem_type ${fm.problem_type} does not match directory ${category}/ (${PROBLEM_TYPES[category]})`);
  }
  if (fm.tags !== undefined) {
    if (!Array.isArray(fm.tags) || fm.tags.length === 0) problems.push('tags must be a non-empty list');
    else for (const tag of fm.tags) if (!KEBAB.test(String(tag))) problems.push(`tag is not kebab-case: ${tag}`);
  }
  if (fm.severity !== undefined && !SEVERITIES.includes(fm.severity)) problems.push(`unknown severity ${fm.severity}`);
  if (fm.status !== undefined && !SOLUTION_STATUSES.includes(fm.status)) problems.push(`unknown status ${fm.status}`);
  problems.push(...checkSupersededBy(root, record, fm.status));
  return problems;
}

export function validatePlan(root, record) {
  if (record.error) return [record.error];
  const fm = record.frontmatter;
  const problems = checkKeys(fm, PLAN_REQUIRED, PLAN_OPTIONAL);
  if (fm.date !== undefined && !DATE.test(String(fm.date))) problems.push(`date must be YYYY-MM-DD, got ${fm.date}`);
  if (fm.status !== undefined && !PLAN_STATUSES.includes(fm.status)) problems.push(`unknown status ${fm.status}`);
  problems.push(...checkSupersededBy(root, record, fm.status));
  return problems;
}

const escapeLinkText = (text) => String(text).replace(/([[\]])/g, '\\$1').replace(/\s+/g, ' ').trim();
const byDateDesc = (a, b) => String(b.frontmatter.date).localeCompare(String(a.frontmatter.date))
  || a.path.localeCompare(b.path);

export function renderSolutionsIndex(root) {
  const records = listSolutions(root).map((path) => readRecord(root, path)).filter((r) => r.frontmatter);
  const current = records.filter((r) => r.frontmatter.status !== 'superseded');
  const superseded = records.filter((r) => r.frontmatter.status === 'superseded');
  const line = (r) => {
    const fm = r.frontmatter;
    const meta = [fm.problem_type, fm.severity, fm.date].filter(Boolean).join(' · ');
    return `- [${escapeLinkText(fm.title)}](${relative(SOLUTIONS_DIR, r.path)}) — ${meta} · ${fm.tags.join(', ')}`;
  };
  const out = [
    '# Solutions index',
    '',
    '<!-- Generated by scripts/generate-engineering-index.mjs from each lesson\'s frontmatter. Do not edit; run `npm run generate`. -->',
    '',
    `${current.length} current lessons, grouped by the area where the fix lives and newest first. Grep this file for an area, tag or word, then open the lesson. The schema is in [README.md](README.md).`,
    '',
    '| Area | Lessons | Covers |',
    '|---|---|---|',
  ];
  for (const [area, covers] of Object.entries(AREAS)) {
    const count = current.filter((r) => r.frontmatter.area === area).length;
    out.push(`| ${count ? `[${area}](#${area})` : area} | ${count} | ${covers} |`);
  }
  for (const area of Object.keys(AREAS)) {
    const inArea = current.filter((r) => r.frontmatter.area === area).sort(byDateDesc);
    if (!inArea.length) continue;
    out.push('', `## ${area}`, '', ...inArea.map(line));
  }
  if (superseded.length) {
    out.push('', '## Superseded', '', 'Kept for history. Follow `superseded_by` to the current lesson.', '');
    out.push(...superseded.sort(byDateDesc).map(line));
  }
  return `${out.join('\n')}\n`;
}

export function renderPlansIndex(root) {
  const records = listPlans(root).map((path) => readRecord(root, path)).filter((r) => r.frontmatter);
  const out = [
    '# Plans index',
    '',
    '<!-- Generated by scripts/generate-engineering-index.mjs from each plan\'s frontmatter. Do not edit; run `npm run generate`. -->',
    '',
    'Plans record intent when they were written. Check the code and git history before relying on one. The schema is in [README.md](README.md).',
  ];
  for (const status of PLAN_STATUSES) {
    const inStatus = records.filter((r) => r.frontmatter.status === status).sort(byDateDesc);
    if (!inStatus.length) continue;
    out.push('', `## ${status[0].toUpperCase()}${status.slice(1)}`, '', '| Date | Plan | Evidence |', '|---|---|---|');
    for (const r of inStatus) {
      const fm = r.frontmatter;
      const evidence = String(fm.evidence ?? (fm.superseded_by ? `superseded by ${fm.superseded_by}` : '')).replace(/\|/g, '\\|');
      out.push(`| ${fm.date} | [${escapeLinkText(fm.title)}](${relative(PLANS_DIR, r.path)}) | ${evidence} |`);
    }
  }
  return `${out.join('\n')}\n`;
}
