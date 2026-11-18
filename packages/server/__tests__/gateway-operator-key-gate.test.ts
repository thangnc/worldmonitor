// @vitest-environment node

/**
 * The gateway's one auth rule, driven through the REAL validateApiKey
 * (api/_api-key.js) and a real signed wms_ session:
 *   - PREMIUM_RPC_PATHS take an operator key (WORLDMONITOR_VALID_KEYS) only;
 *     an anonymous session gets 401 "Pro authentication required".
 *   - Other routes take a session or an operator key.
 *   - A `wm_` user API key is not a credential: 401 "Invalid API key".
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../_shared/rate-limit", async (importActual) => ({
  ...(await importActual<typeof import("../_shared/rate-limit")>()),
  checkRateLimit: async () => null,
  checkEndpointRateLimit: async () => null,
}));
vi.mock("../_shared/api-key-rate-limit", async (importActual) => ({
  ...(await importActual<typeof import("../_shared/api-key-rate-limit")>()),
  checkBurst: async () => ({ ok: true }),
  reserveDailyMeter: async () => ({ metered: false, overLimit: false, count: 0, retryAfterSec: 0, rollback: async () => {} }),
}));

import { createDomainGateway, PUBLIC_NO_AUTH_RPC_PATHS } from "../gateway";
import { PREMIUM_RPC_PATHS } from "../../client/shared/premium-paths";
import { issueSessionToken } from "../../../api/_session.js";

const PREMIUM_PATH = "/api/supply-chain/v1/get-country-products";
const PUBLIC_PATH = "/api/intelligence/v1/get-china-decision-signals";
const SESSION_PATH = "/api/news/v1/list-feed-digest";
const OPERATOR_KEY = "operator-gate-test-key";
const ctx = { waitUntil: () => {} };

let handled: string[];
const gateway = createDomainGateway(
  [PREMIUM_PATH, PUBLIC_PATH, SESSION_PATH].map((path) => ({
    method: "GET",
    path,
    handler: async () => {
      handled.push(path);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  })),
);

const get = (path: string, headers: Record<string, string> = {}) =>
  gateway(new Request(`https://www.worldmonitor.app${path}`, {
    headers: { "cf-connecting-ip": "203.0.113.9", ...headers },
  }), ctx);

beforeEach(() => {
  handled = [];
  vi.stubEnv("WORLDMONITOR_VALID_KEYS", OPERATOR_KEY);
  vi.stubEnv("WM_SESSION_SECRET", "synthetic-gate-session-secret-0123456789abcdef");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gateway operator-key gate", () => {
  test("fixture paths sit in the classes they claim", () => {
    expect(PREMIUM_RPC_PATHS.has(PREMIUM_PATH)).toBe(true);
    expect(PUBLIC_NO_AUTH_RPC_PATHS.has(PUBLIC_PATH)).toBe(true);
    expect(PREMIUM_RPC_PATHS.has(SESSION_PATH) || PUBLIC_NO_AUTH_RPC_PATHS.has(SESSION_PATH)).toBe(false);
  });

  test.each(["header", "cookie"])("a premium path denies an anonymous %s session", async (kind) => {
    const { token } = await issueSessionToken();
    const res = await get(PREMIUM_PATH, kind === "header"
      ? { "X-WorldMonitor-Key": token }
      : { Cookie: `wm-session=${token}` });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Pro authentication required" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(handled).toEqual([]);
  });

  test("a premium path denies a caller with no credential", async () => {
    const res = await get(PREMIUM_PATH);
    expect(res.status).toBe(401);
    expect(handled).toEqual([]);
  });

  test.each([
    ["X-WorldMonitor-Key", OPERATOR_KEY],
    ["X-Api-Key", OPERATOR_KEY],
    ["Cookie", `__Host-wm-pro-key=${OPERATOR_KEY}`],
  ])("a premium path serves an operator key in %s", async (header, value) => {
    const res = await get(PREMIUM_PATH, { [header]: value });
    expect(res.status).toBe(200);
    expect(handled).toEqual([PREMIUM_PATH]);
    // Premium bodies stay private to the caller's browser.
    expect(res.headers.get("Cache-Control")).toContain("private");
  });

  test("a public path serves an anonymous session", async () => {
    const { token } = await issueSessionToken();
    const res = await get(PUBLIC_PATH, { "X-WorldMonitor-Key": token });
    expect(res.status).toBe(200);
    expect(handled).toEqual([PUBLIC_PATH]);
  });

  test("an ordinary path serves an anonymous session", async () => {
    const { token } = await issueSessionToken();
    const res = await get(SESSION_PATH, { "X-WorldMonitor-Key": token });
    expect(res.status).toBe(200);
    expect(handled).toEqual([SESSION_PATH]);
  });

  test.each([PREMIUM_PATH, SESSION_PATH])("a wm_ user API key is rejected on %s", async (path) => {
    const res = await get(path, { "X-Api-Key": `wm_${"a".repeat(40)}` });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid API key" });
    expect(handled).toEqual([]);
  });
});
