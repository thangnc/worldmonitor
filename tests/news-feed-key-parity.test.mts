// Static parity guard: client-side `FEEDS` category keys MUST match
// server-side `VARIANT_FEEDS` keys for each variant.
//
// Background — concrete regression that motivated this test:
//
// The finance-variant Financial Regulation panel rendered empty for
// every user (anon AND pro) because the client used category key
// `'fin-regulation'` (in `src/config/feeds.ts` FINANCE_FEEDS, mirrored
// by the panel config in `src/config/panels.ts` and a one-time storage
// migration in `src/App.ts`) while the server still emitted the digest
// bucket under key `'regulation'`. The client iterates
// `Object.keys(FEEDS)` and does `digest.categories[category]`, so a
// rename on one side without the other means the panel never finds its
// items, the per-feed RSS fallback is gated off on web, and the body
// renders `[]` → "No news available" + UNAVAILABLE pill.
//
// This guard locks the per-variant key set so any future drift fails
// CI before reaching production.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { NEWS_CATALOG } from '../shared/news-catalog.ts';


// Map client const names to the variant string used by the server.
// The runtime selector in src/config/feeds.ts:927-937 routes
// SITE_VARIANT === 'X' → X_FEEDS for each X in this list.
//
// `knownGapsClientOnly` is a documented allowlist of category keys
// that exist client-side but have no server bucket today. Listed
// keys still render empty / "UNAVAILABLE" on web — they're tracked
// as deferred follow-ups (todos/257 item 9), not silent drift. Any
// client key NOT in this allowlist must have a server match.
const VARIANTS: Array<{ clientConst: string; serverKey: string; knownGapsClientOnly: string[] }> = [
  {
    clientConst: 'TECH_FEEDS',
    serverKey: 'tech',
    knownGapsClientOnly: [],
  },
  { clientConst: 'FINANCE_FEEDS', serverKey: 'finance', knownGapsClientOnly: [] },
  { clientConst: 'COMMODITY_FEEDS', serverKey: 'commodity', knownGapsClientOnly: [] },
  // FULL_FEEDS / HAPPY_FEEDS / ENERGY_FEEDS aren't asserted yet —
  // those variants don't have a fully-aligned server bucket map at the
  // time this test was written. Add them as the server catches up.
];

// Category layout per edition, read from the one catalog.
const LAYOUT = NEWS_CATALOG.layout;

describe('news feed key parity (client FEEDS ⇔ server VARIANT_FEEDS)', () => {
  for (const { clientConst, serverKey, knownGapsClientOnly } of VARIANTS) {
    test(`${serverKey}: every client key has a matching server key`, () => {
      const clientKeys = new Set(LAYOUT.browser[serverKey] ?? []);
      const serverKeys = new Set(LAYOUT.server[serverKey] ?? []);
      assert.ok(clientKeys.size > 0, `client ${clientConst} parsed 0 keys`);
      assert.ok(serverKeys.size > 0, `server VARIANT_FEEDS.${serverKey} parsed 0 keys`);

      const known = new Set(knownGapsClientOnly);
      const orphans = [...clientKeys]
        .filter(k => !serverKeys.has(k) && !known.has(k))
        .sort();
      assert.deepStrictEqual(
        orphans,
        [],
        `Client category keys missing on the server for variant '${serverKey}'.\n` +
        `These categories will render empty + 'UNAVAILABLE' on the panel because the\n` +
        `client looks up digest.categories[<key>] and the server emits a different key.\n\n` +
        `Missing on server: ${orphans.join(', ')}\n\n` +
        `Fix: rename the server-side key in server/worldmonitor/news/v1/_feeds.ts under\n` +
        `VARIANT_FEEDS.${serverKey} to match the client. (Or add the key to\n` +
        `\`knownGapsClientOnly\` in this test if the gap is intentional and tracked.)`,
      );

      // Sanity: every key in knownGapsClientOnly must actually be a real
      // gap. If a future server change covers one, drop it from the
      // allowlist so we don't carry phantom entries forever.
      const staleListed = knownGapsClientOnly.filter(k => serverKeys.has(k));
      assert.deepStrictEqual(
        staleListed,
        [],
        `'${serverKey}' knownGapsClientOnly contains keys the server NOW covers: ` +
        `${staleListed.join(', ')}. Remove them from the allowlist so future drift can be detected.`,
      );

      // Sanity: every key in knownGapsClientOnly must still exist on the
      // client. If it was renamed/dropped, the allowlist entry is stale.
      const goneFromClient = knownGapsClientOnly.filter(k => !clientKeys.has(k));
      assert.deepStrictEqual(
        goneFromClient,
        [],
        `'${serverKey}' knownGapsClientOnly contains keys no longer in the client: ` +
        `${goneFromClient.join(', ')}. Remove them from the allowlist.`,
      );
    });
  }
});
