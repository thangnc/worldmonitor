import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { rewriteDocsLocaleHtml } from '../src/config/docs-locale-seo';
import { DOCS_PAGE_DATES } from '../src/config/docs-page-dates.generated';

const ORGANIZATION_ID = 'https://www.worldmonitor.app/#organization';
const PERSON_ID = 'https://www.worldmonitor.app/blog/authors/elie-habib/#person';
const CANONICAL_ORIGIN = 'https://www.worldmonitor.app/';
// The typed Organization role filler: `@id` alone would reference a node no
// docs page declares, so the stub must self-describe (#7459b, #8073).
const WORLD_MONITOR_ORG = {
  '@id': ORGANIZATION_ID,
  '@type': 'Organization',
  name: 'World Monitor',
  url: CANONICAL_ORIGIN,
};

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Single quotes, mixed case, and whitespace around `=` are all valid on the
// type attribute. A double-quote-only matcher lets a conflicting block hide
// from the producer discovery below simply by being written differently, so
// match the same shape the rest of the repo's JSON-LD readers accept.
function jsonLdBlocks(html: string): Record<string, any>[] {
  return [...html.matchAll(
    /<script\b(?=[^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi,
  )].map((match) => JSON.parse(match[1]));
}

/**
 * Every node of `type` at any depth in a page's JSON-LD. Role fillers such as
 * `author` and `founder` are nested inside their parent node, so a top-level
 * scan cannot see them.
 */
function collectNodesOfType(html: string, type: string): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, any>;
    const declared = node['@type'];
    if (declared === type || (Array.isArray(declared) && declared.includes(type))) {
      found.push(node);
    }
    Object.values(node).forEach(walk);
  };
  jsonLdBlocks(html).forEach(walk);
  return found;
}

/**
 * Every node that DECLARES `id` -- carries the identity plus a body -- as
 * opposed to the bare `{ '@id': ... }` fillers that merely reference it. Walks
 * nested values so a declaration wrapped in `@graph` is not missed, which a
 * top-level scan would sail straight past (#7611).
 */
function declarationsOf(html: string, id: string): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, any>;
    if (node['@id'] === id && Object.keys(node).some((key) => key !== '@id' && key !== '@context')) {
      found.push(node);
    }
    Object.values(node).forEach(walk);
  };
  jsonLdBlocks(html).forEach(walk);
  return found;
}

function assertSelfDescribingAuthor(path: string, author: Record<string, unknown> | undefined): void {
  assert.ok(author, `${path}: must carry an author`);
  assert.ok(
    author['@id'] === ORGANIZATION_ID || author['@id'] === PERSON_ID,
    `${path}: author must reference the canonical Organization or Person, got ${JSON.stringify(author['@id'])}`,
  );
  // A bare `@id` is an unresolvable stub for the naive extractors this
  // signal is for: no generated page declares the canonical node, and
  // parsers resolve `@id` within one document (#7459b, #8073).
  assert.ok(
    typeof author['@type'] === 'string' && typeof author.name === 'string',
    `${path}: author reference must carry @type and name so it resolves in-document`,
  );
  if (author['@id'] === ORGANIZATION_ID) {
    assert.deepEqual(
      author,
      WORLD_MONITOR_ORG,
      `${path}: Organization author must be the typed WORLD_MONITOR_ORG stub`,
    );
  }
}

/**
 * Docs middleware output for every dated slug, both upstream shapes.
 * Shared by the body-consistency test and the author guard so a new docs
 * page cannot join one population and skip the other (#8073).
 */
let docsMiddlewareDocumentsMemo: Map<string, string> | null = null;
function docsMiddlewareDocuments(): Map<string, string> {
  docsMiddlewareDocumentsMemo ??= (() => {
    const documents = new Map<string, string>();
    for (const slug of Object.keys(DOCS_PAGE_DATES)) {
      for (const type of ['WebPage', ['Article', 'TechArticle']]) {
        const html = `<html><head><script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org', '@type': type, name: slug, headline: slug,
          url: `https://www.worldmonitor.app/docs/${slug}`,
        })}</script></head><body></body></html>`;
        const rewritten = rewriteDocsLocaleHtml(
          rewriteDocsLocaleHtml(html, `/docs/${slug}`),
          `/docs/${slug}`,
        );
        assert.equal(collectNodesOfType(rewritten, 'Article').length, 1, `${slug} must emit an Article`);
        documents.set(`docs/${slug} (${JSON.stringify(type)} middleware output)`, rewritten);
      }
    }
    return documents;
  })();
  return docsMiddlewareDocumentsMemo;
}

/**
 * Every committed HTML document that could carry JSON-LD: the root entry
 * points plus anything under public/. DISCOVERING this population is the
 * point -- a hand-listed one cannot notice a NEW surface claiming a canonical
 * `@id`, which is precisely the bug #7611 fixed.
 */
function jsonLdDocumentPaths(): string[] {
  const root = new URL('../', import.meta.url);
  const found: string[] = [];
  const collect = (relativeDir: string, recurse: boolean): void => {
    for (const entry of readdirSync(new URL(relativeDir, root), { withFileTypes: true })) {
      const relativePath = `${relativeDir}${entry.name}`;
      if (entry.isDirectory()) {
        if (recurse && entry.name !== 'node_modules') collect(`${relativePath}/`, true);
      } else if (entry.name.endsWith('.html')) {
        found.push(relativePath);
      }
    }
  };
  collect('', false);
  collect('public/', true);
  return found.sort();
}

describe('canonical schema graph', () => {
  // #7611: the invariant is "one `@id`, one body". Every surface that declares
  // the canonical Organization or Person must agree on every property it
  // states, and every Article must carry valid dates.
  it('serves consistent Organization and Person bodies across every surface (#7611)', () => {
    const documents = new Map(jsonLdDocumentPaths().map((path) => [path, read(path)]));
    const docsOrganization = JSON.parse(read('docs/docs.json')).seo.organization;
    const { id, logo, ...properties } = docsOrganization;
    const docsHtml = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', '@id': id, ...properties, logo: { '@type': 'ImageObject', url: logo } }],
    })}</script></head><body></body></html>`;
    documents.set('docs/about (middleware output)', rewriteDocsLocaleHtml(docsHtml, '/docs/about'));
    for (const [path, html] of docsMiddlewareDocuments()) documents.set(path, html);
    for (const [path, html] of documents) {
      const articles = ['Article', 'TechArticle', 'BlogPosting', 'NewsArticle']
        .flatMap((type) => collectNodesOfType(html, type));
      for (const article of articles) {
        for (const field of ['datePublished', 'dateModified']) {
          assert.equal(typeof article[field], 'string', `${path}: Article must carry ${field}`);
          assert.ok(Number.isFinite(Date.parse(article[field])), `${path}: invalid ${field}`);
        }
      }
    }

    for (const id of [ORGANIZATION_ID, PERSON_ID]) {
      const emitters = new Map<string, Record<string, any>>();
      for (const [path, html] of documents) {
        if (!html.includes(id)) continue;
        declarationsOf(html, id)
          .forEach((node, index) => emitters.set(index === 0 ? path : `${path} (node ${index + 1})`, node));
      }
      const carriers = new Map<string, Array<[string, unknown]>>();
      for (const [path, node] of emitters) {
        for (const [property, value] of Object.entries(node)) {
          if (property === '@context') continue;
          const seen = carriers.get(property) ?? [];
          seen.push([path, value]);
          carriers.set(property, seen);
        }
      }
      for (const [property, entries] of carriers) {
        const [firstPath, firstValue] = entries[0];
        for (const [path, value] of entries.slice(1)) {
          assert.deepEqual(
            value,
            firstValue,
            `${id} "${property}" differs between ${firstPath} and ${path}`,
          );
        }
      }
    }
  });

  // #8073: the #7980 author guard discovered its population from the corpus
  // generator, so 465 docs Articles shipped a bare `#organization` reference
  // the guard could not see. The docs family is synthesized through the real
  // rewrite, the same way the date and body-consistency tests already do.
  it('attributes every docs Article to a self-describing canonical author (#8073)', () => {
    const documents = docsMiddlewareDocuments();
    assert.equal(documents.size, Object.keys(DOCS_PAGE_DATES).length * 2);

    let checked = 0;
    for (const [path, html] of documents) {
      const articles = collectNodesOfType(html, 'Article');
      assert.equal(articles.length, 1, `${path}: expected one Article`);
      checked += 1;
      assertSelfDescribingAuthor(path, articles[0].author);
    }
    assert.equal(checked, documents.size, 'every synthesized docs document must contribute an Article author');
  });

  it('overrides Mintlify publisher metadata with the canonical Organization', () => {
    const docs = JSON.parse(read('docs/docs.json'));
    assert.deepEqual(docs.seo.organization, {
      id: ORGANIZATION_ID,
      name: 'World Monitor',
      url: CANONICAL_ORIGIN,
      logo: 'https://www.worldmonitor.app/favico/apple-touch-icon.png',
      sameAs: [
        'https://github.com/koala73/worldmonitor',
        'https://www.npmjs.com/package/worldmonitor',
        'https://x.com/worldmonitorai',
        'https://x.com/eliehabib',
        'https://www.wired.com/story/world-monitor-elie-habib/',
      ],
    });
  });
});
