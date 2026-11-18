import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  briefGroundingGap,
  briefGroundingPublisherCount,
  COUNTRY_INDEX_ORIGIN,
  hasBriefGrounding,
  MIN_BRIEF_GROUNDING_PUBLISHERS,
  registrableDomain,
} from '../packages/shared/brief-grounding.js';

// Moved with the functions from tests/crawlable-developments.test.mjs when the
// corpus generator was deleted (refactor Phase 1b); the verification desk demo
// still reads them.
describe('brief grounding floor', () => {
  it('counts distinct publisher families, never raw source labels', () => {
    // Egypt's committed brief cleared a raw count on three Egypt Independent
    // articles; three labels from one newsroom are one publisher (#6428).
    assert.equal(MIN_BRIEF_GROUNDING_PUBLISHERS, 2);
    const egypt = ['Egypt Independent', 'Egypt Independent', 'Egypt Independent'].map((source) => ({ source }));
    assert.equal(briefGroundingPublisherCount(egypt), 1);
    assert.equal(hasBriefGrounding(egypt), false);
    assert.equal(briefGroundingPublisherCount([{ source: 'BBC World' }, { source: 'BBC Africa' }]), 1, 'two editions of one newsroom are one family');
    assert.equal(hasBriefGrounding([{ source: 'UN News' }, { source: 'Test Wire' }]), true);
    assert.equal(hasBriefGrounding([]), false);
    assert.equal(hasBriefGrounding(null), false);
  });

  it('counts two rows on one site as one publisher whatever their labels say', () => {
    // GDELT index rows (#7748) carry the publishing domain as their label,
    // digest rows carry a feed label: "Guardian ME" and "theguardian.com"
    // are one newsroom, and the floor must not clear on it twice.
    const mixed = [
      { source: 'Guardian ME', url: 'https://www.theguardian.com/world/2026/sep/03/a' },
      { source: 'theguardian.com', url: 'https://www.theguardian.com/world/2026/sep/04/b' },
    ];
    assert.equal(briefGroundingPublisherCount(mixed), 1);
    assert.equal(hasBriefGrounding(mixed), false);
    // Editions on different hosts still fold through the family table.
    assert.equal(briefGroundingPublisherCount([
      { source: 'BBC World', url: 'https://www.bbc.co.uk/news/a' },
      { source: 'BBC Africa', url: 'https://www.bbc.com/news/b' },
    ]), 1);
    // Two genuinely different sites are two publishers, including
    // second-level country TLDs that a naive "last two labels" rule folds.
    assert.equal(briefGroundingPublisherCount([
      { source: 'rnz.co.nz', url: 'https://www.rnz.co.nz/news/pacific/1' },
      { source: 'abc.net.au', url: 'https://www.abc.net.au/news/2' },
    ]), 2);
    assert.equal(briefGroundingPublisherCount([
      { source: 'rnz.co.nz', url: 'https://www.rnz.co.nz/news/pacific/1' },
      { source: 'stuff.co.nz', url: 'https://www.stuff.co.nz/world/2' },
    ]), 2, 'rnz.co.nz and stuff.co.nz share a suffix, not a site');
    // A row without a usable URL counts by label alone.
    assert.equal(briefGroundingPublisherCount([
      { source: 'UN News' },
      { source: 'Test Wire', url: 'not a url' },
    ]), 2);
    // A shared host bridges two labels into one family transitively.
    assert.equal(briefGroundingPublisherCount([
      { source: 'Wire A', url: 'https://news.example/a' },
      { source: 'Wire B', url: 'https://news.example/b' },
      { source: 'Wire B', url: 'https://other.example/c' },
    ]), 1);
  });

  it('resolves a curated newsroom by its domains, so two BBC hosts are one publisher', () => {
    // A digest label and an index row labelled by domain, on two different
    // registrable domains of one newsroom (review of #7748).
    assert.equal(briefGroundingPublisherCount([
      { source: 'BBC World', url: 'https://www.bbc.com/news/world-1' },
      { source: 'bbc.co.uk', url: 'https://www.bbc.co.uk/news/uk-2' },
    ]), 1);
    assert.equal(briefGroundingPublisherCount([
      { source: 'apnews.com', url: 'https://apnews.com/article/x' },
      { source: 'AP News', url: 'https://apnews.com/article/y' },
      { source: 'Reuters World', url: 'https://www.reuters.com/world/z' },
    ]), 2);
    // A subdomain edition folds into its newsroom.
    assert.equal(briefGroundingPublisherCount([
      { source: 'Guardian World', url: 'https://www.theguardian.com/world/a' },
      { source: 'amp.theguardian.com', url: 'https://amp.theguardian.com/world/b' },
    ]), 1);
  });

  it('never treats an aggregator redirect host as a site', () => {
    // Canada's committed brief: three Google News redirect rows from two
    // families. A redirect host is not a site two labels can share.
    assert.equal(briefGroundingPublisherCount([
      { source: 'Reuters India', url: 'https://news.google.com/rss/articles/a' },
      { source: 'Reuters World', url: 'https://news.google.com/rss/articles/b' },
      { source: 'Gold & Metals', url: 'https://news.google.com/rss/articles/c' },
    ]), 2);
  });

  it('requires a curated row behind a brief: index rows corroborate, they do not ground', () => {
    const index = (n, host) => ({
      title: `Story ${n}`, source: host, url: `https://${host}/${n}`, publishedAt: '2026-09-02T10:00:00.000Z', origin: COUNTRY_INDEX_ORIGIN,
    });
    const digest = { title: 'Digest story', source: 'Test Wire', url: 'https://wire.test/d', publishedAt: '2026-09-02T10:00:00.000Z' };
    assert.equal(briefGroundingGap([index(1, 'rnz.co.nz'), index(2, 'abc.net.au')]), 'uncurated-grounding');
    assert.equal(hasBriefGrounding([index(1, 'rnz.co.nz'), index(2, 'abc.net.au')]), false);
    assert.equal(briefGroundingGap([digest, index(1, 'rnz.co.nz')]), null);
    assert.equal(hasBriefGrounding([digest, index(1, 'rnz.co.nz')]), true);
    assert.equal(briefGroundingGap([digest]), 'thin-grounding', 'the publisher count is checked first');
    assert.equal(briefGroundingGap([index(1, 'rnz.co.nz')]), 'thin-grounding');
  });

  it('derives registrable domains with second-level suffixes intact', () => {
    assert.equal(registrableDomain('https://www.bbc.co.uk/news/a'), 'bbc.co.uk');
    assert.equal(registrableDomain('https://amp.theguardian.com/world/b'), 'theguardian.com');
    assert.equal(registrableDomain('https://www.abc.net.au/news/c'), 'abc.net.au');
    assert.equal(registrableDomain('https://example.test/x'), 'example.test');
    assert.equal(registrableDomain('not a url'), '');
  });
});
