/**
 * Feature: overlay scrollbars in the Lite UI (src/lite/components/scroll.tsx).
 *
 * Launch with VITE_LITE_PROFILE=true. Proves the page scrolls under an overlay
 * scrollbar that takes no width and shows only while the pointer is over the
 * page, that switching screens resets the scroll to the top, that the sidebar
 * stays in view while the page scrolls, and that the Sources table and the
 * sidebar get their own overlay areas.
 */
// On the body the library makes <html> the scrolling viewport, so window.scrollTo still works.
const PAGE_VIEWPORT = 'html[data-overlayscrollbars-viewport]';
const PAGE_BAR = 'body > .os-scrollbar-vertical';

async function hidden(page, selector) {
  return page.$eval(selector, (el) => el.classList.contains('os-scrollbar-auto-hide-hidden'));
}

export default async function ({ page, base, shot, log, expectVisible }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/lite`, { waitUntil: 'domcontentloaded' });
  await expectVisible('[data-lite-screen]');
  await expectVisible(PAGE_VIEWPORT);

  // 1. The page viewport takes the full width: no native scrollbar gutter.
  const gutter = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
  log('page native scrollbar width', gutter);
  if (gutter !== 0) throw new Error(`native scrollbar takes ${gutter}px`);
  const overflowing = await page.$eval(PAGE_VIEWPORT, (el) => el.scrollHeight > el.clientHeight);
  if (!overflowing) throw new Error('page does not overflow at 1440x900; nothing to scroll');

  // 2. Hidden until hover, shown on hover, hidden again after the pointer leaves.
  // The mouse has not moved yet, so the pointer is not over the page.
  const isHidden = (s) => document.querySelector(s)?.classList.contains('os-scrollbar-auto-hide-hidden');
  await page.waitForFunction(isHidden, PAGE_BAR, { timeout: 5_000 });
  await shot('page-no-hover');
  await page.mouse.move(900, 450);
  await page.waitForFunction((s) => !document.querySelector(s)?.classList.contains('os-scrollbar-auto-hide-hidden'), PAGE_BAR, { timeout: 5_000 });
  log('page scrollbar hidden on hover', await hidden(page, PAGE_BAR));
  await shot('page-hover');
  // Headless Chromium has no window edge to cross: send the leave a real exit fires.
  await page.dispatchEvent('body', 'pointerleave', { pointerType: 'mouse' });
  await page.waitForFunction(isHidden, PAGE_BAR, { timeout: 5_000 });
  log('page scrollbar hidden after leave', true);
  await page.mouse.move(900, 450);

  // 3. Wheel scroll moves the overlay viewport; the sidebar stays in view.
  await page.mouse.wheel(0, 1200);
  await page.waitForFunction((s) => document.querySelector(s).scrollTop > 0, PAGE_VIEWPORT);
  // Let the wheel scroll settle: a frame taken mid-scroll shows the sticky sidebar mid-move.
  await page.waitForFunction(async (s) => {
    const el = document.querySelector(s);
    const before = el.scrollTop;
    await new Promise((r) => setTimeout(r, 300));
    return el.scrollTop === before;
  }, PAGE_VIEWPORT);
  const scrolled = await page.$eval(PAGE_VIEWPORT, (el) => el.scrollTop);
  const navTop = await page.$eval('nav[aria-label="Lite navigation"]', (el) => el.getBoundingClientRect().top);
  log('page scrollTop after wheel', scrolled, 'sidebar top', navTop);
  if (Math.abs(navTop) > 1) throw new Error(`sidebar scrolled away (top ${navTop})`);
  await shot('page-scrolled-sidebar-sticky');

  // 4. The sidebar is its own overlay area.
  const sidebarArea = await page.$eval('nav[aria-label="Lite navigation"] [data-lite-scroll]', (el) => el.hasAttribute('data-overlayscrollbars'));
  if (!sidebarArea) throw new Error('sidebar has no overlay scroll area');

  // 5. A screen switch resets the page scroll.
  await page.click('[data-nav="sources"]');
  await page.waitForURL((url) => url.pathname === '/lite/sources');
  await page.waitForFunction((s) => document.querySelector(s).scrollTop === 0, PAGE_VIEWPORT, { timeout: 5_000 });
  log('page scrollTop after screen switch', 0);

  // 6. Between the sm breakpoint and the wide layout the Sources table (min 640px)
  // is wider than its card: it scrolls sideways under its own overlay bar.
  await page.setViewportSize({ width: 650, height: 900 });
  await expectVisible('[data-testid="connectors"] [data-lite-scroll="x"]');
  const table = await page.$eval('[data-testid="connectors"] [data-lite-scroll="x"]', (host) => {
    const vp = host.querySelector('[data-overlayscrollbars-viewport]');
    return { overlay: host.hasAttribute('data-overlayscrollbars'), overflow: vp ? vp.scrollWidth - vp.clientWidth : -1, gutter: vp ? vp.offsetHeight - vp.clientHeight : -1 };
  });
  log('sources table', JSON.stringify(table));
  if (!table.overlay) throw new Error('sources table has no overlay scroll area');
  if (table.gutter !== 0) throw new Error(`sources table native scrollbar takes ${table.gutter}px`);
  if (table.overflow <= 0) throw new Error('sources table does not overflow at 650px; nothing to scroll');
  const box = await page.$eval('[data-testid="connectors"] [data-lite-scroll="x"]', (el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.waitForFunction(() => {
    const bar = document.querySelector('[data-testid="connectors"] [data-lite-scroll="x"] > .os-scrollbar-horizontal');
    return bar && !bar.classList.contains('os-scrollbar-auto-hide-hidden');
  }, null, { timeout: 5_000 });
  await shot('sources-table-650-hover');

  // 7. Phone width: the page still scrolls (touch devices keep the same viewport).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.$eval(PAGE_VIEWPORT, (el) => el.scrollTo(0, 400));
  const phoneTop = await page.$eval(PAGE_VIEWPORT, (el) => el.scrollTop);
  log('phone page scrollTop', phoneTop);
  if (phoneTop <= 0) throw new Error('page does not scroll at 390px');
  await shot('page-390-scrolled');
}
