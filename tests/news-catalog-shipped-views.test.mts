// The server catalog that ships is a thin view over shared/news-catalog.json.
// These checks read the shipped exports themselves (not the builders) and
// compare them in order, so an edit to the wrapper fails here.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildServerIntelSources, buildServerVariantFeeds } from '../shared/news-catalog.ts';
import { INTEL_SOURCES as SERVER_INTEL, VARIANT_FEEDS } from '../server/worldmonitor/news/v1/_feeds.ts';

// JSON round-trip drops undefined-valued keys so optional fields compare by presence.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('shipped news catalog views match the catalog in order', () => {
  it('server VARIANT_FEEDS equals the catalog server view', () => {
    assert.deepEqual(plain(VARIANT_FEEDS), plain(buildServerVariantFeeds()));
  });

  it('server INTEL_SOURCES equals the catalog server intel view', () => {
    assert.deepEqual(plain(SERVER_INTEL), plain(buildServerIntelSources()));
  });
});
