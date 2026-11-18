import { isKnownPublicPagePath, originNotFoundResponse } from './packages/server/_shared/agent-not-found';
import agentRequestPolicy from './packages/shared/agent-request-policy.json';

const BOT_UA =
  /bot|crawl|spider|slurp|archiver|wget|curl\/|python-requests|scrapy|httpclient|go-http|java\/|libwww|perl|ruby|php\/|ahrefsbot|semrushbot|mj12bot|dotbot|baiduspider|yandexbot|sogou|bytespider|petalbot|gptbot|claudebot|ccbot/i;

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
 * null when it already asked for it: the same URL without the index-noise
 * query keys (`ref`, `wm_referral`, `utm_*`), which change nothing about
 * document identity (#7380).
 *
 * Humans are deliberately excluded: the keys feed referral capture and
 * analytics. That split is why the redirect built from this must carry
 * `Vary: User-Agent` and no-store.
 *
 * `/` and `/dashboard` never reach this: vercel.json redirects them to `/lite`
 * before middleware runs (docs/engineering/architecture/lite.md "Default
 * route").
 *
 * The caller gates this on BOT_UA, which is broader than "search crawler" — it
 * also matches generic HTTP clients (curl, python-requests, wget). Accepted:
 * the keys only matter in a JS-executing browser, and the user-triggered
 * assistant agents (ChatGPT-User, Claude-User, Perplexity-User) do not match
 * BOT_UA at all — they take the human branch and keep the keys.
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
  return changed ? next : null;
}
/**
 * Headers for a 308 whose Location was chosen by User-Agent.
 *
 * `Cache-Control` alone is not enough at this edge: `CDN-Cache-Control` /
 * `Vercel-CDN-Cache-Control` take priority over `Cache-Control` for the shared
 * cache, so a vercel.json header rule that sets them could let the CDN store
 * one User-Agent's Location and replay it to the other, silently undoing the
 * split. Every layer that could store this response has to be told not to,
 * and `Vary` alone cannot protect a sibling response that omitted it
 * (RFC 9111).
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

  // Bots indexing ?ref= / utm_* URLs as distinct pages (#7380). Humans still
  // receive the keys so referral capture and analytics keep working; crawlers
  // are 308'd to the clean canonical document URL.
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
      // the clean Location to a human, stripping `ref` before referral capture.
      return new Response(null, { status: 308, headers: uaConditionedRedirectHeaders(cleaned) });
    }
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
  // happens in packages/server/gateway.ts. To keep the bot-UA shield meaningful,
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
