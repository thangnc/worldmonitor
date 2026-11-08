// Dev only (healthDevPlugin in vite.config.ts). In production, api/health.js
// keeps its verdict in Redis: a 60 s snapshot, a 600 s last-known copy, and a
// 30 s refresh lease, all written and released with EVAL scripts. The local
// Redis REST proxy (docker/redis-rest-proxy.mjs) refuses those scripts, so
// locally none of the copies is ever written and the lease is never released.
// Every request in the 30 s after a sweep then waits 3 s and answers
// 503 REFRESH_PENDING, and the Lite sidebar card and Sources screen read
// Unknown. This keeps the two copies in memory, with production's lifetimes.
// Only compact responses (the public mode Lite reads) are kept.

export const DEV_HEALTH_SNAPSHOT_TTL_MS = 60_000;
export const DEV_HEALTH_LAST_KNOWN_TTL_MS = 600_000;

export interface DevHealthResponse {
  status: number;
  headers: Array<[string, string]>;
  body: string;
}

interface StoredVerdict extends DevHealthResponse {
  storedAt: number;
}

function isRefreshPending(response: DevHealthResponse): boolean {
  if (response.status !== 503) return false;
  try {
    return (JSON.parse(response.body) as { status?: unknown }).status === 'REFRESH_PENDING';
  } catch {
    return false;
  }
}

// Same marker api/health.js puts on a last-known verdict.
function markStale(verdict: StoredVerdict): DevHealthResponse {
  const body = { ...(JSON.parse(verdict.body) as Record<string, unknown>), stale: true, staleReason: 'REFRESH_PENDING' };
  return { status: 200, headers: verdict.headers, body: JSON.stringify(body) };
}

export function createDevHealthCache(now: () => number = Date.now) {
  const verdicts = new Map<string, StoredVerdict>();
  const inFlight = new Map<string, Promise<DevHealthResponse>>();

  async function refresh(key: string, run: () => Promise<DevHealthResponse>): Promise<DevHealthResponse> {
    const response = await run();
    if (response.status === 200) {
      verdicts.set(key, { ...response, storedAt: now() });
      return response;
    }
    const lastKnown = verdicts.get(key);
    if (isRefreshPending(response) && lastKnown && now() - lastKnown.storedAt < DEV_HEALTH_LAST_KNOWN_TTL_MS) {
      return markStale(lastKnown);
    }
    return response;
  }

  return {
    // `origin` is part of the key: the handler answers 403 to a disallowed
    // origin and sets CORS headers per origin.
    async handle(url: URL, origin: string, run: () => Promise<DevHealthResponse>): Promise<DevHealthResponse> {
      if (url.searchParams.get('compact') !== '1') return run();
      const key = origin;
      const snapshot = verdicts.get(key);
      if (snapshot && now() - snapshot.storedAt < DEV_HEALTH_SNAPSHOT_TTL_MS) return snapshot;
      // Concurrent requests share one sweep instead of losing the lease race.
      let pending = inFlight.get(key);
      if (!pending) {
        pending = refresh(key, run).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return pending;
    },
  };
}
