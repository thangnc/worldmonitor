// Published-document check by design (#8690, section 2): this suite pins
// the brand page and its discovery links.
// Runtime application tests do not check the document bytes crawlers read.
//
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const BRAND_PAGE = 'public/world-monitor.md';
// One host, not two: /world-monitor.md is not on the Cloudflare apex-exemption
// list, so the api-catalog and the sitemap must both name www or a crawler
// following the catalog pays for a 301 the sitemap does not (#7660).
const BRAND_URL = 'https://www.worldmonitor.app/world-monitor.md';

describe('World Monitor brand-identity page', () => {
  it('opens with the brand-named H1 and a NAP table crawlers can quote', () => {
    const body = read(BRAND_PAGE);
    assert.match(body, /^---\n[\s\S]*?\n---\n+# World Monitor\n/, 'world-monitor.md must retain its brand H1 after metadata');
    assert.match(body, /## Official identity \(NAP\)/);
    assert.match(body, /\|\s*Name\s*\|\s*World Monitor\s*\|/);
    assert.match(body, /https:\/\/www\.worldmonitor\.app/);
    assert.match(body, /https:\/\/worldmonitor\.app \(permanent redirect to www\)/);
    assert.match(
      body,
      /^\|\s*Wikidata \(product\)\s*\|\s*https:\/\/www\.wikidata\.org\/wiki\/Q141237754\s*\|$/m,
      'the NAP table must identify the World Monitor product Wikidata item',
    );
    assert.match(
      body,
      /^Founder:.*https:\/\/www\.wikidata\.org\/wiki\/Q121365724.*$/m,
      'the brand page must identify the founder Wikidata item on the founder line',
    );
    assert.match(body, /support@worldmonitor\.app/);
    assert.match(body, /enterprise@worldmonitor\.app/);
    assert.match(body, /\|\s*Locality\s*\|\s*Dubai\s*\|/);
    assert.match(body, /\|\s*Country\s*\|\s*AE \(United Arab Emirates\)\s*\|/);
    assert.match(body, /does not publish a street address or telephone number/i);
    assert.match(body, /## Not World Monitor[\s\S]*world-monitor\.com[\s\S]*worldmonitorintel\.com/, 'brand page must name the same-name sites answer engines confuse with it');
    // The digest email footer linked x.com/worldmonitorapp, an unregistered handle,
    // while every sameAs list names x.com/worldmonitorai.
    // The digest HTML template lives in scripts/lib/digest-email-html.mjs.
    const digest = read('scripts/seed-digest-notifications.mjs') + read('scripts/lib/digest-email-html.mjs');
    assert.doesNotMatch(digest, /x\.com\/worldmonitorapp\b/, 'digest footer must not link the unregistered X handle');
    assert.match(digest, /href="https:\/\/x\.com\/worldmonitorai"/, 'digest footer must link the official X account');
    assert.doesNotMatch(body, /streetAddress|tel:|\bfaxNumber\b|\+\d{8,}/);
    assert.doesNotMatch(body, /\|\s*Telephone\s*\|/i);
    assert.doesNotMatch(body, /\|\s*Street\s*\|/i);
  });

  it('cites press mentions that already name World Monitor and link the product', () => {
    const body = read(BRAND_PAGE);
    assert.match(body, /www\.wired\.com\/story\/world-monitor-elie-habib/);
    assert.match(body, /mena\.entrepreneur\.com/);
    assert.match(body, /siliconcanals\.com/);
    assert.match(body, /lorientlejour\.com/);
  });

  it('names both Wikidata items so agents can resolve the product, not only the founder (#7373)', () => {
    const body = read(BRAND_PAGE);
    // The founder's item was already here; the product's item -- the one every
    // AI engine reconciles "World Monitor" against -- was not. A brand-identity
    // record that cites only the person leaves the product unresolvable.
    assert.match(body, /https:\/\/www\.wikidata\.org\/wiki\/Q121365724/, 'brand page must cite the founder Wikidata item');
    assert.match(body, /https:\/\/www\.wikidata\.org\/wiki\/Q141237754/, 'brand page must cite the World Monitor Wikidata item');
  });

  it('is advertised on catalog, llms, and agents discovery surfaces', () => {
    const catalog = JSON.parse(read('public/.well-known/api-catalog'));
    const hrefs = catalog.linkset.flatMap((ctx) =>
      Object.values(ctx).flatMap((value) => (Array.isArray(value) ? value.map((entry) => entry.href) : [])),
    );
    assert.ok(hrefs.includes(BRAND_URL), 'api-catalog must advertise world-monitor.md');

    for (const path of ['public/llms.txt', 'public/llms-full.txt', 'public/agents.md', 'public/home.md']) {
      assert.ok(read(path).includes('/world-monitor.md'), `${path} must link world-monitor.md`);
    }

    // A file, not a page: it left the sitemap (#8608) and is announced through
    // llms.txt instead, still on the www host.
    const sitemap = read('public/sitemap-main.xml');
    assert.ok(!sitemap.includes(`<loc>${BRAND_URL}</loc>`), 'sitemap-main.xml must not declare the brand markdown');
  });
});
