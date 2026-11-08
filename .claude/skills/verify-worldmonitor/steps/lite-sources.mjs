/**
 * Feature: the Lite Sources screen at /lite/sources
 * (docs/engineering/architecture/lite.md "Sources").
 *
 * Launch with VITE_LITE_PROFILE=true. By default this step routes
 * `/api/health?compact=1` to a TEST DATA fixture with one failing and one
 * degraded check, so its assertions do not depend on local Redis, and labels
 * its screenshots so. Set WM_VERIFY_LIVE_HEALTH=1 to leave the request alone:
 * the dev server runs api/health.js (healthDevPlugin) against the Redis in
 * .env.local.
 */
const FIXTURE = () => ({
  status: 'DEGRADED',
  dataStatus: 'DEGRADED',
  summary: { total: 418, ok: 416, warn: 2, crit: 0 },
  checkedAt: new Date().toISOString(),
  problems: {
    ucdpEvents: { status: 'SEED_ERROR', records: 38, seedAgeMin: 52, maxStaleMin: 420, errorCode: 'UCDP_HTTP_429', consecutiveSourceFailures: 4 },
    stablecoinMarkets: { status: 'STALE_SEED', records: 12, seedAgeMin: 74, maxStaleMin: 60 },
  },
});

export default async function ({ page, base, shot, log, expectVisible }) {
  const live = process.env.WM_VERIFY_LIVE_HEALTH === '1';
  if (!live) {
    await page.route('**/api/health?compact=1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE()) }));
  }
  const tag = live ? 'live-health' : 'test-data';

  // 1. Reach it from the sidebar, at desktop width.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/lite`, { waitUntil: 'domcontentloaded' });
  await page.click('[data-nav="sources"]');
  await page.waitForURL((url) => url.pathname === '/lite/sources');
  await expectVisible('[data-testid="connectors"]');
  const title = await page.textContent('h1');
  if (title !== 'Sources & ingestion') throw new Error(`title "${title}"`);
  await page.waitForFunction(() => !document.querySelector('[data-connector][data-status="loading"]'), null, { timeout: 30_000 });

  const statuses = await page.$$eval('tr[data-connector]', (rows) => rows.map((r) => `${r.getAttribute('data-connector')}:${r.getAttribute('data-status')}`));
  log('rows', statuses.length, JSON.stringify(statuses));
  if (await page.$('[data-soon="true"]:not(nav [data-soon])')) throw new Error('Sources screen shows a SOON action');
  if (!live) {
    if (statuses[0] !== 'ucdp:failing') throw new Error(`first row ${statuses[0]}, expected ucdp:failing`);
    const detail = await page.textContent('[data-testid="connector-detail"]');
    if (!detail?.includes('UCDP_HTTP_429')) throw new Error('detail panel lacks the error code');
  }
  await shot(`sources-1440-${tag}`);
  await page.evaluate(() => document.querySelector('[data-testid="tier-policy"]')?.scrollIntoView({ block: 'end' }));
  await shot(`sources-1440-tiers-${tag}`);
  await page.evaluate(() => window.scrollTo(0, 0));

  // 2. A row click opens its detail; the Degraded filter keeps only problem rows.
  await page.click('tr[data-connector="crypto"] button');
  await expectVisible('[data-testid="connector-detail"][data-connector="crypto"]');
  await page.click('fieldset[aria-label="Connector filter"] button:nth-child(2)');
  const filtered = await page.$$eval('tr[data-connector]', (rows) => rows.map((r) => r.getAttribute('data-status')));
  log('degraded filter', JSON.stringify(filtered));
  if (filtered.some((s) => s !== 'failing' && s !== 'degraded')) throw new Error('Degraded filter kept a healthy row');
  await shot(`sources-1440-degraded-filter-${tag}`);

  // 3. Phone width: no horizontal page scroll (the table scrolls inside its card).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/lite/sources`, { waitUntil: 'domcontentloaded' });
  await expectVisible('[data-testid="connectors"]');
  await page.waitForFunction(() => !document.querySelector('[data-connector][data-status="loading"]'), null, { timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  log('390 overflow px', overflow);
  if (overflow > 0) throw new Error(`horizontal overflow ${overflow}px at 390`);
  await shot(`sources-390-${tag}`);
  await page.evaluate(() => document.querySelector('[data-testid="connector-detail"]')?.scrollIntoView());
  await shot(`sources-390-detail-${tag}`);
}
