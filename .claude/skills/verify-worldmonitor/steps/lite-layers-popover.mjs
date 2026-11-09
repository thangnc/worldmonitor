/**
 * Feature: the map layers popover on the Lite domain screens
 * (src/lite/components/LayersPopover.tsx).
 *
 * Launch with VITE_LITE_PROFILE=true. On each domain map, opening "Layers"
 * shows the whole popover inside the map card: its bottom edge, footer
 * included, stays within the card that clips it. When the rows do not fit,
 * they scroll under an overlay scrollbar and the last row can be reached.
 */
const MAPS = [
  { path: '/lite/geopolitics', card: '[data-testid="conflict-map"]' },
  { path: '/lite/finance', card: '[data-testid="markets-map"]' },
  { path: '/lite/tech', card: '[data-testid="infra-map"]' },
];

async function check(page, { path, card }, label, shot, log) {
  await page.goto(page.url().replace(/\/lite.*$/, path), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`${card} [data-testid="layers-chip"]`, { state: 'visible', timeout: 30_000 });
  await page.$eval(card, (el) => el.scrollIntoView({ block: 'start' }));
  await page.click(`${card} [data-testid="layers-chip"]`);
  const pop = `${card} [data-testid="layers-popover"]`;
  await page.waitForSelector(pop, { state: 'visible' });
  await page.waitForTimeout(150);
  const m = await page.$eval(pop, (el) => {
    const section = el.closest('section');
    const vp = el.querySelector('[data-overlayscrollbars-viewport]');
    const rows = el.querySelectorAll('[data-layer-row]');
    return {
      popBottom: el.getBoundingClientRect().bottom,
      cardBottom: section.getBoundingClientRect().bottom,
      footerBottom: el.lastElementChild.getBoundingClientRect().bottom,
      overlay: Boolean(vp),
      scrollable: vp ? vp.scrollHeight > vp.clientHeight : false,
      rows: rows.length,
    };
  });
  log(label, path, JSON.stringify(m));
  await shot(`${label}-${path.split('/').pop()}-open`);
  if (!m.overlay) throw new Error(`${path}: popover rows have no overlay scroll area`);
  if (m.popBottom > m.cardBottom + 0.5) throw new Error(`${path}: popover bottom ${m.popBottom} past card bottom ${m.cardBottom}`);
  if (m.footerBottom > m.cardBottom + 0.5) throw new Error(`${path}: footer cut off`);
  if (m.scrollable) {
    await page.hover(`${pop} [data-overlayscrollbars-viewport]`);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    const last = await page.$eval(pop, (el) => {
      const vp = el.querySelector('[data-overlayscrollbars-viewport]');
      const rows = el.querySelectorAll('[data-layer-row]');
      const r = rows[rows.length - 1].getBoundingClientRect();
      const v = vp.getBoundingClientRect();
      const bar = el.querySelector('.os-scrollbar-vertical');
      return { inView: r.bottom <= v.bottom + 1 && r.top >= v.top - 1, barShown: bar && !bar.classList.contains('os-scrollbar-auto-hide-hidden') };
    });
    log(label, path, 'after scroll', JSON.stringify(last));
    await shot(`${label}-${path.split('/').pop()}-scrolled`);
    if (!last.inView) throw new Error(`${path}: last layer row not reachable by scrolling`);
  }
  await page.keyboard.press('Escape');
}

export default async function ({ page, base, shot, log }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/lite`, { waitUntil: 'domcontentloaded' });
  for (const map of MAPS) await check(page, map, 'desktop', shot, log);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const map of MAPS) await check(page, map, 'mobile', shot, log);
}
