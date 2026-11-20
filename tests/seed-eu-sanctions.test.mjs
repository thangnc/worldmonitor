import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  EU_FSF_URL,
  MIN_ENTITIES,
  declareRecords,
  fetchEuSanctions,
  mergeAdditions,
  parseEuList,
  publishTransform,
  validateFn,
} from '../scripts/seed-eu-sanctions.mjs';

const NOW = Date.UTC(2026, 10, 20, 8);
const DAY = 86_400_000;

// The Financial Sanctions Files XML v1.1 shape, as the live file (2026-10-23) has it: a default namespace,
// one sanctionEntity per listing with an optional designationDate, one <regulation> (the latest act on the
// entity, holding its publicationUrl), and a regulationSummary on each alias naming the act behind it.
const entity = (id, { name = `Person ${id}`, programme = 'RUS', designated = '2022-03-15', cc = 'RU', type = 'person', strong = 'true', act = ['2024-02-23', '2024/753 (OJ L2024753)', 'https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202400753'], first = '2022-03-15' } = {}) => `
  <sanctionEntity ${designated ? `designationDate="${designated}" ` : ''}designationDetails="" unitedNationId="" euReferenceNumber="EU.${id}.12" logicalId="${id}">
    <remark>Listed for testing.</remark>
    <regulation regulationType="amendment" organisationType="council" publicationDate="${act[0]}" entryIntoForceDate="${act[0]}" numberTitle="${act[1]}" programme="${programme}" logicalId="${id}0">
      <publicationUrl>${act[2]}</publicationUrl>
    </regulation>
    <subjectType code="${type}" classificationCode="${type === 'person' ? 'P' : 'E'}"/>
    <nameAlias firstName="" middleName="" lastName="" wholeName="${name} (alias)" function="" gender="M" title="" nameLanguage="RU" strong="false" regulationLanguage="en" logicalId="${id}2">
      <regulationSummary regulationType="regulation" publicationDate="${first}" numberTitle="269/2014 (OJ L78)" publicationUrl="http://eur-lex.europa.eu/LexUriServ/LexUriServ.do?uri=OJ:L:2014:078:0006:0015:EN:PDF"/>
    </nameAlias>
    <nameAlias firstName="" middleName="" lastName="" wholeName="${name}" function="" gender="M" title="" nameLanguage="" strong="${strong}" regulationLanguage="en" logicalId="${id}3">
      <regulationSummary regulationType="amendment" publicationDate="${act[0]}" numberTitle="${act[1]}" publicationUrl="${act[2]}"/>
    </nameAlias>
    <citizenship region="" countryIso2Code="${cc}" countryDescription="COUNTRY" regulationLanguage="en" logicalId="${id}4">
      <regulationSummary regulationType="amendment" publicationDate="${act[0]}" numberTitle="${act[1]}" publicationUrl="${act[2]}"/>
    </citizenship>
    <address city="" street="" poBox="" zipCode="" region="" place="" asAtListingTime="false" countryIso2Code="00" countryDescription="UNKNOWN" logicalId="${id}5"/>
  </sanctionEntity>`;
const file = (ids, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<export xmlns="http://eu.europa.ec/fpi/fsd/export" generationDate="2026-11-19T18:00:31.402+01:00" globalFileId="171234">
${ids.map((id) => entity(id)).join('')}${extra}
</export>`;
const ids = (n, from = 1000) => Array.from({ length: n }, (_, i) => String(from + i));
const router = (xml, status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    return { ok: status === 200, status, headers: new Headers(), text: async () => xml };
  };
  return { fetchImpl, calls };
};

describe('EU sanctions list parsing (#129)', () => {
  it('reads each entity\'s id, strong name, regimes, countries, designation date and latest act', () => {
    const { generatedAt, entities } = parseEuList(file([], entity('77', { name: 'Ivan &quot;Vanya&quot; Petrov', programme: 'UKR', cc: 'ru' })
      + entity('78', { type: 'enterprise', cc: 'IR', programme: 'IRN' })
      // No designationDate: the earliest act dates it; an http eur-lex link is read over https.
      + entity('79', { designated: '', first: '2014-03-17', act: ['2025-10-23', '2025/2035 (OJ L202502035)', 'http://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202502035'] })
      // A link off eur-lex is dropped.
      + entity('80', { act: ['2025-10-23', '2025/2035', 'https://example.com/act.pdf'] })));
    assert.equal(generatedAt, Date.parse('2026-11-19T18:00:31.402+01:00'));
    assert.deepEqual(entities[0], {
      id: '77', ref: 'EU.77.12', name: 'Ivan "Vanya" Petrov', type: 'person', programmes: ['UKR'], countries: ['RU'],
      listedOn: '2022-03-15', regulation: '2024/753 (OJ L2024753)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202400753',
    });
    assert.deepEqual([entities[1].type, entities[1].countries], ['entity', ['IR']]);
    assert.deepEqual([entities[2].listedOn, entities[2].regulation, entities[2].url], ['2014-03-17', '2025/2035 (OJ L202502035)', 'https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202502035']);
    assert.equal(entities[3].url, '');
    // "00" (unknown) is not a country.
    assert.ok(entities.every((e) => !e.countries.includes('00')));
  });

  it('reads a namespace-prefixed file the same way', () => {
    const prefixed = file(['1', '2']).replace(/<(\/?)(export|sanctionEntity|regulationSummary|regulation|subjectType|nameAlias|citizenship|address|publicationUrl|remark)\b/g, '<$1fsd:$2');
    assert.deepEqual(parseEuList(prefixed).entities.map((e) => e.id), ['1', '2']);
  });
});

describe('EU sanctions fetch (#129)', () => {
  const base = ids(MIN_ENTITIES);

  it('sets a baseline on the first run and reports nothing as new', async () => {
    const { fetchImpl, calls } = router(file(base));
    const data = await fetchEuSanctions({ fetchImpl, nowMs: NOW, loadState: async () => null });
    assert.deepEqual(calls, [[EU_FSF_URL, calls[0][1]]]);
    assert.match(calls[0][1], /WorldMonitor/);
    assert.deepEqual([data.entityCount, data.additions.length, data.baselineAt], [MIN_ENTITIES, 0, NOW]);
    assert.equal(data.state.ids.length, MIN_ENTITIES);
    assert.equal(publishTransform(data).state, undefined);
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), MIN_ENTITIES);
    assert.equal(CANONICAL_KEY, 'sanctions:eu-additions:v1');
  });

  it('reports ids not seen on the last run, and keeps the log and baseline across runs', async () => {
    const first = await fetchEuSanctions({ fetchImpl: router(file(base)).fetchImpl, nowMs: NOW, loadState: async () => null });
    const next = await fetchEuSanctions({ fetchImpl: router(file([...base, '9001', '9002'])).fetchImpl, nowMs: NOW + 6 * 3600_000, loadState: async () => first.state });
    assert.deepEqual(next.additions.map((a) => [a.id, a.at]), [['9001', NOW + 6 * 3600_000], ['9002', NOW + 6 * 3600_000]]);
    assert.equal(next.baselineAt, NOW);
    const later = await fetchEuSanctions({ fetchImpl: router(file([...base, '9001', '9002'])).fetchImpl, nowMs: NOW + DAY, loadState: async () => next.state });
    assert.deepEqual(later.additions.map((a) => a.id), ['9001', '9002'], 'the log keeps earlier additions');
    assert.deepEqual(mergeAdditions([], later.additions, NOW + 15 * DAY), [], 'additions leave the log after 14 days');
  });

  it('fails on a cut-off file, a short list, a much shorter list than last time, or an HTTP error, so the baseline stays', async () => {
    await assert.rejects(fetchEuSanctions({ fetchImpl: router(file(ids(10))).fetchImpl, nowMs: NOW, loadState: async () => null }), /expected at least/);
    const state = { ids: ids(4000), additions: [], baselineAt: NOW - DAY };
    await assert.rejects(fetchEuSanctions({ fetchImpl: router(file(ids(3000))).fetchImpl, nowMs: NOW, loadState: async () => state }), (e) => /held as a broken download/.test(e.message) && e.nonRetryable === true);
    await assert.rejects(fetchEuSanctions({ fetchImpl: router('', 500).fetchImpl, nowMs: NOW, loadState: async () => null }), /HTTP 500/);
    // A download cut mid-file (the server answered 200 and stopped, 2026-11-20).
    const whole = file([...base, '9001']);
    await assert.rejects(fetchEuSanctions({ fetchImpl: router(whole.slice(0, whole.lastIndexOf('</export>'))).fetchImpl, nowMs: NOW, loadState: async () => null }), /incomplete document/);
    await assert.rejects(fetchEuSanctions({ fetchImpl: router(file(base)).fetchImpl, nowMs: NOW, loadState: async () => { throw new Error('eu-sanctions state read failed: HTTP 503'); } }), /state read failed/);
  });
});
