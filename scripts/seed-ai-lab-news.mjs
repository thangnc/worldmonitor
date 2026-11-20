#!/usr/bin/env node
// @ts-check
//
// AI labs' own announcements for the Lite "Lab announcement" indicator (#133;
// spec docs/engineering/architecture/lite.md, Early indicators › Catalogue,
// Model and product releases): the primary-source backup for the OpenRouter
// and Hugging Face model feeds.
//
// Sources (no key; each lab's own site):
// - RSS: OpenAI news, Google's AI blog (blog.google) and Google DeepMind's blog.
// - Anthropic publishes no feed (its old RSS answers 404), so its sitemap's
//   /news/ pages are read instead. The sitemap's lastmod is an edit time, not
//   a publication date (a site edit re-dates dozens of old pages at once), so a
//   page is dated by the run that first saw it (`anthropicSeen` in the state
//   key). The first read only records the pages already there, and a new
//   page's own <title> gives its headline.
// Qwen's blog stopped in 2025 and DeepSeek's feed is empty, so neither is read.
//
// Each source keeps its posts from the last good read when it fails, and a
// source unread for one health budget fails the run, so freshness follows the
// oldest source. A post is a release announcement when its title says so
// ("Introducing", "now available", "launches") and names a model or product.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'tech:ai-lab-news:v1';
export const STATE_KEY = 'tech:ai-lab-news:state:v1';
export const ACTIVATION_KEY = 'seed-activated:tech:ai-lab-news';
export const SOURCES = Object.freeze([
  { id: 'openai', lab: 'OpenAI', kind: 'rss', url: 'https://openai.com/news/rss.xml' },
  { id: 'google', lab: 'Google', kind: 'rss', url: 'https://blog.google/technology/ai/rss/' },
  { id: 'deepmind', lab: 'Google DeepMind', kind: 'rss', url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'anthropic', lab: 'Anthropic', kind: 'sitemap', url: 'https://www.anthropic.com/sitemap.xml' },
]);
export const POSTS_KEEP_DAYS = 14;
export const POSTS_PER_SOURCE = 60;
/** New Anthropic pages whose own title is read per run; the rest use their slug. */
export const TITLE_READS_PER_RUN = 6;
export const ANTHROPIC_SEEN_KEEP_DAYS = 400;
export const LAB_NEWS_TTL_SECONDS = 48 * 3600; // a 3 h cadence
export const STATE_TTL_SECONDS = 60 * 24 * 3600;
export const LAB_NEWS_MAX_STALE_MIN = 540;
const MAX_FEED_BYTES = 6 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
/** A page's own title is a nicety: a slow page gives up sooner, so six reads fit the run. */
const TITLE_TIMEOUT_MS = 10_000;
/** A sitemap listing under this share of the last read's news pages is a partial answer. */
const MIN_LISTED_SHARE = 0.5;
const USER_AGENT = 'WorldMonitor ai-lab-news seeder (+https://worldmonitor.app)';
const DAY_MS = 24 * 3600 * 1000;

/** A title that announces something ships... */
const RELEASE_WORDS = /^(introducing|announcing|meet|say hello to)\b|\b(launch(es|ed|ing)?|releas(e|es|ed|ing)|now available|available (today|now|in)|rolling out|is here|are here)\b/i;
/** ...and names a model or product. */
const MODEL_WORDS = /\b(gpt[- ]?\d[\w.]*|o\d(-\w+)?|gemini( \d[\w.]*)?|gemma|claude|opus|sonnet|haiku|codex|sora|veo|imagen|genie|lyria|nano banana|model|models)\b/i;

/** Does a post's title announce a model or product release? */
export function isReleasePost(title) {
  return RELEASE_WORDS.test(title) && MODEL_WORDS.test(title);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
const decode = (s) => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|ldquo|rdquo|ndash|mdash);/g, (_, e) => ENTITIES[/** @type {keyof typeof ENTITIES} */ (e)])
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? Number.parseInt(n.slice(1), 16) : Number(n)))
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** An RSS feed's items: title, https link on the lab's host, and publication time. */
export function rssPosts(xml, source) {
  const host = new URL(source.url).host;
  return [...String(xml ?? '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].map((m) => {
    const field = (name) => decode(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(m[1])?.[1] ?? '');
    const url = field('link');
    return { source: source.id, lab: source.lab, title: field('title').slice(0, 200), url, at: Date.parse(field('pubDate')) };
  }).filter((p) => p.title && Number.isFinite(p.at) && /^https:\/\//.test(p.url) && new URL(p.url).host === host);
}

/** Anthropic's /news/ pages in the sitemap (its lastmod is an edit time, so it is not read). */
export function anthropicPages(xml) {
  return [...String(xml ?? '').matchAll(/<url>\s*<loc>(https:\/\/www\.anthropic\.com\/news\/[a-z0-9-]+)<\/loc>/g)].map((m) => ({ url: m[1] }));
}

/** "claude-opus-5-and-sonnet-5" → "Claude opus 5 and sonnet 5": a stand-in until the page's own title is read. */
export function slugTitle(url) {
  const slug = url.split('/').pop() ?? '';
  const words = slug.replace(/-/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : slug;
}

/** A page's headline from its <title>, without the " \ Anthropic" suffix. */
export function pageTitle(html) {
  const t = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ''))?.[1] ?? '');
  return t.replace(/\s*[\\|–—-]\s*Anthropic\s*$/i, '').slice(0, 200);
}

async function fetchText(fetchImpl, url, maxBytes, accept, timeoutMs = REQUEST_TIMEOUT_MS) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return readBoundedFeedText(res, maxBytes);
}

async function readState() {
  const creds = getOptionalUpstashCreds();
  if (!creds) return null;
  // A failed read must fail the run: starting fresh would re-date Anthropic's pages and drop kept posts.
  let raw;
  try {
    ({ result: raw } = await upstashCommand(creds, ['GET', STATE_KEY]));
  } catch (err) {
    throw new Error(`ai-lab-news state read failed: ${err?.message || err}`);
  }
  if (raw == null) return null;
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const data = value?.data ?? value;
  return data?.state && typeof data.state === 'object' ? data.state : null;
}

/**
 * One source's posts this run. RSS: the feed's items. Anthropic: its news
 * pages, dated by first sight after the first read, titled from the page.
 */
async function readSource(fetchImpl, source, previous, nowMs, titleBudget) {
  if (source.kind === 'rss') {
    const posts = rssPosts(await fetchText(fetchImpl, source.url, MAX_FEED_BYTES, 'application/rss+xml, application/xml'), source);
    if (!posts.length) throw new Error(`${new URL(source.url).host} answered without dated items`);
    return { posts, seen: null };
  }
  const pages = anthropicPages(await fetchText(fetchImpl, source.url, MAX_FEED_BYTES, 'application/xml'));
  if (pages.length < 20) throw new Error(`www.anthropic.com sitemap lists ${pages.length} news pages, expected at least 20`);
  // A sitemap far shorter than the last one is a partial answer (a deploy, a CMS problem): reading it
  // as good would later re-date the pages it left out as new.
  const prevListed = Number.isFinite(previous?.anthropicListed) ? previous.anthropicListed : 0;
  if (pages.length < prevListed * MIN_LISTED_SHARE) {
    throw new Error(`www.anthropic.com sitemap lists ${pages.length} news pages against ${prevListed} on the last read`);
  }
  const prevSeen = previous?.anthropicSeen && typeof previous.anthropicSeen === 'object' ? previous.anthropicSeen : null;
  const seen = Object.fromEntries(Object.entries(prevSeen ?? {}).map(([url, v]) => [url, { ...v }]));
  const posts = [];
  for (const page of pages) {
    if (!Number.isFinite(seen[page.url]?.at)) {
      // The first read only records the pages already there (their date unknown, kept as 0);
      // after that a page is new when first seen.
      seen[page.url] = { at: prevSeen ? nowMs : 0 };
    }
    seen[page.url].listedAt = nowMs;
    const at = seen[page.url].at;
    if (nowMs - at > POSTS_KEEP_DAYS * DAY_MS) continue;
    // Only a title read from the page is kept; a page shown under its slug is read again next run.
    let title = typeof seen[page.url].title === 'string' ? seen[page.url].title : '';
    if (!title && titleBudget.left > 0) {
      titleBudget.left--;
      try {
        title = pageTitle(await fetchText(fetchImpl, page.url, MAX_PAGE_BYTES, 'text/html', TITLE_TIMEOUT_MS));
      } catch (err) {
        console.warn(`  WARN: Anthropic page title unread (${err?.message || err}): ${page.url}`);
      }
      if (title) seen[page.url].title = title;
    }
    posts.push({ source: 'anthropic', lab: 'Anthropic', title: title || slugTitle(page.url), url: page.url, at, firstSeen: Boolean(prevSeen) });
  }
  // A page leaves the record only after the sitemap has not listed it for ANTHROPIC_SEEN_KEEP_DAYS,
  // whenever it was first seen: a page missing from a few reads must never come back as new.
  for (const [url, v] of Object.entries(seen)) {
    if (nowMs - (Number.isFinite(v?.listedAt) ? v.listedAt : nowMs) > ANTHROPIC_SEEN_KEEP_DAYS * DAY_MS) delete seen[url];
  }
  return { posts, seen, listed: pages.length };
}

/**
 * runSeed fetch function.
 * @param {{ fetchImpl?: typeof fetch, nowMs?: number, loadState?: () => Promise<any> }} [opts]
 */
export async function fetchAiLabNews({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadState = readState,
} = {}) {
  const previous = await loadState();
  const titleBudget = { left: TITLE_READS_PER_RUN };
  const results = await Promise.allSettled(SOURCES.map((s) => readSource(fetchImpl, s, previous, nowMs, titleBudget)));
  const cutoff = nowMs - POSTS_KEEP_DAYS * DAY_MS;
  const sources = {};
  const posts = [];
  let anthropicSeen = previous?.anthropicSeen ?? null;
  let anthropicListed = Number.isFinite(previous?.anthropicListed) ? previous.anthropicListed : 0;
  SOURCES.forEach((s, i) => {
    const r = results[i];
    const prev = previous?.sources?.[s.id];
    if (r.status === 'fulfilled') {
      sources[s.id] = { ok: true, okAt: nowMs };
      posts.push(...r.value.posts.filter((p) => p.at >= cutoff && p.at <= nowMs + DAY_MS)
        .sort((a, b) => b.at - a.at).slice(0, POSTS_PER_SOURCE));
      if (r.value.seen) {
        anthropicSeen = r.value.seen;
        anthropicListed = r.value.listed;
      }
      return;
    }
    const error = String(r.reason?.message || r.reason).slice(0, 160);
    const okAt = Number.isFinite(prev?.okAt) ? prev.okAt : null;
    if (okAt === null || nowMs - okAt > LAB_NEWS_MAX_STALE_MIN * 60_000) {
      throw new Error(`${s.lab} feed failed (${error}) and ${okAt === null ? 'has no earlier read' : `was last read ${Math.round((nowMs - okAt) / 60_000)} min ago`}`);
    }
    sources[s.id] = { ok: false, okAt, error };
    // Keep the source's posts from the last good read.
    posts.push(...(Array.isArray(previous?.posts) ? previous.posts : []).filter((p) => p?.source === s.id && p.at >= cutoff));
  });
  const out = posts
    .map((p) => ({ ...p, release: isReleasePost(p.title) }))
    .sort((a, b) => b.at - a.at || a.url.localeCompare(b.url));
  console.log(`  ${SOURCES.map((s) => `${s.lab}: ${sources[s.id].ok ? 'read' : `failed (${sources[s.id].error})`}`).join('; ')}; ${out.length} posts in ${POSTS_KEEP_DAYS} days, ${out.filter((p) => p.release).length} release announcements`);
  return {
    fetchedAt: nowMs,
    keepDays: POSTS_KEEP_DAYS,
    sources,
    posts: out,
    state: { sources, posts: out, anthropicSeen, anthropicListed },
  };
}

/** The public payload: everything except the state. */
export function publishTransform(data) {
  const { state: _state, ...published } = data ?? {};
  return published;
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.posts) && data.sources && SOURCES.every((s) => data.sources[s.id])
    && data.posts.every((p) => typeof p?.url === 'string' && typeof p?.title === 'string' && Number.isFinite(p?.at)));
}

/** Posts kept; a quiet fortnight from all four labs is unlikely, so 0 is a broken read. */
export function declareRecords(data) {
  return Array.isArray(data?.posts) ? data.posts.length : 0;
}

export async function markAiLabNewsActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('tech', 'ai-lab-news', CANONICAL_KEY, () => fetchAiLabNews(), {
    validateFn,
    declareRecords,
    ttlSeconds: LAB_NEWS_TTL_SECONDS,
    maxStaleMin: LAB_NEWS_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'lab-rss-anthropic-sitemap-v1',
    publishTransform,
    extraKeys: [{
      key: STATE_KEY,
      ttl: STATE_TTL_SECONDS,
      transform: (data) => ({ state: data?.state ?? null }),
      allowPrePublishFields: ['state'],
      declareRecords: (data) => Object.keys(data?.state?.anthropicSeen ?? {}).length,
    }],
    preserveKeyTtls: [{ key: STATE_KEY, ttlSeconds: STATE_TTL_SECONDS }],
    afterPublish: markAiLabNewsActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
