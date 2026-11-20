import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  UK_FETCH_MAX,
  UK_INDEX_URL,
  UK_PAGE_URL,
  US_MIN_COUNTRIES,
  US_RSS_URL,
  countryCodeOf,
  declareRecords,
  diffLevels,
  fetchTravelAdvisories,
  mergeChanges,
  parseUsItem,
  publishTransform,
  ukFlags,
  validateFn,
} from '../scripts/seed-travel-advisories.mjs';

const NOW = Date.UTC(2026, 10, 20, 8);
const DAY = 86_400_000;

// Enough real country names to clear the US and UK coverage floors.
const NAMES = ['Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Denmark', 'Djibouti', 'Dominica', 'Ecuador', 'Egypt', 'El Salvador', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Mauritania', 'Mauritius', 'Mexico', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Panama', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Samoa', 'San Marino', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Togo', 'Tonga', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'];

const rss = (levels = {}) => `<?xml version="1.0"?><rss><channel>${NAMES.map((n) => `<item><title>${n} - Level ${levels[n] ?? 1}: Words</title><link>https://travel.state.gov/x/${encodeURIComponent(n)}.html</link><pubDate>Mon, 17 Nov 2026 00:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const slug = (n) => n.toLowerCase().replace(/\s+/g, '-');
const index = (updated = {}) => ({ links: { children: NAMES.map((n) => ({ public_updated_at: updated[n] ?? '2026-11-01T00:00:00Z', details: { country: { name: n, slug: slug(n) } } })) } });

function router({ us = rss(), ukIndex = index(), pages = {}, failUs = false, failUk = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    if (url === US_RSS_URL) return failUs ? { ok: false, status: 503 } : { ok: true, status: 200, text: async () => us };
    if (url === UK_INDEX_URL) return failUk ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ukIndex };
    if (url.startsWith(UK_PAGE_URL)) {
      const s = url.slice(UK_PAGE_URL.length);
      return { ok: true, status: 200, json: async () => ({ details: { alert_status: pages[s] ?? [], change_description: `Updated ${s}` } }) };
    }
    return { ok: false, status: 404 };
  };
  return { fetchImpl, calls };
}

describe('travel advisory parsing (#124)', () => {
  it('maps advisory names to ISO2, preferring exact names and the first-named country', () => {
    assert.equal(countryCodeOf('Israel, the West Bank and Gaza'), 'IL');
    assert.equal(countryCodeOf('The Democratic Republic of the Congo'), 'CD');
    assert.equal(countryCodeOf('Mexico Travel Advisory'), 'MX');
    assert.equal(countryCodeOf('Burma'), 'MM');
    assert.equal(countryCodeOf('Atlantis'), null);
  });

  it('reads the US level from the item title and the UK flags most severe first', () => {
    assert.deepEqual(parseUsItem({ title: 'Iran - Level 4: Do Not Travel', link: 'https://travel.state.gov/irn.html', pubDate: 'Mon, 17 Nov 2026 00:00:00 GMT' }),
      { code: 'IR', name: 'Iran', level: 4, url: 'https://travel.state.gov/irn.html', updatedAt: Date.UTC(2026, 10, 17) });
    assert.equal(parseUsItem({ title: 'Mexico Travel Advisory - Level 2: Exercise Increased Caution', link: 'https://evil.example' }).url, '');
    assert.equal(parseUsItem({ title: 'Iran travel update' }), null);
    assert.equal(parseUsItem({ title: 'Iran - Level 7: x' }), null);
    assert.deepEqual(ukFlags(['avoid_all_but_essential_travel_to_parts', 'avoid_all_travel_to_parts', 'other']), ['avoid_all_travel_to_parts', 'avoid_all_but_essential_travel_to_parts']);
    assert.deepEqual(ukFlags(null), []);
  });
});

describe('travel advisory changes (#124)', () => {
  it('sets the baseline on the first run, then reports US level and UK flag changes', async () => {
    const first = router();
    const a = await fetchTravelAdvisories({ fetchImpl: first.fetchImpl, nowMs: NOW, loadState: async () => null, staggerMs: 0 });
    assert.ok(first.calls.every(([, ua]) => /WorldMonitor/.test(ua)));
    assert.equal(a.changes.length, 0);
    assert.equal(a.us.ok, true);
    assert.equal(a.us.baseline, false);
    assert.equal(a.uk.known, UK_FETCH_MAX, 'the UK baseline fills UK_FETCH_MAX pages per run');
    assert.equal(a.uk.pending, NAMES.length - UK_FETCH_MAX);
    assert.equal(publishTransform(a).state, undefined);
    assert.equal(validateFn(a), true);

    // Next run: Israel rises to 3, Ukraine's page was updated with a new flag.
    const state = JSON.parse(JSON.stringify(a.state));
    state.uk.UA = { flags: ['avoid_all_but_essential_travel_to_parts'], updatedAt: '2026-11-01T00:00:00Z' };
    const second = router({ us: rss({ Israel: 3 }), ukIndex: index({ Ukraine: '2026-11-20T07:00:00Z' }), pages: { ukraine: ['avoid_all_travel_to_parts', 'avoid_all_but_essential_travel_to_parts'] } });
    const b = await fetchTravelAdvisories({ fetchImpl: second.fetchImpl, nowMs: NOW + 2 * 3600_000, loadState: async () => state, staggerMs: 0 });
    // The changed, known page is fetched before the unknown ones.
    assert.equal(second.calls.findIndex(([u]) => u.endsWith('/ukraine')), 2);
    assert.deepEqual(b.changes.map((c) => [c.source, c.country, c.from, c.to]), [
      ['UK', 'UA', ['avoid_all_but_essential_travel_to_parts'], ['avoid_all_travel_to_parts', 'avoid_all_but_essential_travel_to_parts']],
      ['US', 'IL', 1, 3],
    ]);
    assert.equal(b.changes[0].url, 'https://www.gov.uk/foreign-travel-advice/ukraine');
    assert.equal(b.changes[0].note, 'Updated ukraine');
    assert.equal(b.us.baseline, true);
    assert.equal(declareRecords(b), 2);
  });

  it('keeps a failed source\'s state, fails only when both sources fail, and treats a short register as failed', async () => {
    const previous = { us: { IL: 2 }, uk: { UA: { flags: [], updatedAt: 'x' } }, ukIndexed: 10, changes: [] };
    const usDown = await fetchTravelAdvisories({ fetchImpl: router({ failUs: true }).fetchImpl, nowMs: NOW, loadState: async () => previous, staggerMs: 0 });
    assert.equal(usDown.us.ok, false);
    assert.match(usDown.us.error, /503/);
    assert.equal(usDown.state.us.IL, 2, 'the stored US level stays');
    assert.equal(usDown.changes.filter((c) => c.source === 'US').length, 0);
    const short = rss().split('</item>').slice(0, US_MIN_COUNTRIES - 1).join('</item>') + '</item></channel></rss>';
    const shortRun = await fetchTravelAdvisories({ fetchImpl: router({ us: short }).fetchImpl, nowMs: NOW, loadState: async () => previous, staggerMs: 0 });
    assert.equal(shortRun.us.ok, false);
    assert.match(shortRun.us.error, /expected at least/);
    await assert.rejects(fetchTravelAdvisories({ fetchImpl: router({ failUs: true, failUk: true }).fetchImpl, nowMs: NOW, loadState: async () => previous, staggerMs: 0 }), /both travel advisory sources failed/);
  });

  it('marks a country new to the US register, keeps a dropped one, and keeps 14 days of changes', () => {
    const us = new Map([['IL', { code: 'IL', name: 'Israel', level: 3, url: '', updatedAt: null }], ['XK', { code: 'XK', name: 'Kosovo', level: 4, url: '', updatedAt: null }]]);
    const { state, changes } = diffLevels({ previous: { us: { IL: 3, FR: 2 }, uk: {}, usRegisterSize: 2 }, us, ukIndex: null, ukPages: new Map(), nowMs: NOW });
    assert.deepEqual(changes.map((c) => [c.country, c.from, c.to]), [['XK', null, 4]]);
    assert.equal(state.us.FR, 2);
    // After a much smaller stored register, an absent country is a baseline gap, not a new listing.
    const big = new Map([...us, ...['AF', 'IR', 'IQ', 'SY'].map((c) => [c, { code: c, name: c, level: 4, url: '', updatedAt: null }])]);
    assert.deepEqual(diffLevels({ previous: { us: { IL: 3 }, uk: {}, usRegisterSize: 1 }, us: big, ukIndex: null, ukPages: new Map(), nowMs: NOW }).changes, []);
    const log = mergeChanges([{ at: NOW, source: 'US', country: 'XK' }], [{ at: NOW - 15 * DAY, source: 'US', country: 'IL' }, { at: NOW - DAY, source: 'UK', country: 'UA' }, { at: NOW, source: 'EU', country: 'FR' }], NOW);
    assert.deepEqual(log.map((c) => c.country), ['XK', 'UA']);
    assert.equal(CANONICAL_KEY, 'intelligence:travel-levels:v1');
  });
});

describe('travel advisory failure modes (#124 review)', () => {
  it('does not turn a failed first US read into a burst of new listings on the next run', async () => {
    const first = await fetchTravelAdvisories({ fetchImpl: router({ failUs: true }).fetchImpl, nowMs: NOW, loadState: async () => null, staggerMs: 0 });
    assert.equal(first.state.us, null);
    assert.equal(first.us.baseline, false);
    const second = await fetchTravelAdvisories({ fetchImpl: router({ us: rss({ Iran: 4, Syria: 4 }) }).fetchImpl, nowMs: NOW + 2 * 3600_000, loadState: async () => JSON.parse(JSON.stringify(first.state)), staggerMs: 0 });
    assert.deepEqual(second.changes, []);
    assert.equal(second.us.baseline, false);
    assert.deepEqual(diffLevels({ previous: { us: {}, uk: {} }, us: new Map([['IR', { code: 'IR', name: 'Iran', level: 4, url: '', updatedAt: null }]]), ukIndex: null, ukPages: new Map(), nowMs: NOW }).changes, [], 'an empty stored map is no baseline');
  });

  it('counts a GOV.UK page without alert_status as failed and keeps its stored flags', async () => {
    const previous = { us: null, uk: { UA: { flags: ['avoid_all_travel_to_parts'], updatedAt: 'old' } }, okAt: { US: NOW, UK: NOW }, startedAt: NOW };
    const { fetchImpl } = router({ failUs: true, ukIndex: index({ Ukraine: '2026-11-20T07:00:00Z' }) });
    const broken = async (url, init) => (url.endsWith('/ukraine') ? { ok: true, status: 200, json: async () => ({ details: {} }) } : fetchImpl(url, init));
    const run = await fetchTravelAdvisories({ fetchImpl: broken, nowMs: NOW + 3600_000, loadState: async () => previous, staggerMs: 0 });
    assert.deepEqual(run.changes, []);
    assert.deepEqual(run.state.uk.UA, { flags: ['avoid_all_travel_to_parts'], updatedAt: 'old' });
  });

  it('fails the run once a source has been down longer than the health budget, and reports each source\'s last good read', async () => {
    const previous = { us: { IL: 3 }, uk: {}, usRegisterSize: 1, okAt: { US: NOW - 7 * 3600_000, UK: NOW - 3600_000 }, startedAt: NOW - 30 * DAY };
    await assert.rejects(fetchTravelAdvisories({ fetchImpl: router({ failUs: true }).fetchImpl, nowMs: NOW, loadState: async () => previous, staggerMs: 0 }), /US travel advisory source not read since/);
    const recent = { ...previous, okAt: { US: NOW - 3 * 3600_000, UK: NOW - 3600_000 } };
    const run = await fetchTravelAdvisories({ fetchImpl: router({ failUs: true }).fetchImpl, nowMs: NOW, loadState: async () => recent, staggerMs: 0 });
    assert.equal(run.us.okAt, NOW - 3 * 3600_000);
    assert.equal(run.uk.okAt, NOW);
  });

  it('stops fetching UK pages when the time budget is spent', async () => {
    let t = 0;
    const { fetchImpl, calls } = router();
    const run = await fetchTravelAdvisories({ fetchImpl: async (u, i) => { t += 30_000; return fetchImpl(u, i); }, nowMs: NOW, loadState: async () => null, staggerMs: 0, clock: () => t });
    assert.ok(calls.filter(([u]) => u.startsWith(UK_PAGE_URL)).length < UK_FETCH_MAX);
    assert.ok(run.uk.pending > NAMES.length - UK_FETCH_MAX);
  });
});
