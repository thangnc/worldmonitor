import { withBillingVerificationRetry } from './billing-retry';

// The desktop app (Tauri shell and Node sidecar) left in refactor Phase 1b and
// its runtime branches in the 2026-11 Lite-only cleanup: every /api/ call is a
// web call, same-origin unless VITE_WS_API_URL names an API base.

const ENV = (() => {
  try {
    return {
      VITE_WS_API_URL: import.meta.env.VITE_WS_API_URL,
    };
  } catch {
    return {} as Record<string, string | undefined>;
  }
})();

const WS_API_URL = ENV.VITE_WS_API_URL || '';
const DEFAULT_WEB_API_URL = 'https://api.worldmonitor.app';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function isWorldMonitorWebHost(hostname: string): boolean {
  return hostname === 'worldmonitor.app'
    || hostname === 'www.worldmonitor.app'
    || hostname.endsWith('.worldmonitor.app');
}

// Loopback page origins the API deliberately refuses in production. Keep in
// step with the bare-localhost entries in api/_cors.js and packages/server/cors.ts.
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * A page on loopback may not send /api/ to a remote origin.
 *
 * `api/_cors.js` and `packages/server/cors.ts` both drop bare localhost/127.0.0.1 from
 * the allow-list in production, so every such call returns 403 and the whole
 * UI renders unavailable. `VITE_WS_API_URL=https://api.worldmonitor.app`
 * in a developer's .env.local used to do exactly that to `npm run dev`, where
 * the Vite dev API plugin serves those routes same-origin anyway.
 *
 * Deliberately narrow: a loopback base stays honoured, so pointing dev at a
 * local API on another port still works. Deployed and self-hosted pages are
 * untouched — and the self-hosted image proxies /api/ server-side
 * (docker/nginx.conf.template).
 */
function suppressesRemoteBase(configuredBaseUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  if (!isLoopbackHostname(window.location?.hostname ?? '')) return false;
  return !isLoopbackHostname(hostnameOf(configuredBaseUrl));
}

export function getConfiguredWebApiBaseUrl(): string {
  if (WS_API_URL) {
    const configured = normalizeBaseUrl(WS_API_URL);
    return suppressesRemoteBase(configured) ? '' : configured;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const hostname = window.location?.hostname ?? '';
  if (!isWorldMonitorWebHost(hostname)) {
    return '';
  }

  return DEFAULT_WEB_API_URL;
}

export function getCanonicalApiOrigin(): string {
  return getConfiguredWebApiBaseUrl() || DEFAULT_WEB_API_URL;
}

export function toApiUrl(path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }

  const webApiBase = getConfiguredWebApiBaseUrl();
  if (!webApiBase) {
    return path;
  }

  return `${webApiBase}${path}`;
}

export {
  startSmartPollLoop,
  VisibilityHub,
} from './smart-poll-loop';
export type {
  SmartPollContext,
  SmartPollLoopHandle,
  SmartPollOptions,
  SmartPollReason,
} from './smart-poll-loop';

function canRetryRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const request = input instanceof Request ? input : undefined;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const signal = init?.signal === undefined ? request?.signal : init.signal;
  return (method === 'GET' || method === 'HEAD') && !signal?.aborted;
}

import { PREMIUM_RPC_PATHS as WEB_PREMIUM_API_PATHS } from '../shared/premium-paths';

const ALLOWED_REDIRECT_HOSTS = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*worldmonitor\.app(:\d+)?$/;

function isAllowedRedirectTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_REDIRECT_HOSTS.test(parsed.origin) || isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function installWebApiRedirect(): void {
  if (typeof window === 'undefined') return;
  if ((window as unknown as Record<string, unknown>).__wmWebRedirectPatched) return;

  const apiBase = getConfiguredWebApiBaseUrl();
  const hasRedirect = !!apiBase && isAllowedRedirectTarget(apiBase);
  if (apiBase && !hasRedirect) {
    console.warn('[runtime] web API base blocked — not in hostname allowlist:', apiBase);
  }

  const nativeFetch = window.fetch.bind(window);
  const shouldRedirectPath = (pathWithQuery: string): boolean => pathWithQuery.startsWith('/api/');
  const withCredentials = (init?: RequestInit): RequestInit => (
    { ...(init ?? {}), credentials: init?.credentials ?? 'include' }
  );

  /**
   * For premium API paths, inject auth when the user has premium access but no
   * existing auth header is present. Priority order:
   *   1. Existing auth headers — left unchanged (API key users keep their flow)
   *   2. WORLDMONITOR_API_KEY from runtime config → X-WorldMonitor-Key
   *   3. Tester session (wm-pro-key / wm-widget-key HttpOnly cookie)
   * Runs on every web deployment (with or without API base redirect).
   * Returns the original init unchanged for non-premium paths (zero overhead).
   */
  const enrichInitForPremium = async (pathWithQuery: string, init?: RequestInit): Promise<RequestInit | undefined> => {
    const path = pathWithQuery.split('?')[0] ?? pathWithQuery;
    if (!WEB_PREMIUM_API_PATHS.has(path)) return init;
    const headers = new Headers(init?.headers);
    // Don't overwrite existing auth headers
    if (headers.has('Authorization') || headers.has('X-WorldMonitor-Key')) return init;
    // WORLDMONITOR_API_KEY from env or runtime config
    try {
      const { getRuntimeConfigSnapshot } = await import('./runtime-config');
      const wmKey = getRuntimeConfigSnapshot().secrets['WORLDMONITOR_API_KEY']?.value;
      if (wmKey) {
        headers.set('X-WorldMonitor-Key', wmKey);
        return { ...withCredentials(init), headers };
      }
    } catch { /* runtime-config unavailable — fall through */ }
    // Tester sessions ride the HttpOnly wm-pro-key cookie: dispatch applies
    // withCredentials() to every redirected /api/ request, so no
    // script-visible key is read here.
    return init;
  };

  if (hasRedirect) {
    const API_BASE = apiBase;
    const shouldFallbackToOrigin = (status: number): boolean => (
      status === 404 || status === 405 || status === 501 || status === 502 || status === 503
    );
    const fetchWithRedirectFallback = async (
      redirectedInput: RequestInfo | URL,
      originalInput: RequestInfo | URL,
      originalInit?: RequestInit,
    ): Promise<Response> => {
      try {
        const redirectedResponse = await nativeFetch(redirectedInput, originalInit);
        if (!canRetryRequest(originalInput, originalInit) || !shouldFallbackToOrigin(redirectedResponse.status)) return redirectedResponse;
        return nativeFetch(originalInput, originalInit);
      } catch (error) {
        if (!canRetryRequest(originalInput, originalInit)) throw error;
        try {
          return await nativeFetch(originalInput, originalInit);
        } catch {
          throw error;
        }
      }
    };

    const dispatch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (typeof input === 'string') {
        if (shouldRedirectPath(input)) {
          // Relative /api/... path — redirect to API base and inject auth.
          const enriched = await enrichInitForPremium(input, init);
          return fetchWithRedirectFallback(`${API_BASE}${input}`, input, enriched ? withCredentials(enriched) : withCredentials(init));
        }
        // Generated clients construct an absolute API-base URL, so they cannot
        // rely on the relative-path branch above for origin recovery. Keep the
        // same fallback here: browser extensions and network policy can block
        // api.worldmonitor.app while the page's own /api/ route remains usable.
        if (input.startsWith(`${API_BASE}/api/`)) {
          const pathAndSearch = input.slice(API_BASE.length);
          const enriched = await enrichInitForPremium(pathAndSearch, init);
          const initWithCredentials = enriched ? withCredentials(enriched) : withCredentials(init);
          return fetchWithRedirectFallback(input, pathAndSearch, initWithCredentials);
        }
      }
      if (input instanceof URL) {
        const pathAndSearch = `${input.pathname}${input.search}`;
        if (input.origin === window.location.origin && shouldRedirectPath(pathAndSearch)) {
          const enriched = await enrichInitForPremium(pathAndSearch, init);
          return fetchWithRedirectFallback(new URL(`${API_BASE}${pathAndSearch}`), input, enriched ? withCredentials(enriched) : withCredentials(init));
        }
        // URL object already targeting the API base.
        if (input.origin === API_BASE && pathAndSearch.startsWith('/api/')) {
          const enriched = await enrichInitForPremium(pathAndSearch, init);
          return nativeFetch(input, enriched ? withCredentials(enriched) : withCredentials(init));
        }
      }
      if (input instanceof Request) {
        const u = new URL(input.url);
        const pathAndSearch = `${u.pathname}${u.search}`;
        if (u.origin === window.location.origin && shouldRedirectPath(pathAndSearch)) {
          const enriched = await enrichInitForPremium(pathAndSearch, init);
          return fetchWithRedirectFallback(
            new Request(`${API_BASE}${pathAndSearch}`, input),
            input.clone(),
            enriched ? withCredentials(enriched) : withCredentials(init),
          );
        }
        // Request object already targeting the API base.
        if (u.origin === API_BASE && pathAndSearch.startsWith('/api/')) {
          const enriched = await enrichInitForPremium(pathAndSearch, init);
          return nativeFetch(new Request(input, enriched ? withCredentials(enriched) : withCredentials(init)));
        }
      }
      return nativeFetch(input, init);
    };
    window.fetch = withBillingVerificationRetry(dispatch);
  } else {
    // No API base redirect — only inject auth headers for premium paths.
    const dispatch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (typeof input === 'string') {
        if (shouldRedirectPath(input)) {
          const enriched = await enrichInitForPremium(input, init);
          return nativeFetch(input, enriched ? withCredentials(enriched) : withCredentials(init));
        }
        if (input.startsWith(`${DEFAULT_WEB_API_URL}/api/`)) {
          const pathAndSearch = input.slice(DEFAULT_WEB_API_URL.length);
          const enriched = await enrichInitForPremium(pathAndSearch, init);
          return nativeFetch(input, enriched ? withCredentials(enriched) : withCredentials(init));
        }
      }
      if (input instanceof URL) {
        const pathAndSearch = `${input.pathname}${input.search}`;
        if ((input.origin === window.location.origin || input.origin === DEFAULT_WEB_API_URL)
            && (shouldRedirectPath(pathAndSearch) || pathAndSearch.startsWith('/api/'))) {
          const enriched = await enrichInitForPremium(pathAndSearch, init);
          return nativeFetch(input, enriched ? withCredentials(enriched) : withCredentials(init));
        }
      }
      if (input instanceof Request) {
        const u = new URL(input.url);
        const pathAndSearch = `${u.pathname}${u.search}`;
        if ((u.origin === window.location.origin || u.origin === DEFAULT_WEB_API_URL)
            && (shouldRedirectPath(pathAndSearch) || pathAndSearch.startsWith('/api/'))) {
          const enriched = await enrichInitForPremium(pathAndSearch, init);
          return nativeFetch(new Request(input, enriched ? withCredentials(enriched) : withCredentials(init)));
        }
      }
      return nativeFetch(input, init);
    };
    window.fetch = withBillingVerificationRetry(dispatch);
  }

  (window as unknown as Record<string, unknown>).__wmWebRedirectPatched = true;
}
