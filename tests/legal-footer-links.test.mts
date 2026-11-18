/**
 * The Terms are a browsewrap ("By using the Service, you agree to these
 * Terms") and a browsewrap is only as good as its link (#6976). The footers
 * that rendered the shared legal nav left with the /pro and welcome pages in
 * refactor Phase 1b; the shared cluster they read stays pinned here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EULA_PATH,
  LEGAL_FOOTER_LINKS,
  TERMS_PATH,
  PRIVACY_PATH,
  LICENSE_PATH,
  TRADEMARK_PATH,
} from '../shared/legal.ts';

const REQUIRED = [EULA_PATH, TERMS_PATH, PRIVACY_PATH, LICENSE_PATH, TRADEMARK_PATH];

describe('legal links are reachable in one click', () => {
  it('the shared cluster is every document a buyer is bound by', () => {
    assert.deepEqual(
      LEGAL_FOOTER_LINKS.map(link => link.path),
      REQUIRED,
    );
    for (const link of LEGAL_FOOTER_LINKS) {
      assert.ok(link.label.length > 0, `${link.path} needs a label`);
    }
  });
});
