import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  LAB_NEWS_MAX_STALE_MIN,
  SOURCES,
  anthropicPages,
  declareRecords,
  fetchAiLabNews,
  isReleasePost,
  pageTitle,
  publishTransform,
  rssPosts,
  slugTitle,
  validateFn,
} from '../scripts/seed-ai-lab-news.mjs';

const NOW = Date.UTC(2026, 10, 20, 12);
const H = 3_600_000;
const DAY = 24 * H;
const url = (id) => SOURCES.find((s) => s.id === id).url;

// The live feeds' shapes (2026-11-20), trimmed.
const rss = (items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Feed</title>${items.map(([title, link, at]) => `
  <item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${new Date(at).toUTCString()}</pubDate><description><![CDATA[<p>…</p>]]></description></item>`).join('')}
</channel></rss>`;
const sitemap = (slugs) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.anthropic.com/</loc><lastmod>2026-11-19T00:00:00.000Z</lastmod></url>
  ${slugs.map((s) => `<url><loc>https://www.anthropic.com/news/${s}</loc><lastmod>2026-11-13T22:37:00.000Z</lastmod></url>`).join('\n  ')}
</urlset>`;
const OLD_PAGES = Array.from({ length: 30 }, (_, i) => `old-post-${i}`);
const table = (o = {}) => ({
  [url('openai')]: rss([['Introducing GPT-6.2 Astra and Sol', 'https://openai.com/index/gpt-6-2/', NOW - 3 * DAY], ['How OpenAI keeps ChatGPT fast', 'https://openai.com/index/perf/', NOW - DAY]]),
  [url('google')]: rss([['Introducing Tool Retrieval in the Gemini API', 'https://blog.google/technology/ai/tool-retrieval/', NOW - 18 * H]]),
  [url('deepmind')]: rss([['Introducing Gemini 4 Neon', 'https://deepmind.google/blog/gemini-4-neon/', NOW - 2 * DAY], ['Not ours', 'https://evil.example/x', NOW]]),
  [url('anthropic')]: sitemap(OLD_PAGES),
  ...o,
});
const router = (t) => {
  const calls = [];
  const fetchImpl = async (u, init) => {
    calls.push([u, init?.headers?.['User-Agent']]);
    const hit = t[u];
    const status = typeof hit === 'number' ? hit : hit == null ? 404 : 200;
    return { ok: status === 200, status, headers: new Headers(), text: async () => (typeof hit === 'string' ? hit : '') };
  };
  return { fetchImpl, calls };
};

describe('AI lab posts (#133)', () => {
  it('reads RSS items on the lab\'s own host, Anthropic\'s news pages, and page titles', () => {
    const s = SOURCES.find((x) => x.id === 'deepmind');
    assert.deepEqual(rssPosts(table()[url('deepmind')], s).map((p) => [p.title, p.url, p.at]), [['Introducing Gemini 4 Neon', 'https://deepmind.google/blog/gemini-4-neon/', Math.floor((NOW - 2 * DAY) / 1000) * 1000]]);
    assert.deepEqual(anthropicPages(sitemap(['claude-opus-5'])), [{ url: 'https://www.anthropic.com/news/claude-opus-5' }]);
    assert.equal(slugTitle('https://www.anthropic.com/news/claude-opus-5-and-sonnet-5'), 'Claude opus 5 and sonnet 5');
    assert.equal(pageTitle('<html><head><title>Introducing Claude Opus 5 \\ Anthropic</title></head></html>'), 'Introducing Claude Opus 5');
  });

  it('calls a post a release when its title introduces or makes available a model or product', () => {
    for (const t of ['Introducing GPT-6.2 Astra and Sol', 'Genie 4 is now available', 'Google Cloud launches Gemini for healthcare.', 'Introducing Claude Opus 5']) assert.equal(isReleasePost(t), true, t);
    for (const t of ['How OpenAI keeps ChatGPT fast', 'Anthropic prices initial public offering', 'Introducing our new Singapore office', 'Walter Isaacson on curiosity']) assert.equal(isReleasePost(t), false, t);
  });
});

describe('AI lab news fetch (#133)', () => {
  it('publishes every lab\'s recent posts with the release flag; Anthropic\'s first read only records its pages', async () => {
    const { fetchImpl, calls } = router(table());
    const first = await fetchAiLabNews({ fetchImpl, nowMs: NOW, loadState: async () => null });
    assert.match(calls[0][1], /WorldMonitor/);
    assert.deepEqual(first.posts.map((p) => [p.lab, p.release]), [['Google', true], ['OpenAI', false], ['Google DeepMind', true], ['OpenAI', true]]);
    assert.equal(first.posts.some((p) => p.lab === 'Anthropic'), false, 'the backlog is recorded, not shown');
    assert.equal(Object.keys(first.state.anthropicSeen).length, OLD_PAGES.length);
    assert.equal(publishTransform(first).state, undefined);
    assert.equal(validateFn(first), true);
    assert.equal(declareRecords(first), 4);
    assert.equal(CANONICAL_KEY, 'tech:ai-lab-news:v1');
    // A new Anthropic page is dated when first seen and titled from the page itself.
    const page = 'https://www.anthropic.com/news/claude-opus-5';
    const next = router(table({ [url('anthropic')]: sitemap([...OLD_PAGES, 'claude-opus-5']), [page]: '<title>Introducing Claude Opus 5 \\ Anthropic</title>' }));
    const second = await fetchAiLabNews({ fetchImpl: next.fetchImpl, nowMs: NOW + 3 * H, loadState: async () => first.state });
    const a = second.posts.find((p) => p.lab === 'Anthropic');
    assert.deepEqual([a.title, a.at, a.firstSeen, a.release], ['Introducing Claude Opus 5', NOW + 3 * H, true, true]);
    assert.equal(next.calls.filter(([u]) => u === page).length, 1);
    // The title is kept; the next run does not read the page again.
    const again = router(table({ [url('anthropic')]: sitemap([...OLD_PAGES, 'claude-opus-5']) }));
    const third = await fetchAiLabNews({ fetchImpl: again.fetchImpl, nowMs: NOW + 6 * H, loadState: async () => second.state });
    assert.equal(third.posts.find((p) => p.lab === 'Anthropic').title, 'Introducing Claude Opus 5');
    assert.equal(again.calls.some(([u]) => u === page), false);
  });

  it('keeps a failed lab\'s posts for one health budget, then fails the run; a feed without items or a short sitemap is a failure', async () => {
    const first = await fetchAiLabNews({ fetchImpl: router(table()).fetchImpl, nowMs: NOW, loadState: async () => null });
    const openaiDown = router(table({ [url('openai')]: 503 }));
    const soon = await fetchAiLabNews({ fetchImpl: openaiDown.fetchImpl, nowMs: NOW + H, loadState: async () => first.state });
    assert.deepEqual([soon.sources.openai.ok, soon.sources.openai.okAt, soon.posts.filter((p) => p.lab === 'OpenAI').length], [false, NOW, 2]);
    await assert.rejects(fetchAiLabNews({ fetchImpl: openaiDown.fetchImpl, nowMs: NOW + (LAB_NEWS_MAX_STALE_MIN + 1) * 60_000, loadState: async () => soon.state }), /OpenAI feed failed \(HTTP 503 from openai\.com\) and was last read/);
    await assert.rejects(fetchAiLabNews({ fetchImpl: openaiDown.fetchImpl, nowMs: NOW, loadState: async () => null }), /has no earlier read/);
    const empty = await fetchAiLabNews({ fetchImpl: router(table({ [url('google')]: '<html>Maintenance</html>' })).fetchImpl, nowMs: NOW + H, loadState: async () => first.state });
    assert.equal(empty.sources.google.ok, false);
    const short = await fetchAiLabNews({ fetchImpl: router(table({ [url('anthropic')]: sitemap(['a', 'b']) })).fetchImpl, nowMs: NOW + H, loadState: async () => first.state });
    assert.match(short.sources.anthropic.error, /lists 2 news pages/);
    // The Anthropic record survives a failed read, so its old pages never become new.
    assert.equal(Object.keys(short.state.anthropicSeen).length, OLD_PAGES.length);
  });

  it('never shows an old Anthropic page as new after a partial sitemap, and retries a title it could not read', async () => {
    const many = Array.from({ length: 100 }, (_, i) => `old-post-${i}`);
    const first = await fetchAiLabNews({ fetchImpl: router(table({ [url('anthropic')]: sitemap(many) })).fetchImpl, nowMs: NOW, loadState: async () => null });
    // A much shorter sitemap (30 of 100 pages) is a partial answer: a failed read, the record kept.
    const partial = await fetchAiLabNews({ fetchImpl: router(table({ [url('anthropic')]: sitemap(many.slice(0, 30)) })).fetchImpl, nowMs: NOW + 3 * H, loadState: async () => first.state });
    assert.match(partial.sources.anthropic.error, /lists 30 news pages against 100/);
    // A modestly shorter one (60 of 100) is read, but the pages it left out keep their dates.
    const shorter = await fetchAiLabNews({ fetchImpl: router(table({ [url('anthropic')]: sitemap(many.slice(0, 60)) })).fetchImpl, nowMs: NOW + 6 * H, loadState: async () => partial.state });
    assert.equal(Object.keys(shorter.state.anthropicSeen).length, 100);
    const full = await fetchAiLabNews({ fetchImpl: router(table({ [url('anthropic')]: sitemap(many) })).fetchImpl, nowMs: NOW + 9 * H, loadState: async () => shorter.state });
    assert.equal(full.posts.filter((p) => p.lab === 'Anthropic').length, 0, 'no old page comes back as new');
    // A new page whose title read fails shows its slug, and its title is read on the next run.
    const page = 'https://www.anthropic.com/news/claude-opus-6';
    const failedTitle = await fetchAiLabNews({ fetchImpl: router(table({ [url('anthropic')]: sitemap([...many, 'claude-opus-6']), [page]: 503 })).fetchImpl, nowMs: NOW + 12 * H, loadState: async () => full.state });
    assert.equal(failedTitle.posts.find((p) => p.lab === 'Anthropic').title, 'Claude opus 6');
    const retried = await fetchAiLabNews({ fetchImpl: router(table({ [url('anthropic')]: sitemap([...many, 'claude-opus-6']), [page]: '<title>Introducing Claude Opus 6 \\ Anthropic</title>' })).fetchImpl, nowMs: NOW + 15 * H, loadState: async () => failedTitle.state });
    const a = retried.posts.find((p) => p.lab === 'Anthropic');
    assert.deepEqual([a.title, a.at, a.release], ['Introducing Claude Opus 6', NOW + 12 * H, true]);
  });
});
