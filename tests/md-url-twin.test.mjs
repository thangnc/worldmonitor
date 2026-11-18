import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { load } from 'js-yaml';

import {
  MAX_TWIN_BYTES,
  MD_TWIN_LOOP_HEADER,
  buildMarkdownTwinResponse,
  htmlToMarkdown,
  isMarkdownTwinPath,
  resolveMarkdownTwinPath,
  siblingPathFromMarkdown,
} from '../api/_md-url-twin.ts';

it('preserves escaped text while decoding one entity layer in Markdown', () => {
  const markdown = htmlToMarkdown(
    '<main><h1>Literal &lt;name&gt;</h1><p>Nested &amp;lt;name&amp;gt;</p><ul><li>Keep &lt;value&gt;</li></ul></main>',
    'Fallback',
  );
  assert.equal(markdown, '# Literal <name>\n\n Nested &lt;name&gt;\n\n- Keep <value>');
});

it('does not decode entities produced by numeric ampersands', () => {
  assert.equal(htmlToMarkdown('<main><p>&#38;amp; &amp;#38; &#38;lt;</p></main>', 'Title'),
    '# Title\n\n&amp; &#38; &lt;');
});

it('decodes hexadecimal and apostrophe entities once with the numeric safety bounds', () => {
  assert.equal(htmlToMarkdown('<main><h1>It&#x27;s &apos;ready&apos;</h1><p>&#X1F600; &#x26;lt; a&#x7;b&#xD800;&#x110000;</p></main>', 'Title'),
    "# It's 'ready'\n\n 😀 &lt; ab");
});

it('keeps definition labels and values together across adjacent stat cells', () => {
  const markdown = htmlToMarkdown('<main><dl><div><dt>Providers</dt><dd><a href="/sources/?utm_source=hero">748</a></dd></div><div><dt>Alert origins</dt><dd>5</dd></div></dl></main>', 'Title');
  assert.equal(markdown, '# Title\n\n- Providers: [748](/sources/)\n\n- Alert origins: 5');
});

it('removes only tracking query parameters and separates block links from following values', () => {
  const markdown = htmlToMarkdown('<main><a href="/sources/?utm_source=hero&amp;country=US&amp;utm_content=proof#catalog"><div>748</div><div>Providers</div></a><div>5</div><a href="https://example.com/?q=two%20words&amp;utm_medium=ref">External</a><a href="#depth">Depth</a></main>', 'Title');
  assert.match(markdown, /\[748 Providers\]\(\/sources\/\?country=US#catalog\)\n/);
  assert.match(markdown, /https:\/\/example.com\/\?q=two%20words/);
  assert.match(markdown, /\[Depth\]\(#depth\)/);
  assert.doesNotMatch(markdown, /utm_/);
});

it('preserves functional queries and fragments encoded as numeric HTML entities', () => {
  for (const separator of ['&#38;', '&#x26;', '&#X26;', '&amp;']) {
    for (const query of [`q=1${separator}utm_source=a${separator}page=2`, `utm_source=a${separator}q=1${separator}page=2`]) {
      assert.equal(htmlToMarkdown(`<a href="/x?${query}&#35;results">Results</a>`, 'Title'),
        '# Title\n\n[Results](/x?q=1&page=2#results)');
    }
  }
  assert.equal(htmlToMarkdown('<a href="/x?q=&amp;lt;value&amp;gt;&amp;utm_source=a">Results</a>', 'Title'),
    '# Title\n\n[Results](/x?q=&lt;value&gt;)');
});

// stripTags no longer decodes, so the <title> path carries its own
// decodeHtmlEntities() call. Dropping that wrapper is an easy refactor mistake
// and every other <title> fixture in this file is plain text, so pin it here.
it('decodes one entity layer in the <title> fallback heading', () => {
  assert.equal(htmlToMarkdown('<html><title>News &amp; Views</title><main><p>Body.</p></main></html>', 'Fallback'),
    '# News & Views\n\nBody.');
});

// The numeric branch's rejection arm. `&#7;` is below the 0x20 floor and must
// vanish rather than land a control character in the emitted Markdown.
it('drops numeric entities below the control-character floor', () => {
  assert.equal(htmlToMarkdown('<main><p>a&#7;b</p></main>', 'Title'), '# Title\n\nab');
});

// `String.fromCharCode` coerces with ToUint16, so a code point above 0xFFFF
// wraps back under the `>= 32` guard: `&#65596;` (60 + 0x10000) used to yield a
// literal `<`. fromCodePoint with an explicit range check closes that and stops
// truncating astral characters.
it('does not let astral numeric entities wrap past the control-character guard', () => {
  assert.equal(htmlToMarkdown('<main><p>&#65596;script&#65598;</p></main>', 'Title'),
    '# Title\n\n\u{1003C}script\u{1003E}');
  assert.equal(htmlToMarkdown('<main><p>&#128512;</p></main>', 'Title'), '# Title\n\n\u{1F600}');
  assert.equal(htmlToMarkdown('<main><p>a&#999999999999999999999;b</p></main>', 'Title'), '# Title\n\nab');
});

/**
 * Sequences sibling responses across a redirect chain. Each entry answers one
 * hop, so a test can assert what the twin does with the LAST hop rather than
 * with the 308 that every trailing-slash URL on this site emits first.
 */
function siblingChain(...responses) {
  const seen = [];
  const fetchImpl = async (input, init) => {
    seen.push({ url: new URL(String(input)), init });
    const next = responses[seen.length - 1];
    if (!next) throw new Error(`unexpected sibling fetch #${seen.length}: ${String(input)}`);
    return next;
  };
  return { fetchImpl, seen };
}

describe('markdown URL-fallback helpers', () => {
  it('accepts /{page}.md paths and maps them to the sibling', () => {
    assert.equal(isMarkdownTwinPath('/dashboard.md'), true);
    assert.equal(isMarkdownTwinPath('/stocks/AAPL.md'), true);
    assert.equal(isMarkdownTwinPath('/api/health.md'), true);
    assert.equal(isMarkdownTwinPath('/dashboard'), false);
    assert.equal(isMarkdownTwinPath('/../etc.md'), false);
    assert.equal(siblingPathFromMarkdown('/dashboard.md'), '/dashboard');
    assert.equal(siblingPathFromMarkdown('/api/health.md'), '/api/health');
  });

  it('resolves /api/md-twin?path= to a sanitized .md path', () => {
    const req = new Request('https://www.worldmonitor.app/api/md-twin?path=dashboard');
    assert.equal(resolveMarkdownTwinPath(req), '/dashboard.md');
    const evil = new Request('https://www.worldmonitor.app/api/md-twin?path=https://evil.example/x');
    assert.equal(resolveMarkdownTwinPath(evil), null);
  });

  it('rejects control characters that the URL parser would strip into a protocol-relative path', () => {
    for (const encoded of ['%09', '%0A', '%0D', '%20', '%00', '%7F']) {
      const req = new Request(`https://www.worldmonitor.app/api/md-twin?path=/${encoded}/evil.example/x`);
      assert.equal(resolveMarkdownTwinPath(req), null, encoded);
    }
    assert.equal(isMarkdownTwinPath('/\t/evil.example/x.md'), false);
  });

  it('answers a protocol-relative twin path with 404 and never fetches it', async () => {
    const fetched = [];
    const response = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin'),
      '//evil.example/x.md',
      async (url) => { fetched.push(String(url)); return new Response('# hi'); },
    );
    assert.equal(fetched.length, 0);
    assert.equal(response.status, 404);
  });

  it('converts HTML to heading-led markdown', () => {
    const md = htmlToMarkdown(
      '<html><head><title>Dashboard</title></head><body><h1>Live map</h1><p>Ships and jets.</p></body></html>',
      'fallback',
    );
    assert.match(md, /^# /m);
    assert.match(md, /Live map/);
    assert.match(md, /Ships and jets/);
    assert.doesNotMatch(md, /<html/i);
  });
});

describe('markdown twin vary coverage (#7616 U4)', () => {
  it('declares the loop-guard header in Vary so cached twins never replay across variants', async () => {
    const plain = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md'),
      '/dashboard.md',
      async () => new Response('<html><title>T</title><h1>H</h1></html>', { status: 200 }),
    );
    assert.match(plain.headers.get('vary') ?? '', new RegExp(MD_TWIN_LOOP_HEADER, 'i'));

    const looped = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md', {
        headers: { [MD_TWIN_LOOP_HEADER]: '1' },
      }),
      '/dashboard.md',
    );
    assert.equal(looped.status, 404);
    assert.match(looped.headers.get('vary') ?? '', new RegExp(MD_TWIN_LOOP_HEADER, 'i'));
  });
});

it('does not publish script contents with noncanonical closing tags', () => {
  for (const closing of ['script ', 'script foo="bar"', 'script/']) {
    assert.equal(htmlToMarkdown(`<main><script>SECRET SCRIPT</${closing}><p>Public text</p></main>`, 'Title'), '# Title\n\nPublic text');
  }
});

it('does not treat NBSP as an HTML script end-tag delimiter', () => {
  const html = '<main><script>const marker="</script\u00a0>";PRIVATE_SCRIPT()</script><p>Public text</p></main>';
  assert.equal(htmlToMarkdown(html, 'Title'), '# Title\n\nPublic text');
});
