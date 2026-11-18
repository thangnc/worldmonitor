// #5666 made `?lang=` application state, never an indexable alternate. The
// prerendered homepage locale landings and the /pro document that carried the
// hreflang clusters left with the marketing site (refactor Phase 1b); what
// stays live is that no crawl surface advertises a query-string locale.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('international SEO application-locale mode (#5666)', () => {
  it('never lists pseudo-localized query URLs in sitemap or robots output', () => {
    for (const file of ['public/sitemap.xml', 'public/sitemap-main.xml', 'public/robots.www.txt', 'public/robots.variant.txt']) {
      assert.doesNotMatch(read(file), /[?&]lang=/i, file);
    }
  });
});
