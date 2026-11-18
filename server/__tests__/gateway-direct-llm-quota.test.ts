// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest";

const checkEndpointRateLimit = vi.fn().mockResolvedValue(null);
const checkRateLimit = vi.fn().mockResolvedValue(null);
vi.mock("../_shared/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_shared/rate-limit")>();
  return {
    ...actual,
    checkEndpointRateLimit: (...a: unknown[]) => checkEndpointRateLimit(...a),
    checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
  };
});

const validateApiKey = vi.fn();
vi.mock("../../api/_api-key.js", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  validateApiKey: (...a: unknown[]) => validateApiKey(...a),
}));

// The operator key every "allowed" scenario presents. The default
// validateApiKey stub below mirrors api/_api-key.js: an operator key is
// `enterprise`, a wms_ session is `session` unless forceKey (premium routes)
// rejects it, and no credential is "API key required".
const OP = "operator-test-key";
const OP_HEADERS = { "X-WorldMonitor-Key": OP };
function emulateValidateApiKey(request: Request, options: { forceKey?: boolean } = {}) {
  const key = request.headers.get("X-WorldMonitor-Key") || request.headers.get("X-Api-Key") || "";
  if (key === OP) return { valid: true, required: true, kind: "enterprise", credential: OP };
  if (key.startsWith("wms_")) {
    return options.forceKey
      ? { valid: false, required: true, error: "Pro authentication required" }
      : { valid: true, required: false, kind: "session" };
  }
  if (key) return { valid: false, required: true, error: "Invalid API key" };
  return { valid: false, required: true, error: "API key required" };
}

const reserveDirectLlmQuota = vi.fn();
vi.mock("../_shared/direct-llm-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_shared/direct-llm-quota")>();
  return {
    ...actual,
    reserveDirectLlmQuota: (...a: unknown[]) => reserveDirectLlmQuota(...a),
  };
});

const deliverUsageEvents = vi.fn().mockResolvedValue(undefined);
vi.mock("../_shared/usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_shared/usage")>();
  return {
    ...actual,
    deliverUsageEvents: (...a: unknown[]) => deliverUsageEvents(...a),
  };
});

import { createDomainGateway } from "../gateway";
import { OPERATOR_KEY_DAILY_CEILINGS, operatorKeyQuotaPrincipal } from "../_shared/high-usage-alarm";

const OP_PRINCIPAL = await operatorKeyQuotaPrincipal(OP);
const OP_LIMIT = OPERATOR_KEY_DAILY_CEILINGS.directLlmCalls;
import { PREMIUM_RPC_PATHS } from "../../src/shared/premium-paths";
import { createIntelligenceServiceRoutes } from "../../src/generated/server/worldmonitor/intelligence/v1/service_server";
import { intelligenceHandler } from "../worldmonitor/intelligence/v1/handler";
import {
  drainUnservedLlmResponse,
  markRetryableResponse,
  markUnservedLlmResponse,
} from "../_shared/response-headers";
import { getCountryIntelBrief } from "../worldmonitor/intelligence/v1/get-country-intel-brief";
import { summarizeArticle } from "../worldmonitor/news/v1/summarize-article";

const callLlm = vi.fn();
vi.mock("../_shared/llm", async (importOriginal) => ({
  ...await importOriginal<typeof import("../_shared/llm")>(),
  callLlm: (...args: unknown[]) => callLlm(...args),
}));

const cachedFetchJson = vi.fn();
vi.mock("../_shared/redis", async (importOriginal) => ({
  ...await importOriginal<typeof import("../_shared/redis")>(),
  cachedFetchJson: (...args: unknown[]) => cachedFetchJson(...args),
}));

const CLASSIFY_PATH = "/api/intelligence/v1/classify-event";
const DEDUCT_PATH = "/api/intelligence/v1/deduct-situation";
const COUNTRY_BRIEF_PATH = "/api/intelligence/v1/get-country-intel-brief";
const ANALYZE_PATH = "/api/market/v1/analyze-stock";
const BACKTEST_PATH = "/api/market/v1/backtest-stock";
// A Pro-fresh market route with NO endpoint rate policy, so it reaches the
// GLOBAL limiter these tests exercise. The gateway skips the global limiter for
// any route carrying an endpoint policy (gateway.ts, `!hasEndpointRatePolicy`),
// so a policied route here would silently stop testing what it claims to.
// Crypto quotes now has an endpoint policy for its paid-provider gap fetch.
const GLOBAL_LIMITED_PATH = "/api/market/v1/list-gulf-quotes";
const CACHE_PATH = "/api/news/v1/summarize-article-cache";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeGateway(handlerCalls: Record<string, number>) {
  return createDomainGateway([
    {
      method: "GET",
      path: CLASSIFY_PATH,
      handler: async () => {
        handlerCalls.classify += 1;
        return json({ ok: true, route: "classify" });
      },
    },
    {
      method: "POST",
      path: DEDUCT_PATH,
      handler: async () => {
        handlerCalls.deduct += 1;
        return json({ ok: true, route: "deduct" });
      },
    },
    {
      method: "GET",
      path: COUNTRY_BRIEF_PATH,
      handler: async () => {
        handlerCalls.country += 1;
        return json({ ok: true, route: "country" });
      },
    },
    {
      method: "GET",
      path: CACHE_PATH,
      handler: async () => {
        handlerCalls.cache += 1;
        return json({ ok: true, route: "cache" });
      },
    },
  ]);
}

function makeAnalyzeGateway(handlerCalls: { analyze: number }) {
  return createDomainGateway([
    {
      method: "GET",
      path: ANALYZE_PATH,
      handler: async () => {
        handlerCalls.analyze += 1;
        return json({ ok: true, route: "analyze" });
      },
    },
  ]);
}

function makeBacktestGateway(handlerCalls: { backtest: number }) {
  return createDomainGateway([
    {
      method: "GET",
      path: BACKTEST_PATH,
      handler: async () => {
        handlerCalls.backtest += 1;
        return json({ ok: true, route: "backtest" });
      },
    },
  ]);
}

function makeMarketQuotesGateway(handlerCalls: { quotes: number }) {
  return createDomainGateway([
    {
      method: "GET",
      path: GLOBAL_LIMITED_PATH,
      handler: async () => {
        handlerCalls.quotes += 1;
        return json({ ok: true, route: "quotes" });
      },
    },
  ]);
}

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://www.worldmonitor.app${path}`, init);
}

function makeRecordingCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
    settle: async () => {
      await Promise.allSettled(pending);
    },
  };
}

function lastTelemetryReason(): string | undefined {
  const events = deliverUsageEvents.mock.calls.at(-1)?.[0] as
    | Array<{ reason?: string }>
    | undefined;
  return events?.[0]?.reason;
}

beforeEach(() => {
  checkEndpointRateLimit.mockReset().mockResolvedValue(null);
  checkRateLimit.mockReset().mockResolvedValue(null);
  validateApiKey.mockReset().mockImplementation(async (request: Request, options?: { forceKey?: boolean }) =>
    emulateValidateApiKey(request, options));
  reserveDirectLlmQuota.mockReset().mockResolvedValue({
    ok: true,
    newCount: 1,
    rollback: async () => {},
  });
  deliverUsageEvents.mockReset().mockResolvedValue(undefined);
  cachedFetchJson.mockReset().mockImplementation(async (_key, _ttl, fetcher) => fetcher());
  callLlm.mockReset().mockImplementation(async (options) => {
    options.validate(JSON.stringify({ level: "high", category: "conflict" }));
    return { content: JSON.stringify({ level: "high", category: "conflict" }) };
  });
});

describe("gateway direct LLM quota", () => {
  test.each([
    [{ "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" }, 403],
    [{}, 403],
    [{ "Sec-Fetch-Site": "same-origin" }, 200],
    [{ Origin: "https://www.worldmonitor.app" }, 200],
  ])("cookie-backed model requests require request intent: %j", async (intent, status) => {
    validateApiKey.mockResolvedValue({ valid: true, required: true, kind: "enterprise", credential: "cookie-operator" });
    const calls = { classify: 0, deduct: 0, cache: 0 };
    const response = await makeGateway(calls)(req(`${CLASSIFY_PATH}?title=Novel`, {
      headers: { Cookie: "__Host-wm-pro-key=cookie-operator", ...intent },
    }), { waitUntil: () => {} });
    expect(response.status).toBe(status);
    expect(calls.classify).toBe(status === 200 ? 1 : 0);
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });
  describe.each([CLASSIFY_PATH, COUNTRY_BRIEF_PATH, ANALYZE_PATH])("GET compatibility quota: %s", (path) => {
    function request(method: string, body = JSON.stringify({ title: "Novel headline" })) {
      return req(method === "POST" ? path : `${path}?title=Novel%20headline`, {
        method,
        headers: {
          "X-WorldMonitor-Key": OP, "Content-Type": "application/json",
          ...(method === "POST" ? { "Content-Length": String(new TextEncoder().encode(body).length) } : {}),
        },
        ...(method === "POST" ? { body } : {}),
      });
    }

    test.each(["GET", "POST", "HEAD"])("exhausted %s allowance blocks dispatch", async (method) => {
      const handler = vi.fn().mockResolvedValue(json({ ok: true }));
      reserveDirectLlmQuota.mockResolvedValue({ ok: false, reason: "cap-exceeded", floor: 50, retryAfterSec: 123 });
      const res = await createDomainGateway([{ method: "GET", path, handler }])(request(method), { waitUntil: () => {} });
      expect(res.status).toBe(429);
      expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
      expect(reserveDirectLlmQuota).toHaveBeenCalledWith(expect.objectContaining({ userId: OP_PRINCIPAL, limit: OP_LIMIT }));
      expect(handler).not.toHaveBeenCalled();
    });

    test.each(["GET", "POST", "HEAD"])("allowed %s reserves once before dispatch", async (method) => {
      const handler = vi.fn(async (routed: Request) => {
        expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
        expect(routed.method).toBe(method === "POST" ? "GET" : method);
        expect(new URL(routed.url).searchParams.get("title")).toBe("Novel headline");
        return json({ ok: true });
      });
      const res = await createDomainGateway([{ method: "GET", path, handler }])(request(method), { waitUntil: () => {} });
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
      expect(reserveDirectLlmQuota).toHaveBeenCalledWith(expect.objectContaining({ userId: OP_PRINCIPAL, limit: OP_LIMIT }));
    });

    if (path === CLASSIFY_PATH) {
      test.each(["GET", "POST"])("real classification %s respects exhaustion before LLM transport", async (method) => {
        const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
        reserveDirectLlmQuota.mockResolvedValue({ ok: false, reason: "cap-exceeded", floor: 50, retryAfterSec: 123 });
        const blocked = await gateway(request(method), { waitUntil: () => {} });
        expect(blocked.status).toBe(429);
        expect(callLlm).not.toHaveBeenCalled();
        expect(cachedFetchJson).not.toHaveBeenCalled();

        reserveDirectLlmQuota.mockReset().mockResolvedValue({ ok: true, newCount: 1, rollback: async () => {} });
        const allowed = await gateway(request(method), { waitUntil: () => {} });
        expect(allowed.status).toBe(200);
        expect(await allowed.json()).toMatchObject({ classification: { category: "conflict", subcategory: "high" } });
        expect(callLlm).toHaveBeenCalledTimes(1);
        expect(callLlm).toHaveBeenCalledWith(expect.objectContaining({
          messages: expect.arrayContaining([{ role: "user", content: "Novel headline" }]),
        }));
        expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
      });

      test.each(["GET", "POST"])("real classification %s cache hit reserves once without LLM work", async (method) => {
        cachedFetchJson.mockResolvedValue({ level: "high", category: "conflict", timestamp: Date.now() });
        const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
        const res = await gateway(request(method), { waitUntil: () => {} });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ classification: { category: "conflict" } });
        expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
        expect(callLlm).not.toHaveBeenCalled();
      });
    }

    test.each([null, "1048576"])("ineligible POST content length %s never dispatches or charges", async (length) => {
      const post = request("POST");
      if (length === null) post.headers.delete("Content-Length");
      else post.headers.set("Content-Length", length);
      const handler = vi.fn();
      const res = await createDomainGateway([{ method: "GET", path, handler }])(post, { waitUntil: () => {} });
      expect(res.status).toBe(405);
      expect(handler).not.toHaveBeenCalled();
      expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
    });

    test.each(["{bad json", JSON.stringify({ title: { nested: true } })])("invalid POST body %s never dispatches or charges", async (body) => {
      const handler = vi.fn();
      const res = await createDomainGateway([{ method: "GET", path, handler }])(request("POST", body), { waitUntil: () => {} });
      expect(res.status).toBe(400);
      expect(checkEndpointRateLimit).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
      expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
    });

    test("unsupported method never dispatches or charges", async () => {
      const handler = vi.fn();
      const res = await createDomainGateway([{ method: "GET", path, handler }])(request("PUT"), { waitUntil: () => {} });
      expect(res.status).toBe(405);
      expect(handler).not.toHaveBeenCalled();
      expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
    });
  });

  test("country brief is a premium route", () => {
    expect(PREMIUM_RPC_PATHS.has(COUNTRY_BRIEF_PATH)).toBe(true);
  });

  test("anonymous session country brief is rejected before quota or handler spend", async () => {
    const calls = { classify: 0, deduct: 0, country: 0, cache: 0 };

    const res = await makeGateway(calls)(
      req(`${COUNTRY_BRIEF_PATH}?country_code=US`, {
        headers: { "X-WorldMonitor-Key": "wms_anonymous" },
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Pro authentication required" });
    expect(calls.country).toBe(0);
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
  });

  test("operator key HEAD country brief reserves the same GET quota and suppresses the body", async () => {
    const calls = { classify: 0, deduct: 0, country: 0, cache: 0 };

    const res = await makeGateway(calls)(
      req(`${COUNTRY_BRIEF_PATH}?country_code=US`, {
        method: "HEAD",
        headers: OP_HEADERS,
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(calls.country).toBe(1);
    expect(reserveDirectLlmQuota).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OP_PRINCIPAL }),
    );
  });

  test("operator key country brief reserves quota and reaches the handler", async () => {
    const calls = { classify: 0, deduct: 0, country: 0, cache: 0 };

    const res = await makeGateway(calls)(
      req(`${COUNTRY_BRIEF_PATH}?country_code=US`, {
        headers: OP_HEADERS,
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    expect(calls.country).toBe(1);
    expect(reserveDirectLlmQuota).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OP_PRINCIPAL }),
    );
  });

  test("anonymous wms-only classify-event is blocked before handler spend", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
        headers: { "X-WorldMonitor-Key": "wms_anonymous" },
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(401);
    expect(calls.classify).toBe(0);
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
  });

  test("signed-out classify-event is rejected before quota or handler spend", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(401);
    expect(calls.classify).toBe(0);
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
  });

  test("operator key HEAD classify-event reserves the same GET quota before the handler", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
        method: "HEAD",
        headers: OP_HEADERS,
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(calls.classify).toBe(1);
    expect(reserveDirectLlmQuota).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OP_PRINCIPAL }),
    );
  });

  test("operator key classify-event reserves direct LLM quota before the handler", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
        headers: OP_HEADERS,
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    expect(calls.classify).toBe(1);
    expect(checkEndpointRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      CLASSIFY_PATH,
      expect.any(Object),
    );
    expect(reserveDirectLlmQuota).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OP_PRINCIPAL }),
    );
  });

  test("operator key classify-event reserves on its per-key bucket at the operator ceiling", async () => {
    // Operator keys used to bypass this reservation entirely (unbounded spend
    // on a leaked key). They now share widget-agent's wm:<sha256> bucket.
    const calls = { classify: 0, deduct: 0, cache: 0 };
    validateApiKey.mockResolvedValue({
      valid: true, required: true, kind: "enterprise", credential: "operator-test-key",
    });

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
        headers: { "X-WorldMonitor-Key": "operator-test-key" },
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    expect(calls.classify).toBe(1);
    expect(reserveDirectLlmQuota).toHaveBeenCalledWith(expect.objectContaining({
      userId: await operatorKeyQuotaPrincipal("operator-test-key"),
      limit: OPERATOR_KEY_DAILY_CEILINGS.directLlmCalls,
    }));
  });

  test("operator key is refused once its direct-LLM ceiling is spent", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };
    validateApiKey.mockResolvedValue({
      valid: true, required: true, kind: "enterprise", credential: "operator-test-key",
    });
    reserveDirectLlmQuota.mockResolvedValue({
      ok: false, reason: "cap-exceeded", floor: OPERATOR_KEY_DAILY_CEILINGS.directLlmCalls, retryAfterSec: 60,
    });

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
        headers: { "X-WorldMonitor-Key": "operator-test-key" },
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(429);
    expect(calls.classify).toBe(0);
  });

  test("operator key analyze-stock uses the IP endpoint bucket", async () => {
    const calls = { analyze: 0 };

    const res = await makeAnalyzeGateway(calls)(
      req(`${ANALYZE_PATH}?symbol=AAPL`, {
        headers: OP_HEADERS,
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    expect(calls.analyze).toBe(1);
    expect(checkEndpointRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      ANALYZE_PATH,
      expect.any(Object),
    );
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test("operator key backtest-stock does not reserve the direct-LLM daily counter", async () => {
    const calls = { backtest: 0 };

    const res = await makeBacktestGateway(calls)(
      req(`${BACKTEST_PATH}?symbol=AAPL`, {
        headers: OP_HEADERS,
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    expect(calls.backtest).toBe(1);
    expect(checkEndpointRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      BACKTEST_PATH,
      expect.any(Object),
    );
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
  });

  test("endpoint limiter 429s emit a distinct telemetry reason", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };
    checkEndpointRateLimit.mockResolvedValue(json({ error: "Too many requests" }, 429));
    const recorder = makeRecordingCtx();

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
        headers: OP_HEADERS,
      }),
      recorder.ctx,
    );
    await recorder.settle();

    expect(res.status).toBe(429);
    expect(lastTelemetryReason()).toBe("rate_limit_429_endpoint");
    expect(calls.classify).toBe(0);
  });

  test("endpoint limiter degradation keeps the degraded telemetry reason", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };
    checkEndpointRateLimit.mockResolvedValue(new Response(
      JSON.stringify({ error: "Rate limiting temporarily unavailable" }),
      { status: 503, headers: { "X-RateLimit-Mode": "degraded" } },
    ));
    const recorder = makeRecordingCtx();

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
        headers: OP_HEADERS,
      }),
      recorder.ctx,
    );
    await recorder.settle();

    expect(res.status).toBe(503);
    expect(lastTelemetryReason()).toBe("rate_limit_degraded");
    expect(calls.classify).toBe(0);
  });

  test("global limiter 429s emit a distinct telemetry reason", async () => {
    const calls = { quotes: 0 };
    checkRateLimit.mockResolvedValue(json({ error: "Too many requests" }, 429));
    const recorder = makeRecordingCtx();

    const res = await makeMarketQuotesGateway(calls)(
      req(`${GLOBAL_LIMITED_PATH}?ids=bitcoin`, {
        headers: OP_HEADERS,
      }),
      recorder.ctx,
    );
    await recorder.settle();

    expect(res.status).toBe(429);
    expect(lastTelemetryReason()).toBe("rate_limit_429_global");
    expect(calls.quotes).toBe(0);
  });

  test("global limiter degradation keeps the degraded telemetry reason", async () => {
    const calls = { quotes: 0 };
    checkRateLimit.mockResolvedValue(new Response(
      JSON.stringify({ error: "Rate limiting temporarily unavailable" }),
      { status: 503, headers: { "X-RateLimit-Mode": "degraded" } },
    ));
    const recorder = makeRecordingCtx();

    const res = await makeMarketQuotesGateway(calls)(
      req(`${GLOBAL_LIMITED_PATH}?ids=bitcoin`, {
        headers: OP_HEADERS,
      }),
      recorder.ctx,
    );
    await recorder.settle();

    expect(res.status).toBe(503);
    expect(lastTelemetryReason()).toBe("rate_limit_degraded");
    expect(calls.quotes).toBe(0);
  });

  test("direct LLM quota 429s emit a distinct telemetry reason", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };
    reserveDirectLlmQuota.mockResolvedValue({
      ok: false,
      reason: "cap-exceeded",
      floor: 50,
      retryAfterSec: 123,
    });
    const recorder = makeRecordingCtx();

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
        headers: OP_HEADERS,
      }),
      recorder.ctx,
    );
    await recorder.settle();

    expect(res.status).toBe(429);
    expect(lastTelemetryReason()).toBe("rate_limit_429_direct_llm");
    expect(calls.classify).toBe(0);
  });

  test("direct LLM quota degradation keeps the degraded telemetry reason", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };
    reserveDirectLlmQuota.mockResolvedValue({
      ok: false,
      reason: "redis-unavailable",
      retryAfterSec: 30,
    });
    const recorder = makeRecordingCtx();

    const res = await makeGateway(calls)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
        headers: OP_HEADERS,
      }),
      recorder.ctx,
    );
    await recorder.settle();

    expect(res.status).toBe(503);
    expect(lastTelemetryReason()).toBe("rate_limit_degraded");
    expect(calls.classify).toBe(0);
  });

  test("direct LLM quota exhaustion returns 429 with Retry-After and skips handler", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };
    reserveDirectLlmQuota.mockResolvedValue({
      ok: false,
      reason: "cap-exceeded",
      floor: 50,
      retryAfterSec: 123,
    });

    const res = await makeGateway(calls)(
      req(DEDUCT_PATH, {
        method: "POST",
        headers: { "X-WorldMonitor-Key": OP, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Will tensions escalate?" }),
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("123");
    await expect(res.json()).resolves.toMatchObject({ error: "Direct LLM daily quota exceeded" });
    expect(calls.deduct).toBe(0);
  });

  test("summarize-article-cache remains quota-exempt read-only behavior", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };
    validateApiKey.mockResolvedValue({ valid: true, required: false, kind: "session" });

    const res = await makeGateway(calls)(
      req(`${CACHE_PATH}?cache_key=summary:v1:test`, {
        headers: { "X-WorldMonitor-Key": "wms_anonymous" },
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    expect(calls.cache).toBe(1);
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
  });
});

// Without an operator key there is no principal to meter, so a direct-LLM
// route answers 401 before any reservation, even on a route a session reaches.
describe("direct LLM quota without an operator key", () => {
  test("an anonymous session never reserves or reaches deduct-situation", async () => {
    const calls = { classify: 0, deduct: 0, cache: 0 };
    const res = await makeGateway(calls)(
      req(DEDUCT_PATH, {
        method: "POST",
        headers: { "X-WorldMonitor-Key": "wms_anonymous", "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Will tensions escalate?" }),
      }),
      { waitUntil: () => {} },
    );
    expect(res.status).toBe(401);
    expect(calls.deduct).toBe(0);
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
  });
});

// The reservation is charged BEFORE the handler runs, so every outcome that
// serves no answer has to give the slot back through the reservation's own
// rollback (#5147's open checklist item; the same defect api/chat-analyst.ts
// fixed for its self-metered reservation in #7217). The stub routes pin the
// gateway's decision; the real intelligence routes pin that the handlers'
// degraded envelopes actually raise the marker the gateway acts on.
describe("direct LLM quota release on unserved requests", () => {
  const rollback = vi.fn();

  function deductRequest(query: string) {
    const body = JSON.stringify({ query });
    return req(DEDUCT_PATH, {
      method: "POST",
      headers: {
        ...OP_HEADERS,
        "Content-Type": "application/json",
        "Content-Length": String(new TextEncoder().encode(body).length),
      },
      body,
    });
  }

  function classifyRequest() {
    return req(`${CLASSIFY_PATH}?title=Novel%20headline`, {
      headers: OP_HEADERS,
    });
  }

  function stubGateway(handler: (request: Request) => Promise<Response>) {
    return createDomainGateway([{ method: "GET", path: CLASSIFY_PATH, handler }]);
  }

  beforeEach(() => {
    rollback.mockReset().mockResolvedValue(undefined);
    reserveDirectLlmQuota.mockResolvedValue({ ok: true, newCount: 1, rollback });
  });

  test("a served 200 keeps the reservation", async () => {
    const res = await stubGateway(async () => json({ ok: true }))(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  test("a handler that throws releases the reservation with the 500", async () => {
    const res = await stubGateway(async () => {
      throw new Error("upstream exploded");
    })(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(500);
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test.each([400, 429, 503])("a handler %s response releases the reservation", async (status) => {
    const res = await stubGateway(async () => json({ message: "no" }, status))(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(status);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("a 200 envelope marked unserved releases the reservation", async () => {
    const res = await stubGateway(async (request) => {
      markUnservedLlmResponse(request);
      return json({ classification: undefined });
    })(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("a retryable 200 envelope releases the reservation", async () => {
    const res = await stubGateway(async (request) => {
      markRetryableResponse(request);
      return json({ summary: "", fallback: true });
    })(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("a response body that fails to stream releases the reservation with the rejection", async () => {
    const gateway = stubGateway(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("body stream broke"));
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(gateway(classifyRequest(), { waitUntil: () => {} })).rejects.toThrow("body stream broke");
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["invalid syntax", "[[[", "invalid_expression"],
    ["invalid input type", "length(classification.confidence)", "invalid_expression"],
    ["unsafe expansion", `classification${" | [@,@,@,@,@,@,@,@]".repeat(5)}`, "invalid_expression"],
  ])("a failed projection (%s) keeps completed model work charged", async (_name, expression, error) => {
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(
      req(`${CLASSIFY_PATH}?title=Novel%20headline&jmespath=${encodeURIComponent(expression)}`, { headers: OP_HEADERS }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ _jmespath_error: expect.stringContaining(error) });
    expect(callLlm).toHaveBeenCalledTimes(1);
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  test("an oversized projection keeps completed handler work charged", async () => {
    const completedWork = vi.fn(async () => json({ answer: "x".repeat(256 * 1024) }));
    const res = await stubGateway(completedWork)(
      req(`${CLASSIFY_PATH}?title=Novel%20headline&jmespath=answer`, { headers: OP_HEADERS }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ _jmespath_error: expect.stringContaining("projection_too_large") });
    expect(completedWork).toHaveBeenCalledTimes(1);
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  test("a successful jmespath projection keeps the reservation", async () => {
    const res = await stubGateway(async () => json({ classification: { category: "conflict" } }))(
      req(`${CLASSIFY_PATH}?title=Novel%20headline&jmespath=classification.category`, { headers: OP_HEADERS }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    expect(rollback).not.toHaveBeenCalled();
  });

  test("the unserved marker is drained even when nothing was reserved", async () => {
    // A route outside the quota paths reserves nothing; assert on the request
    // object the handler received, where the marker lives.
    let handledRequest: Request | undefined;

    const res = await createDomainGateway([{
      method: "GET",
      path: CACHE_PATH,
      handler: async (handled) => {
        handledRequest = handled;
        markUnservedLlmResponse(handled);
        return json({ classification: undefined });
      },
    }])(req(`${CACHE_PATH}?cache_key=summary:v1:test`, { headers: OP_HEADERS }), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
    expect(handledRequest).toBeDefined();
    expect(drainUnservedLlmResponse(handledRequest!)).toBe(false);
  });

  test("real classification keeps the charge on a served answer", async () => {
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ classification: { category: "conflict" } });
    expect(rollback).not.toHaveBeenCalled();
  });

  test("real classification keeps the charge on a cache hit", async () => {
    cachedFetchJson.mockResolvedValue({ level: "high", category: "conflict", timestamp: Date.now() });
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(callLlm).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  test("real classification releases the reservation for a cache hit that fails validation", async () => {
    cachedFetchJson.mockResolvedValue({ level: "high", category: "<img src=x>", timestamp: Date.now() });
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(callLlm).not.toHaveBeenCalled();
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("real classification releases the reservation when the LLM returns nothing", async () => {
    callLlm.mockResolvedValue(null);
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(callLlm).toHaveBeenCalledTimes(1);
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("real classification releases the reservation for a blank title", async () => {
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(req(`${CLASSIFY_PATH}?title=`, { headers: OP_HEADERS }), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(callLlm).not.toHaveBeenCalled();
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("real classification releases the reservation when the LLM transport throws", async () => {
    cachedFetchJson.mockRejectedValue(new Error("redis down"));
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(classifyRequest(), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("real deduct-situation releases the reservation when the reasoning budget yields nothing", async () => {
    cachedFetchJson.mockResolvedValue(null);
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(deductRequest("What happens next in the Red Sea?"), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: "error" });
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("real deduct-situation releases the reservation for a blank query", async () => {
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(deductRequest("   "), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: "skipped" });
    expect(cachedFetchJson).not.toHaveBeenCalled();
    expect(reserveDirectLlmQuota).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("real deduct-situation keeps the charge on a served analysis", async () => {
    cachedFetchJson.mockResolvedValue({ analysis: "Escalation is likely.", model: "m", provider: "groq" });
    const gateway = createDomainGateway(createIntelligenceServiceRoutes(intelligenceHandler));
    const res = await gateway(deductRequest("What happens next in the Red Sea?"), { waitUntil: () => {} });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ analysis: "Escalation is likely.", provider: "groq" });
    expect(rollback).not.toHaveBeenCalled();
  });
});

// The two remaining gateway-metered handlers are driven directly: what
// matters is that each empty envelope raises the marker on the very Request
// the gateway will drain, and that a served summary does not.
describe("unserved-LLM marker on the remaining metered handlers", () => {
  function handlerCtx(url: string, init: RequestInit = {}) {
    const request = new Request(url, init);
    return { ctx: { request } as never, request };
  }

  // A 400 releases the reservation on status alone ("a handler 400 response
  // releases the reservation"), so a rejected code needs no unserved marker.
  test.each(["ZZZ", "ZZ"])("country brief rejects country code %s with a 400 before any read", async (code) => {
    const { ctx } = handlerCtx(`https://www.worldmonitor.app/api/intelligence/v1/get-country-intel-brief?country_code=${code}`);
    await expect(getCountryIntelBrief(ctx, { countryCode: code } as never)).rejects.toMatchObject({
      name: "ValidationError",
      violations: [{ field: "country_code" }],
    });
    expect(cachedFetchJson).not.toHaveBeenCalled();
  });

  test("country brief marks a failed LLM path as unserved", async () => {
    cachedFetchJson.mockRejectedValue(new Error("redis down"));
    const { ctx, request } = handlerCtx("https://www.worldmonitor.app/api/intelligence/v1/get-country-intel-brief?country_code=US");
    const res = await getCountryIntelBrief(ctx, { countryCode: "US" } as never);

    expect(res.brief).toBe("");
    expect(drainUnservedLlmResponse(request)).toBe(true);
  });

  test("country brief keeps a served brief charged", async () => {
    cachedFetchJson.mockResolvedValue({
      countryCode: "US", countryName: "United States", brief: "Stable.", model: "m", generatedAt: 1, sources: [],
    });
    const { ctx, request } = handlerCtx("https://www.worldmonitor.app/api/intelligence/v1/get-country-intel-brief?country_code=US");
    const res = await getCountryIntelBrief(ctx, { countryCode: "US" } as never);

    expect(res.brief).toBe("Stable.");
    expect(drainUnservedLlmResponse(request)).toBe(false);
  });

  test("summarize-article marks a denied non-premium call as unserved", async () => {
    const { ctx, request } = handlerCtx("https://www.worldmonitor.app/api/news/v1/summarize-article", { method: "POST" });
    const res = await summarizeArticle(ctx, { provider: "groq", mode: "brief", headlines: ["A headline"] } as never);

    expect(res.summary).toBe("");
    expect(res.status).toBe("SUMMARIZE_STATUS_ERROR");
    expect(drainUnservedLlmResponse(request)).toBe(true);
  });

  test("summarize-article marks a rejected headline set as unserved", async () => {
    // A configured provider and a supported target language, so the call gets
    // past the credential and language checks to the headline validation.
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    try {
      const { ctx, request } = handlerCtx("https://www.worldmonitor.app/api/news/v1/summarize-article", { method: "POST" });
      const res = await summarizeArticle(ctx, { provider: "openrouter", mode: "translate", variant: "fr", headlines: [] } as never);

      expect(res.summary).toBe("");
      expect(res.statusDetail).toBe("Headlines array required");
      expect(drainUnservedLlmResponse(request)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("summarize-article marks an unsupported translation language as unserved", async () => {
    const { ctx, request } = handlerCtx("https://www.worldmonitor.app/api/news/v1/summarize-article", { method: "POST" });
    const res = await summarizeArticle(ctx, { provider: "openrouter", mode: "translate", variant: "xx", headlines: ["A headline"] } as never);

    expect(res.summary).toBe("");
    expect(res.statusDetail).toBe("Unsupported translation language");
    expect(drainUnservedLlmResponse(request)).toBe(true);
  });
});
