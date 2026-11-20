import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isAiName,
  CANONICAL_KEY,
  FUNDING_WINDOW_DAYS,
  declareRecords,
  fetchAiFunding,
  parseFormD,
  validateFn,
} from '../scripts/seed-ai-funding.mjs';

const NOW = Date.UTC(2026, 10, 20, 8);

// A Form D primary document (primary_doc.xml, schema X0708) as the live Nadhi AI notice (0002161778-26-000001) has it:
// the issuer's address, an industry group, the date of first sale, and the offering amounts.
const doc = ({ name = 'Nadhi AI, Inc.', industry = 'Other Technology', fundType = '', offering = '21140000', sold = '21139989', firstSale = '2026-10-26', state = 'CA' } = {}) => `<?xml version="1.0"?>
<edgarSubmission>
  <schemaVersion>X0708</schemaVersion>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0002161778</cik>
    <entityName>${name}</entityName>
    <issuerAddress><street1>1 Main St</street1><city>Fremont</city><stateOrCountry>${state}</stateOrCountry><stateOrCountryDescription>CALIFORNIA</stateOrCountryDescription><zipCode>94538</zipCode></issuerAddress>
    <entityType>Corporation</entityType>
    <yearOfInc><value>2026</value></yearOfInc>
  </primaryIssuer>
  <relatedPersonsList><relatedPersonInfo><relatedPersonAddress><stateOrCountry>NY</stateOrCountry></relatedPersonAddress></relatedPersonInfo></relatedPersonsList>
  <offeringData>
    <industryGroup><industryGroupType>${industry}</industryGroupType>${fundType ? `<investmentFundInfo><investmentFundType>${fundType}</investmentFundType></investmentFundInfo>` : ''}</industryGroup>
    <typeOfFiling><newOrAmendment><isAmendment>false</isAmendment></newOrAmendment><dateOfFirstSale><value>${firstSale}</value></dateOfFirstSale></typeOfFiling>
    <offeringSalesAmounts><totalOfferingAmount>${offering}</totalOfferingAmount><totalAmountSold>${sold}</totalAmountSold><totalRemaining>11</totalRemaining></offeringSalesAmounts>
  </offeringData>
</edgarSubmission>`;
const hit = (adsh, name, { form = 'D', fileDate = '2026-11-19', cik = adsh.slice(0, 10) } = {}) => ({ _id: `${adsh}:primary_doc.xml`, _source: { ciks: [cik], display_names: [`${name}  (CIK ${cik})`], form, root_forms: ['D'], file_date: fileDate, adsh } });

/** EFTS answers by query; documents by accession folder; anything else 404. */
const router = ({ ai = [], phrase = [], docs = {}, status = 200, docStatus = {} } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    if (url.startsWith('https://efts.sec.gov/')) {
      const q = new URL(url).searchParams.get('q');
      const hits = q === 'AI' ? ai : phrase;
      return { ok: status === 200, status, json: async () => ({ hits: { total: { value: hits.length }, hits } }) };
    }
    const folder = /\/data\/\d+\/(\d{18})\/primary_doc\.xml$/.exec(url)?.[1];
    const code = docStatus[folder] ?? (docs[folder] ? 200 : 404);
    return { ok: code === 200, status: code, text: async () => docs[folder] ?? '' };
  };
  return { fetchImpl, calls };
};
const folder = (adsh) => adsh.replace(/-/g, '');

describe('Form D parsing (#142)', () => {
  it('reads the issuer, industry, offering, first sale and the issuer\'s state (not a related person\'s)', () => {
    assert.deepEqual(parseFormD(doc()), {
      entityName: 'Nadhi AI, Inc.', industry: 'Other Technology', fund: false, fundType: '', offering: 21_140_000, sold: 21_139_989, firstSale: '2026-10-26', state: 'CA',
    });
    const fund = parseFormD(doc({ name: 'AI Frontier Fund LP', industry: 'Pooled Investment Fund', fundType: 'Venture Capital Fund', offering: 'Indefinite', sold: '7400000', state: 'DE' }));
    assert.deepEqual([fund.fund, fund.fundType, fund.offering, fund.sold, fund.state], [true, 'Venture Capital Fund', null, 7_400_000, 'DE']);
    assert.equal(parseFormD(doc({ name: 'Smith &amp; Jones AI LLC' })).entityName, 'Smith & Jones AI LLC');
    // A character code beyond Unicode decodes to nothing instead of throwing.
    assert.equal(parseFormD(doc({ name: 'Bad&#99999999; AI Inc' })).entityName, 'Bad AI Inc');
  });

  it('keeps issuers with AI in their name', () => {
    for (const n of ['Harvey AI Corp', '7AI, Inc.', 'BlackTower Ai Inc', 'Delta Bravo Artificial Intelligence, Inc.', 'A.I. Ventures LLC', 'OpenAI Global LLC']) assert.ok(isAiName(n), n);
    // Words that end in "ai" are not AI (reviewer finding).
    for (const n of ['Patriot Oil Mills Corp.', 'Future Star Business School Ltd', 'Maine Holdings', 'Kaizen Partners', 'Shanghai Growth Fund LP', 'Mumbai Partners LLC', 'Bonsai Capital', 'Samurai Holdings', 'Thai Fund', 'Dubai Ventures']) assert.ok(!isAiName(n), n);
  });
});

describe('AI funding fetch (#142)', () => {
  const pathos = '0002093123-26-000002';
  const nadhi = '0002161778-26-000001';
  const fundAdsh = '0002162184-26-000001';

  it('searches both queries over the window, keeps AI-named new notices, and reads each document with the SEC User-Agent', async () => {
    const { fetchImpl, calls } = router({
      ai: [hit(pathos, 'Pathos AI, Inc.'), hit(nadhi, 'Nadhi AI, Inc.', { fileDate: '2026-11-06' }), hit('0001111111-26-000009', 'Patriot Oil Mills Corp.'), hit('0002222222-26-000001', 'Old AI Co', { form: 'D/A' })],
      phrase: [hit(pathos, 'Pathos AI, Inc.'), hit(fundAdsh, 'AI Frontier Fund LP', { fileDate: '2026-11-13' })],
      docs: {
        [folder(pathos)]: doc({ name: 'Pathos AI, Inc.', industry: 'Biotechnology', offering: '300000000', sold: '238000000', state: 'IL' }),
        [folder(nadhi)]: doc(),
        [folder(fundAdsh)]: doc({ name: 'AI Frontier Fund LP', industry: 'Pooled Investment Fund', fundType: 'Venture Capital Fund', offering: 'Indefinite', sold: '7400000' }),
      },
    });
    const data = await fetchAiFunding({ fetchImpl, nowMs: NOW, gapMs: 0 });
    const searches = calls.filter(([u]) => u.startsWith('https://efts.sec.gov/'));
    assert.equal(searches.length, 2);
    assert.ok(searches.every(([u]) => u.includes('forms=D') && u.includes('startdt=2026-11-06') && u.includes('enddt=2026-11-20')));
    assert.ok(calls.every(([, ua]) => ua === 'WorldMonitor/2.0 (monitor@worldmonitor.app)'));
    assert.deepEqual([data.searched, data.named, data.docErrors, data.windowDays], [4, 3, 0, FUNDING_WINDOW_DAYS]);
    assert.deepEqual(data.filings.map((f) => [f.adsh, f.name, f.fileDate, f.offering, f.sold, f.fund]), [
      [pathos, 'Pathos AI, Inc.', '2026-11-19', 300_000_000, 238_000_000, false],
      [fundAdsh, 'AI Frontier Fund LP', '2026-11-13', null, 7_400_000, true],
      [nadhi, 'Nadhi AI, Inc.', '2026-11-06', 21_140_000, 21_139_989, false],
    ]);
    assert.equal(data.filings[0].url, `https://www.sec.gov/Archives/edgar/data/2093123/${folder(pathos)}/${pathos}-index.htm`);
    assert.ok(validateFn(data));
    assert.equal(declareRecords(data), 4);
    assert.equal(CANONICAL_KEY, 'tech:ai-funding:v1');
  });

  it('falls back to the accession prefix\'s folder when the filer\'s CIK has none', async () => {
    const adsh = '0001999999-26-000123';
    const { fetchImpl, calls } = router({ ai: [hit(adsh, 'Agent Filed AI Inc', { cik: '0002000001' })], docs: { [folder(adsh)]: doc({ name: 'Agent Filed AI Inc' }) } });
    // The router serves the document under any CIK; make the filer's CIK 404 so the fallback is exercised.
    const strict = async (url, init) => (url.includes('/data/2000001/') ? { ok: false, status: 404, text: async () => '' } : fetchImpl(url, init));
    const data = await fetchAiFunding({ fetchImpl: strict, nowMs: NOW, gapMs: 0 });
    assert.equal(data.filings[0]?.url, `https://www.sec.gov/Archives/edgar/data/1999999/${folder(adsh)}/${adsh}-index.htm`);
    assert.ok(calls.some(([u]) => u.includes('/data/1999999/')));
  });

  it('skips an unreadable document, but fails when most are unreadable or the search fails', async () => {
    const ids = ['0000000001-26-000001', '0000000002-26-000001', '0000000003-26-000001', '0000000004-26-000001'];
    const ai = ids.map((a, i) => hit(a, `Test ${i} AI Inc`));
    const docs = Object.fromEntries(ids.map((a) => [folder(a), doc()]));
    const one = await fetchAiFunding({ fetchImpl: router({ ai, docs, docStatus: { [folder(ids[0])]: 500 } }).fetchImpl, nowMs: NOW, gapMs: 0 });
    assert.deepEqual([one.filings.length, one.docErrors], [3, 1]);
    await assert.rejects(fetchAiFunding({ fetchImpl: router({ ai, docs, docStatus: Object.fromEntries(ids.slice(0, 3).map((a) => [folder(a), 403])) }).fetchImpl, nowMs: NOW, gapMs: 0 }), /3 of 4 unreadable/);
    await assert.rejects(fetchAiFunding({ fetchImpl: router({ ai, docs, status: 503 }).fetchImpl, nowMs: NOW, gapMs: 0 }), /HTTP 503 from efts\.sec\.gov/);
    // One AI-named filing, unreadable: fail rather than publish a window that looks quiet (reviewer finding).
    await assert.rejects(fetchAiFunding({ fetchImpl: router({ ai: [ai[0]], docs, docStatus: { [folder(ids[0])]: 429 } }).fetchImpl, nowMs: NOW, gapMs: 0 }), /1 of 1 unreadable/);
    // Malformed hits (no date, a bad accession number, no CIK) are skipped, not published.
    const odd = await fetchAiFunding({ fetchImpl: router({ ai: [hit(ids[0], 'Test AI Inc', { fileDate: 'soon' }), hit('../../x', 'Path AI Inc'), { _source: { ...hit(ids[1], 'No CIK AI Inc')._source, ciks: [] } }, hit(ids[2], 'Fine AI Inc')], docs }).fetchImpl, nowMs: NOW, gapMs: 0 });
    assert.deepEqual(odd.filings.map((f) => f.adsh), [ids[2]]);
    assert.ok(validateFn(odd));
    const quiet = await fetchAiFunding({ fetchImpl: router().fetchImpl, nowMs: NOW, gapMs: 0 });
    assert.deepEqual([quiet.searched, quiet.filings.length], [0, 0]);
    assert.ok(validateFn(quiet));
  });
});
