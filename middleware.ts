import { isKnownPublicPagePath, originNotFoundResponse } from './src/config/agent-not-found';
import { shouldRedirectToLite } from './src/config/lite-route';
import agentRequestPolicy from './shared/agent-request-policy.json';

const BOT_UA =
  /bot|crawl|spider|slurp|archiver|wget|curl\/|python-requests|scrapy|httpclient|go-http|java\/|libwww|perl|ruby|php\/|ahrefsbot|semrushbot|mj12bot|dotbot|baiduspider|yandexbot|sogou|bytespider|petalbot|gptbot|claudebot|ccbot/i;

const LEGACY_DASHBOARD_ROOT_QUERY_KEYS = ['lat', 'lon', 'zoom', 'view', 'timeRange', 'layers', 'c', 'country', 'chokepoint'] as const;
const UNBOUNDED_DASHBOARD_ROOT_QUERY_KEYS = ['lat', 'lon', 'zoom'] as const;

// Paths that bypass bot/script UA filtering below. Each must carry its own
// auth (API key, shared secret, or intentionally-public semantics) because
// this list disables the middleware's generic bot gate.
// - /api/version, /api/health: intentionally public, monitoring-friendly.
// - /api/seed-contract-probe: requires RELAY_SHARED_SECRET header; called by
//   UptimeRobot + ops curl. Was blocked by the curl/bot UA regex before this
//   exception landed (Vercel log 2026-04-15: "Middleware 403 Forbidden" on
//   /api/seed-contract-probe).
const PUBLIC_API_PATHS = new Set([
  '/api/version',
  '/api/health',
  '/api/seed-contract-probe',
]);

const SOCIAL_IMAGE_UA =
  /Slack-ImgProxy|Slackbot|twitterbot|facebookexternalhit|linkedinbot|telegrambot|whatsapp|discordbot|redditbot/i;


function hasLegacyDashboardRootState(searchParams: URLSearchParams): boolean {
  return LEGACY_DASHBOARD_ROOT_QUERY_KEYS.some((key) => searchParams.has(key));
}

function hasUnboundedDashboardRootState(searchParams: URLSearchParams): boolean {
  return UNBOUNDED_DASHBOARD_ROOT_QUERY_KEYS.some((key) => searchParams.has(key));
}

/** Query keys that create duplicate index entries without changing document identity. */
const INDEX_NOISE_QUERY_KEYS = new Set([
  'ref',
  'wm_referral',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
]);

/**
 * The one URL a crawler should be spending its budget on for this request, or
 * null when it already asked for it.
 *
 * Two collapses, applied together so a URL carrying both costs one hop:
 *
 *  - Index-noise query keys (`ref`, `wm_referral`, `utm_*`) are dropped. They
 *    change nothing about document identity (#7380).
 *  - A legacy root deep link (`/?lat=…&zoom=…&layers=…`) becomes the
 *    param-free `/dashboard`. That query is map state, and any lat/lon/zoom/
 *    layer combination is a distinct URL, so forwarding it into the redirect
 *    published an unbounded redirect space: Search Console's "Page with
 *    redirect" bucket grew 199 -> 1,271 in three months, 301 of the exported
 *    URLs being map states (#7660). `/dashboard` is already the rel=canonical
 *    for every one of them, so a crawler loses nothing by going straight there.
 *    Note this collapse reaches www only: Vercel applies vercel.json
 *    `redirects` before middleware, and the variant hosts have their own
 *    `/` -> `/dashboard` host redirect; robots.txt now disallows every
 *    path on every host.
 * Bounded root entity links also move to `/dashboard`, retaining their state
 * in the same hop as attribution cleanup.
 *
 * Humans are deliberately excluded from the second collapse — the params are
 * what makes a shared or bookmarked legacy link open the view it encodes, and
 * they still reach `/dashboard` with the state intact below. That split is why
 * the redirect built from this must carry `Vary: User-Agent` and no-store.
 *
 * The caller gates this on BOT_UA, which is broader than "search crawler" — it
 * also matches generic HTTP clients (curl, python-requests, wget). Accepted:
 * map state only renders in a JS-executing browser, so a script fetching
 * `/?lat=…` receives the same SPA shell either way, and the user-triggered
 * assistant agents (ChatGPT-User, Claude-User, Perplexity-User) do not match
 * BOT_UA at all — they take the human branch and keep the state.
 */
function crawlerCanonicalUrl(url: URL): URL | null {
  let changed = false;
  const next = new URL(url);
  for (const key of [...next.searchParams.keys()]) {
    if (INDEX_NOISE_QUERY_KEYS.has(key) || key.toLowerCase().startsWith('utm_')) {
      next.searchParams.delete(key);
      changed = true;
    }
  }
  if (next.pathname === '/' && hasUnboundedDashboardRootState(next.searchParams)) {
    next.pathname = '/dashboard';
    for (const key of [...LEGACY_DASHBOARD_ROOT_QUERY_KEYS, 'expanded', 't', 'ts']) {
      next.searchParams.delete(key);
    }
    changed = true;
  } else if (next.pathname === '/' && hasLegacyDashboardRootState(next.searchParams)) {
    next.pathname = '/dashboard';
    changed = true;
  }
  return changed ? next : null;
}
/**
 * Headers for a 308 whose Location was chosen by User-Agent.
 *
 * `Cache-Control` alone is not enough at this edge: vercel.json gives `/` a
 * `CDN-Cache-Control` / `Vercel-CDN-Cache-Control` of `public, s-maxage=600`,
 * and those take priority over `Cache-Control` for the shared cache — so the
 * CDN could store one User-Agent's Location and replay it to the other for ten
 * minutes, silently undoing the split. Every layer that could store this
 * response has to be told not to, and `Vary` alone cannot protect a sibling
 * response that omitted it (RFC 9111).
 */
function uaConditionedRedirectHeaders(location: URL): Record<string, string> {
  return {
    Location: location.toString(),
    Vary: 'User-Agent',
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
  };
}

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const ua = request.headers.get('user-agent') ?? '';
  const path = url.pathname;

  // Bots indexing ?ref= / utm_* dashboard URLs as distinct pages (#7380), and
  // map-state deep links as an unbounded redirect space (#7660). Humans still
  // receive both so referral-capture, analytics, and shared map views keep
  // working; crawlers are 308'd to the clean canonical document URL.
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    !path.startsWith('/api/') &&
    BOT_UA.test(ua)
  ) {
    const cleaned = crawlerCanonicalUrl(url);
    if (cleaned) {
      // Built by hand rather than via Response.redirect() so the response can
      // carry Vary + no-store. This redirect is decided by User-Agent; a 308
      // is cacheable by default (RFC 9110 §15.4.9). Without those headers a
      // crawler can warm the tagged URL and a shared edge cache can replay
      // the clean Location to a human, stripping `ref` before referral capture
      // or dropping the map state out of a shared link (#7660).
      return new Response(null, { status: 308, headers: uaConditionedRedirectHeaders(cleaned) });
    }
  }

  // Preserve the complete state and attribution in a person's legacy link.
  // Crawlers have already reached /dashboard through crawlerCanonicalUrl(),
  // retaining bounded entity state but collapsing coordinate combinations.
  //
  // Built by hand rather than via Response.redirect() so it can carry Vary. The
  // same request URL now yields two different Locations depending on the
  // User-Agent, and a 308 is cacheable by default (RFC 9110 §15.4.9): a shared
  // cache that stored this one without Vary would replay `/dashboard?<map
  // state>` to the crawler the branch above exists to keep off that URL. This
  // is the rule docs/engineering/solutions/integration-issues/mcp-crawler-get-and-method-
  // aware-canonical-redirects.md states: cacheable(response) implies Vary
  // covers every header the branch read.
  if (path === '/' && hasLegacyDashboardRootState(url.searchParams)) {
    const dashboardUrl = url;
    dashboardUrl.pathname = '/dashboard';
    return new Response(null, { status: 308, headers: uaConditionedRedirectHeaders(dashboardUrl) });
  }

  // World Monitor Lite deployment profile (docs/engineering/architecture/lite.md): the
  // owner's deployment opens on /lite. src/config/lite-route.ts decides, the
  // same rule the src/main.ts guard applies, so ?full=1 and dashboard-state
  // links keep the dashboard. /dashboard stays a client decision: only the
  // browser knows the tab's ?full=1 memory. A 307, not a 308: switching the
  // profile off must not leave browsers holding a permanent redirect.
  // Unset upstream.
  if (
    path === '/' &&
    (request.method === 'GET' || request.method === 'HEAD') &&
    typeof process !== 'undefined' &&
    process.env.VITE_LITE_PROFILE === 'true' &&
    shouldRedirectToLite(path, url.search, { enabled: true, fullDashboardInSession: false })
  ) {
    const liteUrl = new URL(url);
    liteUrl.pathname = '/lite';
    return new Response(null, {
      status: 307,
      headers: { Location: liteUrl.toString(), 'Cache-Control': 'private, no-store' },
    });
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    // Real HTTP 404 for unknown pages. Agents get markdown (orank
    // `agent-friendly-404`); browsers that send Accept: text/html get HTML.
    // A rewrite to a static file would 200. Files with extensions skip this
    // matcher and fall through to public/404.html.
    if (!isKnownPublicPagePath(path)) {
      return originNotFoundResponse(path, request);
    }

  }

  // Only apply bot filtering to /api/* paths.
  //
  // /favico/* is deliberately NOT gated: it serves public static brand
  // assets (favicons, app icons, the email logo) that must be retrievable
  // by ANY client — browsers, email clients and their image proxies, link
  // unfurlers, preview scrapers. Bot-gating it broke the logo in
  // transactional emails when a client/proxy fetched with a script-like UA
  // (the same reason Cloudflare's "Block API Bots" rule was narrowed to
  // /api/* only). /favico/* is also removed from the matcher below so the
  // middleware never runs on it.
  if (!path.startsWith('/api/')) {
    return;
  }

  // Allow social preview/image bots on OG image assets.
  if (path.endsWith('.png')) {
    if (SOCIAL_IMAGE_UA.test(ua)) {
      return;
    }
  }

  // Public endpoints bypass all bot filtering
  if (PUBLIC_API_PATHS.has(path)) {
    return;
  }

  // Keyed API clients bypass UA filtering. This is a cheap edge heuristic,
  // not auth — the real check (validateApiKey against the operator keys)
  // happens in server/gateway.ts. To keep the bot-UA shield meaningful,
  // require the `wm_` prefix plus 40–64 lowercase hex chars. A random scraper
  // would still have to guess this format, and spoofed-but-well-shaped keys
  // still 401 at the gateway.
  const WM_KEY_SHAPE = /^wm_[a-f0-9]{40,64}$/;
  const apiKey =
    request.headers.get('x-worldmonitor-key') ??
    request.headers.get('x-api-key') ??
    '';
  if (WM_KEY_SHAPE.test(apiKey)) {
    return;
  }

  if (BOT_UA.test(ua) || !ua || ua.length < 10) {
    return Response.json(agentRequestPolicy.blockedResponse, {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
        'CDN-Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!api(?:/|$)|.*\\.[^/]+$).*)',
  ],
};
