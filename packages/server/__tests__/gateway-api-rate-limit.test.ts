// @vitest-environment node

/**
 * U4 (#3199) — gateway wiring for the per-account API rate-limit layer.
 *
 * The per-account burst/meter math is unit-tested in
 * tests/api-key-rate-limit.test.mts; here we STUB that module (per the plan)
 * and assert only the GATEWAY wiring at packages/server/gateway.ts:1034 — the parts the
 * reviewers flagged as defect-prone:
 *   - eligibility: only an operator key (kind 'enterprise') enters the layer
 *   - the global fallback bypass is ENFORCE-only (shadow keeps it active)
 *   - ordering + 429 shape
 *   - a former wm_ user key is rejected before limiting
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// --- Stub the per-account module: control the burst/meter decisions ---------
const checkBurst = vi.fn();
const reserveDailyMeter = vi.fn();
vi.mock("../_shared/api-key-rate-limit", () => ({
  checkBurst: (...a: unknown[]) => checkBurst(...a),
  reserveDailyMeter: (...a: unknown[]) => reserveDailyMeter(...a),
  rateLimitHeaders: () => ({ "X-RateLimit-Limit": "60", "Retry-After": "30" }),
  ENTERPRISE_API_RATE_LIMIT: 1000,
}));

// --- Stub the global fallback layer: spy whether checkRateLimit runs --------
let endpointPolicy = false;
const checkRateLimit = vi.fn().mockResolvedValue(null);
const checkFailClosedScopedIpRateLimit = vi.fn().mockResolvedValue(null);
vi.mock("../_shared/rate-limit", async (importActual) => {
  const actual = await importActual<typeof import("../_shared/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
    checkFailClosedScopedIpRateLimit: (...a: unknown[]) => checkFailClosedScopedIpRateLimit(...a),
    checkEndpointRateLimit: vi.fn().mockResolvedValue(null),
    hasEndpointRatePolicy: () => endpointPolicy,
  };
});

import { createDomainGateway } from "../gateway";
import { hashKeySync } from "../_shared/usage-identity";
import { OPERATOR_KEY_DAILY_CEILINGS } from "../_shared/high-usage-alarm";

function makeGateway() {
  return createDomainGateway([
    {
      method: "GET",
      path: "/api/news/v1/list-feed-digest",
      handler: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
  ]);
}

const OPERATOR_KEY = "operator-test-key";
const OPERATOR_ID = hashKeySync(OPERATOR_KEY);

function operatorKeyRequest(key = OPERATOR_KEY) {
  return new Request("https://www.worldmonitor.app/api/news/v1/list-feed-digest", {
    method: "GET",
    headers: { "X-Api-Key": key },
  });
}

function mixedEnterpriseRequest(sessionToken: string) {
  return new Request("https://www.worldmonitor.app/api/news/v1/list-feed-digest", {
    method: "GET",
    headers: {
      "X-WorldMonitor-Key": sessionToken,
      Cookie: "__Host-wm-pro-key=enterprise-browser-key",
    },
  });
}

const ctx = { waitUntil: () => {} };
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  endpointPolicy = false;
  process.env.WORLDMONITOR_VALID_KEYS = `${OPERATOR_KEY},enterprise-browser-key`;
  checkBurst.mockReset().mockResolvedValue({ ok: true });
  reserveDailyMeter.mockReset().mockResolvedValue({
    count: 1,
    overLimit: false,
    metered: true,
    retryAfterSec: 100,
    rollback: async () => {},
  });
  checkRateLimit.mockClear().mockResolvedValue(null);
  checkFailClosedScopedIpRateLimit.mockReset().mockResolvedValue(null);
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in ORIGINAL_ENV)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("#3199 U4 — gateway per-account rate-limit wiring", () => {
  test("mixed browser auth keeps the enterprise burst identity stable across wms_ rotation", async () => {
    process.env.WORLDMONITOR_VALID_KEYS = "enterprise-browser-key";
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    const gateway = makeGateway();

    const first = await gateway(mixedEnterpriseRequest("wms_first-anonymous-session"), ctx);
    const second = await gateway(mixedEnterpriseRequest("wms_second-anonymous-session"), ctx);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(checkBurst).toHaveBeenCalledTimes(2);
    expect(checkBurst.mock.calls.map(([, identity]) => identity)).toEqual([
      hashKeySync("enterprise-browser-key"),
      hashKeySync("enterprise-browser-key"),
    ]);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test("an operator key engages the per-key layer", async () => {
    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(200);
    expect(checkBurst).toHaveBeenCalledWith(1000, OPERATOR_ID);
  });

  test("ENFORCE + burst trip → 429 and per-IP checkRateLimit is BYPASSED", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    checkBurst.mockResolvedValue({ ok: false, limit: 60, reset: Date.now() + 30_000 });

    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(429);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test("SHADOW + burst trip → served (200) and IP global fallback still runs", async () => {
    delete process.env.API_RATE_LIMIT_ENFORCE; // shadow (default)
    checkBurst.mockResolvedValue({ ok: false, limit: 60, reset: Date.now() + 30_000 });

    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(200);
    // Protection retained in shadow, keyed on the caller's IP (no principal).
    expect(checkRateLimit).toHaveBeenCalledWith(expect.any(Request), expect.any(Object));
  });

  test("ENFORCE + over daily limit → 429, meter rolled back, per-IP bypassed", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    const rollback = vi.fn(async () => {});
    reserveDailyMeter.mockResolvedValue({
      count: 10_001,
      overLimit: true,
      metered: true,
      retryAfterSec: 100,
      rollback,
    });

    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(429);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test("#4635 U4 — ENFORCE burst 429 → informative body (plan, limit, limit_type)", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    checkBurst.mockResolvedValue({ ok: false, limit: 60, reset: Date.now() + 30_000 });

    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({
      plan: "enterprise",
      limit: 60,
      limit_type: "per_minute",
    });
    expect(body.upgrade_url).toBeUndefined();
    expect(typeof body.reset).toBe("string");
  });

  test("#4635 U4 — ENFORCE daily 429 → informative body names the ceiling + daily type", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    reserveDailyMeter.mockResolvedValue({
      count: 1_001, overLimit: true, metered: true, retryAfterSec: 100, rollback: async () => {},
    });

    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({
      plan: "enterprise",
      limit: OPERATOR_KEY_DAILY_CEILINGS.restRequests,
      limit_type: "daily",
    });
  });

  test("ENFORCE + within limits → served, per-IP bypassed", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(200);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test.each(['timeout', 'not_configured', 'error'])("unavailable burst (%s) retains daily metering and IP fallback", async (reason) => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    checkBurst.mockResolvedValue({ ok: null, reason });
    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(200);
    expect(reserveDailyMeter).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith(expect.any(Request), expect.any(Object));
  });

  test("unavailable burst still rejects and rolls back an exceeded daily allowance", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    checkBurst.mockResolvedValue({ ok: null, reason: 'timeout' });
    const rollback = vi.fn();
    reserveDailyMeter.mockResolvedValue({ overLimit: true, retryAfterSec: 100, rollback });
    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ limit_type: 'daily' });
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test.each(['true', 'false'])("fallback rejection releases a metered daily unit (enforce=%s)", async (enforce) => {
    process.env.API_RATE_LIMIT_ENFORCE = enforce;
    checkBurst.mockResolvedValue({ ok: null, reason: 'timeout' });
    const rollback = vi.fn(async () => {});
    reserveDailyMeter.mockResolvedValue({ overLimit: false, metered: true, rollback });
    const rejection = new Response('fallback', { status: 429 });
    checkRateLimit.mockResolvedValue(rejection);

    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res).toBe(rejection);
    expect(reserveDailyMeter).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("fallback admission keeps the daily reservation", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    checkBurst.mockResolvedValue({ ok: null, reason: 'timeout' });
    const rollback = vi.fn(async () => {});
    reserveDailyMeter.mockResolvedValue({ overLimit: false, metered: true, rollback });
    expect((await makeGateway()(operatorKeyRequest(), ctx)).status).toBe(200);
    expect(reserveDailyMeter).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  test("unavailable burst and meter still use the fallback response", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    checkBurst.mockResolvedValue({ ok: null, reason: 'timeout' });
    const rollback = vi.fn(async () => {});
    reserveDailyMeter.mockResolvedValue({ overLimit: false, metered: false, rollback });
    checkRateLimit.mockResolvedValue(new Response('fallback', { status: 429 }));
    const res = await makeGateway()(operatorKeyRequest(), ctx);
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('fallback');
    expect(rollback).not.toHaveBeenCalled();
  });

  test("shadow unavailable burst meters without enforcing daily denial", async () => {
    checkBurst.mockResolvedValue({ ok: null, reason: 'timeout' });
    const rollback = vi.fn();
    reserveDailyMeter.mockResolvedValue({ overLimit: true, rollback });
    expect((await makeGateway()(operatorKeyRequest(), ctx)).status).toBe(200);
    expect(rollback).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });

  test("enterprise unavailable burst retains IP fallback and reserves the operator daily ceiling", async () => {
    process.env.WORLDMONITOR_VALID_KEYS = "enterprise-browser-key";
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    checkBurst.mockResolvedValue({ ok: null, reason: 'timeout' });
    expect((await makeGateway()(mixedEnterpriseRequest('wms_session'), ctx)).status).toBe(200);
    expect(checkBurst).toHaveBeenCalledWith(1000, hashKeySync('enterprise-browser-key'));
    expect(reserveDailyMeter).toHaveBeenCalledWith(expect.objectContaining({
      userId: hashKeySync('enterprise-browser-key'),
      allowance: OPERATOR_KEY_DAILY_CEILINGS.restRequests,
    }));
    expect(checkRateLimit).toHaveBeenCalledWith(expect.any(Request), expect.any(Object));
  });

  test("an existing endpoint policy still owns fallback protection during burst outage", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    endpointPolicy = true;
    checkBurst.mockResolvedValue({ ok: null, reason: 'timeout' });
    expect((await makeGateway()(operatorKeyRequest(), ctx)).status).toBe(200);
    expect(reserveDailyMeter).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test("a former wm_ user API key is an invalid key: 401 before either limiter", async () => {
    process.env.API_RATE_LIMIT_ENFORCE = "true";
    const res = await makeGateway()(operatorKeyRequest("wm_" + "a".repeat(40)), ctx);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid API key" });
    expect(checkBurst).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
