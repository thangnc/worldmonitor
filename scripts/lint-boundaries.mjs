#!/usr/bin/env node
/**
 * Architectural boundary lint.
 *
 * Enforces forward-only dependency direction:
 *   types → config → services → lite
 *
 * Violations are imports that go backwards in this chain.
 * Lines with "boundary-ignore" comments are excluded.
 *
 * Also checks:
 *   - api/ legacy .js: must not import from src/ or packages/ (self-contained)
 *   - api/ RPC .ts: may import packages/server/ and packages/contracts/generated/, but not src/ app code
 *   - api/, packages/server/, packages/shared/, middleware.ts, vite.dev-api.ts and the src/
 *     files they import reach @wm/contracts, @wm/shared and @wm/server by relative path,
 *     not by package name
 *   - packages/server/ must not import the Lite UI (src/lite/)
 *   - nothing outside src/lite/ imports the Lite UI
 *
 * Exit code 1 if violations found. Agent-readable output.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

const SRC = 'src';
const ROOT = process.cwd();

// Layer order (lower index = lower layer, can only import from same or lower)
const LAYERS = ['types', 'config', 'services', 'lite'];

function getLayer(filePath) {
  const rel = relative(join(ROOT, SRC), filePath);
  for (const layer of LAYERS) {
    if (rel.startsWith(layer + '/') || rel.startsWith(layer + '\\')) return layer;
  }
  return null;
}

function getLayerIndex(layer) {
  return LAYERS.indexOf(layer);
}

function walkDir(dir, ext = ['.ts', '.tsx', '.js', '.mjs']) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'generated') continue;
      results.push(...walkDir(full, ext));
    } else if (ext.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

const violations = [];

// --- Check 1: src/ layer boundaries ---
const srcFiles = walkDir(join(ROOT, SRC));
for (const file of srcFiles) {
  const fileLayer = getLayer(file);
  if (!fileLayer) continue;
  const fileIdx = getLayerIndex(fileLayer);

  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('boundary-ignore')) continue;
    if (i > 0 && lines[i - 1].includes('boundary-ignore')) continue;

    // Check both `from '@/layer'` imports and `import('@/layer')` type expressions
    const patterns = [
      line.match(/from\s+['"]@\/(\w+)/),
      line.match(/import\(['"]@\/(\w+)/),
    ];

    for (const match of patterns) {
      if (!match) continue;
      const importLayer = match[1];
      const importIdx = getLayerIndex(importLayer);
      if (importIdx === -1) continue; // not a tracked layer

      if (importIdx > fileIdx) {
        const rel = relative(ROOT, file);
        violations.push({
          file: rel,
          line: i + 1,
          from: fileLayer,
          to: importLayer,
          text: line.trim(),
          remedy: `Move the imported type/function to a lower layer (${fileLayer} or below), or add a "boundary-ignore" comment if this is a pragmatic exception.`,
        });
        break; // one violation per line is enough
      }
    }
  }
}

// --- Check 2: packages/server/ must not import the Lite UI (src/lite/) ---
const serverFiles = walkDir(join(ROOT, 'packages', 'server'));
for (const file of serverFiles) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('boundary-ignore')) continue;
    if (i > 0 && lines[i - 1].includes('boundary-ignore')) continue;

    if (line.match(/from\s+['"].*\/src\/lite\//)) {
      violations.push({
        file: relative(ROOT, file),
        line: i + 1,
        from: 'server',
        to: 'src/lite',
        text: line.trim(),
        remedy: 'Server code must not import browser UI code. Extract shared logic into packages/shared/, packages/server/_shared/ or src/types/.',
      });
    }
  }
}

// --- Check 3: api/ boundary rules ---
// Legacy api/*.js: fully self-contained (no ../packages/ or ../src/ imports)
// Sebuf RPC api/**/*.ts: may import packages/server/ and packages/contracts/generated/ (bundled at deploy),
//   but must NOT import src/ non-generated paths (lite, services, config, etc.)
const apiFiles = walkDir(join(ROOT, 'api'), ['.js', '.mjs', '.ts']);
for (const file of apiFiles) {
  const basename = file.split('/').pop();
  if (basename.startsWith('_') || basename.includes('.test.')) continue;

  const isTs = file.endsWith('.ts');
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('boundary-ignore')) continue;
    if (i > 0 && lines[i - 1].includes('boundary-ignore')) continue;

    if (isTs) {
      // RPC .ts files: allow packages/server/ and packages/contracts/generated/, block src/
      if (line.match(/from\s+['"]\.\..*\/src\//)) {
        violations.push({
          file: relative(ROOT, file),
          line: i + 1,
          from: 'api (RPC)',
          to: 'src',
          text: line.trim(),
          remedy: 'RPC Edge Functions may import from packages/server/ and packages/contracts/generated/, but not from src/ application code (lite, services, config).',
        });
      }
    } else {
      // Legacy .js files: fully self-contained
      if (line.match(/from\s+['"]\.\.\/(?:src|server|packages)\//)) {
        violations.push({
          file: relative(ROOT, file),
          line: i + 1,
          from: 'api (legacy)',
          to: line.match(/\.\.\/(\w+)/)[1],
          text: line.trim(),
          remedy: 'Legacy Edge Functions must be self-contained. Only same-directory _*.js helpers and npm packages are allowed.',
        });
      }
    }
  }
}

// --- Check 4: src/lite/ (the Lite UI) sits on top ---
// It may import types, config, services, utils, shared and generated clients.
// Nothing outside src/lite/ may import it (Check 1 covers the layered
// directories; this covers bootstrap/, utils/, workers and the rest).
// See .claude/rules/lite-profile.md.
const LITE_DIR = join(ROOT, SRC, 'lite');
for (const file of srcFiles) {
  const inLite = file.startsWith(LITE_DIR + '/') || file.startsWith(LITE_DIR + '\\');
  if (inLite) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('boundary-ignore')) continue;
    if (i > 0 && lines[i - 1].includes('boundary-ignore')) continue;
    const spec = line.match(/(?:from\s+|import\()['"]([^'"]+)['"]/)?.[1];
    if (!spec) continue;
    const target = spec.startsWith('.') ? relative(join(ROOT, SRC), resolve(dirname(file), spec)) : null;
    if (/^@\/lite(\/|$)/.test(spec) || (target != null && /^lite(\/|\\|$)/.test(target))) {
      violations.push({
        file: relative(ROOT, file), line: i + 1, from: 'src', to: spec, text: line.trim(),
        remedy: 'Only src/lite/ may import the Lite UI.',
      });
    }
  }
}

// --- Check 5: Edge-reachable code imports the workspace packages by relative path ---
// Vercel's Edge bundler has not been proven to resolve npm workspace packages,
// so api/, packages/server/, packages/shared/, middleware.ts and vite.dev-api.ts
// import packages/contracts/, packages/shared/ and packages/server/ relatively,
// and so does every src/ file they reach (src/shared/ and the src/config,
// src/services and src/utils modules the handlers import). Other browser code
// (src/) may use the @wm/contracts and @wm/shared package names; @wm/server is
// rejected in all of these files.
const EDGE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
const edgeRoots = [
  ...walkDir(join(ROOT, 'api'), EDGE_EXTS),
  ...walkDir(join(ROOT, 'packages', 'server'), EDGE_EXTS),
  ...walkDir(join(ROOT, 'packages', 'shared'), EDGE_EXTS),
  ...walkDir(join(ROOT, 'src', 'shared'), EDGE_EXTS),
  join(ROOT, 'middleware.ts'),
  join(ROOT, 'vite.dev-api.ts'),
];
const RELATIVE_SPEC_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+|@\/[^'"]+)['"]/gm;
function resolveRelative(fromFile, spec) {
  // `@/` is the browser alias for src/ (tsconfig paths); Edge code reaches
  // src/ through it too.
  const path = spec.split('?')[0];
  const base = path.startsWith('@/') ? join(ROOT, SRC, path.slice(2)) : resolve(dirname(fromFile), path);
  const candidates = [base, ...['.ts', '.tsx', '.js', '.mjs'].map((e) => base + e),
    base.replace(/\.js$/, '.ts'), join(base, 'index.ts'), join(base, 'index.js')];
  for (const c of candidates) {
    try { if (statSync(c).isFile()) return c; } catch { /* probe next */ }
  }
  return null;
}
const edgeFiles = new Set(edgeRoots);
const srcRoot = join(ROOT, SRC) + '/';
const queue = [...edgeRoots];
while (queue.length > 0) {
  const file = queue.pop();
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(RELATIVE_SPEC_RE)) {
    // A type-only alias import is erased before bundling, so it reaches nothing.
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    if (match[1].startsWith('@/') && /^\s*(?:import|export)\s+type\b/.test(text.slice(lineStart, match.index))) continue;
    const target = resolveRelative(file, match[1]);
    if (!target || !target.startsWith(srcRoot) || edgeFiles.has(target)) continue;
    edgeFiles.add(target);
    queue.push(target);
  }
}
for (const file of edgeFiles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('boundary-ignore')) continue;
    if (i > 0 && lines[i - 1].includes('boundary-ignore')) continue;
    const pkg = line.match(/(?:from\s+|import\(\s*|require\(\s*|^\s*import\s+)['"](@wm\/(?:contracts|shared|server))(?:\/|['"])/)?.[1];
    if (pkg) {
      violations.push({
        file: relative(ROOT, file), line: i + 1, from: 'edge-reachable', to: pkg, text: line.trim(),
        remedy: `Import ${pkg.replace('@wm/', 'packages/')}/ by relative path from api/, packages/server/, packages/shared/, middleware.ts, vite.dev-api.ts and the src/ files they import.`,
      });
    }
  }
}

// --- Output ---
if (violations.length === 0) {
  console.log('✓ No architectural boundary violations found.');
  process.exit(0);
} else {
  console.error(`✖ Found ${violations.length} architectural boundary violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.from} → ${v.to} (backward import)`);
    console.error(`    ${v.text}`);
    console.error(`    Remedy: ${v.remedy}`);
    console.error('');
  }
  process.exit(1);
}
