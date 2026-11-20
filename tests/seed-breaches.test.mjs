import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  HIBP_BREACHES_URL,
  LIST_KEEP_DAYS,
  MIN_BREACHES,
  declareRecords,
  fetchBreaches,
  toBreach,
  validateFn,
} from '../scripts/seed-breaches.mjs';

const NOW = Date.UTC(2026, 10, 20, 12);
const DAY = 86_400_000;

// HIBP /api/v3/breaches entries, in the live shape (2026-11-20), trimmed.
const raw = (name, addedDaysAgo, o = {}) => ({
  Name: name, Title: name, Domain: `${name.toLowerCase()}.com`, BreachDate: '2026-11-14',
  AddedDate: new Date(NOW - addedDaysAgo * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z'), ModifiedDate: '2026-11-20T03:44:54Z',
  PwnCount: 3_609_421, Description: '<p>In November 2026, …</p>', LogoPath: 'https://logos.haveibeenpwned.com/x.png', Attribution: null, DisclosureUrl: null,
  DataClasses: ['Academic records', 'Castes', 'Email addresses', 'Names', 'Phone numbers'],
  IsVerified: true, IsFabricated: false, IsSensitive: false, IsRetired: false, IsSpamList: false, IsMalware: false, IsSubscriptionFree: false, IsStealerLog: false,
  ...o,
});
const catalogue = (recent) => [...recent, ...Array.from({ length: MIN_BREACHES }, (_, i) => raw(`Old${i}`, 400 + i))];
const router = (body, status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    return { ok: status === 200, status, headers: new Headers(), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { fetchImpl, calls };
};

describe('HIBP breach catalogue (#131)', () => {
  it('keeps both dates, the account count, the data classes and the flags', () => {
    assert.deepEqual(toBreach(raw('Careers360', 0.3, { Title: 'Careers360', Domain: 'Careers360.com' })), {
      name: 'Careers360', title: 'Careers360', domain: 'careers360.com', breachDate: '2026-11-14', addedAt: Date.parse(new Date(NOW - 0.3 * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z')),
      pwnCount: 3_609_421, dataClasses: ['Academic records', 'Castes', 'Email addresses', 'Names', 'Phone numbers'],
      verified: true, fabricated: false, sensitive: false, spamList: false, malware: false, stealerLog: false,
      url: 'https://haveibeenpwned.com/Breach/Careers360',
    });
    assert.equal(toBreach(raw('CastleRAT', 1, { Domain: '', IsMalware: true })).domain, '');
    // Every data class is kept, so the card's "+N more" counts them all.
    assert.equal(toBreach(raw('Wide', 1, { DataClasses: Array.from({ length: 14 }, (_, i) => `Class ${i}`) })).dataClasses.length, 14);
    assert.equal(toBreach({ Name: 'x', AddedDate: 'not a date', PwnCount: 1 }), null);
    assert.equal(toBreach({ Name: 'x', AddedDate: '2026-11-20T00:00:00Z', PwnCount: 'many' }), null);
  });

  it('publishes the breaches listed in the last 30 days, newest first, with the catalogue size', async () => {
    const { fetchImpl, calls } = router(catalogue([raw('A', 2), raw('B', 0.5), raw('C', LIST_KEEP_DAYS + 1)]));
    const data = await fetchBreaches({ fetchImpl, nowMs: NOW });
    assert.deepEqual(calls.map(([u]) => u), [HIBP_BREACHES_URL]);
    assert.match(calls[0][1], /WorldMonitor/);
    assert.deepEqual(data.breaches.map((b) => b.name), ['B', 'A']);
    assert.deepEqual([data.total, data.keepDays], [MIN_BREACHES + 3, LIST_KEEP_DAYS]);
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), MIN_BREACHES + 3);
    assert.equal(CANONICAL_KEY, 'cyber:breaches:v1');
  });

  it('fails on an HTTP error, a non-JSON answer or a short catalogue, so the last good list stays', async () => {
    await assert.rejects(fetchBreaches({ fetchImpl: router('', 429).fetchImpl, nowMs: NOW }), /HTTP 429/);
    await assert.rejects(fetchBreaches({ fetchImpl: router('<html>Checking your browser</html>').fetchImpl, nowMs: NOW }), /other than JSON/);
    await assert.rejects(fetchBreaches({ fetchImpl: router([raw('A', 1)]).fetchImpl, nowMs: NOW }), /1 breaches, expected at least/);
    assert.equal(validateFn({ fetchedAt: NOW, total: 10, breaches: [] }), false);
  });
});
