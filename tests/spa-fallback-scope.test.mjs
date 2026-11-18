// #6575 — unknown paths must return a real 404, not the SPA document.
// Diligence and security tooling reads a 200 + app document as "the page
// exists", so the SPA document is served only by enumerated History routes.
// The Lite UI (lite.html) is the only SPA; the old dashboard routes redirect
// to it.
//
// #6640 coordination: /security (and /trust) intentionally have NO rule here.
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

const LITE_HTML_DESTINATION = '/lite.html';
const LITE_ROUTES = ['/lite', '/lite/finance', '/lite/geopolitics', '/lite/sources', '/lite/tech'];
const OLD_DASHBOARD_ROUTES = ['/dashboard', '/stocks', '/stocks/:symbol', '/story'];

// The vercel.json `source` subset used by SPA-serving rules.
function sourceToRegExp(source) {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === ':') {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      if (source[j] === '*') {
        out = out.replace(/\/$/, '');
        out += '(?:/.*)?';
        i = j;
      } else {
        out += '[^/]+';
        i = j - 1;
      }
    } else {
      out += /[.*+?^${}|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return new RegExp(`^${out}$`);
}

const liteRewrites = () => vercel.rewrites.filter((r) => r.destination === LITE_HTML_DESTINATION);
const liteShadow = (path) => liteRewrites().find((r) => sourceToRegExp(r.source).test(path));

describe('SPA fallback scope (#6575)', () => {
  it('serves the Lite document only from the enumerated client History routes', () => {
    assert.deepEqual(liteRewrites().map((r) => r.source).sort(), LITE_ROUTES);
  });

  it('serves no document for the removed dashboard pages', () => {
    for (const rewrite of vercel.rewrites) {
      assert.doesNotMatch(rewrite.destination, /^\/dashboard[a-z-]*\.html$/, rewrite.source);
    }
  });

  it('unknown paths match no rewrite and fall through to a filesystem 404', () => {
    for (const path of ['/this-is-not-a-page', '/security', '/trust', '/wp-admin/setup-config.php', '/lite/unknown']) {
      assert.equal(liteShadow(path), undefined, `${path} must not serve the Lite document`);
      const any = vercel.rewrites.find((r) => sourceToRegExp(r.source).test(path));
      assert.equal(any, undefined, `${path} must not match any rewrite at all`);
    }
  });

  it('redirects the old dashboard History routes to /lite', () => {
    for (const source of OLD_DASHBOARD_ROUTES) {
      const redirect = vercel.redirects.find((r) => r.source === source && !r.has);
      assert.equal(redirect?.destination, '/lite', `${source} must redirect to /lite`);
    }
  });

  // A rewrite source matches its exact spelling only, so every slashless page
  // served by a `.html` rewrite needs a permanent redirect from its
  // trailing-slash spelling. Directory pages (`/pro` -> `/pro/index.html`) are
  // excluded because the filesystem already serves their slash spelling.
  it('redirects the trailing-slash spelling of every slashless HTML page rewrite', () => {
    const pageSources = [...new Set(vercel.rewrites
      .filter((r) => r.destination.endsWith('.html') && !r.destination.endsWith('/index.html'))
      .filter((r) => !r.source.endsWith('/') && !r.source.includes('('))
      .map((r) => r.source))];
    assert.ok(pageSources.includes('/lite'), 'inventory must include /lite');
    for (const source of pageSources) {
      const redirect = vercel.redirects.find((r) => r.source === `${source}/` && !r.has);
      assert.equal(redirect?.destination, source, `${source}/ must redirect to ${source}`);
      assert.equal(redirect?.permanent, true, `${source}/ redirect must be permanent`);
    }
  });

  it('never reintroduces a negative-lookahead SPA catch-all', () => {
    const catchAll = vercel.rewrites.find((r) => r.destination === LITE_HTML_DESTINATION && r.source.includes('(?!'));
    assert.equal(catchAll, undefined, 'the exclusion-list catch-all is the soft-404 root cause (#6575)');
  });
});
