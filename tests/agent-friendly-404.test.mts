import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import middleware, { config as middlewareConfig } from '../middleware.ts';
import {
  AGENT_NOT_FOUND_CONTENT_TYPE,
  AGENT_NOT_FOUND_PASSTHROUGH_PREFIXES,
  AGENT_NOT_FOUND_STATUS,
  HUMAN_NOT_FOUND_CONTENT_TYPE,
  buildAgentNotFoundMarkdown,
  HUMAN_NOT_FOUND_SECTIONS,
  buildHumanNotFoundHtml,
  isKnownPublicPagePath,
  prefersAgentNotFound,
  suggestNotFoundSection,
} from '../packages/server/_shared/agent-not-found.ts';
import { LITE_SCREEN_PATHS } from '../packages/client/config/lite-route.ts';

const vercelConfig = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../vercel.json'), 'utf8'),
) as {
  redirects: Array<{ source: string }>;
  rewrites: Array<{ source: string; destination: string }>;
};

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CHROME_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const CURL_UA = 'curl/8.4.0';

function call(
  path: string,
  init: { method?: string; ua?: string; accept?: string } = {},
): Response | void {
  const headers: Record<string, string> = {
    host: 'www.worldmonitor.app',
    'user-agent': init.ua ?? CURL_UA,
  };
  if (init.accept !== undefined) headers.accept = init.accept;
  return middleware(
    new Request(`https://www.worldmonitor.app${path}`, {
      method: init.method ?? 'GET',
      headers,
    }),
  ) as Response | void;
}

function examplePathFromSource(source: string): string | null {
  if (source.includes('(?!')) return null;
  const path = source
    .replace(/:[A-Za-z0-9_]+(\([^)]+\))?/g, (_match, pattern: string | undefined) => {
      const extension = pattern?.match(/\\\.([A-Za-z0-9]+)\)$/)?.[1];
      return extension ? `x.${extension}` : 'x';
    })
    .replace(/\*+/g, 'x');
  if (!path.startsWith('/')) return null;
  if (/\.[A-Za-z0-9]+$/.test(path)) return null;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

describe('prefersAgentNotFound (content negotiation)', () => {
  it('treats browser Accept: text/html as a human 404', () => {
    assert.equal(prefersAgentNotFound(CHROME_ACCEPT), false);
    assert.equal(prefersAgentNotFound('text/html'), false);
  });

  it('treats curl */*, missing Accept, and text/markdown as agent 404s', () => {
    assert.equal(prefersAgentNotFound('*/*'), true);
    assert.equal(prefersAgentNotFound(null), true);
    assert.equal(prefersAgentNotFound(''), true);
    assert.equal(prefersAgentNotFound('text/markdown'), true);
    assert.equal(prefersAgentNotFound('text/html;q=0.8, text/markdown'), true);
  });

  it('uses explicit media qualities before text wildcards', () => {
    assert.equal(prefersAgentNotFound('text/*;q=0.8, text/markdown;q=0.1, text/html;q=0.5'), false);
    assert.equal(prefersAgentNotFound('text/*;q=0.8, text/html;q=0.1, text/markdown;q=0.5'), true);
  });
});

describe('agent-friendly 404s (orank agent-friendly-404)', () => {
  it('returns HTTP 404 markdown that points agents at the Lite UI', async () => {
    const res = call('/some-path-that-does-not-exist', { accept: '*/*' });
    assert.ok(res instanceof Response, 'unknown paths must not fall through as a soft-404');
    assert.equal(res.status, AGENT_NOT_FOUND_STATUS);
    assert.equal(res.headers.get('content-type'), AGENT_NOT_FOUND_CONTENT_TYPE);
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);
    const body = await res.text();
    assert.ok(body.startsWith('# Not found'), 'body must be heading-led markdown, not an HTML app shell');
    assert.ok(body.includes('/some-path-that-does-not-exist'));
    assert.ok(body.includes(`(${LITE_SCREEN_PATHS.briefing})`));
    // The deployment is private: no public agent indexes to advertise.
    assert.doesNotMatch(body, /llms\.txt|sitemap|\/docs\//);
  });

  it('answers agent HEAD with 404 markdown and no body', async () => {
    const res = call('/this-is-not-a-page', { method: 'HEAD', accept: '*/*' });
    assert.ok(res instanceof Response);
    assert.equal(res.status, AGENT_NOT_FOUND_STATUS);
    assert.equal(res.headers.get('content-type'), AGENT_NOT_FOUND_CONTENT_TYPE);
    assert.equal(await res.text(), '');
  });

  it('serves browsers an HTML 404 instead of the agent markdown body', async () => {
    const res = call('/some-path-that-does-not-exist', {
      ua: CHROME_UA,
      accept: CHROME_ACCEPT,
    });
    assert.ok(res instanceof Response, 'humans must still get a real HTTP 404, not a soft-404 SPA');
    assert.equal(res.status, AGENT_NOT_FOUND_STATUS);
    assert.equal(res.headers.get('content-type'), HUMAN_NOT_FOUND_CONTENT_TYPE);
    const body = await res.text();
    assert.match(body, /<!DOCTYPE html>/i);
    assert.match(body, /<html/i);
    assert.match(body, /Page not found/i);
    assert.doesNotMatch(body, /^# Not found/m);
    assert.ok(body.includes(`href="${LITE_SCREEN_PATHS.briefing}"`));
    assert.doesNotMatch(body, /\/docs\//);
  });

  it('answers browser HEAD with 404 HTML and no body', async () => {
    const res = call('/this-is-not-a-page', {
      method: 'HEAD',
      ua: CHROME_UA,
      accept: CHROME_ACCEPT,
    });
    assert.ok(res instanceof Response);
    assert.equal(res.status, AGENT_NOT_FOUND_STATUS);
    assert.equal(res.headers.get('content-type'), HUMAN_NOT_FOUND_CONTENT_TYPE);
    assert.equal(await res.text(), '');
  });

  it('HTML-escapes a hostile path in the human 404 body', () => {
    const body = buildHumanNotFoundHtml('/<script>alert(1)</script>');
    assert.ok(body.includes('&lt;script&gt;'));
    assert.doesNotMatch(body, /<script>alert\(1\)<\/script>/);
  });

  it('does not intercept known product routes or mutating methods', () => {
    for (const path of ['/', '/dashboard', '/stocks/AAPL', '/story', ...Object.values(LITE_SCREEN_PATHS)]) {
      assert.equal(call(path, { accept: '*/*' }), undefined, `${path} must keep its vercel.json route`);
    }
    // The /pro and /blog builds (refactor Phase 1b), the docs site, the
    // crawlable corpus and the public agent pages (1c-3) are gone, so their
    // paths get the agent-friendly 404 rather than Vercel's static HTML one.
    for (const path of ['/pro', '/pro/welcome.html', '/blog/some-post', '/pricing', '/docs/mcp', '/countries/united-states', '/trust', '/es/']) {
      assert.ok(call(path, { accept: 'text/markdown' }), `${path} has no route and must not pass through`);
    }
    assert.equal(call('/some-path-that-does-not-exist', { method: 'POST', accept: '*/*' }), undefined);
  });

  it('404s leaked SPA guesses that used to soft-404 the dashboard (#6575, #6836)', async () => {
    for (const path of ['/country-intel', '/security']) {
      const res = call(path, { accept: '*/*' });
      assert.ok(res instanceof Response, `${path} must 404`);
      assert.equal(res.status, 404);
    }
  });

  it('passthrough list covers every extensionless vercel.json redirect and rewrite source', () => {
    const sources = [...vercelConfig.redirects, ...vercelConfig.rewrites].map((rule) => rule.source);
    const missed: string[] = [];
    for (const source of sources) {
      const example = examplePathFromSource(source);
      if (!example) continue;
      if (!isKnownPublicPagePath(example)) missed.push(`${source} (example ${example})`);
    }
    assert.deepEqual(missed, [], 'new vercel.json routes must be added to AGENT_NOT_FOUND_PASSTHROUGH_PREFIXES');
  });

  it('keeps constrained static asset rewrites out of extensionless page inventory', () => {
    const source = '/plugin/assets/boot-:attempt([0-9]+)/:asset([a-zA-Z0-9_.-]+\\.js)';
    assert.equal(examplePathFromSource(source), null);
    assert.equal(examplePathFromSource('/countries/:slug([a-z-]+)'), '/countries/x');
    assert.equal(
      new RegExp(`^${middlewareConfig.matcher[2]}$`).test('/plugin/assets/boot-1/market-fixture.js'),
      false,
    );
  });

  it('does not reintroduce a rewrite that would 200 the markdown 404 body', () => {
    const markdown404 = vercelConfig.rewrites.find((rule) =>
      /not-found|404/.test(`${rule.source} ${rule.destination}`),
    );
    assert.equal(
      markdown404,
      undefined,
      'a rewrite to the markdown 404 would surface HTTP 200 (the orank soft-404)',
    );
  });

  it('keeps public/404.html as the human HTML filesystem 404', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../public/404.html'), 'utf8');
    assert.equal(html, buildHumanNotFoundHtml());
    assert.match(html, /<!DOCTYPE html>/i, 'Vercel filesystem 404s must be a human HTML page');
    assert.match(html, /Page not found/i);
    assert.ok(html.includes(`href="${LITE_SCREEN_PATHS.briefing}"`));
    assert.doesNotMatch(html, /\/docs\//);
    assert.doesNotMatch(html, /^# Not found/m);
    assert.ok(buildAgentNotFoundMarkdown('/missing').includes(LITE_SCREEN_PATHS.briefing));
  });
});

describe('human 404 guides a lost reader to a real page', () => {
  it('suggests the section a mistyped or singular first segment was reaching for', () => {
    const cases: Array<[string, string | null]> = [
      ['/geopolitcs/iran', LITE_SCREEN_PATHS.geopolitics],
      ['/conflict/sudan', LITE_SCREEN_PATHS.geopolitics],
      ['/market/spx', LITE_SCREEN_PATHS.finance],
      ['/technolgy', LITE_SCREEN_PATHS.tech],
      ['/source', LITE_SCREEN_PATHS.sources],
      ['/documentation', null],
      ['/blogs/some-post', null],
      ["/'to", null],
      ['/zzzzzz', null],
      [`/${'sources'.repeat(900)}`, null],
      ['/', null],
    ];
    for (const [path, expected] of cases) {
      assert.equal(suggestNotFoundSection(path)?.href ?? null, expected, path);
    }
  });

  it('makes the likely destination the primary action, with the Briefing second', () => {
    const body = buildHumanNotFoundHtml('/geopolitcs/iran');
    assert.match(body, /<main\b/);
    assert.match(body, /<nav aria-label="Primary">/);
    assert.match(body, /<a class="cta" href="\/lite\/geopolitics">Go to Geopolitics/);
    assert.match(body, /<a class="secondary" href="\/lite">/);
    assert.match(buildHumanNotFoundHtml("/'to"), /<a class="cta" href="\/lite">Open the Briefing/);
    for (const section of HUMAN_NOT_FOUND_SECTIONS) {
      assert.ok(body.includes(`href="${section.href}"`), section.href);
      assert.ok(body.includes(section.description), section.label);
    }
  });

  it('omits the suggestion when nothing is close, and never ships a script', () => {
    const body = buildHumanNotFoundHtml("/'to");
    assert.doesNotMatch(body, /Go to /);
    assert.doesNotMatch(buildHumanNotFoundHtml(), /Go to /);
    assert.doesNotMatch(body, /<script\b/i);
    assert.match(body, /<meta name="robots" content="noindex, nofollow">/);
  });

  it('links every section to its final URL, never through a redirect', () => {
    const redirectSources = new Set(vercelConfig.redirects.map((rule) => rule.source));
    for (const section of HUMAN_NOT_FOUND_SECTIONS) {
      assert.ok(!redirectSources.has(section.href), `${section.href} is a redirect source`);
    }
  });
});
