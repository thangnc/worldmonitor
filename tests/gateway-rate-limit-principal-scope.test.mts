import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// ─── WORLDMONITOR-12A: the limiter scope must be wired at the CALL SITE ──────
//
// `server/_shared/rate-limit.ts` can separate an API key's bucket from an
// interactive session's, but only if the gateway actually tells it which
// credential the caller presented. Those are two different failures, and the
// module-level test in `tests/rate-limit.test.mts` cannot see the second one:
// deleting both `principalScope` arguments from gateway.ts leaves that suite
// fully green (verified by mutation, 2026-09-11).
//
// Rather than pin the two literal call sites — which a third limiter call would
// silently slip past — assert the invariant: every limiter option object that
// names a principal must also name that principal's scope. A new call site that
// forgets the scope re-opens the bug, and re-opening it means a paying customer's
// own scraper can starve their dashboard again.
//
// No credential the gateway accepts today carries a user principal (Clerk and
// user API keys are gone), so the gateway names no principal at all and both
// limiters key on the caller's IP. The pin stays so a principal that comes
// back has to come back scoped.

const GATEWAY_SOURCE = readFileSync(
  new URL('../server/gateway.ts', import.meta.url),
  'utf8',
);

describe('gateway rate-limit principal scoping (WORLDMONITOR-12A)', () => {
  it('passes principalScope wherever it passes principalUserId', () => {
    const principals = GATEWAY_SOURCE.match(/\bprincipalUserId:/g) ?? [];
    const scopes = GATEWAY_SOURCE.match(/\bprincipalScope:/g) ?? [];

    assert.equal(
      scopes.length,
      principals.length,
      `every limiter call naming a principal must also name its scope; found `
      + `${principals.length} principalUserId vs ${scopes.length} principalScope. `
      + 'An unscoped call shares one bucket between a customer\'s API key and '
      + 'their browser session.',
    );
  });

  it('names no user principal while no credential carries one', () => {
    assert.doesNotMatch(GATEWAY_SOURCE, /\bprincipalUserId:/);
    assert.doesNotMatch(GATEWAY_SOURCE, /withTrustedRateLimitPrincipal\(/);
  });
});
