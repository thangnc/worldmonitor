#!/usr/bin/env node
/**
 * Local runner for the World Monitor Lite seeders
 * (docs/engineering/architecture/lite.md "Seeder allowlist").
 *
 * In production the owner's workers run the allowlist on Render. Locally
 * nothing schedules it, so a key seeded by hand expires with its TTL and the
 * Lite screen shows the feed as unavailable a day later. This runner keeps
 * every seeder the Lite UI reads fresh against the Redis in `.env.local`.
 *
 *   node scripts/run-lite-seeders.mjs                 one tick: run what is due, then exit
 *   node scripts/run-lite-seeders.mjs --watch         a tick every 5 min until Ctrl-C
 *   node scripts/run-lite-seeders.mjs --watch --every 10
 *   node scripts/run-lite-seeders.mjs --status        read-only: age and due/fresh per seeder
 *
 * A tick is `runBundle` (scripts/_bundle-runner.mjs): a section runs only when
 * its seed-meta is older than 0.8x its interval, so keys the relay already
 * keeps fresh are skipped, and each source keeps its production cadence.
 * Seeders skip or degrade on their own when an optional key is missing, so no
 * section declares `requiredEnv`.
 *
 * A new Lite seeder joins LITE_SEED_SECTIONS; tests/lite-local-seeders.test.mts
 * fails when the Lite UI names a seeder that is not listed here.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBundle, readSectionFreshness, MIN, HOUR, DAY } from './_bundle-runner.mjs';
import { isMainModule } from './lib/main-module.mjs';

/**
 * Sections copied from a Railway bundle keep that bundle's seed-meta key,
 * interval and timeout. The others take their seed-meta key from the seeder
 * and their interval from the production cron or the Lite cadence, kept below
 * the key's health `maxStaleMin` (api/health.js) so a running runner keeps
 * health green.
 *
 * Freshness reads `seed-meta:<seedMetaKey>` only, with no canonicalKey or
 * completionMetaKey: locally the relay also writes some of these keys, and it
 * writes seed-meta but not runSeed's completion marker, so a completion gate
 * would rerun those seeders on every tick on top of the relay.
 */
export const LITE_SEED_SECTIONS = [
  // Geopolitics
  // The materializer writes several keys; the Lite map reads the conflict counts.
  { label: 'GDELT-Bulk', script: 'seed-gdelt-bulk-materializer.mjs', seedMetaKey: 'gdelt:bulk:conflict-counts', intervalMs: 15 * MIN, timeoutMs: 600_000 },
  { label: 'UCDP-Events', script: 'seed-ucdp-events.mjs', seedMetaKey: 'conflict:ucdp-events', intervalMs: 6 * HOUR, timeoutMs: 300_000 },
  { label: 'Unrest-Events', script: 'seed-unrest-events.mjs', seedMetaKey: 'unrest:events', intervalMs: 60 * MIN, timeoutMs: 180_000 },
  { label: 'Military-Flights', script: 'seed-military-flights.mjs', seedMetaKey: 'military:flights', intervalMs: 10 * MIN, timeoutMs: 300_000 },
  { label: 'Earthquakes', script: 'seed-earthquakes.mjs', seedMetaKey: 'seismology:earthquakes', intervalMs: 5 * MIN, timeoutMs: 120_000 },
  // The republisher refreshes every 30 minutes and asks clients not to poll faster.
  { label: 'UKMTO-Incidents', script: 'seed-ukmto-incidents.mjs', seedMetaKey: 'maritime:ukmto-incidents', intervalMs: 30 * MIN, timeoutMs: 120_000 },
  // gpsjam.org publishes one file a day; 12 h keeps it inside the 24 h health gate.
  { label: 'GPSJam', script: 'fetch-gpsjam.mjs', seedMetaKey: 'intelligence:gpsjam', intervalMs: 12 * HOUR, timeoutMs: 300_000 },

  // Finance & Crypto
  { label: 'Crypto-Quotes', script: 'seed-crypto-quotes.mjs', seedMetaKey: 'market:crypto', intervalMs: 5 * MIN, timeoutMs: 120_000 },
  { label: 'Market-Quotes', script: 'seed-market-quotes.mjs', seedMetaKey: 'market:stocks', intervalMs: 10 * MIN, timeoutMs: 120_000 },
  { label: 'Commodity-Quotes', script: 'seed-commodity-quotes.mjs', seedMetaKey: 'market:commodities', intervalMs: 10 * MIN, timeoutMs: 120_000 },
  { label: 'US-Treasury-Par-Yield', script: 'seed-us-treasury-par-yield.mjs', seedMetaKey: 'economic:us-treasury-par-yield', intervalMs: DAY, timeoutMs: 180_000 },
  // The three curves the "Other 10y bonds" indicator reads (seed-bundle-yield-curves.mjs).
  { label: 'Yield-Curve-JP', script: 'seed-yield-curve-jp.mjs', seedMetaKey: 'economic:yield-curve-jp', intervalMs: DAY, timeoutMs: 180_000 },
  { label: 'Yield-Curve-DE', script: 'seed-yield-curve-de.mjs', seedMetaKey: 'economic:yield-curve-de', intervalMs: DAY, timeoutMs: 180_000 },
  { label: 'Yield-Curve-GB', script: 'seed-yield-curve-gb.mjs', seedMetaKey: 'economic:yield-curve-gb', intervalMs: DAY, timeoutMs: 420_000 },
  { label: 'Economic-Calendar', script: 'seed-economic-calendar.mjs', seedMetaKey: 'economic:econ-calendar', intervalMs: 12 * HOUR, timeoutMs: 180_000 },
  { label: 'Hyperliquid-Flow', script: 'seed-hyperliquid-flow.mjs', seedMetaKey: 'market:hyperliquid-flow', intervalMs: 5 * MIN, timeoutMs: 60_000 },
  { label: 'Stablecoin-Markets', script: 'seed-stablecoin-markets.mjs', seedMetaKey: 'market:stablecoins', intervalMs: 10 * MIN, timeoutMs: 120_000 },
  { label: 'ETF-Flows', script: 'seed-etf-flows.mjs', seedMetaKey: 'market:etf-flows', intervalMs: 15 * MIN, timeoutMs: 120_000 },
  { label: 'Fear-Greed', script: 'seed-fear-greed.mjs', seedMetaKey: 'market:fear-greed', intervalMs: 6 * HOUR, timeoutMs: 120_000 },
  // Lite reads the shipping rates (SCFI, Baltic Dry) from this seeder.
  { label: 'Supply-Chain-Trade', script: 'seed-supply-chain-trade.mjs', seedMetaKey: 'supply_chain:shipping', intervalMs: 6 * HOUR, timeoutMs: 300_000 },
  { label: 'SEC-8K-Stream', script: 'seed-sec-8k-stream.mjs', seedMetaKey: 'intelligence:sec-8k-stream', intervalMs: 30 * MIN, timeoutMs: 120_000 },
  { label: 'Sanctions-Pressure', script: 'seed-sanctions-pressure.mjs', seedMetaKey: 'sanctions:pressure', intervalMs: 6 * HOUR, timeoutMs: 300_000 },

  // Technology & AI
  { label: 'Internet-Outages', script: 'seed-internet-outages.mjs', seedMetaKey: 'infra:outages', intervalMs: 15 * MIN, timeoutMs: 120_000 },
  { label: 'CVE-Reference', script: 'seed-cve-reference.mjs', seedMetaKey: 'cyber:cve-reference', intervalMs: DAY, timeoutMs: 300_000 },
  { label: 'Cyber-Threats', script: 'seed-cyber-threats.mjs', seedMetaKey: 'cyber:threats', intervalMs: 2 * HOUR, timeoutMs: 300_000 },
  { label: 'Research', script: 'seed-research.mjs', seedMetaKey: 'research:arxiv-hn-trending', intervalMs: 60 * MIN, timeoutMs: 180_000 },

  // Briefing. Calls the configured LLM provider; the relay also runs it when it is up.
  { label: 'Insights', script: 'seed-insights.mjs', seedMetaKey: 'news:insights', intervalMs: 15 * MIN, timeoutMs: 300_000 },
];

const ELIGIBLE_FRACTION = 0.8; // runBundle's admission rule

function ageLabel(ms) {
  if (ms == null) return 'no data';
  const min = Math.round(ms / 60_000);
  return min < 120 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
}

async function printStatus() {
  const now = Date.now();
  let due = 0;
  for (const section of LITE_SEED_SECTIONS) {
    const freshness = await readSectionFreshness(section);
    const age = freshness?.fetchedAt ? now - freshness.fetchedAt : null;
    const isDue = age == null || age >= section.intervalMs * ELIGIBLE_FRACTION;
    if (isDue) due++;
    console.log(`${section.label.padEnd(22)} ${(isDue ? 'DUE' : 'fresh').padEnd(6)} age ${ageLabel(age).padEnd(9)} every ${ageLabel(section.intervalMs)}`);
  }
  console.log(`\n${due} of ${LITE_SEED_SECTIONS.length} due. Run \`npm run seed:lite\` for one tick or \`npm run seed:lite:watch\` to keep them fresh.`);
}

/**
 * Spawns one tick per period, never two at once, until SIGINT or SIGTERM.
 * `tickArgv` is the node argv of one tick (this script with no flags).
 */
export async function watch(everyMin, tickArgv = [fileURLToPath(import.meta.url)]) {
  const periodMs = everyMin * MIN;
  let child = null;
  let timer = null;
  let stopping = false;
  const stop = (signal) => {
    stopping = true;
    if (timer) clearTimeout(timer);
    if (child) child.kill(signal);
    else process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  console.log(`[lite-seeders] watching: a tick every ${everyMin} min (Ctrl-C to stop)`);
  while (!stopping) {
    const startedAt = Date.now();
    const result = await new Promise((resolve) => {
      child = spawn(process.execPath, tickArgv, { stdio: 'inherit' });
      child.on('exit', (code, signal) => resolve({ code, signal }));
      child.on('error', (err) => resolve({ code: null, signal: null, err }));
    });
    child = null;
    if (stopping) break;
    if (result.err) console.error(`[lite-seeders] tick could not start: ${result.err.message}`);
    else if (result.code !== 0) console.warn(`[lite-seeders] tick exited ${result.code ?? result.signal}; continuing`);
    const waitMs = Math.max(0, periodMs - (Date.now() - startedAt));
    console.log(`[lite-seeders] next tick at ${new Date(Date.now() + waitMs).toISOString()}`);
    await new Promise((resolve) => { timer = setTimeout(resolve, waitMs); });
    timer = null;
  }
  process.exit(0);
}

function parseEvery(argv) {
  const i = argv.indexOf('--every');
  if (i === -1) return 5;
  const value = Number(argv[i + 1]);
  if (!Number.isFinite(value) || value < 1) throw new Error('--every takes a number of minutes, 1 or more');
  return value;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const argv = process.argv.slice(2);
  if (argv.includes('--status')) {
    await printStatus();
  } else if (argv.includes('--watch')) {
    await watch(parseEvery(argv));
  } else {
    await runBundle('lite-local', LITE_SEED_SECTIONS);
  }
}
