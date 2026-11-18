import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { DIRECT_LLM_GATEWAY_QUOTA_PATHS } from '../server/_shared/direct-llm-quota.ts';
import { PREMIUM_RPC_PATHS } from '../src/shared/premium-paths.ts';

// ---------------------------------------------------------------------------
// Why this test exists
// ---------------------------------------------------------------------------
//
// `premiumFetch` (src/services/premium-fetch.ts) only attaches the Clerk
// Bearer token when the target path is a member of `PREMIUM_RPC_PATHS`. A
// premium-gated direct-edge endpoint that's *missing* from that set silently
// breaks for browser Pro users who don't carry a tester key:
//
//   premiumFetch sees the path is "not premium" → skips Bearer injection →
//   request goes out unauthenticated → server's isCallerPremium returns
//   false → 403 "Pro subscription required" despite a valid subscription.
//
// That exact regression hit `/api/chat-analyst` (post-PR-#3797). The fix is
// trivial — add the path to PREMIUM_RPC_PATHS — but the trap is that it
// stays invisible until someone manages to call the endpoint AND has no
// tester key AND isn't on a desktop with WORLDMONITOR_API_KEY.
//
// This guard fails CI when a new file under `api/` gates on premium auth
// (via `isCallerPremium()` or returns the literal 403 body) but the
// corresponding route isn't covered by PREMIUM_RPC_PATHS or this file's
// allowlist.

// ---------------------------------------------------------------------------
// Allowlist — endpoints whose browser callers deliberately bypass premiumFetch
// ---------------------------------------------------------------------------
//
// Each entry must point to a real file under `api/` and explain WHY path-
// gated Bearer injection isn't the right mechanism for that endpoint.

// Empty since the Lite refactor removed /api/widget-agent and
// /api/me/entitlement; no direct-edge endpoint bypasses premiumFetch today.
const PREMIUM_FETCH_BYPASS_ALLOWLIST: Record<string, string> = {};

// Gateway-level direct-LLM routes also require a Clerk identity before quota
// reservation. Browser callers must therefore enter through premiumFetch so
// they attach Bearer auth and so the wm-session interceptor does not mistake
// the expected anonymous 401 for a dead HttpOnly session. Summarize stays out:
// its translate mode is intentionally available to free callers and the
// gateway only applies direct-LLM quota after inspecting the request body.
//
// #5674 — an entry here is NOT sufficient on its own. Membership in
// PREMIUM_RPC_PATHS does two independent jobs: it tells premiumFetch to attach
// a Bearer, and it tells the wm-session interceptor that a 401 on this route is
// an expected auth denial rather than a rejected session cookie. This allowlist
// was originally justified against the FIRST job only, which left the second
// unhandled: every unauthenticated summarize call 401'd, the interceptor minted
// a fresh session, replayed, 401'd again, and suppressed ALL anonymous API
// calls for 15 minutes (#5219). Each entry must therefore also name the
// mechanism that keeps its 401s out of session recovery.
const DIRECT_LLM_PREMIUM_BYPASS_ALLOWLIST: Record<string, string> = {
  '/api/news/v1/summarize-article':
    'The route also serves free translate mode — which REQUIRES the anonymous ' +
    'wms_ cookie, so the path cannot join PREMIUM_RPC_PATHS. Spend-bearing ' +
    'summarize calls opt into premiumFetch with forcePremium instead of gating ' +
    'the whole path, and session recovery is bypassed per-request via the ' +
    'premium-intent marker (src/services/premium-intent.ts).',
};

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const apiDir = join(repoRoot, 'api');

// Two server-side premium-gate markers:
//   - isCallerPremium(           — endpoints using the shared check
//   - "Pro subscription required" — literal 403 body used by hand-rolled gates
const PREMIUM_GATE_RE = /(isCallerPremium\s*\(|['"`]Pro subscription required['"`])/;

function walkApiFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Skip private helpers (_cors.js, _api-key.js, _mcp-grant-hmac.ts, etc.)
    if (entry.startsWith('_')) continue;
    // Skip internal-only endpoints (api/internal/* — not browser-reachable;
    // auth via gateway HMAC nonce, not Bearer).
    if (entry === 'internal') continue;
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkApiFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Map a file under api/ to its Vercel route path.
//   api/foo.ts          → /api/foo
//   api/foo/bar.ts      → /api/foo/bar
//   api/foo/index.ts    → /api/foo
//   api/foo/[id].ts     → null (dynamic route — exact-match set can't represent it;
//                              parent path is typically separately covered)
function fileToRoute(absPath: string): string | null {
  const rel = relative(apiDir, absPath).replace(/\\/g, '/');
  if (rel.includes('[')) return null;
  const noExt = rel.replace(/\.ts$/, '');
  const noIndex = noExt.replace(/\/index$/, '');
  return `/api/${noIndex}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('premium-paths guard — every premium-gated direct-edge endpoint is covered', () => {
  const files = walkApiFiles(apiDir);
  const gated: { route: string; file: string }[] = [];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!PREMIUM_GATE_RE.test(src)) continue;
    const route = fileToRoute(file);
    if (!route) continue; // dynamic route — skip
    gated.push({ route, file });
  }

  // No kept api/ entry gates on premium today, so `gated` may be empty. Prove
  // the walk and the regex still work instead, so an empty scan stays a real
  // result rather than a broken walker.
  it('scan walks the api/ entrypoints and the gate regex still matches — sanity check for regex/walk', () => {
    assert.ok(
      files.some((f) => fileToRoute(f) === '/api/seed-contract-probe'),
      'Scan did not reach api/seed-contract-probe.ts — the api/ walk is likely broken',
    );
    assert.ok(PREMIUM_GATE_RE.test('if (!(await isCallerPremium(req))) {'));
    assert.ok(PREMIUM_GATE_RE.test("jsonResponse({ error: 'Pro subscription required' }, 403)"));
  });

  for (const { route, file } of gated) {
    const fileRel = relative(repoRoot, file);
    it(`${route} (${fileRel}) is covered`, () => {
      if (PREMIUM_RPC_PATHS.has(route)) return;
      const allowlistReason = PREMIUM_FETCH_BYPASS_ALLOWLIST[route];
      assert.ok(
        allowlistReason,
        [
          `Endpoint ${route} (${fileRel}) gates on premium auth`,
          `(matched /${PREMIUM_GATE_RE.source}/) but is NOT in PREMIUM_RPC_PATHS.`,
          ``,
          `If a browser caller uses premiumFetch (or wraps a generated client`,
          `in premiumFetch), add ${JSON.stringify(route)} to`,
          `src/shared/premium-paths.ts so the Clerk Bearer is attached.`,
          `Otherwise every Pro user without a tester key will see 403.`,
          ``,
          `If the browser caller deliberately bypasses premiumFetch (plain`,
          `fetch with manually-attached auth), add an entry to`,
          `PREMIUM_FETCH_BYPASS_ALLOWLIST in this test file with rationale.`,
        ].join('\n'),
      );
    });
  }

  it('every allowlist entry still points to a real, premium-gated endpoint', () => {
    const gatedRoutes = new Set(gated.map((g) => g.route));
    for (const route of Object.keys(PREMIUM_FETCH_BYPASS_ALLOWLIST)) {
      assert.ok(
        gatedRoutes.has(route),
        `Allowlist entry ${route} does not match any premium-gated file under api/. ` +
        `Either the route was renamed/removed or the gate was lifted — drop the stale allowlist entry.`,
      );
    }
  });

  it('no allowlist entry shadows a PREMIUM_RPC_PATHS member', () => {
    for (const route of Object.keys(PREMIUM_FETCH_BYPASS_ALLOWLIST)) {
      assert.equal(
        PREMIUM_RPC_PATHS.has(route),
        false,
        `${route} is BOTH in PREMIUM_RPC_PATHS and in the bypass allowlist. ` +
        `One of them is wrong — pick the canonical source of truth for this endpoint.`,
      );
    }
  });
});

describe('premium-paths guard — browser direct-LLM routes cannot trigger wm-session recovery', () => {
  for (const route of DIRECT_LLM_GATEWAY_QUOTA_PATHS) {
    it(`${route} is covered by premium auth routing or an explicit mode-specific bypass`, () => {
      if (PREMIUM_RPC_PATHS.has(route)) return;
      assert.ok(
        DIRECT_LLM_PREMIUM_BYPASS_ALLOWLIST[route],
        [
          `Direct-LLM route ${route} requires a Clerk identity in the gateway`,
          `but is NOT in PREMIUM_RPC_PATHS.`,
          ``,
          `Anonymous browser calls will receive 401, and the wm-session`,
          `interceptor will misclassify that expected denial as a rejected`,
          `fresh cookie, entering the global 15-minute cooldown.`,
        ].join('\n'),
      );
    });
  }

  it('every direct-LLM bypass remains real and intentionally non-premium', () => {
    for (const route of Object.keys(DIRECT_LLM_PREMIUM_BYPASS_ALLOWLIST)) {
      assert.ok(
        DIRECT_LLM_GATEWAY_QUOTA_PATHS.has(route),
        `Stale direct-LLM bypass ${route}: route is no longer quota-gated.`,
      );
      assert.equal(
        PREMIUM_RPC_PATHS.has(route),
        false,
        `${route} is now premium-routed; remove its stale direct-LLM bypass.`,
      );
    }
  });
});
