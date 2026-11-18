import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('published resilience snapshot freshness', () => {
  it('documents the monthly publication cadence and the first methodology correction', () => {
    const methodology = readFileSync(
      join(repoRoot, 'docs', 'methodology', 'country-resilience-index.mdx'),
      'utf8',
    );
    const revisions = readFileSync(join(repoRoot, 'docs', 'corrections.mdx'), 'utf8');

    assert.match(methodology, /Live API scores refresh every 6 hours/);
    assert.match(methodology, /crawlable country snapshot is published monthly/);
    assert.match(revisions, /title: "Revision and Corrections Log"/);
    assert.match(revisions, /2026-06-01/);
    assert.match(revisions, /P1-1/);
    assert.match(revisions, /coverage-only member aggregation/);
    assert.match(revisions, /first day of each month/);
    assert.match(revisions, /resilience-ranking-2026-08-29/);
    assert.match(revisions, /[Oo]ff-cycle/);

    // The log held one revision while three derived chokepoint fields were
    // withdrawn across all 13 pages on 2026-09-01 and source availability was
    // separated on 2026-09-02 — both material, neither logged (#7530). Pin the
    // rows and their PR references so a withdrawal cannot ship unlogged again.
    for (const source of [
      revisions,
      readFileSync(join(repoRoot, 'docs', 'zh', 'corrections.mdx'), 'utf8'),
    ]) {
      assert.match(source, /2026-09-01/);
      assert.match(source, /2026-09-02/);
      assert.match(source, /pull\/7515/);
      assert.match(source, /pull\/7535/);
    }
  });
});
