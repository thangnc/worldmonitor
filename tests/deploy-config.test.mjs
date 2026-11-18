import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync as originalReadFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { nonDefaultLandingLocales } from '../shared/indexable-landing-locales.ts';
import { dirname, join, relative, resolve } from 'node:path';
function readFileSync(path, options) {
  const content = originalReadFileSync(path, options);
  if (typeof content === 'string') {
    return content.replace(/\r\n/g, '\n');
  }
  return content;
}

// Consecutive User-agent lines share one robots.txt group. A blank line, or a
// User-agent line after rules, starts a new group; comments do not end a group.
function parseRobotsGroups(source) {
  const groups = [];
  let current = null;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      current = null;
      continue;
    }
    if (line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === 'allow' || key === 'disallow')) {
      current.rules.push(`${key}: ${value}`);
    }
  }
  return groups;
}
import { fileURLToPath } from 'node:url';
import { CACHE_POLICY_HEADER_NAME, isSharedCacheable } from './helpers/shared-cache-policy.mjs';
import { guardBuiltOutput, shouldSkipBuiltOutput } from './_lib/built-output-guard.mjs';
import { AGENT_TEXT_FILES } from '../scripts/cloudflare-cache-rule.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));
const vercelConfig = JSON.parse(readFileSync(resolve(__dirname, '../vercel.json'), 'utf-8'));
const viteConfigSource = readFileSync(resolve(__dirname, '../vite.config.ts'), 'utf-8');
const sitemapSource = readFileSync(resolve(__dirname, '../public/sitemap-main.xml'), 'utf-8');
const robotsSource = readFileSync(resolve(__dirname, '../public/robots.www.txt'), 'utf-8');
const middlewareSource = readFileSync(resolve(__dirname, '../middleware.ts'), 'utf-8');
const dockerfileSource = readFileSync(resolve(__dirname, '../Dockerfile'), 'utf-8');
const dockerNginxSource = readFileSync(resolve(__dirname, '../docker/nginx.conf'), 'utf-8');
const frontendDockerfileSource = readFileSync(resolve(__dirname, '../docker/Dockerfile'), 'utf-8');
const dockerignoreSource = readFileSync(resolve(__dirname, '../.dockerignore'), 'utf-8');
const vercelIgnoreSource = readFileSync(resolve(__dirname, '../scripts/vercel-ignore.sh'), 'utf-8');
const SPA_HTML_CACHE_SOURCE = '/((?!api|mcp|a2a|ask|oauth|assets|blog|docs|country-instability-index|countries|chokepoints|compare|crises|tools|research|reference|changelog|sources|use-cases|accuracy|monitor-the-situation|src|tmp|server|embed|embed\\.html|favico|map-styles|data|textures|pro|sw\\.js|workbox-[a-f0-9]+\\.js|manifest\\.webmanifest|offline\\.html|robots\\.txt|robots\\.www\\.txt|robots\\.variant\\.txt|robots\\.api\\.txt|sitemap\\.xml|sitemap-main\\.xml|schemamap\\.xml|sandbox|llms\\.txt|llms-full\\.txt|llms\\*\\.txt|openapi\\.yaml|openapi\\.json|plugin\\.json|auth\\.md|pricing\\.md|support\\.md|ai-search\\.md|agents\\.md|developers\\.md|developers/llms\\.txt|mcp-server\\.md|openapi\\.md|sdks\\.md|world-monitor\\.md|api-versioning\\.md|agent\\.txt|\\.well-known|wm-widget-sandbox\\.html|mcp-grant\\.html|mcp-grant|desktop-sign-in\\.html|desktop-sign-in|.*\\.md$).*)';
const GLOBAL_SECURITY_HEADER_SOURCE = '/((?!docs|embed|embed\\.html|wm-widget-sandbox\\.html).*)';
const APP_ROOT_HOST_PATTERN = '^(?:(?:www|tech|finance|commodity|happy|energy)\\.)?worldmonitor\\.app$';
const WEBMCP_PRODUCTION_HOST_PATTERN = '^(?:www|tech|finance|commodity|happy|energy)\\.worldmonitor\\.app$';
const WEBMCP_PRODUCTION_HOSTS = [
  'www.worldmonitor.app',
  'tech.worldmonitor.app',
  'finance.worldmonitor.app',
  'commodity.worldmonitor.app',
  'happy.worldmonitor.app',
  'energy.worldmonitor.app',
];
const WEBMCP_TRIAL_EXPIRY = 1_806_364_800;
const WEBMCP_TOKEN_RENEWAL_BUFFER_SECONDS = 14 * 24 * 60 * 60;
const WEBMCP_TOKEN_SHA256_BY_HOST = {
  'www.worldmonitor.app': '552d58ed3da1968f39f1576e7d94402079869f7f344d81b78c6bb883129acbc4',
  'tech.worldmonitor.app': '675f2fadcf1999b06566207fd29b71c40300dcb95de2393f369e9671592cda2a',
  'finance.worldmonitor.app': '0c87a1ec606efb59910f4744204c6ee8fff2eb42a418a68cc29f3c1ea801c449',
  'commodity.worldmonitor.app': 'c6ae7f7c91dc7cda5c7143e10ac1fe95ab61c528be8c73c389df0288feaad924',
  'happy.worldmonitor.app': '9c3337b1b80f2050f473ed64943f0d6d135d9c9ca0126b2631cef01fdf97b0da',
  'energy.worldmonitor.app': '49eb184a6eb92c01c868c97620168f8a2881b0106416955b4309512decd7b71f',
};
const GLOBAL_CSP_INLINE_SCRIPT_HTML_FILES = [
  'lite.html',
  'public/offline.html',
];
const GLOBAL_CSP_EXTERNAL_SCRIPT_HTML_FILES = [
  'lite.html',
];
const STATIC_SCRIPT_NONCE = 'wm-static-bootstrap';

const HTML_ENTRY_BROWSER_CACHE = 'public, max-age=0, must-revalidate';
const HTML_ENTRY_EDGE_CACHE = 'public, s-maxage=600, stale-while-revalidate=60';

const getCacheHeaderValue = (sourcePath) => {
  let value = null;
  for (const rule of vercelConfig.headers.filter((entry) => entry.source === sourcePath)) {
    const header = rule.headers?.find((item) => item.key.toLowerCase() === 'cache-control');
    if (header) value = header.value;
  }
  return value;
};

const getHeadersForSource = (sourcePath) => {
  return vercelConfig.headers
    .filter((entry) => entry.source === sourcePath)
    .flatMap((entry) => entry.headers ?? []);
};

// Convert a vercel.json `source` (the path-to-regexp subset used in this file)
// into a RegExp: literal segments, inline regex groups `(...)` kept raw,
// `:name(regex)` custom matchers, and `:name*` catch-all params. Lets tests
// evaluate which rules match a concrete URL instead of only asserting on a
// rule in isolation.
const sourceToRegExp = (source) => {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') {
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === '(') depth++;
        else if (source[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      out += source.slice(i, j + 1);
      i = j;
    } else if (ch === ':') {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      if (source[j] === '(') {
        // `:name(regex)` custom matcher — drop the name, keep the group.
        let depth = 0;
        let k = j;
        for (; k < source.length; k++) {
          if (source[k] === '(') depth++;
          else if (source[k] === ')') {
            depth--;
            if (depth === 0) break;
          }
        }
        out += source.slice(j, k + 1);
        i = k;
      } else if (source[j] === '*') {
        // Vercel compiles `source` with path-to-regexp in STRICT mode: a `*`
        // param is a run of NON-EMPTY segments and no optional trailing slash
        // is appended. So `/countries/:path*` matches `/countries` and
        // `/countries/japan`, but neither `/countries/` nor `/countries/japan/`
        // — and every crawlable-corpus URL canonicalises to the trailing-slash
        // form. This modelled `(?:/.*)?` until #7530, which matched both forms
        // and kept the corpus cache assertions green while production served
        // Vercel's static default on all 250 corpus routes (see the strict-mode
        // cases in 'vercel.json source matching'). Raw `(.*)` groups are
        // unaffected — they are copied through verbatim above.
        out = out.replace(/\/$/, '');
        out += '(?:/[^/]+)*';
        i = j;
      } else {
        out += '[^/]+';
        i = j - 1;
      }
    } else if (ch === '\\' && i + 1 < source.length) {
      // A backslash already in the source is the author escaping the NEXT
      // character (`(.*)\.json`). Copy both through verbatim. Without this the
      // helper escaped the backslash itself, producing `\\.` — a literal
      // backslash followed by any char — so such a source modelled as matching
      // nothing and every `assert.equal(effectiveHeader(p, k), null)` against it
      // passed vacuously. No source in vercel.json needs it today; the branch
      // exists so the first one that does is not silently green.
      out += source[i] + source[i + 1];
      i += 1;
    } else {
      out += /[.*+?^${}|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return new RegExp(`^${out}$`);
};

const conditionMatchesRequest = (condition, { host, query = {} }) => {
  if (condition.type === 'host') return new RegExp(condition.value).test(host);
  if (condition.type === 'query') {
    const actual = query[condition.key];
    if (actual === undefined) return false;
    return condition.value === undefined || new RegExp(`^(?:${condition.value})$`).test(actual);
  }
  return false;
};

const firstRedirectFor = ({ host, path, query = {} }) => {
  for (const rule of vercelConfig.redirects) {
    if (!sourceToRegExp(rule.source).test(path)) continue;
    if (!(rule.has ?? []).every((condition) => conditionMatchesRequest(condition, { host, query }))) continue;
    if ((rule.missing ?? []).some((condition) => conditionMatchesRequest(condition, { host, query }))) continue;
    return rule;
  }
  return null;
};

const firstRewriteFor = ({ host, path, query = {} }) => {
  for (const rule of vercelConfig.rewrites) {
    if (!sourceToRegExp(rule.source).test(path)) continue;
    if (!(rule.has ?? []).every((condition) => conditionMatchesRequest(condition, { host, query }))) continue;
    if ((rule.missing ?? []).some((condition) => conditionMatchesRequest(condition, { host, query }))) continue;
    return rule;
  }
  return null;
};

const headerRuleMatchesRequest = (rule, { path, host, query = {} }) => {
  if (!sourceToRegExp(rule.source).test(path)) return false;
  const conditionMatches = (condition) => {
    if (condition.type === 'host') return new RegExp(condition.value).test(host);
    if (condition.type === 'query') {
      const actual = query[condition.key];
      if (actual === undefined) return false;
      return condition.value === undefined || new RegExp(`^(?:${condition.value})$`).test(actual);
    }
    return false;
  };
  return (rule.has ?? []).every(conditionMatches) && !(rule.missing ?? []).some(conditionMatches);
};

// Vercel applies every matching `headers` entry in file order; when several
// set the same header key, the LAST matching rule wins.
const effectiveCacheControl = (path) => {
  let value = null;
  for (const entry of vercelConfig.headers) {
    if (!sourceToRegExp(entry.source).test(path)) continue;
    const header = entry.headers?.find((h) => h.key.toLowerCase() === 'cache-control');
    if (header) value = header.value;
  }
  return value;
};

const effectiveHeader = (path, key) => {
  let value = null;
  for (const entry of vercelConfig.headers) {
    if (!sourceToRegExp(entry.source).test(path)) continue;
    const header = entry.headers?.find((h) => h.key.toLowerCase() === key.toLowerCase());
    if (header) value = header.value;
  }
  return value;
};

const assertPublicHtmlEntryCache = (route) => {
  assert.equal(
    effectiveCacheControl(route),
    HTML_ENTRY_BROWSER_CACHE,
    `${route} must keep a browser-only revalidation policy after all matching rules apply`,
  );
  assert.ok(
    !effectiveCacheControl(route).includes('no-store'),
    'HTML must not set no-store — it disables bfcache',
  );
  assert.doesNotMatch(
    effectiveCacheControl(route),
    /\bs-maxage\b/,
    `${route} Cache-Control must not carry s-maxage; Vercel consumes it and forwards max-age=0 to Cloudflare`,
  );
  assert.equal(
    effectiveHeader(route, 'CDN-Cache-Control'),
    HTML_ENTRY_EDGE_CACHE,
    `${route} must advertise the 600s Cloudflare TTL on CDN-Cache-Control`,
  );
  assert.equal(
    effectiveHeader(route, 'Vercel-CDN-Cache-Control'),
    HTML_ENTRY_EDGE_CACHE,
    `${route} must advertise the 600s Vercel TTL on Vercel-CDN-Cache-Control`,
  );
};

const getHeaderValueForSource = (sourcePath, key) => {
  const headers = getHeadersForSource(sourcePath);
  const header = headers.find((h) => h.key.toLowerCase() === key.toLowerCase());
  return header?.value ?? null;
};

const decodeOriginTrialTokenPayload = (token) => {
  assert.match(token, /^[A-Za-z0-9+/]+={0,2}$/, 'Origin-trial token must be canonical base64');
  assert.equal(token.length % 4, 0, 'Origin-trial token base64 must have complete quanta');
  const bytes = Buffer.from(token, 'base64');
  assert.equal(bytes.toString('base64'), token, 'Origin-trial token must round-trip without ignored bytes');
  assert.equal(bytes[0], 2, 'WebMCP origin-trial tokens must use the expected token version');
  assert.ok(bytes.length >= 69, 'Origin-trial token must contain its signature and payload length');
  const payloadLength = bytes.readUInt32BE(65);
  assert.equal(
    bytes.length,
    69 + payloadLength,
    'Origin-trial token payload length must cover the complete token without trailing bytes',
  );
  return JSON.parse(bytes.subarray(69).toString('utf8'));
};

const getCspDirectiveTokens = (csp, directive) => {
  const directiveSource = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directive} `));
  const tokens = directiveSource?.slice(directive.length).trim().split(/\s+/).filter(Boolean) ?? [];
  return [...new Set(tokens)].sort();
};

// frame-src is a BOUNDED allowlist, not a closed host list: it legitimately
// carries vendor wildcard subdomains. Pin them, so a NEW wildcard or any
// scheme-wide source is flagged while the known ones stay quiet.
const KNOWN_FRAME_WILDCARDS = [
  'https://*.clerk.accounts.dev',
  'https://*.dodopayments.com',
  'https://*.hs.dodopayments.com',
  'https://*.custom.hs.dodopayments.com',
];
const OPEN_CSP_SOURCES = ['*', 'https:', 'http:', 'data:', 'blob:'];
// Exported-by-hoisting so the guard's own negative test can drive it directly
// rather than asserting through the real config, which cannot show a widening.
const findOpenFrameSources = (tokens) => tokens.filter((token) => {
  if (KNOWN_FRAME_WILDCARDS.includes(token)) return false;
  // Tokens keep their scheme (`https://*.vercel.app`), so the wildcard test has
  // to run on the host part or it matches nothing at all.
  const host = token.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return OPEN_CSP_SOURCES.includes(token) || host === '*' || host.startsWith('*.');
});

const hasTrustedStaticNonce = (attributes) => (
  new RegExp(`\\bnonce=["']${STATIC_SCRIPT_NONCE}["']`).test(attributes)
);

const getInlineScriptHashTokens = (htmlSource) => {
  return [...htmlSource.matchAll(/<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !hasTrustedStaticNonce(match[1]))
    .map((match) => match[2])
    .filter((body) => body.trim().length > 0)
    .map((body) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
};

const hasCspMeta = (htmlSource) => /<meta\b[^>]+http-equiv=["']Content-Security-Policy["']/i.test(htmlSource);

const getExternalScriptTags = (htmlSource) => {
  return [...htmlSource.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi)]
    .map((match) => match[0]);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every product web host. src/config/variant-meta.ts listed them until the
// legacy dashboard was deleted; the CSP framing allowlists still cover them all.
const VARIANT_HOSTS = [
  'commodity.worldmonitor.app',
  'energy.worldmonitor.app',
  'finance.worldmonitor.app',
  'happy.worldmonitor.app',
  'tech.worldmonitor.app',
  'www.worldmonitor.app',
];


// `sourceToRegExp` is this suite's model of how Vercel compiles a `source`.
// Pin its strict-mode semantics directly: while the model was more permissive
// than Vercel's compiler, every assertion built on it reported a match that
// production did not make, and ~22 dead corpus cache rules shipped unnoticed
// (#7530). Each case below was verified against production before being pinned.
describe('vercel.json source matching', () => {
  it('models a :param* catch-all as non-empty segments with no trailing slash', () => {
    const matches = (path) => sourceToRegExp('/countries/:path*').test(path);
    assert.equal(matches('/countries'), true);
    assert.equal(matches('/countries/japan'), true);
    assert.equal(matches('/countries/japan/kanto'), true);
    // The forms the corpus actually canonicalises to — Vercel does not match
    // these, which is the whole defect.
    assert.equal(matches('/countries/'), false);
    assert.equal(matches('/countries/japan/'), false);
  });

  it('models a raw regex group as matching the empty string and trailing slashes', () => {
    const matches = (path) => sourceToRegExp('/countries/(.*)').test(path);
    // Verified in production against the equivalently shaped `/assets/(.*)`
    // rule: `/assets/` returns the configured immutable cache header, so the
    // group does match empty.
    assert.equal(matches('/countries/'), true);
    assert.equal(matches('/countries/japan/'), true);
    assert.equal(matches('/countries/japan'), true);
    assert.equal(matches('/countries'), false, 'the literal /countries rule covers the bare form');
  });

  // The load-bearing form for the shared-content 308s: a named param with an
  // explicit `.*` pattern behaves like the raw group but keeps the `:match`
  // destination interpolation every other redirect in this file already uses,
  // so no rule depends on `$1` support we have no in-repo evidence for.
  it('models a :name(regex) custom matcher like the equivalent raw group', () => {
    const named = (path) => sourceToRegExp('/countries/:match(.*)').test(path);
    const raw = (path) => sourceToRegExp('/countries/(.*)').test(path);
    for (const path of ['/countries/', '/countries/japan', '/countries/japan/', '/countries']) {
      assert.equal(named(path), raw(path), `${path} must match both forms identically`);
    }
    assert.equal(named('/countries/'), true);
    assert.equal(named('/countries/japan/'), true);
    assert.equal(named('/countries'), false);
  });

  it('models a literal source as exact, with no optional trailing slash', () => {
    assert.equal(sourceToRegExp('/countries').test('/countries'), true);
    assert.equal(sourceToRegExp('/countries').test('/countries/'), false);
    assert.equal(sourceToRegExp('/offline.html').test('/offline.html'), true);
  });
});

describe('open data under /data/v1', () => {
  it('revalidates versioned open data hourly instead of caching it as immutable', () => {
    assert.equal(effectiveCacheControl('/data/v1/chokepoints/latest.json'), 'public, max-age=3600');
  });

  it('keeps open data readable cross-origin', () => {
    assert.equal(effectiveHeader('/data/v1/chokepoints/latest.csv', 'Access-Control-Allow-Origin'), '*');
  });

  it('lets the CDN serve stale open data briefly while it revalidates', () => {
    assert.equal(
      effectiveHeader('/data/v1/chokepoints/latest.json', 'CDN-Cache-Control'),
      'public, s-maxage=3600, stale-while-revalidate=600',
    );
  });

  it('leaves unversioned /data assets immutable', () => {
    assert.equal(effectiveCacheControl('/data/countries-50m.json'), 'public, max-age=31536000, immutable');
  });

  const nginxLocation = (prefix) => {
    const match = dockerNginxSource.match(new RegExp(`^ {4}location ${prefix.replace(/\//g, '\\/')} \\{\\n([\\s\\S]*?)^ {4}\\}`, 'm'));
    assert.ok(match, `docker/nginx.conf must declare location ${prefix}`);
    return match[1];
  };

  it('gives the self-hosted image the same hourly, cross-origin rule for /data/v1/', () => {
    const block = nginxLocation('/data/v1/');
    assert.match(block, /add_header Cache-Control "public, max-age=3600";/);
    assert.match(block, /add_header Access-Control-Allow-Origin "\*" always;/);
    assert.match(nginxLocation('/data/'), /add_header Cache-Control "public, max-age=31536000, immutable";/);
  });
});

describe('crawlable content corpus deployment contracts', () => {
  const staticCorpusPaths = [
    '/countries/ukraine/',
    '/chokepoints/suez-canal/',
    '/research/strait-of-hormuz-transit-report-2026-07/',
    '/crises/ukraine-war/',
    '/tools/natural-hazard-pulse/',
    '/reference/changelog/page/2/',
  ];

  // #6575: the negative-lookahead SPA catch-all is gone. The only app shell
  // left is lite.html, served by its five enumerated /lite rewrites.
  const getSpaFallbackRewrites = () => vercelConfig.rewrites.filter((r) => r.destination === '/lite.html');

  it('pins the deploy build command in vercel.json to the Lite build', () => {
    // vercel.json overrides the dashboard's Build Command, which is where this
    // used to live -- invisible to the repo and changeable without a diff.
    // The Lite UI is the only web app: the deploy build is the secrets check,
    // the OpenAPI copy, the browser typecheck, the Lite Vite build and the
    // source-map gate.
    // build:full stays as an alias so older callers build the same thing.
    assert.equal(
      vercelConfig.buildCommand,
      'npm run build',
      'vercel.json must pin buildCommand so the deploy contract lives in the repo, not the dashboard',
    );
    assert.equal(
      packageJson.scripts.build,
      'npm run security:vite-env-secrets -- --strict-local && npm run build:openapi && tsc && vite build && npm run check:source-maps',
    );
    assert.equal(packageJson.scripts['build:full'], 'npm run build');
    assert.equal(packageJson.scripts.prebuild, undefined, 'the deploy build must not run hidden prebuild generators');
  });

  it('builds only the Lite entry in the Docker images', () => {
    // The /pro marketing site, the blog and the static corpus were deleted in
    // refactor Phase 1b: no build script for them remains to call.
    for (const script of ['build:pro', 'build:blog', 'build:crawlable-corpus', 'build:sitemap']) {
      assert.equal(packageJson.scripts[script], undefined, script + ' was deleted with its surface');
    }
    for (const [name, source] of [
      ['Dockerfile', dockerfileSource],
      ['docker/Dockerfile', frontendDockerfileSource],
    ]) {
      // The images build only the Lite entry: no second Vite config, and no
      // corpus or sitemap generation inside the image.
      assert.match(source, /^RUN npx tsc && npx vite build$/m, name + ' must run the Lite Vite build');
      assert.deepEqual(source.match(/^RUN .*vite build.*$/gm), ['RUN npx tsc && npx vite build'], name + ' must run exactly one Vite build');
      assert.doesNotMatch(source, /--config vite\.lite\.config\.ts/, name + ' must not build a second Vite config');
      assert.doesNotMatch(source, /npm run build:crawlable-corpus/, name + ' must not build the static corpus');
      assert.doesNotMatch(source, /npm run build:sitemap/, name + ' must not generate the root sitemap');
      assert.doesNotMatch(source, /npm run build:pro/, name + ' must not call the deleted /pro build');
      assert.doesNotMatch(source, /dist\/pro\//, name + ' must not expect /pro pages in dist/');
      assert.ok(
        source.indexOf('node scripts/generate-inventory-facts.mjs') < source.indexOf('npx vite build'),
        name + ' must generate ignored inventory assets in a clean build context before Vite runs',
      );
    }
    assert.ok(
      dockerfileSource.indexOf('node scripts/generate-inventory-facts.mjs') < dockerfileSource.indexOf('node docker/build-handlers.mjs'),
      'the self-host image must generate the Edge inventory module before handler bundling',
    );
    assert.match(frontendDockerfileSource, /RUN test -s dist\/product-facts\.json/);
    // nginx serves the Lite routes from lite.html, so the image must ship it.
    assert.match(frontendDockerfileSource, /^RUN test -s dist\/lite\.html$/m);
    assert.doesNotMatch(frontendDockerfileSource, /dist\/dashboard\.html/);
    assert.ok(!packageJson.scripts['build:full'].includes('npm run build:blog &&'), 'build:full must not regenerate inventory facts inside build:blog');
  });

  it('builds frontend assets on the host platform and keeps nginx on the target platform', () => {
    const stages = frontendDockerfileSource.match(/^FROM .+$/gm);
    assert.equal(stages.length, 2);
    assert.match(stages[0], /^FROM --platform=\$BUILDPLATFORM node:.+ AS builder$/);
    assert.match(stages[1], /^FROM nginx:.+ AS runtime$/);
    assert.match(frontendDockerfileSource, /^COPY --from=builder \/app\/dist\/ \.\/$/m);
    assert.doesNotMatch(frontendDockerfileSource, /^COPY --from=builder .*node_modules/m);
  });

  it('builds Vercel when corpus source files change', () => {
    assert.ok(vercelIgnoreSource.includes("'CHANGELOG.md'"));
    assert.ok(vercelIgnoreSource.includes("'docs/snapshots/'"));
    for (const path of [
      'docs/docs.json',
      'scripts/unranked-country-inventory.mjs',
      'scripts/data/use-case-workflows.mjs',
      'scripts/slugify.mjs',
      'scripts/source-origin.mjs',
      'scripts/source-origin.d.mts',
      'scripts/generate-inventory-facts.mjs',
      'scripts/docs-stats.mjs',
      'scripts/source-attribution.mjs',
      'scripts/data/country-centroids.json',
    ]) {
      assert.equal(vercelIgnoreSource.split(`'${path}'`).length - 1, 2, `${path} must trigger main and preview builds`);
    }
  });

  it('builds Vercel when the Lite entry or its Vite config changes, and watches no deleted entry', () => {
    for (const path of ['lite.html', 'vite.config.ts', 'vite.dev-api.ts']) {
      assert.equal(vercelIgnoreSource.split(`'${path}'`).length - 1, 2, `${path} must trigger main and preview builds`);
    }
    for (const path of ['index.html', 'vite.lite.config.ts']) {
      assert.equal(vercelIgnoreSource.includes(`'${path}'`), false, `${path} was deleted and must not be watched`);
    }
  });

  it('builds Vercel on main and preview for generated web-input changes', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wm-vercel-ignore-'));
    try {
      const fixtureEnv = { ...process.env };
      for (const key of ['GIT_COMMON_DIR', 'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_WORK_TREE']) {
        delete fixtureEnv[key];
      }
      const git = (...args) => execFileSync('git', args, { cwd: fixture, env: fixtureEnv, encoding: 'utf8' });

      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      writeFileSync(join(fixture, 'README.md'), 'base\n');
      git('add', 'README.md');
      git('commit', '-qm', 'base');

      for (const path of [
        'docs/docs.json',
        'scripts/unranked-country-inventory.mjs',
        'scripts/data/use-case-workflows.mjs',
        'scripts/slugify.mjs',
        'scripts/source-origin.mjs',
        'scripts/source-origin.d.mts',
        'scripts/generate-inventory-facts.mjs',
        'scripts/docs-stats.mjs',
        'scripts/source-attribution.mjs',
        'scripts/data/country-centroids.json',
      ]) {
        const previous = git('rev-parse', 'HEAD').trim();
        mkdirSync(dirname(join(fixture, path)), { recursive: true });
        writeFileSync(join(fixture, path), `${path}\n`);
        git('add', path);
        git('commit', '-qm', path);
        assert.throws(
          () => execFileSync('/bin/bash', [resolve(__dirname, '../scripts/vercel-ignore.sh')], {
            cwd: fixture,
            env: { ...fixtureEnv, VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: previous },
          }),
          (error) => error?.status === 1,
          `${path} must request a Vercel build`,
        );
        git('update-ref', 'refs/remotes/origin/main', previous);
        assert.throws(
          () => execFileSync('/bin/bash', [resolve(__dirname, '../scripts/vercel-ignore.sh')], {
            cwd: fixture,
            env: { ...fixtureEnv, VERCEL_GIT_COMMIT_REF: 'feature/source-catalog' },
          }),
          (error) => error?.status === 1,
          `${path} must request a Vercel preview build`,
        );
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('builds the prediction policy merge on main and preview while skipping unrelated scripts and tests', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wm-vercel-policy-'));
    try {
      const fixtureEnv = { ...process.env };
      for (const key of ['GIT_COMMON_DIR', 'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_WORK_TREE']) {
        delete fixtureEnv[key];
      }
      const git = (...args) => execFileSync('git', args, { cwd: fixture, env: fixtureEnv, encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      writeFileSync(join(fixture, 'README.md'), 'base\n');
      git('add', 'README.md');
      git('commit', '-qm', 'base');
      const actual = [];
      const expected = [];
      for (const { paths, status } of [
        { paths: ['scripts/shared/prediction-country-language.json', 'tests/prediction-country-index.test.mjs', 'tests/prediction-country-markets-pools.test.mts'], status: 1 },
        { paths: ['scripts/seed-unrelated.mjs'], status: 0 },
        { paths: ['tests/unrelated.test.mjs'], status: 0 },
      ]) {
        const previous = git('rev-parse', 'HEAD').trim();
        for (const path of paths) {
          mkdirSync(dirname(join(fixture, path)), { recursive: true });
          writeFileSync(join(fixture, path), `${path}\n`);
        }
        git('add', '.');
        git('commit', '-qm', paths.join(', '));
        git('update-ref', 'refs/remotes/origin/main', previous);
        for (const ref of ['main', 'feature/prediction-policy']) {
          const result = spawnSync('/bin/bash', [resolve(__dirname, '../scripts/vercel-ignore.sh')], {
            cwd: fixture,
            env: { ...fixtureEnv, VERCEL_GIT_COMMIT_REF: ref, VERCEL_GIT_PREVIOUS_SHA: previous },
            encoding: 'utf8',
          });
          assert.ifError(result.error);
          actual.push({ paths, ref, status: result.status });
          expected.push({ paths, ref, status });
        }
      }
      assert.deepEqual(actual, expected);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('builds a deliberate same-commit redeploy on main so rotated env vars reach production (#8216)', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wm-vercel-redeploy-'));
    try {
      const fixtureEnv = { ...process.env };
      for (const key of ['GIT_COMMON_DIR', 'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_WORK_TREE']) {
        delete fixtureEnv[key];
      }
      const git = (...args) => execFileSync('git', args, { cwd: fixture, env: fixtureEnv, encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      writeFileSync(join(fixture, 'README.md'), 'base\n');
      git('add', 'README.md');
      git('commit', '-qm', 'base');
      const deployed = git('rev-parse', 'HEAD').trim();
      const run = (previous) => spawnSync('/bin/bash', [resolve(__dirname, '../scripts/vercel-ignore.sh')], {
        cwd: fixture,
        env: { ...fixtureEnv, VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: previous },
        encoding: 'utf8',
      });

      // Vercel sets VERCEL_GIT_PREVIOUS_SHA to the last successful deployment, so it
      // equals HEAD only when that same commit is redeployed after an env change.
      const redeploy = run(deployed);
      assert.ifError(redeploy.error);
      assert.equal(redeploy.status, 1, 'a same-commit redeploy must build');

      mkdirSync(join(fixture, 'scripts'), { recursive: true });
      writeFileSync(join(fixture, 'scripts/seed-unrelated.mjs'), 'seed\n');
      git('add', '.');
      git('commit', '-qm', 'seed only');
      const push = run(deployed);
      assert.ifError(push.error);
      assert.equal(push.status, 0, 'a new commit with no web changes must still skip');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('builds a same-commit preview redeploy when the shallow clone has no origin/main', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wm-vercel-preview-redeploy-'));
    try {
      const fixtureEnv = { ...process.env };
      for (const key of ['GIT_COMMON_DIR', 'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_WORK_TREE']) {
        delete fixtureEnv[key];
      }
      const git = (...args) => execFileSync('git', args, { cwd: fixture, env: fixtureEnv, encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      writeFileSync(join(fixture, 'README.md'), 'base\n');
      git('add', 'README.md');
      git('commit', '-qm', 'base');
      const deployed = git('rev-parse', 'HEAD').trim();
      const run = (previous) => spawnSync('/bin/bash', [resolve(__dirname, '../scripts/vercel-ignore.sh')], {
        cwd: fixture,
        env: { ...fixtureEnv, VERCEL_GIT_COMMIT_REF: 'feat/env-flag', VERCEL_GIT_PREVIOUS_SHA: previous },
        encoding: 'utf8',
      });

      // Vercel's preview clone has no origin/main, so the script falls back to
      // PREVIOUS_SHA. A redeploy to pick up a preview env var sets it to HEAD.
      const redeploy = run(deployed);
      assert.ifError(redeploy.error);
      assert.equal(redeploy.status, 1, 'a same-commit preview redeploy must build');

      mkdirSync(join(fixture, 'scripts'), { recursive: true });
      writeFileSync(join(fixture, 'scripts/seed-unrelated.mjs'), 'seed\n');
      git('add', '.');
      git('commit', '-qm', 'seed only');
      const push = run(deployed);
      assert.ifError(push.error);
      assert.equal(push.status, 0, 'a new preview commit with no web changes must still skip');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('keeps corpus inputs available in Docker build contexts', () => {
    const markdownIgnore = dockerignoreSource.indexOf('*.md');
    const changelogInclude = dockerignoreSource.indexOf('!CHANGELOG.md');
    assert.ok(markdownIgnore >= 0, 'expected the broad markdown ignore rule to be present');
    assert.ok(changelogInclude > markdownIgnore, 'CHANGELOG.md must be re-included after *.md for Docker corpus builds');
  });

  it('keeps local self-hosting credentials out of Docker build contexts', () => {
    const ignoreRules = new Set(
      dockerignoreSource
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
    );

    for (const path of ['docker-compose.override.yml', 'secrets/']) {
      assert.ok(ignoreRules.has(path), `${path} must never enter Docker build contexts or caches`);
    }
  });

  it('marks stock workspaces and their markdown twins noindex, and sends stock deep links to /lite (#7905)', () => {
    for (const path of ['/stocks', '/stocks/', '/stocks.md', '/stocks/AAPL', '/stocks/ZZZZFAKE',
      '/stocks/aapl/', '/stocks/BRK.B', '/stocks/7203.T', '/stocks/AAPL.md', '/stocks/ZZZZFAKE.md']) {
      assert.equal(effectiveHeader(path, 'X-Robots-Tag'), 'noindex, follow', path);
    }
    for (const path of ['/dashboard', '/stocksmith', '/countries/united-states']) {
      assert.equal(effectiveHeader(path, 'X-Robots-Tag'), null, path);
    }
    for (const symbol of ['AAPL', 'ZZZZFAKE', 'BRK.B', '7203.T']) {
      assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path: `/stocks/${symbol}` })?.destination, '/lite');
      assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: `/stocks/${symbol}` }), null);
    }
  });

  // #8608: the corpus dataset downloads, the OpenAPI/plugin descriptors and the
  // .well-known JSON descriptors are machine-readable files, not pages. They
  // answered 200 with no robots directive, which made them the largest
  // actionable slice of the 2026-09-24 "Crawled - currently not indexed" export
  // (178 of 1,000 sampled rows, 103 of them /countries/<slug>/resilience.json).
  // `noindex, follow` keeps them fetchable, which a robots.txt Disallow would
  // not: every corpus page carries a schema.org DataDownload `contentUrl`
  // pointing at these files, and a disallowed URL is a claim Google is
  // forbidden to verify (#7660).
  it('marks the machine-readable data surface noindex without touching corpus HTML or the AI-citation surface (#8608)', () => {
    const dataHeaderRules = vercelConfig.headers
      .filter(({ source }) => /\.(?:json|ya?ml)$/i.test(source))
      .filter(({ source }) => !source.replaceAll('\\', '').startsWith('/.well-known/'));
    for (const { source, headers } of dataHeaderRules) {
      const robotsTag = headers.find(({ key }) => key.toLowerCase() === 'x-robots-tag');
      assert.equal(robotsTag?.value ?? null, 'noindex, follow', source);
    }

    const dataFiles = [
      // Corpus dataset downloads - scripts/build-crawlable-corpus.mjs.
      '/country-instability-index/cii-ranking.json',
      '/countries/resilience-ranking.json',
      '/countries/iran/resilience.json',
      '/countries/iran/cii.json',
      '/chokepoints/status.json',
      '/chokepoints/strait-of-hormuz/reference.json',
      '/crises/sudan/tracker.json',
      '/accuracy/scorecard.json',
      '/sources/search-index.json',
      '/research/grain-corridor/grain-corridor.json',
      // Service descriptions.
      '/openapi.json',
      '/openapi.yaml',
      '/plugin.json',
      '/docs/api/ForecastService.openapi.yaml',
      '/docs/snapshots/github-stars-2026-09-03.json',
      // Standalone machine JSON outside the corpus families.
      '/product-facts.json',
      '/agent-view.json',
      '/sandbox/index.json',
    ];
    for (const path of dataFiles) {
      assert.equal(effectiveHeader(path, 'X-Robots-Tag'), 'noindex, follow', path);
    }

    assert.equal(effectiveHeader('/countries/united-states', 'X-Robots-Tag'), null);
    assert.equal(effectiveHeader('/countries/united-states/', 'X-Robots-Tag'), null);

    // Scope item 2 of #8608 deliberately leaves the AI-citation surface alone:
    // it is not established that OAI-SearchBot, PerplexityBot or
    // Claude-SearchBot read `X-Robots-Tag: noindex` as "do not index" rather
    // than "do not cite", so noindex here would risk trading a Search Console
    // count for citability. That stays an owner decision, not a drive-by.
    // `.well-known` is entirely agent-discovery surface, including the JSON.
    // agent-skills/index.json is 17 kB whose `instructions` field is prose
    // written to persuade an agent to call us -- the same citation risk as the
    // SKILL.md files it lists, not inert data. Sorting this surface by file
    // extension would have noindexed the pitch and spared the chapters.
    for (const path of ['/llms.txt', '/llms-full.txt', '/api/llms.txt', '/agents.md', '/developers.md',
      '/pricing.md', '/openapi.md', '/world-monitor.md', '/.well-known/security.txt',
      '/.well-known/agent-skills/check-country-risk/SKILL.md',
      '/.well-known/agent-skills/index.json', '/.well-known/agent-card.json',
      '/.well-known/ai-catalog.json', '/.well-known/mcp/server-card.json']) {
      assert.equal(effectiveHeader(path, 'X-Robots-Tag'), null, path);
    }

    // The matcher must model a pre-escaped dot the way Vercel does. Before
    // #8608 the helper escaped the backslash itself, so `(.*)\\.json` compiled
    // to "backslash then any char" and matched nothing at all - which would
    // have made every null assertion above pass without proving anything.
    assert.ok(sourceToRegExp('/countries/(.*)\\.json').test('/countries/iran/resilience.json'));
    assert.ok(!sourceToRegExp('/countries/(.*)\\.json').test('/countries/iran/resilienceXjson'));
    assert.ok(sourceToRegExp('/countries/(.*).json').test('/countries/iran/resilience.json'));
    assert.ok(!sourceToRegExp('/countries/(.*).json').test('/countries/united-states'));

    // Sitemaps and robots.txt stay plain - a noindex sitemap is simply dropped,
    // and #8608 does not touch them.
    for (const path of ['/robots.txt', '/robots.www.txt', '/sitemap.xml', '/sitemap-main.xml', '/schemamap.xml']) {
      assert.equal(effectiveHeader(path, 'X-Robots-Tag'), null, path);
    }
  });

  it('serves no SPA fallback for generated corpus paths, and redirects the old client deep links to /lite', () => {
    // #6575: unknown paths must fall through to the filesystem (404), so the
    // only app-shell rewrites left are the Lite routes. Corpus HTML keeps
    // resolving as raw static files.
    const fallbacks = getSpaFallbackRewrites();
    assert.deepEqual(
      fallbacks.map((r) => r.source),
      ['/lite', '/lite/geopolitics', '/lite/finance', '/lite/tech', '/lite/sources'],
      'the app-shell rewrite inventory must stay enumerable'
    );

    for (const path of staticCorpusPaths) {
      const matched = fallbacks.find((r) => sourceToRegExp(r.source).test(path));
      assert.equal(
        matched,
        undefined,
        path + ' must resolve as raw static HTML, not /lite.html'
      );
      assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path }), null, path + ' must not redirect');
    }

    for (const path of ['/stocks', '/stocks/AAPL', '/story']) {
      assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path })?.destination, '/lite', path);
      assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path }), null, path);
    }
    assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path: '/stocks/foo/bar' }), null);
    assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: '/stocks/foo/bar' }), null);
    assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path: '/story/' })?.destination, '/story');
    assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path: '/dashboard/' })?.destination, '/dashboard');
    // Unknown garbage used to soft-404 the dashboard through the catch-all.
    assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: '/this-is-not-a-page' }), null);
    assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: '/security' }), null);
  });

  // A `:path*` source cannot match a trailing-slash URL under Vercel's strict
  // path-to-regexp compilation, so no corpus source may use one: that is the
  // exact shape that left every corpus cache rule inert in production while
  // this suite stayed green (#7530). Production evidence at the time:
  // `/countries/japan/` and `/chokepoints/` both served Vercel's static default
  // `public, max-age=0, must-revalidate`, never the configured max-age=3600,
  // while `/assets/(.*)` — a raw regex group — applied correctly.
  // Scoped to CONTENT_CORPUS_PREFIXES on its first pass, this could not see the
  // same shape surviving on /pro and /docs — `/pro/` was measured in production
  // serving 200 with `public, max-age=0, must-revalidate` where the rule intends
  // `private, no-cache` on an authenticated surface. Sweep EVERY header rule
  // instead, with an explicit allowlist for the sources where the shape is
  // correct because those URLs never carry a trailing slash.
  it('never guards a route with a trailing-slash-blind :param* header source', () => {
    // Mintlify serves /docs/<page> with no trailing slash, so its proxy rewrite
    // is the one place the shape is right. It is a rewrite, not a header rule,
    // and is asserted separately — nothing here should need an exemption.
    const EXEMPT = new Set();
    const blind = vercelConfig.headers
      .map((entry) => entry.source)
      .filter((source) => /:[A-Za-z0-9_]+\*/.test(source) && !EXEMPT.has(source));
    assert.deepEqual(
      blind,
      [],
      'these header sources use a :param* catch-all, which Vercel compiles in strict mode'
        + ' and which therefore never matches the trailing-slash form of the URL',
    );

    // Positive control: the sweep must actually be looking at rules.
    assert.ok(vercelConfig.headers.length > 50, 'expected the header rule set to be non-trivial');
  });

  it('applies the /docs header rules to their trailing-slash forms', () => {
    assert.equal(effectiveHeader('/docs/', 'X-Content-Type-Options'), 'nosniff');
    assert.equal(effectiveHeader('/docs/zh/about/', 'X-Content-Type-Options'), 'nosniff');
  });

  it('advertises the edge cache on the proxied docs and the root agent text files (#7747)', () => {
    // The vercel.json half of the pair. The Cloudflare half is
    // scripts/cloudflare-cache-rule.mjs, and tests/cloudflare-cache-rule.test.mjs
    // fails when the two halves cover different surfaces.

    // /docs is a proxy to Mintlify, which negotiates markdown on Accept without
    // a matching Vary and serves RSC flights at the document URL. Cloudflare gets
    // the TTL and keys the negotiating requests out in the zone rule; Vercel's
    // own cache must not store these at all, because it would key HTML and
    // markdown under one URL. Vercel strips Vercel-CDN-Cache-Control before the
    // response leaves, so the browser never sees the no-store.
    for (const route of ['/docs/documentation', '/docs/mcp-overview', '/docs/zh/about/', '/docs/documentation.md', '/docs/sitemap.xml']) {
      assert.equal(effectiveHeader(route, 'CDN-Cache-Control'), HTML_ENTRY_EDGE_CACHE, `${route} must advertise the 600s Cloudflare TTL`);
      assert.equal(effectiveHeader(route, 'Vercel-CDN-Cache-Control'), 'no-store', `${route} must keep Vercel's cache out of the Mintlify proxy`);
      assert.equal(effectiveHeader(route, 'X-Content-Type-Options'), 'nosniff', `${route} must still carry the docs security headers`);
    }
    for (const route of ['/docs/mcp', '/docs/mcp/', '/docs/mcp/session', '/docs/_next/static/chunks/a.js', '/docs/_mintlify/favicons/a.png']) {
      assert.equal(effectiveHeader(route, 'CDN-Cache-Control'), null, `${route} is not a document and must not advertise the TTL`);
      assert.equal(effectiveHeader(route, 'Vercel-CDN-Cache-Control'), null, `${route} is not a document and must not carry a Vercel cache policy`);
    }

    // The sitemaps joined AGENT_TEXT_FILES in #7869 and keep the stricter
    // browser policy they have always had — the crawler that re-fetches a
    // sitemap wants a revalidation, and the shared edge TTL is unaffected.
    const SITEMAPS = new Set(['sitemap.xml', 'sitemap-main.xml']);
    for (const file of AGENT_TEXT_FILES) {
      const route = `/${file}`;
      assert.equal(effectiveHeader(route, 'CDN-Cache-Control'), HTML_ENTRY_EDGE_CACHE, `${route} must advertise the 600s Cloudflare TTL`);
      assert.equal(effectiveHeader(route, 'Vercel-CDN-Cache-Control'), HTML_ENTRY_EDGE_CACHE, `${route} must advertise the 600s Vercel TTL`);
      assert.equal(
        effectiveCacheControl(route),
        SITEMAPS.has(file) ? 'public, max-age=3600, must-revalidate' : 'public, max-age=3600',
        `${route} must keep its browser policy`,
      );
      assert.ok(existsSync(resolve(__dirname, '../public', file)), `${route} must be a static file in public/`);
    }
    // /index.md reaches the origin under its own name and is rewritten to
    // /home.md there; robots.txt is left to the zone bypass on purpose (it is
    // re-fetched rarely and cheap to serve); the nested llms.txt twins are not
    // root files. /schemamap.xml is not in the sitemap index and no crawler is
    // pointed at it.
    for (const route of ['/index.md', '/robots.txt', '/schemamap.xml', '/api/download.md', '/developers/llms.txt']) {
      assert.equal(effectiveHeader(route, 'CDN-Cache-Control'), null, `${route} must not advertise the document TTL`);
    }
  });

  it('keeps robots.txt advertising the root and Mintlify docs sitemaps, and no removed blog sitemap', () => {
    assert.match(robotsSource, /^Sitemap: https:\/\/www\.worldmonitor\.app\/sitemap\.xml$/m);
    assert.doesNotMatch(robotsSource, /\/blog\/sitemap-index\.xml/);
    assert.match(robotsSource, /^Sitemap: https:\/\/www\.worldmonitor\.app\/docs\/sitemap\.xml$/m);
  });

  // #7749 gave the sitemaps the Vercel half of the pair and deliberately left
  // the Cloudflare bypass alone. Round 7 then measured both still DYNAMIC under
  // a GET while every other corpus route hit, which is what the half-pair
  // predicts: the bypass rule names /sitemap.xml and .xml is outside
  // Cloudflare's default-cacheable extensions. #7869 completes the pair — the
  // claim lives in scripts/cloudflare-cache-rule.mjs (AGENT_TEXT_FILES).
  it('caches root sitemaps at both shared caches (#7869, supersedes #7749)', () => {
    for (const route of ['/sitemap.xml', '/sitemap-main.xml']) {
      assert.equal(effectiveCacheControl(route), 'public, max-age=3600, must-revalidate');
      assert.equal(effectiveHeader(route, 'Vercel-CDN-Cache-Control'), HTML_ENTRY_EDGE_CACHE);
      assert.equal(effectiveHeader(route, 'CDN-Cache-Control'), HTML_ENTRY_EDGE_CACHE);
    }
  });

  it('keeps the root sitemap generated while delegating blog and docs inventories', () => {
    assert.ok(sitemapSource.includes('Generated by npm run build:sitemap. Do not edit by hand.'));
    assert.ok(!sitemapSource.includes('https://www.worldmonitor.app/blog/'));
    assert.ok(!sitemapSource.includes('https://www.worldmonitor.app/docs/'));
    assert.ok(!sitemapSource.includes('<changefreq>'));
    assert.ok(!sitemapSource.includes('<priority>'));
  });
});

describe('deploy/cache configuration guardrails', () => {
  it('requires revalidation for HTML entry routes on Vercel without disabling bfcache', () => {
    // /mcp-grant added to the negative-lookahead by plan 2026-05-10-001 U3 — apex
    // Pro-MCP consent page must opt out of the SPA catch-all rewrite (it is its
    // own HTML entry registered in vite.config.ts rollupOptions.input).
    //
    // The exclusion uses literal alternation (`mcp-grant\\.html|mcp-grant`)
    // rather than a non-capturing group with `?` quantifier — Vercel's
    // path-to-regexp source-pattern parser rejects `(?:...)` in `source` fields
    // (deploy-fail PR #3646 round-2 review).
    //
    // Stacked-CDN HTML entries keep browser `Cache-Control` at max-age=0
    // (must-revalidate, never no-store — #3993/#4004) and put the 600s TTL on
    // CDN-Cache-Control + Vercel-CDN-Cache-Control. A combined Cache-Control
    // value lets Vercel consume s-maxage and forward max-age=0 to Cloudflare,
    // which then refuses to cache HTML.
    const spaNoCache = getCacheHeaderValue(SPA_HTML_CACHE_SOURCE);
    assert.equal(spaNoCache, 'private, no-cache, must-revalidate');
    assert.ok(!spaNoCache.includes('no-store'), 'HTML must not set no-store — it disables bfcache');
    for (const route of ['/', '/dashboard', '/dashboard.html']) {
      assertPublicHtmlEntryCache(route);
    }
  });

  it('disables caching for the apex /mcp-grant Pro-MCP consent page (both URL forms)', () => {
    // The Pro-MCP consent page is its own HTML entry. Both /mcp-grant (the
    // pretty URL, rewritten to /mcp-grant.html by vercel.json:12) and
    // /mcp-grant.html (the bundle path) must carry no-store. Vercel needs
    // explicit per-source rules — `(?:\\.html)?` quantifiers aren't supported.
    assert.equal(
      getCacheHeaderValue('/mcp-grant'),
      'no-cache, no-store, must-revalidate'
    );
    assert.equal(
      getCacheHeaderValue('/mcp-grant.html'),
      'no-cache, no-store, must-revalidate'
    );
  });

  it('keeps immutable caching for hashed static assets', () => {
    assert.equal(
      getCacheHeaderValue('/assets/(.*)'),
      'public, max-age=31536000, immutable'
    );
  });

  it('serves main-app hashed assets immutable after every matching rule applies', () => {
    assert.equal(
      effectiveCacheControl('/assets/index-abc.js'),
      'public, max-age=31536000, immutable'
    );
  });

  it('publishes no production source maps and gates the build on the source-map check (#7382)', () => {
    assert.match(viteConfigSource, /^\s*sourcemap: false,$/m);
    assert.equal(viteConfigSource.match(/sourcemap:/g)?.length, 1, 'vite.config.ts must set sourcemap in exactly one place');
    assert.doesNotMatch(viteConfigSource, /sentryVitePlugin|stripPrivateSourceMapsPlugin|viteSourcemapSetting/);
    assert.match(packageJson.scripts.build, / && npm run check:source-maps$/);
    assert.equal(packageJson.scripts['check:source-maps'], 'node --import tsx scripts/check-no-public-source-maps.mjs dist');
  });
});

// The only app shell. Guards below assert that no rewrite to it shadows a
// static or API path.
const APP_SHELL_HTML_DESTINATION = '/lite.html';

describe('welcome landing page routing', () => {
  // A `/` rewrite gated on a query condition (e.g. /?mode=agent →
  // /agent-view.json) never matches a plain navigation. The /pro welcome
  // rewrite left with the marketing site (refactor Phase 1b), so no plain `/`
  // rewrite remains: `/` redirects to /lite.
  const plainRootRewrites = () =>
    vercelConfig.rewrites.filter(
      (r) => r.source === '/' && !(r.has ?? []).some((condition) => condition.type === 'query')
    );

  // #4825: public/index.md became Vercel's DIRECTORY INDEX for `/` and served
  // raw text/markdown to browsers at the apex. No `index.*` file may exist in
  // public/; the markdown homepage twin is public/home.md.
  it('keeps public/ free of index.* files so filesystem resolution cannot hijack /', () => {
    const publicDir = resolve(__dirname, '../public');
    const offenders = readdirSync(publicDir).filter((f) => /^index\./i.test(f));
    assert.deepEqual(offenders, [], `public/${offenders[0] ?? ''} would shadow / as a directory index`);
  });

  it('serves no plain / rewrite and sends variant roots through /dashboard to /lite', () => {
    assert.deepEqual(plainRootRewrites(), [], 'a plain / rewrite would shadow the /lite redirect target with a removed page');

    for (const host of ['commodity.worldmonitor.app', 'energy.worldmonitor.app', 'finance.worldmonitor.app',
      'happy.worldmonitor.app', 'tech.worldmonitor.app']) {
      const redirect = firstRedirectFor({ host, path: '/' });
      assert.equal(redirect?.destination, '/dashboard', `${host}/ must 308 to /dashboard in production`);
      assert.equal(redirect.permanent, true);
      assert.equal(firstRedirectFor({ host, path: '/dashboard' })?.destination, '/lite', `${host}/dashboard must land on /lite`);
    }
  });

  it('opens deployment and branch preview roots through the dashboard route, which redirects to /lite', () => {
    for (const host of [
      'worldmonitor-h0zk88n4l-eliewm.vercel.app',
      'worldmonitor-git-perf-defer-dashboard-app-eliewm.vercel.app',
    ]) {
      const redirect = firstRedirectFor({ host, path: '/' });
      assert.equal(redirect?.destination, '/dashboard');
      assert.equal(redirect.permanent, false);
      // /dashboard is no longer served; it redirects on to the Lite UI.
      assert.equal(firstRewriteFor({ host, path: redirect.destination }), null);
      const lite = firstRedirectFor({ host, path: redirect.destination });
      assert.equal(lite?.destination, '/lite');
      assert.equal(lite.permanent, false);
      assert.equal(firstRewriteFor({ host, path: lite.destination })?.destination, '/lite.html');
      assert.equal(firstRedirectFor({ host, path: '/', query: { mode: 'agent' } }), null);
      assert.equal(firstRewriteFor({ host, path: '/', query: { mode: 'agent' } })?.destination, '/agent-view.json');
    }
  });

  it('keeps preview root routing off production homepages, unknown pages, and lookalike hosts', () => {
    // These roots take the host-agnostic Lite redirect, not the preview
    // /dashboard redirect.
    for (const host of ['worldmonitor.app', 'www.worldmonitor.app', 'example.com', 'preview.vercel.app.evil.example']) {
      assert.deepEqual(firstRedirectFor({ host, path: '/' }), {
        source: '/',
        missing: [{ type: 'query', key: 'mode', value: 'agent' }],
        destination: '/lite',
        permanent: false,
      });
    }
    assert.equal(firstRedirectFor({ host: 'preview.vercel.app', path: '/missing-page' }), null);
  });

  it('redirects legacy root map-state deep links to /dashboard before welcome routing', () => {
    assert.match(
      middlewareSource,
      /LEGACY_DASHBOARD_ROOT_QUERY_KEYS = \['lat', 'lon', 'zoom', 'view', 'timeRange', 'layers', 'c', 'country', 'chokepoint'\]/,
      'middleware must list dashboard URL-state params that bypass the root welcome page',
    );
    assert.match(
      middlewareSource,
      /path === '\/' && hasLegacyDashboardRootState\(url\.searchParams\)/,
      'middleware must detect legacy dashboard state on root requests',
    );
    assert.match(
      middlewareSource,
      /dashboardUrl\.pathname = '\/dashboard'/,
      'middleware must move legacy dashboard-state root links to /dashboard',
    );
    // Hand-built rather than Response.redirect() so the response can carry
    // Vary (#7660). The same URL now yields two different Locations depending
    // on the User-Agent, and a 308 is cacheable by default (RFC 9110
    // §15.4.9) — an unkeyed cache would replay one branch's Location to the
    // other's client.
    assert.match(
      middlewareSource,
      /headers: uaConditionedRedirectHeaders\(dashboardUrl\)/,
      'the legacy root redirect must preserve the query string AND declare the User-Agent cache key',
    );
    assert.match(
      middlewareSource,
      /'CDN-Cache-Control': 'no-store',\n\s*'Vercel-CDN-Cache-Control': 'no-store',/,
      'Cache-Control alone loses to the CDN directives on the / route',
    );
    assert.doesNotMatch(
      middlewareSource,
      /Response\.redirect\(dashboardUrl\.toString\(\), 308\)/,
      'Response.redirect() cannot set Vary, so it cannot be used for a UA-conditioned redirect',
    );
  });

  it('redirects / and the old dashboard routes to /lite temporarily, and serves no dashboard document', () => {
    assert.deepEqual(vercelConfig.redirects.filter((r) => r.destination === '/lite'), [
      { source: '/', missing: [{ type: 'query', key: 'mode', value: 'agent' }], destination: '/lite', permanent: false },
      { source: '/dashboard', destination: '/lite', permanent: false },
      { source: '/stocks', destination: '/lite', permanent: false },
      { source: '/stocks/:symbol', destination: '/lite', permanent: false },
      { source: '/story', destination: '/lite', permanent: false },
      { source: '/lite/', destination: '/lite', permanent: true },
    ]);
    for (const host of ['www.worldmonitor.app', 'worldmonitor.app']) {
      for (const path of ['/', '/dashboard', '/stocks', '/stocks/AAPL', '/stocks/BRK.B', '/story']) {
        assert.equal(firstRedirectFor({ host, path })?.destination, '/lite', `${host}${path} must redirect to /lite`);
      }
      // The agent-view discovery URL keeps its own rewrite.
      assert.equal(firstRedirectFor({ host, path: '/', query: { mode: 'agent' } }), null);
      assert.equal(firstRewriteFor({ host, path: '/', query: { mode: 'agent' } })?.destination, '/agent-view.json');
    }
    // Trailing-slash forms canonicalise first, then take the redirect above.
    assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path: '/dashboard/' })?.destination, '/dashboard');
    assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path: '/story/' })?.destination, '/story');
    // No rewrite targets a deleted dashboard document, or the deleted
    // /embed, /mcp-grant, /desktop-sign-in and /verify pages.
    assert.deepEqual(
      vercelConfig.rewrites.filter((r) => /^\/(?:dashboard[\w-]*|embed|mcp-grant|desktop-sign-in|verify|index)\.html$/.test(r.destination)),
      [],
    );
    for (const path of ['/dashboard', '/stocks', '/stocks/AAPL', '/story', '/embed', '/mcp-grant', '/desktop-sign-in', '/verify']) {
      assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path }), null, `${path} must not be rewritten`);
    }
  });

  it('does not point any rewrite at root index.html', () => {
    const indexRewrites = vercelConfig.rewrites.filter((r) => r.destination === '/index.html');
    assert.deepEqual(
      indexRewrites,
      [],
      'dashboard rewrites must target dashboard.html so Vercel filesystem precedence cannot serve a root index.html at /'
    );
  });

  it('emits dist/lite.html and no root index.html or dashboard HTML', () => {
    // Vercel's filesystem precedence serves a root index.html at / ahead of
    // every redirect and rewrite, so the build must not emit one.
    const distDir = resolve(__dirname, '../dist');
    const liteHtml = join(distDir, 'lite.html');
    if (shouldSkipBuiltOutput(liteHtml)) return;
    guardBuiltOutput(liteHtml);

    assert.ok(existsSync(liteHtml), 'web build must emit dist/lite.html');
    assert.ok(
      !existsSync(join(distDir, 'index.html')),
      'web build must not leave a root dist/index.html — Vercel would serve it at / ahead of the /lite redirect',
    );
    assert.deepEqual(readdirSync(distDir).filter((name) => /^dashboard.*\.html$/.test(name)), []);
  });

  it('does not reintroduce a negative-lookahead SPA catch-all rewrite', () => {
    const catchAll = vercelConfig.rewrites.find((r) =>
      r.source.startsWith('/((?!') && r.destination.endsWith('.html')
    );
    assert.equal(
      catchAll,
      undefined,
      'unknown paths must 404 instead of soft-404ing an app shell (#6575)'
    );
  });

  it('redirects legacy /welcome to / permanently', () => {
    const redirect = vercelConfig.redirects.find((r) => r.source === '/welcome');
    assert.ok(redirect, 'expected a redirect for /welcome');
    assert.equal(redirect.destination, '/');
    assert.equal(redirect.permanent, true);
  });

  it('sends a followed Clerk virtual-router href back to the dashboard instead of a 404', () => {
    const redirect = firstRedirectFor({
      host: 'www.worldmonitor.app',
      path: '/CLERK-ROUTER/VIRTUAL/sign-in/factor-one',
    });
    assert.ok(redirect, 'expected a redirect for /CLERK-ROUTER/*');
    assert.equal(redirect.destination, '/dashboard');
    assert.equal(redirect.permanent, false);
  });

  it('redirects direct /index.html requests to / permanently', () => {
    const redirect = vercelConfig.redirects.find((r) => r.source === '/index.html');
    assert.ok(redirect, 'expected a redirect for /index.html');
    assert.equal(redirect.destination, '/');
    assert.equal(redirect.permanent, true);
  });

  it('routes nothing to the removed /pro and /blog builds, and keeps the pricing contract static', () => {
    // The /pro marketing site and the blog were deleted in refactor Phase 1b;
    // a first-party redirect or rewrite into them would serve a 404.
    for (const rule of [...vercelConfig.redirects, ...vercelConfig.rewrites]) {
      assert.doesNotMatch(String(rule.destination), /^\/(?:pro|blog)(?:[/#?.]|$)/, `${rule.source} routes to a removed build`);
    }

    assert.equal(
      vercelConfig.redirects.some((r) => r.source === '/pricing.md'),
      false,
      'the machine-readable pricing contract must remain a static asset',
    );
    assert.equal(
      vercelConfig.redirects.some((r) => r.source === '/api/product-catalog'),
      false,
      'the live product catalog endpoint must remain unchanged',
    );
    assert.equal(
      vercelConfig.rewrites.some((r) => r.source === '/pricing'),
      false,
      '/pricing must be handled in the redirects phase before the SPA rewrites phase',
    );
  });

  it('redirects bare corpus roots to canonical generated pages', () => {
    const changelog = vercelConfig.redirects.find((r) => r.source === '/changelog');
    assert.ok(changelog, 'expected a redirect for /changelog');
    assert.equal(changelog.destination, '/reference/changelog/');
    assert.equal(changelog.permanent, true);

    const reference = vercelConfig.redirects.find((r) => r.source === '/reference');
    assert.ok(reference, 'expected a redirect for /reference');
    assert.equal(reference.destination, '/reference/changelog/');
    assert.equal(reference.permanent, false);
  });

  it('requires revalidation for /dashboard HTML without disabling bfcache', () => {
    assertPublicHtmlEntryCache('/dashboard');
  });

  it('requires revalidation for root welcome HTML without disabling bfcache', () => {
    assertPublicHtmlEntryCache('/');
  });

  it('gives indexable locale landings the same public HTML cache as the English homepage', () => {
    // Last matching header wins. Without an explicit later rule, /es/ inherits
    // the SPA catch-all `private, no-cache` instead of the homepage CDN policy.
    // Two-letter locale ids stay out of that catch-all's prefix lookahead so
    // `/debug` or `/archive` cannot be excluded by `de` / `ar`.
    const homepageLink = effectiveHeader('/', 'Link');
    for (const locale of nonDefaultLandingLocales()) {
      assertPublicHtmlEntryCache(`/${locale.pathSegment}`);
      assertPublicHtmlEntryCache(locale.canonicalPath);
      assert.equal(effectiveHeader(locale.canonicalPath, 'Link'), homepageLink);
      assert.equal(
        effectiveCacheControl(`/${locale.pathSegment}/not-a-landing`),
        'private, no-cache, must-revalidate',
        `/${locale.pathSegment}/not-a-landing must stay on the SPA HTML cache policy`,
      );
    }
  });

  it('requires revalidation for direct dashboard.html without disabling bfcache', () => {
    assertPublicHtmlEntryCache('/dashboard.html');
  });

  it('redirects bare /api to the docs API reference hub (#7382)', () => {
    for (const source of ['/api', '/api/']) {
      const apiRedirect = vercelConfig.redirects.find((r) => r.source === source);
      assert.ok(apiRedirect, `expected a redirect for ${source}`);
      assert.equal(apiRedirect.destination, '/docs/api-reference');
      assert.equal(apiRedirect.permanent, false);
    }
  });

  it('redirects bare /docs to the docs home permanently, with or without a trailing slash', () => {
    for (const source of ['/docs', '/docs/']) {
      const docsRedirect = vercelConfig.redirects.find((r) => r.source === source);
      assert.ok(docsRedirect, `expected a redirect for ${source}`);
      assert.equal(docsRedirect.destination, '/docs/documentation');
      assert.equal(docsRedirect.permanent, true);
    }
  });

  it('serves the Lite UI at /lite, its three child screens and Sources, and nothing else under it', () => {
    const rewrites = vercelConfig.rewrites.filter((r) => r.source.startsWith('/lite'));
    assert.deepEqual(rewrites, [
      { source: '/lite', destination: '/lite.html' },
      { source: '/lite/geopolitics', destination: '/lite.html' },
      { source: '/lite/finance', destination: '/lite.html' },
      { source: '/lite/tech', destination: '/lite.html' },
      { source: '/lite/sources', destination: '/lite.html' },
    ]);
    assert.ok(vercelConfig.redirects.some((r) => r.source === '/lite/' && r.destination === '/lite' && r.permanent === true));
    // vite.config.ts is the Lite build: lite.html is its only input, its
    // assets live under assets/lite/, and there is no PWA service worker.
    assert.match(viteConfigSource, /input: \{ lite: resolve\(__dirname, 'lite\.html'\) \}/);
    assert.match(viteConfigSource, /entryFileNames: 'assets\/lite\/\[name\]-\[hash\]\.js'/);
    assert.match(viteConfigSource, /chunkFileNames: 'assets\/lite\/\[name\]-\[hash\]\.js'/);
    assert.match(viteConfigSource, /assetFileNames: 'assets\/lite\/\[name\]-\[hash\]\[extname\]'/);
    assert.doesNotMatch(viteConfigSource, /VitePWA|workbox/);
    assert.ok(!existsSync(resolve(__dirname, '../vite.lite.config.ts')), 'there is one Vite config');
    assert.equal(packageJson.scripts['build:lite'], undefined);
  });

  it('sitemap lists dashboard routes and does not list legacy /welcome', () => {
    const sitemap = readFileSync(resolve(__dirname, '../public/sitemap-main.xml'), 'utf-8');
    assert.ok(
      sitemap.includes('<loc>https://www.worldmonitor.app/dashboard</loc>'),
      'public/sitemap-main.xml must list https://www.worldmonitor.app/dashboard'
    );
    for (const host of ['tech', 'finance', 'commodity', 'happy', 'energy']) {
      assert.ok(
        sitemap.includes(`<loc>https://${host}.worldmonitor.app/dashboard</loc>`),
        `public/sitemap-main.xml must list https://${host}.worldmonitor.app/dashboard`
      );
    }
    assert.ok(
      !sitemap.includes('<loc>https://www.worldmonitor.app/welcome</loc>'),
      'public/sitemap-main.xml must not list legacy https://www.worldmonitor.app/welcome'
    );
  });

});

describe('deploy/API CORS guardrails', () => {
  it('does not define static CORS headers for /api routes in vercel.json', () => {
    const corsHeaderKeys = new Set([
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
      'access-control-allow-credentials',
    ]);
    const apiCorsRules = vercelConfig.headers
      .filter((entry) => entry.source.startsWith('/api'))
      .filter((entry) => !entry.source.endsWith('.md'))
      .filter((entry) => entry.headers?.some((header) => corsHeaderKeys.has(header.key.toLowerCase())))
      .map((entry) => entry.source);

    assert.deepEqual(
      apiCorsRules,
      [],
      'JSON API CORS must be emitted by handlers so credentialed requests get origin-specific ACAO plus ACAC=true. Static /api/*.md twins are public agent documents and may set ACAO * in vercel.json.'
    );
  });
});

describe('docker runtime dependency guardrails', () => {
  const runtimePackage = JSON.parse(readFileSync(resolve(__dirname, '../docker/runtime-package.json'), 'utf-8'));
  const runtimeLock = JSON.parse(readFileSync(resolve(__dirname, '../docker/runtime-package-lock.json'), 'utf-8'));

  it('installs runtime node_modules from a minimal dependency stage', () => {
    assert.match(dockerfileSource, /^FROM\s+node:\d+-alpine@sha256:[a-f0-9]{64}\s+AS\s+runtime-deps$/m);
    assert.match(dockerfileSource, /npm ci --omit=dev --omit=optional --ignore-scripts/);
    assert.match(dockerfileSource, /COPY --from=runtime-deps \/app\/node_modules \.\/node_modules/);
    assert.doesNotMatch(dockerfileSource, /npm prune --omit=dev/);
    assert.doesNotMatch(dockerfileSource, /COPY --from=builder \/app\/node_modules \.\/node_modules/);
  });

  it('keeps raw JS handler packages without copying the full app dependency graph', () => {
    assert.deepEqual(Object.keys(runtimePackage.dependencies).sort(), [
      '@upstash/ratelimit',
      '@upstash/redis',
      'convex',
    ]);
    assert.deepEqual(
      Object.keys(runtimeLock.packages[''].dependencies).sort(),
      Object.keys(runtimePackage.dependencies).sort()
    );

    const lockPackageNames = Object.keys(runtimeLock.packages);
    for (const omitted of ['node_modules/@xenova/transformers', 'node_modules/onnxruntime-web', 'node_modules/playwright']) {
      assert.ok(!lockPackageNames.includes(omitted), `${omitted} should not be in Docker runtime deps`);
    }
  });
});

const getSecurityHeaders = () => {
  const rule = vercelConfig.headers.find((entry) => entry.source === GLOBAL_SECURITY_HEADER_SOURCE);
  return rule?.headers ?? [];
};

const getHeaderValue = (key) => {
  const headers = getSecurityHeaders();
  const header = headers.find((h) => h.key.toLowerCase() === key.toLowerCase());
  return header?.value ?? null;
};

const getNginxHeaderValueFrom = (file, key) => {
  const nginxConf = readFileSync(resolve(__dirname, `../${file}`), 'utf-8');
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = nginxConf
    .split('\n')
    .find((candidate) => new RegExp(`^add_header\\s+${escapedKey}\\s+"`, 'i').test(candidate));
  const match = line?.match(/^add_header\s+\S+\s+"(.*)"\s+always;(?:\s*#.*)?$/i);
  return match?.[1].replace(/\\"/g, '"') ?? null;
};

const getNginxHeaderValue = (key) => getNginxHeaderValueFrom('docker/nginx-security-headers.conf', key);

describe('security header guardrails', () => {
  it('includes required security headers on catch-all route', () => {
    const required = [
      'X-Content-Type-Options',
      'Strict-Transport-Security',
      'Referrer-Policy',
      'Reporting-Endpoints',
      'Cross-Origin-Opener-Policy-Report-Only',
      'Cross-Origin-Embedder-Policy-Report-Only',
      'Permissions-Policy',
      'Content-Security-Policy',
    ];
    const headerKeys = getSecurityHeaders().map((h) => h.key);
    for (const name of required) {
      assert.ok(headerKeys.includes(name), `Missing security header: ${name}`);
    }
  });

  it('keeps COOP/COEP in report-only mode during rollout', () => {
    // Relative URL so the apex + every variant subdomain (tech/finance/
    // commodity/happy, all on the same Vercel deployment) reports
    // same-origin. An absolute apex URL would force cross-origin POSTs
    // on subdomain hosts with stripped credentials and inconsistent
    // browser sampling.
    assert.equal(
      getHeaderValue('Reporting-Endpoints'),
      'wm-coop-coep="/api/security/report"',
    );
    assert.equal(
      getHeaderValue('Cross-Origin-Opener-Policy-Report-Only'),
      'same-origin; report-to="wm-coop-coep"',
    );
    assert.equal(
      getHeaderValue('Cross-Origin-Embedder-Policy-Report-Only'),
      'require-corp; report-to="wm-coop-coep"',
    );
    assert.equal(getHeaderValue('Cross-Origin-Opener-Policy'), null);
    assert.equal(getHeaderValue('Cross-Origin-Embedder-Policy'), null);
  });

  it('keeps self-hosted nginx security headers aligned for COOP/COEP reporting', () => {
    const nginxHeaders = readFileSync(
      resolve(__dirname, '../docker/nginx-security-headers.conf'),
      'utf-8',
    );
    assert.match(
      nginxHeaders,
      /add_header Reporting-Endpoints "wm-coop-coep=\\"\/api\/security\/report\\"" always;/,
    );
    assert.match(
      nginxHeaders,
      /add_header Cross-Origin-Opener-Policy-Report-Only "same-origin; report-to=\\"wm-coop-coep\\"" always;/,
    );
    assert.match(
      nginxHeaders,
      /add_header Cross-Origin-Embedder-Policy-Report-Only "require-corp; report-to=\\"wm-coop-coep\\"" always;/,
    );
  });

  it('Permissions-Policy disables all expected browser APIs', () => {
    const policy = getHeaderValue('Permissions-Policy');
    const expectedDisabled = [
      'camera=()',
      'microphone=()',
      'accelerometer=()',
      'bluetooth=()',
      'display-capture=()',
      'gyroscope=()',
      'hid=()',
      'idle-detection=()',
      'magnetometer=()',
      'midi=()',
      'payment=(self "https://checkout.dodopayments.com" "https://test.checkout.dodopayments.com" "https://pay.google.com" "https://hooks.stripe.com" "https://js.stripe.com")',
      'screen-wake-lock=()',
      'serial=()',
      'usb=()',
      'xr-spatial-tracking=("https://challenges.cloudflare.com")',
    ];
    for (const directive of expectedDisabled) {
      assert.ok(policy.includes(directive), `Permissions-Policy missing: ${directive}`);
    }
  });

  it('Permissions-Policy delegates media APIs to allowed origins', () => {
    const policy = getHeaderValue('Permissions-Policy');
    // autoplay and encrypted-media delegate to self + YouTube
    for (const api of ['autoplay', 'encrypted-media']) {
      assert.match(
        policy,
        new RegExp(`${api}=\\(self "https://www\\.youtube\\.com" "https://www\\.youtube-nocookie\\.com"\\)`),
        `Permissions-Policy should delegate ${api} to YouTube origins`
      );
    }
    // geolocation delegates to self (used by user-location.ts)
    assert.ok(
      policy.includes('geolocation=(self)'),
      'Permissions-Policy should delegate geolocation to self'
    );
    // picture-in-picture delegates to self + YouTube + Turnstile
    assert.match(
      policy,
      /picture-in-picture=\(self "https:\/\/www\.youtube\.com" "https:\/\/www\.youtube-nocookie\.com" "https:\/\/challenges\.cloudflare\.com"\)/,
      'Permissions-Policy should delegate picture-in-picture to YouTube + Turnstile origins'
    );
  });

  it('Permissions-Policy explicitly opts embedded documents into unload handlers', () => {
    const policy = getHeaderValue('Permissions-Policy');
    assert.ok(
      policy.includes('unload=(*)'),
      'Permissions-Policy should explicitly allow embedded unload handlers to avoid third-party iframe console violations'
    );
  });

  it('Permissions-Policy exposes WebMCP tools only to same-origin agents', () => {
    const policy = getHeaderValue('Permissions-Policy');
    assert.ok(
      policy.includes('tools=(self)'),
      'Dashboard/homepage Permissions-Policy must keep WebMCP same-origin',
    );
    assert.doesNotMatch(policy, /tools=\(\*\)/, 'WebMCP tools must never be exposed to every origin');
  });

  it('origin-keys only the intended production web origins', () => {
    const rules = vercelConfig.headers.filter((entry) =>
      entry.headers?.some((header) => header.key.toLowerCase() === 'origin-agent-cluster')
    );
    assert.equal(rules.length, 1, 'Expected one reviewable Origin-Agent-Cluster rule');
    const [rule] = rules;
    assert.equal(rule.source, '/(.*)', 'Origin-Agent-Cluster must be consistent across each enrolled origin');
    assert.deepEqual(rule.has, [{ type: 'host', value: WEBMCP_PRODUCTION_HOST_PATTERN }]);
    assert.equal(
      rule.headers.find((header) => header.key.toLowerCase() === 'origin-agent-cluster')?.value,
      '?1',
    );
    assert.ok(!rule.has[0].value.includes('vercel'), 'Preview deployments must not be origin-trial candidates');
    assert.equal(getNginxHeaderValue('Origin-Agent-Cluster'), '?1');
    assert.equal(
      getNginxHeaderValueFrom('docker/nginx-embed-security-headers.conf', 'Origin-Agent-Cluster'),
      '?1',
      'Embedded documents must keep the same origin-keying opt-in while tools=() denies WebMCP',
    );

    const sidecarLocationBlocks = [...dockerNginxSource.matchAll(/^ {4}location [^{]+\{\n([\s\S]*?)^ {4}\}/gm)];
    assert.ok(sidecarLocationBlocks.length > 0, 'docker/nginx.conf must define route locations');
    for (const [locationBlock] of sidecarLocationBlocks) {
      const location = locationBlock.match(/^ {4}location ([^{]+)\{/)?.[1].trim() ?? '<unknown>';
      assert.match(
        locationBlock,
        /add_header Origin-Agent-Cluster "\?1" always;/,
        `docker/nginx.conf ${location} must preserve origin-keying on direct navigations`,
      );
    }

    const nginxTemplate = readFileSync(resolve(__dirname, '../docker/nginx.conf.template'), 'utf-8');
    const frontendLocationBlocks = [...nginxTemplate.matchAll(/^ {4}location [^{]+\{\n([\s\S]*?)^ {4}\}/gm)];
    assert.ok(frontendLocationBlocks.length > 0, 'docker/nginx.conf.template must define route locations');
    for (const [locationBlock] of frontendLocationBlocks) {
      const location = locationBlock.match(/^ {4}location ([^{]+)\{/)?.[1].trim() ?? '<unknown>';
      assert.match(
        locationBlock,
        /include \/etc\/nginx\/(?:embed_|oauth_authorize_|youtube_embed_)?security_headers\.conf;/,
        `docker/nginx.conf.template ${location} must include an origin-keying header set`,
      );
    }
  });

  it('keeps every self-hosted image route out of search indexes', () => {
    // Self-hosted pages keep www.worldmonitor.app canonicals, so an indexed copy can
    // only compete with the official page (wm.tanukihitokiri.ru, 2026-11).
    const noindex = /add_header X-Robots-Tag "noindex, follow" always;/;

    const sidecarLocationBlocks = [...dockerNginxSource.matchAll(/^ {4}location [^{]+\{\n([\s\S]*?)^ {4}\}/gm)];
    assert.ok(sidecarLocationBlocks.length > 0, 'docker/nginx.conf must define route locations');
    for (const [locationBlock] of sidecarLocationBlocks) {
      const location = locationBlock.match(/^ {4}location ([^{]+)\{/)?.[1].trim() ?? '<unknown>';
      assert.match(locationBlock, noindex, `docker/nginx.conf ${location} must send X-Robots-Tag noindex`);
    }

    const includedHeaderFiles = {
      'security_headers.conf': 'docker/nginx-security-headers.conf',
      'embed_security_headers.conf': 'docker/nginx-embed-security-headers.conf',
      'oauth_authorize_security_headers.conf': 'docker/nginx-oauth-authorize-security-headers.conf',
      'youtube_embed_security_headers.conf': 'docker/nginx-youtube-embed-security-headers.conf',
    };
    const nginxTemplate = readFileSync(resolve(__dirname, '../docker/nginx.conf.template'), 'utf-8');
    const frontendLocationBlocks = [...nginxTemplate.matchAll(/^ {4}location [^{]+\{\n([\s\S]*?)^ {4}\}/gm)];
    assert.ok(frontendLocationBlocks.length > 0, 'docker/nginx.conf.template must define route locations');
    for (const [locationBlock] of frontendLocationBlocks) {
      const location = locationBlock.match(/^ {4}location ([^{]+)\{/)?.[1].trim() ?? '<unknown>';
      const included = locationBlock.match(/include \/etc\/nginx\/(\S+\.conf);/)?.[1];
      const source = included
        ? readFileSync(resolve(__dirname, `../${includedHeaderFiles[included]}`), 'utf-8')
        : locationBlock;
      assert.match(source, noindex, `docker/nginx.conf.template ${location} must send X-Robots-Tag noindex`);
    }
  });

  it('enrolls only eligible production documents with exact-origin WebMCP trial tokens', () => {
    const rules = vercelConfig.headers.filter((entry) =>
      entry.headers?.some((header) => header.key.toLowerCase() === 'origin-trial')
    );
    assert.equal(rules.length, 4 + (WEBMCP_PRODUCTION_HOSTS.length - 1) * 2);

    for (const host of WEBMCP_PRODUCTION_HOSTS) {
      const hostPattern = '^' + host.replaceAll('.', '\\.') + '$';
      const hostRules = rules.filter((rule) =>
        rule.has?.some((condition) => condition.type === 'host' && condition.value === hostPattern)
      );
      const expectedSources = host === 'www.worldmonitor.app'
        ? ['/', '/(es|pt|ru|fr|de|ar)/', '/dashboard', '/dashboard.html']
        : ['/dashboard', '/dashboard.html'];
      assert.deepEqual(
        hostRules.map((rule) => rule.source).sort(),
        expectedSources.slice().sort(),
        host + ' must enroll only documents that directly return WebMCP HTML',
      );
      if (host === 'www.worldmonitor.app') {
        const rootRule = hostRules.find((rule) => rule.source === '/');
        assert.ok(rootRule, host + ' must define a homepage origin-trial rule');
        assert.deepEqual(
          rootRule.missing,
          [{ type: 'query', key: 'mode', value: 'agent' }],
          host + ' must exclude the /?mode=agent JSON representation from enrollment',
        );
        assert.equal(headerRuleMatchesRequest(rootRule, { path: '/', host }), true);
        assert.equal(headerRuleMatchesRequest(rootRule, { path: '/', host, query: { mode: 'reader' } }), true);
        assert.equal(
          headerRuleMatchesRequest(rootRule, { path: '/', host, query: { mode: 'agent' } }),
          false,
          host + ' must not attach an Origin-Trial token to /?mode=agent',
        );
        const landingRule = hostRules.find((rule) => rule.source === '/(es|pt|ru|fr|de|ar)/');
        assert.ok(landingRule, host + ' must enroll prerendered locale landings');
        assert.deepEqual(
          landingRule.missing,
          [{ type: 'query', key: 'mode', value: 'agent' }],
          host + ' must exclude locale-landing ?mode=agent from enrollment',
        );
        for (const locale of nonDefaultLandingLocales()) {
          assert.equal(headerRuleMatchesRequest(landingRule, { path: locale.canonicalPath, host }), true);
          assert.equal(
            headerRuleMatchesRequest(landingRule, { path: locale.canonicalPath, host, query: { mode: 'agent' } }),
            false,
          );
        }
      }
      assert.equal(
        hostRules.some((rule) => headerRuleMatchesRequest(rule, { path: '/dashboard', host })),
        true,
        host + ' must enroll the canonical dashboard route',
      );
      assert.equal(
        hostRules.some((rule) => headerRuleMatchesRequest(rule, { path: '/dashboard.html', host })),
        true,
        host + ' must enroll the directly navigable dashboard document',
      );
      const tokens = new Set(hostRules.map((rule) =>
        rule.headers.find((header) => header.key.toLowerCase() === 'origin-trial')?.value
      ));
      assert.equal(tokens.size, 1, host + ' must use one token consistently across eligible routes');
      const [token] = tokens;
      assert.ok(token && !token.includes('REPLACE_WITH'), host + ' must not ship a placeholder token');

      const payload = decodeOriginTrialTokenPayload(token);
      assert.deepEqual(
        Object.keys(payload).sort(),
        ['expiry', 'feature', 'origin'],
        host + ' token must not carry subdomain, third-party, or usage-restriction scope',
      );
      assert.equal(payload.origin, 'https://' + host + ':443');
      assert.equal(payload.feature, 'WebMCP');
      assert.equal(payload.expiry, WEBMCP_TRIAL_EXPIRY);
      assert.ok(
        payload.expiry > Math.floor(Date.now() / 1000) + WEBMCP_TOKEN_RENEWAL_BUFFER_SECONDS,
        host + ' WebMCP token expires within 14 days; renew it or remove the completed trial enrollment',
      );
      assert.equal(
        createHash('sha256').update(token).digest('hex'),
        WEBMCP_TOKEN_SHA256_BY_HOST[host],
        host + ' complete signed token must match its independently pinned digest',
      );
    }

    assert.equal(
      new Set(rules.map((rule) =>
        rule.headers.find((header) => header.key.toLowerCase() === 'origin-trial')?.value
      )).size,
      WEBMCP_PRODUCTION_HOSTS.length,
      'Each production origin must have its own exact-origin token',
    );
    assert.ok(
      rules.every((rule) => !rule.has?.some((condition) => condition.value.includes('vercel'))),
      'Preview deployments must not receive WebMCP trial tokens',
    );
    for (const request of [
      { path: '/embed', host: 'www.worldmonitor.app' },
      { path: '/embed.html', host: 'www.worldmonitor.app' },
      { path: '/docs/documentation', host: 'www.worldmonitor.app' },
      { path: '/api/health', host: 'www.worldmonitor.app' },
      { path: '/oauth/authorize', host: 'www.worldmonitor.app' },
      { path: '/dashboard', host: 'worldmonitor.app' },
      { path: '/dashboard', host: 'worldmonitor-git-main-example.vercel.app' },
    ]) {
      assert.equal(
        rules.some((rule) => headerRuleMatchesRequest(rule, request)),
        false,
        request.host + request.path + ' must remain outside the WebMCP origin trial',
      );
    }
  });

  it('Permissions-Policy is in sync between vercel.json header and docker/nginx-security-headers.conf', () => {
    assert.equal(
      getNginxHeaderValue('Permissions-Policy'),
      getHeaderValue('Permissions-Policy'),
      'Self-hosted docker users must have the same Permissions-Policy as Vercel.'
    );
  });

  it('every shipped CSP directive name is a real CSP directive', () => {
    // A detect-secrets pragma once leaked into the header value itself
    // (`object-src 'none'; x-allowlist // pragma: allowlist secret;
    // form-action ...`), which Chrome reported on every production page load
    // as "Unrecognized Content-Security-Policy directive 'x-allowlist'". JSON
    // has no comment syntax, so any such annotation ships to browsers.
    const KNOWN_CSP_DIRECTIVES = new Set([
      'base-uri', 'block-all-mixed-content', 'child-src', 'connect-src',
      'default-src', 'font-src', 'form-action', 'frame-ancestors', 'frame-src',
      'img-src', 'manifest-src', 'media-src', 'object-src', 'prefetch-src',
      'report-to', 'report-uri', 'require-trusted-types-for', 'sandbox',
      'script-src', 'script-src-attr', 'script-src-elem', 'style-src',
      'style-src-attr', 'style-src-elem', 'trusted-types',
      'upgrade-insecure-requests', 'worker-src',
    ]);
    const surfaces = [
      ['vercel', getHeaderValue('Content-Security-Policy')],
      ['docker/nginx', getNginxHeaderValue('Content-Security-Policy')],
    ];
    for (const [label, csp] of surfaces) {
      assert.ok(csp, `${label} must define a Content-Security-Policy`);
      for (const segment of csp.split(';')) {
        const name = segment.trim().split(/\s+/)[0];
        if (!name) continue;
        assert.ok(
          KNOWN_CSP_DIRECTIVES.has(name),
          `${label} CSP ships unrecognized directive "${name}" — browsers ignore it and log an error on every page load`,
        );
      }
    }
  });

  it('CSP connect-src does not allow unencrypted WebSocket (ws:)', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    const connectSrc = csp.match(/connect-src\s+([^;]+)/)?.[1] ?? '';
    assert.ok(!connectSrc.includes(' ws:'), 'CSP connect-src must not contain ws: (unencrypted WebSocket)');
    assert.ok(connectSrc.includes('wss:'), 'CSP connect-src should keep wss: for secure WebSocket');
  });

  it('dashboard CSP is header-only and keeps https: for runtime fetch/media', () => {
    const liteHtml = readFileSync(resolve(__dirname, '../lite.html'), 'utf-8');
    const headerCsp = getHeaderValue('Content-Security-Policy');
    assert.equal(hasCspMeta(liteHtml), false, 'lite.html must not ship a CSP meta tag');

    const headerConnectSrc = headerCsp.match(/connect-src\s+([^;]+)/)?.[1] ?? '';
    const headerMediaSrc = headerCsp.match(/media-src\s+([^;]+)/)?.[1] ?? '';

    assert.ok(headerConnectSrc.split(/\s+/).includes('https:'), 'header connect-src must keep https: for runtime APIs and CSP filtering');
    assert.ok(headerMediaSrc.split(/\s+/).includes('https:'), 'header media-src must keep https: for live media and CSP filtering');
  });

  it('CSP connect-src does not contain localhost in production', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    const connectSrc = csp.match(/connect-src\s+([^;]+)/)?.[1] ?? '';
    assert.ok(!connectSrc.includes('http://localhost'), 'CSP connect-src must not contain http://localhost in production');
  });

  it('dashboard CSP font and style sources are first-party across deploy surfaces', () => {
    const liteHtml = readFileSync(resolve(__dirname, '../lite.html'), 'utf-8');
    const headerCsp = getHeaderValue('Content-Security-Policy');
    assert.equal(hasCspMeta(liteHtml), false, 'lite.html must not ship a CSP meta tag');
    const nginxCsp = getNginxHeaderValue('Content-Security-Policy');
    assert.ok(nginxCsp, 'nginx-security-headers.conf must have a Content-Security-Policy header');

    const surfaces = [
      ['vercel', headerCsp],
      ['docker/nginx', nginxCsp],
    ];

    for (const directive of ['style-src', 'font-src']) {
      const baseline = getCspDirectiveTokens(headerCsp, directive);
      for (const [label, csp] of surfaces) {
        const tokens = getCspDirectiveTokens(csp, directive);
        assert.deepEqual(
          tokens,
          baseline,
          `${directive} tokens in ${label} must match vercel.json: ${tokens.join(', ')}`
        );
        assert.ok(!tokens.includes('https:'), `${label} ${directive} must not allow all HTTPS origins`);
        assert.ok(
          !tokens.some((token) => token.includes('fonts.googleapis.com') || token.includes('fonts.gstatic.com')),
          `${label} ${directive} must not allow Google Fonts after the dashboard self-hosts fonts`
        );
      }
    }
  });

  it('dashboard CSP font-src admits ZERO cross-origin sources — the CSP filter depends on it', () => {
    // This is the license for the blanket font-src suppression in src/main.ts
    // (`cspFontSrcAllowsCrossOrigin`). That filter drops EVERY cross-origin font
    // block on the reasoning that this policy admits none, so such a block can
    // only be an injected stylesheet. It replaced sixteen host-pinned rules that
    // each re-derived the same premise (WORLDMONITOR-TR rounds 1-9).
    //
    // If the app ever adopts a cross-origin font host, this assertion fails
    // FIRST — before the filter silently starts hiding a real regression. The
    // fix then is to feed the real policy into the filter, not to delete this.
    const surfaces = [
      ['vercel', getHeaderValue('Content-Security-Policy')],
      ['docker/nginx', getNginxHeaderValue('Content-Security-Policy')],
    ];
    for (const [label, csp] of surfaces) {
      const tokens = getCspDirectiveTokens(csp, 'font-src');
      assert.ok(tokens.length > 0, `${label} must declare an explicit font-src`);
      const crossOrigin = tokens.filter(
        (token) => !/^'[^']*'$/.test(token) && !/^(?:data|blob):$/.test(token),
      );
      assert.deepEqual(
        crossOrigin,
        [],
        `${label} font-src must admit no cross-origin source (found: ${crossOrigin.join(', ')}). ` +
          'src/main.ts suppresses all cross-origin font-src violations on the strength of this; ' +
          'adopting a remote font host requires revisiting that filter in the same change.',
      );
    }
  });

  it('CSP script-src includes wasm-unsafe-eval for WebAssembly support', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] ?? '';
    assert.ok(scriptSrc.includes("'wasm-unsafe-eval'"), 'CSP script-src must include wasm-unsafe-eval for WASM support');
    assert.ok(scriptSrc.includes("'self'"), 'CSP script-src must include self');
  });

  // Split deliberately (#6898). The exact-set assertion below needs EVERY file
  // in the list, including the two built /pro pages, so it has to be gated. But
  // five of the seven are committed HTML that has nothing to do with /pro, and
  // gating the whole case dropped their CSP coverage in any checkout without a
  // /pro build. This subset half keeps that coverage unconditional: every inline
  // script in a committed file must already be trusted by the header CSP.
  it('CSP script-src trusts every un-nonced inline script in committed HTML', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    const scriptHashTokens = getCspDirectiveTokens(csp, 'script-src')
      .filter((token) => token.startsWith("'sha256-"));
    const committedFiles = GLOBAL_CSP_INLINE_SCRIPT_HTML_FILES;
    assert.ok(
      committedFiles.length > 0,
      'committed-HTML population is empty — this guard would pass vacuously',
    );
    const committedHashTokens = [...new Set(committedFiles.flatMap((file) => {
      const html = readFileSync(resolve(__dirname, '..', file), 'utf-8');
      return getInlineScriptHashTokens(html);
    }))].sort();
    assert.ok(committedHashTokens.length > 0, 'expected inline scripts in committed HTML');
    const untrusted = committedHashTokens.filter((token) => !scriptHashTokens.includes(token));
    assert.deepEqual(
      untrusted,
      [],
      'committed HTML ships un-nonced inline scripts the header CSP does not trust: ' +
        committedFiles.join(', ')
    );
  });

  it('CSP script-src hashes exactly match un-nonced inline scripts served under the global CSP', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    const scriptHashTokens = getCspDirectiveTokens(csp, 'script-src')
      .filter((token) => token.startsWith("'sha256-"));
    const inlineHashTokens = [...new Set(GLOBAL_CSP_INLINE_SCRIPT_HTML_FILES.flatMap((file) => {
      const html = readFileSync(resolve(__dirname, '..', file), 'utf-8');
      return getInlineScriptHashTokens(html);
    }))].sort();

    assert.ok(inlineHashTokens.length > 0, 'expected inline scripts under the global CSP');
    assert.deepEqual(
      scriptHashTokens,
      inlineHashTokens,
      'CSP script-src hashes must be the exact set required by un-nonced deployed HTML scripts: ' +
        GLOBAL_CSP_INLINE_SCRIPT_HTML_FILES.join(', ')
    );
  });

  it('CSP script-src uses strict-dynamic with nonce/hash trust, not script host allowlists', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    const tokens = getCspDirectiveTokens(csp, 'script-src');
    assert.ok(
      tokens.includes("'strict-dynamic'"),
      'CSP script-src must include strict-dynamic so trusted bootstrap scripts can load secondary scripts'
    );
    assert.ok(
      tokens.includes(`'nonce-${STATIC_SCRIPT_NONCE}'`),
      'CSP script-src must include the static entry-script nonce used by parser-inserted HTML entries'
    );
    assert.ok(
      tokens.some((token) => token.startsWith("'sha256-")),
      'CSP script-src must include hashes for inline bootstrap scripts'
    );
    assert.deepEqual(
      tokens.filter((token) => /^https?:/.test(token) || token.includes('*.')),
      [],
      'CSP script-src must not rely on script host allowlists'
    );
  });

  it('production script-src forbids unsafe-eval', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    const tokens = getCspDirectiveTokens(csp, 'script-src');
    assert.ok(!tokens.includes("'unsafe-eval'"), 'production script-src must not allow unsafe-eval');
  });

  it('CSP frame-src includes Clerk origin for auth modals', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    const frameSrc = csp.match(/frame-src\s+([^;]+)/)?.[1] ?? '';
    assert.ok(
      frameSrc.includes('clerk.accounts.dev') || frameSrc.includes('clerk.worldmonitor.app'),
      'CSP frame-src must include Clerk origin for sign-in modal'
    );
  });

  it('docker/nginx CSP frame-src includes Clerk origin for auth modals', () => {
    // Parity with the Vercel/index.html frame-src above. The sign-in modal itself
    // renders in-DOM (no clerk-origin iframe today), so this is defense-in-depth
    // for self-hosted deploys should Clerk reintroduce a handshake iframe — and it
    // keeps the docker surface from silently drifting from the hosted one.
    const nginxCsp = getNginxHeaderValue('Content-Security-Policy');
    assert.ok(nginxCsp, 'nginx-security-headers.conf must have a Content-Security-Policy header');
    const frameSrc = nginxCsp.match(/frame-src\s+([^;]+)/)?.[1] ?? '';
    assert.ok(
      frameSrc.includes('clerk.accounts.dev') || frameSrc.includes('clerk.worldmonitor.app'),
      'docker/nginx CSP frame-src must include Clerk origin for the self-hosted sign-in modal'
    );
  });

  it('CSP frame directives include every variant hostname', () => {
    const variantHosts = VARIANT_HOSTS;
    const headerCsp = getHeaderValue('Content-Security-Policy');
    const liteHtml = readFileSync(resolve(__dirname, '../lite.html'), 'utf-8');
    assert.equal(hasCspMeta(liteHtml), false, 'lite.html must not ship a CSP meta tag');
    const nginxCsp = getNginxHeaderValue('Content-Security-Policy');
    assert.ok(nginxCsp, 'nginx-security-headers.conf must have a Content-Security-Policy header');

    const surfaces = [
      ['vercel frame-src', getCspDirectiveTokens(headerCsp, 'frame-src')],
      ['vercel frame-ancestors', getCspDirectiveTokens(headerCsp, 'frame-ancestors')],
      ['nginx frame-src', getCspDirectiveTokens(nginxCsp, 'frame-src')],
      ['nginx frame-ancestors', getCspDirectiveTokens(nginxCsp, 'frame-ancestors')],
    ];

    for (const [label, tokens] of surfaces) {
      const missing = variantHosts.filter((host) => !tokens.includes(`https://${host}`));
      assert.deepEqual(
        missing,
        [],
        `${label} is missing variant host(s): ${missing.join(', ')}`
      );
    }
  });

  it('CSP framing rejects unrelated Vercel projects while preserving same-origin previews and the toolbar', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    for (const directive of ['frame-src', 'frame-ancestors']) {
      const tokens = getCspDirectiveTokens(csp, directive);
      assert.ok(tokens.includes("'self'"), `${directive} must allow same-origin preview frames`);
      assert.ok(tokens.some((token) => token === 'https://vercel.live'), `${directive} must allow the Vercel toolbar`);
      assert.ok(!tokens.includes('https://*.vercel.app'), `${directive} must not trust every Vercel team`);
    }
    assert.deepEqual(findOpenFrameSources(getCspDirectiveTokens(csp, 'frame-ancestors')), []);
  });

  // Per-file assertions, so the built /pro pages drop out of the population
  // rather than taking the five committed files down with them (#6898).
  it('HTML entry script tags carry the nonce trusted by the header CSP', () => {
    const liteHtml = readFileSync(resolve(__dirname, '../lite.html'), 'utf-8');
    const headerCsp = getHeaderValue('Content-Security-Policy');
    assert.equal(hasCspMeta(liteHtml), false, 'lite.html must not ship a CSP meta tag');
    assert.ok(
      getCspDirectiveTokens(headerCsp, 'script-src').includes(`'nonce-${STATIC_SCRIPT_NONCE}'`),
      'header script-src must trust the static entry-script nonce'
    );
    assert.match(
      viteConfigSource,
      /cspNonce:\s*STATIC_SCRIPT_NONCE/,
      'Vite must stamp emitted HTML entry scripts with the nonce trusted by the header CSP'
    );

    const externalScriptFiles = GLOBAL_CSP_EXTERNAL_SCRIPT_HTML_FILES;
    assert.ok(
      externalScriptFiles.length > 0,
      'external-script HTML population is empty — this guard would pass vacuously',
    );
    for (const file of externalScriptFiles) {
      const html = readFileSync(resolve(__dirname, '..', file), 'utf-8');
      assert.equal(hasCspMeta(html), false, `${file} must not ship a CSP meta tag`);
      const scriptTags = getExternalScriptTags(html);
      assert.ok(scriptTags.length > 0, `${file} must have at least one external entry script`);
      const missingNonce = scriptTags.filter((tag) => !new RegExp(`\\bnonce=["']${STATIC_SCRIPT_NONCE}["']`).test(tag));
      assert.deepEqual(
        missingNonce,
        [],
        `${file} has parser-inserted external scripts without the CSP nonce`
      );
    }
  });

  it('CSP script-src is in sync between vercel.json header and docker/nginx-security-headers.conf', () => {
    const headerCsp = getHeaderValue('Content-Security-Policy');
    const nginxCsp = getNginxHeaderValue('Content-Security-Policy');
    assert.ok(nginxCsp, 'nginx-security-headers.conf must have a Content-Security-Policy header');

    const headerTokens = getCspDirectiveTokens(headerCsp, 'script-src');
    const nginxTokens = getCspDirectiveTokens(nginxCsp, 'script-src');

    const onlyHeader = headerTokens.filter((token) => !nginxTokens.includes(token));
    const onlyNginx = nginxTokens.filter((token) => !headerTokens.includes(token));

    assert.deepEqual(onlyHeader, [],
      `script-src tokens in vercel.json but missing from nginx-security-headers.conf: ${onlyHeader.join(', ')}. ` +
      'Self-hosted docker users must have the same CSP parity.');
    assert.deepEqual(onlyNginx, [],
      `script-src tokens in nginx-security-headers.conf but missing from vercel.json: ${onlyNginx.join(', ')}. ` +
      'Self-hosted docker users must have the same CSP parity.');

    const nginxScriptSrc = nginxCsp.match(/script-src\s+([^;]+)/)?.[1] ?? '';
    assert.ok(!nginxScriptSrc.includes("'unsafe-inline'"), "nginx script-src must not contain 'unsafe-inline' to maintain CSP parity with Vercel.");
  });

  it('CSP payment frame and form directives stay in sync between Vercel and docker/nginx', () => {
    const headerCsp = getHeaderValue('Content-Security-Policy');
    const nginxCsp = getNginxHeaderValue('Content-Security-Policy');
    assert.ok(nginxCsp, 'nginx-security-headers.conf must have a Content-Security-Policy header');

    for (const directive of ['frame-src', 'form-action']) {
      const headerTokens = getCspDirectiveTokens(headerCsp, directive);
      const nginxTokens = getCspDirectiveTokens(nginxCsp, directive);
      const onlyHeader = headerTokens.filter((token) => !nginxTokens.includes(token));
      const onlyNginx = nginxTokens.filter((token) => !headerTokens.includes(token));

      assert.deepEqual(onlyHeader, [],
        `${directive} tokens in vercel.json but missing from nginx-security-headers.conf: ${onlyHeader.join(', ')}. ` +
        'Payment/auth iframe and form targets must stay deploy-surface identical.');
      assert.deepEqual(onlyNginx, [],
        `${directive} tokens in nginx-security-headers.conf but missing from vercel.json: ${onlyNginx.join(', ')}. ` +
        'Payment/auth iframe and form targets must stay deploy-surface identical.');
    }
  });

  it('CSP frame-src stays a bounded host allowlist (load-bearing for a Sentry suppression rule)', () => {
    // `shouldSuppressCspViolation` in src/main.ts discards frame-src violation
    // reports for `div.show` on the argument that frame-src enumerates every
    // host we embed, so a host we never reference can only have been injected
    // from outside. That argument holds only while the directive stays a closed
    // allowlist -- adding a scheme-wide or wildcard source would make foreign
    // frames legal, and the suppression would then be hiding a real policy
    // change rather than third-party noise. The existing frame-src tests pin
    // that Clerk is PRESENT and that the deploy surfaces agree; neither would
    // fail on a widening, so this pins the property the suppression depends on.
    for (const [label, csp] of [
      ['vercel.json', getHeaderValue('Content-Security-Policy')],
      ['docker/nginx', getNginxHeaderValue('Content-Security-Policy')],
    ]) {
      assert.ok(csp, `${label} must have a Content-Security-Policy header`);
      const tokens = getCspDirectiveTokens(csp, 'frame-src');
      assert.ok(tokens.length > 0, `${label} must declare an explicit frame-src`);
      const open = findOpenFrameSources(tokens);
      assert.deepEqual(open, [],
        `${label} frame-src must stay a bounded host allowlist; found open source(s): ${open.join(', ')}. ` +
        'The div.show suppression in src/main.ts assumes any non-allowlisted frame is third-party injection.');
    }
  });

  it('the frame-src allowlist guard actually fires on a widening', () => {
    // The first version of this guard tested `token.startsWith('*.')`, which can
    // never match: getCspDirectiveTokens returns tokens WITH their scheme
    // (`https://*.vercel.app`). It therefore passed while dead. Drive the
    // predicate directly against widenings written the way they'd really appear.
    for (const widened of [
      'https://*.vercel.app', // arbitrary projects on other Vercel teams
      'https://*.evil.com',   // a new vendor wildcard
      'https://*',            // scheme-wide with a wildcard host
      'http://*.evil.com',
      '*',
      'https:',
      '*.evil.com',           // scheme-less
    ]) {
      assert.deepEqual(findOpenFrameSources([widened]), [widened],
        `guard must flag ${widened} as an open frame-src source`);
    }
    // ...and must stay quiet on the bounded sources the policy legitimately has.
    assert.deepEqual(
      findOpenFrameSources(["'self'", 'https://www.worldmonitor.app', ...KNOWN_FRAME_WILDCARDS]),
      []
    );
  });

  it('security.txt exists in public/.well-known/', () => {
    const secTxt = readFileSync(resolve(__dirname, '../public/.well-known/security.txt'), 'utf-8');
    assert.match(secTxt, /^Contact:/m, 'security.txt must have a Contact field');
    assert.match(secTxt, /^Expires:/m, 'security.txt must have an Expires field');
  });

  it('security.txt points GitHub disclosures at the repository SECURITY.md names', () => {
    const secTxt = readFileSync(resolve(__dirname, '../public/.well-known/security.txt'), 'utf-8');
    const securityMd = readFileSync(resolve(__dirname, '../SECURITY.md'), 'utf-8');
    const policyRepo = securityMd.match(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/security\/advisories\/new/)?.[1];
    assert.ok(policyRepo, 'SECURITY.md must link the private vulnerability reporting form');

    const githubUrls = [...secTxt.matchAll(/https:\/\/github\.com\/[^\s]+/g)].map(([url]) => url);
    assert.ok(githubUrls.length > 0, 'security.txt must offer a GitHub disclosure channel');
    for (const url of githubUrls) {
      assert.ok(url.startsWith(`https://github.com/${policyRepo}/`), `${url} must name ${policyRepo}`);
    }
    assert.match(secTxt, new RegExp(`^Contact: https://github\\.com/${policyRepo}/security/advisories/new$`, 'm'));
    assert.match(secTxt, new RegExp(`^Policy: https://github\\.com/${policyRepo}/security/policy$`, 'm'));
  });
});

describe('embeddable map route guardrails', () => {
  it('keeps /embed and /embed.html off the dashboard document and the SPA cache header', () => {
    // #6575: no dashboard-serving rewrite may match the public embed entry.
    for (const path of ['/embed', '/embed.html']) {
      const shadow = vercelConfig.rewrites.find((r) =>
        r.destination === APP_SHELL_HTML_DESTINATION && sourceToRegExp(r.source).test(path)
      );
      assert.equal(shadow, undefined, path + ' must serve the public embed entry, not the app shell');
    }
    assert.ok(SPA_HTML_CACHE_SOURCE.includes('|embed|embed\\.html|'), 'HTML cache catch-all must keep excluding the public embed entry');
    assert.equal(getCacheHeaderValue(SPA_HTML_CACHE_SOURCE), 'private, no-cache, must-revalidate');
  });

  it('no vercel.json rule re-enables shared caching of /api/geo', () => {
    // /api/geo's body IS the caller's IP-geo, so it ships `Cache-Control: no-store`
    // (api/geo.js) and tests/geo-per-visitor-cache.test.mts pins that. But a
    // vercel.json header rule is ADDITIVE and outranks the handler at the CDN --
    // Vercel reads Vercel-CDN-Cache-Control > CDN-Cache-Control > Cache-Control --
    // so adding a cache directive to the existing `/api/(.*)` block would make the
    // per-visitor body shared-cacheable again while the handler-level test stays
    // green. This is the half of that guard the handler test cannot see.
    // Judge the VALUE, not just the header name: a deployment rule that sets
    // `Vercel-CDN-Cache-Control: no-store` reinforces the endpoint's contract and
    // must not fail CI. Only a value a shared cache may actually store is an
    // offender. Shares one predicate with the handler-level guard so the two
    // cannot drift apart.
    const offenders = [];
    for (const rule of vercelConfig.headers) {
      if (!sourceToRegExp(rule.source).test('/api/geo')) continue;
      for (const header of rule.headers ?? []) {
        if (!CACHE_POLICY_HEADER_NAME.test(header.key)) continue;
        if (isSharedCacheable(header.value)) {
          offenders.push(`${rule.source} -> ${header.key}: ${header.value}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'a vercel.json rule sets a cache-policy header on /api/geo, overriding the handler no-store at the CDN',
    );
  });

  it('the /api/geo cache guard judges header values, not just header names', () => {
    // Control for the guard above, both directions. A deployment rule that pins a
    // non-storable policy REINFORCES the endpoint's contract and must not be
    // reported; only a storable value is an offender.
    assert.equal(isSharedCacheable('no-store'), false, 'a no-store deployment rule must not be flagged');
    assert.equal(isSharedCacheable('private, max-age=300'), false);
    assert.equal(isSharedCacheable('public, s-maxage=3600'), true);
    assert.equal(isSharedCacheable('max-age=300'), true, 'bare max-age is still shared-storable');
    assert.ok(CACHE_POLICY_HEADER_NAME.test('Vercel-CDN-Cache-Control'));
    assert.ok(CACHE_POLICY_HEADER_NAME.test('Cloudflare-CDN-Cache-Control'));
    assert.equal(CACHE_POLICY_HEADER_NAME.test('RateLimit-Limit'), false);
  });

  it('the /api/geo cache guard is wired to a rule source that really matches it', () => {
    // Positive control for the guard above: prove sourceToRegExp actually matches
    // /api/geo against a real rule in the file. Without this, a change to the
    // matcher (or a renamed route) would make the guard vacuous -- it would scan
    // zero rules and pass forever.
    const matching = vercelConfig.headers.filter((rule) => sourceToRegExp(rule.source).test('/api/geo'));
    assert.ok(
      matching.some((rule) => rule.source === '/api/(.*)'),
      'expected the /api/(.*) header rule to match /api/geo; the cache guard above scans nothing if it does not',
    );
  });

  it('keeps the global security header anti-framing rule off the embed entries', () => {
    // Both /embed (partner iframe) and /wm-widget-sandbox.html (agent widget
    // sandbox) need cross-origin framing + their own dedicated CSP; the
    // global SAMEORIGIN/dashboard-CSP rule must skip both.
    assert.equal(GLOBAL_SECURITY_HEADER_SOURCE, '/((?!docs|embed|embed\\.html|wm-widget-sandbox\\.html).*)');
    const globalXfo = getHeaderValueForSource(GLOBAL_SECURITY_HEADER_SOURCE, 'X-Frame-Options');
    assert.equal(globalXfo, 'SAMEORIGIN');
  });

  it('/wm-widget-sandbox.html keeps its dedicated headers instead of inheriting app XFO/CSP', () => {
    const source = '/wm-widget-sandbox.html';
    assert.equal(
      sourceToRegExp(GLOBAL_SECURITY_HEADER_SOURCE).test(source),
      false,
      `${source} must not match the global security-header rule`,
    );
    assert.equal(getHeaderValueForSource(source, 'X-Frame-Options'), null);
    const csp = getHeaderValueForSource(source, 'Content-Security-Policy') ?? '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /(?:^|;\s*)sandbox allow-scripts(?:;|$)/, 'sandbox response must retain script execution in an opaque origin');
    assert.equal(
      getHeaderValueForSource(source, 'Cache-Control'),
      'public, max-age=0, must-revalidate',
      'unversioned sandbox policy documents must revalidate on every request',
    );
  });

  for (const source of ['/embed', '/embed.html']) {
    it(`${source} allows cross-origin iframe embedding without inheriting app XFO`, () => {
      const headers = getHeadersForSource(source);
      assert.ok(headers.length > 0, `${source} must have an explicit header rule`);
      assert.equal(getHeaderValueForSource(source, 'X-Frame-Options'), null);
      assert.equal(getHeaderValueForSource(source, 'Cache-Control'), 'private, no-cache, must-revalidate');
      const csp = getHeaderValueForSource(source, 'Content-Security-Policy');
      const permissionsPolicy = getHeaderValueForSource(source, 'Permissions-Policy');
      assert.ok(csp, `${source} must have a CSP`);
      assert.ok(permissionsPolicy?.includes('tools=()'), `${source} must explicitly deny WebMCP tools`);
      assert.ok(!permissionsPolicy?.includes('tools=(self)'), `${source} must not expose same-origin WebMCP tools`);
      assert.match(csp, /frame-ancestors \*/);
      assert.match(csp, /script-src 'self'(?:;|$)/);
      assert.doesNotMatch(csp, /clerk|dodopayments|stripe/);
      assert.ok(!getCspDirectiveTokens(csp, 'script-src').includes("'unsafe-inline'"));
    });
  }

  it('keeps Docker embed routes on the locked-down embed security headers', () => {
    const nginxTemplate = readFileSync(resolve(__dirname, '../docker/nginx.conf.template'), 'utf-8');
    assert.match(nginxTemplate, /location = \/embed \{[\s\S]*?include \/etc\/nginx\/embed_security_headers\.conf;/);
    assert.match(nginxTemplate, /location = \/embed\.html \{[\s\S]*?include \/etc\/nginx\/embed_security_headers\.conf;/);
    assert.match(frontendDockerfileSource, /COPY docker\/nginx-embed-security-headers\.conf \/etc\/nginx\/embed_security_headers\.conf/);
    assert.match(dockerNginxSource, /location = \/embed \{[\s\S]*?add_header Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\), accelerometer=\(\)/);
    assert.match(dockerNginxSource, /location = \/embed\.html \{[\s\S]*?add_header Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\), accelerometer=\(\)/);

    const lockedPolicy = getHeaderValueForSource('/embed', 'Permissions-Policy');
    const dockerLockedPolicy = getNginxHeaderValueFrom('docker/nginx-embed-security-headers.conf', 'Permissions-Policy');
    assert.equal(dockerLockedPolicy, lockedPolicy, 'Docker embed Permissions-Policy must match Vercel embed policy');
    for (const directive of [
      'accelerometer=()',
      'bluetooth=()',
      'gyroscope=()',
      'magnetometer=()',
      'picture-in-picture=()',
      'payment=()',
      'tools=()',
    ]) {
      assert.ok(dockerLockedPolicy.includes(directive), `Docker embed policy must keep ${directive}`);
    }

    const dockerEmbedCsp = getNginxHeaderValueFrom('docker/nginx-embed-security-headers.conf', 'Content-Security-Policy');
    assert.equal(dockerEmbedCsp, getHeaderValueForSource('/embed', 'Content-Security-Policy'));
  });

  it('serves /embed.js as a cross-origin loader without iframe CSP', () => {
    assert.equal(getHeaderValueForSource('/embed.js', 'Access-Control-Allow-Origin'), '*');
    assert.equal(getHeaderValueForSource('/embed.js', 'Cache-Control'), 'public, max-age=3600');
    assert.equal(getHeaderValueForSource('/embed.js', 'Cross-Origin-Resource-Policy'), 'cross-origin');
    assert.equal(getHeaderValueForSource('/embed.js', 'Content-Security-Policy'), null);
    assert.equal(getHeaderValueForSource('/embed.js', 'X-Frame-Options'), null);

    const nginxTemplate = readFileSync(resolve(__dirname, '../docker/nginx.conf.template'), 'utf-8');
    assert.match(nginxTemplate, /location = \/embed\.js \{[\s\S]*?Access-Control-Allow-Origin "\*"/);
    assert.match(dockerNginxSource, /location = \/embed\.js \{[\s\S]*?Access-Control-Allow-Origin "\*"/);
    assert.doesNotMatch(
      dockerNginxSource.match(/location = \/embed\.js \{[\s\S]*?\n {4}\}/)?.[0] ?? '',
      /frame-ancestors/,
    );
  });

  it('self-hosted docker/nginx.conf SPA fallback ships the full dashboard CSP', () => {
    // Image A (root Dockerfile -> docker/nginx.conf, nginx + Node API under
    // supervisord) inlines headers per location instead of including
    // security_headers.conf. The SPA fallback (location /) must still carry the
    // dashboard CSP, or the containerized dashboard runs CSP-less while /embed
    // stays locked down.
    const canonicalCsp = getNginxHeaderValue('Content-Security-Policy');
    assert.ok(canonicalCsp, 'docker/nginx-security-headers.conf must define a dashboard CSP');

    const block = dockerNginxSource.match(/\n {4}location \/ \{\n([\s\S]*?)\n {4}\}/);
    assert.ok(block, 'docker/nginx.conf must define a location / block');
    const cspLine = block[1]
      .split('\n')
      .find((line) => /add_header Content-Security-Policy "/.test(line));
    assert.ok(cspLine, 'docker/nginx.conf location / must ship a Content-Security-Policy header');
    const value = cspLine.match(/add_header Content-Security-Policy "(.*)" always;/)?.[1];
    assert.ok(value, 'could not extract CSP value from docker/nginx.conf location / Content-Security-Policy line');
    assert.equal(
      value,
      canonicalCsp,
      'docker/nginx.conf location / CSP must match docker/nginx-security-headers.conf (and thus vercel.json)',
    );
  });
});

describe('self-hosted docker nginx SPA entry', () => {
  it('both nginx confs redirect / and the old dashboard routes to /lite and 404 unknown paths', () => {
    // dist/ ships lite.html as the only app shell and no root index.html, so
    // BOTH self-hosted images must send / to /lite and serve lite.html for the
    // Lite routes:
    //   root Dockerfile   -> docker/nginx.conf          (docker-compose stack)
    //   docker/Dockerfile -> docker/nginx.conf.template (published ghcr image)
    for (const conf of ['docker/nginx.conf', 'docker/nginx.conf.template']) {
      const src = readFileSync(resolve(__dirname, `../${conf}`), 'utf-8');
      assert.match(src, /^ {4}index index\.html;$/m, `${conf}: index directive must serve corpus index.html only`);
      assert.match(src, /^ {4}location = \/ \{ return 302 \/lite; \}$/m, `${conf}: / must redirect to /lite`);
      assert.match(
        src,
        /^ {4}location ~ \^\/\(\?:dashboard\|story\|stocks\(\?:\/\[\^\/\]\+\)\?\)\/\?\$ \{ return 302 \/lite; \}$/m,
        `${conf}: the old dashboard routes must redirect to /lite`,
      );
      assert.match(
        src,
        /^ {4}rewrite \^\/lite\(\?:\/\(\?:geopolitics\|finance\|tech\|sources\)\)\?\/\?\$ \/lite\.html last;$/m,
        `${conf}: /lite and its screens must serve lite.html`,
      );
      assert.match(src, /try_files \$uri \$uri\/ \$uri\/index\.html =404;/, `${conf}: unknown paths must 404 after corpus index.html`);
      assert.doesNotMatch(src, /dashboard\.html/, `${conf}: must not reference the deleted dashboard.html`);
      assert.doesNotMatch(src, /try_files \$uri \$uri\/ \/index\.html;/, `${conf}: must not keep the broken /index.html SPA fallback`);
    }
  });
});

// Agent readiness: RFC 9727 API catalog at /.well-known/api-catalog and
// the build-time copy of the OpenAPI spec from docs/api/ into public/.
// These guardrails protect against:
//   (1) the status endpoint href drifting away from /api/health (the
//       real JSON endpoint; the apex /health serves the SPA HTML);
//   (2) variant build scripts dropping the `npm run build:openapi`
//       prefix and silently shipping web bundles without the spec;
//   (3) the openapi source under docs/ being deleted without a
//       matching removal of the build step;
//   (4) linkset[0] losing its RFC 9727 `item` enumeration (agent
//       crawlers read the catalog anchor's item links to find every API).
describe('agent readiness: api-catalog + openapi build', () => {
  const apiCatalog = JSON.parse(
    readFileSync(resolve(__dirname, '../public/.well-known/api-catalog'), 'utf-8')
  );
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

  const catalogEntry = apiCatalog.linkset[0];
  const apiEntry = apiCatalog.linkset.find((entry) => entry.anchor === 'https://api.worldmonitor.app/');

  it('linkset[0] is the catalog anchor and enumerates each API via RFC 9727 item links', () => {
    assert.equal(catalogEntry.anchor, 'https://worldmonitor.app/.well-known/api-catalog');
    assert.ok(Array.isArray(catalogEntry.item), 'linkset[0] must carry an "item" array (RFC 9727 §4)');
    assert.ok(catalogEntry.item.length > 0, 'linkset[0].item must enumerate at least one API');
    // Each item MUST resolve to a linkset context object that describes that API.
    const anchors = new Set(apiCatalog.linkset.map((entry) => entry.anchor));
    for (const item of catalogEntry.item) {
      assert.ok(item.href, 'each item entry must carry an href');
      assert.ok(
        anchors.has(item.href),
        `item href ${item.href} must match a linkset context anchor`
      );
    }
    const itemHrefs = catalogEntry.item.map((i) => i.href);
    assert.ok(itemHrefs.includes('https://api.worldmonitor.app/'), 'item list must enumerate the REST API host root');
    assert.ok(itemHrefs.includes('https://worldmonitor.app/mcp'), 'item list must enumerate the MCP server');
    assert.ok(
      itemHrefs.includes('https://www.worldmonitor.app/docs/mcp'),
      'item list must enumerate the docs MCP server (#4958 — it ran unadvertised for weeks)'
    );
  });

  // #4958 — Mintlify serves a working docs MCP server (search/retrieval over
  // the documentation) at /docs/mcp; it existed for weeks with zero
  // advertisement anywhere. Every agent-facing discovery surface must name it
  // so multi-surface MCP coverage is discoverable.
  it('advertises the docs MCP server on every discovery surface', () => {
    const docsMcpUrl = 'https://www.worldmonitor.app/docs/mcp';
    for (const surface of ['llms.txt', 'agents.md', 'api/llms.txt']) {
      const content = readFileSync(resolve(__dirname, `../public/${surface}`), 'utf-8');
      assert.ok(content.includes(docsMcpUrl), `public/${surface} must advertise the docs MCP server`);
    }
  });

  it('the docs MCP anchor describes itself with the first-party server-card (service-desc parity with product MCP)', () => {
    const docsAnchor = apiCatalog.linkset.find((e) => e.anchor === 'https://www.worldmonitor.app/docs/mcp');
    assert.ok(docsAnchor, 'api-catalog must carry a context object anchored at the docs MCP endpoint');
    const desc = docsAnchor['service-desc'] ?? [];
    // Must be the first-party card, NOT Mintlify's card (whose url 404s) — #4964 review.
    assert.ok(
      desc.some((d) => d.href === 'https://www.worldmonitor.app/.well-known/mcp/docs-server-card.json'),
      'docs MCP anchor must advertise the first-party server-card as service-desc'
    );
    assert.ok(
      !desc.some((d) => /\/docs\/\.well-known\/mcp\/server-card\.json/.test(d.href)),
      'docs MCP anchor must NOT advertise Mintlify\'s card (its url points at a dead mintlify.dev endpoint)'
    );
  });

  it('the first-party docs server-card advertises the working /docs/mcp endpoint, not the dead mintlify url', () => {
    // The whole point of #4964's fix: a card-following agent must land on an
    // endpoint that actually initializes. worldmonitor.mintlify.dev/mcp 404s;
    // www.worldmonitor.app/docs/mcp returns 200. The committed card must carry
    // the working facade URL and must not smuggle the mintlify.dev host.
    const card = JSON.parse(
      readFileSync(resolve(__dirname, '../public/.well-known/mcp/docs-server-card.json'), 'utf-8')
    );
    const WORKING = 'https://www.worldmonitor.app/docs/mcp';
    assert.equal(card.url, WORKING, 'docs card url must be the working /docs/mcp facade');
    assert.equal(card.serverUrl, WORKING, 'docs card serverUrl must be the working /docs/mcp facade');
    assert.ok(
      !JSON.stringify({ url: card.url, serverUrl: card.serverUrl }).includes('mintlify.dev'),
      'docs card endpoint fields must not point at the dead mintlify.dev host'
    );
    assert.deepEqual(card.remotes, [{ type: 'streamable-http', url: WORKING }], 'docs card remotes[].url must name the facade');
    // Under the v1 $schema the live tools/list is authoritative; the docs
    // server is anonymous, so a copied tools[] only goes stale.
    assert.equal(card.tools, undefined, 'docs card must not carry tools[]');
  });

  it('publishes the docs server card where card-following scanners look', () => {
    // orank resolves a card per MCP server from ai-catalog.json entries or
    // <server URL>/server-card, matched on remotes[].url. The Link header
    // alone left the docs server without a card.
    const catalog = JSON.parse(readFileSync(resolve(__dirname, '../public/.well-known/ai-catalog.json'), 'utf-8'));
    const docsEntry = catalog.entries.find((e) => e.url === 'https://www.worldmonitor.app/.well-known/mcp/docs-server-card.json');
    assert.ok(docsEntry, 'ai-catalog must list the docs MCP server card');
    assert.equal(docsEntry.type, 'application/mcp-server-card+json');

    const rewrites = vercelConfig.rewrites;
    const cardIdx = rewrites.findIndex((r) => r.source === '/docs/mcp/server-card');
    const mintlifyIdx = rewrites.findIndex((r) => r.source === '/docs/:match*');
    assert.ok(cardIdx >= 0, 'missing /docs/mcp/server-card rewrite');
    assert.equal(rewrites[cardIdx].destination, '/.well-known/mcp/docs-server-card.json');
    assert.ok(cardIdx < mintlifyIdx, '/docs/mcp/server-card must precede the Mintlify /docs proxy');
    assert.equal(getHeaderValueForSource('/docs/mcp/server-card', 'Content-Type'), 'application/json; charset=utf-8');
    assert.equal(getHeaderValueForSource('/docs/mcp/server-card', 'Access-Control-Allow-Origin'), '*');
  });

  it('the api host root has its own context object', () => {
    assert.ok(apiEntry, 'linkset must contain a context object anchored at https://api.worldmonitor.app/');
  });

  it('status href points at the KEYLESS compact form of /api/health', () => {
    // Two drift classes guarded here:
    //   (1) the SPA lives at /health — a bare-host href would 200 HTML and
    //       look healthy;
    //   (2) #4715 gated detailed /api/health behind an operator key, so the
    //       bare endpoint 401s keyless callers. An advertised status URL must
    //       return 2xx WITHOUT credentials — that is ?compact=1 (#4856; an
    //       agent-journey run read the stale bare-URL advertisement, got 401,
    //       and flagged the whole status surface as broken).
    const statusHref = apiEntry.status[0].href;
    assert.ok(
      statusHref.startsWith('https://api.worldmonitor.app'),
      `status href must be on api.worldmonitor.app, got: ${statusHref}`
    );
    assert.equal(
      statusHref,
      'https://api.worldmonitor.app/api/health?compact=1',
      'status href must be the keyless compact health form'
    );
  });

  it('every vercel.json Link rel="status" advertisement uses the keyless compact form', () => {
    // Same #4715→#4856 drift class as above, for the Link-header copies: an
    // auth-gating change on /api/health must not silently strand the
    // machine-readable status advertisements on a URL that 401s keyless.
    const vercelRaw = readFileSync(resolve(__dirname, '../vercel.json'), 'utf-8');
    const statusLinks = vercelRaw.match(/<[^>]*>;\s*rel=\\"status\\"/g) ?? [];
    assert.ok(statusLinks.length > 0, 'expected at least one Link rel="status" advertisement in vercel.json');
    for (const link of statusLinks) {
      assert.ok(
        link.startsWith('</api/health?compact=1>'),
        `Link rel="status" must point at /api/health?compact=1 (keyless), got: ${link}`
      );
    }
  });

  it('service-meta advertises the machine-readable pricing + support surfaces', () => {
    // Pricing/support were previously discoverable ONLY via llms.txt; agents
    // entering through the Link-header → api-catalog chain never saw them and
    // fell back to slug-guessing (#4854, #4857). RFC 9727 allows arbitrary
    // link relations on a context object; service-meta is the metadata slot.
    const meta = apiEntry['service-meta'];
    assert.ok(Array.isArray(meta) && meta.length > 0, 'api context must carry service-meta entries');
    const hrefs = meta.map((entry) => entry.href);
    // www, not apex: neither path is on the Cloudflare apex-exemption list, so
    // the apex form is a 301 an agent pays for before reaching the file (#7660).
    assert.ok(hrefs.includes('https://www.worldmonitor.app/pricing.md'), 'service-meta must advertise pricing.md');
    assert.ok(
      hrefs.includes('https://www.worldmonitor.app/api/product-catalog'),
      'service-meta must advertise the live product-catalog JSON endpoint'
    );
    assert.ok(hrefs.includes('https://www.worldmonitor.app/support.md'), 'service-meta must advertise support.md');
    assert.ok(hrefs.includes('https://www.worldmonitor.app/agents.md'), 'service-meta must advertise agents.md (#4952)');
    assert.ok(hrefs.includes('https://www.worldmonitor.app/world-monitor.md'), 'service-meta must advertise world-monitor.md');
    assert.ok(hrefs.includes('https://www.worldmonitor.app/api-versioning.md'), 'service-meta must advertise api-versioning.md');
    assert.ok(hrefs.includes('https://www.worldmonitor.app/plugin.json'), 'service-meta must advertise /plugin.json');
    // The Commerce spec lives outside the root openapi bundle (size budget,
    // #4853) — without this link no advertised descriptor reaches it
    // (post-#4867 review finding); Mintlify serves the raw YAML at this URL.
    const commerceSpec = meta.find(
      (entry) => entry.href === 'https://www.worldmonitor.app/docs/openapi/CommerceService.openapi.yaml'
    );
    assert.ok(commerceSpec, 'service-meta must link the Commerce OpenAPI spec');
    assert.equal(commerceSpec.type, 'application/vnd.oai.openapi');
  });

  it('service-desc points at /openapi.yaml with the OpenAPI media type', () => {
    const serviceDesc = apiEntry['service-desc'][0];
    assert.ok(
      serviceDesc.href.endsWith('/openapi.yaml'),
      `service-desc href must end with /openapi.yaml, got: ${serviceDesc.href}`
    );
    assert.equal(serviceDesc.type, 'application/vnd.oai.openapi');
  });

  it('also advertises a JSON service-desc at /openapi.json for JSON-only parsers', () => {
    // Some agent-readiness scanners (ora.ai / orank) run the spec straight
    // through a JSON parser; YAML input trips them ("found but failed to
    // parse"). The JSON mirror is a second service-desc so those scanners
    // have a parseable spec. YAML stays at [0] (human-readable canonical).
    // Read from apiEntry (the api.worldmonitor.app context object), not
    // linkset[0] — since #4691 added the RFC 9727 catalog anchor, linkset[0]
    // is the catalog itself (item enumeration, no service-desc). The sibling
    // /openapi.yaml assertion above already uses apiEntry for the same reason.
    const jsonDesc = apiEntry['service-desc'][1];
    assert.ok(jsonDesc, 'api anchor must have a second service-desc entry (JSON mirror)');
    assert.ok(
      jsonDesc.href.endsWith('/openapi.json'),
      `second service-desc href must end with /openapi.json, got: ${jsonDesc.href}`
    );
    assert.equal(jsonDesc.type, 'application/json');
  });

  it('has a second anchor for the MCP server-card', () => {
    const mcpEntry = apiCatalog.linkset.find((entry) => entry.anchor === 'https://worldmonitor.app/mcp');
    assert.ok(mcpEntry, 'linkset must contain an anchor for https://worldmonitor.app/mcp');
    const mcpServiceDesc = mcpEntry['service-desc']?.[0];
    assert.ok(mcpServiceDesc, 'mcp anchor must have a service-desc entry');
    assert.ok(
      mcpServiceDesc.href.endsWith('/.well-known/mcp/server-card.json'),
      `mcp service-desc href must end with /.well-known/mcp/server-card.json, got: ${mcpServiceDesc.href}`
    );
  });

  it('exposes a build:openapi script that copies docs/api → public/openapi.yaml AND emits public/openapi.json', () => {
    const buildOpenapi = pkg.scripts['build:openapi'];
    assert.ok(buildOpenapi, 'package.json must define scripts["build:openapi"]');
    assert.ok(
      buildOpenapi.includes('docs/api/worldmonitor.openapi.yaml'),
      `build:openapi must reference docs/api/worldmonitor.openapi.yaml, got: ${buildOpenapi}`
    );
    assert.ok(
      buildOpenapi.includes('public/openapi.yaml'),
      `build:openapi must write to public/openapi.yaml, got: ${buildOpenapi}`
    );
    // The JSON mirror (served at /openapi.json for JSON-only scanners) is
    // generated by scripts/build-openapi-json.mjs in the same step.
    assert.ok(
      buildOpenapi.includes('build-openapi-json.mjs'),
      `build:openapi must run scripts/build-openapi-json.mjs to emit public/openapi.json, got: ${buildOpenapi}`
    );
    assert.ok(
      existsSync(resolve(__dirname, '../scripts/build-openapi-json.mjs')),
      'scripts/build-openapi-json.mjs must exist'
    );
  });

  it('no dashboard-serving rewrite can shadow the static /openapi.json spec', () => {
    // #6575: the SPA catch-all is gone, so /openapi.json resolves as a static
    // file by default. Guard that no dashboard rewrite ever matches it again
    // and that the pinned HTML-cache exclusion stays in place.
    const shadow = vercelConfig.rewrites.find((r) =>
      r.destination === APP_SHELL_HTML_DESTINATION && sourceToRegExp(r.source).test('/openapi.json')
    );
    assert.equal(shadow, undefined, '/openapi.json must serve the static spec, not the app shell');
    assert.ok(
      SPA_HTML_CACHE_SOURCE.includes('openapi'),
      'HTML cache catch-all must keep excluding openapi.json'
    );
  });

  it('no dashboard-serving rewrite can shadow the static /plugin.json Agent Plugin manifest', () => {
    const shadow = vercelConfig.rewrites.find((r) =>
      r.destination === APP_SHELL_HTML_DESTINATION && sourceToRegExp(r.source).test('/plugin.json')
    );
    assert.equal(shadow, undefined, '/plugin.json must serve the static manifest, not the app shell');
    assert.ok(
      SPA_HTML_CACHE_SOURCE.includes('plugin\\.json'),
      'HTML cache catch-all must keep excluding plugin.json'
    );
    assert.equal(getHeaderValueForSource('/plugin.json', 'Content-Type'), 'application/json; charset=utf-8');
    assert.equal(getHeaderValueForSource('/plugin.json', 'Access-Control-Allow-Origin'), '*');
    assert.equal(effectiveCacheControl('/plugin.json'), 'public, max-age=3600');
  });

  it('runs no npm prebuild hooks: the build scripts are the whole build', () => {
    // The Lite build dropped the variant builds and their prebuild hooks
    // (product facts, agent-skills index). The build chains build:openapi
    // explicitly (a copy of the committed spec into public/), never the frozen
    // product-facts generator, and nothing fires as a hidden hook.
    assert.deepEqual(Object.keys(pkg.scripts).filter((name) => name.startsWith('prebuild')), []);
    for (const name of ['build', 'build:full']) {
      assert.doesNotMatch(pkg.scripts[name], /npm run product:facts\b/, `${name} must not chain the frozen product-facts generator`);
    }
    assert.match(pkg.scripts.build, /npm run build:openapi && tsc && vite build && /);
  });

  it('openapi source exists at docs/api/worldmonitor.openapi.yaml', () => {
    // Catches the class of regression where someone cleans generated
    // artifacts and forgets to regenerate before committing — the
    // prebuild step would then fail silently at deploy time.
    const openapiPath = resolve(__dirname, '../docs/api/worldmonitor.openapi.yaml');
    assert.ok(
      existsSync(openapiPath),
      `docs/api/worldmonitor.openapi.yaml must exist — without it, build:openapi fails at deploy time`
    );
  });
});

// The MCP server card still ships under public/.well-known/ until the public
// docs leave in a later PR, so its advertised resource must stay on a known host.
describe('agent readiness: MCP server card', () => {
  it('MCP server card authentication.resource is a valid https URL on a known host', () => {
    const mcpCard = JSON.parse(
      readFileSync(resolve(__dirname, '../public/.well-known/mcp/server-card.json'), 'utf-8')
    );
    const u = new URL(mcpCard.authentication.resource);
    assert.equal(u.protocol, 'https:');
    assert.ok(
      ['worldmonitor.app', 'www.worldmonitor.app', 'api.worldmonitor.app'].includes(u.host),
      `unexpected host: ${u.host}`
    );
  });
});

// Agent readiness: a WorkOS-spec /auth.md walkthrough that agents can fetch to
// learn the registration flow, cross-linked from the AS metadata agent_auth.skill.
describe('agent readiness: auth.md walkthrough', () => {
  const authMd = readFileSync(resolve(__dirname, '../public/auth.md'), 'utf-8');

  it('opens with its title and describes API key and OAuth authentication', () => {
    assert.match(
      authMd,
      /^# WorldMonitor — Agent Authentication \(auth\.md\)\n/,
      'auth.md must open directly with its H1 for scanner compatibility'
    );
    assert.match(authMd, /API keys?.*OAuth|OAuth.*API keys?/i);
  });

  it('publishes /auth.md with the WorkOS-prescribed sections', () => {
    for (const heading of ['Discover', 'Pick a method', 'Register', 'Claim', 'Use the credential', 'Errors', 'Revocation']) {
      assert.match(
        authMd,
        new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm'),
        `auth.md must have a "## ${heading}" section`
      );
    }
  });

  it('references the auth.md spec and carries the spec anchor keywords', () => {
    assert.ok(authMd.includes('https://workos.com/auth-md'), 'auth.md must reference the WorkOS spec');
    for (const keyword of ['agent_auth', 'register_uri', 'claim_uri', 'identity_assertion', 'id-jag', 'WWW-Authenticate']) {
      assert.ok(authMd.includes(keyword), `auth.md must mention spec keyword: ${keyword}`);
    }
  });

  it('keeps every section header within the scanner read budget (~5 KB truncation)', () => {
    // isitagentready / ora.ai reads only the first ~5 KB of auth.md; any `## `
    // section header past that byte offset is dropped and the section reported
    // missing (regressing auth-md-structure). This has bitten us before, so
    // guard with a conservative ceiling — an edit that bloats an earlier
    // section fails HERE instead of silently regressing the live scan.
    const HEADER_BUDGET = 4800;
    let offset = 0;
    for (const line of authMd.split('\n')) {
      if (line.startsWith('## ')) {
        assert.ok(
          offset < HEADER_BUDGET,
          `"${line.trim()}" starts at byte ${offset}; must be < ${HEADER_BUDGET} to survive the ~5 KB scanner truncation`
        );
      }
      offset += Buffer.byteLength(line, 'utf8') + 1; // + the newline that split() dropped
    }
  });

  it('advertises a register endpoint that resolves (matches the agent_auth register_uri path)', () => {
    assert.match(
      authMd,
      /https:\/\/(?:api\.)?worldmonitor\.app\/oauth\/register/,
      'auth.md must document the reachable /oauth/register endpoint so the discovery chain is not stale'
    );
  });

  it('serves /auth.md as markdown, never the app shell', () => {
    assert.equal(getHeaderValueForSource('/auth.md', 'Content-Type'), 'text/markdown; charset=utf-8');
    assert.equal(getHeaderValueForSource('/auth.md', 'Access-Control-Allow-Origin'), '*');
    // #6575: the SPA catch-all rewrite is gone, so the real file is served (or
    // a deletion 404s) by default. Guard both directions.
    const dashboardShadow = (path) => vercelConfig.rewrites.find((r) =>
      r.destination === APP_SHELL_HTML_DESTINATION && sourceToRegExp(r.source).test(path)
    );
    assert.equal(dashboardShadow('/auth.md'), undefined, '/auth.md must serve the real file, not the dashboard');
    assert.ok(SPA_HTML_CACHE_SOURCE.includes('|auth\\.md|'), 'HTML cache catch-all must keep excluding /auth.md');
  });
});

// orank "Markdown URL fallback": homepage /index.md already returns markdown,
// but the scanner sampled GET /api/download as the content page and then
// requested /api/download.md. That path used to hit api/[...notfound].ts as
// JSON 404. Cloudflare Markdown for Agents cannot fill this gap — it converts
// HTML only when Accept: text/markdown, and /api/download is a 302, not HTML.
describe('agent readiness: /api/download.md URL twin', () => {
  const downloadMdPath = resolve(__dirname, '../public/api/download.md');
  const downloadMd = readFileSync(downloadMdPath, 'utf-8');

  it('publishes heading-led markdown at public/api/download.md', () => {
    assert.ok(existsSync(downloadMdPath), 'expected public/api/download.md (markdown twin of GET /api/download)');
    assert.match(downloadMd, /^# /m, '/api/download.md must open with a heading so scanners accept a non-HTML body');
    assert.match(downloadMd, /platform=windows-exe/);
    assert.match(downloadMd, /platform=macos-arm64/);
    assert.match(downloadMd, /platform=linux-appimage/);
  });

  it('serves /api/download.md as markdown with CORS and a self-canonical Link', () => {
    assert.equal(getHeaderValueForSource('/api/download.md', 'Content-Type'), 'text/markdown; charset=utf-8');
    assert.equal(getHeaderValueForSource('/api/download.md', 'Access-Control-Allow-Origin'), '*');
    assert.equal(
      getHeaderValueForSource('/api/download.md', 'Link'),
      '<https://www.worldmonitor.app/api/download.md>; rel="canonical"'
    );
  });

  it('is not rewritten to the dashboard shell', () => {
    const dashboardShadow = (path) => vercelConfig.rewrites.find((r) =>
      r.destination === APP_SHELL_HTML_DESTINATION && sourceToRegExp(r.source).test(path)
    );
    assert.equal(dashboardShadow('/api/download.md'), undefined, '/api/download.md must serve the static twin, not the dashboard');
    assert.ok(
      SPA_HTML_CACHE_SOURCE.startsWith('/((?!api|'),
      '/api/* (including /api/download.md) must stay outside the HTML-cache catch-all'
    );
  });
});

// orank "Markdown URL fallback" is site-wide (`/docs/auth` → `/docs/auth.md`),
// not a single sampled URL. Static public/*.md files still win (afterFiles).
// /docs/:match* stays first so Mintlify keeps /docs/*.md. /index.md stays
// ahead of the generic fallback. /api/*.md is excluded from this rewrite so
// the filesystem catch-all (api/[...notfound].ts) can emit markdown without
// reintroducing a shadowing /api/:path* rewrite (#4724).
describe('agent readiness: generic markdown URL-fallback rewrite', () => {
  const mdTwinRewrite = vercelConfig.rewrites.find((r) =>
    typeof r.destination === 'string' && r.destination.startsWith('/api/md-twin')
  );
  const rewriteIndex = (source) => vercelConfig.rewrites.findIndex((r) => r.source === source);

  it('rewrites unmatched /{page}.md to /api/md-twin after docs', () => {
    assert.ok(mdTwinRewrite, 'expected a generic /{page}.md → /api/md-twin rewrite');
    assert.match(mdTwinRewrite.source, /api\//, 'rewrite must exclude /api/*.md (handled by the not-found catch-all)');
    assert.match(mdTwinRewrite.source, /:mdPath|:path/, 'rewrite must capture the sibling path as a Vercel :param');
    assert.doesNotMatch(
      mdTwinRewrite.source,
      /\(\?</,
      'PCRE named groups are not Vercel :params; destination :mdPath would fail deploy (invalid-route-destination-segment)',
    );
    const mdIdx = vercelConfig.rewrites.indexOf(mdTwinRewrite);
    assert.ok(mdIdx > rewriteIndex('/docs/:match*'), '/docs/:match* must stay ahead of the generic .md fallback');
  });

  it('does not reintroduce a shadowing /api/:path* → /api/not-found rewrite', () => {
    const shadow = (vercelConfig.rewrites ?? []).find((r) =>
      r.destination === '/api/not-found' && /^\/api\/(?::[^/]*\*|\(\.\*\))$/.test(r.source ?? '')
    );
    assert.equal(shadow, undefined, 'do not add /api/:path* → /api/not-found; it shadows [rpc].ts gateways (#4724)');
  });

  it('sends content-page .md twins to the generator, not the dashboard shell', () => {
    assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: '/dashboard.md' })?.destination, '/api/md-twin?path=:mdPath');
    assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: '/stocks/AAPL.md' })?.destination, '/api/md-twin?path=:mdPath');
    assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: '/docs/auth.md' })?.destination, 'https://worldmonitor.mintlify.dev/docs/:match*');
    assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: '/api/health.md' }), null);
  });

  it('keeps HTML-cache catch-all from applying to generated .md twins', () => {
    assert.ok(SPA_HTML_CACHE_SOURCE.includes('|.*\\.md$'), 'HTML cache catch-all must exclude every *.md path');
    assert.equal(sourceToRegExp(SPA_HTML_CACHE_SOURCE).test('/dashboard.md'), false);
    assert.equal(sourceToRegExp(SPA_HTML_CACHE_SOURCE).test('/dashboard'), true);
  });

  it('never declares a static canonical over the unbounded generated .md space', () => {
    // The curated twins (pricing.md, developers.md, …) are standalone documents
    // with no HTML sibling, so their literal self-canonical header rules are
    // correct. The generated space is unbounded — /countries/iran.md and an
    // invented /countries/does-not-exist-xyz.md both land on /api/md-twin — so a
    // canonical rule that reached them would mint a self-canonical soft-404 that
    // no handler change can retract (#7860). Only the handler may set a
    // canonical there, and it points at the sibling HTML page.
    const generatedTwins = ['/countries/iran.md', '/countries/does-not-exist-xyz.md', '/stocks/AAPL.md'];
    for (const rule of vercelConfig.headers ?? []) {
      const declaresCanonical = (rule.headers ?? []).some(
        (h) => h.key?.toLowerCase() === 'link' && /rel="?canonical"?/.test(h.value ?? ''),
      );
      if (!declaresCanonical) continue;
      for (const path of generatedTwins) {
        assert.equal(
          sourceToRegExp(rule.source).test(path),
          false,
          `header rule "${rule.source}" declares a canonical over generated twin ${path}`,
        );
      }
    }
  });
});

describe('agent readiness: remaining markdown twins', () => {
  // pricing.md and support.md are advertised in api-catalog service-meta and
  // llms.txt (#4854/#4857), agents.md is the agent-discovery entry point
  // (#4952), so they get the same three-way pinning as auth.md:
  // explicit markdown Content-Type + CORS, catch-all exclusion (deleting or
  // renaming the static file must 404, not silently serve the dashboard HTML
  // misleading-200 the journey runs flagged), and this guard. /ai-search.md
  // joined the set with its canonical Link header (#4999): it is
  // sitemap-listed, and without the catch-all exclusion the SPA cache-header
  // catch-all (later in the headers array) overrides its max-age rule.
  for (const mdPath of ['/pricing.md', '/support.md', '/agents.md', '/ai-search.md', '/world-monitor.md', '/api-versioning.md']) {
    it(`serves ${mdPath} as markdown, never the app shell`, () => {
      assert.equal(getHeaderValueForSource(mdPath, 'Content-Type'), 'text/markdown; charset=utf-8');
      assert.equal(getHeaderValueForSource(mdPath, 'Access-Control-Allow-Origin'), '*');
      // #6575: no dashboard-serving rewrite may match the static markdown page.
      const shadow = vercelConfig.rewrites.find((r) =>
        r.destination === APP_SHELL_HTML_DESTINATION && sourceToRegExp(r.source).test(mdPath)
      );
      assert.equal(shadow, undefined, `${mdPath} must serve the real file, not the dashboard`);
      const token = mdPath.slice(1).replaceAll('.', '\\.');
      assert.ok(SPA_HTML_CACHE_SOURCE.includes(`|${token}|`), `HTML cache catch-all must keep excluding ${mdPath}`);
      assert.ok(
        existsSync(resolve(__dirname, `../public${mdPath}`)),
        `public${mdPath} must exist — it is advertised in api-catalog service-meta and llms.txt`
      );
    });
  }

  // /agent.txt (#4958 follow-up): the when-to-use agent-instruction file
  // (agent.txt convention; telnyx-parity). Same three-way pinning, but plain
  // text rather than markdown.
  it('serves /agent.txt as plain text, never the app shell', () => {
    assert.equal(getHeaderValueForSource('/agent.txt', 'Content-Type'), 'text/plain; charset=utf-8');
    assert.equal(getHeaderValueForSource('/agent.txt', 'Access-Control-Allow-Origin'), '*');
    const dashboardShadow = (path) => vercelConfig.rewrites.find((r) =>
      r.destination === APP_SHELL_HTML_DESTINATION && sourceToRegExp(r.source).test(path)
    );
    assert.equal(dashboardShadow('/agent.txt'), undefined, '/agent.txt must serve the real file, not the dashboard');
    assert.ok(SPA_HTML_CACHE_SOURCE.includes('|agent\\.txt|'), 'HTML cache catch-all must keep excluding /agent.txt');
    const agentTxt = readFileSync(resolve(__dirname, '../public/agent.txt'), 'utf-8');
    assert.match(agentTxt, /When to use/i, 'agent.txt must carry when-to-use guidance');
    assert.ok(agentTxt.includes('https://worldmonitor.app/mcp'), 'agent.txt must point at the MCP server');
  });
});

// PR history: #3204 / #3206 forced the resvg linux-x64-gnu native
// binding into the carousel function via vercel.json
// `functions.includeFiles`. That entire workaround became unnecessary
// once the route moved to @vercel/og on Edge runtime (see
// api/brief/carousel/...), which bundles satori + resvg-wasm with
// Vercel-native support. The `functions` block was removed.
//
// If any future route ever needs a Vercel `functions` config, keep
// in mind: the keys are micromatch globs, NOT literal paths.
// `[userId]` is a character class (match one of u/s/e/r/I/d), not a
// dynamic segment placeholder. Use `api/foo/**` for routes with
// dynamic brackets. See skill `vercel-native-binding-peer-dep-missing`
// for the full story.
describe('vercel.json functions config (none expected after carousel moved to edge)', () => {
  it('does not define any `functions` block (carousel now uses @vercel/og on edge)', () => {
    assert.equal(
      vercelConfig.functions,
      undefined,
      'No routes currently require a functions config. If adding one, ' +
        'remember Vercel treats the key as a micromatch glob — ' +
        '`[userId]` will silently match one of {u,s,e,r,I,d} and your ' +
        'rule will apply to nothing. See skill ' +
        'vercel-native-binding-peer-dep-missing for the gotcha.',
    );
  });
});

// Agent readiness: RFC 8288 Link response headers on the homepage and
// dashboard entry.
// Scanners like isitagentready.com fetch GET / and expect a Link
// header advertising every well-known resource. Each rel is either
// an IANA-registered token (api-catalog, service-desc, service-doc,
// status) or the full IANA URI form (RFC 9728 OAuth rels). The MCP
// card rel carries an absolute apex anchor because the server card
// describes the apex /mcp endpoint, not the document URL being fetched; a
// relative anchor resolves against the www page and names the 410 alias (#9722).
describe('agent readiness: public document Link headers', () => {
  const vercel = JSON.parse(readFileSync(resolve(__dirname, '../vercel.json'), 'utf-8'));

  for (const source of ['/', '/dashboard', '/dashboard.html']) {
    it(`${source} emits a Link header`, () => {
      const linkHeader = { value: effectiveHeader(source, 'Link') };
      assert.ok(linkHeader.value, `expected a Link header on ${source}`);

      // Must advertise each required rel at least once
      const requiredRels = [
        'rel="api-catalog"',
        'rel="service-desc"',
        'rel="service-doc"',
        'rel="status"',
        'rel="http://www.iana.org/assignments/relation/oauth-protected-resource"',
        'rel="http://www.iana.org/assignments/relation/oauth-authorization-server"',
        'rel="mcp-server-card"',
        'rel="agent-skills-index"',
        'rel="deprecation"',
      ];
      for (const rel of requiredRels) {
        assert.ok(
          linkHeader.value.includes(rel),
          `Link header missing ${rel}`
        );
      }

      assert.match(
        linkHeader.value,
        /<\/\.well-known\/mcp\/server-card\.json>[^,]*anchor="https:\/\/worldmonitor\.app\/mcp"/,
        'mcp-server-card rel must carry the absolute canonical anchor; anchor="/mcp" resolves to www/mcp, which answers 410'
      );

      // The docs MCP server (#4958) is advertised in the Link header directly —
      // header-first crawlers should not have to follow rel="api-catalog" to
      // discover the second MCP surface. Same rel as the product card, but
      // anchored to /docs/mcp (the card describes the docs endpoint). We
      // advertise a FIRST-PARTY card (/.well-known/mcp/docs-server-card.json),
      // NOT Mintlify's /docs/.well-known/mcp/server-card.json, because that
      // card's url points at worldmonitor.mintlify.dev/mcp which 404s on
      // initialize — a card-following agent would land on a dead endpoint
      // (#4964 review). The first-party card advertises the working
      // /docs/mcp facade.
      assert.match(
        linkHeader.value,
        /<\/\.well-known\/mcp\/docs-server-card\.json>[^,]*rel="mcp-server-card"[^,]*anchor="\/docs\/mcp"/,
        'docs mcp-server-card rel must point at the first-party /.well-known/mcp/docs-server-card.json with anchor="/docs/mcp"'
      );

      // `service-desc` is advertised twice — the JSON spec (/openapi.json,
      // parseable by JSON-only scanners like ora.ai/orank) first, then the
      // human-readable YAML (/openapi.yaml). Both must be present.
      assert.match(
        linkHeader.value,
        /<\/openapi\.json>; rel="service-desc"; type="application\/json"/,
        'Link header must advertise /openapi.json as a JSON service-desc'
      );
      assert.match(
        linkHeader.value,
        /<\/openapi\.yaml>; rel="service-desc"; type="application\/vnd\.oai\.openapi"/,
        'Link header must still advertise /openapi.yaml as the OpenAPI service-desc'
      );
      assert.match(
        linkHeader.value,
        /<\/api-versioning\.md>; rel="deprecation"; type="text\/markdown"/,
        'Link header must advertise the static REST deprecation policy'
      );

      // Target URIs must be root-relative (start with /, not http://).
      // One target per required rel, plus two rels advertised with a second
      // target: service-desc (/openapi.json + /openapi.yaml) and
      // mcp-server-card (product /mcp card + docs /docs/mcp card) — hence +2.
      const EXTRA_DOUBLE_ADVERTISED_RELS = 2;
      const targetMatches = [...linkHeader.value.matchAll(/<([^>]+)>/g)];
      assert.strictEqual(
        targetMatches.length,
        requiredRels.length + EXTRA_DOUBLE_ADVERTISED_RELS,
        `expected exactly ${requiredRels.length + EXTRA_DOUBLE_ADVERTISED_RELS} link targets, got ${targetMatches.length}`
      );
      for (const [, target] of targetMatches) {
        assert.ok(
          target.startsWith('/'),
          `link target must be root-relative, got ${target}`
        );
      }
    });
  }

  // /dashboard and /dashboard.html serve the same document; their Link headers
  // must stay in lockstep. Hardcoded duplication in vercel.json otherwise
  // silently drifts — this guard catches the drift at CI time.
  it('/dashboard and /dashboard.html Link headers are identical', () => {
    const dashboard = vercel.headers
      .filter((h) => h.source === '/dashboard')
      .flatMap((entry) => entry.headers)
      .find((h) => h.key === 'Link');
    const dashboardHtml = vercel.headers
      .filter((h) => h.source === '/dashboard.html')
      .flatMap((entry) => entry.headers)
      .find((h) => h.key === 'Link');
    assert.strictEqual(dashboard.value, dashboardHtml.value);
  });
});

// Content-Signal (contentsignals.org draft RFC) is declared in TWO places:
// the robots.txt group directive (what agent-readiness scanners read) and the
// origin-wide HTTP response header in vercel.json. The two values must never
// drift apart, and the robots.txt line must live inside the `User-agent: *`
// group (a blank line would end the group and orphan the directive).
// Lighthouse's robots.txt validator safelists `content-signal`, so the
// directive no longer costs SEO points (#4471 history).
describe('agent readiness: Content-Signal declarations', () => {
  const robotsFiles = ['robots.www.txt', 'robots.variant.txt', 'robots.api.txt'];
  const robotsSource = readFileSync(resolve(__dirname, '../public/robots.www.txt'), 'utf-8');

  const headerValue = () => {
    for (const block of vercelConfig.headers ?? []) {
      const hit = (block.headers ?? []).find((h) => h.key === 'Content-Signal');
      if (hit) return hit.value;
    }
    return null;
  };

  it('vercel.json serves an origin-wide Content-Signal header', () => {
    const value = headerValue();
    assert.ok(value, 'vercel.json must carry a Content-Signal response header');
    // Owner decision: training by assistant vendors is welcome (brand recall in
    // future models). The training crawlers are allowed in robots.txt, so the
    // signal must say yes — a `no` here contradicts the crawl rules.
    assert.match(value, /ai-train=yes/);
    assert.match(value, /search=(yes|no)/);
    assert.match(value, /ai-input=(yes|no)/);
  });

  it('every host robots file declares the same Content-Signal inside the User-agent group', () => {
    for (const file of robotsFiles) {
      const source = readFileSync(resolve(__dirname, '../public', file), 'utf-8');
      const lines = source.split('\n');
      const uaIndex = lines.findIndex((l) => l.trim().toLowerCase() === 'user-agent: *');
      assert.ok(uaIndex !== -1, `${file} must have a \`User-agent: *\` group`);
      const signalIndex = lines.findIndex((l) => l.startsWith('Content-Signal:'));
      assert.ok(signalIndex > uaIndex, `${file} Content-Signal must appear after \`User-agent: *\``);
      for (let i = uaIndex + 1; i < signalIndex; i++) {
        assert.notStrictEqual(
          lines[i].trim(),
          '',
          `${file} Content-Signal must not be separated from its User-agent group by a blank line`
        );
      }
      const robotsValue = lines[signalIndex].slice('Content-Signal:'.length).trim();
      assert.strictEqual(
        robotsValue,
        headerValue(),
        `${file} Content-Signal must match the vercel.json header value`
      );
    }
  });

  it('robots.txt declares the same Content-Signal inside the User-agent group', () => {
    const lines = robotsSource.split('\n');
    const uaIndex = lines.findIndex((l) => l.trim().toLowerCase() === 'user-agent: *');
    assert.ok(uaIndex !== -1, 'robots.txt must have a `User-agent: *` group');
    const signalIndex = lines.findIndex((l) => l.startsWith('Content-Signal:'));
    assert.ok(signalIndex > uaIndex, 'Content-Signal directive must appear after `User-agent: *`');
    for (let i = uaIndex + 1; i < signalIndex; i++) {
      assert.notStrictEqual(
        lines[i].trim(),
        '',
        'Content-Signal must not be separated from its User-agent group by a blank line'
      );
    }
    const robotsValue = lines[signalIndex].slice('Content-Signal:'.length).trim();
    assert.strictEqual(
      robotsValue,
      headerValue(),
      'robots.txt Content-Signal must match the vercel.json header value'
    );
  });

  it('every Content-Signal line in robots.txt matches the header (multi-group)', () => {
    // The AI-agent groups added in #4952 carry their own Content-Signal
    // directive; none of the copies may drift from the origin-wide header.
    for (const file of robotsFiles) {
      const signalLines = readFileSync(resolve(__dirname, '../public', file), 'utf-8')
        .split('\n')
        .filter((l) => l.startsWith('Content-Signal:'));
      assert.ok(signalLines.length >= 1, `${file} must declare Content-Signal`);
      for (const line of signalLines) {
        assert.strictEqual(
          line.slice('Content-Signal:'.length).trim(),
          headerValue(),
          `${file} Content-Signal must match the vercel.json header value`
        );
      }
    }
  });
});

// #4952 — a named `User-agent` group replaces the `*` group for that crawler.
// Autonomous search crawlers restate the full `*` rule set. User-triggered
// fetchers keep the bounded path protections but can open shared map links.
// Autonomous AI crawlers (search indexers AND training crawlers of vendors
// whose assistants cite us) share one group. The bulk-scraper group stays a
// hard `Disallow: /`.
describe('agent readiness: robots.txt AI crawler policy', () => {
  const robotsSource = readFileSync(resolve(__dirname, '../public/robots.www.txt'), 'utf-8');

  const groups = parseRobotsGroups(robotsSource);
  const starGroup = groups.find((g) => g.agents.includes('*'));
  const aiAllowGroup = groups.find((g) => g.agents.includes('gptbot'));
  const userFetchGroup = groups.find((g) => g.agents.includes('chatgpt-user'));
  const trainingBlockGroup = groups.find((g) => g.agents.includes('ccbot'));

  const REQUIRED_AI_SEARCH_AGENTS = [
    'oai-searchbot',
    'claude-searchbot',
    'perplexitybot',
    'duckassistbot',
  ];
  // Training crawlers / training-control tokens. Allowed because ai-train=yes.
  const REQUIRED_AI_TRAINING_AGENTS = [
    'gptbot',
    'claudebot',
    'google-extended',
    'applebot-extended',
  ];
  const REQUIRED_USER_FETCH_AGENTS = [
    'chatgpt-user',
    'claude-user',
    'perplexity-user',
    'mistralai-user',
  ];
  const BLOCKED_TRAINING_AGENTS = ['ccbot', 'bytespider'];

  it('explicitly allows the AI search and training crawlers in one named group', () => {
    assert.ok(aiAllowGroup, 'robots.txt must have a named AI crawler group (GPTBot et al.)');
    for (const agent of [...REQUIRED_AI_SEARCH_AGENTS, ...REQUIRED_AI_TRAINING_AGENTS]) {
      assert.ok(
        aiAllowGroup.agents.includes(agent),
        `AI crawler group must include User-agent: ${agent}`
      );
    }
    assert.ok(
      aiAllowGroup.rules.includes('allow: /'),
      'AI search group must Allow: /'
    );
  });

  it('keeps the AI allow-group rules in parity with the `*` group', () => {
    assert.ok(starGroup, 'robots.txt must have a `User-agent: *` group');
    assert.deepStrictEqual(
      [...aiAllowGroup.rules].sort(),
      [...starGroup.rules].sort(),
      'the AI allow-group must restate the exact `*` rule set — named groups do not inherit, so a drift here silently opens /api/ (or blocks paths) for AI crawlers'
    );
  });

  it('keeps user-triggered fetchers in their own crawl-permitting group', () => {
    assert.ok(userFetchGroup, 'robots.txt must have a user-triggered assistant group');
    for (const agent of REQUIRED_USER_FETCH_AGENTS) {
      assert.ok(userFetchGroup.agents.includes(agent), `user fetch group must include User-agent: ${agent}`);
      assert.ok(!aiAllowGroup.agents.includes(agent), `${agent} must not inherit autonomous crawl limits`);
    }
    assert.ok(userFetchGroup.rules.includes('allow: /'), 'user fetch group must Allow: /');
  });

  it('disallows the bulk training-only scrapers entirely', () => {
    assert.ok(trainingBlockGroup, 'robots.txt must have a training-scraper block group (CCBot et al.)');
    for (const agent of BLOCKED_TRAINING_AGENTS) {
      assert.ok(
        trainingBlockGroup.agents.includes(agent),
        `training block group must include User-agent: ${agent}`
      );
    }
    assert.deepStrictEqual(
      trainingBlockGroup.rules,
      ['disallow: /'],
      'training-only scrapers must be blocked with exactly `Disallow: /`'
    );
  });

  it('never lists an allowed AI agent in the blocked group (and vice versa)', () => {
    for (const agent of [
      ...REQUIRED_AI_SEARCH_AGENTS,
      ...REQUIRED_AI_TRAINING_AGENTS,
      ...REQUIRED_USER_FETCH_AGENTS,
    ]) {
      assert.ok(
        !trainingBlockGroup.agents.includes(agent),
        `${agent} drives citations and must not be in the blocked group`
      );
    }
    for (const agent of BLOCKED_TRAINING_AGENTS) {
      assert.ok(
        !aiAllowGroup.agents.includes(agent),
        `${agent} is training-only and must not be in the allow group`
      );
    }
  });

  it('every crawl-permitting group keeps /api/ protected', () => {
    for (const group of groups) {
      if (group.rules.includes('allow: /')) {
        assert.ok(
          group.rules.includes('disallow: /api/'),
          `group [${group.agents.join(', ')}] allows crawling but does not restate Disallow: /api/`
        );
      }
    }
  });
});

// #7660: autonomous crawl groups block unbounded coordinate state and /tmp/
// paths. User-triggered fetchers can follow shared map links.
describe('agent readiness: crawl-budget disallows (#7660)', () => {
  const CRAWL_BUDGET_DISALLOWS = [
    'disallow: /tmp/',
    'disallow: /*?*lat=',
    'disallow: /*?*lon=',
    'disallow: /*?*zoom=',
  ];

  // The inverse half of the contract, and the more important one. robots.txt is
  // a crawl control, not a canonicalization tool: a disallowed URL is never
  // fetched, so Google reads neither its rel=canonical nor its redirect. These
  // families already consolidate — middleware 308s a crawler off ref/
  // wm_referral/utm_* (a 308 passes the link equity that affiliates' pasted
  // /pro?ref=… URLs carry), and wm_content_* answers 200 with a canonical.
  // Blocking them would replace a working mechanism with a worse one.
  const MUST_STAY_CRAWLABLE = [
    'disallow: /*?*ref=',
    'disallow: /*?*wm_referral=',
    'disallow: /*?*wm_content_',
    'disallow: /*?*utm_',
    // `layers` looks like map state but is not what makes the space unbounded.
    // src/utils/urlState.ts sets `zoom` unconditionally on every share URL, so
    // `/*?*zoom=` already catches the whole family; `layers` added no coverage
    // and disallowed the bounded dashboard CTAs build-use-cases.mjs publishes
    // with layers and no coordinates (PR #7689 review).
    'disallow: /*?*layers=',
  ];

  for (const file of ['robots.www.txt', 'robots.variant.txt']) {
    it(`${file} lets user-triggered assistant fetchers open shared map links`, () => {
      const groups = parseRobotsGroups(readFileSync(resolve(__dirname, `../public/${file}`), 'utf-8'));
      const starGroup = groups.find((group) => group.agents.includes('*'));
      const userFetchGroup = groups.find((group) => group.agents.includes('chatgpt-user'));
      assert.ok(starGroup, `${file} must have a default group`);
      assert.ok(userFetchGroup, `${file} must have a user-triggered assistant group`);
      for (const agent of ['chatgpt-user', 'claude-user', 'perplexity-user', 'mistralai-user']) {
        assert.ok(userFetchGroup.agents.includes(agent), `${file} must include ${agent}`);
      }
      const coordinateRules = new Set(CRAWL_BUDGET_DISALLOWS.slice(1));
      const expectedRules = starGroup.rules.filter((rule) => !coordinateRules.has(rule));
      assert.deepStrictEqual(
        [...userFetchGroup.rules].sort(),
        [...expectedRules].sort(),
        `${file} user-triggered fetchers must omit only the coordinate rules`
      );
    });

    it(`${file} carries every crawl-budget disallow in every autonomous crawl group`, () => {
      const groups = parseRobotsGroups(readFileSync(resolve(__dirname, `../public/${file}`), 'utf-8'));
      const crawling = groups.filter((g) => g.rules.includes('allow: /'));
      const autonomous = crawling.filter((g) => !g.agents.includes('chatgpt-user'));
      assert.ok(autonomous.length >= 2, `${file} must have a * group and a named AI group that crawl`);
      for (const group of autonomous) {
        for (const rule of CRAWL_BUDGET_DISALLOWS) {
          assert.ok(
            group.rules.includes(rule),
            `${file} group [${group.agents.join(', ')}] is missing \`${rule.replace('disallow:', 'Disallow:')}\` — ` +
              'robots groups do not inherit, so this crawler still burns budget on the space the others no longer crawl'
          );
        }
      }
      for (const group of crawling) {
        for (const rule of MUST_STAY_CRAWLABLE) {
          assert.ok(
            !group.rules.includes(rule),
            `${file} group [${group.agents.join(', ')}] added \`${rule.replace('disallow:', 'Disallow:')}\` — ` +
              'that family already consolidates via a 308 or a rel=canonical, and a disallowed URL is never ' +
              'fetched, so blocking it strands the signal instead of folding it'
          );
        }
      }
    });
  }

  it('leaves the canonical param-free documents crawlable', () => {
    // The disallows are query-scoped on purpose: `/dashboard` and `/pro` are
    // the consolidation targets the canonicals point at, so blocking the bare
    // paths would delete the pages this change exists to protect.
    for (const file of ['robots.www.txt', 'robots.variant.txt']) {
      const body = readFileSync(resolve(__dirname, `../public/${file}`), 'utf-8');
      assert.doesNotMatch(body, /^Disallow: \/dashboard$/m, `${file} must keep /dashboard crawlable`);
      assert.doesNotMatch(body, /^Disallow: \/docs$/m, `${file} must keep /docs crawlable`);
      for (const line of body.split('\n')) {
        const match = /^Disallow: (\/\*.*)$/.exec(line.trim());
        if (!match) continue;
        assert.match(
          match[1],
          /^\/\*\?\*/,
          `${line.trim()} must be query-scoped (\`/*?*\`) — a bare wildcard would block the canonical document too`
        );
      }
    }
  });

  // Rule presence is not the contract — what the rules MATCH is. This resolves
  // real request paths against the `*` group using Google's documented
  // semantics (`*` = any sequence, `$` = end of URL, longest match wins,
  // Allow beats an equal-length Disallow) so a future edit that quietly
  // narrows or widens a pattern fails here rather than in Search Console.
  describe('resolved against the paths Search Console actually reported', () => {
    const escapeRe = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Google's robots.txt path matching: `*` is any sequence, a trailing `$`
    // anchors the end of the URL (query string included), everything else is
    // a literal prefix match.
    const pathMatches = (pattern, path) => {
      const source = pattern.endsWith('$')
        ? `^${pattern.slice(0, -1).split('*').map(escapeRe).join('.*')}$`
        : `^${pattern.split('*').map(escapeRe).join('.*')}`;
      return new RegExp(source).test(path);
    };

    const ruleCache = new Map();
    const starGroupRules = (file) => {
      if (!ruleCache.has(file)) {
        const groups = parseRobotsGroups(readFileSync(resolve(__dirname, `../public/${file}`), 'utf-8'));
        const star = groups.find((g) => g.agents.includes('*'));
        assert.ok(star, `${file} must have a * group`);
        ruleCache.set(
          file,
          star.rules.map((rule) => {
            const [key, ...rest] = rule.split(': ');
            return { allow: key === 'allow', pattern: rest.join(': ') };
          })
        );
      }
      return ruleCache.get(file);
    };

    const isCrawlable = (file, path) => {
      let best = null;
      for (const rule of starGroupRules(file)) {
        if (!pathMatches(rule.pattern, path)) continue;
        if (!best || rule.pattern.length > best.pattern.length) best = rule;
        else if (rule.pattern.length === best.pattern.length && rule.allow) best = rule;
      }
      return best ? best.allow : true;
    };

    // Verbatim shapes from the 2026-09-04 GSC "Page with redirect" and
    // "Not found (404)" exports.
    const BLOCKED = [
      '/?lat=20.0000&lon=0.0000&zoom=1.00&view=global&timeRange=7d&layers=conflicts,bases',
      '/index?lat=NaN&lon=NaN&zoom=2.50&view=america&timeRange=7d&layers=conflicts',
      '/dashboard?lat=20.0000&lon=0.0000&zoom=1.00',
      '/tmp/gem-pipelines.json',
    ];
    const CRAWLABLE = [
      '/',
      '/dashboard',
      '/pro',
      '/countries/iran/',
      '/compare/iran-vs-israel/',
      '/docs/mcp-overview',
      // #7660 proposed Disallow: /docs/_next/ for the 139 stale hashed chunks
      // that 404 after every Mintlify redeploy. Measured instead: a live
      // /docs/* page pulls 76 assets from that prefix, JS and CSS both, and
      // the current deploy's assets carry the same `?dpl=` pin as the stale
      // ones — no pattern separates them. Blocking it would hide every render
      // resource from Googlebot on the pages already stuck in "crawled -
      // currently not indexed", which costs more than a cheap 404.
      '/docs/_next/static/chunks/462bacc63bed9960.css?dpl=dpl_6TpKozpvfbf2eKSzPrrzWSvEC9fx',
      // docs/embed-live-map.mdx documents this exact iframe src. The map-param
      // rules would otherwise stop Googlebot fetching our widget while it
      // renders a partner's page.
      '/embed?layers=conflicts,earthquakes,weather&center=20,0&zoom=1&theme=dark&variant=full',
      '/embed?panel=fear-greed&theme=dark',
      // Bounded, already-consolidating families: the middleware 308 and the
      // rel=canonical only work if the crawler is allowed to fetch them.
      '/pro?ref=affiliate',
      '/pro?wm_referral=abc123',
      '/pro?wm_content_source=use-cases&wm_content_medium=internal',
      '/countries/iran/?utm_source=newsletter',
      '/blog/',
      '/api/llms.txt',
    ];

    for (const file of ['robots.www.txt', 'robots.variant.txt']) {
      it(`${file} blocks the reported crawl-waste URLs`, () => {
        for (const path of BLOCKED) {
          assert.equal(isCrawlable(file, path), false, `${file} must block ${path}`);
        }
      });

      it(`${file} still allows the canonical corpus`, () => {
        for (const path of CRAWLABLE) {
          // /pro and its query forms are deliberately Disallowed on variant
          // hosts (#6835) — /pro/welcome.html stays 200 there.
          if (file === 'robots.variant.txt' && path.startsWith('/pro')) continue;
          assert.equal(isCrawlable(file, path), true, `${file} must keep ${path} crawlable`);
        }
      });
    }

    // Probed against production 2026-09-04: Vercel applies vercel.json
    // `redirects` BEFORE middleware. On a variant host, `/?ref=x` answers
    // 308 -> `/dashboard?ref=x` with the param intact, while the same request
    // on www answers 308 -> `/` with it stripped — so the middleware never
    // runs for `/` there, and crawlerCanonicalUrl() cannot collapse variant
    // map-state URLs.
    //
    // That makes the variant robots rules load-bearing rather than
    // belt-and-braces: they are the ONLY thing keeping a compliant crawler off
    // the variant hosts' share of the space (415 of the 1,000 exported
    // redirect URLs). If the `/` -> `/dashboard` host redirect is ever
    // removed, middleware takes over and this coupling changes — so assert the
    // pair together rather than leaving the dependency unwritten.
    it('keeps the variant map-state rules load-bearing while the / host redirect exists', () => {
      const variantRootRedirect = vercelConfig.redirects.find(
        (r) =>
          r.source === '/' &&
          Array.isArray(r.has) &&
          r.has.some((h) => h.type === 'host' && /tech|finance|commodity|happy|energy/.test(h.value))
      );
      if (!variantRootRedirect) return;
      assert.equal(variantRootRedirect.destination, '/dashboard');
      for (const path of [
        '/?lat=20.0000&lon=0.0000&zoom=1.00',
        '/dashboard?lat=20.0000&lon=0.0000&zoom=1.00',
      ]) {
        assert.equal(
          isCrawlable('robots.variant.txt', path),
          false,
          `robots.variant.txt must block ${path} itself — the middleware collapse never runs on a variant host`
        );
      }
    });

    // The sitemap covers the documents we declare. This covers the links those
    // documents CONTAIN — a different failure, and the one a crawl-budget rule
    // is most likely to cause: publishing a link on ~240 generated pages while
    // telling Google it may not follow it. Blocking a link you keep emitting is
    // the worst of both, and it moves the volume into "Blocked by robots.txt"
    // rather than removing it.
    //
    // Shapes are the ones the corpus builders actually emit: the parameterised
    // dashboard deep links in scripts/build-crawlable-corpus.mjs and
    // scripts/build-research-reports.mjs, plus the wm_content_* attribution in
    // scripts/build-use-cases.mjs. The utm_source wrapper that used to sit on
    // top of those was deleted in #8603.
    // `/*?*lat=` is a substring match over the whole query, not a parameter-NAME
    // match: it also catches any param ending in the token (`?colon=` matches
    // `/*?*lon=`) and value-side text (`?q=flat=earth` matches `/*?*lat=`).
    //
    // That cannot be fixed in robots.txt. Name-anchoring needs `/*&lat=` for a
    // non-first parameter, and a literal `&` in a rule path never matches —
    // verified against Protego, which implements Google's spec: `/*&lat=` does
    // not match `/d?view=g&lat=1` while `/*?*lat=` does. Anchoring would have
    // silently stopped blocking every map URL whose lat is not the first param.
    //
    // So the exposure is real and permanent, and the guard is on the other
    // side: no parameter this application actually reads may end in one of the
    // blocked tokens. 96 params read via searchParams today, zero collisions —
    // this fails the day someone adds `?colon=`, `?salon=`, `?pylon=` or
    // `?flat=`, which is when it matters.
    it('has no live collision between a blocked token and a real parameter', () => {
      const BLOCKED_TOKENS = ['lat', 'lon', 'zoom', 'layers'];
      const SOURCE_DIRS = ['src', 'server', 'api', 'scripts', 'shared'];
      // Both spellings: `url.searchParams.get('x')` and the bare
      // `params.get('x')` / `params.set('x', …)` used once a URLSearchParams is
      // in a local (src/utils/urlState.ts reads zoom and layers that way).
      const PARAM_RE = /(?:searchParams|params)\.(?:get|has|set)\(\s*['"]([A-Za-z0-9_]+)['"]/g;

      const collectParams = (dir, acc) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            collectParams(full, acc);
            continue;
          }
          if (!/\.(ts|tsx|mts|mjs|js|cjs)$/.test(entry.name)) continue;
          for (const m of readFileSync(full, 'utf-8').matchAll(PARAM_RE)) acc.add(m[1]);
        }
        return acc;
      };

      const params = new Set();
      for (const dir of SOURCE_DIRS) collectParams(resolve(__dirname, '..', dir), params);
      assert.ok(params.size > 50, `expected to find the app's query params, got ${params.size}`);
      // `layers` is still blocked, but no kept route reads it since the map
      // embed left; the coordinate tokens prove the scan sees real params.
      for (const token of ['lat', 'lon', 'zoom']) assert.ok(params.has(token), `${token} must be a real param`);

      // The bounding-box params collide on the token but never on a crawlable
      // URL: they exist only on `/api/*` RPC routes, which `Disallow: /api/`
      // has covered since long before these rules. Allowlisted explicitly, and
      // re-proved below, so a NEW collision on a crawlable surface still fails.
      const API_ONLY_COLLISIONS = ['sw_lat', 'sw_lon', 'ne_lat', 'ne_lon'];

      const collisions = [...params].filter(
        (name) => !BLOCKED_TOKENS.includes(name) && BLOCKED_TOKENS.some((t) => name.endsWith(t))
      );
      assert.deepEqual(
        collisions.filter((name) => !API_ONLY_COLLISIONS.includes(name)).sort(),
        [],
        'these parameters end in a blocked token, so `/*?*<token>=` would disallow every URL ' +
          `carrying them: ${collisions.join(', ')}. Rename the param, or drop the rule.`
      );

      // The allowlist cannot rot: every file that names one of these must also
      // name an /api/ path, so the day one is used on a crawlable URL this
      // fails instead of quietly widening the exemption.
      const filesNaming = (needle, dir, acc = []) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            filesNaming(needle, full, acc);
            continue;
          }
          if (!/\.(ts|tsx|mts|mjs|js|cjs)$/.test(entry.name)) continue;
          const body = readFileSync(full, 'utf-8');
          // As a query KEY only — quoted, or written into a query string. A
          // bare prose mention (`// [sw_lat, sw_lon, …]` documenting an array
          // order) is not a parameter and must not trip this.
          const asQueryKey = new RegExp(`['"\`]${needle}['"\`]|[?&]${needle}=`);
          if (asQueryKey.test(body)) acc.push({ path: full, apiScoped: body.includes('/api/') });
        }
        return acc;
      };
      for (const name of API_ONLY_COLLISIONS) {
        for (const dir of SOURCE_DIRS) {
          for (const hit of filesNaming(name, resolve(__dirname, '..', dir))) {
            assert.ok(
              hit.apiScoped,
              `${name} is allowlisted as /api/-only, but ${relative(resolve(__dirname, '..'), hit.path)} ` +
                'names it without any /api/ path — if it now reaches a crawlable URL, `/*?*lat=` disallows that URL'
            );
          }
        }
      }
    });

    it('blocks nothing we declare in the sitemap', () => {
      // The failure mode worth guarding: a crawl-budget rule that also deletes
      // part of the 845-URL declared inventory it exists to protect. Resolved
      // against every <loc> rather than a sample.
      const sitemap = readFileSync(resolve(__dirname, '../public/sitemap-main.xml'), 'utf-8');
      const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      assert.ok(locs.length > 100, `expected a populated sitemap, got ${locs.length} entries`);
      for (const loc of locs) {
        const { pathname, search } = new URL(loc);
        assert.equal(
          isCrawlable('robots.www.txt', `${pathname}${search}`),
          true,
          `robots.www.txt blocks a sitemap-declared URL: ${loc}`
        );
      }
    });
  });
});

describe('vercel deployment excludes api test files', () => {
  // Vercel deploys every non-underscore file under api/ as a live serverless
  // function. A deployed *.test.mjs is a public endpoint that executes its
  // whole node:test suite (with production env + Sentry) on every request —
  // WORLDMONITOR-VD flooded Sentry with "Upstash Redis is not configured"
  // because wm-session.test.mjs deletes the Upstash env vars to exercise the
  // fail-closed path, and something polls /api/wm-session.test every ~2 min.
  const vercelignore = readFileSync(resolve(__dirname, '../.vercelignore'), 'utf-8');
  const ignoreRules = vercelignore
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const collectApiTestFiles = (dir) => {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) found.push(...collectApiTestFiles(full));
      else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) found.push(full);
    }
    return found;
  };
  const apiTestFiles = collectApiTestFiles(resolve(__dirname, '../api'));

  it('.vercelignore excludes api/**/*.test.mjs', () => {
    assert.ok(
      ignoreRules.includes('api/**/*.test.mjs'),
      '.vercelignore must contain "api/**/*.test.mjs" — without it every api test file deploys as a live production function'
    );
  });

  it('every api test file uses the .test.mjs extension the ignore rule covers', () => {
    assert.ok(apiTestFiles.length > 0, 'expected api test files to exist (walker broke?)');
    for (const file of apiTestFiles) {
      assert.match(
        file,
        /\.test\.mjs$/,
        `${file}: api test files must end in .test.mjs so the .vercelignore rule excludes them from deployment — extend both if introducing a new extension`
      );
    }
  });
});

// Registry branding + ARD catalog (ora.ai Discovery checks). The MCP
// server-card must carry the full branding trio (name, icon, description —
// `registry-branding`), and /.well-known/ai-catalog.json publishes the ARD
// manifest (`ard-catalog` bonus): host identity plus domain-anchored
// urn:air: entries, each with a media type, URL, and trust manifest —
// mirroring ora's own /api/ard/catalog dialect, which is what their parser
// reads.
describe('agent readiness: registry branding + ARD catalog', () => {
  const serverCard = JSON.parse(
    readFileSync(resolve(__dirname, '../public/.well-known/mcp/server-card.json'), 'utf-8')
  );
  const aiCatalog = JSON.parse(
    readFileSync(resolve(__dirname, '../public/.well-known/ai-catalog.json'), 'utf-8')
  );

  it('server-card carries the full branding trio and the icon asset exists', () => {
    assert.ok(serverCard.name, 'server-card must have a name');
    assert.ok(serverCard.description, 'server-card must have a description');
    assert.match(
      serverCard.icon ?? '',
      /^https:\/\/(www\.)?worldmonitor\.app\//,
      'server-card icon must be an absolute worldmonitor.app URL'
    );
    const iconPath = new URL(serverCard.icon).pathname;
    assert.ok(
      existsSync(resolve(__dirname, `../public${iconPath}`)),
      `server-card icon must point at a real public asset (public${iconPath})`
    );
  });

  it('ai-catalog.json declares the World Monitor host identity', () => {
    assert.strictEqual(aiCatalog.specVersion, '1.0');
    assert.strictEqual(aiCatalog.host?.displayName, 'World Monitor');
    assert.strictEqual(aiCatalog.host?.identifier, 'did:web:worldmonitor.app');
    assert.ok(Array.isArray(aiCatalog.entries) && aiCatalog.entries.length >= 2);
  });

  it('every ai-catalog entry is domain-anchored and complete', () => {
    for (const entry of aiCatalog.entries) {
      const label = `ai-catalog entry ${entry.identifier}`;
      assert.match(
        entry.identifier ?? '',
        /^urn:air:worldmonitor\.app:[a-z-]+:[a-z0-9-]+$/,
        `${label} must be a domain-anchored urn:air URN`
      );
      assert.ok(entry.displayName, `${label} needs a displayName`);
      assert.ok(entry.type, `${label} needs a media type`);
      assert.ok(entry.description, `${label} needs a description`);
      assert.match(
        entry.url ?? '',
        /^https:\/\/(www\.)?worldmonitor\.app\//,
        `${label} URL must be same-origin`
      );
      assert.strictEqual(
        entry.trustManifest?.identity,
        'did:web:worldmonitor.app',
        `${label} trust identity must be the domain DID`
      );
    }
  });

  it('the ai-catalog MCP entry points at the real server-card path', () => {
    const mcpEntry = aiCatalog.entries.find((e) => e.type === 'application/mcp-server-card+json');
    assert.ok(mcpEntry, 'ai-catalog must list the MCP server');
    assert.ok(
      mcpEntry.url.endsWith('/.well-known/mcp/server-card.json'),
      'MCP entry URL must target the published server-card'
    );
    assert.ok(
      existsSync(resolve(__dirname, '../public/.well-known/agent-skills/index.json')) ===
        aiCatalog.entries.some((e) => e.url.endsWith('/.well-known/agent-skills/index.json')),
      'agent-skills entry must exist iff the skills index is published'
    );
  });
});

describe('docs host scoping — Mintlify proxy is www-only (#5345)', () => {
  // The /docs rewrite proxies worldmonitor.mintlify.dev with no host condition,
  // so every variant subdomain served the full docs site and Googlebot crawled
  // the duplicates. Redirects run before rewrites on Vercel, so a host-scoped
  // redirect entry is what keeps subdomain /docs requests from reaching the
  // proxy. The host list is VARIANT_HOSTS without www.
  const docsHostRedirect = vercelConfig.redirects.find(
    (r) => r.source === '/docs/:match(.*)' && r.has
  );
  const variantHosts = VARIANT_HOSTS.filter((host) => host !== 'www.worldmonitor.app');

  it('redirects subdomain /docs/* to www permanently', () => {
    assert.ok(docsHostRedirect, 'expected a host-conditioned redirect for /docs/:match(.*)');
    assert.equal(docsHostRedirect.destination, 'https://www.worldmonitor.app/docs/:match');
    assert.equal(docsHostRedirect.permanent, true);
  });

  it('the host condition covers every variant subdomain plus api., and never www.', () => {
    const hostValue = (docsHostRedirect?.has ?? []).find((h) => h.type === 'host')?.value ?? '';
    const hostRe = new RegExp(hostValue);
    assert.equal(variantHosts.length, 5, 'expected the five variant subdomains');
    for (const host of [...variantHosts, 'api.worldmonitor.app']) {
      assert.match(host, hostRe, `${host} must be caught by the docs host redirect`);
    }
    assert.ok(!hostRe.test('www.worldmonitor.app'), 'www must keep serving the docs proxy');
  });

  it('redirects prefix-less /api-reference/* (Googlebot fetches Mintlify RSC route strings) into /docs on www', () => {
    // Mintlify's RSC flight payload embeds its internal routes without the
    // /docs base path; Googlebot speculatively fetches those strings against
    // whatever host served the page. Without this redirect they 404 (the SPA
    // catch-all excludes ^api), flooding GSC.
    const redirect = vercelConfig.redirects.find((r) => r.source === '/api-reference/:match*');
    assert.ok(redirect, 'expected a redirect for /api-reference/:match*');
    assert.equal(redirect.destination, 'https://www.worldmonitor.app/docs/api-reference/:match*');
    assert.equal(redirect.permanent, true);
    assert.equal(redirect.has, undefined, 'must apply on every host, www included');
  });

  it('the www docs proxy rewrite itself is untouched', () => {
    const proxy = vercelConfig.rewrites.find((r) => r.source === '/docs/:match*');
    assert.ok(proxy, 'expected the /docs/:match* rewrite');
    assert.equal(proxy.destination, 'https://worldmonitor.mintlify.dev/docs/:match*');
  });
});

describe('markdown canonical Link headers (#4999)', () => {
  // The sitemap-listed markdown pages are intentionally raw text/markdown for
  // agents, so they cannot carry a <link rel="canonical">. RFC 6596 allows the
  // HTTP Link header form; without it these are the only indexable URLs with
  // no canonical signal at all.
  const MD_PAGES = ['/pricing.md', '/support.md', '/ai-search.md', '/developers.md', '/mcp-server.md', '/openapi.md', '/sdks.md', '/auth.md', '/agents.md', '/home.md', '/world-monitor.md', '/api-versioning.md'];

  for (const page of MD_PAGES) {
    it(`${page} declares a self-referencing canonical Link header`, () => {
      assert.strictEqual(
        getHeaderValueForSource(page, 'Link'),
        `<https://www.worldmonitor.app${page}>; rel="canonical"`,
        `${page} must self-canonicalize on the www host via the Link header`
      );
      assert.strictEqual(
        getHeaderValueForSource(page, 'Content-Type'),
        'text/markdown; charset=utf-8'
      );
    });
  }

  const CORPUS_PAGES = ['/llms.txt', '/llms-full.txt', '/agent.txt', '/openapi.yaml', '/openapi.json', '/plugin.json', '/schemamap.xml'];

  for (const page of CORPUS_PAGES) {
    it(`${page} declares a www canonical Link header`, () => {
      assert.strictEqual(
        getHeaderValueForSource(page, 'Link'),
        `<https://www.worldmonitor.app${page}>; rel="canonical"`,
        `${page} must self-canonicalize on the www host via the Link header`
      );
    });
  }
});

// #4953 — developer-resource discoverability: an agent web-searching "World
// Monitor MCP server", "World Monitor OpenAPI", "World Monitor developer
// portal", or "World Monitor SDK" must land on a crawlable page whose H1 names
// that resource type. Each named page mirrors the auth.md/ai-search.md serving
// pattern (static public/*.md, excluded from the SPA catch-all, advertised in
// the discovery chain).
describe('agent readiness: named developer-resource pages (#4953)', () => {
  const DEV_PAGES = [
    { file: 'developers.md', path: '/developers.md', h1: '# World Monitor Developer Portal' },
    { file: 'mcp-server.md', path: '/mcp-server.md', h1: '# World Monitor MCP Server' },
    { file: 'openapi.md', path: '/openapi.md', h1: '# World Monitor OpenAPI Specification' },
    { file: 'sdks.md', path: '/sdks.md', h1: '# World Monitor SDKs' },
  ];


  for (const page of DEV_PAGES) {
    it(`public/${page.file} opens with the brand-named H1 "${page.h1}"`, () => {
      const body = readFileSync(resolve(__dirname, `../public/${page.file}`), 'utf-8');
      const content = body.replace(/^---\n[\s\S]*?\n---\n+/, '');
      assert.ok(content.startsWith(`${page.h1}\n`), `public/${page.file} must open with "${page.h1}" after metadata`);
    });

    it(`${page.path} serves the static page, never the app shell`, () => {
      // #6575: the SPA catch-all is gone; guard that it stays that way per page.
      const shadow = vercelConfig.rewrites.find((r) =>
        r.destination === APP_SHELL_HTML_DESTINATION && sourceToRegExp(r.source).test(page.path)
      );
      assert.equal(shadow, undefined, `${page.path} must not be rewritten to the app shell`);
      assert.ok(
        !sourceToRegExp(SPA_HTML_CACHE_SOURCE).test(page.path),
        `${page.path} must be excluded from the pinned HTML-cache catch-all`
      );
    });
  }

  it('advertises the developer portal + resource pages across the discovery chain', () => {
    // Mirror the #4958 "advertises...on every discovery surface" guard: a page
    // that is supposed to be advertised everywhere silently going unadvertised
    // on one surface was a real drift incident. Check the api-catalog plus every
    // text discovery surface the PR wires (llms.txt, llms-full.txt, agents.md,
    // api/llms.txt).
    const catalog = JSON.parse(readFileSync(resolve(__dirname, '../public/.well-known/api-catalog'), 'utf-8'));
    const catalogHrefs = catalog.linkset.flatMap((ctx) =>
      Object.values(ctx).flatMap((v) => (Array.isArray(v) ? v.map((e) => e.href) : []))
    );
    const surfaces = ['llms.txt', 'llms-full.txt', 'agents.md', 'api/llms.txt'].map((f) => [
      f,
      readFileSync(resolve(__dirname, `../public/${f}`), 'utf-8'),
    ]);
    // The pages left the sitemap in #8608 because they are files, not pages.
    const sitemap = readFileSync(resolve(__dirname, '../public/sitemap-main.xml'), 'utf-8');
    for (const page of DEV_PAGES) {
      // www, not apex (#7660): the developer-resource pages 301 off the apex.
      const url = `https://www.worldmonitor.app${page.path}`;
      assert.ok(catalogHrefs.includes(url), `api-catalog must advertise ${url}`);
      for (const [name, content] of surfaces) {
        assert.ok(content.includes(page.path), `public/${name} must link ${page.path}`);
      }
      assert.ok(!sitemap.includes(`<loc>${url}</loc>`), `sitemap-main.xml must not declare the file ${page.path}`);
    }
  });
});

// NLWeb schemamap (orank "NLWeb Schema Feeds"): keep the file published and
// discoverable without advertising it through robots.txt. Lighthouse rejects
// the emerging `Schemamap:` directive as unknown, dropping SEO 100 -> 92 on
// every route; #4835 tracks the upstream safelist unblock. Every <loc> must
// still resolve to a tracked file or a live route — a schemamap pointing at a
// 404 is worse than none (same dead-pointer class as the deleted Wikidata QID
// incident).
describe('NLWeb schemamap (/schemamap.xml)', () => {
  const schemamapSource = readFileSync(resolve(__dirname, '../public/schemamap.xml'), 'utf-8');

  it('keeps the file published without an unsupported robots.txt directive', () => {
    assert.doesNotMatch(
      robotsSource,
      /^Schemamap:/mi,
      'Lighthouse rejects Schemamap as an unknown robots.txt directive; see #4835'
    );
    assert.match(schemamapSource, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.ok(
      schemamapSource.includes('<schemamap xmlns="http://www.nlweb.ai/schemas/schemamap/0.1">'),
      'schemamap must declare the NLWeb schemamap namespace'
    );
  });

  it('every advertised <loc> resolves to a tracked file or a live route', () => {
    const locs = [...schemamapSource.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length >= 1, 'schemamap must index at least the homepage');
    const resolvable = {
      // `/` redirects to the Lite UI, which /lite serves from lite.html.
      'https://www.worldmonitor.app/': () =>
        firstRedirectFor({ host: 'www.worldmonitor.app', path: '/' })?.destination === '/lite'
        && firstRewriteFor({ host: 'www.worldmonitor.app', path: '/lite' })?.destination === '/lite.html'
        && existsSync(resolve(__dirname, '../lite.html')),
    };
    for (const loc of locs) {
      const probe = resolvable[loc];
      assert.ok(probe, `schemamap <loc> ${loc} has no resolvability probe — add one when adding entries`);
      assert.ok(probe(), `schemamap <loc> ${loc} does not resolve to a tracked file or live route`);
    }
    // Each entry must pair the loc with a schema.org type. Line-anchored so
    // the explanatory XML comment (which names the tags) doesn't count.
    const entries = schemamapSource.match(/^ {2}<url>$/gm) || [];
    const schemas = schemamapSource.match(/<schema>https:\/\/schema\.org\/[A-Za-z]+<\/schema>/g) || [];
    assert.equal(entries.length, locs.length);
    assert.equal(schemas.length, locs.length, 'every schemamap entry needs a schema.org type');
  });

  it('the schemamap.xml headers rule serves XML with CORS', () => {
    const rule = vercelConfig.headers.find((h) => h.source === '/schemamap.xml');
    assert.ok(rule, 'vercel.json must carry a /schemamap.xml headers rule');
    const keys = Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
    assert.match(keys['Content-Type'], /application\/xml/);
    assert.equal(keys['Access-Control-Allow-Origin'], '*');
  });
});

// Docs MCP: the api/docs-mcp.ts facade is gone, so /docs/mcp must reach the
// Mintlify docs rewrite (which serves the docs MCP server) and nothing else.
describe('docs MCP (/docs/mcp)', () => {
  it('routes /docs/mcp to the Mintlify docs rewrite, with no leftover facade', () => {
    const rule = firstRewriteFor({ host: 'www.worldmonitor.app', path: '/docs/mcp' });
    assert.ok(rule, '/docs/mcp must match a rewrite');
    assert.match(String(rule.destination), /mintlify\.dev/, '/docs/mcp must reach the Mintlify docs rewrite');
    assert.equal(vercelConfig.rewrites.some((r) => r.destination === '/api/docs-mcp'), false);
  });

  it('the first-party docs server card still points at the /docs/mcp URL', () => {
    const card = JSON.parse(
      readFileSync(resolve(__dirname, '../public/.well-known/mcp/docs-server-card.json'), 'utf-8')
    );
    assert.equal(card.url, 'https://www.worldmonitor.app/docs/mcp');
    assert.equal(card.serverUrl, 'https://www.worldmonitor.app/docs/mcp');
  });
});

// Modular llms.txt (orank "Modular llms.txt per product area"): section-scoped
// files must exist and the site-wide llms.txt must cross-link every section so
// agents can discover them without probing paths blind.
describe('section-scoped llms.txt files', () => {
  it('tracked section files exist', () => {
    for (const path of ['../public/api/llms.txt', '../public/developers/llms.txt']) {
      assert.ok(existsSync(resolve(__dirname, path)), `${path} must exist`);
    }
  });

  it('the site-wide llms.txt cross-links every section file and the sandbox', () => {
    const llms = readFileSync(resolve(__dirname, '../public/llms.txt'), 'utf-8');
    for (const url of [
      'https://www.worldmonitor.app/api/llms.txt',
      'https://www.worldmonitor.app/docs/llms.txt',
      'https://www.worldmonitor.app/developers/llms.txt',
      'https://www.worldmonitor.app/sandbox/index.json',
      'https://www.worldmonitor.app/schemamap.xml',
    ]) {
      assert.ok(llms.includes(url), `public/llms.txt must link ${url}`);
    }
  });
});

// #6832/#6833/#6834/#6835/#6836 — one Vercel project serves every host, so
// shared HTML/XML on tech/finance/commodity/happy/energy/api is crawled as
// alternates (or, for RSS, duplicates with no user-selected canonical).
describe('variant-host canonicalization (#6833–#6836)', () => {
  const docsHostRedirect = vercelConfig.redirects.find(
    (r) => r.source === '/docs/:match(.*)' && r.has
  );
  const sharedHostValue = (docsHostRedirect?.has ?? []).find((h) => h.type === 'host')?.value ?? '';
  const sharedHostRe = new RegExp(sharedHostValue);
  const dashboardVariantHosts = VARIANT_HOSTS.filter((host) => host !== 'www.worldmonitor.app');

  const hostRedirect = (source, hostNeedle) =>
    vercelConfig.redirects.find((r) => {
      if (r.source !== source) return false;
      const hostValue = (r.has ?? []).find((h) => h.type === 'host')?.value ?? '';
      return hostNeedle ? hostValue.includes(hostNeedle) : Boolean(r.has);
    });

  const SHARED_WWW_PREFIXES = [
    'country-instability-index',
    'countries',
    'chokepoints',
    'compare',
    'research',
    'tools',
    'crises',
    'use-cases',
    'reference',
    'sources',
  ];

  it('keeps the docs host regex as the single shared-content host list', () => {
    assert.ok(sharedHostValue, 'docs host redirect must exist so shared-content 308s can share its host list');
    for (const host of [...dashboardVariantHosts, 'api.worldmonitor.app']) {
      assert.match(host, sharedHostRe, `${host} must stay in the shared-content host regex`);
    }
    assert.ok(!sharedHostRe.test('www.worldmonitor.app'), 'www must not be redirected off itself');
    assert.ok(!sharedHostRe.test('worldmonitor.app'), 'apex must not inherit variant 308s');
  });

  for (const prefix of SHARED_WWW_PREFIXES) {
    it(`308s variant/api /${prefix}/* to www (#6833)`, () => {
      const redirect = hostRedirect(`/${prefix}/:match(.*)`, 'tech');
      assert.ok(redirect, `expected a host-conditioned 308 for /${prefix}/:match(.*)`);
      assert.equal(redirect.destination, `https://www.worldmonitor.app/${prefix}/:match`);
      assert.equal(redirect.permanent, true);
      const hostValue = (redirect.has ?? []).find((h) => h.type === 'host')?.value;
      assert.equal(
        hostValue,
        sharedHostValue,
        `/${prefix}/:match(.*) must reuse the /docs host regex so a new variant cannot ship uncovered`
      );
    });
  }

  // The shared corpus canonicalises to a trailing slash, so the trailing-slash
  // form is the ONLY one a crawler requests. `/${prefix}/:match*` matched
  // neither `/countries/` nor `/countries/japan/` under Vercel's strict
  // path-to-regexp, so until #7530 every variant subdomain served the whole
  // shared corpus as a 200 instead of 308-ing it to www — ~1,250 duplicate
  // crawlable URLs across five subdomains, held together only by the canonical
  // tag the pages happen to carry. Assert the canonical form explicitly.
  for (const prefix of SHARED_WWW_PREFIXES) {
    it(`308s the trailing-slash form of /${prefix}/ off variant hosts (#7530)`, () => {
      // Bare `/reference/` is claimed earlier by the host-agnostic hop to
      // /reference/changelog/, which the shared-content 308 then hands to www.
      const paths = prefix === 'reference'
        ? [`/${prefix}/example/`, `/${prefix}/example`]
        : [`/${prefix}/`, `/${prefix}/example/`, `/${prefix}/example`];
      for (const path of paths) {
        const redirect = firstRedirectFor({ host: 'tech.worldmonitor.app', path });
        assert.ok(redirect, `${path} must 308 off tech.worldmonitor.app, not serve a duplicate 200`);
        assert.equal(
          redirect.destination,
          `https://www.worldmonitor.app/${prefix}/:match`,
          `${path} must land on the www canonical`,
        );
      }

      // The BARE form is the gap this guard missed on its first pass. Because
      // `:match(.*)` no longer matches `/tools`, that path now escapes the
      // variant host only via the host-agnostic `/tools` -> `/tools/` hop, and
      // deleting that hop left the whole suite green while the tracer reported
      // the page served as a 200 duplicate. Follow the chain to its terminus
      // instead of asserting a single rule, so whichever rule carries the bare
      // form, it must still end on www.
      let path = `/${prefix}`;
      let landed = null;
      for (let hop = 0; hop < 4; hop += 1) {
        const redirect = firstRedirectFor({ host: 'tech.worldmonitor.app', path });
        assert.ok(
          redirect,
          `/${prefix} must not be served as a 200 duplicate on tech.worldmonitor.app`
            + ` (chain stalled at ${path} after ${hop} hop(s))`,
        );
        const destination = String(redirect.destination);
        if (destination.startsWith('https://www.worldmonitor.app')) {
          landed = destination;
          break;
        }
        assert.ok(
          destination.startsWith('/'),
          `/${prefix} hopped to ${destination}, which is neither www nor a same-host path`,
        );
        assert.notEqual(destination, path, `/${prefix} redirect loop at ${path}`);
        path = destination;
      }
      assert.ok(landed, `/${prefix} must reach www.worldmonitor.app within 4 hops`);
    });
  }

  it('308s prefix-less /zh/* into /docs/zh on www on every host (#6833)', () => {
    const redirect = vercelConfig.redirects.find((r) => r.source === '/zh/:match*');
    assert.ok(redirect, 'expected a redirect for /zh/:match*');
    assert.equal(redirect.destination, 'https://www.worldmonitor.app/docs/zh/:match*');
    assert.equal(redirect.permanent, true);
    assert.equal(redirect.has, undefined, '/zh/* is a Mintlify leak — must apply on www too');
  });

  it('308s product-variant / to same-host /dashboard (#6833)', () => {
    const redirect = vercelConfig.redirects.find((r) =>
      r.source === '/' && r.destination === '/dashboard'
    );
    assert.ok(redirect, 'expected a host-conditioned 308 for product-variant /');
    assert.equal(redirect.destination, '/dashboard');
    assert.equal(redirect.permanent, true);
    const hostRe = new RegExp((redirect.has ?? []).find((h) => h.type === 'host')?.value ?? '');
    for (const host of dashboardVariantHosts) {
      assert.match(host, hostRe, `${host}/ must 308 to /dashboard`);
    }
    assert.ok(!hostRe.test('www.worldmonitor.app'), 'www / must stay the welcome page');
    assert.ok(!hostRe.test('worldmonitor.app'), 'apex / must stay the welcome page');
    assert.ok(!hostRe.test('api.worldmonitor.app'), 'api / is not a product variant');
  });

  it('308s api / to www / (#6833)', () => {
    const redirect = firstRedirectFor({ host: 'api.worldmonitor.app', path: '/' });
    assert.ok(redirect, 'expected a host-conditioned 308 for api.worldmonitor.app/');
    assert.equal(redirect.destination, 'https://www.worldmonitor.app/');
    assert.equal(redirect.permanent, true);
    const hostValue = (redirect.has ?? []).find((h) => h.type === 'host')?.value ?? '';
    assert.ok(new RegExp(hostValue).test('api.worldmonitor.app'));
    assert.ok(!new RegExp(hostValue).test('www.worldmonitor.app'));
  });

  it('evaluates first-match redirects by host and path (#6833)', () => {
    const tech = 'tech.worldmonitor.app';
    assert.equal(firstRedirectFor({ host: tech, path: '/' })?.destination, '/dashboard');
    assert.equal(firstRedirectFor({ host: tech, path: '/', query: { mode: 'agent' } }), null);
    assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path: '/' })?.destination, '/lite');
    assert.equal(firstRedirectFor({ host: 'worldmonitor.app', path: '/' })?.destination, '/lite');
    assert.equal(firstRedirectFor({ host: 'api.worldmonitor.app', path: '/' })?.destination, 'https://www.worldmonitor.app/');
    assert.equal(
      firstRedirectFor({ host: tech, path: '/countries/japan/' })?.destination,
      'https://www.worldmonitor.app/countries/:match'
    );
    assert.equal(firstRedirectFor({ host: tech, path: '/dashboard' })?.destination, '/lite');
    assert.equal(
      firstRedirectFor({ host: tech, path: '/zh/mcp-error-catalog' })?.destination,
      'https://www.worldmonitor.app/docs/zh/:match*'
    );
    assert.equal(firstRewriteFor({ host: tech, path: '/', query: { mode: 'agent' } })?.destination, '/agent-view.json');
  });

  it('does not 308 variant /dashboard to www (#6833)', () => {
    const dashboardToWww = vercelConfig.redirects.filter((r) =>
      r.source === '/dashboard' && String(r.destination).includes('www.worldmonitor.app')
    );
    assert.deepEqual(dashboardToWww, [], 'variant /dashboard is the indexable product URL');
  });

  it('places shared-content 308s before host-agnostic trailing-slash redirects (#6833)', () => {
    const hostIdx = vercelConfig.redirects.findIndex((r) => r.source === '/countries/:match(.*)' && r.has);
    const slashIdx = vercelConfig.redirects.findIndex((r) => r.source === '/countries' && !r.has);
    assert.ok(hostIdx >= 0, 'missing /countries/:match(.*) host 308');
    assert.ok(slashIdx >= 0, 'missing /countries trailing-slash redirect');
    assert.ok(hostIdx < slashIdx, 'host 308s must run before same-host slash normalization');
  });

  it('rewrites variant and api /robots.txt to dedicated files (#6835)', () => {
    assert.equal(
      existsSync(resolve(__dirname, '../public/robots.txt')),
      false,
      'public/robots.txt would win filesystem precedence and ignore host rewrites (#4825 class)'
    );
    assert.ok(existsSync(resolve(__dirname, '../public/robots.www.txt')));
    assert.equal(firstRewriteFor({ host: 'tech.worldmonitor.app', path: '/robots.txt' })?.destination, '/robots.variant.txt');
    assert.equal(firstRewriteFor({ host: 'happy.worldmonitor.app', path: '/robots.txt' })?.destination, '/robots.variant.txt');
    assert.equal(firstRewriteFor({ host: 'api.worldmonitor.app', path: '/robots.txt' })?.destination, '/robots.api.txt');
    assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: '/robots.txt' })?.destination, '/robots.www.txt');
    assert.equal(
      vercelConfig.redirects.some((r) => r.source === '/robots.txt'),
      false,
      '/robots.txt must 200 on every host — never 308 to www'
    );
  });

  it('variant robots.txt keeps /dashboard crawlable and does not Disallow 308 families (#6835)', () => {
    const body = readFileSync(resolve(__dirname, '../public/robots.variant.txt'), 'utf-8');
    for (const path of [...SHARED_WWW_PREFIXES.map((p) => `/${p}`), '/docs', '/zh']) {
      assert.doesNotMatch(
        body,
        new RegExp(`^Disallow: ${path.replace('/', '\\/')}$`, 'm'),
        `Disallow ${path} would hide the 308 from a compliant crawler`
      );
    }
    for (const path of ['/pro', '/api/', '/tests/']) {
      assert.match(body, new RegExp(`^Disallow: ${path.replace('/', '\\/')}$`, 'm'), `variant robots must Disallow ${path}`);
    }
    // End-anchored since #7660. Unanchored, `/dashboard` is 10 characters and
    // out-ranks the 8-9 character `/*?*lat=`, `/*?*lon=`, `/*?*zoom=`,
    // `/*?*ref=` and `/*?*utm_` rules, so any map URL omitting `layers` slipped
    // straight through on the one path that generates the space. `$` keeps the
    // bare document explicitly crawlable without covering its query forms.
    assert.match(body, /^Allow: \/dashboard\$$/m);
    assert.doesNotMatch(body, /^Allow: \/dashboard$/m);
    assert.doesNotMatch(body, /^Disallow: \/dashboard\$?$/m);
    assert.match(body, /^Sitemap: https:\/\/www\.worldmonitor\.app\/sitemap\.xml$/m);
  });

  it('api robots.txt does not invite a marketing crawl of / (#6835)', () => {
    const body = readFileSync(resolve(__dirname, '../public/robots.api.txt'), 'utf-8');
    assert.match(body, /^Disallow: \/$/m);
    assert.match(body, /^Allow: \/api\/llms\.txt$/m);
    assert.match(body, /^Allow: \/api\/product-catalog$/m);
    assert.match(body, /^Allow: \/\.well-known\/$/m);
    assert.match(body, /^Allow: \/mcp$/m);
    assert.match(body, /^Allow: \/a2a$/m);
    assert.match(body, /^Allow: \/llms\.txt$/m);
    assert.match(body, /^Disallow: \/pro$/m);
  });

  it('308s www /reference/ to the changelog so empty :match* is not a 404', () => {
    assert.equal(
      firstRedirectFor({ host: 'www.worldmonitor.app', path: '/reference/' })?.destination,
      '/reference/changelog/',
    );
    assert.equal(
      firstRedirectFor({ host: 'tech.worldmonitor.app', path: '/reference/' })?.destination,
      '/reference/changelog/',
    );
    // Bare `/reference` is normalised on the variant host first, then handed to
    // www by the shared-content 308 — two hops, same destination.
    assert.equal(
      firstRedirectFor({ host: 'tech.worldmonitor.app', path: '/reference' })?.destination,
      '/reference/changelog/',
    );
    assert.equal(
      firstRedirectFor({ host: 'tech.worldmonitor.app', path: '/reference/changelog/' })?.destination,
      'https://www.worldmonitor.app/reference/:match',
    );
  });

  it('keeps the pinned HTML-cache catch-all header without a serving counterpart', () => {
    // #6575: the negative-lookahead rewrite is gone (unknown paths 404). The
    // cache-header catch-all stays as the pinned no-cache rule for HTML-ish
    // paths; it no longer needs a byte-identical rewrite sibling.
    const catchAllHeader = vercelConfig.headers.find((r) => r.source === SPA_HTML_CACHE_SOURCE);
    assert.ok(catchAllHeader, 'expected the pinned SPA cache-header rule');
    assert.equal(getCacheHeaderValue(SPA_HTML_CACHE_SOURCE), 'private, no-cache, must-revalidate');
    // Explicit /dashboard entry uses the stacked public HTML policy; other SPA
    // pretty-URLs still inherit the catch-all private policy.
    assertPublicHtmlEntryCache('/dashboard');
    for (const path of ['/stocks', '/stocks/AAPL', '/story']) {
      assert.equal(effectiveCacheControl(path), 'private, no-cache, must-revalidate', path + ' must stay no-cache');
    }
  });

  it('variant and api robots keep AI-group rule parity with their own * group (#6835)', () => {
    for (const file of ['robots.variant.txt', 'robots.api.txt']) {
      const groups = parseRobotsGroups(readFileSync(resolve(__dirname, `../public/${file}`), 'utf-8'));
      const star = groups.find((g) => g.agents.includes('*'));
      const ai = groups.find((g) => g.agents.includes('gptbot'));
      const training = groups.find((g) => g.agents.includes('ccbot'));
      assert.ok(star, `${file} must have a * group`);
      assert.ok(ai, `${file} must restate the AI search/assistant group`);
      assert.deepStrictEqual(
        [...ai.rules].sort(),
        [...star.rules].sort(),
        `${file} AI group must restate the * rules`
      );
      assert.deepStrictEqual(training?.rules, ['disallow: /']);
    }
  });

  it('keeps leaked source/tmp/server paths off every app shell (#6836, #6575)', () => {
    for (const path of [
      '/src/generated/server/worldmonitor/seismology/v1/service_server',
      '/tmp/gem-drops.log',
      '/server/worldmonitor/intelligence/v1/_risk-config.ts',
      '/llms*.txt',
      '/country-intel',
    ]) {
      assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path }), null, `${path} must 404 instead of serving an app shell`);
    }
    // The old client-side History routes now redirect to the Lite UI.
    for (const path of ['/stocks', '/stocks/AAPL', '/story']) {
      assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path })?.destination, '/lite', path);
      assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path }), null, path);
    }
    assert.equal(firstRewriteFor({ host: 'www.worldmonitor.app', path: '/stocks/foo/bar' }), null);
    assert.ok(SPA_HTML_CACHE_SOURCE.includes('|src|'), 'HTML cache catch-all must exclude /src');
    assert.ok(SPA_HTML_CACHE_SOURCE.includes('|tmp|'), 'HTML cache catch-all must exclude /tmp');
    assert.ok(SPA_HTML_CACHE_SOURCE.includes('|server|'), 'HTML cache catch-all must exclude /server');
  });
});

// Google Connected Console fetches this file to verify domain ownership and
// rejects any redirect (https://developers.google.com/connected-apps/gpc/perform-the-steps).
// The file's own shape is pinned in tests/google-connected-apps-verification.test.mjs.
describe('Google Connected Apps verification route', () => {
  const path = '/.well-known/google-connected-apps';

  it('is served directly as JSON on every host Google may fetch', () => {
    for (const host of ['worldmonitor.app', 'www.worldmonitor.app']) {
      assert.equal(firstRedirectFor({ host, path }), null, `${host}${path} must not redirect`);
      assert.equal(firstRewriteFor({ host, path }), null, `${host}${path} must serve the static file`);
    }
    assert.equal(effectiveHeader(path, 'content-type'), 'application/json; charset=utf-8');
  });

  it('would catch a wildcard rule that does not name the file', () => {
    for (const source of ['/.well-known/(.*)', '/.well-known/:path*', '/:path*']) {
      assert.equal(sourceToRegExp(source).test(path), true, `${source} must be modelled as matching ${path}`);
    }
  });
});
