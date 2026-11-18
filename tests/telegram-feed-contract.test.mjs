import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The api/telegram-feed edge route was deleted in the Lite refactor (Phase 1c);
// the intelligence RPC's listTelegramFeed is the remaining reader.
import { listTelegramFeed } from '../packages/server/worldmonitor/intelligence/v1/list-telegram-feed.ts';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

describe('server listTelegramFeed relay normalization', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv();
  });

  it('maps alternate relay field names into the public intelligence API contract', async () => {
    process.env.WS_RELAY_URL = 'https://relay.example.com';
    process.env.RELAY_SHARED_SECRET = 'test-secret';
    globalThis.fetch = async () => new Response(JSON.stringify({
      enabled: true,
      count: 0,
      items: [{
        id: 'msg-1',
        channelTitle: 'OSINT Watch',
        ts: '2026-04-06T12:30:00Z',
        url: 'https://t.me/osintwatch/1',
        text: 'Port disruption reported',
        topic: 'geopolitics',
        mediaUrls: [91, 'https://cdn.example.com/chart.png'],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await listTelegramFeed(/** @type {any} */ ({}), { limit: 25 });
    assert.equal(response.enabled, true);
    assert.equal(response.count, 1);
    assert.equal(response.messages.length, 1);
    assert.equal(response.messages[0].channelName, 'OSINT Watch');
    assert.equal(response.messages[0].sourceUrl, 'https://t.me/osintwatch/1');
    assert.equal(
      response.messages[0].timestampMs,
      Date.parse('2026-04-06T12:30:00Z'),
    );
    assert.deepEqual(response.messages[0].mediaUrls, ['https://cdn.example.com/chart.png']);
  });

  it('normalizes numeric Unix-second timestamps in the server RPC path', async () => {
    process.env.WS_RELAY_URL = 'https://relay.example.com';
    process.env.RELAY_SHARED_SECRET = 'test-secret';
    globalThis.fetch = async () => new Response(JSON.stringify({
      enabled: true,
      items: [{
        id: 'msg-seconds',
        channel: 'osint',
        ts: 1_744_000_000,
        url: 'https://t.me/osint/seconds',
        text: 'Numeric seconds timestamp',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await listTelegramFeed(/** @type {any} */ ({}), { limit: 25 });
    assert.equal(response.count, 1);
    assert.equal(response.messages[0].timestampMs, 1_744_000_000_000);
  });

  it('filters unsafe source and media URLs in the server RPC path', async () => {
    process.env.WS_RELAY_URL = 'https://relay.example.com';
    process.env.RELAY_SHARED_SECRET = 'test-secret';
    globalThis.fetch = async () => new Response(JSON.stringify({
      enabled: true,
      messages: [{
        id: 'msg-unsafe-url',
        channel: 'osint',
        timestampMs: 1_744_000_000_000,
        sourceUrl: 'javascript:alert(1)',
        text: 'Unsafe URLs should not leave the server contract',
        mediaUrls: [
          'https://cdn.example.com/photo.jpg',
          'javascript:alert(2)',
          'ftp://cdn.example.com/file.jpg',
          'not a url',
          42,
        ],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await listTelegramFeed(/** @type {any} */ ({}), { limit: 25 });
    assert.equal(response.count, 1);
    assert.equal(response.messages[0].sourceUrl, '');
    assert.deepEqual(response.messages[0].mediaUrls, ['https://cdn.example.com/photo.jpg']);
  });
});
