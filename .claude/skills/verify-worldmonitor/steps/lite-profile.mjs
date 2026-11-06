import { seedProfile, waitForBoot, waitForMap } from './_profile.mjs';

/**
 * Feature: World Monitor Lite deployment profile (docs/architecture/lite.md).
 *
 * Launch with VITE_LITE_PROFILE=true to prove the profile, or without it to
 * prove upstream `full` is unchanged. WM_VERIFY_EXPECT=lite|full (default
 * lite) selects the assertion. Keep LITE_PANELS / LITE_LAYERS in step with
 * src/config/lite-profile.ts.
 */
const LITE_PANELS = [
  'insights', 'strategic-posture', 'cii', 'strategic-risk', 'escalation-correlation',
  'threat-timeline', 'ucdp-events', 'cross-source-signals', 'markets', 'crypto',
  'crypto-news', 'stablecoins', 'etf-flows', 'macro-signals', 'fear-greed',
  'economic-calendar', 'centralbanks', 'ai', 'tech', 'policy', 'ai-regulation',
  'hardware', 'tech-readiness', 'monitors',
];
const LITE_LAYERS = ['conflicts', 'hotspots', 'military', 'ciiChoropleth', 'sanctions', 'ucdpEvents', 'datacenters'];
const CROSS_VARIANT = ['crypto-news', 'centralbanks', 'policy', 'ai-regulation', 'hardware'];

export default async function ({ page, base, shot, log, expectVisible }) {
  const expect = process.env.WM_VERIFY_EXPECT ?? 'lite';
  await seedProfile(page);
  await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page, { data: true });
  const renderer = await waitForMap(page);
  await expectVisible('#panelsGrid .panel');
  await shot('booted');

  const state = await page.evaluate(() => ({
    panels: [...document.querySelectorAll('#panelsGrid .panel[data-panel]')]
      .filter((el) => !el.classList.contains('hidden') && el.offsetParent !== null)
      .map((el) => el.getAttribute('data-panel')),
  }));
  // ?layers= is written on a 250 ms debounce (features/map-layers.md).
  const urlLayers = await page
    .waitForFunction(() => new URLSearchParams(location.search).get('layers'), null, { timeout: 15_000 })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  // The URL is the renderer-independent record of the active layer set; the
  // worldmonitor-layers storage key is only written after the first change.
  state.layers = urlLayers ? urlLayers.split(',').filter(Boolean) : [];
  log('renderer', renderer);
  // The grid scrolls inside a fixed-height shell, so a tall viewport is the
  // only way to see every panel in one image.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1600, height: 3200 });
  await page.waitForTimeout(1500); // layout settle after resize; evidence only, no assertion depends on it
  await shot('panel-grid');
  if (viewport) await page.setViewportSize(viewport);
  log('visible panels', JSON.stringify(state.panels));
  log('checked layers', JSON.stringify(state.layers));

  // The mission picker is the user path for re-applying the layout.
  await page.click('#missionPresetBtn');
  await page.waitForSelector('.mission-preset-card[data-mission-id]');
  const presets = await page.$$eval('.mission-preset-card[data-mission-id]', (cards) =>
    cards.map((card) => card.getAttribute('data-mission-id')));
  log('mission presets offered', JSON.stringify(presets));
  await page.locator('.mission-preset-card[data-mission-id]').last().scrollIntoViewIfNeeded();
  await shot('mission-picker');
  await page.keyboard.press('Escape');

  const problems = [];
  if (expect === 'lite') {
    const extra = state.panels.filter((id) => !LITE_PANELS.includes(id));
    const missing = LITE_PANELS.filter((id) => !state.panels.includes(id));
    if (extra.length) problems.push(`non-Lite panels visible: ${extra.join(', ')}`);
    if (missing.length) problems.push(`Lite panels missing: ${missing.join(', ')}`);
    const order = state.panels.filter((id) => LITE_PANELS.includes(id));
    if (JSON.stringify(order) !== JSON.stringify(LITE_PANELS.filter((id) => order.includes(id)))) {
      problems.push(`Lite panels out of order: ${order.join(', ')}`);
    }
    const layerExtra = state.layers.filter((id) => !LITE_LAYERS.includes(id));
    const layerMissing = LITE_LAYERS.filter((id) => !state.layers.includes(id));
    if (layerExtra.length) problems.push(`non-Lite layers on: ${layerExtra.join(', ')}`);
    if (layerMissing.length) problems.push(`Lite layers off: ${layerMissing.join(', ')}`);
    if (!presets.includes('lite-desk')) problems.push('Lite Desk preset not offered');
  } else {
    const leaked = state.panels.filter((id) => CROSS_VARIANT.includes(id));
    if (leaked.length) problems.push(`cross-variant Lite panels leaked into full: ${leaked.join(', ')}`);
    if (presets.includes('lite-desk')) problems.push('Lite Desk preset offered with the flag off');
    if (state.panels.length < 25) problems.push(`upstream full grid looks reduced: ${state.panels.length} panels`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return { expect, panels: state.panels.length, layers: state.layers.length, presets: presets.length, renderer };
}
