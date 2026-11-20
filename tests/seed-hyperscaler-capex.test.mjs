import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  COMPANIES,
  MIN_QUARTERS,
  conceptUrl,
  declareRecords,
  fetchHyperscalerCapex,
  quarterly,
  validateFn,
} from '../scripts/seed-hyperscaler-capex.mjs';

const NOW = Date.UTC(2026, 10, 20, 12);
const fact = (start, end, val, filed, form = '10-Q', accn = '0001652044-26-000100') => ({ start, end, val, filed, form, accn, fy: 2026, fp: 'Q3' });

// Alphabet-style: Q1 as three months, Q2 and Q3 only as six and nine months to date, Q4 only as the full year (10-K).
const alphabet2025 = [
  fact('2025-01-01', '2025-03-31', 17_197_000_000, '2025-04-25'),
  fact('2025-01-01', '2025-06-30', 39_643_000_000, '2025-07-24'),
  fact('2025-01-01', '2025-09-30', 63_596_000_000, '2025-10-30'),
  fact('2025-01-01', '2025-12-31', 91_447_000_000, '2026-02-05', '10-K', '0001652044-26-000018'),
];
const alphabet2026 = [
  fact('2026-01-01', '2026-03-31', 35_674_000_000, '2026-04-30'),
  fact('2026-01-01', '2026-06-30', 80_598_000_000, '2026-07-23'),
  fact('2026-01-01', '2026-09-30', 131_953_000_000, '2026-10-29', '10-Q', '0001652044-26-000123'),
];

describe('Hyperscaler capital spending quarters (#135)', () => {
  it('reads three-month figures and computes the others from year-to-date figures', () => {
    const qs = quarterly([...alphabet2025, ...alphabet2026]);
    assert.deepEqual(qs.map((q) => [q.end, q.value, q.derived]), [
      ['2026-09-30', 51_355_000_000, true],
      ['2026-06-30', 44_924_000_000, true],
      ['2026-03-31', 35_674_000_000, false],
      ['2025-12-31', 27_851_000_000, true], // the full year less nine months
      ['2025-09-30', 23_953_000_000, true],
      ['2025-06-30', 22_446_000_000, true],
      ['2025-03-31', 17_197_000_000, false],
    ]);
    assert.deepEqual(qs[0], { start: '2026-07-01', end: '2026-09-30', value: 51_355_000_000, filed: '2026-10-29', form: '10-Q', accn: '0001652044-26-000123', derived: true });
    assert.equal(qs[3].form, '10-K');
  });

  it('takes a restated value and its filing from the newer filing but dates the quarter by the first, and skips other forms and trailing twelve months', () => {
    const qs = quarterly([
      fact('2026-07-01', '2026-09-30', 77_000_000_000, '2026-10-30', '10-Q', '0001018724-26-000030'),
      fact('2026-07-01', '2026-09-30', 77_259_000_000, '2027-10-30', '10-Q', '0001018724-27-000030'), // next year's comparative
      fact('2026-04-01', '2026-06-30', 54_208_000_000, '2026-07-31', '8-K'), // not a 10-Q or 10-K
      fact('2025-10-01', '2026-09-30', 215_192_000_000, '2026-10-30'), // trailing twelve months
      fact('2025-10-01', '2025-12-31', 39_500_000_000, '2026-02-06', '10-K'),
      { start: '2026-01-01', end: '2026-03-31', val: 'n/a', filed: '2026-04-30', form: '10-Q' },
    ]);
    assert.deepEqual(qs.map((q) => [q.end, q.value, q.filed, q.accn]), [
      ['2026-09-30', 77_259_000_000, '2026-10-30', '0001018724-27-000030'], // the link shows the number on the card
      ['2025-12-31', 39_500_000_000, '2026-02-06', '0001652044-26-000100'],
    ]);
  });
});

const company = (name) => COMPANIES.find((c) => c.name === name);
const conceptBody = (facts) => JSON.stringify({ cik: 1, taxonomy: 'us-gaap', units: { USD: facts } });
const router = (table) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    const hit = table[url];
    const status = typeof hit === 'number' ? hit : hit == null ? 404 : 200;
    const body = typeof hit === 'string' ? hit : '';
    return { ok: status === 200, status, headers: new Headers(), text: async () => body };
  };
  return { fetchImpl, calls };
};
const fullTable = (facts = [...alphabet2025, ...alphabet2026]) => Object.fromEntries(COMPANIES.map((c) => [conceptUrl(c.cik, c.concept), conceptBody(facts)]));

describe('Hyperscaler capital spending doubts (#135)', () => {
  // Every quarter is 10 on the old basis. The Q3 2026 10-Q moves to a new basis (+5 a quarter) and restates nine months
  // of 2025 with it, while six months of both years stay as the Q2 filings reported them.
  const accn = (n) => `0001652044-2${n}`;
  const basis = [
    fact('2025-01-01', '2025-03-31', 10, '2025-04-25', '10-Q', accn('5-000001')),
    fact('2025-01-01', '2025-06-30', 20, '2025-07-24', '10-Q', accn('5-000002')),
    fact('2025-01-01', '2025-09-30', 30, '2025-10-30', '10-Q', accn('5-000003')),
    fact('2026-01-01', '2026-03-31', 10, '2026-04-30', '10-Q', accn('6-000001')),
    fact('2025-01-01', '2025-06-30', 20, '2026-07-23', '10-Q', accn('6-000002')),
    fact('2026-01-01', '2026-06-30', 20, '2026-07-23', '10-Q', accn('6-000002')),
    fact('2025-01-01', '2025-09-30', 45, '2026-10-29', '10-Q', accn('6-000003')),
    fact('2026-01-01', '2026-09-30', 45, '2026-10-29', '10-Q', accn('6-000003')),
  ];

  it('marks a quarter whose year-to-date figures are on two bases, and keeps the quarters on one basis', () => {
    assert.deepEqual(quarterly(basis).map((q) => [q.end, q.value, q.doubt ?? null]), [
      ['2026-09-30', 25, 'restated'], // 45 - 20 across the bases; the true quarter is 15
      ['2026-06-30', 10, null],
      ['2026-03-31', 10, null],
      ['2025-09-30', 25, 'restated'],
      ['2025-06-30', 10, null],
      ['2025-03-31', 10, null],
    ]);
    // Without the restatement the same figures raise no doubt.
    const unrestated = basis.filter((f) => !(f.end === '2025-09-30' && f.val === 45));
    assert.deepEqual(quarterly(unrestated).filter((q) => q.doubt), []);
  });

  it('keeps a negative quarter from year-to-date figures, marked, instead of dropping the newest quarter', () => {
    const qs = quarterly([...alphabet2026.slice(0, 2), fact('2026-01-01', '2026-09-30', 70_000_000_000, '2026-10-29')]);
    assert.deepEqual([qs[0].end, qs[0].value, qs[0].doubt], ['2026-09-30', -10_598_000_000, 'negative']);
  });
});

describe('Hyperscaler capital spending fetch (#135)', () => {
  it('reads each company\'s concept with the SEC User-Agent and keeps the newest quarters', async () => {
    const { fetchImpl, calls } = router(fullTable());
    const data = await fetchHyperscalerCapex({ fetchImpl, nowMs: NOW, gapMs: 0 });
    assert.deepEqual(calls.map(([u]) => u), COMPANIES.map((c) => conceptUrl(c.cik, c.concept)));
    assert.equal(conceptUrl(company('Amazon').cik, company('Amazon').concept), 'https://data.sec.gov/api/xbrl/companyconcept/CIK0001018724/us-gaap/PaymentsToAcquireProductiveAssets.json');
    assert.ok(calls.every(([, ua]) => /^WorldMonitor\/\S+ \(monitor@worldmonitor\.app\)$/.test(ua)), 'a declared User-Agent with the project contact');
    assert.deepEqual(data.companies.map((c) => [c.ticker, c.quarters.length, c.quarters[0].end]), [['MSFT', 7, '2026-09-30'], ['GOOGL', 7, '2026-09-30'], ['AMZN', 7, '2026-09-30'], ['META', 7, '2026-09-30']]);
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), 28);
    assert.equal(CANONICAL_KEY, 'tech:hyperscaler-capex:v1');
    assert.equal(validateFn({ ...data, companies: data.companies.slice(1) }), false, 'every company present');
  });

  it('fails on an HTTP error or a non-JSON answer, and refuses too few quarters or a concept the company stopped tagging', async () => {
    const msft = conceptUrl(company('Microsoft').cik, company('Microsoft').concept);
    await assert.rejects(fetchHyperscalerCapex({ fetchImpl: router({ ...fullTable(), [msft]: 503 }).fetchImpl, nowMs: NOW, gapMs: 0 }), /Microsoft: HTTP 503/);
    await assert.rejects(fetchHyperscalerCapex({ fetchImpl: router({ ...fullTable(), [msft]: '<html>' }).fetchImpl, nowMs: NOW, gapMs: 0 }), /other than JSON/);
    await assert.rejects(
      fetchHyperscalerCapex({ fetchImpl: router({ ...fullTable(), [msft]: conceptBody(alphabet2026) }).fetchImpl, nowMs: NOW, gapMs: 0 }),
      (e) => new RegExp(`Microsoft: 3 quarters .* at least ${MIN_QUARTERS}`).test(e.message) && e.nonRetryable === true,
    );
    // Amazon's old tag stops in 2017: its latest quarter is years old.
    const old = [...alphabet2025, ...alphabet2026].map((f) => ({ ...f, start: f.start.replace(/^202[56]/, (y) => String(Number(y) - 9)), end: f.end.replace(/^202[56]/, (y) => String(Number(y) - 9)) }));
    await assert.rejects(
      fetchHyperscalerCapex({ fetchImpl: router({ ...fullTable(), [msft]: conceptBody(old) }).fetchImpl, nowMs: NOW, gapMs: 0 }),
      (e) => /latest .* quarter ends 2017-09-30/.test(e.message) && e.nonRetryable === true,
    );
  });
});
