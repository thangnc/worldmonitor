import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  MIN_ENTITIES,
  STATE_KEY,
  UK_LIST_URL,
  declareRecords,
  fetchUkSanctions,
  parseUkList,
  publishTransform,
  ukCountryCode,
  validateFn,
} from '../scripts/seed-uk-sanctions.mjs';

const NOW = Date.UTC(2026, 10, 20, 8);
const DAY = 86_400_000;

// The UK Sanctions List XML shape, as the live file (generated 20/11/2026) has it: no namespace, one <Designation>
// per listing, names split over Name1 to Name6 with a NameType ("Primary Name" or "Primary name"), dd/mm/yyyy dates,
// and country names (not codes) for nationalities, addresses and ship flags.
const designation = (id, { names = [['Primary Name', { Name1: 'Sergey', Name2: 'Vasilyevich', Name6: 'GORNYAKOV' }]], kind = 'Individual', designated = '15/03/2022', regime = 'The Russia (Sanctions) (EU Exit) Regulations 2019', nationality = [], address = ['Russia'], flag = '' } = {}) => `
  <Designation>
    <LastUpdated>09/04/2025</LastUpdated>
    <DateDesignated>${designated}</DateDesignated>
    <UniqueID>${id}</UniqueID>
    <OFSIGroupID>14951</OFSIGroupID>
    <Names>${names.map(([type, parts]) => `
      <Name>
        ${Object.entries(parts).map(([k, v]) => `<${k}>${v}</${k}>`).join('\n        ')}
        <NameType>${type}</NameType>
      </Name>`).join('')}
    </Names>
    <RegimeName>${regime}</RegimeName>
    <IndividualEntityShip>${kind}</IndividualEntityShip>
    <DesignationSource>UK</DesignationSource>
    <SanctionsImposed>Asset freeze|Travel Ban</SanctionsImposed>
    <UKStatementofReasons>
Listed for testing.</UKStatementofReasons>
    ${address.length ? `<Addresses>${address.map((c) => `<Address><AddressLine6>City</AddressLine6><AddressCountry>${c}</AddressCountry></Address>`).join('')}</Addresses>` : ''}
    ${nationality.length ? `<IndividualDetails><Individual><Nationalities>${nationality.map((c) => `<Nationality>${c}</Nationality>`).join('')}</Nationalities></Individual></IndividualDetails>` : ''}
    ${flag ? `<ShipDetails><Ship><IMONumbers><IMONumber>IMO9562233</IMONumber></IMONumbers><CurrentBelievedFlagOfShips><CurrentBelievedFlagOfShip>${flag}</CurrentBelievedFlagOfShip></CurrentBelievedFlagOfShips></Ship></ShipDetails>` : ''}
  </Designation>`;
const file = (ids, extra = '') => `<?xml version="1.0" encoding="utf-8"?>
<Designations xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <DateGenerated>20/11/2026</DateGenerated>${ids.map((id) => designation(id)).join('')}${extra}
</Designations>`;
const ids = (n, from = 1000) => Array.from({ length: n }, (_, i) => `RUS${from + i}`);
const router = (xml, status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    return { ok: status === 200, status, headers: new Headers(), text: async () => xml };
  };
  return { fetchImpl, calls };
};

describe('UK sanctions list parsing (#140)', () => {
  it('reads each designation\'s id, primary name, regime, countries and designation date', () => {
    const { generatedAt, entities } = parseUkList(file([], designation('RUS1000')
      // An alias listed first, "Primary name" in lower case, and an escaped ampersand.
      + designation('IRN0042', { kind: 'Entity', regime: 'The Iran (Sanctions) Regulations 2023', designated: '02/02/2026', address: ['United Arab Emirates', 'Iran'], names: [['Alias', { Name6: 'SHELL CO' }], ['Primary name', { Name6: 'PARS TRADING &amp; LOGISTICS LLC' }]] })
      // A ship names no nationality or address: its regime's country, not its flag.
      + designation('RUS2001', { kind: 'Ship', address: [], flag: 'Panama', names: [['Primary name', { Name6: 'Example Tanker' }]] })
      // A ship listed under its IMO number, its name only an alias (RUS3795 on the live list).
      + designation('RUS3795', { kind: 'Ship', address: [], names: [['Primary Name', { Name6: 'IMO 9958303' }], ['Alias', { Name6: 'MELICERTES' }]] })
      // A thematic regime with no country named: no country.
      + designation('CYB0101', { regime: 'The Cyber (Sanctions) (EU Exit) Regulations 2020', address: [] })
      // UK country names the shared resolver misses or misreads.
      + designation('DRC0001', { regime: 'The Democratic Republic of the Congo (Sanctions) (EU Exit) Regulations 2019', address: ['Congo (Democratic Republic)'], nationality: ['Occupied Palestinian Territories', 'DPRK'] })
      // No name at all: skipped.
      + designation('RUS9999', { names: [] })));
    assert.equal(generatedAt, Date.UTC(2026, 10, 20));
    assert.deepEqual(entities[0], {
      id: 'RUS1000', ref: 'RUS1000', name: 'Sergey Vasilyevich GORNYAKOV', type: 'person', programmes: ['RUS'], countries: ['RU'],
      listedOn: '2022-03-15', regulation: 'Russia (Sanctions) (EU Exit) Regulations 2019', url: '',
    });
    assert.deepEqual([entities[1].name, entities[1].type, entities[1].countries, entities[1].listedOn, entities[1].programmes], ['PARS TRADING & LOGISTICS LLC', 'entity', ['AE', 'IR'], '2026-02-02', ['IRN']]);
    assert.deepEqual([entities[2].type, entities[2].countries], ['ship', ['RU']]);
    assert.deepEqual([entities[3].name, entities[3].countries], ['MELICERTES (IMO 9958303)', ['RU']]);
    assert.deepEqual(entities[4].countries, []);
    assert.deepEqual(entities[5].countries.sort(), ['CD', 'KP', 'PS']);
    assert.equal(entities.length, 6);
  });

  it('resolves the UK list\'s country names', () => {
    assert.equal(ukCountryCode('Congo (Democratic Republic)'), 'CD');
    assert.equal(ukCountryCode('Congo'), 'CG');
    assert.equal(ukCountryCode(' Russia '), 'RU');
    assert.equal(ukCountryCode('Palestinian'), 'PS');
    assert.equal(ukCountryCode('Nowhere'), null);
    assert.equal(ukCountryCode(''), null);
  });
});

describe('UK sanctions fetch (#140)', () => {
  const base = ids(MIN_ENTITIES);

  it('sets a baseline on the first run, sending a User-Agent to the FCDO list', async () => {
    const { fetchImpl, calls } = router(file(base));
    const data = await fetchUkSanctions({ fetchImpl, nowMs: NOW, loadState: async () => null });
    assert.deepEqual(calls, [[UK_LIST_URL, 'WorldMonitor uk-sanctions seeder (+https://worldmonitor.app)']]);
    assert.deepEqual([data.entityCount, data.additions.length, data.baselineAt, data.generatedAt], [MIN_ENTITIES, 0, NOW, Date.UTC(2026, 10, 20)]);
    assert.equal(data.state.ids.length, MIN_ENTITIES);
    assert.ok(validateFn(data));
    assert.equal(declareRecords(data), MIN_ENTITIES);
    assert.deepEqual(Object.keys(publishTransform(data)).sort(), ['additions', 'baselineAt', 'entityCount', 'fetchedAt', 'generatedAt', 'windowDays']);
    assert.equal(CANONICAL_KEY, 'sanctions:uk-additions:v1');
    assert.equal(STATE_KEY, 'sanctions:uk-sanctions:state:v1');
  });

  it('reports ids not seen before as new listings, dated by the run that first saw them, and keeps the log', async () => {
    const first = await fetchUkSanctions({ fetchImpl: router(file(base)).fetchImpl, nowMs: NOW, loadState: async () => null });
    const next = await fetchUkSanctions({ fetchImpl: router(file([...base, 'IRN9001', 'IRN9002'])).fetchImpl, nowMs: NOW + 6 * 3600_000, loadState: async () => first.state });
    assert.deepEqual(next.additions.map((a) => [a.id, a.at]), [['IRN9001', NOW + 6 * 3600_000], ['IRN9002', NOW + 6 * 3600_000]]);
    assert.equal(next.baselineAt, NOW);
    const later = await fetchUkSanctions({ fetchImpl: router(file([...base, 'IRN9001', 'IRN9002'])).fetchImpl, nowMs: NOW + DAY, loadState: async () => next.state });
    assert.deepEqual(later.additions.map((a) => a.id), ['IRN9001', 'IRN9002'], 'the log keeps earlier listings');
    const expired = await fetchUkSanctions({ fetchImpl: router(file([...base, 'IRN9001', 'IRN9002'])).fetchImpl, nowMs: NOW + 15 * DAY, loadState: async () => later.state });
    assert.deepEqual(expired.additions, [], 'listings leave the log after 14 days');
  });

  it('fails a short, shrunken, cut-off or unreadable list, and a failed state read', async () => {
    await assert.rejects(fetchUkSanctions({ fetchImpl: router(file(ids(10))).fetchImpl, nowMs: NOW, loadState: async () => null }), /expected at least/);
    const state = { ids: ids(5000), additions: [], baselineAt: NOW - DAY };
    await assert.rejects(fetchUkSanctions({ fetchImpl: router(file(ids(4000))).fetchImpl, nowMs: NOW, loadState: async () => state }), (e) => /held as a broken download/.test(e.message) && e.nonRetryable === true);
    await assert.rejects(fetchUkSanctions({ fetchImpl: router('', 503).fetchImpl, nowMs: NOW, loadState: async () => null }), /HTTP 503/);
    const whole = file(base);
    await assert.rejects(fetchUkSanctions({ fetchImpl: router(whole.slice(0, whole.lastIndexOf('</Designations>'))).fetchImpl, nowMs: NOW, loadState: async () => null }), /incomplete document/);
    await assert.rejects(fetchUkSanctions({ fetchImpl: router(whole).fetchImpl, nowMs: NOW, loadState: async () => { throw new Error('uk-sanctions state read failed: HTTP 503'); } }), /state read failed/);
  });
});
