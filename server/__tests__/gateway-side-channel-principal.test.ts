// @vitest-environment node

/**
 * Handler side channels for an operator-key caller on a premium route
 * (server/_shared/response-headers.ts -> server/gateway.ts). Every side channel
 * is a WeakMap/WeakSet keyed by the Request object the handler wrote on, so the
 * gateway must drain them from the request it dispatched. No credential carries
 * a user principal, so the gateway stamps none and strips a client-sent copy.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const runRedisPipeline = vi.fn();
vi.mock("../_shared/redis", async (importActual) => {
  const actual = await importActual<typeof import("../_shared/redis")>();
  return {
    ...actual,
    runRedisPipeline: (...a: unknown[]) => runRedisPipeline(...a),
  };
});

const checkRateLimit = vi.fn();
const checkEndpointRateLimit = vi.fn();
vi.mock("../_shared/rate-limit", async (importActual) => {
  const actual = await importActual<typeof import("../_shared/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
    checkEndpointRateLimit: (...a: unknown[]) => checkEndpointRateLimit(...a),
  };
});

// The operator-key meter is unit-tested elsewhere; keep it out of the Redis
// call sequence these tests pin.
vi.mock("../_shared/api-key-rate-limit", async (importActual) => ({
  ...(await importActual<typeof import("../_shared/api-key-rate-limit")>()),
  checkBurst: async () => ({ ok: null, reason: "not_configured" }),
  reserveDailyMeter: async () => ({ metered: false, overLimit: false, count: 0, retryAfterSec: 0, rollback: async () => {} }),
}));

const validateApiKey = vi.fn();
vi.mock("../../api/_api-key.js", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  validateApiKey: (...a: unknown[]) => validateApiKey(...a),
}));

const deliverUsageEvents = vi.fn();
vi.mock("../_shared/usage", async (importActual) => {
  const actual = await importActual<typeof import("../_shared/usage")>();
  return {
    ...actual,
    deliverUsageEvents: (...a: unknown[]) => deliverUsageEvents(...a),
  };
});

import { createDomainGateway } from "../gateway";
import {
  markRetryableResponse,
  setResponseHeader,
  setSuccessStatusOverride,
} from "../_shared/response-headers";
import { IDEMPOTENCY_HEADER } from "../_shared/idempotency";
import { TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER } from "../_shared/rate-limit";
import {
  createScenarioServiceRoutes,
  type RunScenarioResponse,
  type ScenarioServiceHandler,
} from "../../src/generated/server/worldmonitor/scenario/v1/service_server";

const RUN_PATH = "/api/scenario/v1/run-scenario";
const STATUS_URL =
  "/api/scenario/v1/get-scenario-status?jobId=scenario%3A1717200000000%3Aabcd1234";
const ctx = { waitUntil: () => {} };

const ACCEPTED: RunScenarioResponse = {
  jobId: "scenario:1717200000000:abcd1234",
  status: "pending",
  statusUrl: STATUS_URL,
};

const runScenario = vi.fn<ScenarioServiceHandler["runScenario"]>();
const scenarioHandler = {
  runScenario: (...a: Parameters<ScenarioServiceHandler["runScenario"]>) =>
    runScenario(...a),
} as unknown as ScenarioServiceHandler;

// The generated route, so the handler writes on ctx.request exactly as the
// production run-scenario handler does.
function makeGateway() {
  return createDomainGateway(createScenarioServiceRoutes(scenarioHandler));
}

function post(headers: Record<string, string> = {}): Request {
  return new Request(`https://www.worldmonitor.app${RUN_PATH}`, {
    method: "POST",
    headers: {
      "X-WorldMonitor-Key": "operator-test-key",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.7",
      ...headers,
    },
    body: JSON.stringify({ scenarioId: "hormuz-closure", iso2: "US" }),
  });
}

beforeEach(() => {
  runRedisPipeline.mockReset().mockResolvedValue([]);
  checkRateLimit.mockReset().mockResolvedValue(null);
  checkEndpointRateLimit.mockReset().mockResolvedValue(null);
  validateApiKey.mockReset().mockResolvedValue({
    valid: true,
    required: true,
    kind: "enterprise",
    credential: "operator-test-key",
  });
  deliverUsageEvents.mockReset().mockResolvedValue(undefined);
  runScenario.mockReset().mockImplementation(async (handlerCtx) => {
    setSuccessStatusOverride(handlerCtx.request, 202);
    setResponseHeader(handlerCtx.request, "Location", STATUS_URL);
    return ACCEPTED;
  });
});

describe("gateway side channels for an operator-key caller", () => {
  test("the handler never sees a rate-limit principal, even a client-sent one", async () => {
    await makeGateway()(post({ [TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER]: "session:forged" }), ctx);

    expect(runScenario).toHaveBeenCalledTimes(1);
    const handlerRequest = runScenario.mock.calls[0]![0].request;
    expect(handlerRequest.headers.get(TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER)).toBeNull();
  });

  test("an operator-key run-scenario enqueue answers 202 with its Location header", async () => {
    const res = await makeGateway()(post(), ctx);

    expect(res.status).toBe(202);
    expect(res.headers.get("Location")).toBe(STATUS_URL);
    expect(await res.json()).toMatchObject({
      status: "pending",
      statusUrl: STATUS_URL,
    });
  });

  test("an in-band retryable response releases the idempotency lock", async () => {
    runScenario.mockReset().mockImplementation(async (handlerCtx) => {
      markRetryableResponse(handlerCtx.request);
      setResponseHeader(handlerCtx.request, "Retry-After", "5");
      return ACCEPTED;
    });
    runRedisPipeline
      .mockResolvedValueOnce([{ result: null }]) // peek miss
      .mockResolvedValueOnce([{ result: "OK" }, { result: null }]) // claim
      .mockResolvedValueOnce([{ result: 1 }]); // release or store

    const res = await makeGateway()(
      post({ [IDEMPOTENCY_HEADER]: "key-pro-retryable" }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Retry-After")).toBe("5");
    const finalCommand = runRedisPipeline.mock.calls[2]![0][0];
    expect(finalCommand[0]).toBe("DEL");
  });
});
