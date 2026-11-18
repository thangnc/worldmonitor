// Guards for the shared brief helpers that outlived the brief edge routes
// (api/brief/** and api/latest-brief were removed in Lite Phase 1c):
//
// - readRawJsonFromUpstash (api/_upstash-json.js) must keep an infrastructure
//   error distinct from a genuine miss, so callers never read a Redis outage
//   as "no data".
// - assertBriefEnvelope (server/_shared/brief-render.js) is the envelope
//   validator the digest seeder renders through; a partial envelope must not
//   pass as ready.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('readRawJsonFromUpstash: infrastructure error vs miss', () => {
  it('readRawJsonFromUpstash throws when Upstash credentials are missing', async () => {
    const { readRawJsonFromUpstash } = await import('../api/_upstash-json.js');
    const saved = {
      url: process.env.UPSTASH_REDIS_REST_URL,
      tok: process.env.UPSTASH_REDIS_REST_TOKEN,
    };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    try {
      await assert.rejects(
        () => readRawJsonFromUpstash('brief:user_x:2026-04-17-0800'),
        /not configured/,
      );
    } finally {
      if (saved.url) process.env.UPSTASH_REDIS_REST_URL = saved.url;
      if (saved.tok) process.env.UPSTASH_REDIS_REST_TOKEN = saved.tok;
    }
  });

  it('readRawJsonFromUpstash throws on Upstash HTTP error', async () => {
    const { readRawJsonFromUpstash } = await import('../api/_upstash-json.js');
    const realFetch = globalThis.fetch;
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.invalid';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    globalThis.fetch = async () => new Response('internal error', { status: 500 });
    try {
      await assert.rejects(
        () => readRawJsonFromUpstash('brief:user_x:2026-04-17-0800'),
        /HTTP 500/,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('readRawJsonFromUpstash returns null only on genuine miss', async () => {
    const { readRawJsonFromUpstash } = await import('../api/_upstash-json.js');
    const realFetch = globalThis.fetch;
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.invalid';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ result: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    try {
      const out = await readRawJsonFromUpstash('brief:user_x:2026-04-17-0800');
      assert.equal(out, null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('assertBriefEnvelope is shared between renderer and preview', () => {
  // Regression guard against the "ready preview → 404 on click"
  // contradiction. The preview RPC must use the same validator the
  // renderer uses so no partial envelope escapes as a "ready" status.

  it('exports assertBriefEnvelope from server/_shared/brief-render.js', async () => {
    const mod = await import('../server/_shared/brief-render.js');
    assert.equal(typeof mod.assertBriefEnvelope, 'function');
    assert.equal(typeof mod.renderBriefMagazine, 'function');
  });

  it('assertBriefEnvelope throws on partial envelope missing digest.numbers', async () => {
    const { assertBriefEnvelope } = await import('../server/_shared/brief-render.js');
    // Weak preview would have passed this envelope: dateLong string,
    // digest.greeting string, stories array. But it's missing
    // digest.numbers entirely — the renderer must reject it so the
    // preview RPC rejects it too.
    const partial = {
      version: 2,
      issuedAt: Date.now(),
      data: {
        user: { name: 'Elie', tz: 'UTC' },
        issue: '18.04',
        date: '2026-04-18',
        dateLong: '18 April 2026',
        digest: {
          greeting: 'Good morning.',
          lead: 'Lead paragraph.',
          threads: [],
          signals: [],
          // numbers intentionally absent
        },
        stories: [
          {
            category: 'Energy',
            country: 'US',
            threatLevel: 'medium',
            headline: 'Headline',
            description: 'Description',
            source: 'Wires',
            sourceUrl: 'https://example.com/story',
            whyMatters: 'Why',
          },
        ],
      },
    };
    assert.throws(() => assertBriefEnvelope(partial), /digest\.numbers/);
  });
});
