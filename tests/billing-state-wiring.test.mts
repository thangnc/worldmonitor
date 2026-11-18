/**
 * Wiring lock for the #4771 billing-aware UX surfaces.
 *
 * Per the repo's established pattern, this locks the server and pricing-page
 * integration with source-text assertions. The pure state logic
 * itself is behavior-tested in tests/billing-state.test.mts.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('widget-agent structured billing denial (#4771)', () => {
  it('returns the structured billing-verification denial before the generic 403', async () => {
    const src = await read('api/widget-agent.ts');
    assert.match(src, /getBillingVerificationDenial/, 'widget-agent must import/use the shared denial helper');
    const denialIdx = src.indexOf('getBillingVerificationDenial(ent');
    const genericIdx = src.indexOf("json({ error: 'Pro subscription required' }, 403");
    assert.ok(denialIdx > 0, 'billing denial must be evaluated with the fetched entitlements');
    assert.ok(genericIdx > 0, 'generic 403 fallback should remain for true free users');
    assert.ok(
      denialIdx < genericIdx,
      'billing-verification denial must run BEFORE the generic Pro-subscription-required 403',
    );
  });
});

describe('Pro-gated endpoint policy and billing denial ordering (#5600, #5646)', () => {
  // Content-only endpoints delegate the complete role-or-tier decision to
  // checkProEntitlement. Notification-backed entry points use the tier-only
  // helper to match their configuration and delivery paths. notification-
  // channels retains its handler-level seam because it also owns denial-capture
  // observability.
  //
  // These are source-order assertions, the same shape as the widget-agent block
  // above: they pin integration and ordering, while the shared helper's truth
  // table is behavior-tested in tests/pro-json-entitlement-gates.test.mts.
  const endpoints: Array<{
    file: string;
    decisionCall?: string;
    decisionHelper?: string;
  }> = [
    {
      file: 'api/latest-brief.ts',
      decisionCall: 'checkProEntitlement(session.userId, session.role, cors)',
      decisionHelper: 'checkProEntitlement',
    },
    {
      file: 'api/notify.ts',
      decisionCall: 'checkTierProEntitlement(session.userId, cors)',
      decisionHelper: 'checkTierProEntitlement',
    },
    {
      file: 'api/brief/share-url.ts',
      decisionCall: 'checkProEntitlement(session.userId, session.role, cors)',
      decisionHelper: 'checkProEntitlement',
    },
    {
      file: 'api/slack/oauth/start.ts',
      decisionCall: 'checkTierProEntitlement(session.userId, corsHeaders)',
      decisionHelper: 'checkTierProEntitlement',
    },
    {
      file: 'api/discord/oauth/start.ts',
      decisionCall: 'checkTierProEntitlement(session.userId, corsHeaders)',
      decisionHelper: 'checkTierProEntitlement',
    },
    { file: 'api/notification-channels.ts' },
  ];

  for (const { file, decisionCall, decisionHelper } of endpoints) {
    it(`${file} evaluates its shared decision before the generic 403`, async () => {
      const src = await read(file);
      const decisionIdx = decisionCall
        ? src.indexOf(decisionCall)
        : src.indexOf('getBillingVerificationDenial(ent');
      const genericIdx = src.indexOf("error: 'pro_required'");

      if (decisionCall) {
        assert.ok(
          src.includes(`import { ${decisionHelper} } from`) &&
            src.includes("pro-entitlement';"),
          `${file} must import ${decisionHelper}`,
        );
        assert.match(
          src,
          /if \(!proAccess\.allowed\)/,
          `${file} must deny only after the shared helper rejects both Pro signals`,
        );
        assert.match(src, /const \{ billingDenial \} = proAccess;/);
      }

      assert.ok(decisionIdx > 0, `${file} must evaluate its shared entitlement decision`);
      assert.ok(genericIdx > 0, `${file} should keep the generic pro_required 403 for true free users`);
      assert.ok(
        decisionIdx < genericIdx,
        `${file}: the entitlement decision must run BEFORE the generic pro_required 403`,
      );
      assert.match(
        src,
        /if \(billingDenial\)/,
        `${file} must return the denial Response when the helper produces one`,
      );
    });
  }

  for (const file of [
    'api/notify.ts',
    'api/slack/oauth/start.ts',
    'api/discord/oauth/start.ts',
  ]) {
    it(`${file} does not grant notification access from Clerk role alone`, async () => {
      const src = await read(file);

      assert.doesNotMatch(
        src,
        /checkProEntitlement\(session\.userId,\s*session\.role,/,
      );
      assert.match(
        src,
        /checkTierProEntitlement\(session\.userId,\s*(?:cors|corsHeaders)\)/,
      );
    });
  }
});
