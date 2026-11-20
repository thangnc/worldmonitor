import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  MIN_TOTAL_ENTRIES,
  calendarCountryCode,
  declareRecords,
  fetchElections,
  parseCalendar,
  validateFn,
} from '../scripts/seed-elections.mjs';

const NOW = Date.UTC(2026, 10, 20, 8);

// The "<year> national electoral calendar" wikitext shape, as the live 2026 and 2027 pages (read 2026-11-20) have it:
// one month section each, a dated line with its entry, or a dated line followed by `**` entries; refs inline; italics
// for territories and partly recognised states; month-only entries; a non-month section after December.
const PAGE_2026 = `{{Short description|none}}
Intro text.
==January==
* 12 January: [[Elections in Uganda|Uganda]], [[2026 Ugandan general election|President and Parliament]]<ref name="Uganda">[https://www.ec.or.ug EC Uganda]</ref>
==September==
* 18–20 September: [[Elections in Russia|Russia]], [[2026 Russian legislative election|State Duma]]<ref>{{Cite web |title=Duma |url=https://example.org}}</ref>
* 18 September: ''[[Elections in South Ossetia|South Ossetia]], [[2026 South Ossetian presidential election|President]]''
==October==
* 4 October:
** [[Elections in Bosnia and Herzegovina|Bosnia and Herzegovina]], [[2026 Bosnian general election|Presidency and House of Representatives]]<ref name="Bosnia" />
** [[Elections in Brazil|Brazil]], [[2026 Brazilian general election|President (1st round), Chamber of Deputies and Senate]]
** ''[[Elections in Jersey|Jersey]], [[2026 Jersey general election|Parliament]]''
* 27 October: [[Elections in Israel|Israel]], [[2026 Israeli legislative election|Knesset]]
==November==
* 29 November:
** [[Elections in Spain|Spain]], [[2026 Spanish general election|Senate and Congress of Deputies]]
** [[Elections in Switzerland |Switzerland]], [[2026 Swiss referendums|Referendums]]
==December==
* 5 December: [[Elections in the Gambia|The Gambia]], [[2026 Gambian presidential election|President]]
* 6 December ''[[Elections in Northern Cyprus|Northern Cyprus]], [[2026 Northern Cypriot parliamentary election|Assembly of the Republic]]''
* 9 December: [[Elections in Fiji|Fiji]], [[2026 Fijian constitutional referendum|Constitutional referendum]]
==Indirect elections==
* 16 March, 18 June, and 16 October: [[Elections in India|India]], [[2026 Rajya Sabha elections|Council of States]]
==See also==
* [[2026 local electoral calendar]]
`;
const PAGE_2027 = `==January==
* 16 January: [[Elections in Nigeria|Nigeria]], [[2027 Nigerian general election|President, Senate and House of Representatives]]
==March==
* March: [[Estonia]], [[Next Estonian parliamentary election|Parliament]]
==April==
* 18 April:
** [[Elections in France|France]], [[2027 French presidential election|President]]
==Unknown date==
* [[Elections in Italy|Italy]], [[Next Italian general election|Chamber of Deputies and Senate]]
`;

/** A page padded with `n` dated July entries, so the pages together pass MIN_TOTAL_ENTRIES. */
const padded = (page, n = MIN_TOTAL_ENTRIES) => `${page}==July==\n${Array.from({ length: n }, (_, i) => `* ${i + 1} July: [[Elections in Peru|Peru]], [[Test ${i}|Parliament]]`).join('\n')}\n`;
const PAGE_2025 = `==December==
* 30 December: [[Elections in Ruritania|Uganda]], [[2025 Test election|Parliament]]
`;
const router = (pages, status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    const year = /page=(\d{4})%20national/.exec(url)?.[1];
    const text = pages[year];
    const body = text === undefined ? { error: { code: 'missingtitle', info: "The page you specified doesn't exist." } } : { parse: { title: `${year} national electoral calendar`, wikitext: text } };
    return { ok: status === 200, status, json: async () => body };
  };
  return { fetchImpl, calls };
};

describe('national electoral calendar parsing (#141)', () => {
  it('reads dated entries with their country, office and article, and skips italics, month-only and indirect lines', () => {
    const { elections, skippedLines } = parseCalendar(PAGE_2026, 2026);
    assert.deepEqual(elections.map((e) => [e.date, e.endDate ?? null, e.country, e.body]), [
      ['2026-01-12', null, 'UG', 'President and Parliament'],
      ['2026-09-18', '2026-09-20', 'RU', 'State Duma'],
      ['2026-10-04', null, 'BA', 'Presidency and House of Representatives'],
      ['2026-10-04', null, 'BR', 'President (1st round), Chamber of Deputies and Senate'],
      ['2026-10-27', null, 'IL', 'Knesset'],
      ['2026-11-29', null, 'ES', 'Senate and Congress of Deputies'],
      ['2026-11-29', null, 'CH', 'Referendums'],
      ['2026-12-05', null, 'GM', 'President'],
      ['2026-12-09', null, 'FJ', 'Constitutional referendum'],
    ]);
    assert.equal(elections[1].url, 'https://en.wikipedia.org/wiki/2026_Russian_legislative_election');
    assert.equal(elections[5].countryName, 'Spain');
    // Italics (South Ossetia, Jersey, Northern Cyprus) are skipped; the indirect and see-also lines sit outside month sections.
    assert.equal(skippedLines.length, 3);
    assert.ok(skippedLines.every((l) => l.includes("''")));
    const next = parseCalendar(PAGE_2027, 2027);
    assert.deepEqual(next.elections.map((e) => [e.date, e.country]), [['2027-01-16', 'NG'], ['2027-04-18', 'FR']]);
    assert.deepEqual(next.skippedLines, ['* March: [[Estonia]], [[Next Estonian parliamentary election|Parliament]]']);
  });

  it('resolves the calendar\'s country names', () => {
    assert.equal(calendarCountryCode('The Gambia'), 'GM');
    assert.equal(calendarCountryCode('Republic of the Congo'), 'CG');
    assert.equal(calendarCountryCode('Bosnia and Herzegovina'), 'BA');
    assert.equal(calendarCountryCode('Atlantis'), null);
  });
});

describe('elections fetch (#141)', () => {
  it('reads last year\'s, this year\'s and next year\'s pages with a User-Agent and keeps elections from 3 days back', async () => {
    const { fetchImpl, calls } = router({ 2025: PAGE_2025, 2026: padded(PAGE_2026), 2027: PAGE_2027 });
    const data = await fetchElections({ fetchImpl, nowMs: NOW });
    assert.deepEqual(calls.map(([url]) => /page=(\d{4})/.exec(url)?.[1]), ['2025', '2026', '2027']);
    assert.ok(calls.every(([url, ua]) => url.startsWith('https://en.wikipedia.org/w/api.php?action=parse') && ua === 'WorldMonitor elections seeder (+https://worldmonitor.app)'));
    assert.deepEqual(data.pages, [{ year: 2025, found: true, entries: 1 }, { year: 2026, found: true, entries: 9 + MIN_TOTAL_ENTRIES }, { year: 2027, found: true, entries: 2 }]);
    assert.deepEqual(data.elections.map((e) => `${e.date} ${e.country}`), ['2026-11-29 CH', '2026-11-29 ES', '2026-12-05 GM', '2026-12-09 FJ', '2027-01-16 NG', '2027-04-18 FR']);
    assert.ok(validateFn(data));
    assert.equal(declareRecords(data), 12 + MIN_TOTAL_ENTRIES);
    assert.equal(CANONICAL_KEY, 'intelligence:elections:v1');
  });

  it('runs in early January on a thin new-year page, keeping a late-December vote from last year\'s page', async () => {
    // 1 Jan 2027: the 2027 page has 16 dated entries (as on 2026-11-20); the 2026 page still counts toward the floor.
    const data = await fetchElections({ fetchImpl: router({ 2026: padded(PAGE_2025.replace(/2025/g, '2026'), 0) + padded(PAGE_2026), 2027: padded(PAGE_2027, 14) }).fetchImpl, nowMs: Date.UTC(2027, 0, 1, 8) });
    assert.equal(data.pages.find((p) => p.year === 2027)?.entries, 16);
    assert.equal(data.pages.find((p) => p.year === 2028)?.found, false);
    assert.deepEqual(data.elections.slice(0, 2).map((e) => `${e.date} ${e.country}`), ['2026-12-30 UG', '2027-01-16 NG']);
    assert.ok(validateFn(data));
  });

  it('links only main-namespace articles', () => {
    const { elections } = parseCalendar('==May==\n* 3 May: [[Elections in Peru|Peru]], [[meta:Evil|Parliament]]\n', 2026);
    assert.deepEqual(elections.map((e) => [e.country, e.body, e.url]), [['PE', 'Parliament', '']]);
  });

  it('keeps a multi-day vote until its last day', async () => {
    const data = await fetchElections({ fetchImpl: router({ 2026: padded(PAGE_2026), 2027: PAGE_2027 }).fetchImpl, nowMs: Date.UTC(2026, 8, 22, 8) });
    assert.equal(data.elections[0].country, 'RU', 'the Duma vote ended on 20 Sept, inside the 3-day keep');
  });

  it('publishes without next year\'s page, but fails without this year\'s, on a thin page or an HTTP error', async () => {
    const lone = await fetchElections({ fetchImpl: router({ 2026: padded(PAGE_2026) }).fetchImpl, nowMs: NOW });
    assert.deepEqual(lone.pages.map((p) => p.found), [false, true, false]);
    assert.ok(validateFn(lone));
    await assert.rejects(fetchElections({ fetchImpl: router({ 2025: padded(PAGE_2025), 2027: PAGE_2027 }).fetchImpl, nowMs: NOW }), /2026 calendar: page missing/);
    await assert.rejects(fetchElections({ fetchImpl: router({ 2026: PAGE_2026, 2027: PAGE_2027 }).fetchImpl, nowMs: NOW }), /11 dated elections, expected at least 20/);
    await assert.rejects(fetchElections({ fetchImpl: router({ 2026: padded(PAGE_2026) }, 503).fetchImpl, nowMs: NOW }), /HTTP 503/);
    assert.equal(validateFn({ fetchedAt: NOW, pages: [{ year: 2026, found: true, entries: 3 }], elections: [] }), false);
  });
});
