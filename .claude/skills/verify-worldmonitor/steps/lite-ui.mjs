/**
 * Feature: World Monitor Lite UI at /lite (docs/engineering/architecture/lite.md "Lite UI").
 *
 * Proves the default route (/ and /dashboard open /lite), the Briefing home
 * and its three child screens at desktop and phone widths.
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
    if (screen.nav === 'finance') {
      // Step 3: the markets map and the Treasury curve sit beside the main card.
      await expectVisible('[data-testid="markets-map"]');
      await expectVisible('[data-testid="treasury-curve"]');
    }
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
}
