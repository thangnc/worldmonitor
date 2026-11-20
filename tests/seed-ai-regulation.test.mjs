import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  EU_DIGITAL_URL,
  EURLEX_FEEDS,
  declareRecords,
  dateUndated,
  euItem,
  euKind,
  fetchAiRegulation,
  frItem,
  frUrl,
  mergeLog,
  validateFn,
} from '../scripts/seed-ai-regulation.mjs';

const NOW = Date.UTC(2026, 10, 20, 8);
const DAY = 86_400_000;
const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description ?? ''}</description><pubDate>${i.pubDate}</pubDate></item>`).join('')}</channel></rss>`;
const ds = (title, day = 18) => ({ title, link: `https://digital-strategy.ec.europa.eu/en/news/${encodeURIComponent(title)}`, pubDate: `Wed, ${day} Nov 2026 10:00:00 GMT` });
const fr = (o = {}) => ({ document_number: '2026-30001', title: 'Use of Artificial Intelligence in Federal Benefit Determinations', type: 'Proposed Rule', abstract: '', publication_date: '2026-11-18',
  html_url: 'https://www.federalregister.gov/d/2026-30001', agencies: [{ name: 'Labor Department' }, { name: 'Employment and Training Administration' }], ...o });

describe('AI regulation filters (#127)', () => {
  it('keeps EU news on AI or data rules that names an instrument, and drops events and other acts', () => {
    assert.equal(euItem(ds('Commission publishes guidelines on general-purpose AI models under the AI Act'), 'European Commission', { needInstrument: true }).kind, 'guidelines');
    assert.equal(euItem(ds('Commission hosts Apply AI Summit to boost Europe’s AI innovation'), 'European Commission', { needInstrument: true }), null);
    assert.equal(euItem(ds('Commission finds Temu in breach of the Digital Services Act'), 'European Commission', { needInstrument: true }), null);
    assert.equal(euItem({ ...ds('Implementing regulation on AI regulatory sandboxes'), link: 'https://evil.example/x' }, 'EUR-Lex', { needInstrument: false }), null);
  });

  it('reads the CELEX id and kind from EUR-Lex titles', () => {
    const item = euItem({ title: 'CELEX:32026R2601: Commission Implementing Regulation (EU) 2026/2601 laying down rules for the application of Regulation (EU) 2024/1689 as regards AI regulatory sandboxes',
      link: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R2601', pubDate: 'Thu, 19 Nov 2026 09:00:00 +0100' }, 'EUR-Lex', { needInstrument: false });
    assert.equal(item.id, 'celex:32026R2601');
    assert.equal(item.kind, 'implementing act');
    assert.match(item.title, /^Commission Implementing Regulation/);
    assert.equal(euKind('Proposal for a REGULATION on the digital omnibus'), 'proposal');
    const oj = euItem({ title: 'OJ:L_202602650: Commission Implementing Regulation (EU) 2026/2650 applying Regulation (EU) 2024/1689', link: 'https://eur-lex.europa.eu/eli/reg_impl/2026/2650/oj', pubDate: 'Thu, 19 Nov 2026 09:00:00 +0100' }, 'EUR-Lex', { needInstrument: false });
    assert.deepEqual([oj.id, oj.title.slice(0, 10)], ['oj:L_202602650', 'Commission']);
  });

  it('dates an undated item by its first sighting, after a baseline read', () => {
    // The proposals feed (rssId 161) gives no item dates.
    const undated = euItem({ title: 'CELEX:52026PC0640: Proposal for a REGULATION amending Regulation (EU) 2024/1689 (AI Act)', link: 'https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELEX:52026PC0640' }, 'EUR-Lex', { needInstrument: false });
    assert.equal(undated.publishedAt, null);
    const seen = new Set();
    assert.deepEqual(dateUndated([undated], { seen, logIds: new Set(), baseline: true, nowMs: NOW }), [], 'a first read only remembers the ids');
    assert.deepEqual(dateUndated([undated], { seen, logIds: new Set(), baseline: false, nowMs: NOW }), [], 'a remembered id is not new');
    const later = dateUndated([{ ...undated, id: 'celex:52026PC0641' }], { seen, logIds: new Set(), baseline: false, nowMs: NOW });
    assert.deepEqual(later.map((i) => [i.id, i.publishedAt, i.dateKind]), [['celex:52026PC0641', NOW, 'seen']]);
  });

  it('keeps US rules whose title or abstract names AI, with the last agency', () => {
    assert.deepEqual(frItem(fr()), {
      id: 'fr:2026-30001', jurisdiction: 'US', source: 'Federal Register', kind: 'proposed rule',
      title: 'Use of Artificial Intelligence in Federal Benefit Determinations', agency: 'Employment and Training Administration',
      url: 'https://www.federalregister.gov/d/2026-30001', publishedAt: Date.UTC(2026, 10, 18, 14),
    });
    assert.equal(frItem(fr({ title: 'Medicare Program; Payment Policies' })), null, 'a full-text match alone is not enough');
    assert.equal(frItem(fr({ title: 'Payment Policies', abstract: 'This rule addresses the use of artificial intelligence tools.' })).kind, 'proposed rule');
    assert.equal(frItem(fr({ type: 'Notice' })), null);
    const url = new URL(frUrl('2026-10-21'));
    assert.equal(url.searchParams.get('conditions[term]'), '"artificial intelligence"');
    assert.deepEqual(url.searchParams.getAll('conditions[type][]'), ['RULE', 'PRORULE']);
  });
});

describe('AI regulation fetch (#127)', () => {
  const router = ({ dsItems = [ds('Commission publishes guidelines on the AI Act')], oj = [], proposals = [], failFr = false, failAll = false } = {}) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init?.headers?.['User-Agent']]);
      if (failAll) return { ok: false, status: 503 };
      if (url === EU_DIGITAL_URL) return { ok: true, status: 200, text: async () => rss(dsItems) };
      if (url === EURLEX_FEEDS[1].url) return { ok: true, status: 200, text: async () => rss(oj) };
      if (url === EURLEX_FEEDS[0].url) return { ok: true, status: 200, text: async () => rss(proposals).replace(/<pubDate>[^<]*<\/pubDate>/g, '') };
      if (url.startsWith('https://www.federalregister.gov/')) return failFr ? { ok: false, status: 503 } : { ok: true, status: 200, text: async () => JSON.stringify({ results: [fr()] }) };
      return { ok: false, status: 404 };
    };
    return { fetchImpl, calls };
  };

  it('reads every source with a User-Agent and merges them newest first', async () => {
    const { fetchImpl, calls } = router();
    const data = await fetchAiRegulation({ fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    assert.equal(calls.length, 4);
    assert.ok(calls.every(([, ua]) => /WorldMonitor/.test(ua)));
    assert.deepEqual(data.items.map((i) => [i.jurisdiction, i.kind]), [['US', 'proposed rule'], ['EU', 'guidelines']]);
    assert.ok(data.sources.every((s) => s.ok && s.okAt === NOW));
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), 2);
    assert.equal(CANONICAL_KEY, 'policy:ai-regulation:v1');
  });

  it('keeps the log across runs, keeps a failed source\'s last read, and fails only when every source failed', async () => {
    const first = await fetchAiRegulation({ fetchImpl: router().fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    const second = await fetchAiRegulation({ fetchImpl: router({ dsItems: [], failFr: true }).fetchImpl, nowMs: NOW + 2 * 3600_000, loadPrevious: async () => first });
    assert.equal(second.items.length, 2, 'items that left the feeds stay in the log');
    const frSource = second.sources.find((s) => s.id === 'federal-register');
    assert.deepEqual([frSource.ok, frSource.okAt], [false, NOW]);
    await assert.rejects(fetchAiRegulation({ fetchImpl: router({ failAll: true }).fetchImpl, nowMs: NOW, loadPrevious: async () => null }), (e) => /every AI regulation source failed/.test(e.message) && e.nonRetryable === true);
  });

  it('fails when the previous payload cannot be read, so the log is not replaced by an empty success', async () => {
    await assert.rejects(fetchAiRegulation({ fetchImpl: router().fetchImpl, nowMs: NOW, loadPrevious: async () => { throw new Error('Redis GET failed: HTTP 503'); } }), /HTTP 503/);
  });

  it('adds an undated proposal only once the feed has a baseline', async () => {
    const p = (n) => ({ title: `CELEX:52026PC06${n}: Proposal for a REGULATION on artificial intelligence ${n}`, link: `https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELEX:52026PC06${n}`, pubDate: 'x' });
    const first = await fetchAiRegulation({ fetchImpl: router({ proposals: [p(40)] }).fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    assert.ok(!first.items.some((i) => i.dateKind === 'seen'));
    assert.deepEqual(first.undatedSeen, ['celex:52026PC0640']);
    const second = await fetchAiRegulation({ fetchImpl: router({ proposals: [p(41), p(40)] }).fetchImpl, nowMs: NOW + 3600_000, loadPrevious: async () => first });
    assert.deepEqual(second.items.filter((i) => i.dateKind === 'seen').map((i) => [i.id, i.publishedAt]), [['celex:52026PC0641', NOW + 3600_000]]);
    assert.deepEqual(second.undatedSeen, ['celex:52026PC0641', 'celex:52026PC0640']);
  });

  it('fails the run once a source has been unread longer than the health budget', async () => {
    const previous = { startedAt: NOW - 30 * DAY, items: [], sources: [{ id: 'federal-register', okAt: NOW - 7 * 3600_000 }] };
    await assert.rejects(fetchAiRegulation({ fetchImpl: router({ failFr: true }).fetchImpl, nowMs: NOW, loadPrevious: async () => previous }), (e) => /Federal Register not read since/.test(e.message) && e.nonRetryable === true);
  });

  it('drops log entries past 60 days and keeps the first sighting time', () => {
    const log = mergeLog([{ id: 'a', publishedAt: NOW - DAY, seenAt: NOW }], [{ id: 'a', publishedAt: NOW - DAY, seenAt: NOW - DAY }, { id: 'old', publishedAt: NOW - 61 * DAY }], NOW);
    assert.deepEqual(log.map((i) => [i.id, i.seenAt]), [['a', NOW - DAY]]);
  });
});
