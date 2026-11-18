// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const checkEndpointRateLimit = vi.fn().mockResolvedValue(null);
const checkRateLimit = vi.fn().mockResolvedValue(null);
vi.mock("../_shared/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_shared/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
    checkEndpointRateLimit: (...a: unknown[]) => checkEndpointRateLimit(...a),
  };
});

const validateApiKey = vi.fn();
vi.mock("../../../api/_api-key.js", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  validateApiKey: (...a: unknown[]) => validateApiKey(...a),
}));

const reserveDirectLlmQuota = vi.fn();
vi.mock("../_shared/direct-llm-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_shared/direct-llm-quota")>();
  return {
    ...actual,
    reserveDirectLlmQuota: (...a: unknown[]) => reserveDirectLlmQuota(...a),
  };
});

import { createDomainGateway } from "../gateway";
import { ENDPOINT_RATE_POLICIES } from "../_shared/rate-limit";
import { operatorKeyQuotaPrincipal } from "../_shared/high-usage-alarm";
import { PREMIUM_RPC_PATHS } from "../../client/shared/premium-paths";

const SUMMARIZE_PATH = "/api/news/v1/summarize-article";
const CACHE_PATH = "/api/news/v1/summarize-article-cache";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeRequest(path: string, headers: Record<string, string> = {}, method = "POST") {
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify({ provider: "openrouter", headlines: ["headline"] });
  }
  return new Request(`https://www.worldmonitor.app${path}`, {
    ...init,
  });
}

function makeGateway(handlerCalls: { summarize: number; cache: number }) {
  return createDomainGateway([
    {
      method: "POST",
      path: SUMMARIZE_PATH,
      handler: async () => {
        handlerCalls.summarize += 1;
        return json({ ok: true, route: "summarize" });
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

beforeEach(() => {
  checkEndpointRateLimit.mockReset().mockResolvedValue(null);
  checkRateLimit.mockReset().mockResolvedValue(null);
  validateApiKey.mockReset().mockResolvedValue({
    valid: false,
    required: true,
    error: "API key required",
  });
  reserveDirectLlmQuota.mockReset().mockResolvedValue({
    ok: true,
    newCount: 1,
    rollback: async () => {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("summarize-article gateway spend controls", () => {
  test("route is explicitly premium-gated and endpoint-rate-limited", () => {
    expect(PREMIUM_RPC_PATHS.has(SUMMARIZE_PATH)).toBe(false);
    expect(ENDPOINT_RATE_POLICIES[SUMMARIZE_PATH]).toEqual({ limit: 30, window: "60 s" });
  });

  test("anonymous wms_ sessions cannot reach non-translate summarize handler spend", async () => {
    validateApiKey.mockResolvedValue({ valid: true, required: false, kind: "session" });
    const calls = { summarize: 0, cache: 0 };

    const res = await makeGateway(calls)(
      makeRequest(SUMMARIZE_PATH, { "X-WorldMonitor-Key": "wms_anonymous_session" }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(401);
    expect(calls.summarize).toBe(0);
    expect(checkEndpointRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      SUMMARIZE_PATH,
      expect.any(Object),
    );
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
  });

  test("an operator key reaches the handler on its per-key quota and the IP endpoint bucket", async () => {
    validateApiKey.mockResolvedValue({ valid: true, required: true, kind: "enterprise", credential: "operator-test-key" });
    const calls = { summarize: 0, cache: 0 };

    const res = await makeGateway(calls)(
      makeRequest(SUMMARIZE_PATH, { "X-WorldMonitor-Key": "operator-test-key" }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, route: "summarize" });
    expect(checkEndpointRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      SUMMARIZE_PATH,
      expect.any(Object),
    );
    expect(reserveDirectLlmQuota).toHaveBeenCalledWith(
      expect.objectContaining({ userId: await operatorKeyQuotaPrincipal("operator-test-key") }),
    );
    expect(calls.summarize).toBe(1);
  });

  test("a bearer token alone is not a credential", async () => {
    const calls = { summarize: 0, cache: 0 };

    const res = await makeGateway(calls)(
      makeRequest(SUMMARIZE_PATH, { Authorization: "Bearer pro-session" }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(401);
    expect(calls.summarize).toBe(0);
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
  });

  test("translate mode remains public and quota-exempt", async () => {
    validateApiKey.mockResolvedValue({ valid: true, required: false, kind: "session" });
    const calls = { summarize: 0, cache: 0 };

    const res = await makeGateway(calls)(
      makeRequest(SUMMARIZE_PATH, { "X-WorldMonitor-Key": "wms_anonymous_session" }, "POST"),
      { waitUntil: () => {} },
    );

    // makeRequest defaults to a brief body, so use a fresh request with the
    // translate mode body for the actual assertion.
    const translate = await makeGateway(calls)(
      new Request(`https://www.worldmonitor.app${SUMMARIZE_PATH}`, {
        method: "POST",
        headers: {
          "X-WorldMonitor-Key": "wms_anonymous_session",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider: "openrouter", mode: "translate", headlines: ["hola"] }),
      }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(401);
    expect(translate.status).toBe(200);
    expect(calls.summarize).toBe(1);
    expect(reserveDirectLlmQuota).not.toHaveBeenCalled();
  });

  test("Redis-degraded endpoint rate limiting fails closed before the provider handler", async () => {
    validateApiKey.mockResolvedValue({ valid: true, required: true, kind: "enterprise", credential: "operator-test-key" });
    checkEndpointRateLimit.mockResolvedValue(json({ error: "Rate-limit service temporarily unavailable" }, 503));
    const calls = { summarize: 0, cache: 0 };

    const res = await makeGateway(calls)(
      makeRequest(SUMMARIZE_PATH, { "X-WorldMonitor-Key": "operator-test-key" }),
      { waitUntil: () => {} },
    );

    expect(res.status).toBe(503);
    expect(calls.summarize).toBe(0);
  });

  test("summarize-article-cache remains ungated read-only cache lookup behavior", async () => {
    validateApiKey.mockResolvedValue({ valid: true, required: false, kind: "session" });
    const calls = { summarize: 0, cache: 0 };

    const res = await makeGateway(calls)(
      makeRequest(`${CACHE_PATH}?cache_key=test-cache-key`, { "X-WorldMonitor-Key": "wms_anonymous_session" }, "GET"),
      { waitUntil: () => {} },
    );

    expect(PREMIUM_RPC_PATHS.has(CACHE_PATH)).toBe(false);
    expect(res.status).toBe(200);
    expect(calls.cache).toBe(1);
    expect(calls.summarize).toBe(0);
  });
});
