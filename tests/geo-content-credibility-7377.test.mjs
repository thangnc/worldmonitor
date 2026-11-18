/**
 * #7377 — GEO credibility leaks: contradictory reach figures and buried press
 * cites. The blog and /pro halves left with those surfaces (refactor Phase 1b).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  COUNTRY_REACH_CLAIM,
  GITHUB_STARS_BADGE_URL,
  PRESS_LINKS,
  SILICON_CANALS_2M_URL,
  WIRED_FEATURE_URL,
} from '../shared/press.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('issue #7377 GEO content credibility', () => {
  it('(b) unifies country reach and renders GitHub stars from the API badge', () => {
    const about = read('docs/about.mdx');
    const aboutZh = read('docs/zh/about.mdx');
    const llms = read('public/llms.txt');

    assert.doesNotMatch(about, /81,?508/);
    assert.doesNotMatch(aboutZh, /81,?508/);
    assert.doesNotMatch(about, /more than 170 countries/);
    assert.doesNotMatch(aboutZh, /170 多个国家/);
    assert.match(about, new RegExp(COUNTRY_REACH_CLAIM.replace('+', '\\+')));
    assert.match(about, new RegExp(GITHUB_STARS_BADGE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(llms, /2M\+ people/);
    assert.match(llms, /190\+ countries/);
    assert.match(llms, /\[product identity document\]\(https:\/\/www\.worldmonitor\.app\/world-monitor\.md\)/);
    assert.ok(read('public/world-monitor.md').includes(SILICON_CANALS_2M_URL));
  });

  it('(c) surfaces press URLs and the Silicon Canals 2M citation', () => {
    const identity = read('public/world-monitor.md');
    const pressModule = read('shared/press.ts');

    assert.ok(identity.includes(WIRED_FEATURE_URL));
    assert.ok(identity.includes(SILICON_CANALS_2M_URL));
    for (const link of PRESS_LINKS) {
      assert.ok(
        identity.includes(`](${link.url})`),
        `the identity document linked from llms.txt must include exact ${link.label} URL`,
      );
      assert.ok(pressModule.includes(link.url), `shared/press.ts must include ${link.label}`);
    }
    assert.equal(
      PRESS_LINKS.find((l) => l.label === "L'Orient Today")?.url,
      'https://today.lorientlejour.com/article/1496089/world-monitor-how-anghami-ceos-side-project-became-a-go-to-for-geopolitics-research.html',
    );
  });

  it('(c2) keeps the indexed press document and about pages carrying the same outlets', () => {
    const index = read('public/llms.txt').match(/## Product identity and press references\n([\s\S]*?)(?=\n## |$)/)?.[1];
    assert.ok(index, 'llms.txt must expose its press references');
    assert.match(index, /\]\(https:\/\/www\.worldmonitor\.app\/world-monitor\.md\)/);
    for (const match of index.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) {
      assert.equal(new URL(match[1]).hostname, 'www.worldmonitor.app', 'the discovery index uses first-party press documents');
    }
    const sections = {
      'public/world-monitor.md': ['## Press mentions that name World Monitor', /^## /m],
      'docs/about.mdx': ['## In the press', /^## /m],
      'docs/zh/about.mdx': ['## 媒体报道', /^## /m],
      // #7869: round 7 found the WIRED feature absent from ai-search.md, one of
      // the two files an assistant is most likely to read for entity grounding.
      // Listed here rather than merely added, so it cannot drift back out.
      'public/ai-search.md': ['## Press Coverage', /^## /m],
    };

    const urlsIn = (relative, heading) => {
      const source = read(relative);
      const start = source.indexOf(heading);
      assert.ok(start >= 0, `${relative} must carry a "${heading}" section`);
      const rest = source.slice(start + heading.length);
      const end = rest.search(/^## /m);
      const body = end === -1 ? rest : rest.slice(0, end);
      //外部 press URLs only — the "Human about page" row is a self-link.
      return new Set(
        [...body.matchAll(/\((https?:\/\/[^)]+)\)/g)]
          .map((match) => match[1])
          .filter((url) => !url.includes('worldmonitor.app')),
      );
    };

    const bySurface = Object.fromEntries(
      Object.entries(sections).map(([relative, [heading]]) => [relative, urlsIn(relative, heading)]),
    );

    const [reference, ...others] = Object.keys(bySurface);
    for (const surface of others) {
      assert.deepEqual(
        [...bySurface[surface]].sort(),
        [...bySurface[reference]].sort(),
        `${surface} press list must carry the same outlets as ${reference}`,
      );
    }

    // And the shared module is what the rendered surfaces read, so it must not
    // fall behind the prose lists either.
    for (const url of bySurface[reference]) {
      assert.ok(
        PRESS_LINKS.some((link) => link.url === url),
        `shared/press.ts PRESS_LINKS is missing ${url}, which the press lists cite`,
      );
    }
    assert.equal(
      PRESS_LINKS.length,
      bySurface[reference].size,
      'PRESS_LINKS and the press lists must cite the same number of outlets',
    );
    // Every count in this family — (c2)'s deepEqual and equality above, (c3)'s
    // per-outlet loop — is relative to PRESS_LINKS. Empty it and the whole
    // family degenerates to 0 === 0 and reports green on four surfaces that
    // cite nobody. The floor is what stops that; `>=` so it never blocks a
    // genuinely growing press list.
    assert.ok(
      PRESS_LINKS.length >= 8,
      `PRESS_LINKS must keep the full press set (>= 8, got ${PRESS_LINKS.length});`
        + ' a shrinking list makes every count assertion in this file vacuous',
    );
  });

  it('(c3) names the outlets in the llms.txt press section, without leaving the first-party links (#7869)', () => {
    // Round 7: the WIRED feature is absent from llms.txt, which points at
    // world-monitor.md and names nobody. A model that reads only the index
    // learns World Monitor has "external reporting" and no more. The links here
    // stay first-party — (c2) above enforces that — so the outlets have to be
    // named in the prose instead.
    const heading = '## Press mentions that name World Monitor';
    const identity = read('public/world-monitor.md');
    const afterHeading = identity.slice(identity.indexOf(heading) + heading.length);
    const nextHeading = afterHeading.search(/^## /m);
    const pressBody = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
    const outlets = [...pressBody.matchAll(/^- \[([^—\]]+) — /gm)].map((match) => match[1].trim());
    assert.equal(
      outlets.length,
      PRESS_LINKS.length,
      'the identity document must list every press outlet as "Outlet — headline"',
    );

    const index = read('public/llms.txt').match(/## Product identity and press references\n([\s\S]*?)(?=\n## |$)/)?.[1];
    assert.ok(index, 'llms.txt must expose its press references');
    for (const outlet of outlets) {
      assert.ok(
        index.includes(outlet),
        `llms.txt must name ${outlet}; an unnamed "external reporting" pointer grounds nothing`,
      );
    }
  });
});
