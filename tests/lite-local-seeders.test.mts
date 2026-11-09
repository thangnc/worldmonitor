/**
 * The local Lite seeder runner (scripts/run-lite-seeders.mjs) must keep every
 * seeder the Lite UI reads fresh. These checks keep its list in step with the
 * UI and stop a section that would never read as fresh (and so hammer its
 * source on every tick) or that would let health go stale.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LITE_SEED_SECTIONS } from '../scripts/run-lite-seeders.mjs';
import { listBundleFiles } from './helpers/bundle-section-parser.mjs';

const root = resolve(import.meta.dirname, '..');
const scriptsDir = join(root, 'scripts');
const read = (path: string) => readFileSync(path, 'utf8');

type Section = (typeof LITE_SEED_SECTIONS)[number];

function liteSources(dir = join(root, 'src/lite')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return liteSources(path);
    return /\.tsx?$/.test(entry.name) ? [read(path)] : [];
  });
}

/** Seeder scripts the Lite UI names: connector producers and feed seeders. */
function liteSeederNames(): Set<string> {
  const names = new Set<string>();
  for (const src of liteSources()) {
    for (const m of src.matchAll(/(?:producer|seeder):\s*'((?:seed|fetch)-[a-z0-9-]+)'/g)) names.add(m[1]!);
  }
  return names;
}

/** Each bundle's sections as `script -> section source`, from the one-line section objects. */
function bundleSections(): Map<string, { bundle: string; block: string }[]> {
  const byScript = new Map<string, { bundle: string; block: string }[]>();
  for (const path of listBundleFiles(scriptsDir)) {
    const bundle = path.slice(scriptsDir.length + 1).replace(/\.mjs$/, '');
    for (const m of read(path).matchAll(/\{[^{}\n]*script:\s*'([^']+)'[^{}\n]*\}/g)) {
      const list = byScript.get(m[1]!) ?? [];
      list.push({ bundle, block: m[0] });
      byScript.set(m[1]!, list);
    }
  }
  return byScript;
}

/** `api/health.js` SEED_META staleness limits, by seed-meta key. */
function healthMaxStaleMin(): Map<string, number> {
  const limits = new Map<string, number>();
  for (const m of read(join(root, 'api/health.js')).matchAll(/key:\s*'seed-meta:([^']+)',\s*maxStaleMin:\s*([0-9_]+)/g)) {
    if (!limits.has(m[1]!)) limits.set(m[1]!, Number(m[2]!.replaceAll('_', '')));
  }
  return limits;
}

/** The seeder itself names the key: `runSeed('<domain>', '<resource>')` or a `seed-meta:<key>` literal. */
function scriptNamesMetaKey(scriptSrc: string, key: string): boolean {
  for (const m of scriptSrc.matchAll(/runSeed\(\s*'([^']+)',\s*'([^']+)'/g)) {
    if (`${m[1]}:${m[2]}` === key) return true;
  }
  return new RegExp(`['"\`]seed-meta:${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(scriptSrc);
}

describe('local Lite seeder runner', () => {
  const bundles = bundleSections();

  it('runs every seeder the Lite UI names', () => {
    const named = liteSeederNames();
    assert.ok(named.has('seed-ukmto-incidents') && named.size > 10, `scanner found too few Lite seeders: ${[...named]}`);
    const listed = new Set(LITE_SEED_SECTIONS.map((s: Section) => s.script.replace(/\.mjs$/, '')));
    const missing = [...named].filter((name) => {
      if (listed.has(name)) return false;
      // A bundle the UI names counts when the runner lists some of its members.
      const members = [...bundles.entries()].filter(([, defs]) => defs.some((d) => d.bundle === name)).map(([script]) => script.replace(/\.mjs$/, ''));
      return !members.some((member) => listed.has(member));
    });
    assert.deepEqual(missing, [], 'add these to LITE_SEED_SECTIONS in scripts/run-lite-seeders.mjs');
  });

  it('points every section at a seeder script that exists, once', () => {
    const labels = new Set<string>();
    for (const section of LITE_SEED_SECTIONS as Section[]) {
      assert.ok(existsSync(join(scriptsDir, section.script)), `${section.label}: scripts/${section.script} does not exist`);
      assert.ok(!labels.has(section.label), `${section.label}: duplicate label`);
      labels.add(section.label);
    }
  });

  it('gates each section on a seed-meta key its seeder writes', () => {
    for (const section of LITE_SEED_SECTIONS as Section[]) {
      const own = scriptNamesMetaKey(read(join(scriptsDir, section.script)), section.seedMetaKey);
      // A section copied from a Railway bundle may take its key from the bundle (computed resources).
      const fromBundle = (bundles.get(section.script) ?? []).some((d) => d.block.includes(`seedMetaKey: '${section.seedMetaKey}'`));
      assert.ok(own || fromBundle, `${section.label}: seed-meta:${section.seedMetaKey} is not written by ${section.script}`);
    }
  });

  it('keeps each interval polite and inside its health gate', () => {
    const limits = healthMaxStaleMin();
    for (const section of LITE_SEED_SECTIONS as Section[]) {
      assert.ok(section.intervalMs >= 5 * 60_000, `${section.label}: interval under 5 min`);
      const limit = limits.get(section.seedMetaKey);
      if (limit != null) {
        assert.ok(section.intervalMs < limit * 60_000, `${section.label}: interval ${section.intervalMs / 60_000} min is not below health maxStaleMin ${limit}`);
      }
    }
  });
});
