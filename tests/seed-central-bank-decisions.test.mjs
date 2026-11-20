import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  DECISIONS_KEPT,
  ECB_FEED_URL,
  FED_FEED_URL,
  SOURCE_MAX_AGE_MIN,
  declareRecords,
  ecbDecisionItems,
  fedDecisionItems,
  fedNumber,
  fetchCentralBankDecisions,
  mergeDecisions,
  pageText,
  parseEcbRelease,
  parseFedStatement,
  validateFn,
} from '../scripts/seed-central-bank-decisions.mjs';

const NOW = Date.UTC(2026, 9, 29, 15); // 29 Oct 2026, 15:00 UTC
const H = 3_600_000;

// The live pages' wording (2026-11-20), trimmed: federalreserve.gov monetary20261028a.htm and 20260916a.htm,
// ecb.europa.eu ecb.mp260910 and ecb.mp260205.
const FED_HOLD = `<html><head><title>Federal Reserve Board - Federal Reserve issues FOMC statement</title><script>var x = 'The Committee decided to lower';</script></head><body>
<p class="article__time">October 28, 2026</p><p>For release at 2:00 p.m. EDT</p>
<p>The Federal Open Market Committee approved the following statement for release by a 10 &ndash; 2 vote:</p>
<p>The Committee decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent, in support of the Federal Reserve's dual mandate. The Committee is continuing its policy of maintaining ample reserves in the banking system.</p>
<p>Voting against the monetary policy action were Lisa D. Cook and Beth M. Hammack, who preferred to raise the target range for the federal funds rate by 1/4 percentage point at this meeting.</p>
<p>For media inquiries, please email media@example.org.</p></body></html>`;
const FED_HIKE = FED_HOLD
  .replace('10 &ndash; 2 vote', '12 &ndash; 0 vote')
  .replace('decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent', 'decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent')
  .replace(/<p>Voting against[\s\S]*?<\/p>/, '');
const FED_CUT_OLD_STYLE = `<p>The Committee decided to lower the target range for the federal funds rate by 1/2 percentage point to 4-3/4 to 5 percent.</p>
<p>Voting for the monetary policy action were Jerome H. Powell, Chair; John C. Williams, Vice Chair. Voting against this action was Michelle W. Bowman, who preferred to lower the target range by 1/4 percentage point at this meeting.</p>`;
const ECB_HIKE = `<html><head><title>Monetary policy decisions</title></head><body><nav>Key ECB interest rates Euro short-term rate</nav>
<h1>Monetary policy decisions</h1><p>10 September 2026</p>
<p>The Governing Council today decided to raise the three key ECB interest rates by 25 basis points. The conflict in the Middle East continues to push up inflation.</p>
<h3>Key ECB interest rates</h3>
<p>The Governing Council decided to raise the three key ECB interest rates by 25 basis points. Accordingly, the interest rates on the deposit facility, the main refinancing operations and the marginal lending facility will be increased to 2.50%, 2.65% and 2.90% respectively, with effect from 16 September 2026.</p></body></html>`;
const ECB_HOLD = `<h1>Monetary policy decisions</h1><p>The Governing Council today decided to keep the three key ECB interest rates unchanged.</p>
<p>The interest rates on the deposit facility, the main refinancing operations and the marginal lending facility will remain unchanged at 2.00%, 2.15% and 2.40% respectively.</p>`;

const FED_RSS = `<?xml version="1.0"?><rss><channel><title>FRB: Press Release - Monetary Policy</title>
<item><title>Minutes of the Federal Open Market Committee, September 15-16, 2026</title><link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20261007a.htm]]></link><pubDate><![CDATA[Wed, 7 Oct 2026 18:00:00 GMT]]></pubDate></item>
<item><title>Federal Reserve issues FOMC statement</title><link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm]]></link><pubDate><![CDATA[Wed, 28 Oct 2026 18:00:00 GMT]]></pubDate></item>
<item><title>Federal Reserve issues FOMC statement</title><link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm]]></link><pubDate><![CDATA[Wed, 16 Sep 2026 18:00:00 GMT]]></pubDate></item>
<item><title>Federal Reserve issues FOMC statement</title><link><![CDATA[https://evil.example/monetary20260916a.htm]]></link><pubDate><![CDATA[Wed, 16 Sep 2026 18:00:00 GMT]]></pubDate></item>
</channel></rss>`;
const ECB_RSS = `<?xml version="1.0"?><rss><channel><title>ECB - European Central Bank</title>
<item><title> Christine Lagarde: Acting in time</title><link>https://www.ecb.europa.eu//press/key/date/2026/html/ecb.sp261120~e52bcc4db2.en.html</link><pubDate>Fri, 20 Nov 2026 09:30:00 +0100</pubDate></item>
<item><title> Monetary policy decisions</title><link>https://www.ecb.europa.eu//press/pr/date/2026/html/ecb.mp261029~5b1e9a2c11.en.html</link><pubDate>Thu, 29 Oct 2026 14:15:00 +0100</pubDate></item>
<item><title> Monetary policy statement</title><link>https://www.ecb.europa.eu//press/press_conference/monetary-policy-statement/2026/html/ecb.is261029~1.en.html</link><pubDate>Thu, 29 Oct 2026 14:45:00 +0100</pubDate></item>
</channel></rss>`;

/** A fetch that answers each URL from a table; a missing URL is a 404. */
const router = (table) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    const hit = table[url];
    if (hit instanceof Error) throw hit;
    const status = typeof hit === 'number' ? hit : hit == null ? 404 : 200;
    return { ok: status === 200, status, headers: new Headers(), text: async () => (typeof hit === 'string' ? hit : '') };
  };
  return { fetchImpl, calls };
};
const FED_1028 = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm';
const FED_0916 = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm';
const ECB_1029 = 'https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp261029~5b1e9a2c11.en.html';

describe('central bank decision parsing (#130)', () => {
  it('reads the FOMC decision, the range, the vote and the dissent', () => {
    assert.deepEqual(parseFedStatement(pageText(FED_HOLD)), {
      action: 'hold', changeBp: 0, rate: 4, rateText: '3.75–4.00%', rateLabel: 'target range', votes: '10–2',
      dissent: 'Lisa D. Cook and Beth M. Hammack, who preferred to raise the target range for the federal funds rate by 1/4 percentage point at this meeting',
      summary: "The Committee decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent, in support of the Federal Reserve's dual mandate.",
    });
    const hike = parseFedStatement(pageText(FED_HIKE));
    assert.deepEqual([hike.action, hike.changeBp, hike.rateText, hike.votes, hike.dissent], ['hike', 25, '3.75–4.00%', '12–0', null]);
    // The older wording: a cut, no vote count, one dissenter.
    const cut = parseFedStatement(pageText(FED_CUT_OLD_STYLE));
    assert.deepEqual([cut.action, cut.changeBp, cut.rate, cut.votes, cut.dissent?.slice(0, 18)], ['cut', -50, 5, null, 'Michelle W. Bowman']);
    assert.equal(parseFedStatement('The Committee will continue to monitor the implications of incoming information.'), null);
    assert.deepEqual(['3-3/4', '4', '1/4', '1-1/2', 'x'].map(fedNumber), [3.75, 4, 0.25, 1.5, null]);
  });

  it('reads the ECB decision and the three key rates', () => {
    const hike = parseEcbRelease(pageText(ECB_HIKE));
    assert.deepEqual([hike.action, hike.changeBp, hike.rate, hike.rateText], ['hike', 25, 2.5, '2.50%']);
    assert.equal(hike.summary, 'The Governing Council today decided to raise the three key ECB interest rates by 25 basis points. Deposit facility 2.50%, main refinancing 2.65%, marginal lending 2.90%, from 16 September 2026.');
    const hold = parseEcbRelease(pageText(ECB_HOLD));
    assert.deepEqual([hold.action, hold.changeBp, hold.rate], ['hold', 0, 2]);
    assert.equal(parseEcbRelease('The Governing Council met today.'), null);
  });

  it('keeps only decision items with the banks\' own links', () => {
    assert.deepEqual(fedDecisionItems(FED_RSS).map((i) => [i.url, new Date(i.at).toISOString()]), [
      [FED_1028, '2026-10-28T18:00:00.000Z'], [FED_0916, '2026-09-16T18:00:00.000Z'],
    ]);
    assert.deepEqual(ecbDecisionItems(ECB_RSS).map((i) => [i.url, new Date(i.at).toISOString()]), [[ECB_1029, '2026-10-29T13:15:00.000Z']]);
  });
});

describe('central bank decision fetch (#130)', () => {
  const table = { [FED_FEED_URL]: FED_RSS, [ECB_FEED_URL]: ECB_RSS, [FED_1028]: FED_HOLD, [FED_0916]: FED_HIKE, [ECB_1029]: ECB_HOLD };

  it('reads each new decision page once and keeps the log across runs', async () => {
    const { fetchImpl, calls } = router(table);
    const first = await fetchCentralBankDecisions({ fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    assert.match(calls[0][1], /WorldMonitor/);
    assert.deepEqual(first.decisions.map((d) => [d.bank, d.action, d.parsed]), [['ecb', 'hold', true], ['fed', 'hold', true], ['fed', 'hike', true]]);
    assert.deepEqual([first.sources.fed.ok, first.sources.ecb.ok, first.sources.ecb.okAt], [true, true, NOW]);
    assert.equal(validateFn(first), true);
    assert.equal(declareRecords(first), 3);
    assert.equal(CANONICAL_KEY, 'economic:central-bank-decisions:v1');
    // The next run reads no page; the ECB item has left its feed but stays in the log.
    const later = router({ ...table, [ECB_FEED_URL]: ECB_RSS.replace(/<item><title> Monetary policy decisions[\s\S]*?<\/item>/, '') });
    const second = await fetchCentralBankDecisions({ fetchImpl: later.fetchImpl, nowMs: NOW + 24 * H, loadPrevious: async () => first });
    assert.deepEqual(later.calls.map(([u]) => u).sort(), [ECB_FEED_URL, FED_FEED_URL].sort());
    assert.equal(second.decisions.length, 3);
  });

  it('keeps an unread page as "decision out" and reads it again on the next run', async () => {
    const down = router({ ...table, [ECB_1029]: 503 });
    const first = await fetchCentralBankDecisions({ fetchImpl: down.fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    const ecb = first.decisions.find((d) => d.bank === 'ecb');
    assert.deepEqual([ecb.parsed, ecb.action, ecb.url], [false, null, ECB_1029]);
    const up = router(table);
    const second = await fetchCentralBankDecisions({ fetchImpl: up.fetchImpl, nowMs: NOW + H, loadPrevious: async () => first });
    assert.ok(up.calls.some(([u]) => u === ECB_1029));
    assert.deepEqual(second.decisions.find((d) => d.bank === 'ecb').action, 'hold');
    // A parsed reading is never replaced by an unread one.
    assert.equal(mergeDecisions([{ ...ecb, at: ecb.at }], second.decisions).find((d) => d.bank === 'ecb').parsed, true);
  });

  it('keeps a failed feed\'s decisions for a while, then fails the run; a failed log read fails it at once', async () => {
    const first = await fetchCentralBankDecisions({ fetchImpl: router(table).fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    const ecbDown = router({ ...table, [ECB_FEED_URL]: 500 });
    const soon = await fetchCentralBankDecisions({ fetchImpl: ecbDown.fetchImpl, nowMs: NOW + H, loadPrevious: async () => first });
    assert.deepEqual([soon.sources.ecb.ok, soon.sources.ecb.okAt, soon.decisions.some((d) => d.bank === 'ecb')], [false, NOW, true]);
    await assert.rejects(
      fetchCentralBankDecisions({ fetchImpl: ecbDown.fetchImpl, nowMs: NOW + (SOURCE_MAX_AGE_MIN + 1) * 60_000, loadPrevious: async () => soon }),
      /ecb feed failed \(HTTP 500 from www\.ecb\.europa\.eu\) and was last read/,
    );
    await assert.rejects(fetchCentralBankDecisions({ fetchImpl: ecbDown.fetchImpl, nowMs: NOW, loadPrevious: async () => null }), /has no earlier read/);
    // A 200 that is not the feed (a maintenance or challenge page) is a failed read, not an empty one.
    const notFeed = router({ ...table, [ECB_FEED_URL]: '<html><body>Service temporarily unavailable</body></html>' });
    const held = await fetchCentralBankDecisions({ fetchImpl: notFeed.fetchImpl, nowMs: NOW + H, loadPrevious: async () => first });
    assert.deepEqual([held.sources.ecb.ok, held.sources.ecb.okAt, held.sources.ecb.error], [false, NOW, 'www.ecb.europa.eu answered without RSS items']);
    await assert.rejects(fetchCentralBankDecisions({ fetchImpl: router(table).fetchImpl, nowMs: NOW, loadPrevious: async () => { throw new Error('canonical read failed: HTTP 503'); } }), /canonical read failed/);
  });

  it('stops reading pages before the fetch deadline and reads the rest on the next run, whatever their age', async () => {
    let t = 0;
    const clock = () => t;
    const slow = router(table);
    const fetchImpl = async (...args) => { t += 10_000; return slow.fetchImpl(...args); };
    // Room for the two feeds and one page (each page needs 25 s of headroom).
    const first = await fetchCentralBankDecisions({ fetchImpl, nowMs: NOW, loadPrevious: async () => null, clock, fetchDeadlineAtMs: 50_000 });
    assert.deepEqual(first.decisions.map((d) => [d.bank, d.parsed, d.tries]), [['ecb', true, 1], ['fed', false, 0], ['fed', false, 0]]);
    // Ten days later the never-read pages are still read (no try yet), though they are past the retry window.
    const next = await fetchCentralBankDecisions({ fetchImpl: router(table).fetchImpl, nowMs: NOW + 10 * 24 * H, loadPrevious: async () => first });
    assert.deepEqual(next.decisions.map((d) => [d.bank, d.parsed]), [['ecb', true], ['fed', true], ['fed', true]]);
    // A page that failed once is not read again past the retry window.
    const failed = { ...first, decisions: first.decisions.map((d) => (d.bank === 'fed' ? { ...d, tries: 1 } : d)) };
    const later = router(table);
    await fetchCentralBankDecisions({ fetchImpl: later.fetchImpl, nowMs: NOW + 10 * 24 * H, loadPrevious: async () => failed });
    assert.deepEqual(later.calls.map(([u]) => u).sort(), [ECB_FEED_URL, FED_FEED_URL].sort());
  });

  it('keeps the newest decisions per bank', () => {
    const many = Array.from({ length: DECISIONS_KEPT + 3 }, (_, i) => ({ bank: 'fed', url: `${FED_1028}?${i}`, at: NOW - i * 45 * 24 * H, parsed: true, action: 'hold' }));
    const kept = mergeDecisions(many, [{ bank: 'ecb', url: ECB_1029, at: NOW - 400 * 24 * H, parsed: true, action: 'hold' }]);
    assert.equal(kept.filter((d) => d.bank === 'fed').length, DECISIONS_KEPT);
    assert.equal(kept.filter((d) => d.bank === 'ecb').length, 1);
    assert.equal(kept[0].url, `${FED_1028}?0`);
  });
});
