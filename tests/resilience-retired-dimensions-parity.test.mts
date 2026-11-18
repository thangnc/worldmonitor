import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';

// Plan 2026-04-26-002 §U1: shape validation for cohort JSON fixtures.
const here = dirname(fileURLToPath(import.meta.url));
const COHORTS_DIR = resolve(here, '../packages/server/worldmonitor/resilience/v1/cohorts');
const ISO2_RE = /^[A-Z]{2}$/;

interface CohortShape {
  name: string;
  description: string;
  iso2: string[];
}

describe('cohort JSON fixture shapes (Plan 2026-04-26-002 §U1)', () => {
  const files = readdirSync(COHORTS_DIR).filter((f) => f.endsWith('.json'));

  it('cohorts directory contains at least the 5 expected files', () => {
    const required = ['g7.json', 'nordics.json', 'gcc.json', 'sub-saharan-lic.json', 'microstate-territories.json'];
    for (const req of required) {
      assert.ok(files.includes(req), `Missing required cohort fixture: ${req}`);
    }
  });

  for (const file of files) {
    it(`${file}: parses to {name, description, iso2[]} with valid ISO2 codes`, () => {
      const raw = readFileSync(resolve(COHORTS_DIR, file), 'utf8');
      let parsed: CohortShape;
      try {
        parsed = JSON.parse(raw) as CohortShape;
      } catch (err) {
        throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
      }
      assert.ok(typeof parsed.name === 'string' && parsed.name.length > 0,
        `${file} missing required "name" field`);
      assert.ok(typeof parsed.description === 'string' && parsed.description.length > 50,
        `${file} description must explain the cohort's purpose (got ${parsed.description?.length ?? 0} chars)`);
      assert.ok(Array.isArray(parsed.iso2) && parsed.iso2.length > 0,
        `${file} must have non-empty iso2[]`);
      for (const iso of parsed.iso2) {
        assert.ok(ISO2_RE.test(iso),
          `${file} contains invalid ISO2 code "${iso}" (must match /^[A-Z]{2}$/)`);
      }
      const set = new Set(parsed.iso2);
      assert.equal(set.size, parsed.iso2.length,
        `${file} contains duplicate ISO2 entries`);
    });
  }
});
