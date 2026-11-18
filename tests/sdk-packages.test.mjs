import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

// The SDK packages (sdk/) and their publish workflows were removed from this
// repository in the Lite refactor (Phase 1c). The public discovery surfaces
// below still advertise the registry packages until the public-docs cleanup
// lands; these assertions keep those surfaces consistent until then.

describe('SDK discovery surfaces', () => {
  it('llms.txt advertises every registry package', () => {
    const llms = read('public/llms.txt');
    assert.match(llms, /pypi\.org\/project\/worldmonitor-sdk/);
    assert.match(llms, /rubygems\.org\/gems\/worldmonitor/);
    assert.match(llms, /pkg\.go\.dev\/github\.com\/koala73\/worldmonitor\/sdk\/go/);
  });

  it('api/llms.txt advertises the SDK surface', () => {
    const llms = read('public/api/llms.txt');
    assert.match(llms, /pip install worldmonitor-sdk/);
    assert.match(llms, /gem install worldmonitor/);
    assert.match(llms, /go get github\.com\/koala73\/worldmonitor\/sdk\/go/);
  });

  it('the docs site has an SDKs page wired into navigation', () => {
    assert.ok(existsSync(join(ROOT, 'docs/sdks.mdx')), 'docs/sdks.mdx must exist');
    const nav = JSON.parse(read('docs/docs.json'));
    assert.match(JSON.stringify(nav.navigation), /"sdks"/);
  });
});
