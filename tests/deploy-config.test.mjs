import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync as originalReadFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
function readFileSync(path, options) {
  const content = originalReadFileSync(path, options);
  if (typeof content === 'string') {
    return content.replace(/\r\n/g, '\n');
  }
  return content;
}

import { fileURLToPath } from 'node:url';
import { guardBuiltOutput, shouldSkipBuiltOutput } from './_lib/built-output-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));
// The web app's own manifest (refactor PR 2.5): the root build runs its build.
const webPackageJson = JSON.parse(readFileSync(resolve(__dirname, '../apps/web/package.json'), 'utf-8'));
const vercelConfig = JSON.parse(readFileSync(resolve(__dirname, '../vercel.json'), 'utf-8'));
const viteConfigSource = readFileSync(resolve(__dirname, '../apps/web/vite.config.ts'), 'utf-8');
const middlewareSource = readFileSync(resolve(__dirname, '../middleware.ts'), 'utf-8');
const dockerfileSource = readFileSync(resolve(__dirname, '../Dockerfile'), 'utf-8');
const dockerNginxSource = readFileSync(resolve(__dirname, '../docker/nginx.conf'), 'utf-8');
const frontendDockerfileSource = readFileSync(resolve(__dirname, '../docker/Dockerfile'), 'utf-8');
const dockerignoreSource = readFileSync(resolve(__dirname, '../.dockerignore'), 'utf-8');
const vercelIgnoreSource = readFileSync(resolve(__dirname, '../scripts/vercel-ignore.sh'), 'utf-8');
const SPA_HTML_CACHE_SOURCE = '/((?!api|assets|src|tmp|server|favico|map-styles|data|textures|sw\\.js|workbox-[a-f0-9]+\\.js|manifest\\.webmanifest|offline\\.html|robots\\.txt|\\.well-known|desktop-sign-in\\.html|desktop-sign-in).*)';
const GLOBAL_SECURITY_HEADER_SOURCE = '/(.*)';
const WEBMCP_PRODUCTION_HOST_PATTERN = '^(?:www|tech|finance|commodity|happy|energy)\\.worldmonitor\\.app$';
const GLOBAL_CSP_INLINE_SCRIPT_HTML_FILES = [
  'apps/web/lite.html',
  'public/offline.html',
];
const GLOBAL_CSP_EXTERNAL_SCRIPT_HTML_FILES = [
  'apps/web/lite.html',
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

// The /data/v1 open-data files (chokepoint CSV/JSON) left with the public
// open-data product in 2026-11; /data keeps the map's static geometry.
describe('static data under /data', () => {
  it('leaves /data assets immutable', () => {
    assert.equal(effectiveCacheControl('/data/countries-50m.json'), 'public, max-age=31536000, immutable');
  });

  const nginxLocation = (prefix) => {
    const match = dockerNginxSource.match(new RegExp(`^ {4}location ${prefix.replace(/\//g, '\\/')} \\{\\n([\\s\\S]*?)^ {4}\\}`, 'm'));
    assert.ok(match, `docker/nginx.conf must declare location ${prefix}`);
    return match[1];
  };

  it('gives the self-hosted image the same immutable rule for /data/', () => {
    assert.match(nginxLocation('/data/'), /add_header Cache-Control "public, max-age=31536000, immutable";/);
    assert.doesNotMatch(dockerNginxSource, /location \/data\/v1\//);
  });
});

describe('deploy/cache configuration guardrails', () => {
  it('requires revalidation for HTML entry routes on Vercel without disabling bfcache', () => {
    // The SPA negative-lookahead excludes paths with their own Cache-Control
    // rule. It uses literal alternation rather than a non-capturing group with
    // a `?` quantifier — Vercel's path-to-regexp source-pattern parser rejects
    // `(?:...)` in `source` fields (deploy-fail PR #3646 round-2 review).
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
    assert.match(webPackageJson.scripts.build, / && npm --prefix \.\.\/\.\. run check:source-maps$/);
    assert.equal(packageJson.scripts['check:source-maps'], 'node --import tsx scripts/check-no-public-source-maps.mjs dist');
  });
});

// The only app shell. Guards below assert that no rewrite to it shadows a
// static or API path.
const APP_SHELL_HTML_DESTINATION = '/lite.html';

describe('welcome landing page routing', () => {
  // The /pro welcome rewrite left with the marketing site (refactor Phase 1b)
  // and the /?mode=agent view with the agent outputs (1c-3), so no `/`
  // rewrite remains: `/` redirects to /lite.
  const plainRootRewrites = () =>
    vercelConfig.rewrites.filter(
      (r) => r.source === '/' && !(r.has ?? []).some((condition) => condition.type === 'query')
    );

  // #4825: public/index.md became Vercel's DIRECTORY INDEX for `/` and served
  // raw text/markdown to browsers at the apex. No `index.*` file may exist in
  // public/.
  it('keeps public/ free of index.* files so filesystem resolution cannot hijack /', () => {
    const publicDir = resolve(__dirname, '../public');
    const offenders = readdirSync(publicDir).filter((f) => /^index\./i.test(f));
    assert.deepEqual(offenders, [], `public/${offenders[0] ?? ''} would shadow / as a directory index`);
  });

  it('serves no plain / rewrite, so / can only redirect to /lite', () => {
    assert.deepEqual(plainRootRewrites(), [], 'a plain / rewrite would shadow the /lite redirect target with a removed page');
  });

  // vercel.json owns the default route: its redirects run before middleware.ts,
  // match on the path only (no `has: query` rule may intercept), and Vercel
  // carries the request query string over to the destination. So a shared map
  // link, the old ?full=1 escape and a preview or former variant host all
  // land on /lite with their query, in one temporary (307) hop.
  it('sends /, /dashboard and every query on them to /lite on every host, with one 307', () => {
    const hosts = [
      'www.worldmonitor.app',
      'worldmonitor.app',
      'tech.worldmonitor.app',
      'finance.worldmonitor.app',
      'worldmonitor-h0zk88n4l-eliewm.vercel.app',
      'monitor.example.com',
    ];
    const queries = [{}, { lat: '1', lon: '2' }, { full: '1' }, { layers: 'conflicts', zoom: '3' }, { mode: 'agent' }];
    for (const host of hosts) {
      for (const path of ['/', '/dashboard', '/dashboard/']) {
        for (const query of queries) {
          const label = `${host}${path}?${new URLSearchParams(query)}`;
          const redirect = firstRedirectFor({ host, path, query });
          assert.equal(redirect?.destination, '/lite', `${label} must redirect to /lite`);
          assert.equal(redirect.permanent, false, `${label} must be a 307, not a cached 308`);
          assert.equal(firstRewriteFor({ host, path: redirect.destination })?.destination, '/lite.html');
        }
      }
    }
    for (const rule of vercelConfig.redirects.filter((r) => ['/', '/dashboard', '/dashboard/'].includes(r.source))) {
      assert.ok(!String(rule.destination).includes('?'), `${rule.source}: a destination query would replace the request's`);
      assert.ok(!(rule.has ?? []).some((c) => c.type === 'query'), `${rule.source}: no query-conditioned exception`);
    }
    // api.worldmonitor.app is not a page host; its root goes to www, which then
    // takes the rule above.
    assert.equal(firstRedirectFor({ host: 'api.worldmonitor.app', path: '/' })?.destination, 'https://www.worldmonitor.app/');
    assert.equal(firstRedirectFor({ host: 'preview.vercel.app', path: '/missing-page' }), null);
  });

  it('leaves the default route to vercel.json: middleware.ts has no dashboard or profile branch', () => {
    assert.doesNotMatch(middlewareSource, /['"]\/dashboard/, 'middleware must not redirect to the deleted dashboard');
    assert.doesNotMatch(middlewareSource, /VITE_LITE_PROFILE|lite-route|LEGACY_DASHBOARD/);
    assert.match(
      middlewareSource,
      /'CDN-Cache-Control': 'no-store',\n\s*'Vercel-CDN-Cache-Control': 'no-store',/,
      'the crawler redirect must stay out of every shared cache',
    );
  });

  it('redirects / and the old dashboard routes to /lite temporarily, and serves no dashboard document', () => {
    assert.deepEqual(vercelConfig.redirects.filter((r) => r.destination === '/lite'), [
      { source: '/CLERK-ROUTER/:path*', destination: '/lite', permanent: false },
      { source: '/settings', destination: '/lite', permanent: false },
      { source: '/dashboard/', destination: '/lite', permanent: false },
      { source: '/', destination: '/lite', permanent: false },
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
      // The /?mode=agent view left with the agent outputs (1c-3).
      assert.equal(firstRedirectFor({ host, path: '/', query: { mode: 'agent' } })?.destination, '/lite');
      assert.equal(firstRewriteFor({ host, path: '/', query: { mode: 'agent' } }), null);
    }
    // Trailing-slash forms canonicalise first, then take the redirect above.
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

  it('sends a followed Clerk virtual-router href to /lite instead of a 404', () => {
    const redirect = firstRedirectFor({
      host: 'www.worldmonitor.app',
      path: '/CLERK-ROUTER/VIRTUAL/sign-in/factor-one',
    });
    assert.ok(redirect, 'expected a redirect for /CLERK-ROUTER/*');
    assert.equal(redirect.destination, '/lite');
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

  it('requires revalidation for /dashboard HTML without disabling bfcache', () => {
    assertPublicHtmlEntryCache('/dashboard');
  });

  it('requires revalidation for root welcome HTML without disabling bfcache', () => {
    assertPublicHtmlEntryCache('/');
  });

  it('requires revalidation for direct dashboard.html without disabling bfcache', () => {
    assertPublicHtmlEntryCache('/dashboard.html');
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
  const rule = vercelConfig.headers.find((entry) => entry.source === GLOBAL_SECURITY_HEADER_SOURCE && !entry.has);
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
        /include \/etc\/nginx\/(?:oauth_authorize_|youtube_embed_)?security_headers\.conf;/,
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
    const liteHtml = readFileSync(resolve(__dirname, '../apps/web/lite.html'), 'utf-8');
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
    const liteHtml = readFileSync(resolve(__dirname, '../apps/web/lite.html'), 'utf-8');
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
    const liteHtml = readFileSync(resolve(__dirname, '../apps/web/lite.html'), 'utf-8');
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
    const liteHtml = readFileSync(resolve(__dirname, '../apps/web/lite.html'), 'utf-8');
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
      assert.match(src, /^ {4}location = \/ \{ return 307 \/lite\$is_args\$args; \}$/m, `${conf}: / must 307 to /lite with its query`);
      // A relative Location: nginx does not know the published port or scheme.
      assert.match(src, /^ {4}absolute_redirect off;$/m, `${conf}: redirects must keep a relative Location`);
      assert.match(
        src,
        /^ {4}location ~ \^\/\(\?:dashboard\|story\|stocks\(\?:\/\[\^\/\]\+\)\?\)\/\?\$ \{ return 307 \/lite\$is_args\$args; \}$/m,
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

// #6832/#6833/#6834/#6835/#6836 — one Vercel project serves every host, so
// shared HTML/XML on tech/finance/commodity/happy/energy/api is crawled as
// alternates (or, for RSS, duplicates with no user-selected canonical).
describe('variant-host canonicalization (#6833–#6836)', () => {
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
    assert.equal(firstRedirectFor({ host: tech, path: '/' })?.destination, '/lite');
    assert.equal(firstRedirectFor({ host: 'www.worldmonitor.app', path: '/' })?.destination, '/lite');
    assert.equal(firstRedirectFor({ host: 'worldmonitor.app', path: '/' })?.destination, '/lite');
    assert.equal(firstRedirectFor({ host: 'api.worldmonitor.app', path: '/' })?.destination, 'https://www.worldmonitor.app/');
    assert.equal(firstRedirectFor({ host: tech, path: '/dashboard' })?.destination, '/lite');
    // The shared docs/corpus 308s to www left with those pages (1c-3).
    assert.equal(firstRedirectFor({ host: tech, path: '/countries/japan/' }), null);
    assert.equal(firstRedirectFor({ host: tech, path: '/docs/zh/x' }), null);
  });

  it('does not 308 variant /dashboard to www (#6833)', () => {
    const dashboardToWww = vercelConfig.redirects.filter((r) =>
      r.source === '/dashboard' && String(r.destination).includes('www.worldmonitor.app')
    );
    assert.deepEqual(dashboardToWww, [], 'variant /dashboard is the indexable product URL');
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

// Lite deploy contracts: the build command, the Docker Lite build, the
// Vercel ignore step and the Docker build context. They lived in the corpus
// describe until refactor Phase 1c-3 deleted the corpus.
describe('Lite deploy contracts', () => {
  it('pins the deploy build command in vercel.json to the Lite build', () => {
    // vercel.json overrides the dashboard's Build Command, which is where this
    // used to live -- invisible to the repo and changeable without a diff.
    // The Lite UI is the only web app: the deploy build is the secrets check,
    // the browser typecheck, the Lite Vite build and the source-map gate.
    // Since refactor PR 2.5 it is the web app's build (apps/web), which runs
    // the two root checks from the repository root; the root build delegates
    // to it. build:full stays as an alias so older callers build the same thing.
    assert.equal(
      vercelConfig.buildCommand,
      'npm run build',
      'vercel.json must pin buildCommand so the deploy contract lives in the repo, not the dashboard',
    );
    // The Vite config lives in apps/web since refactor PR 2.5, so the output
    // directory must not depend on the dashboard's framework detection.
    assert.equal(vercelConfig.outputDirectory, 'dist');
    assert.equal(packageJson.scripts.build, 'npm run build -w @wm/web');
    assert.equal(
      webPackageJson.scripts.build,
      'npm --prefix ../.. run security:vite-env-secrets -- --strict-local && tsc && cross-env VITE_CONFIG_NATIVE_IGNORE_WARNING=true vite build && npm --prefix ../.. run check:source-maps',
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
      assert.match(source, /^RUN npx tsc && npx vite build --config apps\/web\/vite\.config\.ts$/m, name + ' must run the Lite Vite build');
      assert.deepEqual(source.match(/^RUN .*vite build.*$/gm), ['RUN npx tsc && npx vite build --config apps/web/vite.config.ts'], name + ' must run exactly one Vite build');
      assert.doesNotMatch(source, /--config vite\.lite\.config\.ts/, name + ' must not build a second Vite config');
      assert.doesNotMatch(source, /npm run build:crawlable-corpus/, name + ' must not build the static corpus');
      assert.doesNotMatch(source, /npm run build:sitemap/, name + ' must not generate the root sitemap');
      assert.doesNotMatch(source, /npm run build:pro/, name + ' must not call the deleted /pro build');
      assert.doesNotMatch(source, /dist\/pro\//, name + ' must not expect /pro pages in dist/');
    }
    // The self-host image bundles Edge handlers that read the generated
    // inventory module, so it must exist before handler bundling.
    const inventoryAt = dockerfileSource.indexOf('node scripts/generate-inventory-facts.mjs');
    assert.ok(inventoryAt >= 0, 'the self-host image must generate the inventory facts');
    assert.ok(
      inventoryAt < dockerfileSource.indexOf('node docker/build-handlers.mjs'),
      'the self-host image must generate the Edge inventory module before handler bundling',
    );
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

  it('builds Vercel when the Lite entry or its Vite config changes, and watches no deleted entry', () => {
    // The web app (lite.html, src/lite/, the Vite configs) lives in apps/web
    // since refactor PR 2.5, so 'apps/' covers it on main and on previews.
    assert.equal(vercelIgnoreSource.split(`'apps/'`).length - 1, 2, 'apps/ must trigger main and preview builds');
    for (const path of ['index.html', 'vite.lite.config.ts', 'src/', 'lite.html', 'vite.config.ts', 'vite.dev-api.ts']) {
      assert.equal(vercelIgnoreSource.includes(`'${path}'`), false, `${path} was deleted or moved to apps/web and must not be watched`);
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
    assert.ok(vercelConfig.headers.length > 10, 'expected the header rule set to be non-trivial');
  });

  it('self-hosted docker/nginx.conf SPA fallback ships the full dashboard CSP', () => {
    // Image A (root Dockerfile -> docker/nginx.conf, nginx + Node API under
    // supervisord) inlines headers per location instead of including
    // security_headers.conf. The SPA fallback (location /) must still carry the
    // dashboard CSP, or the containerized dashboard runs CSP-less while /embed
    // was locked down.
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

  it('runs no npm prebuild hooks: the build scripts are the whole build', () => {
    // The Lite build dropped the variant builds and their prebuild hooks
    // (product facts, agent-skills index, OpenAPI copy); nothing fires as a
    // hidden hook.
    assert.deepEqual(Object.keys(packageJson.scripts).filter((name) => name.startsWith('prebuild')), []);
    for (const name of ['build', 'build:full']) {
      assert.doesNotMatch(packageJson.scripts[name], /npm run (?:product:facts|build:openapi)\b/, `${name} must not chain a deleted generator`);
    }
    assert.deepEqual(Object.keys(webPackageJson.scripts).filter((name) => name.startsWith('prebuild')), []);
    assert.doesNotMatch(webPackageJson.scripts.build, /npm (?:--prefix \S+ )?run (?:product:facts|build:openapi)\b/);
    assert.match(webPackageJson.scripts.build, /&& tsc && cross-env VITE_CONFIG_NATIVE_IGNORE_WARNING=true vite build && /);
  });

  it('does not reintroduce a shadowing /api/:path* → /api/not-found rewrite', () => {
    const shadow = (vercelConfig.rewrites ?? []).find((r) =>
      r.destination === '/api/not-found' && /^\/api\/(?::[^/]*\*|\(\.\*\))$/.test(r.source ?? '')
    );
    assert.equal(shadow, undefined, 'do not add /api/:path* → /api/not-found; it shadows [rpc].ts gateways (#4724)');
  });
});
