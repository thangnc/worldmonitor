/**
 * Feature: World Monitor Lite UI at /lite (docs/architecture/lite.md "Lite UI").
 *
 * Launch with VITE_LITE_PROFILE=true and WM_VERIFY_EXPECT=lite (the default)
 * to prove the default route, the Briefing home and its three child screens,
 * and the full-dashboard escape.
 * Launch without the flag and WM_VERIFY_EXPECT=full to prove upstream is
 * unchanged: /dashboard stays the dashboard and /lite shows the off notice.
 */
const SCREENS = [
  { nav: 'briefing', path: '/lite', title: 'Cross-domain briefing', card: 'priority-events' },
  { nav: 'geopolitics', path: '/lite/geopolitics', title: 'Geopolitics & Conflicts', card: 'priority-incidents' },
  { nav: 'finance', path: '/lite/finance', title: 'Finance & Crypto', card: 'market-events' },
  { nav: 'tech', path: '/lite/tech', title: 'Technology & AI', card: 'tech-developments' },
];

async function settle(page) {
  // Every widget leaves "loading" once its source answers or fails.
  await page.waitForFunction(
    () => ![...document.querySelectorAll('[data-source-state]')].some((el) => el.getAttribute('data-source-state') === 'loading'),
    null,
    { timeout: 30_000 },
  );
}

export default async function ({ page, base, shot, log, expectVisible }) {
  const expect = process.env.WM_VERIFY_EXPECT ?? 'lite';

  if (expect === 'full') {
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    await expectVisible('#panelsGrid .panel');
    if (new URL(page.url()).pathname !== '/dashboard') throw new Error(`flag off: /dashboard moved to ${page.url()}`);
    await shot('flag-off-dashboard');
    await page.goto(`${base}/lite`, { waitUntil: 'domcontentloaded' });
    await expectVisible('[data-lite-off="true"]');
    await shot('flag-off-lite-notice');
    log('flag off: /dashboard is the dashboard, /lite shows the off notice');
    return;
  }

  // 1. The default route: / and /dashboard open the Lite UI.
  for (const entry of ['/', '/dashboard']) {
    await page.goto(`${base}${entry}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((url) => url.pathname === '/lite', { timeout: 30_000 });
    log(`${entry} ->`, new URL(page.url()).pathname);
  }

  // 2. Each screen through the sidebar, at desktop width. Start on a child so
  // the Briefing link is a real navigation too.
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const screen of [...SCREENS.slice(1), SCREENS[0]]) {
    await page.click(`[data-nav="${screen.nav}"]`);
    await page.waitForURL((url) => url.pathname === screen.path);
    await expectVisible(`[data-testid="${screen.card}"]`);
    const title = await page.textContent('h1');
    if (title !== screen.title) throw new Error(`${screen.path}: title "${title}"`);
    await settle(page);
    const states = await page.$$eval('[data-source-state]', (els) => els.map((el) => `${el.getAttribute('data-source-state')}: ${el.textContent}`));
    const samples = await page.$$eval('[data-sample="true"]', (els) => els.length);
    log(screen.path, 'sample badges', samples, 'source states', JSON.stringify(states));
    await shot(`${screen.nav}-1440`);
  }

  // 2b. The Briefing links to its children: a domain tag opens its screen.
  const domainLink = await page.$('[data-testid="priority-events"] [data-open-screen]');
  if (domainLink) {
    const target = await domainLink.getAttribute('data-open-screen');
    await domainLink.click();
    await page.waitForURL((url) => url.pathname === `/lite/${target}`);
    log('briefing event tag ->', new URL(page.url()).pathname);
    await page.click('[data-nav="briefing"]');
    await page.waitForURL((url) => url.pathname === '/lite');
  }

  // 3. Phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const screen of SCREENS) {
    await page.goto(`${base}${screen.path}`, { waitUntil: 'domcontentloaded' });
    await expectVisible(`[data-testid="${screen.card}"]`);
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    log(screen.path, '390px horizontal overflow', overflow);
    await shot(`${screen.nav}-390`);
  }

  // 4. The escape route: the full dashboard stays reachable.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/lite`, { waitUntil: 'domcontentloaded' });
  await page.click('[data-testid="open-full-dashboard"]');
  await page.waitForURL((url) => url.pathname === '/dashboard');
  await expectVisible('#panelsGrid .panel');
  await page.waitForTimeout(1500); // urlState rewrite settles; the next reload proves the session flag
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectVisible('#panelsGrid .panel');
  if (new URL(page.url()).pathname !== '/dashboard') throw new Error(`reload left the dashboard: ${page.url()}`);
  await shot('full-dashboard-escape');
  log('full dashboard reachable and kept for the tab session');
}
